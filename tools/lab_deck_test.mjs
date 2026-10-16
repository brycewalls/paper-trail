// Lab deck test (#99): in the lab, documents go to the deck before their reading finishes, and the
// deck sorts read cards to the top in the order they finish. In the real page against
// tools/fake/fake-backend.js (?lab, no ?reader=claude, so this is the lab path), with OCR held by the
// test so the reading order is the test's to choose. Covers:
//   - the scan review's Send works while every group is still reading; the review closes at once
//   - a document sent before it's read is a Reading card on the deck: the Reading pill, its own
//     progress line ("Reading the page with OCR, 50%"), no File, Shred or Skip, and it can't be
//     swiped, keyed or opened
//   - read cards go to the top in the order their reads finish, not the order they were scanned;
//     unread cards wait underneath
//   - when the top card is filed and the next one isn't read yet, the next READ card shows
//   - Skip and the Skipped chip still work alongside Reading cards; Sort now puts it back on top
//   - no console errors, at 390 px
// Runs in CI and locally:
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/lab_deck_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/public/index.html?fake=1&lab=1&hold=1`;
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });

// A one-page text PDF, made here so the repo carries no binaries (made-up senders, no real data).
function makePdf(lines) {
  const text = lines.map((l, k) => `BT /F1 ${k ? 11 : 20} Tf 72 ${720 - k * 18} Td (${l}) Tj ET`).join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1").toString("base64");
}
const BILL = makePdf(["Cascade Power and Light", "Electric service statement", "Statement date March 12, 2024", "Amount due 84.12 by April 2, 2024", "Account ending 4411."]);
const LEASE = makePdf(["Residential Lease Agreement", "Landlord: Maple Court Apartments", "Signed June 1, 2025", "Term twelve months. Rent 1,450.00 per month."]);
// What OCR "reads" from each photo, once the test lets it.
const OCR_TEXT = {
  "w2-photo.jpg": "Form W-2 Wage and Tax Statement 2025. Employer Northwind Logistics. Issued 01/30/2026. Box 1 wages 61,400.00",
  "receipt-photo.jpg": "Harbor Hardware receipt. Date 02/14/2026. Total 42.18. Thank you for shopping.",
};

// ---------- harness ----------
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const js = (page, fn, arg) => page.evaluate(fn, arg);
const TOP = ".dk-card:not(.dk-ghost)";
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => { if (!r.url().startsWith("data:") && !r.url().startsWith("blob:")) problems.push(`request failed: ${r.url()}`); });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__PT__ && window.__PT__.lab);
  await js(page, () => window.__PT__.lab.compare.setCompareEnabled(false));
  // OCR waits until the test opens its gate (one page at a time, as media.ocr runs them).
  await js(page, (texts) => {
    window.__gates = {};
    window.__PT_OCR__ = (blob) => new Promise((r) => { window.__gates[blob.name] = () => r(texts[blob.name] || ""); });
  }, OCR_TEXT);
  return { ctx, page, problems };
}
// Imports photos (OCR held) and text PDFs (read at once) together, in this order, through the same
// path as Import from Files.
async function importMixed(page, list) {
  await js(page, async ({ list, bill, lease }) => {
    const pdfs = { bill, lease };
    const files = [];
    for (const f of list) {
      if (f.pdf) { files.push(new File([Uint8Array.from(atob(pdfs[f.pdf]), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" })); continue; }
      const c = document.createElement("canvas"); c.width = 600; c.height = 780;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 600, 780); x.fillStyle = "#333"; x.font = "28px sans-serif"; x.fillText(f.name, 40, 80);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
      files.push(new File([b], f.name, { type: "image/jpeg" }));
    }
    await window.__PT__.importFiles(files);
  }, { list, bill: BILL, lease: LEASE });
  await page.waitForSelector("#review:not([hidden])");
}
const releaseOcr = async (page, name) => {
  await page.waitForFunction((n) => typeof window.__gates[n] === "function", name, { timeout: 10000 });
  await js(page, (n) => { const g = window.__gates[n]; delete window.__gates[n]; g(); }, name);
};
const deckOrder = (page) => js(page, async () => {
  const deck = await import(new URL("js/deck.js", location.href).href);
  return deck.deckCards().map((i) => ({ name: i.name, unread: deck.isUnread(i) }));
});
const topName = (page) => js(page, () => { const el = document.querySelector(".dk-card:not(.dk-ghost)"); return el ? window.__PT__.items().find((i) => i.id === el.dataset.id)?.name : null; });
// Files the top card with the right arrow; an unsure card opens the check-fields sheet first, and
// its "Confirm and file" files it the same way.
async function fileTop(page) {
  await page.focus(TOP);
  await page.keyboard.press("ArrowRight");
  const confirm = await page.waitForSelector('.sheet button:has-text("Confirm and file")', { timeout: 1500 }).catch(() => null);
  if (confirm) { await confirm.click(); await page.waitForSelector(".sheet", { state: "detached" }).catch(() => {}); }
}
const waitTop = (page, name) => page.waitForFunction((n) => {
  const el = document.querySelector(".dk-card:not(.dk-ghost):not(.dk-reading)");
  return el && window.__PT__.items().find((i) => i.id === el.dataset.id)?.name === n;
}, name, { timeout: 10000 });

try {
  // 1. Send before reading finishes; the Reading card can't be swiped; its own progress.
  {
    const { ctx, page, problems } = await open();
    await importMixed(page, [{ name: "w2-photo.jpg" }, { name: "receipt-photo.jpg" }]);
    // The first photo's OCR is under way (held), the second waits its turn.
    await page.waitForFunction(() => typeof window.__gates["w2-photo.jpg"] === "function");
    const before = await js(page, () => window.__PT__.review());
    check(before.groups.length === 2 && before.groups.every((g) => g.status === "reading"), `the review is still reading both documents (${before.groups.map((g) => g.status).join(", ")})`);
    check(!(await page.isDisabled("[data-send]")), "Send to the deck works while the documents are still reading");
    await page.click("[data-send]");
    await page.waitForSelector("#review", { state: "hidden" });
    check(true, "Send closes the review at once, without waiting for the reads");
    await page.waitForSelector(`${TOP}.dk-reading`);
    const card = await page.$eval(TOP, (el) => ({ pill: el.querySelector(".dk-badges .pill")?.textContent.trim(), title: el.querySelector(".dk-title")?.textContent.trim(),
      busy: el.getAttribute("aria-busy") }));
    check(card.pill === "Reading" && card.busy === "true", `the unread card shows a clear Reading state (pill "${card.pill}")`);
    check(card.title === "w2-photo", `the Reading card is named for its document (${card.title})`);
    await page.waitForFunction(() => /with OCR, 50%/.test(document.querySelector(".dk-card:not(.dk-ghost) .dk-progress")?.textContent || ""), null, { timeout: 5000 });
    check(true, "the Reading card shows its own reading progress (Reading the page with OCR, 50%)");
    const order = await deckOrder(page);
    check(order.length === 2 && order.every((c) => c.unread), `both documents are on the deck, unread (${order.map((c) => c.name).join(", ")})`);
    check(/2 reading/.test(await page.textContent("#deck-count")), `the subtitle counts them as reading ("${await page.textContent("#deck-count")}")`);
    const disabled = await Promise.all(["#dk-file", "#dk-shred", "#dk-skip"].map((s) => page.isDisabled(s)));
    check(disabled.every(Boolean), "File, Shred and Skip are off while the top card is reading");
    // Try to swipe it right, flick it up, use the keys, tap it.
    const box = await page.locator(TOP).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 28, cy);
    await page.mouse.up();
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(cx, cy - k * 40);
    await page.mouse.up();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await page.click(TOP);
    await page.waitForTimeout(400);
    const after = await js(page, () => window.__PT__.items().map((i) => ({ d: i.decision, s: i.skippedAt })));
    check(after.every((i) => !i.d && !i.s), "an unread card can't be swiped, keyed, filed, shredded or skipped");
    const hash = await page.evaluate(() => location.hash);
    check(hash === "" || /^#\/sort$/.test(hash), `tapping a Reading card doesn't open the details (${hash || "no hash"})`);
    check((await page.locator(`${TOP}.dk-reading`).count()) === 1, "the Reading card is still on top, untouched");
    await page.screenshot({ path: join(shots, "lab-reading-card-phone.png") });
    // Let the first read finish: it becomes a normal card that can be sorted.
    await releaseOcr(page, "w2-photo.jpg");
    await waitTop(page, "w2-photo");
    check(!(await page.isDisabled("#dk-shred")) && !(await page.isDisabled("#dk-skip")), "once read, the card can be sorted");
    const order2 = await deckOrder(page);
    check(order2[0].name === "w2-photo" && !order2[0].unread && order2[1].unread, "the read card is on top, the unread one underneath");
    await releaseOcr(page, "receipt-photo.jpg");
    await page.waitForFunction(() => window.__PT__.items().every((i) => i.stage === "ready" || i.stage === "failed"), null, { timeout: 10000 });
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 2. Read cards go to the top in the order they finish; the next READ card shows after a swipe;
  //    Skip and the Skipped chip keep working.
  {
    const { ctx, page, problems } = await open();
    // Scanned in this order: a photo (OCR held), a bill PDF (text, reads at once), another photo
    // (held), a lease PDF (reads at once).
    await importMixed(page, [{ name: "w2-photo.jpg" }, { name: "bill.pdf", pdf: "bill" }, { name: "receipt-photo.jpg" }, { name: "lease.pdf", pdf: "lease" }]);
    await page.waitForFunction(() => typeof window.__gates["w2-photo.jpg"] === "function");
    await page.click("[data-send]");
    await page.waitForSelector("#review", { state: "hidden" });
    await page.waitForFunction(() => window.__PT__.items().filter((i) => i.stage === "ready").length === 2, null, { timeout: 10000 });
    let order = await deckOrder(page);
    check(JSON.stringify(order.map((c) => c.name)) === JSON.stringify(["bill", "lease", "w2-photo", "receipt-photo"]) && !order[0].unread && !order[1].unread && order[2].unread && order[3].unread,
      `read cards on top, unread underneath, not in scan order (${order.map((c) => `${c.name}${c.unread ? " (reading)" : ""}`).join(", ")})`);
    await waitTop(page, "bill");
    check(true, "the first document read (bill) is the top card, though a photo was scanned before it");
    // Finish the first photo now: it joins after the two already read.
    await releaseOcr(page, "w2-photo.jpg");
    await page.waitForFunction(() => window.__PT__.items().find((i) => i.name === "w2-photo")?.stage === "ready", null, { timeout: 10000 });
    order = await deckOrder(page);
    check(JSON.stringify(order.map((c) => c.name)) === JSON.stringify(["bill", "lease", "w2-photo", "receipt-photo"]) && !order[2].unread,
      `a card read later joins under the ones read before it (${order.map((c) => c.name).join(", ")})`);
    // Skip the bill: the Skipped chip, the lease on top.
    await page.focus(TOP);
    await page.keyboard.press("ArrowUp");
    await waitTop(page, "lease");
    await page.waitForSelector('#dk-prompts [data-act="skipped"]');
    check(/1 skipped/.test(await page.textContent('#dk-prompts [data-act="skipped"]')), "the Skipped chip counts the skipped card while others are reading");
    // File the lease and the W-2: then only the receipt is left, still reading.
    await fileTop(page);
    await waitTop(page, "w2-photo");
    check(true, "after a swipe, the next READ card shows");
    await fileTop(page);
    await page.waitForSelector(`${TOP}.dk-reading`);
    check(await topName(page) === "receipt-photo", "with no read card left, the Reading card shows on top");
    // Sort now from the Skipped sheet puts the bill back on top, above the Reading card.
    await page.click('#dk-prompts [data-act="skipped"]');
    await page.waitForSelector(".sheet [data-sort-now]");
    await page.click(".sheet [data-sort-now]");
    await waitTop(page, "bill");
    await page.waitForSelector(".sheet", { state: "detached" }).catch(() => {});
    order = await deckOrder(page);
    check(order[0].name === "bill" && order[1].name === "receipt-photo" && order[1].unread, `Sort now puts the skipped card on top of the Reading card (${order.map((c) => c.name).join(", ")})`);
    // The receipt reads last and sits under the top card.
    await releaseOcr(page, "receipt-photo.jpg");
    await page.waitForFunction(() => window.__PT__.items().find((i) => i.name === "receipt-photo")?.stage === "ready", null, { timeout: 10000 });
    order = await deckOrder(page);
    check(order.length === 2 && order[0].name === "bill" && order[1].name === "receipt-photo" && !order[1].unread, "the last card reads and sits under the top card");
    const decided = await js(page, () => window.__PT__.items().filter((i) => i.decision).map((i) => i.name).sort());
    check(JSON.stringify(decided) === JSON.stringify(["lease", "w2-photo"]), `only the swiped cards were decided (${decided.join(", ")})`);
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll lab deck checks passed");
process.exit(failures ? 1 : 0);
