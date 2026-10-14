// The classify function's logic, kept apart from the Firebase wiring in index.js so the unit tests
// can run it with a stand-in Claude client. Ported from the Paper Trail artifact
// (Home Projects/Projects/2026-10 Paperwork Scan/paper-trail.html): same fields, same verdict rules,
// same normalize(). What changed: the pages arrive as a PDF or as page images, and the reply is held
// to a JSON schema with structured outputs.
//
// Optional extras for the iPhone app (every one is opt-in, so the web app's requests and replies are
// exactly what they were):
//   ocrText         on-device OCR text, added to the user turn as a hint (#22)
//   wantConfidence  ask Claude for a 0 to 1 confidence per field plus up to two other guesses for the
//                   unsure ones; the reply gains result.confidence {overall, fields} and
//                   result.alternatives (#20)
//   senderHints     the user's sender rules (users/{uid}/senders). Claude sees the known sender names
//                   so it spells them the same way, then applySenderRule() applies the matching rule
//                   to the card deterministically and sets result.appliedRule (#21)

const FOLDER_NAMES = [
  "01 Identity & Legal",
  "02 Taxes",
  "03 Money & Banking",
  "04 Insurance",
  "05 Medical",
  "06 Home",
  "07 Auto",
  "08 Work & Income",
  "09 Warranties & Manuals",
  "10 Personal & Sentimental",
  "11 Other",
];
const VERDICTS = ["shred", "scan_shred", "keep_original"];

// Request limits. A 2nd gen callable takes a request body up to 32 MB; base64 grows a file by a
// third, so the page caps what it sends well under that and these checks hold the line.
const MAX_BASE64_CHARS = 24 * 1024 * 1024;
const MAX_IMAGES = 10;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_OCR_CHARS = 20000;
const MAX_SENDER_HINTS = 200;

// Fields that get a confidence score (#20), in the order the app's check-fields sheet shows them.
const CONFIDENCE_FIELDS = ["issuer", "docDate", "folder", "title", "filename", "verdict"];
// Fields that can carry other guesses. The verdict is a three-way choice the app shows in full.
const ALTERNATIVE_FIELDS = ["issuer", "docDate", "folder", "title", "filename"];
const MAX_ALTERNATIVES = 2;

// Models that take the server-side refusal fallback (fallbacks: "default").
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

const slug = (s) => String(s || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "unknown";
const cleanName = (s) => String(s || "").trim().replace(/\.pdf$/i, "").replace(/[\/\\:*?"<>|]/g, "-");

// The instructions never change between documents, so they sit in the system prompt where they
// can be cached. The per-document part (what is attached, today's date) goes in the user turn.
const SYSTEM_PROMPT = `You are helping someone in the US digitize a box of personal paperwork so they can shred most of it. Each request carries the page(s) of ONE document.

Reply with only a JSON object with exactly these fields:
{
 "title": "short human name, e.g. Duke Energy bill, March 2024",
 "docType": "e.g. Utility bill, W-2, Explanation of benefits, Lease, Receipt",
 "issuer": "organization that issued or sent it, or empty string",
 "docDate": "YYYY-MM-DD, the document's own date (statement, issue or signature date), or empty string",
 "summary": "one sentence: what it is and anything notable (amounts, policy or account referenced by last 4 digits only)",
 "folder": one of ${JSON.stringify(FOLDER_NAMES)},
 "filename": "docDate_issuer-short-description, lowercase, hyphens, no extension, e.g. 2024-03-12_duke-energy-electric-bill. Use 0000-00-00 if no date",
 "verdict": "shred" | "scan_shred" | "keep_original",
 "verdictReason": "one plain sentence explaining the verdict",
 "retention": "how long the digital copy matters, e.g. Keep 7 years (tax backup), Permanently, Until you sell the car, Not needed",
 "sensitive": true or false (true if it shows a full SSN, full account numbers, or medical details),
 "paperless": { "possible": true or false, "issuer": "sender name", "how": "one sentence on how to stop the paper version, e.g. where the paperless setting usually lives in their online account. Empty if not possible" }
}
Verdict rules:
- keep_original: the paper itself has legal value or is hard to replace. Birth, death, marriage and divorce certificates, Social Security card, passport, vehicle titles, property deeds, wills, trusts, powers of attorney, anything notarized or with a raised seal, original stock or bond certificates, adoption, citizenship and military discharge papers, and clearly sentimental items (letters, cards, kids' art).
- shred: nothing worth keeping. Junk mail, ads, envelopes, expired offers, duplicates, and routine statements older than a year that the sender keeps online, when nothing on them is still needed.
- scan_shred: everything else worth a record. Tax forms and backup, medical records and EOBs, receipts for big purchases, warranties, insurance policies, leases, pay stubs, loan payoff letters, contracts.
paperless.possible is true when the sender is a company that sends this kind of mail on a recurring basis and offers e-delivery (banks, utilities, insurers, brokerages, medical billing, phone and internet, loan servicers). False for one-off or government documents that can't be switched.
Never write a full SSN or full account number in any field. If the pages are unreadable, set title to "Unreadable scan", verdict to "scan_shred", and use verdictReason to ask for a clearer scan.`;

// Appended to the system prompt only when the request asks for confidence, so the web app's prompt
// (and its cache) is untouched.
const CONFIDENCE_PROMPT = `

Also add these two fields to the JSON object:
 "confidence": a number from 0 to 1 for each of ${CONFIDENCE_FIELDS.join(", ")}: how sure you are that the value is right. 0.95 or more means it is printed plainly on the page. Below 0.75 means a person should check it (a sender name that is only a logo, two dates that could be the document date, a folder that could go two ways).
 "alternatives": for each of ${ALTERNATIVE_FIELDS.join(", ")}, up to ${MAX_ALTERNATIVES} other plausible values, best first, in the same format as the field (docDate as YYYY-MM-DD, folder from the same list). Use an empty list when you are sure or have no other candidate.`;

// Structured outputs hold the reply to this shape; normalize() still cleans it afterwards.
const str = { type: "string" };
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    title: str, docType: str, issuer: str, docDate: str, summary: str,
    folder: { type: "string", enum: FOLDER_NAMES },
    filename: str,
    verdict: { type: "string", enum: VERDICTS },
    verdictReason: str, retention: str,
    sensitive: { type: "boolean" },
    paperless: {
      type: "object",
      properties: { possible: { type: "boolean" }, issuer: str, how: str },
      required: ["possible", "issuer", "how"],
      additionalProperties: false,
    },
  },
  required: ["title", "docType", "issuer", "docDate", "summary", "folder", "filename", "verdict", "verdictReason", "retention", "sensitive", "paperless"],
  additionalProperties: false,
};

// The schema for a request: the web app's shape, plus confidence and alternatives when asked.
function schemaFor(wantConfidence) {
  if (!wantConfidence) return RESULT_SCHEMA;
  const num = { type: "number" };
  const listOf = (item) => ({ type: "array", items: item });
  const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
  const confidence = obj(Object.fromEntries(CONFIDENCE_FIELDS.map((f) => [f, num])));
  const alternatives = obj(Object.fromEntries(ALTERNATIVE_FIELDS.map((f) => [f, listOf(f === "folder" ? { type: "string", enum: FOLDER_NAMES } : str)])));
  return {
    ...RESULT_SCHEMA,
    properties: { ...RESULT_SCHEMA.properties, confidence, alternatives },
    required: [...RESULT_SCHEMA.required, "confidence", "alternatives"],
  };
}

function userText({ kind, totalPages, sentPages }, today) {
  const total = Math.max(1, totalPages | 0), sent = Math.max(1, sentPages | 0);
  const pages = `${total} page${total > 1 ? "s" : ""}`;
  const source = kind === "pdf"
    ? `The attached PDF is ONE document (${pages} in all).`
    : `The ${sent} attached image(s) are the page(s) of ONE document, in order${total > sent ? ` (the first ${sent} of ${total})` : ""}.`;
  return `${source} Today is ${today}.`;
}

// The per-request extras for the user turn: known senders and the OCR text. Empty for the web app.
function extrasText({ senderHints, ocrText }) {
  const parts = [];
  if (senderHints && senderHints.length) {
    const names = senderHints.map((h) => h.issuer).filter(Boolean);
    if (names.length) parts.push(`Senders this person has filed before. If the document is from one of them, write the issuer exactly as listed: ${JSON.stringify(names)}.`);
  }
  if (ocrText) parts.push(`Text read from the pages on the phone (OCR, may have errors; the pages themselves win):\n<ocr>\n${ocrText}\n</ocr>`);
  return parts.join("\n\n");
}

function normalize(r) {
  r = r && typeof r === "object" ? r : {};
  const folder = FOLDER_NAMES.includes(r.folder) ? r.folder : "11 Other";
  const verdict = VERDICTS.includes(r.verdict) ? r.verdict : "scan_shred";
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

const clamp01 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

// Cleans Claude's confidence and alternatives against the normalized card (#20). Every field gets a
// score (a missing one counts as 0, so it shows up as unsure rather than slipping through). The
// overall score is the lowest field score: a card is only as sure as its least sure field.
// Alternatives are cleaned like the field itself, never repeat the chosen value, and keep at most two.
function normalizeConfidence(raw, card) {
  const r = raw && typeof raw === "object" ? raw : {};
  const c = r.confidence && typeof r.confidence === "object" ? r.confidence : {};
  const fields = {};
  for (const f of CONFIDENCE_FIELDS) fields[f] = round2(clamp01(c[f]));
  const a = r.alternatives && typeof r.alternatives === "object" ? r.alternatives : {};
  const clean = {
    issuer: (v) => String(v || "").trim().slice(0, 100),
    title: (v) => String(v || "").trim().slice(0, 140),
    docDate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : ""),
    folder: (v) => (FOLDER_NAMES.includes(v) ? v : ""),
    filename: (v) => cleanName(v).slice(0, 120),
  };
  const alternatives = {};
  for (const f of ALTERNATIVE_FIELDS) {
    const seen = new Set([card[f]]);
    const list = [];
    for (const v of Array.isArray(a[f]) ? a[f] : []) {
      const x = clean[f](v);
      if (!x || seen.has(x)) continue;
      seen.add(x); list.push(x);
      if (list.length === MAX_ALTERNATIVES) break;
    }
    alternatives[f] = list;
  }
  return { confidence: { overall: overallOf(fields), fields }, alternatives };
}
const overallOf = (fields) => round2(Math.min(...CONFIDENCE_FIELDS.map((f) => (f in fields ? fields[f] : 0))));

// Sender hints from the app (#21): users/{uid}/senders documents. Anything malformed is dropped, not
// refused, so a bad rule never stops a read.
function cleanSenderHints(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const h of list.slice(0, MAX_SENDER_HINTS)) {
    if (!h || typeof h !== "object") continue;
    const issuer = String(h.issuer || "").trim().slice(0, 100);
    const key = slug(h.key || issuer);
    if (!issuer || key === "unknown") continue;
    const rule = { key, issuer };
    if (FOLDER_NAMES.includes(h.folder)) rule.folder = h.folder;
    if (VERDICTS.includes(h.verdict)) rule.verdict = h.verdict;
    if (typeof h.docType === "string" && h.docType.trim()) rule.docType = h.docType.trim().slice(0, 80);
    if (typeof h.filenamePattern === "string" && h.filenamePattern.trim()) rule.filenamePattern = h.filenamePattern.trim().slice(0, 120);
    out.push(rule);
  }
  return out;
}

// Fills a filename pattern's tokens from the card. {date} is the docDate (0000-00-00 when there is
// none), {yyyy} and {mm} its parts, {issuer} and {type} the slugs of the sender and document type.
function renderFilename(pattern, card) {
  const date = card.docDate || "0000-00-00";
  const out = String(pattern)
    .replace(/\{date\}/g, date)
    .replace(/\{yyyy\}/g, date.slice(0, 4))
    .replace(/\{mm\}/g, date.slice(5, 7))
    .replace(/\{issuer\}/g, slug(card.issuer))
    .replace(/\{type\}/g, slug(card.docType));
  return cleanName(out).slice(0, 120);
}

// Applies the rule whose key matches the card's sender, the same way every time (#21): the rule's
// spelling of the sender, then its folder, verdict, document type and filename pattern, each only if
// the rule has one. Fields a rule set are certain, so their confidence becomes 1 and their other
// guesses go. Returns the card unchanged when no rule matches.
function applySenderRule(card, hints) {
  const rule = (hints || []).find((h) => h.key === slug(card.issuer));
  if (!rule) return card;
  const out = { ...card, issuer: rule.issuer, appliedRule: rule.key };
  const set = ["issuer"];
  if (rule.folder) { out.folder = rule.folder; set.push("folder"); }
  if (rule.verdict) { out.verdict = rule.verdict; set.push("verdict"); }
  if (rule.docType) out.docType = rule.docType;
  if (rule.filenamePattern) {
    const name = renderFilename(rule.filenamePattern, out);
    if (name) { out.filename = name; set.push("filename"); }
  }
  if (out.paperless && slug(out.paperless.issuer) === rule.key) out.paperless = { ...out.paperless, issuer: rule.issuer };
  if (out.confidence) {
    const fields = { ...out.confidence.fields };
    for (const f of set) fields[f] = 1;
    out.confidence = { overall: overallOf(fields), fields };
  }
  if (out.alternatives) {
    out.alternatives = { ...out.alternatives };
    for (const f of set) if (out.alternatives[f]) out.alternatives[f] = [];
  }
  return out;
}

// ALLOWED_EMAILS is a comma or space separated list. An empty list lets nobody in.
const parseAllowlist = (s) => String(s || "").split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
function isAllowed(token, list) {
  if (!token || token.email_verified !== true) return false;
  const email = String(token.email || "").trim().toLowerCase();
  return !!email && list.includes(email);
}

// Errors carry a short code in details so the page can pick its own wording.
class ClassifyError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
// The optional extras. Lenient on purpose: a bad extra is ignored, never a reason to refuse the read.
function extras(d) {
  const ocrText = typeof d.ocrText === "string" ? d.ocrText.trim().slice(0, MAX_OCR_CHARS) : "";
  return { ocrText, senderHints: cleanSenderHints(d.senderHints), wantConfidence: d.wantConfidence === true };
}

function validate(data) {
  const d = data && typeof data === "object" ? data : {};
  const bad = (msg) => { throw new ClassifyError("invalid-argument", "bad_request", msg); };
  const totalPages = Number.isInteger(d.totalPages) && d.totalPages > 0 ? d.totalPages : 1;
  if (d.kind === "pdf") {
    if (typeof d.pdf !== "string" || !d.pdf || !B64.test(d.pdf.slice(0, 4096))) bad("pdf must be a base64 string");
    if (d.pdf.length > MAX_BASE64_CHARS) throw new ClassifyError("invalid-argument", "too_large", "The PDF is too large to send.");
    return { kind: "pdf", pdf: d.pdf, totalPages, sentPages: totalPages, ...extras(d) };
  }
  if (d.kind === "images") {
    if (!Array.isArray(d.images) || !d.images.length) bad("images must be a non-empty list");
    if (d.images.length > MAX_IMAGES) bad(`at most ${MAX_IMAGES} images`);
    let size = 0;
    const images = d.images.map((im) => {
      if (!im || !IMAGE_TYPES.includes(im.type) || typeof im.data !== "string" || !im.data || !B64.test(im.data.slice(0, 4096))) bad("each image needs a type and base64 data");
      size += im.data.length;
      return { type: im.type, data: im.data };
    });
    if (size > MAX_BASE64_CHARS) throw new ClassifyError("invalid-argument", "too_large", "The pages are too large to send.");
    return { kind: "images", images, totalPages: Math.max(totalPages, images.length), sentPages: images.length, ...extras(d) };
  }
  return bad("kind must be pdf or images");
}

function buildRequest(input, { model, effort, today }) {
  const content = input.kind === "pdf"
    ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf } }]
    : input.images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } }));
  const more = extrasText(input);
  content.push({ type: "text", text: more ? `${userText(input, today)}\n\n${more}` : userText(input, today) });
  const system = input.wantConfidence ? SYSTEM_PROMPT + CONFIDENCE_PROMPT : SYSTEM_PROMPT;
  const req = {
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema: schemaFor(input.wantConfidence) } },
  };
  // On a safety decline, the API re-runs the request on Anthropic's recommended fallback model.
  if (FALLBACK_MODELS.has(model)) { req.betas = ["server-side-fallback-2026-07-01"]; req.fallbacks = "default"; }
  return req;
}

// Maps an Anthropic SDK error to the code the page shows copy for. Typed classes, most specific first.
function mapApiError(e, Anthropic) {
  if (e instanceof ClassifyError) return e;
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ClassifyError("failed-precondition", "api_key", "The Anthropic API key is missing or was rejected.");
    if (e instanceof Anthropic.RateLimitError) return new ClassifyError("resource-exhausted", "rate_limited", "Claude's rate limit was hit.");
    if (e instanceof Anthropic.BadRequestError) {
      const tooBig = /too (large|long)|exceed|maximum|pages/i.test(e.message || "");
      return new ClassifyError("invalid-argument", tooBig ? "too_large" : "bad_request", "Claude could not take this file.");
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) return new ClassifyError("deadline-exceeded", "timeout", "Claude took too long.");
    if (e instanceof Anthropic.APIConnectionError) return new ClassifyError("unavailable", "overloaded", "Claude could not be reached.");
    if (e instanceof Anthropic.InternalServerError || (e instanceof Anthropic.APIError && (e.status === 529 || e.status >= 500))) return new ClassifyError("unavailable", "overloaded", "Claude is overloaded.");
  }
  return new ClassifyError("internal", "unknown", "Something interrupted the read.");
}

// The whole callable: auth and allowlist first, then validate, call Claude, parse, normalize.
// deps: { client(), allowlist(), model(), effort(), today(), Anthropic, log }
async function classify(request, deps) {
  if (!request || !request.auth) throw new ClassifyError("unauthenticated", "signed_out", "Sign in first.");
  if (!isAllowed(request.auth.token, deps.allowlist())) throw new ClassifyError("permission-denied", "not_allowed", "This app is private.");
  const input = validate(request.data);
  const model = deps.model(), effort = deps.effort();
  let res;
  try {
    const client = deps.client();
    res = await client.beta.messages.create(buildRequest(input, { model, effort, today: deps.today() }));
  } catch (e) {
    const mapped = mapApiError(e, deps.Anthropic);
    if (mapped.code === "unknown" || mapped.code === "bad_request") deps.log && deps.log("classify: Claude call failed", { status: e && e.status, message: e && e.message });
    throw mapped;
  }
  if (res.stop_reason === "refusal") throw new ClassifyError("failed-precondition", "refused", "Claude declined to read this one.");
  if (res.stop_reason === "max_tokens") throw new ClassifyError("internal", "invalid_json", "Claude's answer was cut off.");
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new ClassifyError("internal", "invalid_json", "Claude's answer was not valid JSON."); }
  const u = res.usage || {};
  deps.log && deps.log("classify: done", { model: res.model, kind: input.kind, pages: input.sentPages, input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read: u.cache_read_input_tokens });
  let result = normalize(parsed);
  if (input.wantConfidence) result = { ...result, ...normalizeConfidence(parsed, result) };
  result = applySenderRule(result, input.senderHints);
  return { result, model: res.model || model };
}

module.exports = {
  FOLDER_NAMES, VERDICTS, SYSTEM_PROMPT, CONFIDENCE_PROMPT, RESULT_SCHEMA, MAX_BASE64_CHARS, MAX_IMAGES, MAX_OCR_CHARS,
  CONFIDENCE_FIELDS, ALTERNATIVE_FIELDS,
  userText, extrasText, schemaFor, normalize, normalizeConfidence, cleanSenderHints, renderFilename, applySenderRule,
  parseAllowlist, isAllowed, validate, buildRequest, mapApiError, classify, ClassifyError, slug, cleanName,
};
