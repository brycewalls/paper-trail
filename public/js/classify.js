// classify.js: the client side of the `classify` callable, the web twin of the iPhone app's
// ClassifyPayload, ReadingQueue, SenderRuleEngine and CardConfidence (ios/PaperTrail/Features/
// Classify, docs/web-contract.md "classify.js"). Request and response shapes match functions/lib.js.
//
//   buildPayload(item, pdf)   what Claude sees for one document (#75): with at least 120 characters
//                             of OCR or PDF text, that text plus ONE 1000 px picture of page 1
//                             (ocrPrimary); otherwise the PDF whole (up to 10 pages and about 9 MB)
//                             or its first 10 pages at 1568 px. Always wantConfidence and the
//                             sender rules as senderHints.
//   readItem(item, { pdf })   the reading queue: at most two reads at once, and after a quiet spell
//                             (no answer in 4 minutes, so Claude's prompt cache is cold) the first
//                             read goes alone. Retries rate limits, timeouts and garbled answers
//                             twice (2 s, 8 s). Sets item.stage, card, unsureFields, readErrorCode.
//   normalize, unsureFields, isConfident, UNSURE_BELOW, FIELD_ORDER: the card and its confidence (#20)
//   applySenderRule, renderFilename, patternFromFilename, ruleFromCard: sender rules (#21), the twin
//                             of functions/lib.js and SenderRuleEngine (same cases, same answers)
//   proposeSplit(pages)       stack mode (#19): where each document in a scanned pile starts
//   readError, readCode, readErrorCode, READ_COPY: failures as copy
//   markConfident(card, fields): fields the person confirmed count as sure
//   classifyItem(item)        the legacy deck's read (session items), on the same payload rules
//
// The lab build (#92, branch exp/no-ai): READER is "rules" (lab/reader.js), so readItem, classifyItem
// and proposeSplit read with the PDF text layer or on-device OCR and the rules engine, never the
// classify callable. Each lab read emits "lab:read" { item, source }; lab/compare.js then asks the
// classify callable the same question the live app asks (claudeRead), only when compare mode is on,
// only to measure the rules. On the fake backend ?reader=claude keeps the old Claude path for the
// deck, outbox and browse tests.
// Owner: deck (capture owns proposeSplit); built in the capture PR with the reading queue (#83).
import { FOLDER_NAMES, VERDICT, PDF_MAX_PAGES, PDF_MAX_BYTES, READ_PAGES, READ_EDGE, READERS, DENIED } from "./config.js";
import { slug, cleanName, errCode, emit } from "./ui.js";
import { B } from "./backend.js";
import { blobB64, openPdfDoc, renderPage, photoJpeg } from "./media.js";
import { READER, labRead, localSplit, progressCopy } from "./lab/reader.js";

// ---------- payload rules (ClassifyPayload) ----------
export const OCR_MIN_CHARS = 120;      // less text than this (whitespace squeezed out) can't carry a read
export const OCR_MAX_CHARS = 20_000;
const PREVIEW_EDGE = 1000, PREVIEW_Q = 0.8, PAGE_Q = 0.85;
const MAX_BASE64 = 22 * 1024 * 1024;  // the function takes 24 MB; stay well under it

export const hasEnoughText = (t) => String(t || "").replace(/\s+/g, "").length >= OCR_MIN_CHARS;

// item: { pages, ocrText }; pdf: the Blob or File Drive gets. Throws { details: { code } } for
// too_large and bad_request, like the function, so readError() gives the same copy.
export async function buildPayload(item, pdf) {
  if (!pdf) throw { details: { code: "bad_request" } };
  const ocr = String(item.ocrText || "").trim().slice(0, OCR_MAX_CHARS);
  const pages = Math.max(1, item.pages || 1);
  const extras = { wantConfidence: true };
  const hints = senderRules();
  if (hints.length) extras.senderHints = hints.map(hintOf);
  if (ocr) extras.ocrText = ocr;
  let doc = null;
  try {
    if (ocr && hasEnoughText(ocr)) {
      doc = await openPdf(pdf);
      const jpeg = await renderPage(doc, 1, PREVIEW_EDGE, PREVIEW_Q);
      return { kind: "images", images: [{ type: "image/jpeg", data: await blobB64(jpeg) }], totalPages: Math.max(pages, doc.numPages), ...extras, ocrPrimary: true };
    }
    if (pages <= PDF_MAX_PAGES && pdf.size <= PDF_MAX_BYTES) return { kind: "pdf", pdf: await blobB64(pdf), totalPages: pages, ...extras };
    doc = await openPdf(pdf);
    const images = [];
    let total = 0;
    for (let n = 1; n <= Math.min(doc.numPages, READ_PAGES); n++) {
      const data = await blobB64(await renderPage(doc, n, READ_EDGE, PAGE_Q));
      total += data.length;
      images.push({ type: "image/jpeg", data });
    }
    if (!images.length) throw { details: { code: "bad_request" } };
    if (total > MAX_BASE64) throw { details: { code: "too_large" } };
    return { kind: "images", images, totalPages: Math.max(pages, doc.numPages), ...extras };
  } finally {
    if (doc) await doc.destroy();
  }
}
async function openPdf(pdf) {
  try { return await openPdfDoc(pdf); } catch { throw { details: { code: "bad_request" } }; }
}
// What goes to the function for one rule: the fields it reads (functions/lib.js cleanSenderHints).
const hintOf = (r) => Object.fromEntries(Object.entries({ key: r.key, issuer: r.issuer, folder: r.folder, verdict: r.verdict, docType: r.docType, filenamePattern: r.filenamePattern })
  .filter(([, v]) => v !== undefined && v !== null && v !== ""));

// ---------- sender rules (#21) ----------
// The live list comes from senders.js (users/{uid}/senders), which calls setSenderRules on every change.
let rules = [];
export function setSenderRules(list) { rules = Array.isArray(list) ? list.filter((r) => r && r.key && r.issuer) : []; }
export const senderRules = () => rules;

export const FILENAME_TOKENS = ["{date}", "{yyyy}", "{mm}", "{issuer}", "{type}"];
// {date} is the docDate (0000-00-00 when there is none), {yyyy} and {mm} its parts, {issuer} and
// {type} the slugs of the sender and document type.
export function renderFilename(pattern, card) {
  const date = card.docDate || "0000-00-00";
  const out = String(pattern)
    .replace(/\{date\}/g, date)
    .replace(/\{yyyy\}/g, date.slice(0, 4))
    .replace(/\{mm\}/g, date.slice(5, 7))
    .replace(/\{issuer\}/g, slug(card.issuer))
    .replace(/\{type\}/g, slug(card.docType));
  return cleanName(out).slice(0, 120);
}
// The rule whose key is the card's sender slug sets the sender's spelling, then its folder, verdict,
// document type and filename pattern, each only if the rule has one. Fields it set are certain.
export function applySenderRule(card, list = rules) {
  const key = slug(card.issuer);
  const rule = key === "unknown" ? null : (list || []).find((r) => r.key === key);
  if (!rule) return card;
  const out = { ...card, issuer: rule.issuer, appliedRule: rule.key };
  const set = ["issuer"];
  if (rule.folder && FOLDER_NAMES.includes(rule.folder)) { out.folder = rule.folder; set.push("folder"); }
  if (rule.verdict && VERDICT[rule.verdict]) { out.verdict = rule.verdict; set.push("verdict"); }
  if (rule.docType && String(rule.docType).trim()) out.docType = String(rule.docType).trim();
  if (rule.filenamePattern) {
    const name = renderFilename(rule.filenamePattern, out);
    if (name) { out.filename = name; set.push("filename"); }
  }
  if (out.paperless && slug(out.paperless.issuer) === rule.key) out.paperless = { ...out.paperless, issuer: rule.issuer };
  if (out.confidence) {
    const fields = { ...out.confidence.fields };
    for (const f of set) fields[f] = 1;
    out.confidence = { ...out.confidence, fields, overall: lowestScore(fields) };
  }
  if (out.alternatives) {
    out.alternatives = { ...out.alternatives };
    for (const f of set) if (out.alternatives[f]) out.alternatives[f] = [];
  }
  return out;
}
// A confirmed filename's docDate becomes {date}, so next month's bill gets next month's date.
export function patternFromFilename(filename, docDate) {
  const name = cleanName(filename);
  return docDate && name.includes(docDate) ? name.split(docDate).join("{date}") : name;
}
// The rule a confirmed card implies ("Remember for this sender").
export function ruleFromCard(card, now = new Date()) {
  const r = { key: slug(card.issuer), issuer: card.issuer, folder: card.folder, filenamePattern: patternFromFilename(card.filename, card.docDate), verdict: card.verdict, updatedAt: now.toISOString() };
  if (card.docType) r.docType = card.docType;
  return r;
}
// "02 Taxes" shows as "Taxes" (spec 3.1).
export const folderName = (f) => String(f || "").replace(/^\d+\s+/, "");

// ---------- confidence (#20) ----------
export const UNSURE_BELOW = 0.75;
// The check-fields sheet's order: sender, date, folder, title, filename, verdict.
export const FIELD_ORDER = ["issuer", "docDate", "folder", "title", "filename", "verdict"];
// A field the function didn't list counts as sure (#75, sparse).
const score = (fields, f) => (fields && typeof fields[f] === "number" ? fields[f] : 1);
const lowestScore = (fields) => Math.min(...FIELD_ORDER.map((f) => score(fields, f)));
export function unsureFields(card) {
  const c = card && card.confidence;
  return c ? FIELD_ORDER.filter((f) => score(c.fields, f) < UNSURE_BELOW) : [];
}
// Ready to file without a look: confidence came back and nothing is "Not sure". No data, never confident.
export const isConfident = (card) => !!(card && card.confidence) && unsureFields(card).length === 0;
// The user confirmed or edited these fields (the check-fields sheet, the card detail): they count as
// sure from now on, with no other guesses.
export function markConfident(card, fields) {
  if (!fields.length) return card;
  const conf = { overall: 0, sparse: true, ...(card.confidence || {}), fields: { ...(card.confidence?.fields || {}) } };
  for (const k of fields) conf.fields[k] = 1;
  conf.overall = lowestScore(conf.fields);
  const out = { ...card, confidence: conf };
  if (card.alternatives) { out.alternatives = { ...card.alternatives }; for (const k of fields) delete out.alternatives[k]; }
  return out;
}

// ---------- the reply ----------
const ALT_FIELDS = ["issuer", "docDate", "folder", "title", "filename"];
// The function normalizes too; this keeps the page safe from anything odd that comes back.
export function normalize(r) {
  r = r && typeof r === "object" ? r : {};
  const folder = FOLDER_NAMES.includes(r.folder) ? r.folder : "11 Other";
  const verdict = VERDICT[r.verdict] ? r.verdict : "scan_shred";
  const pl = r.paperless && typeof r.paperless === "object" ? r.paperless : {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.docDate || "") ? r.docDate : "";
  let filename = cleanName(r.filename).slice(0, 120);
  if (!filename) filename = `${date || "0000-00-00"}_${slug(r.issuer || r.docType)}`;
  const card = {
    title: String(r.title || "Untitled document").slice(0, 140),
    docType: String(r.docType || "").slice(0, 80),
    issuer: String(r.issuer || "").slice(0, 100),
    docDate: date,
    summary: String(r.summary || "").slice(0, 400),
    folder, filename, verdict,
    verdictReason: String(r.verdictReason || "").slice(0, 300),
    retention: String(r.retention || "").slice(0, 120),
    sensitive: !!r.sensitive,
    paperless: { possible: !!pl.possible, issuer: String(pl.issuer || r.issuer || "").slice(0, 100), how: String(pl.how || "").slice(0, 300) },
  };
  const c = r.confidence;
  if (c && typeof c === "object" && c.fields && typeof c.fields === "object") {
    const fields = {};
    for (const f of FIELD_ORDER) if (typeof c.fields[f] === "number" && Number.isFinite(c.fields[f])) fields[f] = Math.min(1, Math.max(0, c.fields[f]));
    card.confidence = { overall: typeof c.overall === "number" ? Math.min(1, Math.max(0, c.overall)) : lowestScore(fields), fields };
    if (c.sparse) card.confidence.sparse = true;
  }
  if (r.alternatives && typeof r.alternatives === "object") {
    const alts = {};
    for (const f of ALT_FIELDS) if (Array.isArray(r.alternatives[f])) alts[f] = r.alternatives[f].map((v) => String(v || "").slice(0, 140)).filter(Boolean).slice(0, 2);
    card.alternatives = alts;
  }
  if (typeof r.appliedRule === "string" && r.appliedRule) card.appliedRule = r.appliedRule.slice(0, 60);
  return card;
}

// ---------- failures ----------
export const READ_COPY = {
  signed_out: "Your sign-in expired. Reload the page and sign in again, then tap Try again.",
  not_allowed: DENIED,
  api_key: "Claude isn't set up yet: the Anthropic API key is missing or was rejected.",
  rate_limited: "Claude is busy or the rate limit was hit. Wait a minute, then tap Try again.",
  overloaded: "Claude is overloaded right now. Wait a minute, then tap Try again.",
  timeout: "Claude took too long on this one. Tap Try again.",
  refused: "Claude declined to read this one. Check that it's a document.",
  invalid_json: "Claude's answer came back garbled. Tap Try again.",
  too_large: "This file is too large to send to Claude. Split it into smaller scans.",
  bad_request: "Claude couldn't open this file. Rescan it and add it again.",
  offline: "You're offline. Tap Try again once you're back online.",
  not_deployed: "The reader isn't running yet. Once the classify function is deployed, tap Try again.",
  rules_failed: "The lab reader stopped on this one. Tap Try again, or fill it in yourself.",
  unknown: "Something interrupted the read. Tap Try again.",
};
// The ClassifyErrorCode for a failure: the function's details.code first, the callable's own code second.
export function readCode(e) {
  const c = e?.details?.code;
  if (READ_COPY[c]) return c;
  const fc = errCode(e).replace(/^functions\//, "");
  if (navigator.onLine === false) return "offline";
  return { unauthenticated: "signed_out", "permission-denied": "not_allowed", "not-found": "not_deployed", "deadline-exceeded": "timeout",
    "resource-exhausted": "rate_limited", unavailable: "overloaded", "invalid-argument": "bad_request" }[fc] || "unknown";
}
// The classify error code behind a failed read (PipelineItem.readErrorCode).
export const readErrorCode = (e) => readCode(e);
export function readError(e) {
  const code = readCode(e);
  if (code === "unknown" && errCode(e).replace(/^functions\//, "") === "internal" && !e?.details?.code)
    return "Something interrupted the read. If this keeps happening, the reader may not be deployed yet. Tap Try again.";
  return READ_COPY[code];
}
const RETRYABLE = new Set(["rate_limited", "timeout", "overloaded", "invalid_json", "unknown"]);

// ---------- the reading queue (ReadingQueue) ----------
export const CACHE_WARM_MS = 240_000;   // Claude's prompt cache lives 5 minutes from its last use
let backoff = [2000, 8000];             // waits before the second and third attempts
const pending = [];                     // { item, pdf, resolve, queuedAt }
let lanes = 0, inFlight = 0, lastAnswer = 0;
export const queueStats = { peak: 0, timings: [] };
export const readsInFlight = () => inFlight;
// Tests: shorter retry waits.
export function setBackoff(list) { backoff = list; }

const laneLimit = () => (lastAnswer && Date.now() - lastAnswer < CACHE_WARM_MS ? READERS : 1);
function openLanes() {
  while (lanes < laneLimit() && pending.length > lanes - inFlight) { lanes++; runLane(); }
}
async function runLane() {
  while (pending.length) {
    const job = pending.shift();
    inFlight++;
    queueStats.peak = Math.max(queueStats.peak, inFlight);
    await readOne(job);
    inFlight--;
    job.resolve(job.item);
    openLanes();   // the first answer warms the cache: open the second lane for what's left
  }
  lanes--;
}
// Reads one document. `source.pdf` is the PDF Drive gets (a Blob, or a function that returns one).
// Resolves the item once it's "ready" or "failed"; never throws. A failed read keeps its scan, and
// readItem() again ("Try again") reads it once more.
export function readItem(item, source = {}) {
  item.stage = "reading";
  item.readErrorCode = null; item.errorMessage = "";
  return new Promise((resolve) => {
    pending.push({ item, source, resolve, queuedAt: Date.now() });
    openLanes();
  });
}
async function readOne({ item, source, queuedAt }) {
  const started = Date.now();
  let built = started, kind = "", primary = false;
  if (READER === "rules") {
    await labReadOne(item, source);
    queueStats.timings.push({ id: item.id, total: Date.now() - queuedAt, waited: started - queuedAt, build: 0, call: Date.now() - started, kind: "rules", ocrPrimary: false });
    return;
  }
  try {
    const pdf = typeof source.pdf === "function" ? await source.pdf() : source.pdf;
    const payload = await buildPayload(item, pdf);
    built = Date.now(); kind = payload.kind; primary = !!payload.ocrPrimary;
    const out = await classifyWithRetry(payload);
    lastAnswer = Date.now();
    let card = normalize(out && out.result);
    if (!card.appliedRule) card = applySenderRule(card, rules);
    item.card = card;
    item.model = out && out.model;
    item.unsureFields = unsureFields(card);
    item.stage = "ready";
  } catch (e) {
    if (e?.details?.code && !["too_large", "bad_request"].includes(e.details.code)) lastAnswer = Date.now();
    item.readErrorCode = readCode(e);
    item.errorMessage = readError(e);
    item.failedStage = "reading";
    item.stage = "failed";
    console.warn("Read failed", e);
  }
  queueStats.timings.push({ id: item.id, total: Date.now() - queuedAt, waited: started - queuedAt, build: built - started, call: Date.now() - built, kind, ocrPrimary: primary });
}
// ---------- the lab read (#92): text and rules, no AI ----------
// The rules' answer goes through the same normalize and sender rules as Claude's, so the card, the
// Not sure fields and the deck behave the same. item.lab keeps what compare mode and Lab Stats need.
function labCard(out, item, list = rules) {
  let card = normalize(out.result);
  if (!card.appliedRule) card = applySenderRule(card, list);
  item.lab = { readId: item.id, rules: card, textSource: out.text.source, textChars: out.text.chars, ocrPages: out.text.ocrPages, ms: out.ms, compare: "off", claude: null, agreement: null, picks: null };
  return card;
}
async function labReadOne(item, source) {
  const progress = (p) => { item.progress = progressCopy(p); emit("lab:progress", { id: item.id, progress: item.progress }); };
  try {
    const input = { textPages: item.textPages, textSource: item.textSource, ocrText: item.ocrText, pages: item.pages, name: item.name };
    if (!(Array.isArray(input.textPages) && input.textPages.some((t) => String(t || "").trim())) && !input.ocrText) {
      input.pdf = typeof source.pdf === "function" ? await source.pdf() : source.pdf;
    }
    const out = await labRead(input, { senderRules: rules, onProgress: progress });
    lastAnswer = Date.now();
    item.card = labCard(out, item);
    item.model = "rules";
    item.unsureFields = unsureFields(item.card);
    item.stage = "ready";
    item.progress = "";
    emit("lab:read", { item, source });
  } catch (e) {
    console.warn("Lab read failed", e);
    item.readErrorCode = "rules_failed";
    item.errorMessage = READ_COPY.rules_failed;
    item.failedStage = "reading";
    item.stage = "failed";
    item.progress = "";
  }
}

// What the live app would have said (compare mode, lab/compare.js): the same request the live app
// sends for this item, through the same retries, normalize and sender rules. source: { pdf } for a
// pipeline item (the review's), nothing for a legacy session item (it has its files).
export async function claudeRead(item, source = {}) {
  let payload;
  if (item.files && item.kind === "photos") {
    const images = [];
    for (const f of item.files.slice(0, READ_PAGES)) images.push({ type: "image/jpeg", data: await blobB64(await photoJpeg(f, READ_EDGE, PAGE_Q)) });
    payload = { kind: "images", images, totalPages: item.files.length, wantConfidence: true };
    if (rules.length) payload.senderHints = rules.map(hintOf);
  } else {
    const pdf = item.files ? item.files[0] : typeof source.pdf === "function" ? await source.pdf() : source.pdf;
    payload = await buildPayload({ pages: item.numPages || item.pages, ocrText: item.ocrText }, pdf);
  }
  const out = await classifyWithRetry(payload);
  const card = normalize(out && out.result);
  return { card: card.appliedRule ? card : applySenderRule(card, rules), model: (out && out.model) || "" };
}

async function classifyWithRetry(payload) {
  for (let attempt = 0; ; attempt++) {
    try { return await B.classify(payload); }
    catch (e) {
      if (!RETRYABLE.has(readCode(e)) || attempt >= backoff.length || navigator.onLine === false) throw e;
      await new Promise((r) => setTimeout(r, backoff[attempt]));
    }
  }
}

// ---------- stack mode (#19): split a scanned pile ----------
export const SPLIT = { thumbEdge: 512, maxImages: 100, maxPages: 300, pageChars: 2000 };
// pages: [{ text, image? }] where image is a JPEG Blob (512 px). Resolves [{ start, end, label }]
// covering every page once, in order. Throws when Claude couldn't split it, or the function is
// older than split mode (it refuses the request as bad_request): the pages then stay as they are.
export async function proposeSplit(pages) {
  if (!pages.length || pages.length > SPLIT.maxPages) throw { details: { code: "too_large" } };
  if (READER === "rules") return localSplit(pages);   // the lab: no AI, page markers only
  const withImages = pages.length <= SPLIT.maxImages;
  const req = { mode: "split", pages: [] };
  for (const p of pages) {
    const page = { text: String(p.text || "").trim().slice(0, SPLIT.pageChars) };
    if (withImages && p.image) page.image = { type: "image/jpeg", data: await blobB64(p.image) };
    req.pages.push(page);
  }
  const out = await B.classify(req);
  const docs = splitGroups(out && out.split && out.split.documents, pages.length);
  if (!docs) throw { details: { code: "invalid_json" } };
  return docs;
}
// The answer as ranges, or null when it doesn't cover pages 0..n-1 once, in order (SplitPayload.groups).
export function splitGroups(documents, n) {
  if (!n || !Array.isArray(documents) || !documents.length) return null;
  let next = 0;
  const out = [];
  for (const d of documents) {
    if (!d || d.start !== next || !(d.end >= d.start) || d.end >= n) return null;
    out.push({ start: d.start, end: d.end, label: String(d.label || "").trim() });
    next = d.end + 1;
  }
  return next === n ? out : null;
}

// ---------- the legacy deck's read (session items from items.js) ----------
// Same payload rules for a PDF; photos still go as page images. Throws; readError(e) gives the copy.
// senderHints: the rules to send; the live list from senders.js when not given.
export async function classifyItem(item, onProgress = () => {}, { senderHints } = {}) {
  const list = Array.isArray(senderHints) ? senderHints : rules;
  if (READER === "rules") {
    const input = item.kind === "pdf" ? { pdf: item.files[0], pages: item.numPages, name: item.name } : { photos: item.files, pages: item.files.length, name: item.name };
    let out;
    try {
      out = await labRead(input, { senderRules: list, onProgress: (p) => { item.progress = progressCopy(p); onProgress(); } });
    } catch (e) {
      console.warn("Lab read failed", e);
      throw { details: { code: "rules_failed" } };
    }
    item.progress = "";
    const card = labCard(out, item, list);
    emit("lab:read", { item, source: {} });
    return card;
  }
  let payload;
  if (item.kind === "pdf") {
    payload = await buildPayload({ pages: item.numPages, ocrText: item.ocrText }, item.files[0]);
  } else {
    const images = [];
    for (const f of item.files.slice(0, READ_PAGES)) images.push({ type: "image/jpeg", data: await blobB64(await photoJpeg(f, READ_EDGE, PAGE_Q)) });
    payload = { kind: "images", images, totalPages: item.files.length, wantConfidence: true };
    if (list.length) payload.senderHints = list.map(hintOf);
  }
  item.progress = "Claude is reading it"; onProgress();
  const out = await classifyWithRetry(payload);
  lastAnswer = Date.now();
  const card = normalize(out && out.result);
  return card.appliedRule ? card : applySenderRule(card, list);
}
