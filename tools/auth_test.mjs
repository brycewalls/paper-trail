// Auth test (#14, #15, #3, #4): opens public/index.html?fake=1 in headless Chromium and checks the
// web sign-in the way a person meets it. The fake backend stands in for Google, oauthCallback,
// oauthRedeem, Firebase Auth and the driveToken callable (tools/fake/fake-backend.js); the sign-in
// is a real full-page redirect and back through #/auth/done, so the boot path is the real one.
//   - opening the app with a cached account shows the app at once, no sign-in screen or spinner,
//     before Firebase answers; a session Firebase no longer has goes back to sign-in
//   - Sign in with Google: the authorization URL (web client, redirect URI, scopes, offline, a web
//     nonce, the challenge in the state and never the verifier), the redeem, the fragment cleaned up
//   - canceled, failed, a forged state, an account off the list (and Use another account)
//   - Drive consent skipped: step 2, locked across a reload, Connect Google Drive
//   - Drive tokens: cached, one mint for callers at the same moment, drive_revoked shows Reconnect
//     Drive (banner on Sort and Piles, the accessory, Settings) and Reconnect brings it back
//   - Settings: the account row and Account page, the Drive section, Sign out and its confirm
//   - light and dark, 390 px and desktop, no console errors, no sideways scroll
// Runs locally (and in CI):  node tools/auth_test.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
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
const base = `${origin}/public/index.html?fake=1`;
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function context({ width = 390, height = 844, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  return { ctx, page, problems };
}
const go = (page, q = "", waitUntil = "networkidle") => page.goto(base + q, { waitUntil });
const fake = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("pt-fake-auth") || "null"));
const gateStep = (page) => page.evaluate(() => document.body.dataset.gate || "in");
const appShown = (page) => page.evaluate(() => !document.getElementById("app").hidden && getComputedStyle(document.getElementById("gate")).display === "none");
const local = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function signInFlow(page) {
  await page.waitForSelector("#btn-signin:not([hidden]):not([disabled])");
  await Promise.all([page.waitForEvent("load"), page.click("#btn-signin")]);   // the redirect and back
  await page.waitForLoadState("networkidle");
}
const makePdf = () => Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");

try {
  // 1. First sign-in, from signed out: the authorization URL, the redeem, the clean return (#15, #3).
  {
    const { ctx, page, problems } = await context();
    await go(page, "&signedout");
    await page.waitForSelector("#btn-signin:not([hidden])");
    check(await gateStep(page) === "signin" && /Paper Trail asks for Drive access so it can file your scans\. It only sees the files it creates\./.test(await page.textContent("#gate-note")), "signed out shows the sign-in screen (4.1) with its footnote");
    check(await page.isHidden("#app"), "the app stays hidden behind it");
    await page.screenshot({ path: join(shots, "auth-signin-390-light.png") });
    await signInFlow(page);
    await page.waitForSelector("#app:not([hidden])");
    const f = await fake(page);
    const url = new URL(f.authorizeUrls[0]);
    const q = url.searchParams;
    check(url.origin + url.pathname === "https://accounts.google.com/o/oauth2/v2/auth", "Sign in goes to Google's authorization endpoint");
    check(q.get("client_id") === "814219266285-pe2scelka1o9m98bt0v0f5fohumfs8f6.apps.googleusercontent.com" && q.get("redirect_uri") === "https://paper-trail-bw.web.app/oauth/callback", "with the iPhone app's web client and the oauthCallback redirect URI");
    check(q.get("response_type") === "code" && q.get("access_type") === "offline" && /consent/.test(q.get("prompt")) && /select_account/.test(q.get("prompt")), "the code flow, offline, account picker and consent");
    check(["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"].every((s) => q.get("scope").split(" ").includes(s)), "scopes: openid email profile drive.file");
    const st = q.get("state");
    check(/^web_[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(st), `the state is a web nonce (36 characters), a dot and the challenge (${st.length} in all)`);
    check(![...q.keys()].some((k) => /verifier/i.test(k)) && !f.authorizeUrls[0].includes(st.split(".")[1] + "x"), "the verifier never goes in the URL");
    check(f.redeems === 1, "the handoff is redeemed once");
    check(await page.evaluate(() => location.hash) === "#/sort" && !(await page.evaluate(() => location.href)).includes("handoff"), "the return leaves #/auth/done and the handoff out of the address bar");
    check(await page.evaluate(() => sessionStorage.getItem("pt-oauth")) === null, "the attempt's verifier is cleared after the return");
    check(JSON.parse(await local(page, "pt-last-user") || "{}").email === "bryce.evan.walls@gmail.com", "the confirmed account is cached for the next open (#14)");
    check(await local(page, "pt-drive-status") === '"connected"', "Drive is connected after the first consent");
    check((await page.textContent("#view-sort [data-avatar]")).trim() === "BW", "the avatar shows the account's initials");
    check(await page.evaluate(() => document.getElementById("app").classList.contains("app-enter")), "the app cross-fades in");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);

    // 2. Opening again: the app renders from the cache before Firebase answers (#14).
    await page.goto(base + "&slowauth", { waitUntil: "domcontentloaded" });
    const early = await page.evaluate(() => ({ cached: document.documentElement.classList.contains("pt-cached") || !document.getElementById("app").hidden,
      gate: getComputedStyle(document.getElementById("gate")).display }));
    check(early.cached && early.gate === "none", "on open, the sign-in screen never paints for a cached account");
    await page.waitForTimeout(600);
    check(await appShown(page) && !(await page.$("#gate .spinner:not([hidden])")), "the app shows from the cache with no gate and no spinner while Firebase is still checking");
    check((await page.textContent("#view-sort [data-avatar]")).trim() === "BW", "the cached account's initials are there at once");
    await page.waitForTimeout(1400);
    check(await appShown(page), "Firebase confirms in the background and nothing changes");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);

    // 3. Settings: the account row and Account page, the Drive section, Sign out (4.9).
    await page.click("#view-sort [data-avatar]");
    await page.waitForSelector(".sheet[data-detent=large]");
    check((await page.textContent("#settings-account")).includes("Bryce Walls") && (await page.textContent("#settings-account")).includes("bryce.evan.walls@gmail.com"), "Settings opens on the account row: name and email");
    check((await page.textContent("#drive-state")).trim() === "Connected" && /Stays connected on the server\. No sign-in prompts\./.test(await page.textContent("#drive-sub")), "Google Drive: Connected, Stays connected on the server");
    check(await page.evaluate(() => document.getElementById("drive-dot").classList.contains("on")) && !(await page.$("#btn-drive")), "a green dot and no Reconnect row while connected");
    check((await page.textContent("#drive-folder")).includes("Paperwork Archive") && (await page.getAttribute("#drive-folder", "target")) === "_blank", "Folder · Paperwork Archive opens Drive");
    check((await page.textContent("#drive-last")).trim() === "None yet", "Last upload says None yet before anything uploads");
    check((await page.textContent("#settings-version")).trim() === "Paper Trail 2.0 (web)", "the footer names the version");
    await page.screenshot({ path: join(shots, "auth-settings-390-light.png") });
    await page.click("#settings-account");
    check((await page.textContent(".sheet-title")).trim() === "Account" && (await page.textContent("#acct-email")).trim() === "bryce.evan.walls@gmail.com", "the account row opens Account with the email");
    await page.click("#btn-signout");
    await page.waitForSelector(".action-sheet");
    check((await page.textContent(".as-title")).trim() === "Sign out of Paper Trail? Your scans stay on this phone until they upload.", "Sign out asks first, with the spec's question");
    await page.click(".as-btn.cancel");
    check(await appShown(page) && !!(await page.$(".sheet")), "Cancel keeps you signed in");
    await page.click("#btn-signout");
    await page.click(".as-btn.destructive");
    await page.waitForSelector("#btn-signin:not([hidden])");
    check(await gateStep(page) === "signin" && await page.isHidden("#app"), "Sign out goes back to the sign-in screen");
    check(await local(page, "pt-last-user") === null && await page.evaluate(() => sessionStorage.getItem("pt-drive-token")) === null, "and forgets the cached account and the Drive token");
    await go(page);
    await page.waitForSelector("#btn-signin:not([hidden])");
    check(await gateStep(page) === "signin", "a reload after signing out stays signed out");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 4. A session Firebase no longer has: the app shows from the cache, then sign-in.
  {
    const { ctx, page } = await context();
    await go(page);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);
    await go(page, "&lostsession");
    await page.waitForSelector("#btn-signin:not([hidden])");
    check(await gateStep(page) === "signin" && await local(page, "pt-last-user") === null, "a confirmed signed-out answer shows sign-in and clears the cache");
    await ctx.close();
  }

  // 5. Canceled, failed, and a forged return (3.12).
  for (const [q, what] of [["&signedout&oauth=canceled", "a canceled consent"], ["&signedout&oauth=failed", "a failed callback"]]) {
    const { ctx, page, problems } = await context();
    await go(page, q);
    await signInFlow(page);
    await page.waitForSelector("#gate-err:not(:empty)");
    check((await page.textContent("#gate-err")).trim() === "Sign-in didn't finish. Try again when you're ready." && await page.isVisible("#btn-signin") && await page.isEnabled("#btn-signin"),
      `${what} says Sign-in didn't finish and the button stays`);
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await context();
    await go(page, "&signedout");
    await page.waitForSelector("#btn-signin:not([hidden])");
    await page.evaluate(() => { location.hash = "#/auth/done?handoff=fake&state=web_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.forged"; location.reload(); });
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("#gate-err:not(:empty)");
    check((await fake(page)).redeems === 0 && await page.isHidden("#app"), "a return whose state this tab didn't start is never redeemed");
    check(await page.evaluate(() => location.hash) === "#/sort", "and leaves the address bar too");
    await ctx.close();
  }

  // 6. Off the list: from the consent, and from a Firebase session the rules refuse.
  {
    const { ctx, page, problems } = await context();
    await go(page, "&signedout&as=stranger");
    await signInFlow(page);
    await page.waitForSelector("#btn-gate-out:not([hidden])");
    check((await page.textContent("#gate-msg")).trim() === "This account isn't on the list." && await page.isHidden("#btn-signin"), "an account off the list sees This account isn't on the list (4.1)");
    check(await page.evaluate(() => getComputedStyle(document.getElementById("gate-msg")).color) !== await page.evaluate(() => getComputedStyle(document.querySelector(".gate-lede")).color), "in Danger, not the secondary color");
    await page.screenshot({ path: join(shots, "auth-not-allowed-390-light.png") });
    await Promise.all([page.waitForEvent("load"), page.click("#btn-gate-out")]);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("#app:not([hidden])");
    check(true, "Use another account picks again and the owner gets in");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await context();
    await go(page, "&as=stranger");
    await page.waitForSelector("#btn-gate-out:not([hidden])");
    check(await page.isHidden("#app") && await local(page, "pt-last-user") === null, "a Firebase session the allowlist refuses is not cached and sees the not-allowed screen");
    await ctx.close();
  }

  // 7. Drive consent skipped: step 2, locked across a reload, then Connect Google Drive.
  {
    const { ctx, page, problems } = await context({ dark: true });
    await go(page, "&signedout&nodrive");
    await signInFlow(page);
    await page.waitForSelector("#gate-step2:not([hidden])");
    check((await page.textContent("#gate-email")).trim() === "Signed in as bryce.evan.walls@gmail.com" && /Connect Google Drive/.test(await page.textContent("#btn-connect-drive")), "Drive unchecked: Signed in as {email} and Connect Google Drive");
    check(/Paper Trail needs Drive to file your scans\. Nothing uploads until it's connected\./.test(await page.textContent("#gate-note")), "with the step 2 footnote");
    await page.screenshot({ path: join(shots, "auth-connect-drive-390-dark.png") });
    await go(page);
    await page.waitForSelector("#gate-step2:not([hidden])");
    check(await page.isHidden("#app"), "the rest of the app stays locked after a reload");
    await Promise.all([page.waitForEvent("load"), page.click("#btn-connect-drive")]);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("#app:not([hidden])");
    const q = new URL((await fake(page)).authorizeUrls.at(-1)).searchParams;
    check(q.get("login_hint") === "bryce.evan.walls@gmail.com" && q.get("include_granted_scopes") === "true" && !q.get("scope").includes("profile") && q.get("scope").includes("drive.file"), "Connect asks for Drive only, for the same account");
    check(await local(page, "pt-drive-status") === '"connected"' && await local(page, "pt-drive-consent") === null, "and Drive is connected");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 8. Drive tokens: cached, one mint at a time.
  {
    const { ctx, page } = await context();
    await go(page);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(400);
    const r = await page.evaluate(async () => {
      const a = await import("/public/js/auth.js");
      const calls = () => window.__PT_FAKE__.calls.filter((c) => c.name === "driveToken").length;
      const before = calls();
      a.invalidateDriveToken();
      const tokens = await Promise.all([a.driveAccessToken(), a.driveAccessToken(), a.driveAccessToken()]);
      const afterThree = calls();
      await a.driveAccessToken();
      return { before, afterThree, afterCached: calls(), tokens };
    });
    check(r.tokens.every((t) => t === "fake-token") && r.afterThree - r.before === 1, "three callers at the same moment share one driveToken call");
    check(r.afterCached === r.afterThree, "the next caller gets the cached token");
    await ctx.close();
  }

  // 9. Reconnect Drive (4.16): only on the server's word, everywhere it shows, and back.
  {
    const { ctx, page, problems } = await context({ width: 1280, height: 900 });
    await go(page, "&driverevoked");
    await page.waitForSelector("#sort-body [data-reconnect-banner] .banner", { timeout: 15000 });
    check(true, "drive_revoked from the server shows the banner on Sort");
    check((await page.textContent("#outbox-accessory")).includes("Reconnect Drive to keep filing"), "the accessory shows its reconnect state");
    await page.click("[data-tab-link=piles]");
    await page.waitForFunction(() => location.hash === "#/piles" && !document.getElementById("view-piles").hidden);
    check(await page.isVisible("#piles-body [data-reconnect-banner] .banner"), "and Piles shows the banner too");
    await page.click("#view-piles [data-avatar]");
    await page.waitForSelector(".sheet[data-detent=large]");
    check((await page.textContent("#drive-state")).trim() === "Not connected" && /Reconnect to keep filing\. Your scans are safe on this phone\./.test(await page.textContent("#drive-sub")), "Settings: Not connected, with the reconnect subtitle");
    check(!(await page.evaluate(() => document.getElementById("drive-dot").classList.contains("on"))) && await page.isVisible("#btn-drive"), "a red dot and the Reconnect Drive row");
    await page.screenshot({ path: join(shots, "auth-settings-reconnect-desktop-light.png") });
    await Promise.all([page.waitForEvent("load"), page.click("#btn-drive")]);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("#app:not([hidden])");
    const q = new URL((await fake(page)).authorizeUrls.at(-1)).searchParams;
    check(q.get("login_hint") === "bryce.evan.walls@gmail.com" && q.get("prompt") === "consent" && !q.get("prompt").includes("select_account"), "Reconnect asks for Drive consent for the signed-in account");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => location.hash) === "#/piles", "and comes back to the screen it left");
    check(await page.isHidden("#piles-body [data-reconnect-banner] .banner") && !(await page.textContent("#outbox-accessory")).includes("Reconnect"), "the banner removes itself and the accessory clears, with no other message");
    check(await local(page, "pt-drive-status") === '"connected"', "Drive is connected again");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await context();
    await go(page, "&driverevoked&oauth=failed");
    await page.waitForSelector("#sort-body [data-reconnect-banner] [data-reconnect]");
    await Promise.all([page.waitForEvent("load"), page.click("#sort-body [data-reconnect]")]);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".banner-fail");
    check((await page.textContent(".banner-fail")).trim() === "Drive didn't reconnect. Try again in a minute.", "a failed reconnect says Drive didn't reconnect under the button");
    await ctx.close();
  }
  {
    const { ctx, page } = await context();
    await go(page, "&driverevoked&oauth=canceled");
    await page.waitForSelector("#sort-body [data-reconnect-banner] [data-reconnect]");
    await Promise.all([page.waitForEvent("load"), page.click("#sort-body [data-reconnect]")]);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("#sort-body [data-reconnect-banner] [data-reconnect]");
    check(!(await page.$(".banner-fail")) && await page.isEnabled("#sort-body [data-reconnect]"), "closing Google during Reconnect isn't a failure: the button stays, no message");
    await ctx.close();
  }
  {
    const { ctx, page } = await context();
    await go(page, "&driverevoked");
    await page.waitForSelector("#sort-body [data-reconnect]");
    await page.setInputFiles("#file", [{ name: "a.pdf", mimeType: "application/pdf", buffer: makePdf() }]);
    await page.click("#sort-body [data-reconnect]");
    await page.waitForSelector(".action-sheet");
    check(/Reconnecting opens Google and reloads Paper Trail\. 1 scan on this page hasn't been filed yet/.test(await page.textContent(".action-sheet")), "with scans still on the page (until #17), Reconnect says the reload loses them first");
    await page.click(".as-btn.cancel");
    check(await appShown(page) && (await fake(page)).authorizeUrls.length === 0, "and Cancel stays put");
    await ctx.close();
  }

  // 10. Both themes, phone and desktop: the sign-in screen and the Google button.
  for (const [w, h, dark] of [[390, 844, false], [390, 844, true], [1280, 900, false], [1280, 900, true]]) {
    const { ctx, page, problems } = await context({ width: w, height: h, dark });
    await go(page, "&signedout");
    await page.waitForSelector("#btn-signin:not([hidden])");
    const box = await page.evaluate(() => { const b = document.getElementById("btn-signin").getBoundingClientRect(); const c = getComputedStyle(document.getElementById("btn-signin")); return { w: b.width, h: b.height, bg: c.backgroundColor }; });
    check(box.h >= 52 && box.w >= Math.min(w, 480) - 32 - 1 && await overflow(page) <= 1, `${w}px ${dark ? "dark" : "light"}: the Google button is 52 tall and full width less 32, no sideways scroll`);
    check(dark ? box.bg === "rgb(19, 19, 20)" : box.bg === "rgb(255, 255, 255)", `${w}px ${dark ? "dark" : "light"}: Google's ${dark ? "dark" : "white"} button`);
    await page.screenshot({ path: join(shots, `auth-signin-${w}-${dark ? "dark" : "light"}.png`) });
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.log("FAIL the test stopped:", e.message.split("\n")[0]);
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall auth checks passed");
process.exit(failures ? 1 : 0);
