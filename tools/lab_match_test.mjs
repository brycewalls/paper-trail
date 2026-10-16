// Lab matcher test (#102): the on-device matcher in the real page against tools/fake/fake-backend.js
// (?lab). On the fake backend the worker embeds with a hashed-words stand-in, so this runs in CI
// without the 23 MB model; pass --model to use the real model files (bash tools/lab/fetch-models.sh
// first). Covers:
//   - the matcher runs after the rules, in its own Web Worker, with no classify call
//   - a garbled sender ("Mr. Coopcr") is autocorrected to the known sender, and the read records
//     decidedBy { docType, issuer } with the matcher's timing
//   - filing a card saves an example (vector and labels, no text) under examples/{readId}, and the
//     worker learns it: the next document from that sender, garbled, snaps to the filed name
//   - your sender rules win: a garbled name that snaps to one of them applies the rule
//   - the compare sheet marks each on-device field Rules, Matcher or Your sender rule
//   - Settings, Lab: the On-device matcher switch, saved to config/lab, and off means no matcher
//   - the matcher's own work adds no long task (PerformanceObserver), at 390 px with 4x CPU
//     throttling (Emulation.setCPUThrottlingRate), and no console errors
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/lab_match_test.mjs [--model]
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL = process.argv.includes("--model");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/public/index.html?fake=1&lab=1&hold=1${REAL ? "&matcher=model" : ""}`;
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });

// Made-up documents (no real data), as text-layer PDFs.
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
const COOPER = makePdf([["Mr. Coopcr", "P.O. Box 619098 Dallas TX 75261", "Mortgage Statement", "Statement date 09/15/2026", "Loan number ending 7781", "Amount due 1,912.40 by 10/01/2026"]]);
const W2_A = makePdf([["Form W-2 Wage and Tax Statement 2025", "Employer's name, address, and ZIP code", "Tidewater Design Studio LLC", "71 Canal St Norfolk VA 23510", "1 Wages, tips, other compensation 52,118.40", "Copy B To Be Filed With Employee's FEDERAL Tax Return"]]);
const W2_B = makePdf([["Form W-2 Wage and Tax Statement 2026", "Employer's name, address, and ZIP code", "Tidewatcr Deslgn Studlo LLC", "71 Canal St Norfolk VA 23510", "1 Wages, tips, other compensation 54,020.10", "Copy B To Be Filed With Employee's FEDERAL Tax Return"]]);
const LEASE = makePdf([["Maple Covrt Apartrnents", "12 Elm Street, Tacoma WA 98402", "Residential Lease Agreement", "Landlord: Maple Covrt Apartrnents", "Signed June 1, 2025", "Term twelve months. Rent 1,450.00 per month."]]);

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(query = "") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => { if (!r.url().startsWith("data:") && !r.url().startsWith("blob:")) problems.push(`request failed: ${r.url()}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    window.__longTasks = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch { /* no longtask support */ }
  });
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__PT__ && window.__PT__.lab);
  return { ctx, page, problems };
}
const js = (page, fn, arg) => page.evaluate(fn, arg);
const TOP = ".dk-card:not(.dk-ghost)";
const fakeDb = (page, prefix) => js(page, (p) => [...window.__PT_FAKE__.db.entries()].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ key: k, ...v })), prefix);
async function importAndSend(page, files) {
  await page.click("#btn-scan-menu");
  await page.waitForSelector(".menu");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('.menu .menu-item:has-text("Import from Files")')]);
  await chooser.setFiles(files);
  await page.waitForSelector("#review:not([hidden])");
  await page.waitForFunction(() => { const r = window.__PT__.review(); return r && r.groups.length && r.groups.every((g) => g.status === "read" || g.status === "failed"); }, null, { timeout: 30000 });
  await page.click("[data-send]");
  await page.waitForSelector(TOP);
}
const topItem = (page) => js(page, () => { const list = window.__PT__.items().filter((x) => x.card && x.stage === "ready" && !x.decision); const i = list[list.length - 1] || list[0]; return i && { id: i.id, card: i.card, lab: i.lab }; });
const lastRead = (page) => js(page, () => { const i = window.__PT__.lab.compare.recent.at(-1); return i && { id: i.id, card: i.card, lab: i.lab }; });
// Files the item on top of the deck the way a swipe does; a card the deck wants checked first gets
// the decision the check sheet would send.
async function fileTop(page, id) {
  return js(page, async (id) => {
    const deck = await import(new URL("js/deck.js", location.href).href);
    const it = deck.getItem(id);
    const r = deck.file(it);
    if (r !== "decided") (await import(new URL("js/ui.js", location.href).href)).emit("deck:decided", { id, decision: "file" });
    return r;
  }, id);
}

try {
  // 1. Autocorrect, the record, filing teaches the matcher, the next garbled one snaps.
  {
    const { ctx, page, problems } = await open();
    await js(page, () => window.__PT__.lab.compare.setCompareEnabled(false));
    await importAndSend(page, [{ name: "cooper.pdf", mimeType: "application/pdf", buffer: COOPER }]);
    let it = await lastRead(page);
    check(it.lab.rules.issuer === "Mr. Cooper" && it.lab.match && it.lab.match.decidedBy.issuer === "matcher", `"Mr. Coopcr" is autocorrected to the known sender (${it.lab.rules.issuer}, decided by ${it.lab.match && it.lab.match.decidedBy.issuer})`);
    check(it.lab.match.vector && it.lab.match.vector.v && typeof it.lab.match.ms.total === "number", `the matcher ran in its worker (${it.lab.match.ms.total} ms, model ${it.lab.match.model})`);
    check(!(await js(page, () => window.__PT_FAKE__.classifyCalls.length)), "no classify call: no AI service anywhere");
    const rec = (await fakeDb(page, "reads/"))[0];
    check(rec && rec.decidedBy && rec.decidedBy.issuer === "matcher" && rec.decidedBy.docType === "rules" && rec.match && rec.match.ms, "the read records who decided the type and the sender, and the matcher's timing");

    // File a W-2 from a sender no list knows: it becomes an example.
    await page.click("#dk-skip");
    await page.waitForSelector(TOP, { state: "detached" });
    await importAndSend(page, [{ name: "w2-2025.pdf", mimeType: "application/pdf", buffer: W2_A }]);
    it = await lastRead(page);
    check(/Tidewater Design Studio/.test(it.lab.rules.issuer), `the W-2's employer is read (${it.lab.rules.issuer})`);
    const how = await fileTop(page, it.id);
    await page.waitForFunction((id) => [...window.__PT_FAKE__.db.keys()].includes(`examples/${id}`), it.id, { timeout: 5000 });
    const ex = (await fakeDb(page, `examples/${it.id}`))[0];
    check(ex && ex.v && typeof ex.s === "number" && ex.docType === "W-2" && /Tidewater/.test(ex.issuer) && ex.source && ex.model === "Xenova/all-MiniLM-L6-v2", `filing (${how}) saves an example: vector, type and sender`);
    check(!Object.keys(ex).some((k) => /text|pages|summary|title/i.test(k)), "the example carries no document text");
    // Next year's W-2 with the employer garbled: snaps to the filed name.
    await page.waitForTimeout(300);
    await importAndSend(page, [{ name: "w2-2026.pdf", mimeType: "application/pdf", buffer: W2_B }]);
    it = await lastRead(page);
    check(it.lab.rules.issuer === ex.issuer && it.lab.match.decidedBy.issuer === "matcher" && it.lab.match.sender && it.lab.match.sender.from === "filed",
      `"Tidewatcr Deslgn Studlo" snaps to the filed sender (${it.lab.rules.issuer}, from ${it.lab.match.sender && it.lab.match.sender.from})`);
    const nb = it.lab.match.neighbors || [];
    check(nb.length && nb[0].source === "filed" && nb[0].docType === "W-2", `the nearest example is last year's filed W-2 (${nb[0] && nb[0].docType}, ${nb[0] && nb[0].sim})`);
    const status = await js(page, async () => (await import(new URL("js/lab/match/matcher.js", location.href).href)).matcherStatus());
    check(status && status.examples === 1, `the worker holds the one filed example (${status && status.examples})`);
    // Long tasks: none from the matcher's work. Time one matchRead on its own, at 4x throttling.
    const lt = await js(page, async () => {
      const m = await import(new URL("js/lab/match/matcher.js", location.href).href);
      const { runRules } = await import(new URL("js/lab/engine.js", location.href).href);
      const pages = ["Mr. Coopcr\nMortgage Statement\nStatement date 09/15/2026\nAmount due 1,912.40"];
      const meta = { senderRules: [], today: "2026-10-16" };
      const card = await runRules(pages, meta);
      const from = performance.now();
      const r = await m.matchRead(pages, meta, card);
      await new Promise((ok) => setTimeout(ok, 100));
      return { ms: r && r.ms, tasks: window.__longTasks.filter((t) => t.at >= from) };
    });
    check(!lt.tasks.some((t) => t.ms > 100), `the matcher adds no long task over 100 ms on the page at 4x throttling (${JSON.stringify(lt.tasks)}; in the worker ${JSON.stringify(lt.ms)})`);
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 2. Sender rules first; the compare sheet shows who decided; the switch.
  {
    const { ctx, page, problems } = await open();
    await js(page, async () => {
      const s = await import(new URL("js/senders.js", location.href).href);
      await s.saveRule({ key: "maple-court-apartments", issuer: "Maple Court Apartments", folder: "06 Home", verdict: "keep_original" });
    });
    await page.waitForFunction(async () => (await import(new URL("js/senders.js", location.href).href)).ruleList().length === 1);
    await js(page, () => { window.__PT_FAKE__.answer = () => { const it = window.__PT__.lab.compare.recent.at(-1); return it && { ...structuredClone(it.lab.rules), issuer: "Maple Court Property Group" }; }; });
    await importAndSend(page, [{ name: "lease.pdf", mimeType: "application/pdf", buffer: LEASE }]);
    const it = await lastRead(page);
    check(it.lab.rules.issuer === "Maple Court Apartments" && it.lab.rules.appliedRule === "maple-court-apartments" && it.lab.match.decidedBy.issuer === "sender rule",
      `"Maple Covrt Apartrnents" snaps to your sender rule, and the rule applies (${it.lab.rules.issuer}, ${it.lab.rules.folder}, ${it.lab.rules.verdict})`);
    check(it.lab.rules.folder === "06 Home" && it.lab.rules.verdict === "keep_original", "the rule's folder and verdict are on the card");
    await page.waitForFunction(() => window.__PT__.lab.compare.compareStats.answered >= 1, null, { timeout: 15000 });
    await page.waitForSelector(`${TOP} .lab-chip[data-lab-state="differs"]`, { timeout: 5000 });
    await page.click(`${TOP} .lab-chip`);
    await page.waitForSelector(".lab-compare-sheet");
    const tags = await page.$$eval(".lab-compare-sheet .lab-field[data-field]", (els) => Object.fromEntries(els.map((e) => [e.dataset.field, e.querySelector(".lab-src")?.textContent])));
    check(tags.issuer === "Your sender rule" && tags.folder === "Your sender rule" && tags.docType === "Rules" && tags.docDate === "Rules", `the compare sheet says who decided each field (${JSON.stringify(tags)})`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(shots, "lab-match-compare-phone.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".lab-compare-sheet", { state: "detached" });
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("#settings-panel [data-settings-section='lab']");
    check(await page.isChecked("#lab-matcher"), "Settings, Lab shows the On-device matcher on");
    await page.click("label[for='lab-matcher']");
    await page.waitForFunction(() => window.__PT_FAKE__.db.get("config/lab")?.matcher === false);
    check(!(await js(page, async () => (await import(new URL("js/lab/match/matcher.js", location.href).href)).matcherOn())), "turning it off saves config/lab matcher: false and stops the matcher");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shots, "lab-match-settings-phone.png") });
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }
} catch (e) {
  console.log("FAIL the test threw:", e);
  failures++;
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} lab matcher check(s) failed` : "\nall lab matcher checks passed");
process.exit(failures ? 1 : 0);
