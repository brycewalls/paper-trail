// Lab reader test (#92): the lab build reads with the PDF text layer or on-device OCR and the rules,
// no AI, and compare mode measures the rules against Claude. In the real page against
// tools/fake/fake-backend.js (no ?reader=claude here, so this is the lab path). Covers:
//   - with compare mode off, a document is read with NO classify call at all: text layer, rules,
//     the card on the deck, the read recorded under lab/reader/reads with compare "off"
//   - the rules run in the Web Worker; a photo is OCR'd on the device, with progress on the way
//   - stack mode splits by page markers, no AI
//   - compare mode (on by default): the same request the live app sends, in the background; the
//     card's chip says "Claude agrees" when Claude's answer matches, "Claude differs" when not
//   - the compare sheet: fields side by side, pick Rules or Claude; picks are saved as ground truth,
//     the card takes the picked values, and a sender, folder or filename pick becomes a sender rule
//   - Claude failing to answer: "Claude didn't answer", the read still files
//   - Settings, Lab: the Compare with Claude switch (saved to lab/settings) and Lab Stats: agreement
//     per field, the picks, the Needs a look rate, matching computeStats over the saved reads
//   - the scoring rules (fieldAgrees), and no console errors, at 390 px, light and dark
// Runs in CI and locally:
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/lab_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
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
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/public/index.html?fake=1&hold=1`;
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });

// ---------- test files, made here so the repo carries no binaries (made-up senders, no real data) ----------
function makePdf(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const lines of pages) {
    const text = lines.map((l, k) => `BT /F1 ${k ? 11 : 20} Tf 72 ${720 - k * 18} Td (${l}) Tj ET`).join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
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
const BILL = makePdf([["Cascade Power and Light", "Electric service statement", "Statement date March 12, 2024", "Amount due 84.12 by April 2, 2024", "Account ending 4411. Service address 12 Elm Street.", "Thank you for your payment."]]);
const W2 = makePdf([["Form W-2 Wage and Tax Statement 2025", "Employer: Northwind Logistics", "Box 1 wages, tips, other compensation 61,400.00", "Issued January 30, 2026", "Employee SSN 000-00-0000"]]);
const LEASE = makePdf([["Residential Lease Agreement", "Landlord: Maple Court Apartments", "Signed June 1, 2025", "Term twelve months. Rent 1,450.00 per month.", "Tenant keeps a copy of this lease."]]);

// ---------- harness ----------
const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(query = "", { dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => { if (!r.url().startsWith("data:") && !r.url().startsWith("blob:")) problems.push(`request failed: ${r.url()}`); });
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__PT__ && window.__PT__.lab);
  return { ctx, page, problems };
}
const js = (page, fn, arg) => page.evaluate(fn, arg);
const TOP = ".dk-card:not(.dk-ghost)";
const fakeDb = (page, prefix) => js(page, (p) => [...window.__PT_FAKE__.db.entries()].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ key: k, ...v })), prefix);
const classifyCalls = (page) => js(page, () => window.__PT_FAKE__.classifyCalls.length);
async function menuPick(page, label) {
  await page.click("#btn-scan-menu");
  await page.waitForSelector(".menu");
  await page.click(`.menu .menu-item:has-text("${label}")`);
}
// Import from Files, wait for the review to read every group, then Send.
async function importAndSend(page, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuPick(page, "Import from Files")]);
  await chooser.setFiles(files);
  await page.waitForSelector("#review:not([hidden])");
  await page.waitForFunction(() => { const r = window.__PT__.review(); return r && r.groups.length && r.groups.every((g) => g.status === "read" || g.status === "failed"); }, null, { timeout: 20000 });
  await page.click("[data-send]");
  await page.waitForSelector(TOP);
}
const waitCompared = (page, n = 1) => page.waitForFunction((n) => window.__PT__.lab.compare.compareStats.answered + window.__PT__.lab.compare.compareStats.failed >= n, n, { timeout: 15000 });

try {
  // 1. Compare off: no AI at all. Text layer, rules in the worker, the card, the record.
  {
    const { ctx, page, problems } = await open();
    await js(page, () => window.__PT__.lab.compare.setCompareEnabled(false));
    check((await fakeDb(page, "lab/settings"))[0]?.compareWithClaude === false, "turning compare off saves lab/settings compareWithClaude: false");
    await importAndSend(page, [{ name: "bill.pdf", mimeType: "application/pdf", buffer: BILL }]);
    const it = await js(page, () => { const i = window.__PT__.items().find((x) => x.card); return { card: i.card, lab: i.lab, stage: i.stage }; });
    check(it.stage === "ready" && it.card && it.lab && it.lab.textSource === "text", `a text PDF is read from its own text layer (${it.lab && it.lab.textSource})`);
    const expected = await js(page, async () => {
      const { runRules } = await import(new URL("js/lab/engine.js", location.href).href);
      const r = window.__PT__.lab.compare.recent.at(-1);
      return runRules(r.textPages, { senderRules: [], pages: 1, textSource: "text" });
    });
    check(it.lab.rules.docType === (expected.docType || "") && it.lab.rules.folder === expected.folder, `the card is the rules engine's answer (${it.lab.rules.docType || "no type"}, ${it.lab.rules.folder})`);
    check(await classifyCalls(page) === 0, "with compare off, nothing is sent to the classify function: no AI anywhere");
    check(await js(page, async () => (await import(new URL("js/lab/reader.js", location.href).href)).rulesWhere()) === "worker", "the rules ran in the Web Worker");
    const recs = await fakeDb(page, "lab/reader/reads/");
    check(recs.length === 1 && recs[0].compare === "off" && recs[0].rules && typeof recs[0].needsLook === "boolean" && recs[0].textSource === "text",
      "the read is recorded under users/{uid}/lab/reader/reads with compare off");
    check(!(await fakeDb(page, "docs/")).length, "nothing is written to the live docs collection by a read");
    check(!(await page.locator(`${TOP} .lab-chip`).count()), "no compare chip while compare mode is off");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 2. Photos are OCR'd on the device with progress; stack mode by page markers; the copy says no AI.
  {
    const { ctx, page, problems } = await open();
    await js(page, () => window.__PT__.lab.compare.setCompareEnabled(false));
    check(/rules, no AI/.test(await page.textContent("#dk-empty .empty-desc, #dk-empty") || ""), "the first-run copy says the lab reads with rules, no AI");
    await js(page, () => {
      window.__progress = [];
      window.__PT_OCR__ = async () => { await new Promise((r) => setTimeout(r, 300)); return "Form W-2 Wage and Tax Statement 2025. Employer Northwind Logistics. Issued 01/30/2026."; };
      const watch = setInterval(() => { const t = document.querySelector("#dk-empty")?.textContent || ""; if (/OCR/.test(t)) { window.__progress.push(t); clearInterval(watch); } }, 20);
    });
    const png = makePng(40, 50, [250, 250, 250]);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__PT__.addPhotos([new File([bytes], "w2.png", { type: "image/png" })], "W-2 photo");
    }, png.toString("base64"));
    await page.waitForSelector(TOP, { timeout: 15000 });
    const it = await js(page, () => { const i = window.__PT__.items().find((x) => x.card); return { lab: i.lab, card: i.card }; });
    check(it.lab.textSource === "ocr" && it.lab.textChars > 40, `a photo is read with on-device OCR (${it.lab.textSource}, ${it.lab.textChars} characters)`);
    check((await js(page, () => window.__progress)).some((t) => /Reading the page with OCR/.test(t)), "the reading state shows OCR progress");
    check(await classifyCalls(page) === 0, "OCR and rules made no classify call");
    const split = await js(page, async () => (await import(new URL("js/lab/reader.js", location.href).href)).localSplit([
      { text: "Statement page 1 of 2" }, { text: "page 2 of 2" }, { text: "Letter" }, { text: "More" }, { text: "Bill page 1" }]));
    check(JSON.stringify(split.map((d) => [d.start, d.end])) === "[[0,1],[2,3],[4,4]]", `stack mode splits at Page 1 and after the last page, no AI (${JSON.stringify(split.map((d) => [d.start, d.end]))})`);
    const proposed = await js(page, async () => (await import(new URL("js/classify.js", location.href).href)).proposeSplit([{ text: "A page 1" }, { text: "B page 1" }]));
    check(proposed.length === 2 && await classifyCalls(page) === 0, "proposeSplit uses the page markers, not the classify function");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 3. Compare mode on (the default): agrees, differs, the sheet, picks, sender rule, Lab Stats.
  {
    const { ctx, page, problems } = await open();
    check(await js(page, () => window.__PT__.lab.compare.compareEnabled()), "compare mode is on by default");
    // Claude agrees with the first document: answer with the rules' own card.
    await js(page, () => { window.__PT_FAKE__.answer = () => { const it = window.__PT__.lab.compare.recent.at(-1); return it && structuredClone(it.lab.rules); }; });
    await importAndSend(page, [{ name: "w2.pdf", mimeType: "application/pdf", buffer: W2 }]);
    await waitCompared(page, 1);
    await page.waitForSelector(`${TOP} .lab-chip[data-lab-state="agrees"]`, { timeout: 5000 });
    check((await page.textContent(`${TOP} .lab-chip`)).trim() === "Claude agrees", "the card's chip says Claude agrees when Claude's answer matches");
    const payload = await js(page, () => { const c = window.__PT_FAKE__.classifyCalls[0]; return { want: !!c.wantConfidence, kind: c.kind, ocrPrimary: !!c.ocrPrimary, ocr: (c.ocrText || "").length }; });
    check(payload.want && payload.ocrPrimary && payload.ocr > 0, "compare sends the same request the live app sends (text plus one picture, wantConfidence)");
    let recs = await fakeDb(page, "lab/reader/reads/");
    check(recs.length === 1 && recs[0].compare === "done" && recs[0].agrees === true && recs[0].claude && Object.values(recs[0].agree).every(Boolean), "the read records Claude's card and agreement on every field");
    // The agreeing sheet opens too, with nothing to pick.
    await page.click(`${TOP} .lab-chip`);
    await page.waitForSelector(".lab-compare-sheet");
    check(!(await page.locator(".lab-compare-sheet [data-pick]").count()) && /fields agree/.test(await page.textContent(".lab-compare-sheet .sheet-subtitle")), "an agreeing card's sheet shows every field the same, nothing to pick");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".lab-compare-sheet", { state: "detached" });
    // Skip it, then a second document where Claude differs on sender, folder and verdict.
    await page.click("#dk-skip");
    await page.waitForSelector(TOP, { state: "detached" });
    await js(page, () => {
      window.__PT_FAKE__.answer = () => {
        const it = window.__PT__.lab.compare.recent.at(-1);
        const r = structuredClone(it.lab.rules);
        return { ...r, issuer: "Maple Court Property Group", folder: "01 Identity & Legal", verdict: "keep_original", filename: `${r.docDate || "0000-00-00"}_maple-court-lease`, retention: "Permanently" };
      };
    });
    await importAndSend(page, [{ name: "lease.pdf", mimeType: "application/pdf", buffer: LEASE }]);
    await waitCompared(page, 2);
    await page.waitForSelector(`${TOP} .lab-chip[data-lab-state="differs"]`, { timeout: 5000 });
    check((await page.textContent(`${TOP} .lab-chip`)).trim() === "Claude differs", "the card's chip says Claude differs when it doesn't");
    await page.click(`${TOP} .lab-chip`);
    await page.waitForSelector(".lab-compare-sheet");
    const differs = await page.$$eval(".lab-compare-sheet .lab-field.differs", (els) => els.map((e) => e.dataset.field));
    check(["issuer", "folder", "verdict", "filename"].every((f) => differs.includes(f)), `the sheet lists the differing fields side by side (${differs.join(", ")})`);
    check(await page.isDisabled("[data-lab-save]"), "Save picks waits for a pick");
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "lab-compare-sheet-phone.png") });
    await page.click('.lab-compare-sheet [data-pick="issuer"] [data-seg="claude"]');
    await page.click('.lab-compare-sheet [data-pick="folder"] [data-seg="claude"]');
    await page.click('.lab-compare-sheet [data-pick="verdict"] [data-seg="rules"]');
    check(await page.locator('.lab-compare-sheet [data-field="folder"] .lab-side.picked').count() === 1, "the picked side is marked");
    await page.click("[data-lab-save]");
    await page.waitForSelector(".lab-compare-sheet", { state: "detached" });
    const card = await js(page, () => window.__PT__.items().find((i) => i.lab && i.lab.picks).card);
    check(card.issuer === "Maple Court Property Group" && card.folder === "01 Identity & Legal", "the card takes the picked values (Claude's sender and folder)");
    recs = await fakeDb(page, "lab/reader/reads/");
    const lease = recs.find((r) => r.picks);
    check(lease && lease.picks.issuer === "claude" && lease.picks.folder === "claude" && lease.picks.verdict === "rules" && lease.truth.folder === "01 Identity & Legal" && lease.pickedAt,
      "the picks are saved on the read as ground truth");
    const rule = (await fakeDb(page, "senders/maple-court-property-group"))[0];
    check(rule && rule.issuer === "Maple Court Property Group" && rule.folder === "01 Identity & Legal" && !!rule.filenamePattern, "a sender or folder pick is saved as a sender rule");
    check(/Picked/.test(await page.textContent(`${TOP} .lab-chip`)), "the chip notes the pick");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shots, "lab-card-chip-phone.png") });

    // A third document whose compare fails: the chip says so, the card still works.
    await js(page, async () => {
      (await import(new URL("js/classify.js", location.href).href)).setBackoff([50, 50]);
      window.__PT_FAKE__.answer = null; window.__PT_FAKE__.readfail = 3;
    });
    await page.click("#dk-skip");
    await page.waitForSelector(TOP, { state: "detached" });
    await importAndSend(page, [{ name: "bill.pdf", mimeType: "application/pdf", buffer: BILL }]);
    await waitCompared(page, 3);
    await page.waitForSelector(`${TOP} .lab-chip[data-lab-state="failed"]`, { timeout: 5000 });
    check((await page.textContent(`${TOP} .lab-chip`)).trim() === "Claude didn't answer" && await page.isEnabled("#dk-skip"), "a compare that fails says Claude didn't answer; the card still works");

    // Settings, Lab and Lab Stats.
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("#settings-panel [data-settings-section='lab']");
    check(await page.isChecked("#lab-compare"), "Settings, Lab shows Compare with Claude on");
    await page.click("[data-open-lab-stats]");
    await page.waitForSelector(".lab-stats [data-stat='reads']");
    const stats = await js(page, async () => {
      const { computeStats } = await import(new URL("js/lab/stats.js", location.href).href);
      const reads = [...window.__PT_FAKE__.db.entries()].filter(([k]) => k.startsWith("lab/reader/reads/")).map(([, v]) => v);
      return computeStats(reads);
    });
    check(stats.reads === 3 && stats.compared === 2 && stats.failed === 1, `the stats count 3 reads, 2 compared, 1 without an answer (${stats.reads}, ${stats.compared}, ${stats.failed})`);
    const folderRow = await page.textContent(".lab-stats [data-stat-field='folder']");
    const folderStat = stats.fields.find((f) => f.field === "folder");
    check(folderStat.agreed === 1 && folderStat.of === 2 && folderRow.includes("50%") && folderRow.includes("1 of 2"), `agreement per field: folder 1 of 2, 50% (${folderRow.replace(/\s+/g, " ").trim()})`);
    check(stats.picks.rules === 1 && stats.picks.claude === 2 && (await page.textContent(".lab-stats [data-stat='picks-claude']")).includes("67%"), "sided with Claude 2 of 3 picks, 67%");
    const needs = await page.textContent(".lab-stats [data-stat='needs-look']");
    check(needs.includes(`${stats.needsLookPct}%`) && needs.includes(`${stats.needsLook} of 3`), `the Needs a look rate (${stats.needsLookPct}%)`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "lab-stats-phone.png") });
    await page.click("[data-lab-back]");
    await page.waitForSelector(".lab-stats", { state: "detached" });
    await page.click("label[for='lab-compare']");
    await page.waitForFunction(() => !window.__PT__.lab.compare.compareEnabled());
    check((await fakeDb(page, "lab/settings"))[0]?.compareWithClaude === false, "the switch turns compare mode off and saves it");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 4. The scoring rules.
  {
    const { ctx, page, problems } = await open("", { dark: true });
    const r = await js(page, () => {
      const { fieldAgrees: a } = window.__PT__.lab.compare;
      return {
        issuer: a("issuer", { issuer: "Duke Energy" }, { issuer: "Duke Energy Progress" }),
        issuerNo: a("issuer", { issuer: "Duke Energy" }, { issuer: "Cascade Power" }),
        retention: a("retention", { retention: "Keep 7 years" }, { retention: "7 years (tax backup)" }),
        retentionNo: a("retention", { retention: "Keep 7 years" }, { retention: "Not needed" }),
        forever: a("retention", { retention: "Permanently" }, { retention: "Keep forever" }),
        filename: a("filename", { filename: "2024-03-12_duke-energy" }, { filename: "2024-03-12_duke-energy-electric-bill" }),
        filenameNo: a("filename", { filename: "2024-03-12_duke-energy" }, { filename: "2024-04-12_duke-energy" }),
        date: a("docDate", { docDate: "2024-03-12" }, { docDate: "2024-03-12" }),
        paperless: a("paperless", { paperless: { possible: true } }, { paperless: { possible: false } }),
        type: a("docType", { docType: "W-2" }, { docType: "W2" }),
      };
    });
    check(r.issuer && !r.issuerNo, "a sender agrees when one name holds the other");
    check(r.retention && !r.retentionNo && r.forever, "Keep for agrees by meaning (7 years, forever), not wording");
    check(r.filename && !r.filenameNo, "a filename agrees on the same date and mostly the same words");
    check(r.date && !r.paperless && r.type, "dates exact, paperless by whether it's possible, W-2 and W2 the same type");
    await page.click("#view-sort [data-avatar]");
    await page.click("[data-open-lab-stats]");
    await page.waitForFunction(() => /No lab reads yet/.test(document.querySelector(".lab-stats")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
    check(/No lab reads yet/.test(await page.textContent(".lab-stats")), "Lab Stats with no reads says so");
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "lab-stats-empty-dark.png") });
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }
} catch (e) {
  console.log("FAIL the test threw:", e);
  failures++;
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} lab check(s) failed` : "\nall lab checks passed");
process.exit(failures ? 1 : 0);
