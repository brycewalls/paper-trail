// Lab OCR test (#101, #98): the lab reads scanned pages with PaddleOCR in a Web Worker, for real (no
// stand-in), and the page stays responsive while it does. In the real page against the fake backend,
// with ?ocr so the models load, at 390 px, with the CPU slowed 4 times through the DevTools protocol
// (a phone, roughly). Covers:
//   - a scanned PDF (a picture of a page, no text layer) imported through the scan review: the OCR
//     worker draws the page with pdf.js on an OffscreenCanvas and reads it with PP-OCRv5; the card is
//     the rules' answer from that text, and the models end up in Cache Storage
//   - while it reads: no long task over 100 ms on the main thread (PerformanceObserver "longtask"),
//     and frames keep coming (the longest gap between animation frames is reported)
//   - a photo through the deck's read: the worker decodes and reads it, with OCR progress on the card
//   - PaddleOCR failing to load (the models blocked): the lab falls back to Tesseract and still reads
// Needs the network once (ONNX Runtime and pdf.js from jsDelivr, Tesseract from cdnjs).
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/lab_ocr_test.mjs [--no-throttle] [--webkit]   (WebKit, the engine of Safari: no CPU
//   throttling there, and no longtask entries, so its long-task check reads none)
import * as pw from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".onnx": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/public/index.html?fake=1&lab=1&hold=1&ocr`;
const BROWSER = process.argv.includes("--webkit") ? "webkit" : "chromium";
const THROTTLE = process.argv.includes("--no-throttle") || BROWSER !== "chromium" ? 1 : 4;
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });

const browser = await pw[BROWSER].launch();
console.log(`${BROWSER}${THROTTLE > 1 ? `, CPU ${THROTTLE}x slower` : ""}`);
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const js = (page, fn, arg) => page.evaluate(fn, arg);
const TOP = ".dk-card:not(.dk-ghost)";

async function open({ blockModels = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  if (blockModels) await page.route("**/lab-models/**", (r) => r.abort());
  page.on("requestfailed", (r) => { if (!(blockModels && /\/lab-models\/|onnxruntime-web/.test(r.url()))) problems.push(`request failed: ${r.url()}`); });
  // Long tasks and animation-frame gaps, from the first script on.
  await page.addInitScript(() => {
    window.__perf = { long: [], gaps: [], watching: false };
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.long.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) }); })
        .observe({ type: "longtask", buffered: true });
    } catch { /* no longtask support */ }
    let last = 0;
    const frame = (t) => { if (window.__perf.watching && last) window.__perf.gaps.push({ at: Math.round(t), ms: Math.round(t - last) }); last = t; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__PT__ && window.__PT__.lab);
  await js(page, () => window.__PT__.lab.compare.setCompareEnabled(false));
  if (THROTTLE > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
  return { ctx, page, problems };
}
async function menuPick(page, label) {
  await page.click("#btn-scan-menu");
  await page.waitForSelector(".menu");
  await page.click(`.menu .menu-item:has-text("${label}")`);
}
// A picture of a synthetic W-2 (made-up employer and numbers): as a JPEG, and as a one-page PDF with
// no text layer (the picture only), made with the jsPDF the page already loads.
const W2_LINES = ["Form W-2 Wage and Tax Statement 2025", "c Employer's name, address, and ZIP code", "Northwind Logistics", "1 Wages, tips, other compensation 61,400.00",
  "2 Federal income tax withheld 7,210.55", "Employee: Jordan Reyes", "Copy B, to be filed with the employee's federal tax return", "Issued January 30, 2026"];
async function makeScans(page) {
  return js(page, async (lines) => {
    const c = document.createElement("canvas"); c.width = 1275; c.height = 1650;
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#161616"; x.textBaseline = "top";
    lines.forEach((l, i) => { x.font = `${i ? 26 : 40}px Arial, sans-serif`; x.fillText(l, 110, 130 + i * 62); });
    const jpeg = c.toDataURL("image/jpeg", 0.9);
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    doc.addImage(jpeg, "JPEG", 0, 0, 612, 792);
    const pdf = new Uint8Array(doc.output("arraybuffer"));
    let bin = ""; for (const b of pdf) bin += String.fromCharCode(b);
    return { pdf: btoa(bin), jpeg: jpeg.split(",")[1] };
  }, W2_LINES);
}
const perfWindow = (page, on) => js(page, (on) => { window.__perf.watching = on; window.__perf.mark = on ? performance.now() : window.__perf.mark; window.__perf.end = on ? 0 : performance.now(); if (on) { window.__perf.gaps = []; } }, on);
const perfReport = (page) => js(page, () => {
  const p = window.__perf, from = p.mark, to = p.end || performance.now();
  const long = p.long.filter((e) => e.start >= from && e.start <= to);
  return { long, longest: long.reduce((m, e) => Math.max(m, e.ms), 0), maxGap: p.gaps.reduce((m, g) => Math.max(m, g.ms), 0), frames: p.gaps.length, ms: Math.round(to - from) };
});
const status = (page) => js(page, async () => (await import(new URL("js/lab/ocr.js", location.href).href)).ocrStatus());

try {
  // 1. A scanned PDF through the scan review: drawn and read in the worker, the page stays smooth.
  let perf1;
  {
    const { ctx, page, problems } = await open();
    const scans = await makeScans(page);
    await perfWindow(page, true);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuPick(page, "Import from Files")]);
    await chooser.setFiles([{ name: "w2-scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(scans.pdf, "base64") }]);
    await page.waitForSelector("#review:not([hidden])");
    await page.waitForFunction(() => { const r = window.__PT__.review(); return r && r.groups.length && r.groups.every((g) => g.status === "read" || g.status === "failed"); }, null, { timeout: 240000 });
    await perfWindow(page, false);
    perf1 = await perfReport(page);
    await page.click("[data-send]");
    await page.waitForSelector(TOP, { timeout: 60000 });
    const it = await js(page, () => { const i = window.__PT__.items().find((x) => x.card); const r = window.__PT__.lab.compare.recent.at(-1); return { card: i.card, lab: i.lab, text: ((r && r.textPages) || []).join("\n") }; });
    const st = await status(page);
    check(st.engine === "paddle" && ["wasm", "webgpu"].includes(st.backend), `PaddleOCR read it (${st.engine}, ${st.backend}, models ready in ${st.loadMs} ms)`);
    check(/Northwind/i.test(it.text) && /W-2/.test(it.text), `the scanned page's text came from OCR (${it.text.length} characters: "${it.text.slice(0, 60).replace(/\n/g, " / ")}")`);
    check(it.lab && it.lab.textSource === "ocr", `the read says its text came from OCR (${it.lab && it.lab.textSource})`);
    check(it.card.docType === "W-2" && /Northwind/i.test(it.card.issuer || ""), `the rules read the OCR text: ${it.card.docType}, ${it.card.issuer}`);
    const cached = await js(page, async () => { const c = await caches.open("pt-lab-ocr-v1"); return (await c.keys()).map((r) => r.url.split("/").pop()); });
    check(["det.onnx", "rec-en.onnx", "dict-en.txt"].every((f) => cached.includes(f)) && cached.some((f) => f.endsWith(".wasm")), `the models and the runtime are kept in Cache Storage (${cached.join(", ")})`);
    check(perf1.longest <= 100, `no long task over 100 ms while it read, CPU ${THROTTLE}x slower (${perf1.long.length} long tasks, longest ${perf1.longest} ms, over ${perf1.ms} ms)`);
    console.log(`     long tasks: ${perf1.long.map((e) => e.ms).join(", ") || "none"}; frames ${perf1.frames}, longest gap between frames ${perf1.maxGap} ms`);
    await page.screenshot({ path: join(shots, "lab-ocr-card-phone.png") });
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 2. A photo through the deck's read: decoded and read in the worker, with progress on the card.
  {
    const { ctx, page, problems } = await open();
    const scans = await makeScans(page);
    await js(page, () => {
      window.__progress = [];
      const watch = setInterval(() => { const t = document.querySelector("#dk-empty")?.textContent || ""; if (/OCR|text reader/.test(t)) window.__progress.push(t); if (window.__PT__.items().some((i) => i.card)) clearInterval(watch); }, 30);
    });
    await perfWindow(page, true);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__PT__.addPhotos([new File([bytes], "w2.jpg", { type: "image/jpeg" })], "W-2 photo");
    }, scans.jpeg);
    await page.waitForSelector(TOP, { timeout: 240000 });
    await perfWindow(page, false);
    const perf2 = await perfReport(page);
    const it = await js(page, () => { const i = window.__PT__.items().find((x) => x.card); return { lab: i.lab, card: i.card }; });
    const progress = await js(page, () => [...new Set(window.__progress)]);
    check(it.lab.textSource === "ocr" && it.card.docType === "W-2", `a photo is read with PaddleOCR in the worker (${it.lab.textSource}, ${it.card.docType}, ${it.lab.textChars} characters)`);
    check(progress.some((t) => /with OCR, \d+%/.test(t)), `the card shows OCR progress (${progress.slice(0, 3).join(" | ")})`);
    check(perf2.longest <= 100, `no long task over 100 ms while the photo read (${perf2.long.length} long tasks, longest ${perf2.longest} ms; longest frame gap ${perf2.maxGap} ms)`);
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 3. PaddleOCR can't load (its models blocked): Tesseract reads instead.
  {
    const { ctx, page, problems } = await open({ blockModels: true });
    const scans = await makeScans(page);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__PT__.addPhotos([new File([bytes], "w2.jpg", { type: "image/jpeg" })], "W-2 photo");
    }, scans.jpeg);
    await page.waitForSelector(TOP, { timeout: 240000 });
    const it = await js(page, () => { const i = window.__PT__.items().find((x) => x.card); return { lab: i.lab, card: i.card }; });
    const st = await status(page);
    check(st.engine === "tesseract" && st.error, `with the models blocked, the lab falls back to Tesseract (${st.engine}: ${st.error})`);
    check(it.lab.textSource === "ocr" && it.card.docType === "W-2", `and still reads the photo (${it.lab.textSource}, ${it.card.docType})`);
    const unexpected = problems.filter((p) => !/lab-models|PaddleOCR|Failed to fetch|ERR_FAILED/.test(p));
    check(!unexpected.length, `no other console errors${unexpected.length ? ": " + unexpected.join(" | ") : ""}`);
    await ctx.close();
  }
} catch (e) {
  console.log(`FAIL ${e.stack || e}`);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} lab OCR check(s) failed` : "\nall lab OCR checks passed");
process.exit(failures ? 1 : 0);
