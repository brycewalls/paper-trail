// Unit tests for the classify function: prompt and request building, normalize(), the allowlist,
// input validation, error mapping, and the callable wiring. Claude is stood in by a fake client, so
// nothing leaves the machine and no key is needed. Run: node --test functions/test/
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OWNER = "owner@example.test";
process.env.ALLOWED_EMAILS = OWNER;          // what functions/.env sets when deployed
process.env.CLAUDE_MODEL = "claude-opus-5-5";
process.env.CLAUDE_EFFORT = "low";
process.env.GCLOUD_PROJECT = "demo-test";
const lib = require("../lib.js");
const fns = require("../index.js");
const deps = require("../deps.js");
const Anthropic = deps.Anthropic;

const GOOD = {
  title: "Duke Energy bill, March 2024", docType: "Utility bill", issuer: "Duke Energy", docDate: "2024-03-12",
  summary: "Electric bill for $84.12 on account ending 4411.", folder: "06 Home", filename: "2024-03-12_duke-energy-electric-bill",
  verdict: "shred", verdictReason: "Duke keeps statements online.", retention: "Not needed", sensitive: false,
  paperless: { possible: true, issuer: "Duke Energy", how: "Turn on paperless billing under Account, Billing preferences." },
};
const PDF_B64 = Buffer.from("%PDF-1.4 fake").toString("base64");
const auth = (email, verified = true) => ({ uid: "u1", token: { email, email_verified: verified } });

// A stand-in for new Anthropic(): records each request and answers with whatever the test set.
let calls = [], answer = null;
function fakeClient() {
  return { beta: { messages: { create: async (req) => { calls.push(req); if (answer instanceof Error) throw answer; return answer; } } } };
}
const reply = (obj, extra = {}) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 5000, output_tokens: 400 }, ...extra });

before(() => {
  deps.client = fakeClient;
  deps.today = () => "2026-10-13";
  deps.log = () => {};
});

// ---------- prompt and request ----------
test("system prompt keeps the artifact's fields, folders and verdict rules", () => {
  for (const f of ["title", "docType", "issuer", "docDate", "summary", "folder", "filename", "verdict", "verdictReason", "retention", "sensitive", "paperless"]) assert.match(lib.SYSTEM_PROMPT, new RegExp(`"${f}"`));
  for (const name of lib.FOLDER_NAMES) assert.ok(lib.SYSTEM_PROMPT.includes(name), name);
  assert.match(lib.SYSTEM_PROMPT, /keep_original: the paper itself has legal value/);
  assert.match(lib.SYSTEM_PROMPT, /Never write a full SSN/);
  assert.equal(lib.FOLDER_NAMES.length, 11);
});

test("userText describes a PDF, a full photo set and a partial one", () => {
  assert.equal(lib.userText({ kind: "pdf", totalPages: 2, sentPages: 2 }, "2026-10-13"), "The attached PDF is ONE document (2 pages in all). Today is 2026-10-13.");
  assert.equal(lib.userText({ kind: "images", totalPages: 1, sentPages: 1 }, "2026-10-13"), "The 1 attached image(s) are the page(s) of ONE document, in order. Today is 2026-10-13.");
  assert.match(lib.userText({ kind: "images", totalPages: 40, sentPages: 10 }, "x"), /\(the first 10 of 40\)/);
});

test("buildRequest: PDF goes as a document block, the system prompt is cached, the reply is schema-bound", () => {
  const req = lib.buildRequest({ kind: "pdf", pdf: PDF_B64, totalPages: 2, sentPages: 2 }, { model: "claude-opus-5-5", effort: "low", today: "2026-10-13" });
  assert.equal(req.model, "claude-opus-5-5");
  assert.deepEqual(req.messages[0].content[0], { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF_B64 } });
  assert.equal(req.messages[0].content.at(-1).type, "text");
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  assert.equal(req.output_config.effort, "low");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.format.schema.additionalProperties, false);
  assert.deepEqual(req.output_config.format.schema.properties.folder.enum, lib.FOLDER_NAMES);
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.thinking, undefined, "Opus 5.5 thinking is always on; sending a config could 400");
  assert.equal(req.temperature, undefined);
});

test("buildRequest: images go as image blocks in order; models without fallbacks get none", () => {
  const req = lib.buildRequest({ kind: "images", images: [{ type: "image/jpeg", data: "AAAA" }, { type: "image/png", data: "BBBB" }], totalPages: 2, sentPages: 2 }, { model: "claude-haiku-5-5", effort: "low", today: "t" });
  assert.deepEqual(req.messages[0].content.slice(0, 2).map((b) => [b.type, b.source.media_type, b.source.data]), [["image", "image/jpeg", "AAAA"], ["image", "image/png", "BBBB"]]);
  assert.equal(req.fallbacks, undefined);
  assert.equal(req.betas, undefined);
});

// ---------- normalize ----------
test("normalize passes a good answer through unchanged", () => {
  assert.deepEqual(lib.normalize(GOOD), GOOD);
});

test("normalize repairs a bad answer", () => {
  const r = lib.normalize({ folder: "Bills", verdict: "burn", docDate: "March 2024", issuer: "Duke Energy!", filename: "", title: "x".repeat(300), paperless: "yes" });
  assert.equal(r.folder, "11 Other");
  assert.equal(r.verdict, "scan_shred");
  assert.equal(r.docDate, "");
  assert.equal(r.filename, "0000-00-00_duke-energy");
  assert.equal(r.title.length, 140);
  assert.deepEqual(r.paperless, { possible: false, issuer: "Duke Energy!", how: "" });
  assert.equal(lib.normalize(null).title, "Untitled document");
  assert.equal(lib.normalize({ filename: "a/b:c.pdf" }).filename, "a-b-c");
});

// ---------- allowlist ----------
test("parseAllowlist and isAllowed", () => {
  const list = lib.parseAllowlist(" A@x.test, b@y.test  c@z.test,,");
  assert.deepEqual(list, ["a@x.test", "b@y.test", "c@z.test"]);
  assert.equal(lib.isAllowed({ email: "A@X.test", email_verified: true }, list), true);
  assert.equal(lib.isAllowed({ email: "a@x.test", email_verified: false }, list), false);
  assert.equal(lib.isAllowed({ email: "d@x.test", email_verified: true }, list), false);
  assert.equal(lib.isAllowed({ email_verified: true }, list), false);
  assert.equal(lib.isAllowed(null, list), false);
  assert.equal(lib.isAllowed({ email: "a@x.test", email_verified: true }, lib.parseAllowlist("")), false);
});

const run = (request) => lib.classify(request, deps);
const rejectsWith = (p, code) => assert.rejects(p, (e) => e instanceof lib.ClassifyError && e.code === code);

test("classify: signed out, unverified, another account and an empty allowlist never reach Claude", async () => {
  calls = []; answer = reply(GOOD);
  const data = { kind: "pdf", pdf: PDF_B64, totalPages: 1 };
  await rejectsWith(run({ data }), "signed_out");
  await rejectsWith(run({ data, auth: auth(OWNER, false) }), "not_allowed");
  await rejectsWith(run({ data, auth: auth("someone@example.test") }), "not_allowed");
  const keep = process.env.ALLOWED_EMAILS; process.env.ALLOWED_EMAILS = "";
  try { await rejectsWith(run({ data, auth: auth(OWNER) }), "not_allowed"); } finally { process.env.ALLOWED_EMAILS = keep; }
  assert.equal(calls.length, 0);
});

// ---------- validation ----------
test("classify: bad input is invalid-argument and never reaches Claude", async () => {
  calls = []; answer = reply(GOOD);
  const a = auth(OWNER);
  await rejectsWith(run({ auth: a, data: {} }), "bad_request");
  await rejectsWith(run({ auth: a, data: { kind: "pdf", pdf: "not base64!" } }), "bad_request");
  await rejectsWith(run({ auth: a, data: { kind: "images", images: [] } }), "bad_request");
  await rejectsWith(run({ auth: a, data: { kind: "images", images: [{ type: "image/gif", data: "AAAA" }] } }), "bad_request");
  await rejectsWith(run({ auth: a, data: { kind: "images", images: Array(11).fill({ type: "image/jpeg", data: "AAAA" }) } }), "bad_request");
  await rejectsWith(run({ auth: a, data: { kind: "pdf", pdf: "A".repeat(lib.MAX_BASE64_CHARS + 4) } }), "too_large");
  assert.equal(calls.length, 0);
});

// ---------- the Claude call ----------
test("classify: the owner gets the normalized card back", async () => {
  calls = []; answer = reply({ ...GOOD, folder: "Nope" });
  const out = await run({ auth: auth(OWNER), data: { kind: "pdf", pdf: PDF_B64, totalPages: 2 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "claude-opus-5-5");
  assert.match(calls[0].messages[0].content.at(-1).text, /2 pages in all\). Today is 2026-10-13\./);
  assert.equal(out.result.folder, "11 Other");
  assert.equal(out.result.title, GOOD.title);
  assert.equal(out.model, "claude-opus-5-5");
});

test("classify: refusal, cut-off and garbled answers map to their codes", async () => {
  const req = { auth: auth(OWNER), data: { kind: "pdf", pdf: PDF_B64 } };
  answer = reply(GOOD, { stop_reason: "refusal" }); await rejectsWith(run(req), "refused");
  answer = reply(GOOD, { stop_reason: "max_tokens" }); await rejectsWith(run(req), "invalid_json");
  answer = { ...reply(GOOD), content: [{ type: "text", text: "{not json" }] }; await rejectsWith(run(req), "invalid_json");
});

test("classify: SDK errors map to codes the page has copy for", async () => {
  const req = { auth: auth(OWNER), data: { kind: "pdf", pdf: PDF_B64 } };
  const h = new Headers();
  const cases = [
    [new Anthropic.RateLimitError(429, {}, "rate limited", h), "rate_limited", "resource-exhausted"],
    [new Anthropic.AuthenticationError(401, {}, "bad key", h), "api_key", "failed-precondition"],
    [new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "PDF exceeds maximum pages" } }, undefined, h), "too_large", "invalid-argument"],
    [new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "messages: field required" } }, undefined, h), "bad_request", "invalid-argument"],
    [new Anthropic.InternalServerError(500, {}, "oops", h), "overloaded", "unavailable"],
    [new Anthropic.APIError(529, {}, "overloaded", h), "overloaded", "unavailable"],
    [new Anthropic.APIConnectionTimeoutError({ message: "timed out" }), "timeout", "deadline-exceeded"],
    [new Error("boom"), "unknown", "internal"],
  ];
  for (const [err, code, status] of cases) {
    answer = err;
    await assert.rejects(run(req), (e) => e.code === code && e.status === status, `${err.constructor.name} -> ${code}`);
  }
});

// ---------- the deployed callable ----------
test("callable: another account gets permission-denied with a code in details", async () => {
  calls = []; answer = reply(GOOD);
  await assert.rejects(fns.classify.run({ auth: auth("someone@example.test"), data: { kind: "pdf", pdf: PDF_B64 } }),
    (e) => e.code === "permission-denied" && e.details && e.details.code === "not_allowed");
  assert.equal(calls.length, 0);
});

test("callable: the owner gets { result, model }", async () => {
  answer = reply(GOOD);
  const out = await fns.classify.run({ auth: auth(OWNER), data: { kind: "pdf", pdf: PDF_B64 } });
  assert.deepEqual(out.result, GOOD);
});

test("callable: deploys in us-central1 with the secret, a long timeout and room for big scans", () => {
  const ep = fns.classify.__endpoint;
  assert.deepEqual(ep.region, ["us-central1"]);
  assert.ok(ep.callableTrigger, "is a callable");
  assert.equal(ep.timeoutSeconds, 300);
  assert.equal(ep.availableMemoryMb, 1024);
  assert.deepEqual(ep.secretEnvironmentVariables.map((s) => s.key), ["ANTHROPIC_API_KEY"]);
});
