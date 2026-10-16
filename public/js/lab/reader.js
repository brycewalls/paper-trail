// lab/reader.js: the lab build's reader (#92). No Claude, no other model, no cloud ML: the text comes
// from the PDF's own text layer (pdf.js) or on-device OCR (Tesseract.js, media.ocr, loaded the first
// time a page has no text), and the rules engine (lab/engine.js) turns it into the same card the
// classify function returns. classify.js calls it in place of the classify callable.
//
//   READER                 "rules" (the lab), or "claude" on the fake backend with ?reader=claude so
//                          the deck, outbox and browse tests keep their Claude stand-in answers
//   readText(input, onProgress)   one string per page, and where it came from
//   labRead(input, { senderRules, onProgress })   text, then the rules; { result, text, ms }
//   localSplit(pages)      stack mode without Claude: a document starts at "Page 1" (or after "Page n
//                          of n"), the same rule the fake split uses
//   progressCopy(p)        the card's progress line
//
// input: { textPages?, textSource?, ocrText?, pdf?: Blob, photos?: [Blob], pages, name }. Text the
// scan review already read (textPages) is used as is; otherwise a PDF is read page by page and any
// page with almost no text of its own is OCR'd, and photos are OCR'd.
// The rules run in a module Web Worker (lab/rules-worker.js); if it can't start, on the main thread.
// Owner: lab reader.
import { FAKE, params } from "../config.js";
import { openPdfDoc, pdfPageText, renderPage, ocr } from "../media.js";
import { runRules } from "./engine.js";

export const READER = FAKE && params.get("reader") === "claude" ? "claude" : "rules";
export const PAGE_MIN_CHARS = 40;      // a page with less text of its own than this is OCR'd
export const MAX_TEXT_PAGES = 20;      // pages read for text; the rest of a long PDF isn't needed to route it
const OCR_EDGE = 2000;
const squeeze = (t) => String(t || "").replace(/\s+/g, "").length;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// "Reading page 2 of 3", "Reading page 2 of 3 with OCR, 40%", "Sorting it with the rules".
export function progressCopy(p) {
  if (!p) return "";
  if (p.stage === "rules") return "Sorting it with the rules";
  const of = p.pages > 1 ? `Reading page ${p.page} of ${p.pages}` : "Reading the page";
  if (p.stage === "ocr") return `${of} with OCR${typeof p.pct === "number" ? `, ${Math.round(p.pct * 100)}%` : ""}`;
  return of;
}

// ---------- text ----------
export async function readText(input = {}, onProgress = () => {}) {
  if (Array.isArray(input.textPages) && input.textPages.some((t) => squeeze(t))) {
    const pages = input.textPages.map((t) => String(t || ""));
    return { pages, source: input.textSource || "text", ocrPages: input.textSource === "ocr" ? pages.length : 0 };
  }
  if (input.pdf) return readPdf(input.pdf, onProgress);
  if (input.photos && input.photos.length) {
    const pages = [];
    for (let i = 0; i < Math.min(input.photos.length, MAX_TEXT_PAGES); i++) {
      onProgress({ stage: "ocr", page: i + 1, pages: input.photos.length, pct: 0 });
      const r = await ocr(input.photos[i], 0, { onProgress: (pct) => onProgress({ stage: "ocr", page: i + 1, pages: input.photos.length, pct }) });
      pages.push(r.text);
    }
    return { pages, source: pages.some(squeeze) ? "ocr" : "none", ocrPages: pages.length };
  }
  // Only the review's joined text (an item saved before textPages existed).
  const joined = String(input.ocrText || "");
  return { pages: joined ? [joined] : [], source: joined ? "text" : "none", ocrPages: 0 };
}
async function readPdf(pdf, onProgress) {
  const doc = await openPdfDoc(pdf);
  try {
    const n = Math.min(doc.numPages, MAX_TEXT_PAGES);
    const pages = [];
    let ocrPages = 0;
    for (let i = 1; i <= n; i++) {
      onProgress({ stage: "text", page: i, pages: n });
      let text = await pdfPageText(doc, i).catch(() => "");
      if (squeeze(text) < PAGE_MIN_CHARS) {
        onProgress({ stage: "ocr", page: i, pages: n, pct: 0 });
        const pic = await renderPage(doc, i, OCR_EDGE, 0.9).catch(() => null);
        const r = pic ? await ocr(pic, 0, { onProgress: (pct) => onProgress({ stage: "ocr", page: i, pages: n, pct }) }) : { text: "" };
        if (squeeze(r.text) > squeeze(text)) { text = r.text; ocrPages++; }
      }
      pages.push(text);
    }
    const source = !pages.some(squeeze) ? "none" : ocrPages === 0 ? "text" : ocrPages === pages.length ? "ocr" : "mixed";
    return { pages, source, ocrPages };
  } finally {
    await doc.destroy();
  }
}

// ---------- the rules, in a worker when it can ----------
let worker = null, workerOk = true, nextId = 1;
const waiting = new Map();
function rulesWorker() {
  if (!workerOk || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./rules-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const job = waiting.get(e.data && e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.ok) job.resolve(e.data.result); else job.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {   // the module didn't load: the page runs the rules from now on
      if (e && e.preventDefault) e.preventDefault();
      giveUpOnWorker();
    };
  } catch { giveUpOnWorker(); }
  return worker;
}
function giveUpOnWorker() {
  workerOk = false;
  if (worker) { try { worker.terminate(); } catch { /* gone */ } }
  worker = null;
  for (const [id, job] of waiting) { waiting.delete(id); job.fallback(); }
}
export const rulesWhere = () => (workerOk && worker ? "worker" : "page");
function rulesOffThread(textPages, meta) {
  const w = rulesWorker();
  const inPage = () => runRules(textPages, meta);
  if (!w) return inPage();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const fallback = () => inPage().then(resolve, reject);
    const timer = setTimeout(() => { if (waiting.delete(id)) fallback(); }, 15000);
    waiting.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); }, fallback: () => { clearTimeout(timer); fallback(); } });
    try { w.postMessage({ id, textPages, meta }); } catch { waiting.delete(id); clearTimeout(timer); fallback(); }
  });
}

// ---------- one read ----------
export async function labRead(input = {}, { senderRules = [], onProgress = () => {} } = {}) {
  const started = performance.now();
  const text = await readText(input, onProgress);
  onProgress({ stage: "rules" });
  const meta = { name: String(input.name || ""), pages: input.pages || text.pages.length, textSource: text.source, senderRules: JSON.parse(JSON.stringify(senderRules || [])), today: today() };
  const result = await rulesOffThread(text.pages, meta);
  return { result, text: { source: text.source, chars: text.pages.reduce((n, t) => n + squeeze(t), 0), pages: text.pages.length, ocrPages: text.ocrPages }, ms: Math.round(performance.now() - started) };
}

// ---------- stack mode without Claude ----------
// pages: [{ text }]. Resolves [{ start, end, label }] covering every page once, in order.
const PAGE_ONE = /\bpage\s*1\b(?!\d)|\b1\s+of\s+\d+\b/i;
const LAST_PAGE = /\bpage\s*(\d+)\s*of\s*(\d+)\b/i;
export function localSplit(pages) {
  const starts = [];
  pages.forEach((p, i) => {
    const t = String(p.text || "");
    const prev = i ? String(pages[i - 1].text || "") : "";
    const m = prev.match(LAST_PAGE);
    const prevWasLast = m && m[1] === m[2];
    if (i === 0 || PAGE_ONE.test(t) || prevWasLast) starts.push(i);
  });
  return starts.map((s, k) => ({ start: s, end: (starts[k + 1] ?? pages.length) - 1,
    label: String(pages[s].text || "").trim().split(/\s+/).slice(0, 4).join(" ").slice(0, 60) }));
}
