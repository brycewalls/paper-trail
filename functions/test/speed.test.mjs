// Unit tests for #75 (Claude's read is slow on the iPhone): the OCR-first request with one small
// first-page picture, a byte-stable cached system prompt, timing and cache logs, and the eval
// script's request building. The web app's request shape is checked again here, because the
// classify deploy after this change depends on it. Claude is stood in by a fake client.
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
require("../index.js");   // wires deps.allowlist, model and effort the way the deployed function does
const deps = require("../deps.js");
const { loadFixtures, requestData, estimateTokens } = await import("../tools/eval-classify.mjs");

const GOOD = {
  title: "Electric bill, September", docType: "Utility bill", issuer: "Cascade Power & Light", docDate: "2026-09-28",
  summary: "Electric bill, $96.40 due on account ending 0412.", folder: "06 Home", filename: "2026-09-28_cascade-power-electric-bill",
  verdict: "scan_shred", verdictReason: "Routine bill worth a record for a year.", retention: "Keep 1 year", sensitive: false,
  paperless: { possible: true, issuer: "Cascade Power & Light", how: "Account settings, then Billing, then Paper bill off." },
};
const PDF_B64 = Buffer.from("%PDF-1.4 fake").toString("base64");
const JPEG = "/9j/4AAQSkZJRgABAQ";
const OCR = "CASCADE POWER & LIGHT\nStatement date: September 28, 2026\nAmount due $96.40";
const ctx = (today = "2026-10-14") => ({ model: "claude-opus-5-5", effort: "low", today });
const auth = { uid: "u1", token: { email: OWNER, email_verified: true } };

// What the 0.4 app sends when the OCR text is there: one small first page plus every page's text.
const IPHONE = { kind: "images", images: [{ type: "image/jpeg", data: JPEG }], totalPages: 5, ocrText: OCR, ocrPrimary: true, wantConfidence: true };

let calls = [], logs = [], answer = null, clock = 0;
before(() => {
  deps.client = () => ({ beta: { messages: { create: async (req) => { calls.push(req); clock += 4200; return answer; } } } });
  deps.today = () => "2026-10-14";
  deps.now = () => (clock += 5);
  deps.log = (msg, data) => logs.push([msg, data]);
});

// ---------- the OCR-first request ----------
test("ocrPrimary: one picture, then the text of every page as the main source", () => {
  const input = lib.validate(IPHONE);
  assert.equal(input.ocrPrimary, true);
  assert.equal(input.totalPages, 5);
  assert.equal(input.sentPages, 1);
  const req = lib.buildRequest(input, ctx());
  const content = req.messages[0].content;
  assert.equal(content.length, 2, "one image block and one text block");
  assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG } });
  assert.equal(content.filter((b) => b.type === "document").length, 0, "no PDF");
  const text = content[1].text;
  assert.match(text, /^The attached image is a scaled-down picture of the first page of ONE document \(5 pages in all\)\. The text of the pages, read on the phone, is below\. Today is 2026-10-14\./);
  assert.match(text, /Text of the pages, read on the phone \(OCR, may have small errors; the picture shows the layout, logos and handwriting\):\n<ocr>\nCASCADE POWER & LIGHT/);
  assert.doesNotMatch(text, /the pages themselves win/);
});

test("ocrPrimary is ignored without text or on a PDF, so the read never loses its source", () => {
  assert.equal(lib.validate({ ...IPHONE, ocrText: "   " }).ocrPrimary, false);
  assert.equal(lib.validate({ ...IPHONE, ocrText: undefined }).ocrPrimary, false);
  assert.equal(lib.validate({ kind: "pdf", pdf: PDF_B64, ocrText: OCR, ocrPrimary: true }).ocrPrimary, false);
  assert.equal(lib.validate({ ...IPHONE, ocrPrimary: "yes" }).ocrPrimary, false);
  const text = lib.buildRequest(lib.validate({ ...IPHONE, ocrPrimary: false, totalPages: 1 }), ctx()).messages[0].content.at(-1).text;
  assert.match(text, /^The 1 attached image\(s\) are the page\(s\) of ONE document, in order\./);
  assert.match(text, /the pages themselves win/);
});

test("the 0.3 app's PDF request still reads the same way", () => {
  const req = lib.buildRequest(lib.validate({ kind: "pdf", pdf: PDF_B64, totalPages: 5, ocrText: OCR, wantConfidence: true }), ctx());
  assert.equal(req.messages[0].content[0].type, "document");
  assert.match(req.messages[0].content.at(-1).text, /^The attached PDF is ONE document \(5 pages in all\)\. Today is 2026-10-14\.\n\nText read from the pages on the phone/);
});

// ---------- the web app's request shape (checked before every classify deploy) ----------
test("web app: PDF and images requests are byte for byte what they were", () => {
  const pdf = lib.buildRequest(lib.validate({ kind: "pdf", pdf: PDF_B64, totalPages: 2 }), ctx("2026-10-13"));
  assert.deepEqual(pdf.system, [{ type: "text", text: lib.SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  assert.equal(pdf.output_config.format.schema, lib.RESULT_SCHEMA);
  assert.deepEqual(pdf.messages, [{ role: "user", content: [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF_B64 } },
    { type: "text", text: "The attached PDF is ONE document (2 pages in all). Today is 2026-10-13." },
  ] }]);
  const images = lib.buildRequest(lib.validate({ kind: "images", images: [{ type: "image/jpeg", data: "AAAA" }, { type: "image/png", data: "BBBB" }], totalPages: 12 }), ctx("2026-10-13"));
  assert.equal(images.messages[0].content.at(-1).text, "The 2 attached image(s) are the page(s) of ONE document, in order (the first 2 of 12). Today is 2026-10-13.");
  assert.equal(images.system[0].text, lib.SYSTEM_PROMPT);
});

test("web app: the reply has no confidence keys", async () => {
  answer = { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(GOOD) }], usage: {} };
  const { result } = await lib.classify({ auth, data: { kind: "pdf", pdf: PDF_B64 } }, deps);
  assert.deepEqual(result, GOOD);
});

// ---------- prompt cache ----------
test("cache_control sits on the one system block; nothing in the user turn is cached", () => {
  const req = lib.buildRequest(lib.validate(IPHONE), ctx());
  assert.equal(req.system.length, 1);
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  for (const block of req.messages[0].content) assert.equal(block.cache_control, undefined);
  assert.equal(JSON.stringify(req.messages).includes("cache_control"), false);
});

test("the cached prefix is byte-stable across documents, dates, senders and request shapes", () => {
  const variants = [
    lib.buildRequest(lib.validate(IPHONE), ctx("2026-10-14")),
    lib.buildRequest(lib.validate({ ...IPHONE, totalPages: 1, ocrText: "Something else entirely" }), ctx("2027-01-01")),
    lib.buildRequest(lib.validate({ ...IPHONE, senderHints: [{ key: "harborline-mutual", issuer: "Harborline Mutual", folder: "04 Insurance" }] }), ctx()),
    lib.buildRequest(lib.validate({ kind: "pdf", pdf: PDF_B64, totalPages: 3, ocrText: OCR, wantConfidence: true }), ctx()),
    lib.buildRequest(lib.validate({ kind: "images", images: [{ type: "image/jpeg", data: JPEG }, { type: "image/jpeg", data: JPEG }], totalPages: 2, wantConfidence: true }), ctx()),
  ];
  const prefix = (r) => JSON.stringify([r.model, r.system, r.output_config, r.betas, r.fallbacks]);
  for (const r of variants) assert.equal(prefix(r), prefix(variants[0]));
  assert.equal(variants[0].system[0].text, lib.SYSTEM_PROMPT + lib.CONFIDENCE_PROMPT);
  for (const r of variants) assert.doesNotMatch(r.system[0].text, /2026-10-14|2027-01-01/, "today's date stays in the user turn");
  assert.doesNotMatch(variants[2].system[0].text, /Harborline Mutual/, "sender hints stay in the user turn");
  assert.match(variants[2].messages[0].content.at(-1).text, /Harborline Mutual/);
});

test("the prefix is over Claude Opus 5.5's 512 token cache minimum", () => {
  const { prefix } = estimateTokens(lib.buildRequest(lib.validate(IPHONE), ctx()));
  assert.ok(prefix > 1024, `about ${prefix} tokens`);
  assert.ok(lib.SYSTEM_PROMPT.length / 4 > 512, "even the bare prompt clears it");
});

// ---------- timing and cache logs ----------
test("classify logs total and Claude time plus cache writes and reads", async () => {
  logs = []; clock = 0;
  answer = { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...GOOD, unsure: [] }) }],
    usage: { input_tokens: 1290, output_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 2315 } };
  await lib.classify({ auth, data: IPHONE }, deps);
  const [msg, data] = logs.find(([m]) => m === "classify: done");
  assert.equal(msg, "classify: done");
  assert.equal(data.claude_ms, 4205, "the fake call takes 4.2 s");
  assert.ok(data.total_ms > data.claude_ms);
  assert.equal(data.cache_read, 2315);
  assert.equal(data.cache_write, 0);
  assert.equal(data.ocr_primary, true);
  assert.equal(data.pages, 5);
  assert.equal(data.sent, 1);
  assert.equal(data.input_tokens, 1290);
});

test("a failed call still logs its timing", async () => {
  logs = [];
  const saved = deps.client;
  deps.client = () => ({ beta: { messages: { create: async () => { throw new Error("socket hang up"); } } } });
  await assert.rejects(lib.classify({ auth, data: IPHONE }, deps));
  deps.client = saved;
  assert.ok(logs.some(([m, d]) => m === "classify: timing" && d.failed === true && typeof d.claude_ms === "number"));
});

// ---------- eval script ----------
test("eval fixtures build valid requests in both shapes and the new one is much smaller", () => {
  const docs = loadFixtures();
  assert.equal(docs.length, 10);
  for (const doc of docs) {
    const oldInput = lib.validate(requestData(doc, "old"));
    const newInput = lib.validate(requestData(doc, "new"));
    assert.equal(oldInput.kind, "pdf");
    assert.equal(newInput.kind, "images");
    assert.equal(newInput.images.length, 1);
    assert.equal(newInput.ocrPrimary, true);
    assert.equal(newInput.totalPages, doc.pages);
    assert.ok(newInput.images[0].data.length < 120000, "a 1000 px JPEG, not a full page scan");
  }
  const lease = docs.find((d) => d.id === "lease");
  const before = estimateTokens(lib.buildRequest(lib.validate(requestData(lease, "old")), ctx()), lease.pages).turn;
  const after = estimateTokens(lib.buildRequest(lib.validate(requestData(lease, "new")), ctx()), 0, [[773, 1000]]).turn;
  assert.ok(after < before / 4, `5 pages: ${before} before, ${after} after`);
});
