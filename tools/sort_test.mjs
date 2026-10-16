// Sort deck test (deck, #20, #77, #83): drives the rebuilt deck in headless Chromium against
// tools/fake/fake-backend.js the way a person would. Covers the spec's deck behavior that
// deck_test.mjs (filing to Drive) doesn't: drag with the overlays and snap-back, swipe up to skip,
// the Skipped chip and sheet, the 10-second undo hold (shortened with ?hold), Undo for every kind of
// decision, Keep original confirm, the check-fields sheet with Remember for this sender, bulk filing
// from the Settings toggle, the card detail and its folder picker, Fill it in yourself, the
// read-only document view, the keyboard, and the empty states, at 390 px in both themes.
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/sort_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

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
// The fake reads a PDF that mentions W-2 as the W-2 (scan_shred, sensitive), anything else as the
// Duke Energy bill (shred), and photos as the birth certificate (keep_original).
const pdf = (name, label, pages = 1) => ({ name, mimeType: "application/pdf", buffer: makePdf(pages, label) });

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(query = "", { width = 390, height = 844, scheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: false });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  return { ctx, page, problems };
}
const TOP = ".dk-card:not(.dk-ghost)";
const topTitle = (page) => page.evaluate(() => document.querySelector(".dk-card:not(.dk-ghost) .dk-title, .dk-card:not(.dk-ghost) .unsure-row span")?.textContent.trim() || "");
const topId = (page) => page.evaluate(() => document.querySelector(".dk-card:not(.dk-ghost)")?.dataset.id || "");
const waitCards = (page, n) => page.waitForFunction((n) => /^(\d+) to go/.exec(document.getElementById("deck-count").textContent)?.[1] === String(n), n, { timeout: 15000 });
const fake = (page, fn, arg) => page.evaluate(fn, arg);
const filesUp = (page) => fake(page, () => window.__PT_FAKE__.files.length);
const docs = (page) => fake(page, () => [...window.__PT_FAKE__.db.entries()].filter(([k]) => k.startsWith("docs/")).map(([, v]) => v));
const settle = (page, ms = 700) => page.waitForTimeout(ms);
async function drag(page, dx, dy, { release = true, steps = 12 } = {}) {
  const b = await page.locator(TOP).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
  if (release) await page.mouse.up();
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1);

try {
  // 1. The first-time empty state, reading, then the card per spec 3.1; drag, overlays, snap-back.
  {
    const { ctx, page, problems } = await open("&hold=1");
    check((await page.textContent("#dk-empty .empty-title")) === "Scan your first stack", "a new account sees Scan your first stack");
    await page.click("#dk-empty .cbtn");
    check(await page.isVisible('.menu-item:has-text("Import from Files")'), "its Scan button opens the Scan menu (#79)");
    await page.keyboard.press("Escape");
    await page.setInputFiles("#file", [pdf("bill.pdf", "Duke Energy", 2), pdf("w2.pdf", "W-2")]);
    await page.waitForFunction(() => /Reading \d documents?/.test(document.querySelector("#dk-empty .empty-title")?.textContent || "") || document.querySelector(".dk-card"), null, { timeout: 5000 }).catch(() => {});
    await waitCards(page, 2);
    check((await page.textContent("#deck-count")) === "2 to go · 2 ready to file", "the subtitle reads 2 to go · 2 ready to file");
    const card = await page.evaluate(() => {
      const c = document.querySelector(".dk-card:not(.dk-ghost)");
      return { title: c.querySelector(".dk-title")?.textContent, meta: c.querySelector(".dk-meta")?.textContent, folder: c.querySelector(".dk-folder")?.textContent,
        file: c.querySelector(".dk-filename")?.textContent, pages: c.querySelector(".dk-pages")?.textContent, badge: c.querySelector(".verdict-badge")?.textContent,
        peeks: document.querySelectorAll("#dk-stack .dk-peek").length, label: c.getAttribute("aria-label"), radius: getComputedStyle(c).borderTopLeftRadius,
        well: c.querySelector(".dk-well").getBoundingClientRect().height };
    });
    check(card.title === "Duke Energy bill, March 2024" && card.meta === "Duke Energy · Mar 12, 2024" && card.folder === "Home" && card.file === "2024-03-12_duke-energy-electric-bill.pdf",
      "the card shows title, {issuer} · {date}, the folder's display name and the filename");
    check(card.pages === "2 pages" && card.badge === "Shred" && card.radius === "30px" && Math.round(card.well) === 236, "page count, VerdictBadge, 30 pt radius and the 236 pt scan well");
    check(card.peeks === 1, "one peek behind the card when one more card waits");
    check(card.label.startsWith("Duke Energy bill, March 2024. Duke Energy, Mar 12, 2024. Shred. Folder Home."), "the card reads as one element with the spec's label");
    // drag short of the threshold: overlay fades in, then the card snaps back
    const before = await topId(page);
    await drag(page, 70, 4, { release: false });
    const mid = await page.evaluate(() => { const c = document.querySelector(".dk-card:not(.dk-ghost)"); return { t: c.style.transform, file: Number(c.querySelector(".dk-ov-file").style.opacity), shred: Number(c.querySelector(".dk-ov-shred").style.opacity || 0) }; });
    check(/rotate\(\d/.test(mid.t) && mid.file > 0.5 && mid.file < 1 && mid.shred === 0, "dragging right rotates the card and fades in File, not Shred");
    await page.mouse.up();
    await settle(page);
    check(await topId(page) === before && await page.evaluate(() => !document.querySelector(".dk-card:not(.dk-ghost)").style.transform), "released short, it snaps back");
    // drag past the threshold: it flies off, the next card rises, and the hold delays the upload
    await drag(page, 190, 6);
    await page.waitForFunction(() => document.querySelector(".dk-card:not(.dk-ghost) .dk-title")?.textContent.startsWith("W-2"), null, { timeout: 5000 });
    check(await filesUp(page) === 0, "a right swipe files, but nothing uploads during the undo hold");
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 15000 });
    check(true, "the hold ends and the upload starts");
    check(/^Filed Duke Energy bill, March 2024\. Next: W-2 from Acme Corp, 2023\.$/.test(await page.textContent("#dk-live")), "the screen reader hears Filed {title}. Next: {next}.");
    // the card that rose follows the finger too (no animation left holding it), and a left drag shreds
    await settle(page);
    const x0 = (await page.locator(TOP).boundingBox()).x;
    await drag(page, -60, 0, { release: false });
    const x1 = (await page.locator(TOP).boundingBox()).x;
    check(x1 < x0 - 40 && Number(await page.evaluate(() => document.querySelector(".dk-card:not(.dk-ghost) .dk-ov-shred").style.opacity)) > 0.4, "the next card follows a left drag and fades in Shred");
    await page.mouse.up();
    await settle(page);
    await drag(page, -190, 0);
    await page.waitForFunction(() => document.querySelector("#dk-empty .empty-title")?.textContent === "All sorted", null, { timeout: 5000 });
    check((await page.textContent("#dk-empty .empty-desc")) === "2 filed today. The outbox is handling the uploads.", "All sorted counts what was filed today");
    check(await noSideScroll(page), "no sideways scroll at 390 px");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 2. Undo: inside the hold nothing reaches the outbox; skip and Undo; the next decision releases.
  {
    const { ctx, page, problems } = await open("&hold=30");
    await page.setInputFiles("#file", [pdf("a.pdf", "Duke A"), pdf("w2.pdf", "W-2"), pdf("c.pdf", "Duke C")]);
    await waitCards(page, 3);
    const first = await topId(page);
    check(await page.isDisabled("#dk-undo") && (await page.getAttribute("#dk-undo", "aria-label")) === "Undo, nothing to undo", "Undo is off with nothing to undo");
    await page.click("#dk-file");
    await settle(page);
    check(await topId(page) !== first && !(await page.isDisabled("#dk-undo")) && (await page.getAttribute("#dk-undo", "aria-label")) === "Undo last swipe", "File takes the card off; Undo is on");
    await page.click("#dk-undo");
    await settle(page);
    check(await topId(page) === first && await filesUp(page) === 0 && (await docs(page)).length === 0, "Undo inside the hold brings it back with nothing to reverse");
    // Skip: swipe up, the chip, Undo brings it back from above
    await drag(page, 4, -200);
    await page.waitForSelector('#dk-prompts .cbtn:has-text("1 skipped")');
    check(await topId(page) !== first, "swipe up skips the card; the 1 skipped chip shows");
    check((await page.getAttribute('#dk-prompts .cbtn:has-text("1 skipped")', "aria-description")) === "Shows the cards you skipped.", "the chip has its hint");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await settle(page);
    check(await topId(page) === first && await page.isHidden("#dk-prompts"), "Cmd or Ctrl+Z undoes the skip; the chip goes");
    // the next decision releases the held one
    await page.keyboard.press("ArrowRight");          // file A (held 30 s)
    await settle(page, 300);
    await page.keyboard.press("ArrowLeft");           // shred the W-2: A is released now
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 10000 });
    check(true, "the next decision releases the previous one to the outbox at once");
    check((await docs(page)).length === 1, "the shred is still held");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 3. The Skipped set: chip, sheet, Sort now, the only-skipped empty state, Sort skipped.
  {
    const { ctx, page, problems } = await open("&hold=1");
    await page.setInputFiles("#file", [pdf("a.pdf", "Duke A"), pdf("w2.pdf", "W-2"), pdf("c.pdf", "Duke C")]);
    await waitCards(page, 3);
    const order = [];
    for (let k = 0; k < 3; k++) { order.push(await topId(page)); await page.click("#dk-skip"); await settle(page, 450); }
    check((await page.textContent("#dk-empty .empty-title")) === "3 skipped. Sort them now?", "with only skipped cards left: 3 skipped. Sort them now?");
    check(await page.isVisible('#dk-empty .cbtn:has-text("Sort skipped")') && await page.isVisible('#dk-empty .cbtn:has-text("Scan more")'), "it offers Sort skipped and Scan more");
    check(/^Skipped .+\. 3 skipped\. Sort them now\?$/.test(await page.textContent("#dk-live")), "the last skip announces the question");
    await page.click('#dk-prompts .cbtn:has-text("3 skipped")');
    await page.waitForSelector(".sheet .sheet-title");
    check((await page.textContent(".sheet .sheet-title")) === "3 skipped" && (await page.locator(".sheet [data-sort-now]").count()) === 3, "the sheet lists the 3 skipped cards");
    check(/Nothing uploads while they wait\./.test(await page.textContent(".sheet .group-footer")), "with the footer");
    await page.locator(".sheet [data-sort-now]").nth(1).click();
    await settle(page, 300);
    check(await topId(page) === order[1] && (await page.textContent(".sheet .sheet-title")) === "2 skipped", "Sort now puts that card on top; the sheet stays for the rest");
    await page.click(".sheet [data-sort-all]");
    await page.waitForSelector(".sheet", { state: "detached" });
    await settle(page, 300);
    check(await topId(page) === order[0] && (await page.textContent("#deck-count")).startsWith("3 to go"), "Sort skipped deals the rest back to the front, in the order they were skipped");
    check(/^2 cards back on the deck\.$/.test(await page.textContent("#dk-live")), "it announces 2 cards back on the deck.");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 4. Keep original confirm (4.14): photos read as a birth certificate.
  {
    const { ctx, page, problems } = await open("&hold=1");
    const png = makePng(600, 800, [240, 236, 226]);
    await page.setInputFiles("#pages-file", [{ name: "p1.png", mimeType: "image/png", buffer: png }]);
    await waitCards(page, 1);
    check((await page.textContent(`${TOP} .verdict-badge`)) === "Keep original", "the photo reads as a Keep original");
    await drag(page, -60, 0, { release: false });
    check((await page.textContent(`${TOP} .dk-ov-shred`)).trim() === "Shred? Asks first", "its Shred overlay says Shred? Asks first");
    await page.mouse.up();
    await settle(page);
    await page.click("#dk-shred");
    await page.waitForSelector(".action-sheet");
    check((await page.textContent(".as-title")) === "Shred a Keep original?" && (await page.textContent(".as-message")).startsWith("Claude marked this one to keep the paper. A certified birth certificate"),
      "Shred asks Shred a Keep original? with Claude's reason");
    await page.click(".as-btn.cancel");
    await settle(page, 300);
    check((await page.textContent("#deck-count")).startsWith("1 to go"), "Cancel leaves it on the deck");
    await page.click("#dk-shred");
    await page.click('.as-btn:has-text("Shred anyway")');
    await page.waitForFunction(() => [...window.__PT_FAKE__.db.keys()].some((k) => k.startsWith("docs/")), null, { timeout: 10000 });
    const rec = (await docs(page))[0];
    check(rec.filed === false && rec.physical === "to_shred" && (await filesUp(page)) === 0, "Shred anyway logs it as shredded with no Drive copy");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 5. The unsure card and the check-fields sheet (A2, 3.8), with Remember for this sender.
  {
    const { ctx, page, problems } = await open("&unsure&hold=1");
    await page.setInputFiles("#file", [pdf("bill.pdf", "Duke Energy"), pdf("bill2.pdf", "Duke Energy again")]);
    await waitCards(page, 2);
    const c = await page.evaluate(() => { const el = document.querySelector(".dk-card:not(.dk-ghost)"); return {
      pill: el.querySelector(".dk-badges .pill-unsure")?.textContent, rows: [...el.querySelectorAll(".unsure-row")].map((r) => r.textContent),
      well: Math.round(el.querySelector(".dk-well").getBoundingClientRect().height), label: el.getAttribute("aria-label") }; });
    check(c.pill === "2 to check" && c.rows.join("|") === "Duke EnergyNot sure|Mar 12, 2024Not sure" && c.well === 96, "the unsure card: 2 to check, Not sure rows for sender and date, a 96 pt well");
    check(/2 fields to check: sender, statement date\.$/.test(c.label), "its label lists the fields to check");
    check((await page.textContent("#deck-count")) === "2 to go · 0 ready to file", "unsure cards don't count as ready to file");
    // swipe right: snaps back, the sheet opens instead
    await drag(page, 200, 0);
    await page.waitForSelector(".cf-sheet .sheet-title");
    check((await page.textContent(".cf-sheet .sheet-title")) === "Check 2 fields" && (await page.textContent(".cf-sheet .sheet-subtitle")) === "Everything else looks right.", "a right swipe opens Check 2 fields");
    check((await page.locator(".cf-sheet .group-header").allTextContents()).slice(0, 2).join("|") === "Sender|Statement date", "sections Sender and Statement date");
    check(await page.evaluate(() => document.querySelector(".cf-sheet").closest(".sheet").dataset.detent) === "medium" && await filesUp(page) === 0, "at the medium detent, nothing filed");
    const opts = await page.locator('.cf-sec[data-field=issuer] .radio-row').allTextContents();
    check(opts[0] === "Duke Energylikely" && opts[1] === "Duke Energy Progresspossible" && opts[2] === "Something else", "Claude's value is likely, the other guess possible, then Something else");
    // Escape cancels
    await page.keyboard.press("Escape");
    await page.waitForSelector(".cf-sheet", { state: "detached" });
    check((await page.textContent("#deck-count")).startsWith("2 to go"), "swiping the sheet away leaves the card unchanged");
    // tap the date row: the sheet opens at the date; pick the other date chip
    await page.click(`${TOP} [data-check=docDate]`);
    await page.waitForSelector(".cf-sheet .cf-sec.cf-focus[data-field=docDate]");
    check(true, "tapping a Not sure row opens the sheet at that field");
    check((await page.locator(".cf-sec[data-field=docDate] .chip").allTextContents()).join("|") === "Mar 12, 2024|Mar 28, 2024|Pick a date", "date chips: Claude's, the other guess, Pick a date");
    await page.click('.cf-sec[data-field=docDate] .chip:has-text("Mar 28, 2024")');
    // Something else turns into a text field in place
    await page.click('.cf-sec[data-field=issuer] .radio-row:has-text("Something else")');
    check(await page.isVisible(".cf-sec[data-field=issuer] .radio-field") && await page.evaluate(() => document.activeElement?.classList.contains("radio-field")), "Something else becomes a text field, focused");
    await page.click('.cf-sec[data-field=issuer] .radio-row:has-text("Duke Energy")');
    check(await page.isChecked("#cf-remember") && /^Next time, Duke Energy files this way without asking\.$/.test(await page.textContent(".cf-remember-foot")), "Remember for this sender is on, with its footer");
    await page.click(".cf-sheet [data-confirm]");
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 15000 });
    const up = await fake(page, () => window.__PT_FAKE__.files[0].name);
    check(up === "2024-03-28_duke-energy-electric-bill.pdf", "Confirm and file files it; the filename follows the confirmed date");
    const rule = await fake(page, () => window.__PT_FAKE__.db.get("senders/duke-energy"));
    check(rule?.issuer === "Duke Energy" && rule.folder === "06 Home" && rule.verdict === "shred" && rule.filenamePattern === "{date}_duke-energy-electric-bill" && !!rule.updatedAt,
      "a sender rule is saved for Duke Energy (folder, verdict, {date} pattern)");
    const rec = (await docs(page))[0];
    check(rec.docDate === "2024-03-28" && rec.confidence?.fields?.issuer === 1 && rec.confidence?.fields?.docDate === 1, "the record carries the confirmed values, marked confident");
    // the rule lands on the next card from that sender: the sender is no longer Not sure
    const c2 = await page.evaluate(() => [...document.querySelectorAll(".dk-card:not(.dk-ghost) .unsure-row")].map((r) => r.dataset.check));
    check(c2.join(",") === "docDate", "the waiting card from that sender now only asks for the date");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 6. Bulk filing: off by default; the Settings toggle; the sheet with toggles; one-step Undo.
  {
    const { ctx, page, problems } = await open("&hold=30");
    await page.setInputFiles("#file", [pdf("a.pdf", "Duke A"), pdf("w2.pdf", "W-2"), pdf("c.pdf", "Duke C"), pdf("d.pdf", "Duke D")]);
    await waitCards(page, 4);
    check(await page.isHidden("#dk-prompts"), "no bulk prompt while the setting is off (decision 5)");
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("#set-bulk");
    check(!(await page.isChecked("#set-bulk")) && /You still see each one in the list first\./.test(await page.textContent('[data-settings-section=sorting]')), "Settings has the toggle, off, with its footer");
    await page.click('label[for="set-bulk"]');
    await page.waitForFunction(() => window.__PT_FAKE__.db.get("config/settings")?.offerBulkFile === true);
    check(true, "turning it on saves offerBulkFile to config/settings");
    await page.click("[data-settings-done]");
    await page.waitForSelector(".sheet", { state: "detached" });
    check((await page.textContent("#dk-prompts")) === "File the other 3 confident cards", "Sort offers File the other 3 confident cards");
    await page.click('#dk-prompts .cbtn:has-text("File the other")');
    await page.waitForSelector(".dk-sheet .sheet-title");
    check((await page.textContent(".dk-sheet .sheet-title")) === "File 3 confident cards" && (await page.textContent(".dk-sheet .sheet-subtitle")).startsWith("Claude is sure about every field on these."), "the sheet: File 3 confident cards");
    await page.locator(".dk-sheet [data-bulk]").first().click();
    check((await page.textContent(".dk-sheet [data-bulk-go]")).trim() === "File 2" && (await page.locator('.dk-sheet [data-bulk][aria-checked="false"]').count()) === 1, "unticking a row makes it File 2");
    const top = await topId(page);
    await page.click(".dk-sheet [data-bulk-go]");
    await page.waitForSelector(".dk-sheet", { state: "detached" });
    check((await page.textContent("#deck-count")).startsWith("2 to go") && await topId(page) === top, "two cards leave the deck; the top card stays");
    await page.click("#dk-undo");
    await settle(page);
    check((await page.textContent("#deck-count")).startsWith("4 to go") && await filesUp(page) === 0, "Undo brings both back in one step");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 7. Card detail and edit (4.13), Fill it in yourself, and the read-only document view.
  {
    // The reading queue retries a rate limit twice by itself, so three failures reach the card; the
    // waits are shortened for the test.
    const { ctx, page, problems } = await open("&hold=1&readfail=3&seed");
    await page.evaluate(async () => (await import("/public/js/classify.js")).setBackoff([50, 50]));
    // one at a time, so the fake's first (failing) read is this one
    await page.setInputFiles("#file", [pdf("a.pdf", "Duke A")]);
    await page.waitForSelector(`${TOP} [data-act=fill]`, { timeout: 15000 });
    await page.setInputFiles("#file", [pdf("b.pdf", "Duke B")]);
    check((await page.textContent(`${TOP} .dk-meta`)) === "Claude didn't answer. Your scan is saved." && await page.isDisabled("#dk-file"), "the failed card's copy, File off");
    await page.click(`${TOP} [data-act=fill]`);
    await page.waitForFunction(() => decodeURIComponent(location.hash).startsWith("#/sort/card:"));
    await page.waitForSelector(".cd-bar");
    check(await page.isHidden("#outbox-accessory") && await page.isVisible(".cd-bar"), "the detail hides the accessory for its Shred and File bar");
    await page.fill("[data-k=title]", "Electric bill, March");
    await page.fill("[data-k=issuer]", "Duke Energy");
    await page.click("[data-done]");
    await page.waitForFunction(() => location.hash === "#/sort");
    await page.waitForFunction(() => document.getElementById("deck-count").textContent.startsWith("2 to go"), null, { timeout: 15000 });
    check((await topTitle(page)) === "Electric bill, March" && (await page.textContent(`${TOP} .dk-meta`)).startsWith("Duke Energy · ") && await page.isEnabled("#dk-file"),
      "Fill it in yourself puts the card on the deck, ready to file");
    await page.keyboard.press("ArrowUp");            // skip it; the read Duke card comes up
    await page.waitForSelector('#dk-prompts .cbtn:has-text("1 skipped")');
    await settle(page);
    // open that card's detail with a tap and change the folder
    await page.click(`${TOP} .dk-title`);
    await page.waitForFunction(() => decodeURIComponent(location.hash).startsWith("#/sort/card:"));
    await page.waitForSelector(".cd-page img", { timeout: 10000 });
    check((await page.textContent("#screen .nav-compact")) === "Duke Energy bill, March 2024", "a tap on the card pushes its detail");
    check(await page.isVisible(".cd-verdict .verdict-badge.large") && /^Why: /.test(await page.textContent(".cd-why")), "the detail shows the large VerdictBadge and Why");
    check(await page.isHidden(".cd-remember"), "Remember for this sender hides until filing changes");
    await page.click("[data-pick-folder]");
    await page.click('.sheet [data-folder="03 Money & Banking"]');
    await page.waitForSelector('.sheet [data-folder]', { state: "detached" });
    check((await page.textContent(".cd-folder-value")) === "Money & Banking › 2024" && await page.isVisible(".cd-remember"), "the folder picker sets Money & Banking › 2024; Remember shows");
    await page.click("[data-done]");
    await page.waitForFunction(() => location.hash === "#/sort");
    check((await page.textContent(`${TOP} .dk-folder`)) === "Money & Banking › 2024", "Done saves it to the card");
    check(await fake(page, () => window.__PT_FAKE__.db.get("senders/duke-energy")?.folder) === "03 Money & Banking", "with Remember on, the rule is saved");
    // File from the detail's bar runs like the action row
    await page.click(`${TOP} .dk-title`);
    await page.waitForFunction(() => decodeURIComponent(location.hash).startsWith("#/sort/card:"));
    await page.click(".cd-bar [data-side=file]");
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 15000 });
    check(true, "File in the detail's bar files the card");
    // the read-only document view, as Piles and Search push it
    await page.evaluate(() => { location.hash = "#/piles/doc:w2-2023"; });
    await page.waitForFunction(() => document.querySelector("#screen .b-doc-why"));
    check(/2023 W-2/.test(await page.textContent("#screen .navbar")) && await page.isVisible('#screen a.nav-text-btn:has-text("Open in Drive")'), "the document view shows the filed W-2 with Open in Drive");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 8. Dark mode (A9) and desktop: a clean console, no overflow, the dark tokens on the card.
  for (const [w, h, scheme] of [[390, 844, "dark"], [1280, 900, "dark"], [1280, 900, "light"]]) {
    const { ctx, page, problems } = await open("&hold=1", { width: w, height: h, scheme });
    await page.setInputFiles("#file", [pdf("w2.pdf", "W-2"), pdf("a.pdf", "Duke A")]);
    await waitCards(page, 2);
    const s = await page.evaluate(() => { const c = document.querySelector(".dk-card:not(.dk-ghost)"); const r = c.getBoundingClientRect(); const a = document.getElementById("dk-actions").getBoundingClientRect(); const d = document.getElementById("dock").getBoundingClientRect();
      return { bg: getComputedStyle(c).backgroundColor, body: getComputedStyle(document.querySelector(".app-col")).backgroundColor, w: r.width, gap: a.top - r.bottom, clear: a.bottom <= d.top }; });
    if (scheme === "dark") check(s.bg === "rgb(28, 28, 30)" && s.body === "rgb(0, 0, 0)", `${w}px dark: the card is #1C1C1E on black (A9)`);
    check(s.clear && s.gap >= 50, `${w}px ${scheme}: the action row sits under the peeks and above the dock`);
    check(await noSideScroll(page), `${w}px ${scheme}: no sideways scroll`);
    check(problems.length === 0, `${w}px ${scheme}: no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.log("FAIL the test stopped:", e.message.split("\n")[0]);
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall sort checks passed");
process.exit(failures ? 1 : 0);
