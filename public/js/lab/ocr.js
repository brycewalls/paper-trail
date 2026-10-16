// lab/ocr.js: the lab's on-device OCR, from the page's side (#101, #98). No AI, no cloud: PaddleOCR's
// PP-OCRv5 mobile models read the page in a Web Worker (lab/ocr-worker.js), so the screen keeps
// scrolling while a stack reads. If PaddleOCR can't load (no module workers, the models or the
// runtime didn't download, the session didn't start), the lab falls back to Tesseract.js
// (media.tesseractOcr), as before, until the page reloads.
//
//   ocrImage(blob, turns, { onProgress })     a photo or scan; resolves { text, words, width, height, engine }
//   ocrPdfPages(pdf, pageNumbers, { doc, turns, onProgress, onPage })
//                                             renders and reads those pages of a PDF in the worker;
//                                             resolves Map(page -> result). `doc` (a pdf.js document
//                                             already open on the page) is only used when the
//                                             worker can't render: then the page draws each page at
//                                             OCR size and hands the worker the pixels.
//   ocrStatus()                               { engine: "paddle"|"tesseract"|"", backend, loadMs, error }
//   onProgress gets { pct } while reading and { loading: pct } the first time the models download.
// One page at a time, in order. Nothing here throws: a page that can't be read reads as "".
// The worker closes after two idle minutes to give its memory back; the next page restarts it from
// the cache. On the fake backend nothing loads unless the page asks with ?ocr, and tests can stand
// in with window.__PT_OCR__ (blob, turns) -> text, as media.ocr allows.
// URL overrides for testing: ?ocrEngine=tesseract, ?ocrBackend=wasm|webgpu.
// Owner: lab OCR.
import { FAKE, params } from "../config.js";
import { tesseractOcr, renderPageRgba } from "../media.js";

// The picture's long side for OCR. The detector sees it at lab/ppocr.js DET_MAX; the lines are cut
// from this size, so small print in a photo stays readable. A PDF page is drawn a little smaller.
export const IMAGE_EDGE = 2400, PDF_EDGE = 2000;
const MODELS = new URL("../../lab-models/pp-ocrv5-mobile/", import.meta.url).href;
const IDLE_MS = 120000, PAGE_TIMEOUT_MS = 120000, LOAD_STALL_MS = 60000;
const empty = () => ({ text: "", words: [], width: 0, height: 0, engine: "" });

let worker = null, starting = null, idleTimer = null, nextId = 1;
let paddleBroken = params.get("ocrEngine") === "tesseract";
let status = { engine: paddleBroken ? "tesseract" : "", backend: "", loadMs: 0, error: paddleBroken ? "?ocrEngine=tesseract" : "" };
const jobs = new Map();
let turn = Promise.resolve();

export const ocrStatus = () => ({ ...status });

function serial(fn) {
  const run = turn.then(fn, fn);
  turn = run.catch(() => {});
  return run;
}
function standIn() {
  if (FAKE && typeof window.__PT_OCR__ === "function") return "hook";
  if (FAKE && !params.has("ocr")) return "none";
  return "";
}

// ---------- the worker ----------
function stopWorker(reason) {
  clearTimeout(idleTimer);
  if (worker) { try { worker.terminate(); } catch { /* gone */ } }
  worker = null; starting = null;
  for (const [id, job] of jobs) { jobs.delete(id); job.fail(new Error(reason || "OCR stopped")); }
}
function idle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!jobs.size) stopWorker("idle"); }, IDLE_MS);
}
// Resolves the worker once its models are loaded; rejects (and marks PaddleOCR broken) when it can't.
function startWorker(onLoad) {
  if (paddleBroken) return Promise.reject(new Error(status.error || "PaddleOCR is off"));
  if (starting) { if (onLoad) loadListeners.add(onLoad); return starting; }
  if (onLoad) loadListeners.add(onLoad);
  starting = new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL("./ocr-worker.js", import.meta.url), { type: "module" }); }
    catch (e) { reject(e); return; }
    worker = w;
    // A download that stalls for a minute counts as PaddleOCR not loading.
    let stall = null;
    const watch = () => { clearTimeout(stall); stall = setTimeout(() => { loadListeners.clear(); reject(new Error("the OCR models stopped downloading")); }, LOAD_STALL_MS); };
    watch();
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "load") { watch(); for (const f of loadListeners) f(m.pct); return; }
      if (m.type === "ready") {
        clearTimeout(stall);
        status = { engine: "paddle", backend: m.backend, loadMs: m.loadMs, error: "" };
        loadListeners.clear();
        resolve(w);
        return;
      }
      if (m.type === "failed") { clearTimeout(stall); loadListeners.clear(); reject(new Error(m.error)); return; }
      const job = jobs.get(m.id);
      if (job) job.on(m);
    };
    w.onerror = (e) => {   // the module didn't load, or the worker died
      if (e && e.preventDefault) e.preventDefault();
      const err = new Error((e && e.message) || "the OCR worker stopped");
      clearTimeout(stall);
      loadListeners.clear();
      reject(err);
      if (worker === w) stopWorker(err.message);
    };
    w.postMessage({ type: "init", backend: params.get("ocrBackend") || "auto", models: MODELS });
  });
  starting.catch((e) => {
    paddleBroken = true;
    status = { engine: "tesseract", backend: "", loadMs: 0, error: String(e && e.message || e) };
    console.warn("PaddleOCR didn't load; using Tesseract", e);
    stopWorker("PaddleOCR didn't load");
  });
  return starting;
}
const loadListeners = new Set();

// One request to the worker; `on` sees every message for it until it settles.
function ask(msg, on, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    let timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (jobs.delete(id)) { reject(new Error("OCR took too long")); stopWorker("timeout"); } }, PAGE_TIMEOUT_MS); };
    const settle = (fn, v) => { clearTimeout(timer); jobs.delete(id); fn(v); idle(); };
    jobs.set(id, {
      on: (m) => { arm(); on(m, (v) => settle(resolve, v), (e) => settle(reject, e)); },
      fail: (e) => settle(reject, e),
    });
    arm();
    worker.postMessage({ ...msg, id }, transfer);
  });
}

// ---------- one picture ----------
export function ocrImage(blob, turns = 0, { onProgress } = {}) {
  return serial(() => ocrImageNow(blob, turns, onProgress));
}
async function ocrImageNow(blob, turns, onProgress = () => {}) {
  const fake = standIn();
  if (fake === "hook") { onProgress({ pct: 0.5 }); const text = String(await window.__PT_OCR__(blob, turns) || ""); onProgress({ pct: 1 }); return { ...empty(), text, engine: "stand-in" }; }
  if (fake === "none") return empty();
  try {
    await startWorker((pct) => onProgress({ loading: pct }));
    const result = await ask({ type: "image", blob, turns, edge: IMAGE_EDGE }, (m, ok, no) => {
      if (m.type === "progress") onProgress({ pct: m.pct });
      else if (m.type === "result") ok(m.result);
      else if (m.type === "error") no(Object.assign(new Error(m.error), { code: m.code }));
    });
    return { ...result, engine: "paddle" };
  } catch (e) {
    if (!paddleBroken) console.warn("PaddleOCR didn't read the picture", e);
    return tesseract(blob, turns, onProgress);
  }
}
async function tesseract(blob, turns, onProgress) {
  const r = await tesseractOcr(blob, turns, { onProgress: (pct) => onProgress({ pct }) });
  return { ...r, engine: r.text ? "tesseract" : "" };
}

// ---------- pages of a PDF ----------
export function ocrPdfPages(pdf, pages, opts = {}) {
  return serial(() => ocrPdfNow(pdf, pages, opts));
}
async function ocrPdfNow(pdf, pages, { doc = null, turns = 0, onProgress = () => {}, onPage = () => {} } = {}) {
  const out = new Map();
  if (!pages.length) return out;
  const fake = standIn();
  if (fake === "none") { for (const n of pages) out.set(n, empty()); return out; }
  let left = pages.slice();
  const done = (n, r) => { out.set(n, r); onPage(n, r); left = left.filter((p) => p !== n); };
  if (fake !== "hook") {
    try {
      await startWorker((pct) => onProgress({ page: pages[0], loading: pct }));
      await ask({ type: "pdf", blob: pdf, key: pdfKey(pdf), pages, turns, edge: PDF_EDGE }, (m, ok, no) => {
        if (m.type === "progress") onProgress({ page: m.page, pct: m.pct });
        else if (m.type === "result") done(m.page, { ...m.result, engine: "paddle" });
        else if (m.type === "done") ok();
        else if (m.type === "render-unsupported") { console.info("The OCR worker can't draw this PDF; the page draws it", m.reason); ok(); }
        else if (m.type === "error") no(new Error(m.error));
      });
    } catch (e) {
      if (!paddleBroken) console.warn("PaddleOCR didn't read the PDF", e);
    }
  }
  // Whatever the worker didn't read: draw it here, one page at a time, and read the pixels.
  for (const n of left.slice()) {
    onProgress({ page: n, pct: 0 });
    await yieldToBrowser();
    const r = await readDrawnPage(doc, n, turns, (p) => onProgress({ page: n, ...p }));
    done(n, r);
  }
  return out;
}
async function readDrawnPage(doc, n, turns, onProgress) {
  const fake = standIn();
  try {
    if (!doc) throw new Error("no document to draw from");
    const pic = await renderPageRgba(doc, n, PDF_EDGE, turns);
    if (fake === "hook") return ocrImageNow(await pic.blob(), 0, onProgress);
    if (!paddleBroken) {
      try {
        await startWorker((pct) => onProgress({ loading: pct }));
        const result = await ask({ type: "image", rgba: { data: pic.data.buffer, width: pic.width, height: pic.height } }, (m, ok, no) => {
          if (m.type === "progress") onProgress({ pct: m.pct });
          else if (m.type === "result") ok(m.result);
          else if (m.type === "error") no(new Error(m.error));
        }, [pic.data.buffer]);
        return { ...result, engine: "paddle" };
      } catch (e) { if (!paddleBroken) console.warn("PaddleOCR didn't read the page", e); }
    }
    return tesseract(await pic.blob(), 0, onProgress);
  } catch (e) {
    console.warn("OCR didn't read the page", e);
    return empty();
  }
}

// The same file asked for again (a review reads its pages one by one) keeps its document open in the
// worker, keyed by the Blob object itself.
const keys = new WeakMap();
let nextKey = 1;
function pdfKey(pdf) {
  if (!pdf || typeof pdf !== "object") return "";
  if (!keys.has(pdf)) keys.set(pdf, `pdf-${nextKey++}`);
  return keys.get(pdf);
}

// Lets the browser paint and handle a scroll between pages.
export function yieldToBrowser() {
  if (typeof scheduler !== "undefined" && scheduler.yield) return scheduler.yield();
  return new Promise((r) => setTimeout(r, 0));
}
