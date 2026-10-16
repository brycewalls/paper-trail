// Main-thread check for a full lab read (#98, #102): a photographed page goes through on-device OCR,
// the rules and the matcher with the real model, at 390 px and 4x CPU throttling (the DevTools
// protocol's Emulation.setCPUThrottlingRate, a phone-like slowdown). While it reads, the page is
// scrolled every 100 ms. Reports every long task (PerformanceObserver "longtask"), the longest gap
// between animation frames, and how long each stage took. Local only: it needs the model files
// (bash tools/lab/fetch-models.sh) and fetches Tesseract.js from its CDN, like the lab site does.
//   node tools/lab/longtasks.mjs [--rate 4] [--stack N] [--json]
//     --stack N   N made-up documents (up to 5: a bill, a W-2, a bank statement, an EOB, a receipt)
//                 added at once, like a stack from the camera; the pass ends when every card is read
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const rate = Number(args[args.indexOf("--rate") + 1]) || 4;
const stack = Math.min(5, Math.max(1, Number(args.includes("--stack") ? args[args.indexOf("--stack") + 1] : 1) || 1));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/public/index.html?fake=1&lab=1&hold=1&matcher=model&ocr=1`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate });
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true });
});
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__PT__ && window.__PT__.lab);
await page.evaluate(() => window.__PT__.lab.compare.setCompareEnabled(false));
const bootTasks = await page.evaluate(() => window.__lt.length);

const result = await page.evaluate(async (stack) => {
  // Made-up documents (synthetic names and numbers), drawn as photo-like pages: slightly turned,
  // warm paper, a little blur.
  const DOCS = [
    ["bill.jpg", [["Cascade Power and Light", 54], ["P.O. Box 4410 Tacoma WA 98402", 30], ["Electric service statement", 40], ["Statement date March 12, 2026", 30],
      ["Account ending 4411", 30], ["Service address 12 Elm Street", 30], ["Amount due $84.12 by April 2, 2026", 34], ["Electric usage 612 kWh", 30], ["Thank you for your payment.", 30]]],
    ["w2.jpg", [["Form W-2 Wage and Tax Statement 2025", 44], ["Employer: Harbor Lane Outfitters", 32], ["Employee: Sam Rivera", 30], ["1 Wages, tips, other compensation 48,210.00", 30],
      ["2 Federal income tax withheld 5,102.33", 30], ["Copy B To Be Filed With Employee's Federal Tax Return", 26], ["Department of the Treasury Internal Revenue Service", 26]]],
    ["bank.jpg", [["Evergreen Community Bank", 50], ["Checking account statement", 38], ["Statement period February 1 to February 28, 2026", 28], ["Account ending 7702", 30],
      ["Beginning balance $2,410.55", 30], ["Deposits $3,200.00", 30], ["Withdrawals $2,875.19", 30], ["Ending balance $2,735.36", 30]]],
    ["eob.jpg", [["Summit Health Plan", 50], ["Explanation of Benefits", 42], ["This is not a bill", 32], ["Date of service January 9, 2026", 30], ["Provider Lakeside Family Clinic", 30],
      ["Amount billed $240.00", 30], ["Plan paid $180.00", 30], ["You may owe $60.00", 30]]],
    ["receipt.jpg", [["Pine Street Hardware", 50], ["Receipt", 40], ["March 3, 2026 2:14 PM", 30], ["Deck screws 2 @ 12.99", 30], ["Wood stain 1 @ 28.50", 30],
      ["Subtotal 54.48", 30], ["Tax 5.18", 30], ["Total $59.66", 34], ["Visa ending 0912", 30]]],
  ].slice(0, stack);
  const files = [];
  for (const [name, lines] of DOCS) {
    const c = new OffscreenCanvas(1240, 1600);
    const g = c.getContext("2d");
    g.fillStyle = "#f3eee2"; g.fillRect(0, 0, c.width, c.height);
    g.translate(620, 800); g.rotate(-0.015); g.translate(-620, -800);
    g.filter = "blur(0.6px)"; g.fillStyle = "#222";
    let y = 160;
    for (const [t, size] of lines) { g.font = `${size}px Georgia, serif`; g.fillText(t, 110, y); y += size * 2.1; }
    files.push(new File([await c.convertToBlob({ type: "image/png" })], name, { type: "image/png" }));
  }
  const marks = {};
  const { on } = await import(new URL("js/ui.js", location.href).href);
  on("lab:progress", ({ progress }) => { if (progress && !marks[progress.replace(/, \d+%$/, "")]) marks[progress.replace(/, \d+%$/, "")] = Math.round(performance.now()); });
  // Scroll the page every 100 ms, and keep the longest gap between frames.
  document.body.style.minHeight = "3000px";
  let gap = 0, last = performance.now(), running = true, scrolls = 0;
  const frame = (t) => { gap = Math.max(gap, t - last); last = t; if (running) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  const scroller = setInterval(() => { window.scrollBy(0, scrolls++ % 2 ? -200 : 200); }, 100);
  const from = performance.now();
  for (const f of files) window.__PT__.addPhotos([f], f.name);
  const doneAt = {};
  await new Promise((ok) => { const t = setInterval(() => {
    for (const x of window.__PT__.items()) {
      const k = String(x.progress || "").replace(/, \d+%$/, ""); if (k && !marks[k]) marks[k] = Math.round(performance.now());
      if (x.card && !doneAt[x.id]) doneAt[x.id] = Math.round(performance.now() - from);
    }
    if (Object.keys(doneAt).length >= files.length) { clearInterval(t); ok(); }
  }, 25); });
  const total = Math.round(performance.now() - from);
  running = false; clearInterval(scroller);
  const cards = window.__PT__.items().filter((x) => x.card).map((it) => ({ issuer: it.card.issuer, docType: it.card.docType, docDate: it.card.docDate, text: it.lab.textSource, chars: it.lab.textChars,
    doneAt: doneAt[it.id], match: it.lab.match && { decidedBy: it.lab.match.decidedBy, ms: it.lab.match.ms } }));
  return { total, framesGap: Math.round(gap), scrolls, scrollY: Math.round(window.scrollY), marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v - Math.round(from)])), from: Math.round(from),
    tasks: window.__lt.filter((t) => t.at >= from), cards };
}, stack);
const over50 = result.tasks.filter((t) => t.ms > 50), over100 = result.tasks.filter((t) => t.ms > 100);
const report = { rate, viewport: "390x844", bootLongTasks: bootTasks, ...result, longest: Math.max(0, ...result.tasks.map((t) => t.ms)), over50: over50.length, over100: over100.length };
if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${stack} photographed document${stack > 1 ? "s" : ""}, OCR + rules + matcher, at ${rate}x CPU throttling, 390 px:`);
  console.log(`  all read in ${report.total} ms (${Math.round(report.total / stack)} ms per document); stages first seen: ${JSON.stringify(report.marks)}`);
  for (const c of report.cards) console.log(`  card at ${c.doneAt} ms: ${JSON.stringify({ issuer: c.issuer, docType: c.docType, docDate: c.docDate })} from ${c.text} (${c.chars} characters); matcher ${JSON.stringify(c.match)}`);
  console.log(`  scrolled ${report.scrolls} times while reading`);
  console.log(`  long tasks while reading: ${report.tasks.length} (over 50 ms: ${report.over50}, over 100 ms: ${report.over100}), longest ${report.longest} ms: ${JSON.stringify(report.tasks)}`);
  console.log(`  longest gap between frames while scrolling: ${report.framesGap} ms`);
}
await browser.close();
server.close();
