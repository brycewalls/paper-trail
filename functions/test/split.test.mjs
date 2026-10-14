// Unit tests for the classify function's split mode (#19, stack mode): the app sends a scanned pile
// (each page's OCR text plus an optional small thumbnail) and gets back where each document starts,
// with a short label. Requests without mode: "split" must be exactly what they were, so the web app
// and the app's ordinary reads never notice. Claude is stood in by a fake client.
// Run: node --test functions/test/
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

const auth = (email) => ({ uid: "u1", token: { email, email_verified: true } });
const ctx = { model: "claude-opus-5-5", effort: "low", today: "2026-10-13" };
const JPEG = { type: "image/jpeg", data: Buffer.from("fake jpeg bytes").toString("base64") };
const PDF_B64 = Buffer.from("%PDF-1.4 fake").toString("base64");
const CARD = {
  title: "Duke Energy bill, March 2024", docType: "Utility bill", issuer: "Duke Energy", docDate: "2024-03-12",
  summary: "Electric bill.", folder: "06 Home", filename: "2024-03-12_duke-energy-electric-bill",
  verdict: "shred", verdictReason: "Online.", retention: "Not needed", sensitive: false,
  paperless: { possible: true, issuer: "Duke Energy", how: "Billing preferences." },
};
const STACK = [
  { text: "Duke Energy\nStatement date March 12, 2024\nPage 1 of 2", image: JPEG },
  { text: "Duke Energy\nPage 2 of 2\nUsage history", image: JPEG },
  { text: "Blue Cross\nExplanation of benefits", image: JPEG },
  { text: "", image: JPEG },
  { text: "Big Box Furniture\n40% off sofas" },
];

let calls = [], answer = null;
const reply = (obj, extra = {}) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 60 }, ...extra });
before(() => {
  deps.client = () => ({ beta: { messages: { create: async (req) => { calls.push(req); if (answer instanceof Error) throw answer; return answer; } } } });
  deps.today = () => "2026-10-13";
  deps.log = () => {};
});
const run = (request) => lib.classify(request, deps);
const rejectsWith = (p, code) => assert.rejects(p, (e) => e.code === code, code);

// ---------- backward compatibility ----------
test("a request without mode is still an ordinary read", async () => {
  calls = []; answer = reply(CARD);
  const out = await run({ auth: auth(OWNER), data: { kind: "pdf", pdf: PDF_B64 } });
  assert.deepEqual(out.result, CARD);
  assert.equal(calls[0].system[0].text, lib.SYSTEM_PROMPT);
  assert.deepEqual(calls[0].output_config.format.schema, lib.RESULT_SCHEMA);
});

test("an unknown mode is ignored, never treated as a split", async () => {
  calls = []; answer = reply(CARD);
  const out = await run({ auth: auth(OWNER), data: { mode: "something", kind: "pdf", pdf: PDF_B64 } });
  assert.equal(out.result.title, CARD.title);
  assert.equal(calls[0].system[0].text, lib.SYSTEM_PROMPT);
});

// ---------- auth ----------
test("split: signed out and other accounts never reach Claude", async () => {
  calls = []; answer = reply({ documents: [] });
  const data = { mode: "split", pages: STACK };
  await rejectsWith(run({ data }), "signed_out");
  await rejectsWith(run({ data, auth: auth("someone@example.test") }), "not_allowed");
  assert.equal(calls.length, 0);
});

// ---------- validation ----------
test("validateSplit: needs pages, caps the count, keeps text and good pictures", () => {
  const bad = (data, code) => assert.throws(() => lib.validateSplit(data), (e) => e.code === code);
  bad({ mode: "split" }, "bad_request");
  bad({ mode: "split", pages: [] }, "bad_request");
  bad({ mode: "split", pages: Array(lib.MAX_SPLIT_PAGES + 1).fill({ text: "x" }) }, "too_large");
  const out = lib.validateSplit({
    mode: "split",
    pages: [
      { text: "  Duke Energy  ", image: JPEG },
      { text: 42, image: { type: "image/gif", data: "AAAA" } },
      null,
      { text: "y".repeat(lib.MAX_SPLIT_PAGE_CHARS + 50), image: { type: "image/jpeg", data: "not base64!" } },
    ],
  });
  assert.deepEqual(out.pages[0], { text: "Duke Energy", image: JPEG });
  assert.deepEqual(out.pages[1], { text: "" });
  assert.deepEqual(out.pages[2], { text: "" });
  assert.equal(out.pages[3].text.length, lib.MAX_SPLIT_PAGE_CHARS);
  assert.equal(out.pages[3].image, undefined);
});

test("validateSplit: pictures past the API's image limit are dropped, the pages stay", () => {
  const out = lib.validateSplit({ mode: "split", pages: Array(lib.MAX_SPLIT_IMAGES + 5).fill({ text: "p", image: JPEG }) });
  assert.equal(out.pages.length, lib.MAX_SPLIT_IMAGES + 5);
  assert.equal(out.pages.filter((p) => p.image).length, lib.MAX_SPLIT_IMAGES);
});

test("split: bad input is invalid-argument and never reaches Claude", async () => {
  calls = []; answer = reply({ documents: [] });
  await rejectsWith(run({ auth: auth(OWNER), data: { mode: "split", pages: "nope" } }), "bad_request");
  assert.equal(calls.length, 0);
});

// ---------- the request to Claude ----------
test("buildSplitRequest: every page in order, picture then text, cached prompt, schema-bound", () => {
  const req = lib.buildSplitRequest(lib.validateSplit({ mode: "split", pages: STACK }), ctx);
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.system[0].text, lib.SPLIT_PROMPT);
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(req.output_config, { effort: "low", format: { type: "json_schema", schema: lib.SPLIT_SCHEMA } });
  const c = req.messages[0].content;
  assert.deepEqual(c.slice(0, 3), [
    { type: "text", text: "Page 1:" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG.data } },
    { type: "text", text: "<ocr>\nDuke Energy\nStatement date March 12, 2024\nPage 1 of 2\n</ocr>" },
  ]);
  assert.equal(c.filter((b) => b.type === "image").length, 4);
  assert.ok(c.some((b) => b.text === "(no text read from this page)"));
  assert.equal(c.at(-1).text, "That is the whole stack: 5 pages in scan order. Today is 2026-10-13.");
  assert.deepEqual(req.fallbacks, "default");
});

test("the split prompt asks for start pages and labels, and keeps the no full numbers rule", () => {
  assert.match(lib.SPLIT_PROMPT, /firstPage/);
  assert.match(lib.SPLIT_PROMPT, /label/);
  assert.match(lib.SPLIT_PROMPT, /Never write a full SSN/);
  assert.match(lib.SPLIT_PROMPT, /When unsure, keep pages together/);
  assert.ok(!lib.SPLIT_PROMPT.includes("—"), "no em dashes");
});

// ---------- normalizing the answer ----------
test("normalizeSplit: start pages become ranges that cover every page once, in order", () => {
  const out = lib.normalizeSplit({ documents: [
    { firstPage: 1, label: "Duke Energy bill" },
    { firstPage: 3, label: "Blue Cross EOB" },
    { firstPage: 5, label: "Furniture flyer" },
  ] }, 5);
  assert.deepEqual(out.documents, [
    { start: 0, end: 1, label: "Duke Energy bill" },
    { start: 2, end: 3, label: "Blue Cross EOB" },
    { start: 4, end: 4, label: "Furniture flyer" },
  ]);
});

test("normalizeSplit: repairs unsorted, repeated, out of range and missing starts", () => {
  const out = lib.normalizeSplit({ documents: [
    { firstPage: 4, label: "  Second   thing " },
    { firstPage: 4, label: "dup" },
    { firstPage: 0, label: "zero" },
    { firstPage: 9, label: "past the end" },
    { firstPage: 2.5, label: "fraction" },
    { firstPage: 3, label: "" },
    "garbage",
  ] }, 5);
  assert.deepEqual(out.documents, [
    { start: 0, end: 1, label: "Document 1" },
    { start: 2, end: 2, label: "Document 2" },
    { start: 3, end: 4, label: "Second thing" },
  ]);
});

test("normalizeSplit: nothing usable is one document", () => {
  assert.deepEqual(lib.normalizeSplit({}, 3).documents, [{ start: 0, end: 2, label: "Document 1" }]);
  assert.deepEqual(lib.normalizeSplit(null, 1).documents, [{ start: 0, end: 0, label: "Document 1" }]);
});

test("normalizeSplit: labels are capped", () => {
  const out = lib.normalizeSplit({ documents: [{ firstPage: 1, label: "x".repeat(200) }] }, 1);
  assert.equal(out.documents[0].label.length, 60);
});

// ---------- the whole call ----------
test("split: the owner gets { split: { documents }, model }", async () => {
  calls = []; answer = reply({ documents: [{ firstPage: 1, label: "Duke Energy bill" }, { firstPage: 3, label: "Blue Cross EOB" }, { firstPage: 5, label: "Flyer" }] });
  const out = await run({ auth: auth(OWNER), data: { mode: "split", pages: STACK } });
  assert.equal(calls.length, 1);
  assert.equal(out.model, "claude-opus-5-5");
  assert.deepEqual(out.split.documents.map((d) => [d.start, d.end]), [[0, 1], [2, 3], [4, 4]]);
  assert.equal(out.result, undefined);
});

test("split: refusal, cut-off and garbled answers map to their codes", async () => {
  const req = { auth: auth(OWNER), data: { mode: "split", pages: STACK } };
  answer = reply({}, { stop_reason: "refusal" }); await rejectsWith(run(req), "refused");
  answer = reply({}, { stop_reason: "max_tokens" }); await rejectsWith(run(req), "invalid_json");
  answer = { ...reply({}), content: [{ type: "text", text: "{nope" }] }; await rejectsWith(run(req), "invalid_json");
  answer = new Error("boom"); await rejectsWith(run(req), "unknown");
});

test("callable: a split goes through the same deployed classify function", async () => {
  answer = reply({ documents: [{ firstPage: 1, label: "Stack" }] });
  const out = await fns.classify.run({ auth: auth(OWNER), data: { mode: "split", pages: STACK.slice(0, 2) } });
  assert.deepEqual(out.split.documents, [{ start: 0, end: 1, label: "Stack" }]);
});
