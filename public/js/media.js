// media.js: files to pixels and back. pdf.js page renders, upright photo JPEGs, base64, and
// photos to one full-quality PDF for Drive. No DOM beyond throwaway canvases, no Firestore.
// Uses the classic-script globals pdfjsLib and jspdf that index.html loads before the modules.
// Owner: capture. Since the capture build (#83) it also has what the scan review needs, the web
// twins of the iPhone app's PageAssembler, TextRecognizer and DocumentBuilder:
//   pdfText(file)            the PDF's own text, one string per page (pdf.js text content)
//   ocr(blob, turns, { onProgress })  on-device OCR of a page picture (Tesseract.js, loaded the first
//                            time, one page at a time); onProgress(0..1) while it recognizes (lab, #92).
//                            tesseractOcr is the same function, named for the lab's fallback (#101)
//   renderPageRgba(doc, n, edge, turns)  one PDF page drawn at OCR size: its pixels and a lazy JPEG (lab, #101)
//   assemblePdf(pages)       one PDF from review pages: pictures with a hidden text layer (#22),
//                            imported PDF pages copied as they are (pdf-lib), turned pages turned
//   uprightJpeg, pageImage   upright page pictures at a given size, for thumbnails and the viewer
//   sha256Hex(blob)          the content hash (#2)
import { DriveError } from "./drive.js";
import { FAKE, params } from "./config.js";

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export const makeCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export const canvasBlob = (cv, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", q));
export function blobB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export async function openPdfDoc(file) {
  if (!window.pdfjsLib) throw new Error("pdf.js missing");
  return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
}
export async function renderPage(doc, n, edge, q, turns = 0) {
  const page = await doc.getPage(n);
  const rotation = (page.rotate + 90 * (turns % 4)) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const vp = page.getViewport({ scale: Math.min(4, edge / Math.max(base.width, base.height)), rotation });
  const cv = document.createElement("canvas");
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: cx, viewport: vp }).promise;
  page.cleanup();
  return canvasBlob(cv, q);
}
// One PDF page drawn for OCR (the lab's fallback when its worker can't draw PDFs, #101): the RGBA
// pixels, and the JPEG only if something asks for it.
export async function renderPageRgba(doc, n, edge, turns = 0) {
  const page = await doc.getPage(n);
  const rotation = (page.rotate + 90 * (turns % 4)) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const vp = page.getViewport({ scale: Math.min(4, edge / Math.max(base.width, base.height)), rotation });
  const cv = document.createElement("canvas");
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: cx, viewport: vp }).promise;
  page.cleanup();
  const { data } = cx.getImageData(0, 0, cv.width, cv.height);
  return { data, width: cv.width, height: cv.height, blob: () => canvasBlob(cv, 0.9) };
}
// A photo, upright (EXIF orientation applied), scaled so its long side is at most `edge`.
export async function photoJpeg(file, edge, q) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return canvasBlob(cv, q);
}

// ---------- photos to one PDF, at full quality ----------
// A JPEG that's already upright goes into the PDF byte for byte. Anything else (PNG, WebP, a JPEG
// whose EXIF says rotate) is redrawn upright at full size, capped near 16 megapixels because that's
// the largest canvas iPhone Safari allows, and saved at JPEG quality 0.92.
function jpegOrientation(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return -1;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o);
      if (m === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le); }
        return 1;
      }
      if (m === 0xffda || (m & 0xff00) !== 0xff00) return 1;
      o += 2 + v.getUint16(o + 2);
    }
    return 1;
  } catch { return -1; }
}
async function fullPage(file) {
  const buf = await file.arrayBuffer();
  if ((file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) && jpegOrientation(buf) === 1) return new Uint8Array(buf);
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, Math.sqrt(16_000_000 / (bmp.width * bmp.height)));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Uint8Array(await (await canvasBlob(cv, 0.92)).arrayBuffer());
}
export async function photosToPdf(files) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new DriveError("pdf");
  let pdf = null;
  for (const f of files) {
    const bytes = await fullPage(f);
    const p = new jsPDF().getImageProperties(bytes);
    const size = [612, Math.round((612 * p.height) / p.width)];  // letter width, the photo's own shape
    if (!pdf) pdf = new jsPDF({ unit: "pt", format: size, compress: true });
    else pdf.addPage(size);
    pdf.addImage(bytes, "JPEG", 0, 0, size[0], size[1]);
  }
  return pdf.output("blob");
}

// ---------- the capture build (#83): text, OCR, assembly, hashes ----------

// A picture drawn upright (EXIF applied, then `turns` quarter turns clockwise), its long side at most
// `edge` (no limit when edge is 0), on white. Returns the canvas; callers turn it into a JPEG.
async function drawUpright(blob, edge, turns = 0) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const t = ((turns % 4) + 4) % 4;
  const sw = bmp.width, sh = bmp.height;
  let k = edge ? Math.min(1, edge / Math.max(sw, sh)) : 1;
  k = Math.min(k, Math.sqrt(16_000_000 / (sw * sh)));      // iPhone Safari's largest canvas
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const cv = makeCanvas(t % 2 ? h : w, t % 2 ? w : h);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  cx.translate(cv.width / 2, cv.height / 2);
  cx.rotate((t * Math.PI) / 2);
  cx.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close?.();
  return cv;
}
// An upright JPEG of a picture (scanner page, photo, image file). edge 0 keeps the full size.
export async function uprightJpeg(blob, { edge = 0, turns = 0, q = 0.9 } = {}) {
  return canvasBlob(await drawUpright(blob, edge, turns), q);
}
// One review page as a JPEG at `edge` px on the long side: a picture page, or page `index` (0-based)
// of an imported PDF. `pdf` is the open pdf.js document for a PDF page (callers cache it).
export async function pageImage(page, edge, q = 0.85, pdf = null) {
  if (page.image) return uprightJpeg(page.image, { edge, turns: page.turns, q });
  const doc = pdf || await openPdfDoc(page.pdf);
  try { return await renderPage(doc, page.index + 1, edge, q, page.turns); }
  finally { if (!pdf) await doc.destroy(); }
}
export async function pdfPageCount(file) {
  const doc = await openPdfDoc(file);
  try { return doc.numPages; } finally { await doc.destroy(); }
}

// The PDF's own text, one string per page (empty for a scanned PDF with no text layer).
export async function pdfText(file, doc = null) {
  const d = doc || await openPdfDoc(file);
  try {
    const out = [];
    for (let n = 1; n <= d.numPages; n++) out.push(await pdfPageText(d, n));
    return out;
  } finally { if (!doc) await d.destroy(); }
}
export async function pdfPageText(doc, n) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let text = "";
  for (const it of content.items) { text += it.str || ""; text += it.hasEOL ? "\n" : " "; }
  page.cleanup();
  return text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

// ---------- OCR (the TextRecognizer twin) ----------
// Tesseract.js from cdnjs, loaded the first time a picture needs reading, with one worker kept for the
// session. Its WebAssembly core and the English data (about 7 MB the first time, then cached) come
// from jsDelivr. A failure reads as no text: the read then sends the pages instead (#75), and the
// split still has its thumbnails. On the fake backend nothing loads unless the page asks with ?ocr;
// tests put a stand-in on window.__PT_OCR__ (blob, turns) -> text.
const TESSERACT = { version: "5.1.1", core: "5.1.1" };
const OCR_EDGE = 2000;
let ocrWorker = null;
let ocrProgress = null;            // the page being read now gets Tesseract's progress
let ocrTurn = Promise.resolve();   // one page at a time, so progress belongs to one caller
function loadTesseract() {
  if (ocrWorker) return ocrWorker;
  ocrWorker = (async () => {
    if (!window.Tesseract) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = `https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/${TESSERACT.version}/tesseract.min.js`;
        s.crossOrigin = "anonymous"; s.async = true;
        s.onload = res; s.onerror = () => { s.remove(); rej(new Error("Couldn't load the text reader")); };
        document.head.append(s);
      });
    }
    return window.Tesseract.createWorker("eng", 1, {
      workerPath: `https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/${TESSERACT.version}/worker.min.js`,
      corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT.core}`,
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
      logger: (m) => { if (ocrProgress && m && m.status === "recognizing text") ocrProgress(Math.max(0, Math.min(1, Number(m.progress) || 0))); },
    });
  })();
  ocrWorker.catch(() => { ocrWorker = null; });
  return ocrWorker;
}
// Reads a page picture. Resolves { text, words: [{ text, x, y, w, h }] (in the upright picture's
// pixels), width, height }; never throws. The lab reads with PaddleOCR instead (lab/ocr.js, #101),
// which comes back here, to tesseractOcr, only when PaddleOCR can't load.
export function ocr(blob, turns = 0, { onProgress } = {}) {
  const run = ocrTurn.then(() => ocrOne(blob, turns, onProgress));
  ocrTurn = run.catch(() => {});
  return run;
}
export const tesseractOcr = ocr;
async function ocrOne(blob, turns, onProgress) {
  const empty = { text: "", words: [], width: 0, height: 0 };
  try {
    if (FAKE && typeof window.__PT_OCR__ === "function") {
      if (onProgress) onProgress(0.5);
      const text = String(await window.__PT_OCR__(blob, turns) || "");
      if (onProgress) onProgress(1);
      return { ...empty, text };
    }
    if (FAKE && !params.has("ocr")) return empty;
    const cv = await drawUpright(blob, OCR_EDGE, turns);
    const worker = await loadTesseract();
    ocrProgress = onProgress || null;
    const { data } = await worker.recognize(cv);
    const words = (data.words || []).filter((w) => w.text && w.confidence > 30)
      .map((w) => ({ text: w.text, x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 }));
    return { text: String(data.text || "").replace(/[ \t]+/g, " ").trim(), words, width: cv.width, height: cv.height };
  } catch (e) {
    console.warn("OCR didn't run", e);
    return empty;
  } finally {
    ocrProgress = null;
  }
}

// ---------- one PDF from review pages (the PageAssembler twin) ----------
// pages: [{ image: Blob, turns, words?, wordsWidth? } | { pdf: File, index, turns }]
// Pictures go in at full quality (an upright JPEG byte for byte), each on a letter-wide page of its
// own shape, with the OCR words drawn invisibly over it so Drive search and copy find the text
// (#22). Pages from an imported PDF are copied as they are (vector and text kept) with pdf-lib.
// The standard PDF fonts only carry Latin-1, so other characters in the hidden layer become "?".
const latin1 = (s) => String(s).replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
export async function assemblePdf(pages) {
  if (pages.some((p) => p.pdf)) return assembleWithPdfLib(pages);
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new DriveError("pdf");
  let pdf = null;
  for (const p of pages) {
    const bytes = p.turns % 4 ? new Uint8Array(await (await uprightJpeg(p.image, { turns: p.turns, q: 0.92 })).arrayBuffer()) : await fullPage(p.image);
    const props = new jsPDF().getImageProperties(bytes);
    const size = [612, Math.round((612 * props.height) / props.width)];
    if (!pdf) pdf = new jsPDF({ unit: "pt", format: size, compress: true });
    else pdf.addPage(size);
    pdf.addImage(bytes, "JPEG", 0, 0, size[0], size[1]);
    drawHiddenText(pdf, p, size[0]);
  }
  return pdf.output("blob");
}
function drawHiddenText(pdf, p, pageW) {
  if (!p.words || !p.words.length || !p.wordsWidth) return;
  const k = pageW / p.wordsWidth;
  pdf.setFont("helvetica", "normal");
  for (const w of p.words) {
    const size = Math.max(1, w.h * k);
    const text = latin1(w.text);
    pdf.setFontSize(size);
    const natural = pdf.getTextWidth(text) || 1;
    pdf.text(text, w.x * k, (w.y + w.h) * k, { renderingMode: "invisible", horizontalScale: Math.max(0.1, (w.w * k) / natural), baseline: "bottom" });
  }
}
let pdfLib = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLib) {
    pdfLib = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
      s.integrity = "sha512-z8IYLHO8bTgFqj+yrPyIJnzBDf7DDhWwiEsk4sY+Oe6J2M+WQequeGS7qioI5vT6rXgVRb4K1UVQC5ER7MKzKQ==";
      s.crossOrigin = "anonymous"; s.async = true;
      s.onload = () => res(window.PDFLib); s.onerror = () => { s.remove(); pdfLib = null; rej(new DriveError("pdf")); };
      document.head.append(s);
    });
  }
  return pdfLib;
}
async function assembleWithPdfLib(pages) {
  const { PDFDocument, StandardFonts, degrees } = await loadPdfLib();
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const sources = new Map();
  for (const p of pages) {
    if (p.pdf) {
      if (!sources.has(p.pdf)) sources.set(p.pdf, await PDFDocument.load(await p.pdf.arrayBuffer(), { ignoreEncryption: true }));
      const [copy] = await out.copyPages(sources.get(p.pdf), [p.index]);
      if (p.turns % 4) copy.setRotation(degrees((copy.getRotation().angle + 90 * p.turns) % 360));
      out.addPage(copy);
    } else {
      const bytes = p.turns % 4 ? new Uint8Array(await (await uprightJpeg(p.image, { turns: p.turns, q: 0.92 })).arrayBuffer()) : await fullPage(p.image);
      const img = await out.embedJpg(bytes);
      const w = 612, h = Math.round((612 * img.height) / img.width);
      const page = out.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      if (p.words && p.wordsWidth) {
        const k = w / p.wordsWidth;
        for (const word of p.words) {
          const size = Math.max(1, word.h * k);
          try { page.drawText(latin1(word.text), { x: word.x * k, y: h - (word.y + word.h) * k, size, font, opacity: 0 }); } catch { /* a glyph the font lacks */ }
        }
      }
    }
  }
  return new Blob([await out.save()], { type: "application/pdf" });
}

// SHA-256 hex of a blob's bytes: the content hash both apps store on a doc (#2).
export async function sha256Hex(blob) {
  const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
