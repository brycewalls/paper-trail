// Lab build test (#92): opens public/index.html?fake=1&lab=1 (localhost with ?lab stands in for
// paper-trail-lab.web.app) in headless Chromium at 390 px and checks the lab infrastructure:
//   - <html class="pt-lab">, the lab title and manifest, before any module runs
//   - the Lab badge on the sign-in screen and on each tab's nav bar, and the lab's sign-in copy
//   - the tab bar's violet tint (not the live blue)
//   - sign-in sends a lab_ nonce, so oauthCallback returns to the lab host
//   - Firestore's DATA_ROOT is users/{uid}/lab/data and Drive's root is "Paperwork Archive (Lab)" with
//     the same 11 subfolders
//   - Settings has the Lab section: Reader, Compare with Claude (on by default, saved), Rules vs Claude
//   - the same page without ?lab shows none of it (the live app is unchanged)
// Runs in CI and locally:  node tools/lab_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });
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
async function open(query, { dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(`${origin}/public/index.html?fake=1${query}`, { waitUntil: "networkidle" });
  return { ctx, page, problems };
}
const mod = (page, name, expr) => page.evaluate(async ([n, e]) => { const m = await import(`/public/js/${n}`); return new Function("m", `return (${e});`)(m); }, [name, expr]);

try {
  // 1. Signed out on the lab: badge, copy, tint, title, and a lab_ nonce.
  {
    const { ctx, page, problems } = await open("&lab=1&signedout");
    await page.waitForSelector("#btn-signin:not([hidden])");
    check(await page.evaluate(() => document.documentElement.classList.contains("pt-lab")), "html is marked pt-lab");
    check(/Paper Trail Lab$/.test(await page.title()), `the tab title says Paper Trail Lab (${await page.title()})`);
    check(await page.getAttribute('link[rel="manifest"]', "href") === "lab.webmanifest", "the lab's own manifest");
    check((await page.textContent(".gate-title .lab-badge"))?.trim() === "Lab" && await page.isVisible(".gate-title .lab-badge"), "the sign-in screen shows the Lab badge");
    check(/no AI/.test(await page.textContent(".gate-lede")) && !/Claude/.test(await page.textContent(".gate-lede")), "the sign-in copy describes the lab, not Claude");
    await page.screenshot({ path: join(shots, "lab-signin-390-light.png") });
    await Promise.all([page.waitForEvent("load"), page.click("#btn-signin")]);
    await page.waitForSelector("#app:not([hidden])");
    const urls = await page.evaluate(() => window.__PT_FAKE__.auth ? window.__PT_FAKE__.auth.authorizeUrls : JSON.parse(sessionStorage.getItem("pt-fake-auth")).authorizeUrls);
    const st = new URL(urls[0]).searchParams.get("state") || "";
    check(/^lab_[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(st), `sign-in sends a lab_ nonce (${st.slice(0, 8)}...)`);
    check(new URL(urls[0]).searchParams.get("redirect_uri") === "https://paper-trail-bw.web.app/oauth/callback", "Google's redirect URI is unchanged (no new OAuth client setup)");
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
    await ctx.close();
  }

  // 2. Signed in on the lab: nav badges, tint, data roots, Drive folder, Settings.
  {
    const { ctx, page, problems } = await open("&lab=1");
    await page.waitForSelector("#app:not([hidden])");
    for (const tab of ["sort", "piles", "paperless", "search"]) {
      check(await page.locator(`#view-${tab} .nav-leading .lab-badge`).count() === 1, `the ${tab} nav bar carries the Lab badge`);
    }
    check(await page.isVisible("#view-sort .nav-leading .lab-badge"), "the badge is visible on Sort");
    const tint = await page.evaluate(() => {
      const sel = document.querySelector(".tabbar-item[aria-selected=true]");
      const probe = document.createElement("span"); probe.style.color = "var(--lab)"; document.body.append(probe);
      const lab = getComputedStyle(probe).color; probe.remove();
      return { sel: getComputedStyle(sel).color, lab, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), edge: getComputedStyle(document.querySelector(".tabbar-tabs")).boxShadow };
    });
    check(tint.sel === tint.lab, `the selected tab is drawn in the lab's violet (${tint.sel})`);
    check(tint.edge.includes(tint.lab), "the tab bar has the violet edge");
    check(JSON.stringify(await mod(page, "config.js", "m.DATA_ROOT")) === '["lab","data"]', "Firestore goes under users/{uid}/lab/data");
    check(await mod(page, "config.js", "m.ROOT_FOLDER") === "Paperwork Archive (Lab)", "Drive files into Paperwork Archive (Lab)");
    check(/Lab$/.test(await mod(page, "config.js", "m.VERSION")), "the version says Lab");
    await mod(page, "drive.js", "m.ensureFolders(true)");
    const folders = await page.evaluate(() => window.__PT_FAKE__.folders.map((f) => ({ name: f.name, parent: f.parent, id: f.id })));
    const labRoot = folders.find((f) => f.name === "Paperwork Archive (Lab)" && f.parent === "root");
    check(!!labRoot, "the lab's root folder is created in Drive");
    check(!folders.some((f) => f.name === "Paperwork Archive"), "the real Paperwork Archive is never touched");
    const subs = folders.filter((f) => labRoot && f.parent === labRoot.id).map((f) => f.name);
    const names = await mod(page, "config.js", "m.FOLDER_NAMES");
    check(subs.length === 11 && names.every((n) => subs.includes(n)), `the same 11 subfolders (${subs.length})`);

    // Settings: the Lab section.
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("#settings-lab");
    check((await page.textContent("#settings-lab .group-header")).trim().toLowerCase() === "lab", "Settings has a Lab section");
    check((await page.textContent("#lab-reader")).trim() === "Rules, no AI", "Reader: Rules, no AI");
    check(await page.isChecked("#lab-compare"), "Compare with Claude is on by default");
    check((await page.textContent("#lab-stats")).trim() === "No comparisons yet", "Rules vs Claude starts empty");
    const order = await page.evaluate(() => [...document.querySelectorAll("#settings-sections [data-settings-section]")].map((e) => e.dataset.settingsSection));
    check(order[0] === "lab", `the Lab section comes first after Google Drive (${order.join(", ")})`);
    await page.screenshot({ path: join(shots, "lab-settings-390-light.png") });
    await page.click('label[for="lab-compare"]');
    await page.waitForFunction(() => window.__PT_FAKE__.db.get("config/lab")?.compareWithClaude === false);
    check(!(await mod(page, "lab.js", "m.compareEnabled()")), "turning it off saves config/lab and compareEnabled() follows");
    await page.click('label[for="lab-compare"]');
    await page.waitForFunction(() => window.__PT_FAKE__.db.get("config/lab")?.compareWithClaude === true);
    check(await mod(page, "lab.js", "m.compareEnabled()"), "and back on");

    // Stats from compare records (the reader writes them with store.putComparison).
    await mod(page, "store.js", `Promise.all([
      m.putComparison("a", { at: "2026-10-16T10:00:00Z", agree: { title: true, docType: true, folder: true, verdict: false } }),
      m.putComparison("b", { at: "2026-10-16T10:01:00Z", agree: { title: false, docType: true, folder: true, verdict: true } }),
    ])`);
    await page.waitForFunction(() => /agree/.test(document.querySelector("#lab-stats")?.textContent || ""));
    check((await page.textContent("#lab-stats")).trim() === "75% agree", `Rules vs Claude shows overall agreement (${(await page.textContent("#lab-stats")).trim()})`);
    const dl = await page.textContent("#lab-stats-fields");
    check(/title50% \(1 of 2\)/.test(dl) && /docType100% \(2 of 2\)/.test(dl), `and agreement per field (${dl})`);
    const s = await mod(page, "lab.js", "m.agreementStats([{ agree: { title: true, sensitive: false } }, { nope: 1 }, { agree: { 'paperless.possible': true } }])");
    check(s.docs === 2 && s.total === 3 && s.fields.title.rate === 1 && s.fields.sensitive.rate === 0 && s.fields.issuer.rate === null, "agreementStats counts only scored fields");
    await page.keyboard.press("Escape");

    await ctx.close();
    await (async () => {
      const { ctx: c2, page: p2 } = await open("&lab=1", { dark: true });
      await p2.waitForSelector("#app:not([hidden])");
      await p2.screenshot({ path: join(shots, "lab-sort-390-dark.png") });
      const sel = await p2.evaluate(() => getComputedStyle(document.querySelector(".tabbar-item[aria-selected=true]")).color);
      check(sel === "rgb(195, 161, 255)", `dark mode uses the dark lab violet (${sel})`);
      await c2.close();
    })();
    check(!problems.length, `no console errors${problems.length ? ": " + problems.join(" | ") : ""}`);
  }

  // 3. Without ?lab: the live app, unchanged.
  {
    const { ctx, page, problems } = await open("");
    await page.waitForSelector("#app:not([hidden])");
    check(!(await page.evaluate(() => document.documentElement.classList.contains("pt-lab"))), "no pt-lab mark");
    check(/Paper Trail$/.test(await page.title()) && !/Lab/.test(await page.title()), `the title stays Paper Trail (${await page.title()})`);
    check(await page.getAttribute('link[rel="manifest"]', "href") === "manifest.webmanifest", "the live manifest");
    check(await page.locator(".lab-badge").count() === 0, "no Lab badge anywhere");
    check(JSON.stringify(await mod(page, "config.js", "m.DATA_ROOT")) === "[]", "Firestore stays at users/{uid}/");
    check(await mod(page, "config.js", "m.ROOT_FOLDER") === "Paperwork Archive", "Drive stays Paperwork Archive");
    check(!(await mod(page, "lab.js", "m.compareEnabled()")), "compare is never on outside the lab");
    const sel = await page.evaluate(() => getComputedStyle(document.querySelector(".tabbar-item[aria-selected=true]")).color);
    check(sel === "rgb(35, 70, 184)", `the selected tab keeps the live blue (${sel})`);
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector("#settings-panel");
    check(await page.locator("#settings-lab").count() === 0, "Settings has no Lab section");
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
console.log(failures ? `\n${failures} lab check(s) failed` : "\nall lab checks passed");
process.exit(failures ? 1 : 0);
