// lab/rules-stub.js: a TEMPORARY stand-in for the lab rules engine (public/js/lab/rules/, built on
// feat/lab-rules for #92), so the lab reader and compare mode can be built and tested before it lands.
// Same interface: classify(textPages, meta) returns a classify-shaped result (title, docType, issuer,
// docDate, summary, folder, filename, verdict, verdictReason, retention, sensitive,
// paperless { possible, issuer, how }, confidence { overall, fields }). The integrator points
// lab/engine.js at the real engine and deletes this file. No AI, no network, no DOM: it also runs
// inside the rules worker. Owner: lab reader (until the rules engine replaces it).

const TYPES = [
  { re: /\bW-?2\b|wage and tax statement/i, docType: "W-2", folder: "02 Taxes", verdict: "scan_shred", retention: "Keep 7 years", sensitive: true },
  { re: /\b1099(-[A-Z]+)?\b/i, docType: "1099", folder: "02 Taxes", verdict: "scan_shred", retention: "Keep 7 years", sensitive: true },
  { re: /explanation of benefits|\bEOB\b|this is not a bill/i, docType: "Explanation of benefits", folder: "05 Medical", verdict: "scan_shred", retention: "Keep 1 year" },
  { re: /pay stub|earnings statement|net pay/i, docType: "Pay stub", folder: "08 Work & Income", verdict: "scan_shred", retention: "Keep 1 year", sensitive: true },
  { re: /certificate of title|vehicle title/i, docType: "Vehicle title", folder: "07 Auto", verdict: "keep_original", retention: "Keep while you own the car", sensitive: true },
  { re: /lease agreement|\blease\b/i, docType: "Lease", folder: "06 Home", verdict: "scan_shred", retention: "Keep until the lease ends plus 3 years" },
  { re: /warranty/i, docType: "Warranty", folder: "09 Warranties & Manuals", verdict: "scan_shred", retention: "Keep until the warranty ends" },
  { re: /policy|declarations page|insurance/i, docType: "Insurance policy", folder: "04 Insurance", verdict: "scan_shred", retention: "Keep until replaced" },
  { re: /bank statement|checking|savings|account summary/i, docType: "Bank statement", folder: "03 Money & Banking", verdict: "scan_shred", retention: "Keep 1 year", sensitive: true },
  { re: /electric|utility|water|gas service|amount due/i, docType: "Utility bill", folder: "06 Home", verdict: "shred", retention: "Not needed" },
  { re: /receipt|thank you for your purchase/i, docType: "Receipt", folder: "11 Other", verdict: "shred", retention: "Not needed" },
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n) => String(n).padStart(2, "0");
const slug = (s) => String(s || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "unknown";

function firstDate(text) {
  const iso = text.match(/\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (iso) return iso[0];
  const us = text.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/((?:19|20)\d{2})\b/);
  if (us) return `${us[3]}-${pad(us[1])}-${pad(us[2])}`;
  const long = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i);
  if (long) return `${long[3]}-${pad(MONTHS.indexOf(long[1].toLowerCase()) + 1)}-${pad(long[2])}`;
  return "";
}

export function classify(textPages, meta = {}) {
  const text = (Array.isArray(textPages) ? textPages : [String(textPages || "")]).join("\n");
  const type = TYPES.find((t) => t.re.test(text));
  const rule = (meta.senderRules || []).find((r) => r.issuer && text.toLowerCase().includes(String(r.issuer).toLowerCase()));
  const issuer = rule ? rule.issuer : "";
  const docDate = firstDate(text);
  const docType = type ? type.docType : "";
  const title = [docDate.slice(0, 4), docType || "Document", issuer && `from ${issuer}`].filter(Boolean).join(" ");
  const sensitive = !!(type && type.sensitive) || /\b\d{3}-\d{2}-\d{4}\b/.test(text);
  const sure = (ok) => (ok ? 0.9 : 0.4);
  const fields = { issuer: sure(issuer), docDate: sure(docDate), folder: sure(type), title: sure(type), filename: sure(issuer && docDate), verdict: sure(type) };
  return {
    title, docType, issuer, docDate,
    summary: text.replace(/\s+/g, " ").trim().slice(0, 160),
    folder: type ? type.folder : "11 Other",
    filename: `${docDate || "0000-00-00"}_${slug(issuer || docType || "document")}`,
    verdict: type ? type.verdict : "scan_shred",
    verdictReason: type ? `Rules: looks like a ${docType.toLowerCase()}.` : "Rules: no document type matched.",
    retention: type ? type.retention : "",
    sensitive,
    paperless: { possible: false, issuer, how: "" },
    confidence: { overall: Math.min(...Object.values(fields)), fields },
  };
}
