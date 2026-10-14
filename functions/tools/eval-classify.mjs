#!/usr/bin/env node
// Compares Claude models (and the old and new request shapes) on the classify read (#75).
//
// Runs the synthetic documents in tools/eval-fixtures through the production request builder
// (lib.buildRequest, so the prompt, schema, caching and fallbacks are exactly what the function
// sends) and reports, per model: latency (p50, p90), tokens, cache hits, cost, agreement between the
// models field by field, and how often each matches the expected answer. The fixtures are made up
// (tools/eval-fixtures/make-fixtures.py); never point this at real paperwork.
//
// Usage, from functions/:
//   node tools/eval-classify.mjs --dry-run            no API calls: builds every request and prints
//                                                     estimated input tokens, old shape against new
//   ANTHROPIC_API_KEY=... node tools/eval-classify.mjs
//                                                     opus-5-5 at low effort against sonnet-5-5
//   options: --models claude-opus-5-5:low,claude-sonnet-5-5:low   model:effort pairs
//            --payload new|old|both   new = OCR text + first-page image (0.4 app), old = whole PDF
//            --runs 2                 passes over the set (the first pass writes the cache)
//            --only utility-bill,w2   a subset of fixture ids
//
// It reads the key from the environment only and never prints it. Each document costs about a cent
// per model and payload on Opus, so the default run (10 documents, 2 models, 2 runs) is about 25 cents.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const lib = require("../lib.js");
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "eval-fixtures");

// $ per million tokens (claude-api skill, cached 2026-10-06). Cache writes are 1.25x input (5 minute TTL).
const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const COMPARED = ["issuer", "docDate", "folder", "verdict"];

function args(argv) {
  const out = { models: "claude-opus-5-5:low,claude-sonnet-5-5:low", payload: "new", runs: 2, only: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--")) out[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  out.runs = Math.max(1, Number(out.runs) || 1);
  return out;
}

export function loadFixtures(only = "") {
  const docs = JSON.parse(readFileSync(join(FIXTURES, "docs.json"), "utf8"));
  const keep = only ? new Set(only.split(",")) : null;
  return docs.filter((d) => !keep || keep.has(d.id)).map((d) => ({
    ...d,
    pages: d.pageTexts.length,
    ocrText: d.pageTexts.join("\n\n"),
    pdf: () => readFileSync(join(FIXTURES, `${d.id}.pdf`)).toString("base64"),
    firstPage: () => readFileSync(join(FIXTURES, `${d.id}-p1.jpg`)).toString("base64"),
  }));
}

// What each app version sends for a document (ClassifyPayload.request in the app).
export function requestData(doc, payload) {
  const base = { totalPages: doc.pages, ocrText: doc.ocrText, wantConfidence: true };
  if (payload === "old") return { kind: "pdf", pdf: doc.pdf(), ...base };
  return { kind: "images", images: [{ type: "image/jpeg", data: doc.firstPage() }], ocrPrimary: true, ...base };
}

// Rough input token estimate without the API, for --dry-run and the PR's before and after table.
// - system prompt plus schema: scaled from the web app's logged cache size (1,803 tokens for the
//   2,893 character prompt plus its 954 character schema), since structured outputs add their own
//   scaffolding
// - text: 4 characters a token
// - an image: width x height / 750 after the API's 1568 px resize
// - a PDF page: about 2,400 tokens for the page picture plus its text layer (PDF pages are read as
//   both). Fitted to Bryce's two logged 0.3 reads (2,276 tokens for 1 page, 15,386 for 5, each
//   including the OCR text), which stay the ground truth.
const PREFIX_TOKENS_PER_CHAR = 1803 / (2893 + 954);
export function estimateTokens(req, pdfPages = 0, imageSizes = []) {
  const prefixChars = req.system.map((b) => b.text).join("").length + JSON.stringify(req.output_config.format.schema).length;
  const prefix = Math.round(prefixChars * PREFIX_TOKENS_PER_CHAR);
  let turn = 0;
  for (const block of req.messages[0].content) {
    if (block.type === "text") turn += Math.ceil(block.text.length / 4);
  }
  turn += pdfPages * 2400;
  for (const [w, h] of imageSizes) {
    const s = Math.min(1, 1568 / Math.max(w, h));
    turn += Math.ceil((w * s) * (h * s) / 750);
  }
  return { prefix, turn };
}

function jpegSize(b64) {
  const buf = Buffer.from(b64, "base64");
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [1000, 1000];
}

const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const norm = (field, v) => (field === "issuer" ? lib.slug(v) : String(v || ""));
const ctx = (model, effort) => ({ model, effort, today: "2026-10-14" });

function dryRun(docs) {
  console.log("Estimated input tokens per read (no API calls). Prefix = system prompt and schema, cached after the first read.");
  console.log("doc".padEnd(16), "pages".padStart(5), "old turn".padStart(9), "new turn".padStart(9), "saved".padStart(6));
  let oldSum = 0, newSum = 0, prefix = 0;
  for (const doc of docs) {
    const oldReq = lib.buildRequest(lib.validate(requestData(doc, "old")), ctx("claude-opus-5-5", "low"));
    const newData = requestData(doc, "new");
    const newReq = lib.buildRequest(lib.validate(newData), ctx("claude-opus-5-5", "low"));
    const o = estimateTokens(oldReq, doc.pages);
    const n = estimateTokens(newReq, 0, newData.images.map((im) => jpegSize(im.data)));
    oldSum += o.turn; newSum += n.turn; prefix = n.prefix;
    console.log(doc.id.padEnd(16), String(doc.pages).padStart(5), String(o.turn).padStart(9), String(n.turn).padStart(9), `${Math.round(100 - (100 * n.turn) / o.turn)}%`.padStart(6));
  }
  console.log(`total${" ".repeat(17)}${String(oldSum).padStart(9)} ${String(newSum).padStart(9)} ${`${Math.round(100 - (100 * newSum) / oldSum)}%`.padStart(6)}`);
  console.log(`Prefix (system prompt and schema, the same bytes on every read): about ${prefix} tokens.`);
}

async function main() {
  const opts = args(process.argv.slice(2));
  const docs = loadFixtures(opts.only);
  if (opts.dryRun) return dryRun(docs);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY to run the comparison, or pass --dry-run for the token estimates.");
    process.exit(2);
  }
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new (Anthropic.default || Anthropic)({ maxRetries: 2, timeout: 240000 });
  const models = opts.models.split(",").map((m) => { const [model, effort = "low"] = m.split(":"); return { model, effort, key: `${model}:${effort}` }; });
  const payloads = opts.payload === "both" ? ["old", "new"] : [opts.payload];
  const rows = [];
  for (let run = 0; run < opts.runs; run++) {
    for (const doc of docs) {
      for (const payload of payloads) {
        // One model at a time, in order, so each read can hit the cache the previous one wrote.
        for (const m of models) {
          const input = lib.validate(requestData(doc, payload));
          const req = lib.buildRequest(input, ctx(m.model, m.effort));
          const t0 = Date.now();
          let res, error = null;
          try { res = await client.beta.messages.create(req); } catch (e) { error = e.message; }
          const ms = Date.now() - t0;
          const row = { run, doc: doc.id, payload, key: `${m.key}/${payload}`, model: m.model, ms, error };
          if (res) {
            const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
            let card = null;
            try { const raw = JSON.parse(text); card = { ...lib.normalize(raw), ...lib.normalizeConfidence(raw, lib.normalize(raw)) }; } catch { row.error = `bad JSON (${res.stop_reason})`; }
            row.card = card;
            row.usage = res.usage || {};
          }
          rows.push(row);
          process.stdout.write(`${row.key.padEnd(34)} ${doc.id.padEnd(16)} ${String(ms).padStart(6)} ms ${row.error ? `ERROR ${row.error}` : `in ${row.usage.input_tokens} out ${row.usage.output_tokens} cache r/w ${row.usage.cache_read_input_tokens || 0}/${row.usage.cache_creation_input_tokens || 0}`}\n`);
        }
      }
    }
  }
  report(rows, docs);
}

function cost(model, u) {
  const p = PRICES[model];
  if (!p || !u) return 0;
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.input * 1.25) / 1e6;
}

function report(rows, docs) {
  const keys = [...new Set(rows.map((r) => r.key))];
  console.log("\nPer model and payload (all runs)");
  console.log("model/payload".padEnd(34), "p50 ms".padStart(7), "p90 ms".padStart(7), "in".padStart(6), "out".padStart(5), "cache hit".padStart(9), "$/doc".padStart(8), "expected".padStart(9), "errors".padStart(6));
  for (const key of keys) {
    const ok = rows.filter((r) => r.key === key && r.card);
    const ms = rows.filter((r) => r.key === key && !r.error).map((r) => r.ms);
    const avg = (f) => Math.round(ok.reduce((s, r) => s + f(r), 0) / Math.max(1, ok.length));
    const hits = ok.filter((r) => (r.usage.cache_read_input_tokens || 0) > 0).length;
    const dollars = ok.reduce((s, r) => s + cost(r.model, r.usage), 0) / Math.max(1, ok.length);
    let right = 0, total = 0;
    for (const r of ok) {
      const exp = docs.find((d) => d.id === r.doc).expected;
      for (const f of COMPARED) { total++; if (norm(f, r.card[f]) === norm(f, exp[f])) right++; }
    }
    console.log(key.padEnd(34), String(pct(ms, 0.5)).padStart(7), String(pct(ms, 0.9)).padStart(7), String(avg((r) => r.usage.input_tokens || 0)).padStart(6), String(avg((r) => r.usage.output_tokens || 0)).padStart(5), `${hits}/${ok.length}`.padStart(9), dollars.toFixed(4).padStart(8), `${Math.round((100 * right) / Math.max(1, total))}%`.padStart(9), String(rows.filter((r) => r.key === key && r.error).length).padStart(6));
  }
  if (keys.length > 1) {
    const [a, ...others] = keys;
    for (const b of others) {
      console.log(`\nField agreement, ${a} against ${b} (last run)`);
      const last = Math.max(...rows.map((r) => r.run));
      for (const f of [...COMPARED, "title", "filename"]) {
        let same = 0, n = 0;
        for (const doc of docs) {
          const x = rows.find((r) => r.run === last && r.doc === doc.id && r.key === a && r.card);
          const y = rows.find((r) => r.run === last && r.doc === doc.id && r.key === b && r.card);
          if (!x || !y) continue;
          n++; if (norm(f, x.card[f]) === norm(f, y.card[f])) same++;
        }
        console.log(`  ${f.padEnd(9)} ${same}/${n}`);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
