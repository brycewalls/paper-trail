// Outbox test (#17, #1, #18, #2): the local-first queue in IndexedDB against the fake backend, in
// headless Chromium. Items go straight into the pipeline through the fake-only hooks
// (window.__PT__.db and .outbox), the way the deck will write them:
//   - the undo hold: a queued item waits 10 s (or release) before it uploads, and isn't counted meanwhile
//   - chunked resumable uploads with progress, resuming from Drive's offset after a dropped connection
//   - a decision survives a reload, and an upload interrupted by one finishes
//   - year folders for 02 Taxes, 03 Money & Banking and 05 Medical only
//   - the record (source "web", contentHash, md5, searchTerms), then verifiedAt once md5 matches; a
//     mismatch uploads once more; a pending checksum is asked again
//   - retries back off, then Needs attention and Retry; offline and Reconnect Drive pause without a retry
//   - Send back to the deck, during and after an upload
//   - the accessory states, the Outbox screen and Earlier, and Settings, Shred hold
// Runs locally while Actions is out of minutes:
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/outbox_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
const base = `http://127.0.0.1:${server.address().port}/public/index.html?fake=1&fastretry`;

// A PDF with `pages` pages, padded with a comment to about `pad` bytes so uploads take several chunks.
function makePdf(pages, label, pad = 0) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const text = `BT /F1 28 Tf 72 700 Td (${label} page ${i + 1}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n" + (pad ? "%" + "x".repeat(pad) + "\n" : "");
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const md5 = (b) => createHash("md5").update(b).digest("hex");

const CARD = {
  bill: { title: "Electric bill, September", docType: "Utility bill", issuer: "Cascade Power & Light", docDate: "2026-09-18", summary: "Electric bill for $84.12.",
    folder: "06 Home", filename: "2026-09-18_electric-bill", verdict: "scan_shred", verdictReason: "Keep a copy for a year.", retention: "Keep 1 year", sensitive: false,
    paperless: { possible: true, issuer: "Cascade Power & Light", how: "Account settings, then Billing, then Paper bill off." }, amount: "84.12" },
  w2: { title: "2025 W-2", docType: "W-2", issuer: "Northwind Logistics", docDate: "2026-01-30", summary: "Wage and tax statement.", folder: "02 Taxes",
    filename: "2026-01-30_W-2_Northwind", verdict: "scan_shred", verdictReason: "Tax backup.", retention: "Keep 7 years", sensitive: true, paperless: { possible: false, issuer: "", how: "" } },
  insurance: { title: "Auto policy", docType: "Policy", issuer: "Evergreen Mutual", docDate: "2025-04-02", summary: "Declarations page.", folder: "04 Insurance",
    filename: "2025-04-02_auto-policy", verdict: "keep_original", verdictReason: "Keep the paper.", retention: "While active", sensitive: false, paperless: { possible: false, issuer: "", how: "" } },
};

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(query = "", viewport = { width: 1280, height: 900 }, ctx = null) {
  ctx = ctx || await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__PT__?.db);
  return { ctx, page, problems };
}
// Put a decided item straight into the pipeline, as the deck does at a swipe. ago: ms since the swipe.
async function addItem(page, { card, decision = "file", bytes = makePdf(1, "Doc"), ago = 11000, pages = 1, release = false, filedAt, stage = "queued", extra = {} }) {
  return page.evaluate(async ({ card, decision, bytes, ago, pages, release, filedAt, stage, extra }) => {
    const { db, outbox } = window.__PT__;
    const id = crypto.randomUUID();
    const at = new Date(Date.now() - ago).toISOString();
    if (decision === "file" && bytes) await db.putBlob(`items/${id}.pdf`, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
    await db.putItem({ id, uid: "fake-owner", createdAt: at, stage, decision, decidedAt: at, card, unsureFields: [], pages, sizeBytes: 0, bytesSent: 0,
      ...(filedAt ? { filedAt } : {}), ...extra });
    if (release) await outbox.release(id);
    return id;
  }, { card, decision, bytes: bytes ? [...bytes] : null, ago, pages, release, filedAt, stage, extra });
}
const item = (page, id) => page.evaluate((id) => window.__PT__.db.getItem(id), id);
// Polls an async check in the page (waitForFunction doesn't await a promise). Resolves true or false.
async function until(page, fn, arg, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await page.evaluate(fn, arg)) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}
const must = async (p, what) => { if (!(await p)) throw new Error(`timed out: ${what}`); };
const waitStage = (page, id, stage, timeout = 20000) => until(page, async ([id, stage]) => (await window.__PT__.db.getItem(id))?.stage === stage, [id, stage], timeout);
const fakeState = (page, fn, arg) => page.evaluate(fn, arg);
const accessory = (page) => page.textContent("#outbox-accessory");
const doc = (page, id) => fakeState(page, (id) => window.__PT_FAKE__.db.get(`docs/${id}`) || null, id);

try {
  // 1. The undo hold, then upload, record and verification; the record's fields.
  {
    const { ctx, page, problems } = await open();
    const bytes = makePdf(2, "Cascade");
    const id = await addItem(page, { card: CARD.bill, bytes, ago: 0, pages: 2 });
    await page.waitForTimeout(1500);
    check((await item(page, id)).stage === "queued" && await fakeState(page, () => window.__PT_FAKE__.files.length) === 0, "a fresh swipe waits out the undo hold");
    check((await accessory(page)).includes("Outbox is empty"), "a held decision doesn't count in the accessory yet");
    check(await waitStage(page, id, "verified", 20000), "after 10 seconds it uploads and verifies on its own");
    const rec = await doc(page, id);
    const it = await item(page, id);
    check(rec && rec.filed === true && rec.source === "web" && rec.driveId === it.driveId && /drive\.google\.com/.test(rec.driveUrl), "the record lands under the item's id with source web and the Drive link");
    check(rec.contentHash === sha(bytes) && rec.md5 === md5(bytes) && rec.sizeBytes === bytes.length, "contentHash is the SHA-256 and md5 the MD5 of the filed bytes (#2, #18)");
    check(rec.verifiedAt && rec.verifiedPages === 2, "verifiedAt and verifiedPages are set once Drive's checksum matches");
    check(rec.physical === "to_shred" && rec.pages === 2 && rec.amount === "84.12", "pile, pages and amount are on the record");
    check(["electric", "bill", "september", "cascade", "power", "light", "utility", "home", "2026", "84.12"].every((w) => rec.searchTerms.includes(w)), "searchTerms has the title, issuer, type, folder, year and amount");
    const file = await fakeState(page, () => { const f = window.__PT_FAKE__.files[0]; return { bytes: [...f.bytes], name: f.name, parent: f.parents[0] }; });
    check(sha(Buffer.from(file.bytes)) === sha(bytes) && file.name === "2026-09-18_electric-bill.pdf", "Drive has the original bytes under Claude's filename");
    const sender = await fakeState(page, () => window.__PT_FAKE__.db.get("paperless/cascade-power-light"));
    check(sender?.status === "todo" && sender.lastSeen, "a paperless-capable sender is added the first time");
    check(await page.waitForFunction(() => document.querySelector("#outbox-accessory").textContent.includes("All caught up · 1 filed today"), null, { timeout: 5000 }).then(() => true, () => false), "the accessory says All caught up · 1 filed today");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 2. Release ends the hold early; year folders; a shred decision; Keep original's pile.
  {
    const { ctx, page, problems } = await open();
    const w2 = await addItem(page, { card: CARD.w2, ago: 0, release: true });
    check(await waitStage(page, w2, "verified", 8000), "release() starts the upload without waiting out the hold");
    const folders = await fakeState(page, () => window.__PT_FAKE__.folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent })));
    const taxes = folders.find((f) => f.name === "02 Taxes");
    const year = folders.find((f) => f.name === "2026" && f.parent === taxes?.id);
    const parent = await fakeState(page, () => window.__PT_FAKE__.files[0].parents[0]);
    check(!!year && parent === year.id, "a W-2 dated 2026 files to 02 Taxes/2026");
    const cfg = await fakeState(page, () => window.__PT_FAKE__.db.get("config/drive"));
    check(cfg?.folders?.["02 Taxes/2026"] === year?.id, "the year folder is cached in config/drive as \"02 Taxes/2026\"");
    const ins = await addItem(page, { card: CARD.insurance, release: true });
    check(await waitStage(page, ins, "verified"), "a 04 Insurance doc uploads");
    const insParent = await fakeState(page, () => window.__PT_FAKE__.files[1].parents[0]);
    check(folders.find((f) => f.name === "04 Insurance")?.id === insParent, "folders outside the three stay flat");
    check((await doc(page, ins)).physical === "keep", "a filed Keep original goes on the keep pile");
    const shred = await addItem(page, { card: CARD.bill, decision: "shredOnly", bytes: null, release: true });
    check(await waitStage(page, shred, "filed"), "a shred decision is logged");
    const srec = await doc(page, shred);
    check(srec.filed === false && srec.driveId === "" && srec.source === "web" && await fakeState(page, () => window.__PT_FAKE__.files.length) === 2, "a shred is logged without a Drive copy");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 3. Chunks and progress; a dropped connection resumes from Drive's offset.
  {
    const { ctx, page, problems } = await open("&chunk=262144&slowupload", { width: 390, height: 844 });
    const bytes = makePdf(3, "Statement", 900000);
    const id = await addItem(page, { card: CARD.bill, bytes, pages: 3, release: true });
    await page.waitForFunction(() => /Uploading 1 of 1/.test(document.querySelector("#outbox-accessory").textContent), null, { timeout: 8000 });
    check(true, "the accessory shows Uploading 1 of 1");
    await page.click("#outbox-accessory");
    await page.waitForSelector("#screen .ob-progress", { timeout: 8000 });
    await page.waitForFunction(() => Number(document.querySelector("#screen .ob-pct")?.textContent.replace("%", "")) > 0, null, { timeout: 10000 });
    check(true, "the Outbox row shows a progress bar and a percentage");
    // Drop the connection after the first chunk lands
    await must(until(page, async (id) => (await window.__PT__.db.getItem(id)).bytesSent > 0, id, 10000), "the first chunk");
    await fakeState(page, () => { window.__PT_FAKE__.offline = true; });
    await page.waitForFunction(() => /Waiting for a connection · 1 saved on your phone/.test(document.querySelector("#outbox-accessory").textContent)
      || /Waiting for a connection/.test(document.querySelector("#screen").textContent), null, { timeout: 15000 });
    check(true, "a dropped connection shows Waiting for a connection");
    const sent = (await item(page, id)).bytesSent;
    check((await item(page, id)).stage === "uploading" && !(await item(page, id)).attempts, "going offline doesn't use up a retry");
    await fakeState(page, () => { window.__PT_FAKE__.offline = false; dispatchEvent(new Event("online")); });
    check(await waitStage(page, id, "verified", 30000), "back online, it finishes and verifies");
    const chunks = await fakeState(page, () => window.__PT_FAKE__.chunks);
    const puts = chunks.filter((c) => !c.status);
    const asked = chunks.findIndex((c) => c.status);
    check(puts.length >= 4, `the upload went in ${puts.length} chunks`);
    check(asked > 0 && chunks[asked + 1] && chunks[asked + 1].from > 0 && chunks[asked + 1].from >= sent && puts.filter((c) => c.from === 0).length === 1,
      "after the drop it asked Drive where it stood and resumed from that offset");
    const files = await fakeState(page, () => window.__PT_FAKE__.files.map((f) => [...f.bytes]));
    check(files.length === 1 && sha(Buffer.from(files[0])) === sha(bytes), "one file in Drive, byte for byte");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 1, "no sideways scroll at 390px");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 4. A decision survives a reload, and an upload interrupted by one finishes.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await open("", undefined, ctx);
    const held = await addItem(a.page, { card: CARD.bill, ago: 0 });
    const stale = await addItem(a.page, { card: CARD.insurance, stage: "uploading", extra: { uploadURL: "https://fake-upload.test/session/gone", bytesSent: 100 } });
    await a.page.close();
    const b = await open("", undefined, ctx);
    check(!!(await item(b.page, held)), "a held decision is still there after a reload");
    check(await waitStage(b.page, stale, "verified", 15000), "an upload cut off by a reload starts a fresh session and finishes");
    check(await waitStage(b.page, held, "verified", 20000), "the held one uploads once its hold is over");
    check(b.problems.length === 0, `no console errors (${b.problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 5. Verification: a checksum mismatch uploads once more; a pending checksum is asked again.
  {
    const { ctx, page, problems } = await open("&md5mismatch");
    const bytes = makePdf(2, "Mismatch");
    const id = await addItem(page, { card: CARD.bill, bytes, pages: 2, release: true });
    check(await waitStage(page, id, "verified", 20000), "after a checksum mismatch it uploads again and verifies");
    const files = await fakeState(page, () => window.__PT_FAKE__.files.map((f) => ({ id: f.id, trashed: !!f.trashed })));
    const it = await item(page, id);
    check(files.length === 2 && files[0].trashed && !files[1].trashed && it.driveId === files[1].id && it.reuploads === 1, "the bad copy is trashed and the fresh one kept");
    check((await doc(page, id)).driveId === files[1].id, "the record points at the fresh copy");
    await ctx.close();
    const p = await open("&md5pending");
    const id2 = await addItem(p.page, { card: CARD.bill, release: true });
    check(await until(p.page, async (id) => { const i = await window.__PT__.db.getItem(id); return i.stage === "filed" && !!i.nextRetryAt && i.attempts === 1; }, id2, 10000),
      "with no checksum yet it stays filed and is asked again on the backoff schedule");
    check(await waitStage(p.page, id2, "verified", 10000), "then verifies");
    check(problems.length === 0 && p.problems.length === 0, `no console errors (${[...problems, ...p.problems].join(" | ") || "none"})`);
    await p.ctx.close();
  }

  // 6. Retries back off, then Needs attention; Retry in the Outbox files it.
  {
    const { ctx, page, problems } = await open("&uploadfail=5", { width: 390, height: 844 });
    const id = await addItem(page, { card: CARD.bill, release: true });
    await must(waitStage(page, id, "failed", 8000), "the first failure");
    const first = await item(page, id);
    check(first.attempts === 1 && first.nextRetryAt, "the first failure schedules a retry");
    await page.click("#outbox-accessory");
    await page.waitForSelector("#screen [data-retry]");
    check(await page.waitForFunction(() => /Drive didn't answer\. Trying again in 1 min\./.test(document.querySelector("#screen").textContent), null, { timeout: 8000 }).then(() => true, () => false), "the row says Drive didn't answer. Trying again in 1 min.");
    await page.waitForFunction(() => /1 needs a retry/.test(document.querySelector("#screen .nav-subtitle")?.textContent || ""), null, { timeout: 30000 });
    await must(until(page, async (id) => { const i = await window.__PT__.db.getItem(id); return i.stage === "failed" && !i.nextRetryAt; }, id, 30000), "retries used up");
    check((await item(page, id)).attempts === 5, "four automatic retries, then it stops");
    await page.waitForFunction(() => /Drive didn't take this one\. Tap Retry to try again\./.test(document.querySelector("#screen").textContent), null, { timeout: 5000 });
    check(true, "Needs attention says Drive didn't take this one. Tap Retry to try again.");
    check(await page.isVisible("#screen [data-retry-all]"), "Retry all shows in the toolbar");
    await page.click("#screen [data-nav-back]");
    await page.waitForFunction(() => /1 needs a retry/.test(document.querySelector("#outbox-accessory").textContent), null, { timeout: 5000 });
    check(true, "the accessory says 1 needs a retry");
    await page.click("#outbox-accessory");
    await page.click("#screen [data-retry]");
    check(await waitStage(page, id, "verified", 15000), "Retry uploads and verifies it");
    await page.waitForFunction(() => /Filed today/i.test(document.querySelector("#screen").textContent) && /1 of 1 page confirmed in Drive/.test(document.querySelector("#screen").textContent), null, { timeout: 5000 });
    check(true, "it moves to Filed today with 1 of 1 page confirmed in Drive");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 7. Offline and Reconnect Drive pause without spending a retry.
  {
    const { ctx, page } = await open("&offline");
    const id = await addItem(page, { card: CARD.bill, release: true });
    await page.waitForFunction(() => /Waiting for a connection · 1 saved on your phone/.test(document.querySelector("#outbox-accessory").textContent), null, { timeout: 8000 });
    check(true, "offline: Waiting for a connection · 1 saved on your phone");
    check(!(await item(page, id)).attempts, "offline uses no retry");
    await ctx.close();
    const r = await open("&drive401");
    const id2 = await addItem(r.page, { card: CARD.bill, release: true });
    await r.page.waitForFunction(() => /Reconnect Drive to keep filing/.test(document.querySelector("#outbox-accessory").textContent), null, { timeout: 8000 });
    check(true, "Drive refused: Reconnect Drive to keep filing");
    check(!(await item(r.page, id2)).attempts && (await item(r.page, id2)).stage !== "failed", "waiting for Reconnect uses no retry");
    await r.page.click("#outbox-accessory");
    await r.page.waitForSelector("#screen [data-reconnect]");
    check(/Drive needs reconnecting\./.test(await r.page.textContent("#screen")), "the Outbox shows the Reconnect Drive banner");
    await r.page.click("#screen [data-reconnect]");
    check(await waitStage(r.page, id2, "verified", 15000), "Reconnect Drive resumes the upload");
    check(r.problems.length === 0, `no console errors (${r.problems.join(" | ") || "none"})`);
    await r.ctx.close();
  }

  // 8. Send back to the deck, during an upload and after it.
  {
    const { ctx, page, problems } = await open("&chunk=262144&slowupload");
    const id = await addItem(page, { card: CARD.bill, bytes: makePdf(2, "Back", 900000), pages: 2, release: true });
    await must(until(page, async (id) => (await window.__PT__.db.getItem(id)).bytesSent > 0, id, 10000), "the first chunk");
    check(await page.evaluate((id) => window.__PT__.outbox.sendBack(id), id), "sendBack during an upload says yes");
    const back = await item(page, id);
    check(back.stage === "ready" && !back.decision && !back.uploadURL && !(await doc(page, id)), "the card is back on the deck with nothing filed");
    await page.waitForTimeout(800);
    check(await fakeState(page, () => window.__PT_FAKE__.files.length) === 0, "the cut-off upload never becomes a file");
    const done = await addItem(page, { card: CARD.bill, release: true });
    check(await waitStage(page, done, "verified", 20000), "another one files");
    check(await page.evaluate((id) => window.__PT__.outbox.sendBack(id), done), "sendBack after filing says yes");
    const trashed = await fakeState(page, () => window.__PT_FAKE__.files.every((f) => f.trashed));
    check(trashed && !(await doc(page, done)) && (await item(page, done)).stage === "ready", "the Drive copy is trashed and the record deleted");
    const ready = await page.evaluate(async () => (await window.__PT__.db.listItems({ stage: "ready", uid: "fake-owner" })).map((i) => i.id));
    check(ready[0] === done, "the card sent back goes on top of the deck");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 9. Paperless: a sender already asked to stop is flagged as still mailing.
  {
    const { ctx, page } = await open("&seed");
    const id = await addItem(page, { card: CARD.bill, decision: "shredOnly", bytes: null, release: true });
    check(await waitStage(page, id, "filed"), "the bill is logged");
    const s = await fakeState(page, () => window.__PT_FAKE__.db.get("paperless/cascade-power-light"));
    check(s.status === "requested" && s.stillMailingAt && s.lastSeen === s.stillMailingAt && s.stillMailingAt > new Date(Date.now() - 60000).toISOString(), "stillMailingAt and lastSeen are set for a requested sender");
    await ctx.close();
  }

  // 10. The Outbox screen and Earlier; Settings, Shred hold.
  {
    const { ctx, page, problems } = await open("&seed", { width: 390, height: 844 });
    const day = 86400000;
    await addItem(page, { card: CARD.w2, stage: "verified", filedAt: new Date(Date.now() - 2 * day).toISOString(), extra: { verifiedAt: new Date(Date.now() - 2 * day).toISOString(), driveUrl: "https://drive.google.com/file/d/x/view" } });
    await addItem(page, { card: CARD.bill, decision: "shredOnly", bytes: null, stage: "filed", filedAt: new Date(Date.now() - 3 * day).toISOString() });
    const today = await addItem(page, { card: CARD.insurance, release: true });
    check(await waitStage(page, today, "verified"), "one files today");
    await page.click("#outbox-accessory");
    await page.waitForSelector("#screen [data-earlier]");
    const text = await page.textContent("#screen");
    check(/1 filed today/.test(await page.textContent("#screen .nav-subtitle")), "the subtitle says 1 filed today");
    check(/Auto policy · Evergreen Mutual/.test(text) && /1 of 1 page confirmed in Drive · \d{1,2}:\d{2} [AP]M/.test(text), "Filed today: {title} · {issuer}, 1 of 1 page confirmed in Drive · time");
    check(await page.isHidden("#outbox-accessory"), "the accessory hides on the Outbox");
    await page.click("#screen [data-earlier]");
    await page.waitForFunction(() => location.hash.endsWith("/outbox/earlier") && document.querySelector("#screen .nav-title")?.textContent === "Earlier");
    const e = await page.textContent("#screen");
    check(/2025 W-2/.test(e) && /Logged as shredded/.test(e) && (await page.$$("#screen .group-header")).length === 2, "Earlier groups the last 30 days by day");
    await page.click("#screen [data-nav-back]");
    await page.click("#screen [data-nav-back]");
    // Settings, Sorting: Shred hold
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("[data-shred-hold]");
    check(/Shred hold\s*3 days/.test(await page.textContent("[data-shred-hold]")), "Settings shows Shred hold · 3 days");
    await page.click("[data-shred-hold]");
    await page.waitForSelector("[data-hold='7']");
    check(/safe to shred once its Drive copy is confirmed/.test(await page.textContent(".sheet-wrap:last-child")), "the picker explains the hold");
    await page.click("[data-hold='7']");
    await page.waitForFunction(() => window.__PT_FAKE__.db.get("config/settings")?.shredHoldDays === 7);
    check(/7 days/.test(await page.textContent("[data-shred-hold]")) && (await page.getAttribute("[data-hold='7']", "aria-checked")) === "true", "picking 7 days saves config/settings.shredHoldDays and updates the row");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.log("FAIL the test stopped:", e.message.split("\n")[0]);
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall outbox checks passed");
process.exit(failures ? 1 : 0);
