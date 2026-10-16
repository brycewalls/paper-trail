// classify.js: the client side of the `classify` callable. Owner: deck (capture owns proposeSplit).
// Builds the request from an item (the PDF itself when it's small, page images otherwise), always
// asking for confidence and sending the sender rules as hints, calls it through the backend, cleans
// the reply, and turns failures into copy. Also the card's confidence (#20: unsureFields,
// isConfident, UNSURE_BELOW) and the sender rule engine (#21: applySenderRule, renderFilename,
// patternFromFilename), the twins of functions/lib.js and the iPhone app's SenderRuleEngine. The
// request and response shapes are in docs/web-contract.md and must match functions/lib.js.
import { FOLDER_NAMES, VERDICT, PDF_MAX_PAGES, PDF_MAX_BYTES, READ_PAGES, READ_EDGE, MAX_SEND_CHARS, DENIED } from "./config.js";
import { slug, cleanName, errCode } from "./ui.js";
import { B } from "./backend.js";
import { blobB64, openPdfDoc, renderPage, photoJpeg } from "./media.js";

// What the classify function gets: the PDF itself when it's small, page images otherwise.
// onProgress() is called after item.progress changes, so the deck can redraw.
async function readPayload(item, onProgress) {
  if (item.kind === "pdf") {
    const f = item.files[0];
    if (item.numPages <= PDF_MAX_PAGES && f.size <= PDF_MAX_BYTES) return { kind: "pdf", pdf: await blobB64(f), totalPages: item.numPages };
    item.progress = "Preparing the first pages"; onProgress();
    const doc = await openPdfDoc(f);
    const images = [];
    try {
      for (let n = 1; n <= Math.min(doc.numPages, READ_PAGES); n++) images.push({ type: "image/jpeg", data: await blobB64(await renderPage(doc, n, READ_EDGE, 0.85)) });
    } finally { await doc.destroy(); }
    return { kind: "images", images, totalPages: item.numPages };
  }
  const images = [];
  for (const f of item.files.slice(0, READ_PAGES)) images.push({ type: "image/jpeg", data: await blobB64(await photoJpeg(f, READ_EDGE, 0.85)) });
  return { kind: "images", images, totalPages: item.files.length };
}

// Reads one item and resolves the normalized card (see normalize). Throws on failure; readError(e)
// gives the copy to show.
// senderHints: the user's sender rules (senders.js). A reply without appliedRule (an older function)
// gets the matching rule applied here, so a rule always lands the same way.
export async function classifyItem(item, onProgress = () => {}, { senderHints = [] } = {}) {
  const payload = await readPayload(item, onProgress);
  const size = payload.pdf ? payload.pdf.length : payload.images.reduce((n, i) => n + i.data.length, 0);
  if (size > MAX_SEND_CHARS) throw { details: { code: "too_large" } };
  payload.wantConfidence = true;
  if (senderHints.length) payload.senderHints = senderHints.map(hintOf);
  item.progress = "Claude is reading it"; onProgress();
  const out = await B.classify(payload);
  const card = normalize(out && out.result);
  return card.appliedRule ? card : applySenderRule(card, senderHints);
}
const hintOf = (r) => Object.fromEntries(Object.entries({ key: r.key, issuer: r.issuer, folder: r.folder, verdict: r.verdict, docType: r.docType, filenamePattern: r.filenamePattern })
  .filter(([, v]) => typeof v === "string" && v));
// The classify error code behind a failed read (PipelineItem.readErrorCode).
export const readErrorCode = (e) => e?.details?.code || errCode(e).replace(/^functions\//, "") || "unknown";

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
  unknown: "Something interrupted the read. Tap Try again.",
};
export function readError(e) {
  const c = e?.details?.code;
  if (READ_COPY[c]) return READ_COPY[c];
  const fc = errCode(e).replace(/^functions\//, "");
  if (navigator.onLine === false) return READ_COPY.offline;
  if (fc === "unauthenticated") return READ_COPY.signed_out;
  if (fc === "permission-denied") return READ_COPY.not_allowed;
  if (fc === "not-found") return READ_COPY.not_deployed;
  if (fc === "deadline-exceeded") return READ_COPY.timeout;
  if (fc === "resource-exhausted") return READ_COPY.rate_limited;
  if (fc === "unavailable") return READ_COPY.overloaded;
  if (fc === "internal" && !c) return "Something interrupted the read. If this keeps happening, the reader may not be deployed yet. Tap Try again.";
  return READ_COPY.unknown;
}

// ---------- confidence (#20) ----------
// Fields in the check-fields sheet's order (spec 3.1, 3.8). A field scoring below UNSURE_BELOW is
// "Not sure". The reply is sparse (#75): a field missing from confidence.fields was sure.
export const FIELD_ORDER = ["issuer", "docDate", "folder", "title", "filename", "verdict"];
export const UNSURE_BELOW = 0.75;
export function unsureFields(card) {
  const f = card?.confidence?.fields;
  if (!f) return [];
  return FIELD_ORDER.filter((k) => typeof f[k] === "number" && f[k] < UNSURE_BELOW);
}
// Ready to file without a look: Claude sent confidence and nothing is Not sure. A card with no
// confidence data never counts (spec 3.1).
export const isConfident = (card) => !!card?.confidence && unsureFields(card).length === 0;
const overallOf = (fields) => Math.round(Math.min(...FIELD_ORDER.map((k) => (k in fields ? fields[k] : 1))) * 100) / 100;
// The user confirmed or edited these fields: they count as sure from now on, with no other guesses.
export function markConfident(card, fields) {
  if (!fields.length) return card;
  const conf = { overall: 0, sparse: true, ...(card.confidence || {}), fields: { ...(card.confidence?.fields || {}) } };
  for (const k of fields) conf.fields[k] = 1;
  conf.overall = overallOf(conf.fields);
  const out = { ...card, confidence: conf };
  if (card.alternatives) { out.alternatives = { ...card.alternatives }; for (const k of fields) delete out.alternatives[k]; }
  return out;
}

// ---------- sender rules (#21), the twin of functions/lib.js applySenderRule() ----------
// {date} is the docDate (0000-00-00 when there is none), {yyyy} and {mm} its parts, {issuer} and
// {type} the slugs of the sender and document type.
export function renderFilename(pattern, card) {
  const date = card.docDate || "0000-00-00";
  const out = String(pattern).replace(/\{date\}/g, date).replace(/\{yyyy\}/g, date.slice(0, 4)).replace(/\{mm\}/g, date.slice(5, 7))
    .replace(/\{issuer\}/g, slug(card.issuer)).replace(/\{type\}/g, slug(card.docType));
  return cleanName(out).slice(0, 120);
}
// The filename with its date prefix turned into the {date} token, for a rule saved from a card.
export function patternFromFilename(filename, docDate) {
  if (!filename) return "";
  return docDate && filename.startsWith(docDate) ? "{date}" + filename.slice(docDate.length) : filename;
}
// Applies the rule whose key matches the card's sender: the rule's spelling of the sender, then its
// folder, verdict, document type and filename pattern, each only if the rule has one. Fields a rule
// set are certain (confidence 1, no other guesses). Unchanged when no rule matches.
export function applySenderRule(card, rules) {
  const key = slug(card.issuer);
  const rule = key === "unknown" ? null : (rules || []).find((r) => r.key === key);
  if (!rule) return card;
  let out = { ...card, issuer: rule.issuer || card.issuer, appliedRule: rule.key };
  const set = ["issuer"];
  if (FOLDER_NAMES.includes(rule.folder)) { out.folder = rule.folder; set.push("folder"); }
  if (VERDICT[rule.verdict]) { out.verdict = rule.verdict; set.push("verdict"); }
  if (typeof rule.docType === "string" && rule.docType.trim()) out.docType = rule.docType.trim().slice(0, 80);
  if (rule.filenamePattern) { const name = renderFilename(rule.filenamePattern, out); if (name) { out.filename = name; set.push("filename"); } }
  if (out.paperless && slug(out.paperless.issuer) === rule.key) out.paperless = { ...out.paperless, issuer: out.issuer };
  if (out.confidence) out = markConfident(out, set);
  return out;
}

// The function normalizes too; this keeps the page safe from anything odd that comes back.
export function normalize(r) {
  r = r && typeof r === "object" ? r : {};
  const folder = FOLDER_NAMES.includes(r.folder) ? r.folder : "11 Other";
  const verdict = VERDICT[r.verdict] ? r.verdict : "scan_shred";
  const pl = r.paperless && typeof r.paperless === "object" ? r.paperless : {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.docDate || "") ? r.docDate : "";
  let filename = cleanName(r.filename).slice(0, 120);
  if (!filename) filename = `${date || "0000-00-00"}_${slug(r.issuer || r.docType)}`;
  return {
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
    ...confidenceOf(r),
    ...(typeof r.appliedRule === "string" && r.appliedRule ? { appliedRule: r.appliedRule } : {}),
  };
}
// confidence {overall, fields, sparse} and alternatives {field: [up to two]}, when the reply has them.
function confidenceOf(r) {
  const out = {};
  const c = r.confidence;
  if (c && typeof c === "object") {
    const fields = {};
    for (const k of FIELD_ORDER) {
      const v = c.fields && c.fields[k];
      if (typeof v === "number" && Number.isFinite(v)) fields[k] = Math.min(1, Math.max(0, v));
    }
    out.confidence = { overall: overallOf(fields), fields, sparse: c.sparse !== false };
  }
  if (r.alternatives && typeof r.alternatives === "object") {
    const alts = {};
    for (const k of FIELD_ORDER) {
      const list = Array.isArray(r.alternatives[k]) ? r.alternatives[k].map((v) => String(v || "").trim().slice(0, 140)).filter(Boolean).slice(0, 2) : [];
      if (list.length) alts[k] = list;
    }
    out.alternatives = alts;
  }
  return out;
}
