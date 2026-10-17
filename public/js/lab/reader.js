// lab/reader.js: the lab build's reader (#92). No Claude, no cloud ML: the text comes from the PDF's
// own text layer (pdf.js) or on-device OCR (lab/ocr.js: PaddleOCR's small PP-OCRv5 models in a Web
// Worker, Tesseract.js if those can't load, #101), and the rules engine (lab/engine.js, in its own
// worker) turns it into the same card the classify function returns. classify.js calls it in place
// of the classify callable. The page only waits on pdf.js's text layer; OCR, drawing scanned pages
// and the rules all run off the main thread, and the reader yields between pages (#98).
//
//   READER                 "rules" on the lab site (LAB, config.js: paper-trail-lab.web.app, or
//                          localhost with ?lab), "claude" everywhere else, so the live app's reader
//                          never changes. On the fake backend ?reader=claude also keeps the Claude path
//   readText(input, onProgress)   one string per page, and where it came from
//   labRead(input, { senderRules, onProgress })   text, then the rules, then the matcher;
//                          { result, match, text, ms }
//   localSplit(pages)      stack mode without Claude: a document starts at "Page 1" (or after "Page n
//                          of n"), the same rule the fake split uses
//   progressCopy(p)        the card's progress line
//
// input: { textPages?, textSource?, ocrText?, pdf?: Blob, photos?: [Blob], pages, name }. Text the
// scan review already read (textPages) is used as is; otherwise a PDF's text layer is read page by
// page, then the pages with almost no text of their own are OCR'd one at a time, and photos are OCR'd.
// The rules run in a module Web Worker (lab/rules-worker.js); if it can't start, on the main thread.
// Then the on-device matcher (lab/match/matcher.js, #102), in its own worker, adds its say: sender
// rules first, then the rules where they are sure, then the matcher. Its worker and model start
// loading once the read's text is ready, not before, so OCR has the memory and the network first.
// Owner: lab reader.
import { FAKE, LAB, params } from "../config.js";
import { openPdfDoc, pdfPageText } from "../media.js";
import { runRules } from "./engine.js";
import { ocrImage, ocrPdfPages, yieldToBrowser } from "./ocr.js";
import { prepareMatcher, matchRead } from "./match/matcher.js";

export const READER = LAB && !(FAKE && params.get("reader") === "claude") ? "rules" : "claude";
export const PAGE_MIN_CHARS = 40;      // a page with less text of its own than this is OCR'd
export const MAX_TEXT_PAGES = 20;      // pages read for text; the rest of a long PDF isn't needed to route it
const squeeze = (t) => String(t || "").replace(/\s+/g, "").length;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// "Reading page 2 of 3", "Reading page 2 of 3 with OCR, 40%", "Sorting it with the rules", and the
// first time, "Getting the text reader ready, 40%" while the OCR models download.
export function progressCopy(p) {
  if (!p) return "";
  if (p.stage === "rules") return "Sorting it with the rules";
  if (p.stage === "ocr" && typeof p.loading === "number") return `Getting the text reader ready, ${Math.round(p.loading * 100)}%`;
  if (p.stage === "match") return "Checking it against your filed documents";
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
    const n = Math.min(input.photos.length, MAX_TEXT_PAGES);
    for (let i = 0; i < n; i++) {
      onProgress({ stage: "ocr", page: i + 1, pages: n, pct: 0 });
      const r = await ocrImage(input.photos[i], 0, { onProgress: (p) => onProgress({ stage: "ocr", page: i + 1, pages: n, ...p }) });
      pages.push(r.text);
      await yieldToBrowser();
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
    // The text layer first (pdf.js parses in its own worker), a page at a time.
    for (let i = 1; i <= n; i++) {
      onProgress({ stage: "text", page: i, pages: n });
      pages.push(await pdfPageText(doc, i).catch(() => ""));
      await yieldToBrowser();
    }
    // Then OCR for the pages with almost no text of their own, drawn and read in the OCR worker.
    const need = [];
    for (let i = 1; i <= n; i++) if (squeeze(pages[i - 1]) < PAGE_MIN_CHARS) need.push(i);
    const read = await ocrPdfPages(pdf, need, { doc, onProgress: (p) => onProgress({ stage: "ocr", pages: n, ...p, page: p.page || need[0] }) });
    for (const [i, r] of read) {
      if (squeeze(r.text) > squeeze(pages[i - 1])) { pages[i - 1] = r.text; ocrPages++; }
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
  // The matcher's worker and model start only once the text is ready, so they don't compete with
  // OCR for memory and the network while a page is read (#102). From the phone's cache the model
  // loads in a second or two, inside the wait matchRead allows.
  if (text.pages.some(squeeze)) prepareMatcher();
  onProgress({ stage: "rules" });
  const meta = { name: String(input.name || ""), pages: input.pages || text.pages.length, textSource: text.source, senderRules: JSON.parse(JSON.stringify(senderRules || [])), today: today() };
  let result = await rulesOffThread(text.pages, meta);
  let match = null;
  if (text.pages.some(squeeze)) {
    onProgress({ stage: "match" });
    const m = await matchRead(text.pages, meta, result);
    if (m && m.card) {
      result = m.card;
      match = { decidedBy: m.decidedBy, vector: m.vector, ms: m.ms, model: m.model, neighbors: m.neighbors || [],
        sender: (m.card.match && m.card.match.sender) || null, type: (m.card.match && m.card.match.type) || null };
    }
  }
  return { result, match, text: { source: text.source, chars: text.pages.reduce((n, t) => n + squeeze(t), 0), pages: text.pages.length, ocrPages: text.ocrPages }, ms: Math.round(performance.now() - started) };
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
