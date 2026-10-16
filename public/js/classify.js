// classify.js: the client side of the `classify` callable. Builds the request from an item (the PDF
// itself when it's small, page images otherwise), calls it through the backend, cleans the reply,
// and turns failures into copy. The request and response shapes are in docs/v2-contract.md and
// must match functions/lib.js.
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
export async function classifyItem(item, onProgress = () => {}) {
  const payload = await readPayload(item, onProgress);
  const size = payload.pdf ? payload.pdf.length : payload.images.reduce((n, i) => n + i.data.length, 0);
  if (size > MAX_SEND_CHARS) throw { details: { code: "too_large" } };
  item.progress = "Claude is reading it"; onProgress();
  const out = await B.classify(payload);
  return normalize(out && out.result);
}

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
  };
}
