// Evaluates the no-AI rules engine (#92) against the synthetic corpus in tools/lab/corpus/.
//   node tools/lab/eval-rules.mjs                 dev and held-out scores, plus both with OCR noise
//   node tools/lab/eval-rules.mjs --verbose       every miss, field by field
//   node tools/lab/eval-rules.mjs --json          the report as JSON
//   node tools/lab/eval-rules.mjs --assert        exit 1 when a score drops below the floors (CI)
//   node tools/lab/eval-rules.mjs --only <id>     one document, with the full card
//   node tools/lab/eval-rules.mjs --matcher [--verbose]
//       the on-device matcher (#102) beside the rules alone: accuracy with and without it, clean and
//       with OCR noise, and the time per document. Held out so it never scores an example it holds:
//         dev -> holdout   the dev documents are the examples (as if Bryce had filed them), the
//                          held-out ones are read
//         leave one out    every document read with all the others as examples
//         first day        leave one out with no filed senders yet: the corpus votes on the type,
//                          and senders autocorrect against the known-sender list only
//         recurring        every document filed once before (with other OCR slips) comes again,
//                          like next month's statement: the learning loop
//       Needs npm ci --prefix tools/lab/matcher-deps and bash tools/lab/fetch-models.sh once.
//   node tools/lab/eval-rules.mjs --matcher --ocr <bench.json> [--engine paddle]
//       end to end: the same scenarios on real OCR output instead of the seeded noise. bench.json is
//       written by tools/lab/ocr-bench.mjs --json (pages drawn from the corpus, then read by the
//       lab's OCR), so the matcher scores the text PaddleOCR (or Tesseract) actually produced, per
//       drawn variant (clean, skew, blur, low-contrast, photo).
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
import { runRules } from "../../public/js/lab/engine.js";
import { combine } from "../../public/js/lab/match/combine.js";
import { nearest, vote, unpackVector } from "../../public/js/lab/match/knn.js";
import { KNOWN_SENDERS } from "../../public/js/lab/rules/senders.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
export const TODAY = new Date(2026, 9, 16); // the corpus's "today": 2026-10-16
export const EVAL_FIELDS = ["docType", "issuer", "docDate", "folder", "verdict", "sensitive", "paperless"];
// Regression floors for --assert (CI): a little under the current scores, so a change that makes the
// rules worse fails the build. Raise them when the rules get better.
const FLOORS = { dev: 0.97, holdout: 0.95, noisy: 0.9 };

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

// ---------- the matcher (#102) ----------
// Reads docs with the rules alone and with the matcher on top. examplesFor(doc) gives the examples
// that doc may use (never itself). filed: whether the examples' senders count as filed by Bryce
// (candidates for autocorrect, and votes on the sender), or only the type votes (first day).
async function evaluateMatcher(docs, { noise, examplesFor, filed, embed, pagesOf }) {
  const rows = [], times = { embed: [], match: [], rules: [] };
  const today = "2026-10-16";
  for (const doc of docs) {
    const pages = pagesOf ? pagesOf(doc) : noise ? doc.pages.map((p, i) => addNoise(p, hash(doc.id) + i)) : doc.pages;
    let t = performance.now();
    const card = await runRules(pages, { name: doc.filename || "", today });
    times.rules.push(performance.now() - t);
    t = performance.now();
    const vec = await embed(pages);
    times.embed.push(performance.now() - t);
    t = performance.now();
    const examples = examplesFor(doc).map((e) => ({ ...e, synthetic: !filed }));
    const neighbors = nearest(vec, examples, 7);
    const typeVote = vote(neighbors, "docType");
    const issuerVote = filed ? vote(neighbors, "issuer") : null;
    const candidates = [...KNOWN_SENDERS.map((k) => ({ name: k.name, aliases: k.aliases, source: "known sender" })),
      ...(filed ? [...new Set(examples.map((e) => e.issuer).filter(Boolean))].map((name) => ({ name, source: "filed" })) : [])];
    const out = await combine({ card, textPages: pages, meta: { name: doc.filename || "", today }, typeVote, issuerVote, candidates, neighbors });
    times.match.push(performance.now() - t);
    rows.push({ id: doc.id, split: doc.split, expect: doc.expect,
      rules: { card, agree: agreement(card, doc.expect) },
      matched: { card: out.card, agree: agreement(out.card, doc.expect) }, decidedBy: out.decidedBy, notes: out.notes });
  }
  return { rows, times };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0; };

async function runMatcher({ verbose, json, ocr, engine = "paddle" }) {
  const { loadEmbedder } = await import("./embedder.mjs");
  const { embedPages, loadMs } = await loadEmbedder();
  const bundle = (await import("../../public/js/lab/match/corpus-examples.json", { with: { type: "json" } })).default;
  const corpus = await loadCorpus();
  const byId = new Map(bundle.examples.map((e) => [e.id, { id: e.id, split: e.split, docType: e.docType, issuer: e.issuer, vec: unpackVector(e), source: "corpus" }]));
  const dev = corpus.filter((d) => d.split === "dev"), hold = corpus.filter((d) => d.split === "holdout");
  const devEx = dev.map((d) => byId.get(d.id));
  const allBut = (doc) => corpus.filter((d) => d.id !== doc.id).map((d) => byId.get(d.id));
  const cache = new Map(), embedMs = [];
  const embed = async (pages) => {
    const k = pages.join("\f");
    if (!cache.has(k)) { const t = performance.now(); cache.set(k, await embedPages(pages)); embedMs.push(performance.now() - t); }
    return cache.get(k);
  };
  // Recurring: every document was filed once before (read then with other OCR slips) and comes
  // again. Words-only embedding drops dates and amounts, so this stands in for next month's
  // statement from the same sender. It measures the learning loop, not reading a new sender.
  const before = [];
  for (const d of corpus) before.push({ id: d.id, split: d.split, docType: d.expect.docType, issuer: d.expect.issuer, source: "filed",
    vec: await embed(d.pages.map((p, i) => addNoise(p, hash(d.id) + i + 7919))) });
  let runs;
  if (ocr) {
    // End to end: the text the lab's OCR read from drawn pages, per variant.
    const { readFileSync } = await import("node:fs");
    const bench = JSON.parse(readFileSync(ocr, "utf8"));
    const byVariant = bench.pages && bench.pages[engine];
    if (!byVariant) throw new Error(`${ocr} has no ${engine} pages (run ocr-bench.mjs --json with --engines ${engine})`);
    runs = {};
    for (const [variant, docsRead] of Object.entries(byVariant)) {
      const text = new Map(docsRead.map((d) => [d.id, d.pages.map((p) => p.text || "")]));
      const pagesOf = (doc) => text.get(doc.id) || doc.pages.map(() => "");
      const read = corpus.filter((d) => text.has(d.id)), heldRead = hold.filter((d) => text.has(d.id));
      runs[`${engine} ${variant}: dev -> holdout`] = await evaluateMatcher(heldRead, { examplesFor: () => devEx, filed: true, embed, pagesOf });
      runs[`${engine} ${variant}: leave one out, all`] = await evaluateMatcher(read, { examplesFor: allBut, filed: true, embed, pagesOf });
      runs[`${engine} ${variant}: first day, all`] = await evaluateMatcher(read, { examplesFor: allBut, filed: false, embed, pagesOf });
      runs[`${engine} ${variant}: recurring, all`] = await evaluateMatcher(read, { examplesFor: () => before, filed: true, embed, pagesOf });
    }
  } else runs = {
    "dev -> holdout, clean": await evaluateMatcher(hold, { noise: false, examplesFor: () => devEx, filed: true, embed }),
    "dev -> holdout, OCR noise": await evaluateMatcher(hold, { noise: true, examplesFor: () => devEx, filed: true, embed }),
    "leave one out, dev, OCR noise": await evaluateMatcher(dev, { noise: true, examplesFor: allBut, filed: true, embed }),
    "leave one out, all, OCR noise": await evaluateMatcher(corpus, { noise: true, examplesFor: allBut, filed: true, embed }),
    "first day, all, OCR noise": await evaluateMatcher(corpus, { noise: true, examplesFor: allBut, filed: false, embed }),
    "recurring, all, OCR noise": await evaluateMatcher(corpus, { noise: true, examplesFor: () => before, filed: true, embed }),
  };
  const report = {};
  for (const [name, { rows, times }] of Object.entries(runs)) {
    const before = summarize(rows.map((r) => ({ ...r, card: r.rules.card, agree: r.rules.agree })));
    const after = summarize(rows.map((r) => ({ ...r, card: r.matched.card, agree: r.matched.agree })));
    const decided = { docType: {}, issuer: {} };
    for (const r of rows) for (const f of ["docType", "issuer"]) decided[f][r.decidedBy[f]] = (decided[f][r.decidedBy[f]] || 0) + 1;
    const fixed = rows.filter((r) => EVAL_FIELDS.some((f) => r.rules.agree[f] === false && r.matched.agree[f] === true)).length;
    const broke = rows.filter((r) => EVAL_FIELDS.some((f) => r.rules.agree[f] === true && r.matched.agree[f] === false)).length;
    report[name] = { n: rows.length, before: before.per, after: after.per, meanBefore: before.mean, meanAfter: after.mean, allRightBefore: before.allRight, allRightAfter: after.allRight,
      calAfter: after.cal, decided, fixed, broke,
      ms: { rules: round1(median(times.rules)), match: round1(median(times.match)), matchP95: round1(p95(times.match)) } };
    if (!json) {
      console.log(`\n${name}: ${rows.length} documents`);
      console.log(`  ${"field".padEnd(10)} rules   + matcher`);
      for (const f of EVAL_FIELDS) console.log(`  ${f.padEnd(10)} ${pct(before.per[f])}  ${pct(after.per[f])}`);
      console.log(`  ${"mean".padEnd(10)} ${pct(before.mean)}  ${pct(after.mean)}   every field right ${pct(before.allRight)} -> ${pct(after.allRight)}`);
      const [sr, st] = after.cal.sure, [ur, ut] = after.cal.unsure;
      console.log(`  confidence with the matcher: sure fields right ${pct(st ? sr / st : null)} (${st}), unsure right ${pct(ut ? ur / ut : null)} (${ut})`);
      console.log(`  decided by: type ${JSON.stringify(decided.docType)}, sender ${JSON.stringify(decided.issuer)}; documents fixed ${fixed}, made worse ${broke}`);
      console.log(`  time per document (median, this machine): rules ${report[name].ms.rules} ms, vote + autocorrect + combine ${report[name].ms.match} ms (p95 ${report[name].ms.matchP95})`);
      if (verbose) for (const r of rows) {
        const changed = EVAL_FIELDS.filter((f) => r.rules.agree[f] !== r.matched.agree[f] || r.matched.agree[f] === false);
        if (!changed.length) continue;
        const show = (c, f) => JSON.stringify(f === "paperless" ? c.paperless && c.paperless.possible : c[f]);
        console.log(`    ${r.id}: ${changed.map((f) => `${f} want ${show(r.expect.paperless !== undefined && f === "paperless" ? { paperless: { possible: r.expect.paperless } } : r.expect, f)} rules ${show(r.rules.card, f)} matched ${show(r.matched.card, f)}`).join(", ")} [${r.decidedBy.docType}/${r.decidedBy.issuer}]${r.notes.length ? " " + r.notes.join("; ") : ""}`);
      }
    }
  }
  const embedTime = { n: embedMs.length, median: round1(median(embedMs)), p95: round1(p95(embedMs)) };
  if (json) console.log(JSON.stringify({ model: bundle.model, loadMs, embedTime, report }, null, 2));
  else console.log(`\nModel ${bundle.model} (${bundle.dtype}), loaded in ${loadMs} ms in Node; embedding one document took ${embedTime.median} ms (p95 ${embedTime.p95}) over ${embedTime.n} texts.`);
  return report;
}
const round1 = (x) => Math.round(x * 10) / 10;

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
  if (flag("--matcher")) { await runMatcher({ verbose: flag("--verbose"), json: flag("--json"), ocr: opt("--ocr"), engine: opt("--engine") || "paddle" }); return; }
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
