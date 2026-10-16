// Capture test (#83): the Scan menu's sources, the scan review, stack mode and the page viewer, plus
// the reading queue and sender rules, in the real page against tools/fake/fake-backend.js. Covers:
//   - every Scan menu entry point opens the same three-item menu (#74, #79)
//   - Import from Files: each file one document, an unsupported file gets the spec's alert, the
//     review reads each document as it forms, Send puts them on the deck, and the ORIGINAL PDF is
//     what reaches (fake) Drive, byte for byte
//   - the classify payload rules (#75): enough text sends ONE 1000 px picture plus the text
//     (ocrPrimary), a short one sends the PDF; always wantConfidence and the sender rules
//   - a scanned pile is held until the split is decided (#54), Split into documents (#19) splits it
//     and only the split documents are read; a failed split reads the pile once
//   - scissors and Join, Rotate and Delete page, the duplicate line (#2), Cancel and Discard
//   - the page viewer (#78): title, Cut after and Join with, paging, Escape back to the thumbnail
//   - the reading queue: at most two at once, the first read alone while the cache is cold
//   - Settings, Sender rules: the count, the list, the rule detail with a live preview, save, Forget
// Runs in CI and locally:
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/capture_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/public/index.html?fake=1&reader=claude`;

// ---------- test files, made here so the repo carries no binaries ----------
function makePdf(pages, label, body = "") {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const lines = [`${label} page ${i + 1}`, ...(body ? body.match(/.{1,60}(\s|$)/g) : [])];
    const text = lines.map((l, k) => `BT /F1 ${k ? 11 : 28} Tf 72 ${700 - k * 16} Td (${l.trim()}) Tj ET`).join("\n");
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
const LONG = "Statement of account for the billing period ending March 12 2024. Amount due 84.12 by April 2. Account ending 4411. Service address 12 Elm Street. Thank you for your payment.";

// ---------- harness ----------
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(query = "", viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  return { ctx, page, problems };
}
const js = (page, fn, arg) => page.evaluate(fn, arg);
const review = (page) => js(page, () => window.__PT__.review());
const calls = (page) => js(page, () => window.__PT_FAKE__.classifyCalls.map((c) => ({ mode: c.mode || "read", kind: c.kind, images: c.images ? c.images.length : 0, ocrPrimary: !!c.ocrPrimary, ocr: (c.ocrText || "").length, want: !!c.wantConfidence, hints: (c.senderHints || []).length, pages: c.pages ? c.pages.length : 0 })));
const waitReview = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });
const allRead = (page) => waitReview(page, () => { const r = window.__PT__.review(); return r && r.groups.every((g) => g.status === "read" || g.status === "failed"); });
async function pickFiles(page, trigger, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger()]);
  await chooser.setFiles(files);
}
async function menuPick(page, button, label) {
  await page.click(button);
  await page.waitForSelector(".menu");
  await page.click(`.menu .menu-item:has-text("${label}")`);
}
// A camera page stand-in: a small picture, read by the OCR stand-in as `text`.
async function scanPages(page, texts) {
  await js(page, async (texts) => {
    window.__ocrTexts = window.__ocrTexts || new Map();
    const blobs = [];
    for (const t of texts) {
      const c = document.createElement("canvas"); c.width = 850; c.height = 1100;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 850, 1100); x.fillStyle = "#222"; x.font = "40px sans-serif"; x.fillText(t, 60, 120);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
      window.__ocrTexts.set(b, t);
      blobs.push(b);
    }
    window.__PT_OCR__ = (blob) => window.__ocrTexts.get(blob) || "";
    window.__PT__.scanned(blobs);
  }, texts);
}

try {
  // 1. Every Scan menu is the same menu; Import from Files with an unsupported file; the review reads
  //    each file; Send; the original PDF reaches Drive byte for byte; the payload rules.
  {
    const { ctx, page, problems } = await open();
    await page.waitForSelector("#dk-empty [data-scan]");
    await page.click("#dk-empty [data-scan]");
    const items = await page.$$eval(".menu .menu-item", (els) => els.map((e) => e.textContent.trim()));
    check(items.join("|") === "Scan document|Import from Files|Import from Photos", "Sort's first-time Scan opens the three-item Scan menu (#79)");
    await page.keyboard.press("Escape");
    const bill = makePdf(2, "Duke Energy");
    const long = makePdf(1, "Duke Energy", LONG);
    await pickFiles(page, () => menuPick(page, "#btn-scan-menu", "Import from Files"), [
      { name: "bill.pdf", mimeType: "application/pdf", buffer: bill },
      { name: "statement.pdf", mimeType: "application/pdf", buffer: long },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    ]);
    await page.waitForSelector(".action-sheet");
    const alert = await page.$eval(".action-sheet", (e) => e.innerText);
    check(/That file can't be filed/.test(alert) && /PDFs and photos work\. notes\.txt is a \.txt file\./.test(alert), "an unsupported file gets the spec's alert, naming it");
    await page.click(".action-sheet .as-btn.cancel");
    await page.waitForSelector("#review:not([hidden])");
    let r = await review(page);
    check(r.title === "2 files, 2 documents" && r.kind === "files", `the review title counts files and documents (${r.title})`);
    check(await page.isVisible('.review-more:has-text("Add more")'), "an import's review offers Add more");
    await allRead(page);
    r = await review(page);
    check(r.groups.every((g) => g.status === "read" && g.item.card && g.header === `${g.item.card.docType} · ${g.item.card.issuer}`), "each document is read as it forms and shows {docType} · {issuer}");
    check(await page.locator(".review-group .pill:has-text('Read')").count() === 2, "read documents show the Read pill");
    const c = await calls(page);
    const short = c.find((x) => x.kind === "pdf"), withText = c.find((x) => x.ocrPrimary);
    check(!!short && short.want && short.ocr > 0 && !short.ocrPrimary, "a short text layer sends the PDF itself with the text and wantConfidence");
    check(!!withText && withText.kind === "images" && withText.images === 1 && withText.ocr >= 120 && withText.want, "120+ characters of text send one first-page picture plus the text (ocrPrimary, #75)");
    const pic = await js(page, () => { const p = window.__PT_FAKE__.classifyCalls.find((x) => x.ocrPrimary); return new Promise((res) => { const i = new Image(); i.onload = () => res(Math.max(i.width, i.height)); i.src = "data:image/jpeg;base64," + p.images[0].data; }); });
    check(pic === 1000, `the first-page picture is 1000 px on the long side (${pic})`);
    // Send
    check(await page.textContent("[data-send]") === "Send 2 to the deck", "Send counts the documents");
    await page.click("[data-send]");
    await page.waitForSelector("#review", { state: "hidden" });
    await page.waitForSelector(".dk-card:not(.dk-ghost) .verdict-badge", { timeout: 15000 });
    check((await js(page, () => window.__PT__.items().filter((i) => i.stage === "ready").length)) === 2, "Send puts both documents on the deck, already read");
    check(await js(page, () => document.activeElement && document.activeElement.closest("#view-sort") !== null), "focus goes back to Sort after Send");
    await page.click("#dk-file");
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 15000 });
    const up = await js(page, () => [...window.__PT_FAKE__.files[0].bytes]);
    const filed = Buffer.from(up);
    check(sha(filed) === sha(bill) || sha(filed) === sha(long), "the original imported PDF reaches Drive byte for byte");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 2. A scanned pile (#54, #19): held until the split is decided; Split into documents; only the
  //    split documents are read. Then the page viewer, scissors and Join, Rotate and Delete page.
  {
    const { ctx, page, problems } = await open();
    await scanPages(page, ["Acme payroll W-2 page 1", "Acme payroll page 2", "Duke Energy bill page 1", "Duke Energy page 2"]);
    await page.waitForSelector("#review:not([hidden])");
    await waitReview(page, () => window.__PT__.review().groups[0].status === "held");
    let r = await review(page);
    check(r.title === "4 pages, 1 document" && r.groups[0].header === "Reads when you split or send", "a scanned pile is held: \"Reads when you split or send\"");
    check(await page.locator(".review-group .pill").count() === 0, "a held pile shows no pill");
    check((await calls(page)).length === 0, "no read is spent on the unsplit pile (#54)");
    check(await page.isEnabled("[data-send]"), "Send works while the pile is held");
    check(await page.isVisible('.review-more:has-text("Scan more")'), "a scan's review offers Scan more");
    await page.click(".split-offer");
    await waitReview(page, () => window.__PT__.review().split === "done");
    await allRead(page);
    r = await review(page);
    const c = await calls(page);
    check(r.title === "4 pages, 2 documents" && r.groups.map((g) => g.pages).join() === "2,2", `Split into documents splits the pile where Claude says (${r.title})`);
    check(c.filter((x) => x.mode === "split").length === 1 && c.find((x) => x.mode === "split").pages === 4, "one split call with all four pages");
    check(c.filter((x) => x.mode === "read").length === 2, `then exactly one read per document, none for the whole pile (${c.filter((x) => x.mode === "read").length})`);
    check(/Claude found 2 documents/.test(await page.textContent(".review-split")), "the split row says what Claude found");
    // the page viewer
    await page.click(".review-group >> nth=0 >> .page-thumb >> nth=0");
    await page.waitForSelector("#viewer:not([hidden])");
    check(await page.textContent(".viewer-title") === "Page 1 of 4 · Document 1", "the viewer's title: Page 1 of 4 · Document 1");
    check(await page.isVisible('.glass-capsule:has-text("Cut after page 1")'), "Cut after page 1 is offered");
    await page.click('.glass-capsule:has-text("Cut after page 1")');
    check((await review(page)).documents === 3, "Cut after splits the review behind");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".viewer-title").textContent === "Page 2 of 4 · Document 2");
    check(await page.isVisible('.glass-capsule:has-text("Join with page 1")') && await page.isVisible('.glass-capsule:has-text("Join with page 3")'), "page 2 alone offers Join with page 1 and Join with page 3");
    await page.click('.glass-capsule:has-text("Join with page 1")');
    check((await review(page)).documents === 2 && await page.textContent(".viewer-title") === "Page 2 of 4 · Document 1", "Join with page 1 joins it back");
    const fullSrc = await page.$eval('.viewer-page[data-page] img', (i) => i.src);
    check(fullSrc.startsWith("blob:"), "the viewer shows the page picture");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#viewer", { state: "hidden" });
    check(await js(page, () => document.activeElement.classList.contains("page-thumb")), "closing the viewer goes back to the page's thumbnail");
    // scissors and Join in the strip
    await page.click(".review-group >> nth=0 >> .split-here");
    check((await review(page)).documents === 3, "the scissors split a document");
    await page.click(".join-btn >> nth=0");
    check((await review(page)).documents === 2, "Join merges a document into the one above");
    // rotate and delete
    await page.click(".review-group >> nth=1 >> .page-thumb >> nth=1", { button: "right" });
    await page.waitForSelector('.menu-item:has-text("Rotate")');
    await page.click('.menu-item:has-text("Rotate")');
    await page.click(".review-group >> nth=1 >> .page-thumb >> nth=1", { button: "right" });
    await page.click('.menu-item:has-text("Delete page")');
    r = await review(page);
    check(r.title === "3 pages, 2 documents", `Delete page removes it (${r.title})`);
    // Cancel asks first
    await page.click(".review-cancel");
    await page.waitForSelector(".action-sheet");
    check(/Discard 3 pages\?/.test(await page.textContent(".action-sheet")), "Cancel asks \"Discard 3 pages?\"");
    await page.click('.as-btn:has-text("Keep editing")');
    check(await page.isVisible("#review"), "Keep editing keeps the review");
    await page.click(".review-cancel");
    await page.click('.as-btn:has-text("Discard")');
    await page.waitForSelector("#review", { state: "hidden" });
    check((await js(page, () => window.__PT__.items().length)) === 0, "Discard sends nothing to the deck");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 3. Send while held reads the pile once; a failed split reads it once too; Scan more holds again.
  {
    const { ctx, page, problems } = await open("&splitfail");
    await scanPages(page, ["Acme page 1", "Acme page 2", "Duke page 1"]);
    await waitReview(page, () => window.__PT__.review().groups[0].status === "held");
    await page.click(".split-offer");
    await waitReview(page, () => window.__PT__.review().split === "failed");
    check(/Claude couldn't split this stack/.test(await page.textContent(".review-split")) && await page.isVisible('.link-btn:has-text("Try again")'), "a failed split says so and offers Try again");
    await allRead(page);
    check((await calls(page)).filter((x) => x.mode === "read").length === 1, "a failed split reads the pile once, as one document");
    await scanPages(page, ["Water bill page 1", "Water page 2"]);
    await waitReview(page, () => window.__PT__.review().pages === 5 && window.__PT__.review().groups[0].status === "held");
    let r = await review(page);
    check(r.documents === 1 && r.groups[0].status === "held", "Scan more appends to the last document and holds it again");
    await page.click("[data-send]");
    await page.waitForSelector("#review", { state: "hidden" });
    await page.waitForFunction(() => window.__PT__.items().length === 1 && window.__PT__.items()[0].stage !== "reading", null, { timeout: 15000 });
    check((await calls(page)).filter((x) => x.mode === "read").length === 2, "Send reads the held pile once");
    check((await js(page, () => window.__PT__.items()[0].numPages)) === 5, "the pile goes to the deck as one 5-page document");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 4. Photos are one document; a duplicate shows its line and Skip leaves it out (#2).
  {
    const w2 = makePdf(1, "W-2", LONG);
    const { ctx, page, problems } = await open(`&dupe=${sha(w2)}`);
    await pickFiles(page, () => menuPick(page, "#btn-scan-menu", "Import from Photos"), [
      { name: "a.png", mimeType: "image/png", buffer: makePng(400, 520, [250, 250, 250]) },
      { name: "b.png", mimeType: "image/png", buffer: makePng(400, 520, [240, 240, 240]) },
    ]);
    await page.waitForSelector("#review:not([hidden])");
    check((await review(page)).title === "2 photos, 1 document", "photos picked together are one document");
    await pickFiles(page, () => menuPick(page, "[data-scan-more]", "Import from Files"), [{ name: "w2.pdf", mimeType: "application/pdf", buffer: w2 }]);
    await page.waitForFunction(() => window.__PT__.review().documents === 2);
    await page.waitForSelector(".dup-line");
    const dup = await page.textContent(".dup-line p");
    check(dup.trim() === "Already filed on Oct 2 as 2025 W-2.", `the duplicate line: ${dup.trim()}`);
    await page.click('.dup-line .chip:has-text("Skip")');
    check(await page.textContent("[data-send]") === "Send 1 to the deck", "Skip leaves the duplicate out of Send");
    await page.click('.dup-line .chip:has-text("File again")');
    check(await page.textContent("[data-send]") === "Send 2 to the deck", "File again puts it back");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 5. The reading queue: the first read goes alone while the cache is cold, then two at a time.
  {
    const { ctx, page, problems } = await open();
    await pickFiles(page, () => menuPick(page, "#btn-scan-menu", "Import from Files"),
      [1, 2, 3, 4].map((n) => ({ name: `doc${n}.pdf`, mimeType: "application/pdf", buffer: makePdf(1, `Doc ${n}`) })));
    await allRead(page);
    const t = await js(page, () => window.__PT__.reads);
    check(t.peak === 2, `never more than two reads at once (${t.peak})`);
    const [first, second] = t.timings;
    check(second.waited + second.build >= first.build + first.call - 30, "the second read waits for the first answer (a cold cache)");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 5b. A rate limit is retried by the queue itself; the document still reads.
  {
    const { ctx, page, problems } = await open("&readfail");
    await js(page, async () => (await import("/public/js/classify.js")).setBackoff([50, 50]));
    await pickFiles(page, () => menuPick(page, "#btn-scan-menu", "Import from Files"), [{ name: "a.pdf", mimeType: "application/pdf", buffer: makePdf(1, "A") }]);
    await allRead(page);
    check((await review(page)).groups[0].status === "read" && (await calls(page)).length === 2, "a rate limit is retried once by the reading queue, and the document reads");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 6. Sender rules: hints on every read, Settings row and screen, rule detail, save, Forget.
  {
    const { ctx, page, problems } = await open("&seed");
    await pickFiles(page, () => menuPick(page, "#btn-scan-menu", "Import from Files"), [{ name: "bill.pdf", mimeType: "application/pdf", buffer: makePdf(1, "Duke") }]);
    await allRead(page);
    check((await calls(page))[0].hints === 2, "every read sends the sender rules as senderHints");
    await page.click(".review-cancel"); await page.click('.as-btn:has-text("Discard")');
    await page.waitForSelector("#review", { state: "hidden" });
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("[data-open-senders]");
    check((await page.innerText("[data-open-senders]")).replace(/\s+/g, " ").trim() === "Sender rules 2", "Settings shows Sender rules · 2");
    await page.click("[data-open-senders]");
    await page.waitForSelector(".senders [data-rule]");
    const rows = await page.$$eval(".senders [data-rule]", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check(rows[0].startsWith("Cascade Power & Light Home · Scan + shred · {date}_{issuer}-electric-bill") && rows[1].startsWith("Northwind Logistics Taxes · Scan + shred"), "rules list A to Z with {folder} · {verdict} · {pattern}");
    await page.fill("[data-senders-search]", "north");
    check((await page.$$(".senders [data-rule]")).length === 1, "the search field filters senders");
    await page.fill("[data-senders-search]", "zzz");
    check(/No results for "zzz"/.test(await page.textContent(".senders")), "no match shows the search empty state");
    await page.fill("[data-senders-search]", "");
    await page.click('[data-rule="cascade-power-light"]');
    await page.waitForSelector('[data-f="filenamePattern"]');
    check(await page.textContent(".senders-sheet .sheet-title") === "Cascade Power & Light", "the rule detail is titled with the sender");
    const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    check(await page.textContent("[data-preview]") === `${day}_cascade-power-light-electric-bill.pdf`, "the live preview fills the pattern");
    await page.fill('[data-f="filenamePattern"]', "");
    await page.click('[data-token="{yyyy}"]');
    await page.click('[data-token="{issuer}"]');
    check(await page.inputValue('[data-f="filenamePattern"]') === "{yyyy}{issuer}" && await page.textContent("[data-preview]") === `${today.getFullYear()}cascade-power-light.pdf`, "the token chips add to the pattern and the preview follows");
    await page.selectOption('[data-f="folder"]', "03 Money & Banking");
    await page.click('[data-f="verdict"] [data-seg="shred"]');
    check(/Updated [A-Z][a-z]{2} \d+/.test(await page.textContent(".senders .group-footer")), "the footer says when the rule was updated");
    await page.click("[data-senders-back]");
    await page.waitForFunction(() => { const r = window.__PT_FAKE__.db.get("senders/cascade-power-light"); return r && r.filenamePattern === "{yyyy}{issuer}"; });
    const saved = await js(page, () => window.__PT_FAKE__.db.get("senders/cascade-power-light"));
    check(saved.folder === "03 Money & Banking" && saved.verdict === "shred" && saved.key === "cascade-power-light", "going back saves the rule to users/{uid}/senders");
    check((await page.textContent('[data-rule="cascade-power-light"]')).includes("Money & Banking · Shred · {yyyy}{issuer}"), "the list shows the saved rule");
    await page.click('[data-rule="northwind-logistics"]');
    await page.click('[data-action="forget"]');
    await page.waitForSelector(".action-sheet");
    check(/Forget Northwind Logistics\? Their cards go back to Claude's best guess\./.test(await page.textContent(".action-sheet")), "Forget asks first, in the spec's words");
    await page.click('.as-btn:has-text("Forget")');
    await page.waitForFunction(() => !window.__PT_FAKE__.db.has("senders/northwind-logistics"));
    check((await page.$$(".senders [data-rule]")).length === 1, "Forget removes the rule");
    await page.click("[data-senders-back]");
    await page.waitForFunction(() => !document.querySelector(".senders-sheet"));
    check((await page.innerText("[data-open-senders]")).replace(/\s+/g, " ").trim() === "Sender rules 1", "the Settings count follows");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 7. Sender rules apply on the client when the reply has no appliedRule (an older function).
  {
    const { ctx, page } = await open();
    const out = await js(page, async () => {
      const m = await import("/public/js/classify.js");
      const card = m.normalize({ title: "Electric bill", docType: "Utility bill", issuer: "CASCADE POWER & LIGHT", docDate: "2026-09-28", folder: "11 Other", filename: "x", verdict: "shred", confidence: { overall: 0.5, fields: { issuer: 0.5, folder: 0.6 }, sparse: true }, alternatives: { issuer: ["Cascade"] } });
      const rule = { key: "cascade-power-light", issuer: "Cascade Power & Light", folder: "06 Home", verdict: "scan_shred", filenamePattern: "{date}_{issuer}-electric-bill" };
      const applied = m.applySenderRule(card, [rule]);
      return { applied, unsureBefore: m.unsureFields(card), unsureAfter: m.unsureFields(applied), confident: m.isConfident(applied), pattern: m.patternFromFilename("2026-09-28_cascade-electric-bill", "2026-09-28") };
    });
    check(out.applied.issuer === "Cascade Power & Light" && out.applied.folder === "06 Home" && out.applied.verdict === "scan_shred" && out.applied.filename === "2026-09-28_cascade-power-light-electric-bill" && out.applied.appliedRule === "cascade-power-light", "applySenderRule matches functions/lib.js: spelling, folder, verdict, filename");
    check(out.unsureBefore.join() === "issuer,folder" && !out.unsureAfter.length && out.confident && out.applied.alternatives.issuer.length === 0, "fields a rule set become certain (#20)");
    check(out.pattern === "{date}_cascade-electric-bill", "a confirmed filename's date becomes {date}");
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} capture check(s) failed` : "\nall capture checks passed");
process.exit(failures ? 1 : 0);
