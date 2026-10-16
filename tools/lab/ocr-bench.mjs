// OCR benchmark for the lab (#101): PaddleOCR (the lab's worker) against Tesseract.js (the fallback)
// on synthetic pages drawn from the rules corpus (tools/lab/corpus/), headless in Playwright.
//   node tools/lab/ocr-bench.mjs [options]
//     --limit N             the first N documents of each split (default: all 109)
//     --variants a,b        clean, skew, blur, low-contrast, photo (default: all five)
//     --engines a,b         paddle, tesseract (default: both)
//     --backend wasm|webgpu|auto   PaddleOCR's runtime (default wasm, what most phones get)
//     --browser chromium|webkit    (default chromium)
//     --throttle N          slow the CPU N times through the DevTools protocol (Chromium only)
//     --det-max N           the detector's long side (default: the worker's, lab/ppocr.js DET_MAX)
//     --headed              a visible browser window (a real GPU for --backend webgpu; headless
//                           Chromium's WebGPU is a software rasterizer and far slower)
//     --json path           also write every number, and each page's OCR text, to a JSON file
// Reports, per engine and variant: character error rate (CER) and word error rate (WER) against the
// drawn text (whitespace collapsed; reading order counts), word recall (order free), and the time per
// page. Then it runs the rules engine on each engine's OCR output and scores it like eval-rules.mjs.
// Needs Playwright (npm install --no-save playwright@1; npx playwright install chromium) and the
// network once, for ONNX Runtime and Tesseract from their CDNs.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, extname, resolve, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, summarize, EVAL_FIELDS, TODAY } from "./eval-rules.mjs";
import { readByRules } from "../../public/js/lab/rules/engine.js";
import { agreement } from "../../public/js/lab/rules/compare.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt("--limit", 0)) || 0;
const VARIANTS = opt("--variants", "clean,skew,blur,low-contrast,photo").split(",");
const ENGINES = opt("--engines", "paddle,tesseract").split(",");
const BACKEND = opt("--backend", "wasm");
const BROWSER = opt("--browser", "chromium");
const THROTTLE = Number(opt("--throttle", 0)) || 0;
const JSON_OUT = opt("--json", "");
const DET_MAX = Number(opt("--det-max", 0)) || 0;
const HEADED = args.includes("--headed");

// ---------- metrics ----------
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
export function levenshtein(a, b) {
  if (a.length < b.length) [a, b] = [b, a];
  let prev = new Uint32Array(b.length + 1), cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
export function scoreText(truth, got) {
  const t = clean(truth), g = clean(got);
  const tw = t ? t.split(" ") : [], gw = g ? g.split(" ") : [];
  const bag = new Map();
  for (const w of gw) bag.set(w, (bag.get(w) || 0) + 1);
  let hit = 0;
  for (const w of tw) { const n = bag.get(w); if (n) { hit++; bag.set(w, n - 1); } }
  return { chars: t.length, words: tw.length, charErrors: levenshtein(t, g), wordErrors: levenshtein(tw, gw), wordHits: hit };
}

// ---------- a small static server (the repo root) ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".onnx": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm" };
function serve() {
  return new Promise((res) => {
    const srv = createServer((req, out) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
      const file = join(root, path);
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { out.writeHead(404); out.end(); return; }
      out.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      out.end(readFileSync(file));
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}

// ---------- main ----------
async function main() {
  let pw;
  try { pw = await import("playwright"); } catch { console.error("Playwright isn't installed: npm install --no-save playwright@1"); process.exit(2); }
  const corpus = await loadCorpus();
  const docs = LIMIT ? [...corpus.filter((d) => d.split === "dev").slice(0, LIMIT), ...corpus.filter((d) => d.split === "holdout").slice(0, LIMIT)] : corpus;
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await pw[BROWSER].launch({ headless: !HEADED, args: BROWSER === "chromium" ? ["--enable-unsafe-webgpu"] : [] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${base}/tools/lab/ocr-bench.html`);
  await page.waitForFunction(() => !!window.bench);
  if (THROTTLE && BROWSER === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  const starts = {};
  if (ENGINES.includes("paddle")) starts.paddle = await page.evaluate(([b, d]) => window.bench.startPaddle(b, d), [BACKEND, DET_MAX]);
  if (ENGINES.includes("tesseract")) starts.tesseract = await page.evaluate(() => window.bench.startTesseract());
  console.log(`OCR bench (#101): ${docs.length} documents, ${docs.reduce((n, d) => n + d.pages.length, 0)} pages, ${VARIANTS.join(", ")}; ${BROWSER}${THROTTLE ? `, CPU ${THROTTLE}x slower` : ""}`);
  for (const [k, v] of Object.entries(starts)) console.log(`  ${k} ready in ${v.loadMs} ms${v.backend ? ` (${v.backend})` : ""}`);

  // results[engine][variant] = [{ id, pages: [{ text, ms, score }] }]
  const results = Object.fromEntries(ENGINES.map((e) => [e, Object.fromEntries(VARIANTS.map((v) => [v, []]))]));
  let done = 0;
  const total = docs.reduce((n, d) => n + d.pages.length, 0) * VARIANTS.length;
  for (const doc of docs) {
    for (const variant of VARIANTS) {
      const perEngine = Object.fromEntries(ENGINES.map((e) => [e, []]));
      for (let p = 0; p < doc.pages.length; p++) {
        const seed = [...doc.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) + p;
        const reads = await page.evaluate(async ({ text, variant, seed, engines }) => {
          const { blob } = await window.bench.draw(text, variant, seed);
          const out = {};
          for (const e of engines) out[e] = await window.bench[e](blob);
          return out;
        }, { text: doc.pages[p], variant, seed, engines: ENGINES });
        for (const e of ENGINES) perEngine[e].push({ text: reads[e].text, ms: reads[e].ms, inner: reads[e].inner, boxes: reads[e].boxes, score: scoreText(doc.pages[p], reads[e].text) });
        done++;
      }
      for (const e of ENGINES) results[e][variant].push({ id: doc.id, split: doc.split, filename: doc.filename, expect: doc.expect, pages: perEngine[e] });
    }
    process.stdout.write(`\r  ${done} of ${total} pages`);
  }
  console.log("");
  await browser.close();
  srv.close();

  // ---------- report ----------
  const pct = (x) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);
  const rows = [];
  const rulesRows = [];
  for (const e of ENGINES) for (const v of VARIANTS) {
    const pages = results[e][v].flatMap((d) => d.pages);
    const sum = (k) => pages.reduce((n, p) => n + p.score[k], 0);
    const ms = pages.map((p) => p.ms).sort((a, b) => a - b);
    rows.push({ engine: e, variant: v, cer: sum("charErrors") / sum("chars"), wer: sum("wordErrors") / sum("words"), recall: sum("wordHits") / sum("words"),
      msMean: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), msMedian: ms[Math.floor(ms.length / 2)], msP90: ms[Math.floor(ms.length * 0.9)] });
    const evals = results[e][v].map((d) => {
      const card = readByRules({ pages: d.pages.map((p) => p.text), filename: d.filename || "", today: TODAY });
      return { id: d.id, split: d.split, card, expect: d.expect, agree: agreement(card, d.expect) };
    });
    rulesRows.push({ engine: e, variant: v, all: summarize(evals), holdout: summarize(evals.filter((r) => r.split === "holdout")) });
  }
  console.log("\nText accuracy and time per page");
  console.log("| engine | variant | CER | WER | word recall | ms mean | ms median | ms p90 |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.engine} | ${r.variant} | ${pct(r.cer)} | ${pct(r.wer)} | ${pct(r.recall)} | ${r.msMean} | ${r.msMedian} | ${r.msP90} |`);
  const truth = summarize(docs.map((d) => { const card = readByRules({ pages: d.pages, filename: d.filename || "", today: TODAY }); return { id: d.id, card, expect: d.expect, agree: agreement(card, d.expect) }; }));
  console.log(`\nRules on each engine's OCR output (all ${docs.length} documents; the drawn text itself scores ${pct(truth.mean)} mean)`);
  console.log(`| engine | variant | ${EVAL_FIELDS.join(" | ")} | mean | every field |`);
  console.log(`|---|---|${EVAL_FIELDS.map(() => "---").join("|")}|---|---|`);
  for (const r of rulesRows) console.log(`| ${r.engine} | ${r.variant} | ${EVAL_FIELDS.map((f) => pct(r.all.per[f])).join(" | ")} | ${pct(r.all.mean)} | ${pct(r.all.allRight)} |`);
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), browser: BROWSER, throttle: THROTTLE, backend: BACKEND, starts, rows,
      rules: rulesRows.map((r) => ({ engine: r.engine, variant: r.variant, per: r.all.per, mean: r.all.mean, allRight: r.all.allRight, holdoutMean: r.holdout.mean })),
      pages: results }, null, 1));
    console.log(`\nWrote ${JSON_OUT}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
