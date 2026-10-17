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
//   - sending to the deck before reading finishes (#99) with the real reader: Send closes the review
//     at once, the Reading cards show the OCR worker's own progress, an unread card can't be swiped
//     or keyed, and a one-page scan sent second reaches the top before a two-page scan sent first
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
  ".onnx": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };
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
// Scanned PDFs (pictures only, no text layer), one page per list of lines.
async function makeScanPdf(page, pagesLines) {
  return js(page, async (pagesLines) => {
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    pagesLines.forEach((lines, k) => {
      const c = document.createElement("canvas"); c.width = 1275; c.height = 1650;
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#161616"; x.textBaseline = "top";
      lines.forEach((l, i) => { x.font = `${i ? 26 : 40}px Arial, sans-serif`; x.fillText(l, 110, 130 + i * 62); });
      if (k) doc.addPage();
      doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 612, 792);
    });
    const pdf = new Uint8Array(doc.output("arraybuffer"));
    let bin = ""; for (const b of pdf) bin += String.fromCharCode(b);
    return btoa(bin);
  }, pagesLines);
}
const RECEIPT_LINES = ["Harbor Hardware", "Receipt", "Date 02/14/2026", "Paint roller 12.99", "Drop cloth 8.49", "Total 21.48", "Thank you for shopping"];
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
    const urls = await js(page, async () => { const c = await caches.open("pt-lab-ocr-v2"); return (await c.keys()).map((r) => r.url); });
    const cached = urls.map((u) => u.split("/").pop());
    check(["det.onnx", "rec-en.onnx", "dict-en.txt"].every((f) => cached.includes(f)) && cached.some((f) => f.endsWith(".wasm")), `the models and the runtime are kept in Cache Storage (${cached.join(", ")})`);
    // One ONNX Runtime for OCR and the matcher (#102): the lab site's own copy, the matcher's version.
    const runtime = urls.find((u) => u.endsWith(".wasm")) || "";
    check(runtime.startsWith(origin) && runtime.includes("/lab-models/match/vendor/ort-1.31.0-dev.20260914-8d85527a0/"), `the OCR runtime is the self-hosted one the matcher uses (${runtime.replace(origin, "")})`);
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
      // The photo is a Reading card on the deck while it reads (#99); its progress line is the worker's.
      const watch = setInterval(() => { const t = (document.querySelector(".dk-card .dk-progress") || document.querySelector("#dk-empty"))?.textContent || ""; if (/OCR|text reader/.test(t)) window.__progress.push(t); if (window.__PT__.items().some((i) => i.card)) clearInterval(watch); }, 30);
    });
    await perfWindow(page, true);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__PT__.addPhotos([new File([bytes], "w2.jpg", { type: "image/jpeg" })], "W-2 photo");
    }, scans.jpeg);
    await page.waitForSelector(`${TOP}:not(.dk-reading)`, { timeout: 240000 });
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

  // 4. Send before reading finishes (#99), with the real reader: Reading cards carry the worker's
  //    progress, can't be swiped, and the one-page scan sent second is read and on top first.
  {
    const { ctx, page, problems } = await open();
    const twoPage = await makeScanPdf(page, [W2_LINES, ["Form W-2 Wage and Tax Statement 2025, page 2", "Notice to employee", "Keep Copy C for your records"]]);
    const onePage = await makeScanPdf(page, [RECEIPT_LINES]);
    await js(page, () => {
      window.__lines = [];
      // What the deck draws on the top card, and each deck item's own line (lab:progress), since a
      // card under the top one isn't drawn.
      const watch = setInterval(() => {
        document.querySelectorAll(".dk-card .dk-progress").forEach((el) => { const t = el.textContent.trim(); if (t) window.__lines.push(t); });
        for (const i of window.__PT__.items()) if (i.progress) window.__lines.push(i.progress);
      }, 25);
      window.__stopWatch = () => clearInterval(watch);
    });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuPick(page, "Import from Files")]);
    await chooser.setFiles([
      { name: "w2-two-pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(twoPage, "base64") },
      { name: "receipt-scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(onePage, "base64") },
    ]);
    await page.waitForSelector("#review:not([hidden])");
    const before = await js(page, () => window.__PT__.review());
    check(before.groups.length === 2 && before.groups.every((g) => g.status === "reading"), `the review is still reading both scans when Send is pressed (${before.groups.map((g) => g.status).join(", ")})`);
    await page.click("[data-send]");
    await page.waitForSelector("#review", { state: "hidden", timeout: 5000 });
    check(true, "Send closes the review at once, with the real reader still at work");
    await page.waitForSelector(`${TOP}.dk-reading`, { timeout: 10000 });
    const pill = await page.$eval(TOP, (el) => el.querySelector(".dk-badges .pill")?.textContent.trim());
    check(pill === "Reading", `the unread card shows the Reading pill (${pill})`);
    // Try to swipe it, flick it and key it while it reads.
    const box = await page.locator(TOP).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 28, cy);
    await page.mouse.up();
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(cx, cy - k * 40);
    await page.mouse.up();
    await page.focus(TOP).catch(() => {});
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp"]) await page.keyboard.press(key);
    await page.waitForTimeout(300);
    const untouched = await js(page, () => window.__PT__.items().every((i) => !i.decision && !i.skippedAt));
    check(untouched, "a card the real reader is still reading can't be swiped, keyed or skipped");
    // The receipt (one page, queued second) is read first and takes the top; the W-2 still reads.
    await page.waitForFunction(() => window.__PT__.items().find((i) => i.name === "receipt-scan")?.stage === "ready", null, { timeout: 240000 });
    const deckNow = await js(page, async () => {
      const deck = await import(new URL("js/deck.js", location.href).href);
      return deck.deckCards().map((i) => ({ name: i.name, unread: deck.isUnread(i), type: i.card && i.card.docType }));
    });
    check(deckNow[0] && deckNow[0].name === "receipt-scan" && !deckNow[0].unread && deckNow[1] && deckNow[1].name === "w2-two-pages" && deckNow[1].unread,
      `the scan read first is on top, the one still reading underneath (${deckNow.map((c) => `${c.name}${c.unread ? " (reading)" : ""}`).join(", ")})`);
    await page.waitForFunction(() => window.__PT__.items().every((i) => i.stage === "ready" || i.stage === "failed"), null, { timeout: 240000 });
    await js(page, () => window.__stopWatch());
    const lines = await js(page, () => [...new Set(window.__lines)]);
    check(lines.some((t) => /with OCR, \d+%|text reader ready, \d+%/.test(t)), `the Reading cards showed the OCR worker's own progress (${lines.slice(0, 4).join(" | ")})`);
    check(lines.some((t) => /page 2 of 2/.test(t)), `the two-page scan reported its pages (${lines.filter((t) => /of 2/.test(t)).slice(0, 2).join(" | ") || "none"})`);
    const done = await js(page, () => window.__PT__.items().map((i) => ({ name: i.name, type: i.card && i.card.docType, src: i.lab && i.lab.textSource })));
    const w2 = done.find((d) => d.name === "w2-two-pages");
    check(w2 && w2.type === "W-2" && w2.src === "ocr", `the two-page scan reads as a W-2 from OCR once it lands (${w2 && w2.type}, ${w2 && w2.src})`);
    await page.screenshot({ path: join(shots, "lab-ocr-early-send-phone.png") });
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
    await page.waitForSelector(`${TOP}:not(.dk-reading)`, { timeout: 240000 });
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
