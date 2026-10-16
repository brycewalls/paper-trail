// Browse test (#83; #18, #22, #23): Piles, Search and Paperless against the fake backend's filed
// library (?fake=1&seed), in headless Chromium at 390 px, plus a pass in dark mode and at desktop
// width. Checks the live Firestore listeners drive every screen and that each write lands in the
// same fields the iPhone app writes. Runs in CI and locally:  node tools/browse_test.mjs
//   Piles: the plain segment counts (#58), the safe-to-shred rule and the 3-day hold, the banner,
//     a swipe and its keyboard twin, Mark n as shredded with its confirm (Waiting rows never
//     included), Put away, All filed by month with the Sensitive filter, the document view, the
//     Shred hold row in Settings
//   Search: instant results over the fields and the text, typed years turning chips on, highlighted
//     matches and snippets, Also in Drive, recents, no results, closing back to the previous tab (#61)
//   Paperless: the subtitle, Still mailing? banners and Wait a cycle, the sections, a status swipe,
//     the sender detail (status menu, check-back date, the primary button), the grouped Done row
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open(hash, { width = 390, height = 844, dark = false, extra = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(`${origin}/public/index.html?fake=1&seed${extra}${hash}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  return { ctx, page, problems };
}
const db = (page, path) => page.evaluate((p) => window.__PT_FAKE__.db.get(p), path);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, " ").trim() || "", sel);
const texts = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, " ").trim()), sel);
const hash = async (page) => { await page.waitForTimeout(60); return page.evaluate(() => decodeURIComponent(location.hash)); };
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true, () => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const segs = (page) => texts(page, "#piles-body [data-seg]").then((l) => l.join("|"));
// Drags a row left by dx pixels with the mouse (pointer events, like a finger).
async function swipe(page, sel, dx) {
  const box = await page.locator(sel).first().boundingBox();
  const y = box.y + box.height / 2, x = box.x + box.width - 30;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x - (dx * i) / 10, y + 1);
  await page.mouse.up();
}

try {
  // ---------- Piles ----------
  {
    const { ctx, page, problems } = await open("#/piles");
    await until(page, () => document.querySelector("#piles-body [data-seg=shred]"));
    await page.click("[data-seg=shred]");
    check(await segs(page) === "Shred 5|Keep 2|All filed 7", `segments show plain counts (${await segs(page)})`);
    check(await text(page, "[data-safe-banner]") === "3 are safe to shred. The Drive copy is confirmed and the 3-day hold is over.", "the safe-to-shred banner counts the safe ones and names the hold");
    const safeRows = await texts(page, "[data-section=safe] .row-title");
    check(safeRows.length === 3 && safeRows.includes("2023 W-2") && safeRows.includes("Electric bill, August"), "verified past the hold, and a log with no source, are safe");
    const waiting = await texts(page, "[data-section=waiting] .list-row");
    check(waiting.some((t) => /Electric bill, September.*Checking the Drive copy.*Checking/.test(t)), "an unverified iPhone doc waits on the Drive check");
    check(waiting.some((t) => /2023 W-2, corrected.*Drive copy confirmed · hold ends .*2 days/.test(t)), "a doc verified yesterday waits out the hold, with the end date and days left");
    check(await text(page, "[data-section=safe] [data-open=pharmacy] .row-subtitle") === "Elm Street Pharmacy · Cross-cut", "sensitive rows say Cross-cut");
    check(await text(page, "[data-mark]") === "Mark 3 as shredded", "the floating button counts the safe ones");

    await swipe(page, "[data-swipe][data-key='sw-pharmacy'] .b-swipe-content", 300);   // a long swipe runs Shredded
    check(await until(page, () => window.__PT_FAKE__.db.get("docs/pharmacy").physical === "shredded"), "a long swipe left marks the row shredded");
    check(!!(await db(page, "docs/pharmacy")).shreddedAt, "with shreddedAt");
    check(await until(page, () => document.querySelector("[data-seg=shred]").textContent.trim() === "Shred 4"), "the count follows the live listener");

    await swipe(page, "[data-swipe][data-key='sw-w2-2023'] .b-swipe-content", 100);    // a short swipe shows the action
    check(await until(page, () => document.querySelector("[data-key='sw-w2-2023']")?.classList.contains("open")), "a short swipe reveals Shredded");
    await page.click("[data-key='sw-w2-2023'] .b-swipe-content");
    check(await until(page, () => !document.querySelector("[data-key='sw-w2-2023']").classList.contains("open")) && await hash(page) === "#/piles", "tapping an open row closes it instead of opening it");

    await page.click("[data-mark]");
    check(await text(page, ".action-sheet .as-title") === "Mark 2 as shredded?" && await text(page, ".action-sheet .as-message") === "Do this once the paper has gone through the shredder.", "Mark asks first, with the spec's copy");
    await page.click(".action-sheet .as-btn[data-i='0']");
    check(await until(page, () => ["w2-2023", "electric-aug"].every((id) => window.__PT_FAKE__.db.get(`docs/${id}`).physical === "shredded")), "confirming marks every safe doc shredded");
    check((await db(page, "docs/w2-2023-c")).physical === "to_shred" && (await db(page, "docs/electric-sep")).physical === "to_shred", "Waiting rows are never included");
    check(await until(page, () => !document.querySelector("[data-mark]") && !document.querySelector("[data-safe-banner]")), "with nothing safe, the banner and button go away");

    // Keep: the swipe's keyboard twin. Tab onto the hidden action and the row slides open.
    await page.click("[data-seg=keep]");
    check((await texts(page, "#piles-body .group-header")).join("|") === "To put away|In the binder", "Keep has To put away and In the binder");
    check(await text(page, "[data-open=car-title] .row-subtitle") === "DMV · Auto", "keep rows say sender and folder");
    await page.focus("[data-key='sw-car-title'] [data-swipe-act=putaway]");
    check(await page.evaluate(() => document.querySelector("[data-key='sw-car-title']").classList.contains("open")), "focusing Put away slides the row open");
    await page.keyboard.press("Enter");
    check(await until(page, () => window.__PT_FAKE__.db.get("docs/car-title").physical === "stored"), "Put away moves it to the binder");
    check(await until(page, () => document.querySelectorAll("[data-section=binder] [data-open]").length === 2), "and the row moves down");

    // All filed, by month, with the filter.
    await page.click("[data-seg=all]");
    check(await page.isVisible("#piles-filter"), "All filed shows the filter button");
    const months = await texts(page, "[data-section=month] .group-header");
    check(months.length >= 1 && months.every((m) => /^[A-Z][a-z]+ \d{4}$/.test(m)), `grouped by month (${months.join(", ")})`);
    check(await page.locator("[data-section=month] .verdict-badge").count() === 7, "every row carries its verdict badge");
    await page.click("#piles-filter");
    await page.click(".menu .menu-item:has-text('Sensitive')");
    const sens = await page.locator("[data-section=month] [data-open]").count();
    check(sens === 6, `the Sensitive filter keeps only sensitive docs (${sens})`);
    await page.click("#piles-filter"); await page.click(".menu .menu-item:has-text('All')");

    // The document view.
    await page.click("[data-open=w2-2023]");
    check(await hash(page) === "#/piles/doc:w2-2023", "a row opens the document view on Piles");
    check(await text(page, "#screen .nav-title") === "2023 W-2" && await page.locator("#screen .verdict-badge.large").count() === 1, "the view has the title and the large verdict badge");
    check(await text(page, "#screen .b-doc-why") === "Why: Box 1 wages matter for taxes. The IRS has its own copy.", "and Claude's reason");
    check(await page.getAttribute("#screen .b-nav-link", "href") === "https://drive.google.com/file/d/seed-w2-2023/view", "Open in Drive links the Drive file");
    check((await texts(page, "#screen .b-kv")).some((t) => t === "FolderTaxes › 2024"), "the folder shows as a breadcrumb with the year");
    await page.click("#screen [data-nav-back]");
    check(await hash(page) === "#/piles", "back returns to Piles");

    // Settings, Shred hold.
    await page.click("#view-piles [data-avatar]");
    await page.waitForSelector("#set-shred-hold");
    check(await text(page, "#set-shred-hold") === "Shred hold3 days", "Settings shows Shred hold · 3 days");
    await page.click("#set-shred-hold");
    check((await texts(page, ".menu .menu-item")).join("|") === "None|1 day|3 days|7 days", "the hold picker offers None, 1, 3 and 7 days");
    await page.click(".menu .menu-item:has-text('None')");
    check(await until(page, () => window.__PT_FAKE__.db.get("config/settings").shredHoldDays === 0), "picking None saves shredHoldDays 0 to the account");
    await page.click("[data-settings-done]");
    await page.waitForTimeout(350);
    await page.click("[data-seg=shred]");
    check(await until(page, () => document.querySelector("[data-safe-banner]")?.textContent.includes("1 is safe to shred. The Drive copy is confirmed.") && !document.querySelector("[data-safe-banner]").textContent.includes("hold")), "with no hold, the verified doc is safe and the banner drops the hold");
    check(await noSideScroll(page), "no sideways scroll on Piles at 390px");
    check(problems.length === 0, `no console errors on Piles (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // ---------- Search ----------
  {
    const { ctx, page, problems } = await open("#/piles");
    await page.click("[data-tab-link=search]");
    await until(page, () => document.querySelector("#search-body [data-chip]"));
    check((await texts(page, "#search-body [data-chip]")).slice(-2).join("|") === "Sensitive|Keep originals", "the chips end with Sensitive and Keep originals");
    check((await texts(page, "[data-suggest]")).length === 3, "Suggested offers the three most common senders");
    await page.fill("#search-field", "w-2 2023");
    check(await until(page, () => document.querySelector("[data-section=results] .group-header")?.textContent === "2 results"), "typing searches instantly: 2 results");
    check(await page.getAttribute("[data-chip='year:2023']", "aria-pressed") === "true", "typing a year turns its chip on");
    check(await page.locator("[data-section=results] .row-title mark").count() >= 2, "matches are highlighted in the titles");
    check(/Wage and Tax Statement/.test(await text(page, "[data-result=w2-2023] .b-snippet")), "a snippet of the text around the match");
    check(await text(page, "[data-result=w2-2023] .row-subtitle").then((t) => t.startsWith("Northwind Logistics · Taxes › 2024")), "the subtitle is sender and folder with the year");
    await page.click("[data-chip='year:2023']");
    check(await until(page, () => document.querySelector("#search-field").value === "w-2"), "tapping a typed chip takes its word out of the query");
    check(await until(page, () => document.querySelector("[data-section=drive] .row-title")?.textContent.includes("Northwind-Logistics-2022")), "Also in Drive lists a Drive match the log doesn't have");
    check(await text(page, "[data-section=drive] .row-subtitle") === "In Drive · Taxes" && /drive\.google\.com/.test(await page.getAttribute("[data-section=drive] a.list-row", "href")), "it opens in Drive and names its folder");
    await page.press("#search-field", "Enter");
    await page.fill("#search-field", "zzqx");
    check(await until(page, () => document.querySelector("[data-no-results]")?.textContent.includes("No Results for “zzqx”")), "no results says so");
    await page.fill("#search-field", "");
    check(await until(page, () => [...document.querySelectorAll("[data-section=recent] [data-recent]")].map((r) => r.dataset.recent).join("|") === "w-2"), "the submitted search is a recent");
    await page.click("[data-recent='w-2']");
    check(await until(page, () => document.querySelector("#search-field").value === "w-2" && document.querySelectorAll("[data-result]").length === 2), "a recent runs straight away and fills the field");
    await page.click("[data-result=w2-2023]");
    check((await hash(page)).startsWith("#/search/doc:w2-2023"), "a result opens the document view");
    check(/W-2/.test(await text(page, "#screen [data-section] mark, #screen mark")), "the document view highlights the search words in the matching text");
    await page.click("#screen [data-nav-back]");
    await page.click("#search-close");
    check(await hash(page) === "#/piles", "closing Search goes back to the tab you came from (#61)");
    check(problems.length === 0, `no console errors on Search (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // ---------- Paperless ----------
  {
    const { ctx, page, problems } = await open("#/paperless");
    await until(page, () => document.querySelector("#paperless-body [data-section]"));
    check(await text(page, "#paperless-subtitle") === "1 of 4 senders confirmed", "the subtitle counts confirmed senders, leaving out Can't stop");
    const banners = await texts(page, "[data-flag] .banner-body > p:not(.banner-heading)");
    check(banners.length === 2 && /^Cascade Power & Light sent a paper utility bill on .+, after you requested paperless\.$/.test(banners[0]), `Still mailing? banners, newest first (${banners[0]})`);
    check((await texts(page, "#paperless-body .group-header")).join("|") === "Check back soon|To do|Done", "Check back soon, To do and Done");
    check((await texts(page, "[data-section=checkback] .row-title")).join("|") === "Summit Health Plan|Cascade Power & Light", "Check back soon is sorted by the check-back date");
    check(/^Check back [A-Z][a-z]{2} \d{1,2}/.test(await text(page, "[data-sender=summit-health-plan] .row-subtitle")) && await text(page, "[data-sender=summit-health-plan] .pill") === "Waiting a cycle", "rows say when to check back, with the status pill");
    check(await text(page, "[data-sender=brightline-wireless] .row-subtitle") === "Account settings, then Billing, then Paper bill off.", "To do rows show the first step");
    check(await text(page, "[data-done-group] .row-title") === "Harbor Federal CU" && await text(page, "[data-done-group] .row-subtitle") === "1 more can't stop (DMV)", "Done groups the senders that share a row");
    await page.click("[data-wait-cycle=cascade-power-light]");
    check(await until(page, () => window.__PT_FAKE__.db.get("paperless/cascade-power-light").status === "waiting_cycle"), "Wait a cycle sets Waiting a cycle");
    const c = await db(page, "paperless/cascade-power-light");
    check(Math.round((new Date(c.checkBackAt) - Date.now()) / 86400000) === 35 && !!c.mailHandledAt, "with a check-back date 35 days out, and the flag handled");
    check(await until(page, () => !document.querySelector("[data-flag=cascade-power-light]")), "and its banner goes away");
    await page.focus("[data-key='sw-brightline-wireless'] [data-swipe-act=requested]");
    await page.keyboard.press("Enter");
    check(await until(page, () => window.__PT_FAKE__.db.get("paperless/brightline-wireless").status === "requested"), "the row's Requested action (swipe twin) sets the status");
    check(!!(await db(page, "paperless/brightline-wireless")).requestedAt, "with requestedAt");

    await page.click("[data-sender=summit-health-plan]");
    check(await hash(page) === "#/paperless/sender:summit-health-plan" && await text(page, "#screen .nav-title") === "Summit Health Plan", "a row pushes the sender detail");
    check((await texts(page, "#screen .group-header")).join("|") === "Status|How to stop paper|Check back|Seen", "the detail's sections");
    check(await text(page, "#screen [data-primary]") === "It's confirmed", "Waiting a cycle offers It's confirmed");
    await page.fill("#b-checkback", "2030-01-15");
    await page.dispatchEvent("#b-checkback", "change");
    check(await until(page, () => (window.__PT_FAKE__.db.get("paperless/summit-health-plan").checkBackAt || "").startsWith("2030-01-15")), "the check-back date saves");
    await page.click("#screen [data-status-menu]");
    check((await texts(page, ".menu .menu-item")).join("|") === "To do|Requested|Waiting a cycle|Confirmed|Can't stop", "the status menu has the five statuses");
    await page.click(".menu .menu-item:has-text('Confirmed')");
    check(await until(page, () => window.__PT_FAKE__.db.get("paperless/summit-health-plan").status === "done"), "picking Confirmed writes done");
    check(!!(await db(page, "paperless/summit-health-plan")).doneAt && await until(page, () => !document.querySelector("#screen [data-primary]")), "with doneAt, and no primary button once confirmed");
    await page.click("#screen [data-nav-back]");
    await page.click("[data-done-group]");
    check(await hash(page) === "#/paperless/done-senders" && (await texts(page, "#screen [data-sender] .row-title")).length === 3, "the Done row lists every confirmed and can't stop sender");
    check(problems.length === 0, `no console errors on Paperless (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // ---------- Both themes, phone and desktop ----------
  for (const [width, dark] of [[390, true], [1280, false], [1280, true]]) {
    const { ctx, page, problems } = await open("#/piles", { width, height: 900, dark });
    for (const tab of ["piles", "paperless", "search"]) {
      await page.click(`[data-tab-link=${tab}]`);
      await page.waitForTimeout(150);
      check(await noSideScroll(page), `no sideways scroll on ${tab} at ${width}px ${dark ? "dark" : "light"}`);
    }
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector("#app")).backgroundColor);
    check(dark ? bg === "rgb(0, 0, 0)" : bg !== "rgb(0, 0, 0)", `the ${dark ? "dark" : "light"} background at ${width}px`);
    check(problems.length === 0, `no console errors at ${width}px ${dark ? "dark" : "light"} (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // ---------- A link straight to a document (a reload on the document view) ----------
  {
    const { ctx, page, problems } = await open("#/piles/doc:car-title");
    check(await until(page, () => document.querySelector("#screen:not([hidden]) .nav-title")?.textContent === "Vehicle title"), "a reload on doc:<id> opens the document view");
    check(problems.length === 0, `no console errors on a deep link (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // ---------- Signed out: the library is forgotten ----------
  {
    const { ctx, page } = await open("#/piles");
    await until(page, () => document.querySelector("[data-seg=shred]")?.textContent.trim() === "Shred 5");
    await page.evaluate(() => document.getElementById("btn-signout").click());
    check(await until(page, () => !document.querySelector("#gate").hidden), "signing out shows the sign-in screen");
    check(await until(page, () => document.querySelector("[data-seg=shred]")?.textContent.trim() === "Shred 0"), "and Piles forgets the library");
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} browse check(s) failed` : "\nall browse checks passed");
process.exit(failures ? 1 : 0);
