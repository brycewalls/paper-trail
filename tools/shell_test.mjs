// Shell and design-system test (#83): opens public/index.html?fake=1 and public/dev/gallery.html in
// headless Chromium at 390 px and checks what every feature builds on: the four tabs and their
// stacks, pushed screens and the back button, the outbox accessory's states and its hiding rules,
// Search's bottom field and its close button, the Scan menu (one menu, three sources, keyboard),
// the Settings sheet from the avatar, sheets (detents, drag to dismiss, Escape, focus return),
// the confirmation dialog, keyboard shortcuts, both themes, and the desktop column. Runs in CI and
// locally:  node tools/shell_test.mjs
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
async function open(path, { width = 390, height = 844, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(origin + path, { waitUntil: "networkidle" });
  return { ctx, page, problems };
}
const hash = async (page) => { await page.waitForTimeout(60); return page.evaluate(() => location.hash); };
const visibleView = (page) => page.evaluate(() => [...document.querySelectorAll(".view")].filter((v) => !v.hidden).map((v) => v.id).join(","));

try {
  // 1. Tabs, stacks, pushed screens, accessory.
  {
    const { ctx, page, problems } = await open("/public/index.html?fake=1");
    await page.waitForSelector("#app:not([hidden])");
    check(await hash(page) === "#/sort" && await visibleView(page) === "view-sort", "opens on Sort");
    check((await page.textContent("#outbox-accessory")).includes("Outbox is empty"), "the accessory shows the idle state");
    check((await page.textContent("#view-sort [data-avatar]")).trim() === "BW", "the avatar shows the account's initials");
    await page.click("[data-tab-link=piles]");
    check(await hash(page) === "#/piles" && await visibleView(page) === "view-piles", "Piles tab");
    await page.click("#outbox-accessory");
    check(await hash(page) === "#/piles/outbox" && await visibleView(page) === "screen", "the accessory pushes Outbox onto the current tab");
    check((await page.textContent("#screen .nav-back")).trim() === "Piles", "the back button names the tab below");
    check(await page.isHidden("#outbox-accessory"), "the accessory hides while the Outbox shows");
    await page.click("[data-tab-link=sort]"); await page.click("[data-tab-link=piles]");
    check(await hash(page) === "#/piles/outbox", "each tab keeps its own stack");
    await page.click("[data-tab-link=piles]");
    check(await hash(page) === "#/piles", "tapping the selected tab pops to its root");
    await page.click("#outbox-accessory"); await page.click("#screen [data-nav-back]");
    check(await hash(page) === "#/piles", "the back button pops the screen");
    // outbox:status drives the accessory
    await page.evaluate(async () => { const { emit } = await import("/public/js/ui.js"); emit("outbox:status", { kind: "attention", count: 3 }); });
    check((await page.textContent("#outbox-accessory")).includes("3 need a retry"), "outbox:status redraws the accessory");

    // Search: bottom field, query in the route, close returns to the last tab
    await page.click("[data-tab-link=search]");
    await hash(page);
    check(await page.isVisible("#search-field") && await page.isHidden(".tabbar-tabs") && await page.isHidden("#outbox-accessory"), "Search turns the tab bar into a bottom field");
    await page.fill("#search-field", "w-2 2023");
    await page.waitForFunction(() => location.hash === "#/search?q=w-2+2023" || location.hash === "#/search?q=w-2%202023");
    check(true, "typing writes the query to the route");
    await page.click("#search-close");
    check(await hash(page) === "#/piles", "closing Search returns to the tab you came from");

    // Keyboard
    await page.keyboard.press("3");
    check(await hash(page) === "#/paperless", "3 opens Paperless");
    await page.keyboard.press("/");
    check((await hash(page)).startsWith("#/search") && await page.evaluate(() => document.activeElement.id) === "search-field", "/ opens Search with the field focused");
    await page.keyboard.press("Escape");
    check(await hash(page) === "#/paperless", "Escape in the field closes Search");

    // Scan menu: one menu, three sources, keyboard, capture:request
    await page.keyboard.press("1");
    await page.evaluate(async () => { const { on } = await import("/public/js/ui.js"); window.__req = []; on("capture:request", (d) => window.__req.push(d.source)); });
    await page.click("#btn-scan-menu");
    const items = await page.$$eval(".menu-item", (b) => b.map((x) => x.textContent.trim()));
    check(items.join("|") === "Scan document|Import from Files|Import from Photos", "the Scan menu has the spec's three items in order");
    check(await page.evaluate(() => document.activeElement.textContent.trim()) === "Scan document", "the menu takes focus");
    await page.keyboard.press("ArrowDown");
    page.once("filechooser", (fc) => fc.setFiles([]).catch(() => {}));
    await page.keyboard.press("Enter");
    check(await page.evaluate(() => window.__req.join()) === "files" && !(await page.$(".menu")), "picking an item asks capture for that source and closes the menu");

    // Settings sheet
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector(".sheet[data-detent=large]");
    check(await page.isVisible("#settings-account") && (await page.textContent(".sheet-title")).trim() === "Settings", "the avatar opens Settings as a large sheet");
    check(await page.evaluate(() => document.getElementById("view-sort").inert), "the app behind the sheet is inert");
    await page.click("[data-settings-done]");
    await page.waitForSelector(".sheet", { state: "detached" });
    check(await page.evaluate(() => !document.getElementById("settings-panel") && !document.getElementById("view-sort").inert), "Done closes it and the app is live again");

    // The deck's arrow keys stay on Sort only
    await page.click("[data-tab-link=piles]");
    await page.keyboard.press("ArrowRight");
    check(await hash(page) === "#/piles", "arrow keys do nothing off Sort");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 1, "no sideways scroll at 390 px");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 2. Sheets: medium detent, drag up to large, drag down to dismiss, Escape, the confirmation dialog.
  {
    const { ctx, page, problems } = await open("/public/dev/gallery.html");
    await page.click("#g-sheet");
    await page.waitForSelector(".sheet[data-detent=medium]");
    await page.waitForTimeout(800);
    const medium = await page.$eval(".sheet", (s) => s.getBoundingClientRect().height);
    check(medium >= 320 && medium < 600, `a sheet opens at the medium detent (${Math.round(medium)} px)`);
    check(await page.isVisible(".sheet-footer .btn-primary"), "its pinned button is on screen at medium");
    const grab = await page.$eval(".sheet-grab", (g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x, grab.y - 320, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(800);
    check(await page.$eval(".sheet", (s) => s.dataset.detent) === "large", "dragging up moves it to the large detent");
    const g2 = await page.$eval(".sheet-grab", (g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(g2.x, g2.y); await page.mouse.down(); await page.mouse.move(g2.x, g2.y + 600, { steps: 10 }); await page.mouse.up();
    await page.waitForSelector(".sheet", { state: "detached", timeout: 3000 });
    check(true, "dragging down dismisses it");
    check(await page.evaluate(() => document.activeElement.id) === "g-sheet", "focus returns to the button that opened it");
    await page.click("#g-sheet-l");
    await page.waitForSelector(".sheet[data-detent=large]");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".sheet", { state: "detached", timeout: 3000 });
    check(true, "Escape closes a sheet");
    await page.click("#g-confirm");
    await page.waitForSelector(".action-sheet");
    check((await page.textContent(".as-title")).trim() === "Shred a Keep original?" && await page.isVisible(".as-btn.destructive"), "the confirmation dialog shows the title and a destructive action");
    await page.click(".as-btn.cancel");
    check(!(await page.$(".action-sheet")), "Cancel closes it");
    check(problems.length === 0, `gallery: no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 3. Dark theme tokens, and the desktop column.
  {
    const { ctx, page } = await open("/public/index.html?fake=1", { dark: true });
    await page.waitForSelector("#app:not([hidden])");
    const c = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".app-col")).backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() }));
    check(c.bg === "rgb(0, 0, 0)" && c.accent === "#8ea7ff", "dark mode uses A9's black background and the dark accent");
    await ctx.close();
    const d = await open("/public/index.html?fake=1", { width: 1440, height: 900 });
    await d.page.waitForSelector("#app:not([hidden])");
    const col = await d.page.$eval(".app-col", (e) => { const r = e.getBoundingClientRect(); return { w: r.width, left: r.left }; });
    const dock = await d.page.$eval("#dock", (e) => e.getBoundingClientRect().width);
    check(col.w === 480 && Math.abs(col.left - 480) <= 1 && dock === 480, "desktop centers a 480 px phone column, dock included");
    await d.ctx.close();
  }
} catch (e) {
  failures++;
  console.log("FAIL the test stopped:", e.message.split("\n")[0]);
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall shell checks passed");
process.exit(failures ? 1 : 0);
