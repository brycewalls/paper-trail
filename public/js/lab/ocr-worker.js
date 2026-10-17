// lab/ocr-worker.js: the lab's OCR, off the main thread (#101, #98). A module Web Worker that runs
// PaddleOCR's PP-OCRv5 mobile models (lab/ppocr.js) on ONNX Runtime Web, and renders PDF pages for
// it with pdf.js on an OffscreenCanvas, so the page never waits on OCR. lab/ocr.js starts it.
//
// Runtime: onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (MIT), pinned and self-hosted under
// /lab-models/match/vendor/ (tools/lab/fetch-models.sh), the same version and the same files as the
// matcher's (#102), so the phone downloads one runtime binary for both. WebGPU when the device has
// an adapter and a warm-up run works, WebAssembly (SIMD, one thread) otherwise. The models are
// served by Hosting from /lab-models/pp-ocrv5-mobile/ (Apache-2.0). Models and the WebAssembly
// binary are kept in Cache Storage ("pt-lab-ocr-v2"; v1 held the 1.30.0 runtime and is deleted).
//
// Messages in:
//   { type: "init", backend: "auto"|"webgpu"|"wasm", models: URL, detMax }
//   { type: "image", id, blob?, rgba?: { data, width, height }, turns, edge }
//   { type: "pdf", id, blob, key?, pages: [n], turns, edge }   renders and reads each page in turn;
//                      with a key, the document stays open for the next request with the same key
// Messages out:
//   { type: "load", pct }  { type: "ready", engine: "paddle", backend, loadMs }  { type: "failed", error }
//   { type: "progress", id, page?, pct }  { type: "result", id, page?, result }  { type: "done", id }
//   { type: "error", id, error }  { type: "render-unsupported", id, page, reason }
// Owner: lab OCR.
import { readPage, parseDict, DET_MAX } from "./ppocr.js";

const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
const ORT_BASE = new URL(`../../lab-models/match/vendor/ort-${ORT_VERSION}/`, import.meta.url).href;
const PDFJS_VERSION = "5.4.624";
const PDFJS_ROOT = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;
const PDFJS_BASE = `${PDFJS_ROOT}build/`;
const CACHE = "pt-lab-ocr-v2";
const OLD_CACHES = ["pt-lab-ocr-v1"];

let ort = null, det = null, rec = null, dict = null, backend = "", detMax = DET_MAX;
let ready = null;   // Promise of the init

// ---------- loading, cached ----------
async function cachedBytes(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* no Cache Storage: plain fetch */ }
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) { const buf = await hit.arrayBuffer(); onBytes(buf.byteLength, buf.byteLength); return buf; }
  }
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.byteLength;
      onBytes(got, total);
    }
    const all = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    buf = all.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  onBytes(buf.byteLength, buf.byteLength);
  if (cache) cache.put(url, new Response(buf.slice(0), { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return buf;
}

async function gpuOk() {
  try {
    const gpu = self.navigator && self.navigator.gpu;
    if (!gpu) return false;
    return !!(await gpu.requestAdapter());
  } catch { return false; }
}

async function init({ backend: want = "auto", models, detMax: dm } = {}) {
  const started = performance.now();
  // The 1.30.0 runtime's cache (#102 moved both workers to one version): free the phone's space.
  if (typeof caches !== "undefined") for (const name of OLD_CACHES) caches.delete(name).catch(() => {});
  if (dm) detMax = dm;
  const useGpu = want === "webgpu" || (want === "auto" && await gpuOk());
  ort = await import(`${ORT_BASE}${useGpu ? "ort.webgpu.min.mjs" : "ort.wasm.min.mjs"}`);
  ort.env.wasm.numThreads = 1;     // no cross-origin isolation, and one thread is kinder to a phone's battery
  ort.env.wasm.proxy = false;      // this is already a worker
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.logLevel = "error";
  // Sizes for the progress bar, close enough before the headers arrive.
  const wasmFile = useGpu ? "ort-wasm-simd-threaded.asyncify.wasm" : "ort-wasm-simd-threaded.wasm";
  const files = [
    { url: ORT_BASE + wasmFile, guess: useGpu ? 26.8e6 : 14.2e6 },
    { url: new URL("det.onnx", models).href, guess: 4.83e6 },
    { url: new URL("rec-en.onnx", models).href, guess: 7.85e6 },
    { url: new URL("dict-en.txt", models).href, guess: 1.4e3 },
  ];
  const got = files.map(() => 0), sizes = files.map((f) => f.guess);
  const tell = () => self.postMessage({ type: "load", pct: Math.min(0.99, got.reduce((a, b) => a + b, 0) / sizes.reduce((a, b) => a + b, 0)) });
  const bufs = await Promise.all(files.map((f, i) => cachedBytes(f.url, (n, total) => { got[i] = n; if (total) sizes[i] = total; tell(); })));
  ort.env.wasm.wasmBinary = bufs[0];
  dict = parseDict(new TextDecoder().decode(bufs[3]));
  const make = async (ep) => {
    const opts = { executionProviders: [ep], graphOptimizationLevel: "all", logSeverityLevel: 3 };   // errors only
    const d = await ort.InferenceSession.create(new Uint8Array(bufs[1]), opts);
    const r = await ort.InferenceSession.create(new Uint8Array(bufs[2]), opts);
    // A warm-up run: a WebGPU device that can't run these graphs fails here, not on Bryce's page.
    const t = new ort.Tensor("float32", new Float32Array(3 * 64 * 64), [1, 3, 64, 64]);
    await d.run({ [d.inputNames[0]]: t });
    const t2 = new ort.Tensor("float32", new Float32Array(3 * 48 * 320), [1, 3, 48, 320]);
    await r.run({ [r.inputNames[0]]: t2 });
    return [d, r];
  };
  if (useGpu) {
    try { [det, rec] = await make("webgpu"); backend = "webgpu"; }
    catch (e) { console.warn("WebGPU OCR didn't start, using WebAssembly", e); }
  }
  if (!det) { [det, rec] = await make("wasm"); backend = "wasm"; }
  return { loadMs: Math.round(performance.now() - started) };
}

// ---------- pictures to pixels ----------
const hasOffscreen = typeof OffscreenCanvas !== "undefined";
function pixelsFrom(source, sw, sh, edge, turns = 0) {
  const k = Math.min(1, edge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const quarter = ((turns % 4) + 4) % 4;
  const cw = quarter % 2 ? h : w, ch = quarter % 2 ? w : h;
  const cv = new OffscreenCanvas(cw, ch);
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cw, ch);
  cx.translate(cw / 2, ch / 2); cx.rotate((quarter * Math.PI) / 2);
  cx.drawImage(source, -w / 2, -h / 2, w, h);
  const id = cx.getImageData(0, 0, cw, ch);
  return { data: id.data, width: cw, height: ch };
}
async function imagePixels(msg) {
  if (msg.rgba) return { data: new Uint8ClampedArray(msg.rgba.data), width: msg.rgba.width, height: msg.rgba.height };
  if (!hasOffscreen) throw Object.assign(new Error("no OffscreenCanvas in this worker"), { code: "needs-pixels" });
  const bmp = msg.bitmap || await createImageBitmap(msg.blob);
  try { return pixelsFrom(bmp, bmp.width, bmp.height, msg.edge || 2400, msg.turns || 0); }
  finally { bmp.close && bmp.close(); }
}

// ---------- pdf.js, in this worker ----------
// pdf.js runs here with its parser in the same thread (its "fake worker"), and draws on
// OffscreenCanvas. Fonts are drawn as paths (disableFontFace), since a worker has no document.
let pdfjs = null;
class OffscreenCanvasFactory {
  constructor() { /* pdf.js passes { ownerDocument, enableHWA }; neither applies here */ }
  create(width, height) {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(cc, width, height) { cc.canvas.width = Math.max(1, width); cc.canvas.height = Math.max(1, height); }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null; }
}
// SVG filters need a document; without them, transfer maps and luminosity masks draw unfiltered.
class NoFilterFactory {
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  destroy() {}
}
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  if (!hasOffscreen || typeof Path2D === "undefined") throw new Error("no OffscreenCanvas or Path2D in this worker");
  const lib = await import(`${PDFJS_BASE}pdf.min.mjs`);
  globalThis.pdfjsWorker = await import(`${PDFJS_BASE}pdf.worker.min.mjs`);
  pdfjs = lib;
  return pdfjs;
}
async function renderPdfPage(doc, n, edge, turns = 0) {
  const page = await doc.getPage(n);
  try {
    const rotation = (page.rotate + 90 * (((turns % 4) + 4) % 4)) % 360;
    const base = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: Math.min(4, edge / Math.max(base.width, base.height)), rotation });
    const w = Math.round(viewport.width), h = Math.round(viewport.height);
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff"; context.fillRect(0, 0, w, h);
    await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
    return { data: context.getImageData(0, 0, w, h).data, width: w, height: h };
  } finally { page.cleanup(); }
}

// ---------- jobs ----------
async function readPixels(id, img, page) {
  return readPage(img, { ort, det, rec, dict, detMax, onProgress: (pct) => self.postMessage({ type: "progress", id, page, pct }) });
}
const slim = (r) => ({ text: r.text, words: r.words, width: r.width, height: r.height, ms: r.ms, boxes: r.boxes });

async function onImage(msg) {
  const img = await imagePixels(msg);
  const r = await readPixels(msg.id, img);
  self.postMessage({ type: "result", id: msg.id, result: { ...slim(r), backend } });
}
// The last PDF stays open, so a scan review asking for its pages one at a time parses it once.
let open = { key: "", doc: null };
async function pdfDoc(lib, msg) {
  if (msg.key && open.key === msg.key && open.doc) return open.doc;
  if (open.doc) { const d = open.doc; open = { key: "", doc: null }; await d.destroy().catch(() => {}); }
  const data = new Uint8Array(await msg.blob.arrayBuffer());
  const doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    CanvasFactory: OffscreenCanvasFactory, FilterFactory: NoFilterFactory, verbosity: 0,
    // No cMapUrl on purpose: with all three URLs set, pdf.js checks them against document.baseURI.
    standardFontDataUrl: `${PDFJS_ROOT}standard_fonts/`, wasmUrl: `${PDFJS_ROOT}wasm/` }).promise;
  open = { key: msg.key || "", doc };
  return doc;
}
async function onPdf(msg) {
  let lib;
  try { lib = await loadPdfjs(); }
  catch (e) { self.postMessage({ type: "render-unsupported", id: msg.id, page: msg.pages[0], reason: String(e && e.message || e) }); return; }
  const doc = await pdfDoc(lib, msg);
  try {
    for (const n of msg.pages) {
      self.postMessage({ type: "progress", id: msg.id, page: n, pct: 0 });
      let img;
      try { img = await renderPdfPage(doc, n, msg.edge || 2000, msg.turns || 0); }
      catch (e) { self.postMessage({ type: "render-unsupported", id: msg.id, page: n, reason: String(e && e.message || e) }); return; }
      const r = await readPixels(msg.id, img, n);
      img = null;
      self.postMessage({ type: "result", id: msg.id, page: n, result: { ...slim(r), backend } });
    }
    self.postMessage({ type: "done", id: msg.id });
  } finally {
    if (!msg.key) { open = { key: "", doc: null }; await doc.destroy().catch(() => {}); }
  }
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "init") {
    if (!ready) ready = init(msg);
    try {
      const { loadMs } = await ready;
      self.postMessage({ type: "ready", engine: "paddle", backend, loadMs });
    } catch (err) {
      ready = null;
      self.postMessage({ type: "failed", error: String((err && err.message) || err) });
    }
    return;
  }
  try {
    if (!ready) throw new Error("not started");
    await ready;
    if (msg.type === "image") await onImage(msg);
    else if (msg.type === "pdf") await onPdf(msg);
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, code: err && err.code, error: String((err && err.message) || err) });
  }
};
