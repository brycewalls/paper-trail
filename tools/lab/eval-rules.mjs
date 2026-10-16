// Evaluates the no-AI rules engine (#92) against the synthetic corpus in tools/lab/corpus/.
//   node tools/lab/eval-rules.mjs                 dev and held-out scores, plus both with OCR noise
//   node tools/lab/eval-rules.mjs --verbose       every miss, field by field
//   node tools/lab/eval-rules.mjs --json          the report as JSON
//   node tools/lab/eval-rules.mjs --assert        exit 1 when a score drops below the floors (CI)
//   node tools/lab/eval-rules.mjs --only <id>     one document, with the full card
//   node tools/lab/eval-rules.mjs --compare-claude [--limit N] [--split dev|holdout]
//       also sends each corpus text to Claude (the classify prompt and schema from functions/lib.js,
//       through the Anthropic SDK in functions/node_modules: run `npm ci --prefix functions` once)
//       and reports how often the rules agree with Claude, field by field. Reads ANTHROPIC_API_KEY
//       from the environment; nothing is written to disk. CLAUDE_MODEL and CLAUDE_EFFORT override
//       the model (claude-opus-5-5) and effort (low), the same defaults as the deployed function.
//       Costs a little: one Claude read per document.
//
// The corpus is synthetic: made-up people, companies and numbers. The dev files tune the rules; the
// holdout file was written before the rules and is never tuned against, so its score is the honest one.
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readByRules } from "../../public/js/lab/rules/engine.js";
import { agreement, docKind } from "../../public/js/lab/rules/compare.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
export const TODAY = new Date(2026, 9, 16); // the corpus's "today": 2026-10-16
export const EVAL_FIELDS = ["docType", "issuer", "docDate", "folder", "verdict", "sensitive", "paperless"];
// Regression floors for --assert (CI): a little under the current scores, so a change that makes the
// rules worse fails the build. Raise them when the rules get better.
const FLOORS = { dev: 0.9, holdout: 0.8, noisy: 0.75 };

export async function loadCorpus() {
  const dir = join(here, "corpus");
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".mjs")).sort()) {
    const split = f.startsWith("holdout") ? "holdout" : "dev";
    const mod = await import(pathToFileURL(join(dir, f)).href);
    for (const doc of mod.default) out.push({ ...doc, split, file: f });
  }
  return out;
}

// ---------- OCR noise: the same every run (seeded) ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SWAP = { o: "0", O: "0", l: "1", I: "l", i: "l", e: "c", m: "rn", S: "5", B: "8", a: "o", g: "q", n: "h" };
export function addNoise(text, seed, level = 0.035) {
  const r = rng(seed);
  let out = "";
  for (const ch of text) {
    const x = r();
    if (ch === "\n" && x < 0.15) { out += " "; continue; }          // two lines run together
    if (ch === " " && x < 0.03) { out += "\n"; continue; }          // a line broken in two
    if (ch === " " && x < 0.05) continue;                           // two words run together
    if (SWAP[ch] && x < level) { out += SWAP[ch]; continue; }       // a letter misread
    if (/[a-z]/i.test(ch) && x > 1 - level / 4) continue;           // a letter dropped
    out += ch;
  }
  return out;
}
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------- scoring ----------
export function evaluate(docs, { noise = false } = {}) {
  const rows = [];
  const started = Date.now();
  for (const doc of docs) {
    const pages = noise ? doc.pages.map((p, i) => addNoise(p, hash(doc.id) + i)) : doc.pages;
    const card = readByRules({ pages, filename: doc.filename || "", today: TODAY });
    const agree = agreement(card, doc.expect);
    rows.push({ id: doc.id, split: doc.split, card, expect: doc.expect, agree });
  }
  return { rows, ms: Date.now() - started };
}

export function summarize(rows) {
  const per = {};
  for (const f of EVAL_FIELDS) {
    const scored = rows.filter((r) => f in r.agree);
    per[f] = scored.length ? scored.filter((r) => r.agree[f]).length / scored.length : null;
  }
  const allRight = rows.filter((r) => EVAL_FIELDS.every((f) => r.agree[f] !== false)).length / (rows.length || 1);
  const mean = EVAL_FIELDS.reduce((s, f) => s + (per[f] || 0), 0) / EVAL_FIELDS.length;
  // Calibration: are fields the rules call sure (0.75 or more) right more often than the rest?
  const cal = { sure: [0, 0], unsure: [0, 0] };
  for (const r of rows) for (const f of ["docType", "issuer", "docDate", "folder", "verdict"]) {
    if (!(f in r.agree)) continue;
    const c = r.card.confidence?.fields?.[f] ?? 1;
    const b = c >= 0.75 ? cal.sure : cal.unsure;
    b[0] += r.agree[f] ? 1 : 0; b[1] += 1;
  }
  // Confusion: expected type -> what the rules said, for every miss.
  const confusion = {};
  for (const r of rows) if (r.agree.docType === false) {
    const k = `${r.expect.docType} -> ${r.card.docType}`;
    confusion[k] = (confusion[k] || 0) + 1;
  }
  return { n: rows.length, per, mean, allRight, cal, confusion };
}

const pct = (x) => (x == null ? "  -  " : `${(x * 100).toFixed(1).padStart(5)}%`);
function printSummary(title, s, ms) {
  console.log(`\n${title}: ${s.n} documents${ms != null ? `, ${ms} ms` : ""}`);
  for (const f of EVAL_FIELDS) console.log(`  ${f.padEnd(10)} ${pct(s.per[f])}`);
  console.log(`  ${"mean".padEnd(10)} ${pct(s.mean)}   every field right: ${pct(s.allRight)}`);
  const [sr, st] = s.cal.sure, [ur, ut] = s.cal.unsure;
  console.log(`  confidence: sure fields right ${pct(st ? sr / st : null)} (${st}), unsure fields right ${pct(ut ? ur / ut : null)} (${ut})`);
  const conf = Object.entries(s.confusion).sort((a, b) => b[1] - a[1]);
  if (conf.length) console.log(`  type mix-ups: ${conf.map(([k, v]) => `${k}${v > 1 ? ` x${v}` : ""}`).join("; ")}`);
}
function printMisses(rows) {
  for (const r of rows) {
    const bad = EVAL_FIELDS.filter((f) => r.agree[f] === false);
    if (!bad.length) continue;
    const show = (o, f) => JSON.stringify(f === "paperless" ? (typeof o.paperless === "object" ? o.paperless.possible : o.paperless) : o[f]);
    console.log(`  ${r.id}: ${bad.map((f) => `${f} want ${show(r.expect, f)} got ${show(r.card, f)}`).join(", ")}`);
  }
}

// ---------- compare with Claude ----------
async function compareClaude(docs, limit) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("Set ANTHROPIC_API_KEY to compare with Claude (it is read from the environment, never stored)."); process.exit(2); }
  const require = createRequire(join(root, "functions", "package.json"));
  let Anthropic;
  try { const sdk = require("@anthropic-ai/sdk"); Anthropic = sdk.default || sdk; }
  catch { console.error("The Anthropic SDK isn't installed. Run: npm ci --prefix functions"); process.exit(2); }
  const lib = require(join(root, "functions", "lib.js"));
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 240000 });
  const model = process.env.CLAUDE_MODEL || "claude-opus-5-5";
  const effort = process.env.CLAUDE_EFFORT || "low";
  const today = TODAY.toISOString().slice(0, 10);
  const list = docs.slice(0, limit || docs.length);
  const rows = [];
  for (const doc of list) {
    const text = doc.pages.join("\n\n--- page break ---\n\n");
    const n = doc.pages.length;
    // The same prompt and schema as the deployed classify function, with the page text in place of
    // the pages themselves (the read the lab does: text only, no images).
    const req = {
      model, max_tokens: 8000,
      system: [{ type: "text", text: lib.SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: `The text below was read from ONE document (${n} page${n > 1 ? "s" : ""}). Today is ${today}.\n\nText of the pages (may have OCR errors):\n<ocr>\n${text}\n</ocr>` }] }],
      output_config: { effort, format: { type: "json_schema", schema: lib.RESULT_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    };
    let claude;
    try {
      const res = await client.beta.messages.create(req);
      if (res.stop_reason === "refusal") { console.log(`  ${doc.id}: Claude declined`); continue; }
      const out = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      claude = lib.normalize(JSON.parse(out));
    } catch (e) {
      console.log(`  ${doc.id}: Claude call failed (${e.status || ""} ${e.message || e})`);
      continue;
    }
    const card = readByRules({ pages: doc.pages, filename: doc.filename || "", today: TODAY });
    rows.push({ id: doc.id, card, claude, rulesVsClaude: agreement(card, claude), claudeVsExpected: agreement(claude, doc.expect), expect: doc.expect });
    process.stdout.write(".");
  }
  console.log("");
  const fields = ["docType", "issuer", "docDate", "folder", "verdict", "sensitive", "paperless", "filename", "filenameDate", "title"];
  const rate = (key, f) => { const s = rows.filter((r) => f in r[key]); return s.length ? s.filter((r) => r[key][f]).length / s.length : null; };
  console.log(`\nRules vs Claude (${model}, effort ${effort}) on ${rows.length} documents`);
  console.log(`  ${"field".padEnd(12)} rules=Claude   Claude=expected`);
  for (const f of fields) console.log(`  ${f.padEnd(12)} ${pct(rate("rulesVsClaude", f))}       ${pct(rate("claudeVsExpected", f))}`);
  for (const r of rows) {
    const bad = ["docType", "issuer", "docDate", "folder", "verdict"].filter((f) => r.rulesVsClaude[f] === false);
    if (bad.length) console.log(`  ${r.id}: ${bad.map((f) => `${f} rules ${JSON.stringify(f === "docType" ? `${r.card[f]} (${docKind(r.card[f])})` : r.card[f])} Claude ${JSON.stringify(f === "docType" ? `${r.claude[f]} (${docKind(r.claude[f])})` : r.claude[f])}`).join(", ")}`);
  }
  return rows;
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const corpus = await loadCorpus();
  if (opt("--only")) {
    const doc = corpus.find((d) => d.id === opt("--only"));
    if (!doc) { console.error("No such document"); process.exit(2); }
    const card = readByRules({ pages: doc.pages, filename: doc.filename || "", today: TODAY });
    console.log(JSON.stringify({ expect: doc.expect, card, agree: agreement(card, doc.expect) }, null, 2));
    return;
  }
  const split = opt("--split");
  if (flag("--compare-claude")) {
    await compareClaude(corpus.filter((d) => !split || d.split === split), Number(opt("--limit")) || 0);
    return;
  }
  const dev = corpus.filter((d) => d.split === "dev"), hold = corpus.filter((d) => d.split === "holdout");
  const runs = {
    dev: evaluate(dev), holdout: evaluate(hold),
    "dev, OCR noise": evaluate(dev, { noise: true }), "holdout, OCR noise": evaluate(hold, { noise: true }),
  };
  const sums = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, summarize(v.rows)]));
  if (flag("--json")) { console.log(JSON.stringify(sums, null, 2)); }
  else {
    console.log(`Rules engine eval (#92), synthetic corpus: ${dev.length} dev, ${hold.length} held out. Fields scored: ${EVAL_FIELDS.join(", ")}.`);
    for (const [k, s] of Object.entries(sums)) {
      printSummary(k, s, runs[k].ms);
      if (flag("--verbose")) printMisses(runs[k].rows);
    }
  }
  if (flag("--assert")) {
    const fails = [];
    if (sums.dev.mean < FLOORS.dev) fails.push(`dev mean ${pct(sums.dev.mean)} < ${pct(FLOORS.dev)}`);
    if (sums.holdout.mean < FLOORS.holdout) fails.push(`holdout mean ${pct(sums.holdout.mean)} < ${pct(FLOORS.holdout)}`);
    for (const k of ["dev, OCR noise", "holdout, OCR noise"]) if (sums[k].mean < FLOORS.noisy) fails.push(`${k} mean ${pct(sums[k].mean)} < ${pct(FLOORS.noisy)}`);
    console.log(fails.length ? `\nFAIL ${fails.join("; ")}` : "\nall floors held");
    process.exit(fails.length ? 1 : 0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
