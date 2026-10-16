// lab/engine.js: the one door from the lab reader to the rules engine (#92). Everything that runs
// the rules (lab/reader.js on the page, lab/rules-worker.js in the worker) imports runRules from here.
// It adapts the reader's call to readByRules (lab/rules/engine.js). No AI, no network, no DOM.
//
//   runRules(textPages, meta) -> Promise<classify-shaped result>
//     textPages  one string per page: the PDF's own text, or on-device OCR of the page picture
//     meta       { name, pages, textSource: "text"|"ocr"|"mixed"|"none", senderRules: [rule], today: "YYYY-MM-DD" }
//                senderRules are users/{uid}/senders (or the lab's), the same objects classify.js keeps
//                hints (optional) are the matcher's picks for docType and issuer (lab/match/combine.js)
//   The result is the classify card plus confidence { overall, fields }, alternatives, appliedRule and
//   rules (how each field was decided).
// Owner: lab reader.
import { readByRules } from "./rules/engine.js";

// "YYYY-MM-DD" as a local date (new Date("YYYY-MM-DD") would be UTC midnight, the day before in the US).
function asDate(today) {
  if (today instanceof Date) return today;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
}

export async function runRules(textPages, meta = {}) {
  const pages = (textPages || []).map((t) => String(t || ""));
  return readByRules({
    pages,
    pageCount: Math.max(Number(meta.pages) || 0, pages.length),
    filename: meta.name || "",
    senderRules: Array.isArray(meta.senderRules) ? meta.senderRules : [],
    today: asDate(meta.today),
    hints: meta.hints && typeof meta.hints === "object" ? meta.hints : {},
  });
}
