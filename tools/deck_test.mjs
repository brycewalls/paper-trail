// End-to-end deck test: opens public/index.html?fake=1 in headless Chromium (the page with Firebase,
// Claude and Drive swapped for tools/fake/fake-backend.js) and sorts a small stack the way a person
// would. Checks the things the move to Firebase is for: the ORIGINAL PDF reaches Drive byte for byte,
// photos become one PDF with an untouched JPEG inside, the archive folders are made once, a Drive
// 401 pauses uploads without losing the deck, and an account off the allowlist sees the private
// screen. Runs in CI and locally:
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/deck_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// hold=1: the deck's undo hold is one second instead of ten, so uploads start quickly (deck, #83).
const base = `http://127.0.0.1:${server.address().port}/public/index.html?fake=1&hold=1`;

// ---------- test files, made here so the repo carries no binaries ----------
function makePdf(pages, label) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const text = `BT /F1 28 Tf 72 700 Td (${label} page ${i + 1}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
function makePng(w, h, rgb) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------- harness ----------
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(query = "", viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(base + query, { waitUntil: "networkidle" });
  return { ctx, page, problems };
}
const fake = (page, fn) => page.evaluate(fn);
const TOP = ".dk-card:not(.dk-ghost)";
const waitReady = (page) => page.waitForSelector(`${TOP} .verdict-badge`, { timeout: 15000 });

try {
  // 1. Sort a stack: two PDFs and a two-photo document.
  {
    const { ctx, page, problems } = await open();
    await page.waitForSelector("#app:not([hidden])");
    check(await page.isVisible("#app"), "owner lands in the app");
    const bill = makePdf(2, "Duke Energy");
    const w2 = makePdf(1, "W-2");
    await page.setInputFiles("#file", [
      { name: "bill.pdf", mimeType: "application/pdf", buffer: bill },
      { name: "w2.pdf", mimeType: "application/pdf", buffer: w2 },
    ]);
    // a camera-style JPEG (no EXIF, so upright) plus a PNG, picked together as one document
    const jpeg = Buffer.from(await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 900; c.height = 1200;
      const x = c.getContext("2d"); x.fillStyle = "#f3efe6"; x.fillRect(0, 0, 900, 1200); x.fillStyle = "#222"; x.font = "48px serif"; x.fillText("Birth certificate", 120, 200);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      return [...new Uint8Array(await b.arrayBuffer())];
    }));
    await page.setInputFiles("#pages-file", [
      { name: "page1.jpg", mimeType: "image/jpeg", buffer: jpeg },
      { name: "page2.png", mimeType: "image/png", buffer: makePng(600, 800, [230, 230, 220]) },
    ]);

    await waitReady(page);
    check((await page.textContent(`${TOP} .verdict-badge`)).trim() === "Shred", "first card is read and stamped");
    const calls = await fake(page, () => window.__PT_FAKE__.classifyCalls.map((c) => ({ kind: c.kind, totalPages: c.totalPages, n: c.images?.length || 0, head: c.pdf ? atob(c.pdf.slice(0, 12)) : "" })));
    check(calls[0]?.kind === "pdf" && calls[0].totalPages === 2 && calls[0].head.startsWith("%PDF"), "a small PDF goes to Claude as the PDF itself");

    await page.keyboard.press("ArrowRight");                       // file the bill
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 15000 });
    const up = await fake(page, () => { const f = window.__PT_FAKE__.files[0]; return { name: f.name, parent: f.parents[0], bytes: [...f.bytes] }; });
    check(sha(Buffer.from(up.bytes)) === sha(bill), "the original PDF reaches Drive byte for byte");
    check(up.name === "2024-03-12_duke-energy-electric-bill.pdf", "it's named from Claude's filename");
    const folders = await fake(page, () => window.__PT_FAKE__.folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent })));
    const rootF = folders.find((f) => f.name === "Paperwork Archive" && f.parent === "root");
    check(!!rootF && folders.filter((f) => f.parent === rootF.id).length === 11, "Paperwork Archive and its 11 folders are made");
    check(folders.find((f) => f.id === up.parent)?.name === "06 Home", "the file lands in the folder Claude picked");

    await waitReady(page);
    await page.keyboard.press("ArrowLeft");                        // shred the W-2 without filing
    const nextIs = (stamp) => page.waitForFunction((s) => document.querySelector(".dk-card:not(.dk-ghost) .verdict-badge")?.textContent.trim() === s, stamp, { timeout: 15000 }).then(() => true, () => false);
    check(await nextIs("Keep original"), "the photo document is read");
    const photoCall = await fake(page, () => window.__PT_FAKE__.classifyCalls.find((c) => c.kind === "images"));
    check(photoCall && photoCall.images.length === 2 && photoCall.images.every((i) => i.type === "image/jpeg"), "photos go to Claude as page images");
    await page.keyboard.press("ArrowLeft");                        // a keep_original asks first (4.14)
    await page.waitForSelector(".action-sheet");
    check((await page.textContent(".action-sheet .as-title")).trim() === "Shred a Keep original?", "a keep-original card asks before it's shredded");
    await page.click(".action-sheet .as-btn.cancel");
    await page.click("#dk-file");                                  // file it instead
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 2, null, { timeout: 15000 });
    const pdf = await fake(page, () => { const f = window.__PT_FAKE__.files[1]; return { size: f.size, bytes: [...f.bytes] }; });
    const pdfBuf = Buffer.from(pdf.bytes), pdfText = pdfBuf.toString("latin1");
    check(pdfText.startsWith("%PDF") && (pdfText.match(/\/Type \/Page\b/g) || []).length === 2, "two photos become one two-page PDF");
    check(pdfBuf.includes(jpeg), "the upright JPEG is inside the PDF untouched");
    check(await fake(page, () => window.__PT_FAKE__.folders.length) === 12, "folders are reused, not made again");

    await page.waitForFunction(() => document.querySelector("#dk-empty .empty-title")?.textContent === "All sorted");
    await page.waitForFunction(() => document.querySelector("#c-all").textContent === "3");
    check((await page.textContent("#c-shred")).trim() === "2" && (await page.textContent("#c-keep")).trim() === "1", "the piles count two to shred and one original");
    const recs = await fake(page, () => [...window.__PT_FAKE__.db.entries()].filter(([k]) => k.startsWith("docs/")).map(([, v]) => v));
    const filedBill = recs.find((r) => r.title.startsWith("Duke"));
    check(filedBill?.filed === true && /drive\.google\.com\/file\/d\//.test(filedBill.driveUrl) && filedBill.physical === "to_shred", "the log has the Drive link and the pile");
    check(recs.find((r) => r.title.startsWith("W-2"))?.filed === false, "a left swipe is logged as shred without filing");
    check(await fake(page, () => window.__PT_FAKE__.db.has("paperless/duke-energy")), "Duke Energy lands on the Go paperless list");
    await page.click("[data-tab-link=piles]");                   // Piles is its own tab now (#83)
    await page.click("#tab-shred"); await page.click("[data-act=shredded]");
    await page.waitForFunction(() => document.querySelector("#st-shred").textContent === "1");
    check(true, "Mark shredded updates the stats");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 2. Drive says 401 once: a fresh token from driveToken fixes it and nothing shows (#15). When the
  //    server says the grant is gone, uploads pause, Reconnect Drive shows, and the deck keeps going.
  {
    const { ctx, page, problems } = await open("&drive401", { width: 390, height: 844 });
    await page.waitForSelector("#app:not([hidden])");
    await page.setInputFiles("#file", [{ name: "a.pdf", mimeType: "application/pdf", buffer: makePdf(1, "A") }]);
    await waitReady(page);
    await page.click("#dk-file");
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 15000 });
    check(await page.isHidden("[data-reconnect-banner] .banner"), "a single 401 from Drive mints a fresh token and the upload finishes, no banner");
    check(await fake(page, () => window.__PT_FAKE__.calls.filter((c) => c.name === "driveToken").length) === 2, "the 401 cost exactly one more driveToken call");
    await ctx.close();
  }
  {
    const { ctx, page, problems } = await open("&driverevoked", { width: 390, height: 844 });
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForSelector("#sort-body [data-reconnect-banner] .banner", { timeout: 15000 });
    check(/Drive needs reconnecting\. Your scans are safe on this phone and upload once it's back\./.test(await page.textContent("#sort-body [data-reconnect-banner]")), "the server's drive_revoked shows the Reconnect Drive banner on Sort");
    check((await page.textContent("#outbox-accessory")).includes("Reconnect Drive to keep filing"), "and the accessory's reconnect state");
    await page.setInputFiles("#file", [{ name: "a.pdf", mimeType: "application/pdf", buffer: makePdf(1, "A") }, { name: "b.pdf", mimeType: "application/pdf", buffer: makePdf(1, "B") }]);
    await waitReady(page);
    await page.click("#dk-file");
    await waitReady(page);
    check(await page.isVisible(`${TOP} .verdict-badge`), "the deck is still there while Drive waits");
    check(await fake(page, () => window.__PT_FAKE__.files.length) === 0, "nothing uploads while Drive needs reconnecting");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 1, "no sideways scroll at 390px");
    check(problems.length === 0, `no console errors at 390px (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 3. A failed read shows the failed card (3.1) and Try again recovers it.
  {
    // The reading queue retries a rate limit twice by itself (2 s, 8 s), so three failures reach
    // the card; the waits are shortened for the test.
    const { ctx, page } = await open("&readfail=3");
    await page.waitForSelector("#app:not([hidden])");
    await page.evaluate(async () => (await import("/public/js/classify.js")).setBackoff([50, 50]));
    await page.setInputFiles("#file", [{ name: "a.pdf", mimeType: "application/pdf", buffer: makePdf(1, "A") }]);
    await page.waitForSelector(`${TOP} [data-act=retry]`, { timeout: 15000 });
    check((await page.textContent(`${TOP} .dk-title`)).trim() === "Couldn't read this one" && await page.isDisabled("#dk-file") && !(await page.isDisabled("#dk-skip")),
      "a failed read says Couldn't read this one; File is off, Skip still works");
    await page.click(`${TOP} [data-act=retry]`);
    await waitReady(page);
    check(true, "Try again reads it");
    await ctx.close();
  }

  // 4. An account that isn't on the list sees the private screen; signed out sees sign-in.
  {
    const { ctx, page } = await open("&as=stranger");
    await page.waitForSelector("#btn-gate-out:not([hidden])");
    check(/isn't on the list/.test(await page.textContent("#gate-msg")) && await page.isHidden("#app"), "another account sees This account isn't on the list");
    await ctx.close();
    const s = await open("&signedout");
    await s.page.waitForSelector("#btn-signin:not([hidden])");
    await s.page.click("#btn-signin");                            // the fake's Google: a full-page redirect and back
    await s.page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    check(true, "signed out sees Sign in, and signing in opens the app");
    await s.ctx.close();
  }
} catch (e) {
  failures++;
  console.log("FAIL the test stopped:", e.message.split("\n")[0]);
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall deck checks passed");
process.exit(failures ? 1 : 0);
