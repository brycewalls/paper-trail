// Unit tests for the iPhone app's extras on the classify function: per-field confidence and other
// guesses (#20), sender rules applied deterministically (#21) and the OCR hint. The web app sends
// none of these, so the first tests prove its requests and replies are exactly what they were.
// Claude is stood in by a fake client. Run: node --test functions/test/
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OWNER = "owner@example.test";
process.env.ALLOWED_EMAILS = OWNER;
process.env.CLAUDE_MODEL = "claude-opus-5-5";
process.env.CLAUDE_EFFORT = "low";
process.env.GCLOUD_PROJECT = "demo-test";
const lib = require("../lib.js");
const fns = require("../index.js");
const deps = require("../deps.js");

const GOOD = {
  title: "Electric bill, September", docType: "Utility bill", issuer: "Cascade Power & Light", docDate: "2026-09-28",
  summary: "Electric bill, $96.40 due on account ending 0412.", folder: "06 Home", filename: "2026-09-28_cascade-power-electric-bill",
  verdict: "scan_shred", verdictReason: "Routine bill worth a record for a year.", retention: "Keep 1 year", sensitive: false,
  paperless: { possible: true, issuer: "Cascade Power & Light", how: "Account settings, then Billing, then Paper bill off." },
};
const SURE = { issuer: 0.6, docDate: 0.55, folder: 0.9, title: 0.97, filename: 0.92, verdict: 0.95 };
const ALTS = { issuer: ["Cascade Natural Gas", "Cascade Power & Light"], docDate: ["2026-10-03", "Oct 3"], folder: [], title: [], filename: [] };
const WITH_CONFIDENCE = { ...GOOD, confidence: SURE, alternatives: ALTS };
const PDF_B64 = Buffer.from("%PDF-1.4 fake").toString("base64");
const auth = (email) => ({ uid: "u1", token: { email, email_verified: true } });
const ctx = { model: "claude-opus-5-5", effort: "low", today: "2026-10-13" };

let calls = [], answer = null;
const reply = (obj) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }], usage: {} });
before(() => {
  deps.client = () => ({ beta: { messages: { create: async (req) => { calls.push(req); return answer; } } } });
  deps.today = () => "2026-10-13";
  deps.log = () => {};
});
const run = (data) => lib.classify({ auth: auth(OWNER), data }, deps);

const RULE = { key: "cascade-power-light", issuer: "Cascade Power & Light", folder: "06 Home", verdict: "shred", docType: "Electric bill", filenamePattern: "{date}_cascade-electric-bill", updatedAt: "2026-10-09T12:00:00.000Z" };

// ---------- backward compatibility with the live web app ----------
test("web request: same prompt, same schema, same user turn as before", () => {
  const input = lib.validate({ kind: "pdf", pdf: PDF_B64, totalPages: 2 });
  assert.equal(input.wantConfidence, false);
  assert.deepEqual(input.senderHints, []);
  assert.equal(input.ocrText, "");
  const req = lib.buildRequest(input, ctx);
  assert.equal(req.system[0].text, lib.SYSTEM_PROMPT);
  assert.equal(req.output_config.format.schema, lib.RESULT_SCHEMA);
  assert.equal(req.messages[0].content.at(-1).text, "The attached PDF is ONE document (2 pages in all). Today is 2026-10-13.");
});

test("web reply: no confidence, alternatives or appliedRule keys", async () => {
  answer = reply(GOOD);
  const out = await run({ kind: "pdf", pdf: PDF_B64 });
  assert.deepEqual(out.result, GOOD);
  const viaCallable = await fns.classify.run({ auth: auth(OWNER), data: { kind: "images", images: [{ type: "image/jpeg", data: "AAAA" }] } });
  assert.deepEqual(Object.keys(viaCallable.result).sort(), Object.keys(GOOD).sort());
});

test("bad extras are ignored, never refused", () => {
  const input = lib.validate({ kind: "pdf", pdf: PDF_B64, ocrText: 42, senderHints: "nope", wantConfidence: "yes" });
  assert.equal(input.ocrText, "");
  assert.deepEqual(input.senderHints, []);
  assert.equal(input.wantConfidence, false);
});

// ---------- confidence (#20) ----------
test("wantConfidence adds the confidence prompt and two required schema fields", () => {
  const req = lib.buildRequest(lib.validate({ kind: "pdf", pdf: PDF_B64, wantConfidence: true }), ctx);
  assert.equal(req.system[0].text, lib.SYSTEM_PROMPT + lib.CONFIDENCE_PROMPT);
  const schema = req.output_config.format.schema;
  assert.ok(schema.required.includes("confidence") && schema.required.includes("alternatives"));
  assert.deepEqual(schema.properties.confidence.required, lib.CONFIDENCE_FIELDS);
  assert.equal(schema.properties.confidence.additionalProperties, false);
  assert.deepEqual(schema.properties.alternatives.properties.folder.items.enum, lib.FOLDER_NAMES);
  assert.equal(lib.RESULT_SCHEMA.properties.confidence, undefined, "the web schema is not mutated");
});

test("confidence comes back per field, overall is the lowest field", async () => {
  answer = reply(WITH_CONFIDENCE);
  const { result } = await run({ kind: "pdf", pdf: PDF_B64, wantConfidence: true });
  assert.deepEqual(result.confidence.fields, SURE);
  assert.equal(result.confidence.overall, 0.55);
  assert.equal(result.appliedRule, undefined);
});

test("alternatives drop the chosen value, bad dates and extras beyond two", async () => {
  answer = reply(WITH_CONFIDENCE);
  const { result } = await run({ kind: "pdf", pdf: PDF_B64, wantConfidence: true });
  assert.deepEqual(result.alternatives.issuer, ["Cascade Natural Gas"]);
  assert.deepEqual(result.alternatives.docDate, ["2026-10-03"]);
  const { alternatives } = lib.normalizeConfidence({ alternatives: { folder: ["06 Home", "Bills", "04 Insurance", "11 Other", "02 Taxes"] } }, GOOD);
  assert.deepEqual(alternatives.folder, ["04 Insurance", "11 Other"]);
});

test("missing or out-of-range scores count as unsure, not sure", () => {
  const { confidence } = lib.normalizeConfidence({ confidence: { issuer: 7, docDate: -1, title: "high" } }, GOOD);
  assert.equal(confidence.fields.issuer, 1);
  assert.equal(confidence.fields.docDate, 0);
  assert.equal(confidence.fields.title, 0);
  assert.equal(confidence.fields.verdict, 0);
  assert.equal(confidence.overall, 0);
  assert.equal(lib.normalizeConfidence(null, GOOD).confidence.overall, 0);
});

// ---------- sender rules (#21) ----------
test("cleanSenderHints keeps good rules and drops bad ones", () => {
  const hints = lib.cleanSenderHints([RULE, null, { issuer: "" }, { issuer: "Acme", folder: "Bills", verdict: "burn" }, "x"]);
  assert.equal(hints.length, 2);
  assert.deepEqual(hints[1], { key: "acme", issuer: "Acme" });
  assert.equal(lib.cleanSenderHints(Array(300).fill(RULE)).length, 200);
});

test("renderFilename fills every token", () => {
  assert.equal(lib.renderFilename("{date}_cascade-electric-bill", GOOD), "2026-09-28_cascade-electric-bill");
  assert.equal(lib.renderFilename("{yyyy}-{mm}_{issuer}_{type}", GOOD), "2026-09_cascade-power-light_utility-bill");
  assert.equal(lib.renderFilename("{date}_x", { ...GOOD, docDate: "" }), "0000-00-00_x");
  assert.equal(lib.renderFilename("a/b:{yyyy}.pdf", GOOD), "a-b-2026");
});

test("a matching rule is applied deterministically and its fields become certain", () => {
  const card = { ...GOOD, ...lib.normalizeConfidence(WITH_CONFIDENCE, GOOD) };
  const once = lib.applySenderRule(card, lib.cleanSenderHints([RULE]));
  const twice = lib.applySenderRule(card, lib.cleanSenderHints([RULE]));
  assert.deepEqual(once, twice);
  assert.equal(once.appliedRule, "cascade-power-light");
  assert.equal(once.folder, "06 Home");
  assert.equal(once.verdict, "shred");
  assert.equal(once.docType, "Electric bill");
  assert.equal(once.filename, "2026-09-28_cascade-electric-bill");
  assert.equal(once.confidence.fields.issuer, 1);
  assert.equal(once.confidence.fields.verdict, 1);
  assert.equal(once.confidence.fields.docDate, 0.55, "the date is not the rule's to fix");
  assert.equal(once.confidence.overall, 0.55);
  assert.deepEqual(once.alternatives.issuer, []);
  assert.deepEqual(once.alternatives.docDate, ["2026-10-03"]);
});

test("the rule's spelling wins when the sender slug matches", () => {
  const out = lib.applySenderRule({ ...GOOD, issuer: "CASCADE power + light", paperless: { ...GOOD.paperless, issuer: "Cascade Power and Light" } }, lib.cleanSenderHints([RULE]));
  assert.equal(out.issuer, "Cascade Power & Light");
  assert.equal(out.appliedRule, "cascade-power-light");
});

test("no matching rule leaves the card alone; a partial rule sets only what it has", () => {
  assert.equal(lib.applySenderRule(GOOD, lib.cleanSenderHints([{ ...RULE, issuer: "Duke Energy", key: "" }])), GOOD);
  const out = lib.applySenderRule(GOOD, lib.cleanSenderHints([{ issuer: "Cascade Power & Light", folder: "04 Insurance" }]));
  assert.equal(out.folder, "04 Insurance");
  assert.equal(out.verdict, GOOD.verdict);
  assert.equal(out.filename, GOOD.filename);
  assert.equal(out.confidence, undefined, "a rule never invents confidence the request didn't ask for");
});

test("sender hints reach Claude as known names, and the rule is applied to the reply", async () => {
  calls = []; answer = reply({ ...WITH_CONFIDENCE, issuer: "CASCADE POWER & LIGHT" });
  const { result } = await run({ kind: "pdf", pdf: PDF_B64, wantConfidence: true, senderHints: [RULE] });
  assert.match(calls[0].messages[0].content.at(-1).text, /Senders this person has filed before.*"Cascade Power & Light"/);
  assert.equal(result.appliedRule, "cascade-power-light");
  assert.equal(result.verdict, "shred");
});

// ---------- OCR hint ----------
test("ocrText goes into the user turn, capped", () => {
  const req = lib.buildRequest(lib.validate({ kind: "pdf", pdf: PDF_B64, ocrText: "Cascade Power\nAmount due $96.40" }), ctx);
  const text = req.messages[0].content.at(-1).text;
  assert.match(text, /^The attached PDF is ONE document/);
  assert.match(text, /<ocr>\nCascade Power\nAmount due \$96\.40\n<\/ocr>/);
  assert.equal(lib.validate({ kind: "pdf", pdf: PDF_B64, ocrText: "x".repeat(30000) }).ocrText.length, lib.MAX_OCR_CHARS);
});
