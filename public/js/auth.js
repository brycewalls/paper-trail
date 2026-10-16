// auth.js: the session, Google sign-in, and Drive tokens. Owner: auth (#14, #15, #3, #4).
// Contract: docs/web-contract.md, "Auth". The iPhone app's twin is ios/PaperTrail/Features/Auth/
// LiveAuthService.swift; both run the same server token flow (functions/oauth.js), so the same
// Google account gets the same uid and Drive stays connected without sign-in prompts.
//
//   On open (#14)   The last confirmed user is kept in localStorage (pt-last-user). At boot the app
//                   renders straight from it: no gate, no spinner. Firebase confirms in the
//                   background; only a confirmed "nobody" (or an allowlist refusal) shows sign-in.
//   Sign in (#15)   A full-page redirect to Google's code flow (no popups: they break in the Home
//                   Screen app). The verifier stays in sessionStorage; Google and the server only see
//                   its SHA-256 inside the state. oauthCallback sends web nonces back to
//                   #/auth/done?handoff=..., where finishReturn() redeems the handoff and signs in
//                   to Firebase with the ID token.
//   Drive           driveAccessToken() mints tokens from the driveToken callable, cached until a
//                   minute before expiry, one mint at a time. Drive shows as needing reconnecting
//                   only when the server says so (drive_revoked), never because one request failed.
//
// It also draws the sign-in screen (4.1, #gate) and the Reconnect Drive banners (3.9, 4.16).
// main.js decides what a sign-in or sign-out does across modules (watchUser).
import { DRIVE_SCOPE, OAUTH } from "./config.js";
import { $, esc, emit, on, errCode } from "./ui.js";
import { B } from "./backend.js";
import { items } from "./items.js";
import { banner, button } from "./ui/components.js";
import { actionSheet } from "./ui/sheet.js";

// ---------- copy (spec 4.1, 3.9, 3.12, 4.9, 4.16) ----------
export const AUTH_COPY = {
  didntFinish: "Sign-in didn't finish. Try again when you're ready.",
  notAllowed: "This account isn't on the list.",
  driveNote: "Paper Trail asks for Drive access so it can file your scans. It only sees the files it creates.",
  connectNote: "Paper Trail needs Drive to file your scans. Nothing uploads until it's connected.",
  reconnectFailed: "Drive didn't reconnect. Try again in a minute.",
  signOutQuestion: "Sign out of Paper Trail? Your scans stay on this phone until they upload.",
  bannerBold: "Drive needs reconnecting.",
  bannerText: "Your scans are safe on this phone and upload once it's back.",
};

// ---------- small storage helpers (private mode: memory only) ----------
const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const session = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export const KEYS = {
  lastUser: "pt-last-user",        // { uid, email, name }: the last confirmed, allowed account (#14)
  drive: "pt-drive-status",        // "connected" | "needsReconnect" (absent: unknown)
  consent: "pt-drive-consent",     // true while signed in without the Drive scope (4.1 step 2)
  token: "pt-drive-token",         // { token, uid, exp }: this tab's Drive access token
  oauth: "pt-oauth",               // { verifier, state, purpose, returnTo, email }: one attempt
  flash: "pt-auth-flash",          // { kind: "reconnectFailed" }: a message to show after the return
};

// ---------- the session ----------
// The user the app is showing: the cached one at boot, then Firebase's.
let user = local.get(KEYS.lastUser);
if (user && !user.uid) user = null;
export const currentUser = () => user;

let confirmed = false;          // Firebase has answered at least once
let returning = null;           // the #/auth/done redeem, while it runs
let returnPurpose = "";         // its purpose: signIn, connect or reconnect
let gateState = { step: "pending" };
const userCbs = [];

// cb(user, { confirmed }) with the account to show, or null when the sign-in screen is up.
// The first call can come synchronously from the cache (confirmed: false), before Firebase answers.
export function watchUser(cb) { userCbs.push(cb); }
function tell(u) { for (const cb of userCbs) cb(u, { confirmed }); }

function remember(u) {
  user = u ? { uid: u.uid, email: u.email || "", name: u.name || "" } : null;
  local.set(KEYS.lastUser, user);
}

// Start listening. Renders from the cache at once when there is one (#14).
export function startAuth() {
  mountReconnectBanner(document.getElementById("sort-body"));
  mountReconnectBanner(document.getElementById("piles-body"));
  const signingIn = returning && returnPurpose === "signIn";
  if (signingIn) showGate("busy");
  else if (user && consentPending()) showGate("drive", { email: user.email, busy: !!returning });
  else if (user) { hideGate(); tell(user); }
  else if (returning) showGate("busy");
  else showGate("pending");
  B.onUser((u) => {
    confirmed = true;
    if (!u) {
      if (returning && returnPurpose === "signIn") return;   // Firebase's first answer before the redeem signs in
      clearSession();
      // Keep a not-allowed screen or a failure message the return already put up.
      if (!["signin", "notAllowed"].includes(gateState.step) || gateState.busy) showGate("signin");
      tell(null);
      return;
    }
    const next = { uid: u.uid, email: u.email || "", name: u.name || (user && user.uid === u.uid ? user.name : "") };
    if (!user || user.uid !== next.uid) dropToken();
    remember(next);
    if (returning && returnPurpose === "signIn") return;     // redeemReturn() shows the app when it's done
    if (consentPending()) { showGate("drive", { email: next.email, busy: !!returning }); tell(null); return; }
    hideGate();
    tell(user);
    refreshDriveStatus();
  });
  // The sign-in return, after the first screen is chosen: it may put up its own message at once.
  if (pendingReturn) {
    const { q, saved } = pendingReturn;
    pendingReturn = null;
    returning = redeemReturn(q, saved).catch((e) => { console.warn("Sign-in return", e); showGate("signin", { message: AUTH_COPY.didntFinish }); })
      .finally(() => { returning = null; });
  }
}

// main.js: the allowlist probe said no (permission-denied). Spec 4.1, not allowed.
export function markNotAllowed(email) {
  const e = email || user?.email || "";
  remember(null);
  dropToken();
  showGate("notAllowed", { email: e });
  tell(null);
}

function clearSession() {
  remember(null);
  dropToken();
  setDrive("unknown", false);
}

// ---------- sign out (4.9, Account) ----------
// Asks first. Server tokens stay, so the iPhone app keeps working. Resolves true when signed out.
export async function signOut({ confirm = true } = {}) {
  if (confirm) {
    const unsent = unsentScans();
    const message = unsent ? `${unsent} ${unsent === 1 ? "scan on this page hasn't" : "scans on this page haven't"} been filed yet. Until the outbox keeps them on this device, signing out loses ${unsent === 1 ? "it" : "them"}.` : "";
    const choice = await actionSheet({ title: AUTH_COPY.signOutQuestion, message, actions: [{ label: "Sign out", value: "out", destructive: true }] });
    if (choice !== "out") return false;
  }
  clearSession();
  try { await B.signOut(); } catch (e) { console.warn("Sign out", e); }
  showGate("signin");
  tell(null);
  return true;
}

// Legacy deck items live in memory until the outbox moves them into IndexedDB (#17). A full-page
// redirect or a sign-out loses them, so those two actions say so first.
const unsentScans = () => items.filter((i) => i.status !== "done").length;

// ---------- Drive status and tokens ----------
export class DriveAuthError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

let drive = local.get(KEYS.drive) || "unknown";
export const driveStatus = () => drive;
export const consentPending = () => local.get(KEYS.consent) === true;
function setDrive(status, consent) {
  const was = drive;
  drive = status;
  local.set(KEYS.drive, status === "unknown" ? null : status);
  if (consent !== undefined) local.set(KEYS.consent, consent ? true : null);
  if (was !== status) emit("drive:status", { status });
  renderReconnect();
}

let tok = session.get(KEYS.token);
let minting = null;
function cacheToken(token, expiresIn) {
  if (!token || !(expiresIn > 0) || !user) return;
  tok = { token, uid: user.uid, exp: Date.now() + expiresIn * 1000 };
  session.set(KEYS.token, tok);
}
function dropToken() { tok = null; minting = null; session.set(KEYS.token, null); }
// Drive answered 401 with this token: forget it so the next call mints a fresh one.
export function invalidateDriveToken() { dropToken(); }

// A Drive access token. Cached until a minute before it expires; callers at the same moment share
// one mint. Throws DriveAuthError("drive_revoked") when Drive needs reconnecting (and flips the
// status), ("drive_unavailable") when Google or the network didn't answer (retryable),
// ("signed_out") with nobody signed in. Never prompts.
export async function driveAccessToken() {
  if (!user) throw new DriveAuthError("signed_out");
  if (tok && tok.uid === user.uid && tok.exp - Date.now() > 60000) return tok.token;
  if (minting) return minting;
  const uid = user.uid;
  minting = (async () => {
    let r;
    try { r = await B.call("driveToken"); }
    catch (e) {
      const code = e?.details?.code || "";
      if (!user || user.uid !== uid) throw new DriveAuthError("signed_out");
      if (code === "drive_revoked") { dropToken(); setDrive("needsReconnect"); throw new DriveAuthError("drive_revoked", e.message); }
      if (code === "signed_out" || errCode(e) === "functions/unauthenticated") throw new DriveAuthError("signed_out", e.message);
      throw new DriveAuthError("drive_unavailable", e?.message);
    }
    if (!user || user.uid !== uid) throw new DriveAuthError("signed_out");   // signed out while minting
    cacheToken(r.accessToken, Number(r.expiresIn) || 3600);
    if (drive !== "connected") setDrive("connected", false);
    return r.accessToken;
  })();
  try { return await minting; } finally { minting = null; }
}

// After launch: ask once, so a revoked token shows Reconnect Drive. Errors change nothing else.
function refreshDriveStatus() {
  if (!user || consentPending()) return;
  driveAccessToken().catch(() => {});
}

// ---------- the OAuth code flow (web redirect variant) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function challengeFor(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
// The web nonce: "web_" plus 24 random bytes (32 characters). The iPhone app's are always 22
// characters, which is how oauthCallback knows to send this one back to the web.
export const webNonce = () => `web_${randomToken(24)}`;

// purpose: "signIn" (pick the account, consent to everything), "connect" (4.1 step 2) or
// "reconnect" (4.16): Drive only, for the signed-in account.
export async function authorizationUrl(purpose, { email = "" } = {}) {
  const verifier = randomToken(32);
  const state = `${webNonce()}.${await challengeFor(verifier)}`;
  const returnTo = /^#\/auth\//.test(location.hash) ? "#/sort" : (location.hash || "#/sort");
  session.set(KEYS.oauth, { verifier, state, purpose, returnTo, email });
  const q = new URLSearchParams({ client_id: OAUTH.clientId, redirect_uri: OAUTH.redirectUri, response_type: "code", access_type: "offline", state });
  if (purpose === "signIn") {
    q.set("scope", ["openid", "email", "profile", DRIVE_SCOPE].join(" "));
    q.set("prompt", "select_account consent");
  } else {
    q.set("scope", ["openid", "email", DRIVE_SCOPE].join(" "));
    q.set("prompt", "consent");
    q.set("include_granted_scopes", "true");
    if (email) q.set("login_hint", email);
  }
  return `${OAUTH.authorizationEndpoint}?${q}`;
}

async function startFlow(purpose) {
  const url = await authorizationUrl(purpose, { email: purpose === "signIn" ? "" : user?.email || "" });
  session.set(KEYS.flash, null);
  B.authorize(url);
}

export async function signIn() {
  if (gateState.busy) return;
  showGate("signin", { busy: true });
  await beginSignIn();
}
async function beginSignIn() {
  try { await startFlow("signIn"); }
  catch (e) { console.warn("Sign in", e); showGate("signin", { message: AUTH_COPY.didntFinish }); }
}

// "Use another account" (not allowed): drop that account and pick another.
async function useAnotherAccount() {
  try { await B.signOut(); } catch { /* not signed in to Firebase */ }
  remember(null);
  await beginSignIn();
}

// Spec 4.16: Google consent for the Drive scope only. A full-page redirect; the page comes back
// through #/auth/done and finishReturn() takes it from there.
let reconnecting = false;
export const reconnectBusy = () => reconnecting;
export async function reconnectDrive() {
  if (reconnecting || !user) return false;
  const unsent = unsentScans();
  if (unsent) {
    const choice = await actionSheet({
      title: "Reconnect Drive?",
      message: `Reconnecting opens Google and reloads Paper Trail. ${unsent} ${unsent === 1 ? "scan on this page hasn't" : "scans on this page haven't"} been filed yet and would need scanning again.`,
      actions: [{ label: "Reconnect Drive", value: "go" }],
    });
    if (choice !== "go") return false;
  }
  reconnecting = true;
  session.set(KEYS.flash, null);
  renderReconnect();
  try { await startFlow(consentPending() ? "connect" : "reconnect"); return true; }
  catch (e) {
    console.warn("Reconnect Drive", e);
    reconnecting = false;
    session.set(KEYS.flash, { kind: "reconnectFailed" });
    renderReconnect();
    return false;
  }
}
export const reconnectFailed = () => session.get(KEYS.flash)?.kind === "reconnectFailed";

// The return from Google: #/auth/done?handoff=...&state=... (or ?error=canceled|not_allowed|failed).
// Called by main.js before the backend loads and before the router starts. It replaces the URL with
// where the person was (no history entry) at once; startAuth() then redeems in the background.
// Returns true when it took the URL.
let pendingReturn = null;
export function finishReturn() {
  const m = location.hash.match(/^#\/auth\/done(?:\?(.*))?$/);
  if (!m) return false;
  const q = new URLSearchParams(m[1] || "");
  const saved = session.get(KEYS.oauth);
  session.set(KEYS.oauth, null);
  returnPurpose = saved?.purpose || "signIn";
  history.replaceState(history.state, "", `${location.pathname}${location.search}${saved?.returnTo || "#/sort"}`);
  pendingReturn = { q, saved };
  returning = Promise.resolve();      // so startAuth knows a return is on its way
  return true;
}
// The user to render from before Firebase answers (#14): the cached one, unless a sign-in return
// is being redeemed or Drive consent is still missing.
export const cachedSession = () => (user && !consentPending() && !(returning && returnPurpose !== "reconnect") ? user : null);

async function redeemReturn(q, saved) {
  const purpose = saved?.purpose || "signIn";
  const failed = () => {
    if (purpose === "reconnect") { session.set(KEYS.flash, { kind: "reconnectFailed" }); afterReturn(); }
    else if (purpose === "connect") { showGate("drive", { email: user?.email || "", message: AUTH_COPY.didntFinish }); }
    else showGate("signin", { message: AUTH_COPY.didntFinish });
  };
  if (!saved || !saved.state || q.get("state") !== saved.state) return failed();   // not our attempt
  const error = q.get("error");
  // Spec 3.12: a canceled or failed sign-in says so under the button. Closing Google during
  // Reconnect Drive isn't a failure (the button stays, no message), as on the iPhone.
  if (error === "canceled" && purpose === "reconnect") return afterReturn();
  if (error === "not_allowed") { remember(null); showGate("notAllowed", { email: q.get("email") || "" }); return; }
  if (error || !q.get("handoff")) return failed();
  let r;
  try { r = await B.redeem({ handoff: q.get("handoff"), state: saved.state, verifier: saved.verifier }); }
  catch (e) { console.warn("Redeem", e); return failed(); }
  const email = String(r.email || "").toLowerCase();

  if (purpose !== "signIn") {
    // Reconnect (or step 2): the same account, and this time with Drive.
    if (user && email && email !== String(user.email || "").toLowerCase()) return failed();
    if (!r.driveConnected) return failed();
    cacheToken(r.accessToken, Number(r.expiresIn) || 0);
    setDrive("connected", false);
    if (purpose === "connect") { if (confirmed && user) { hideGate(); tell(user); } return; }
    return afterReturn();
  }

  let u;
  try { u = await B.signInWithTokens({ idToken: r.idToken, accessToken: r.accessToken }); }
  catch (e) { console.warn("Firebase sign-in", e); return failed(); }
  if (user && user.uid !== u.uid) dropToken();
  remember({ uid: u.uid, email: u.email || r.email || "", name: u.name || r.name || "" });
  confirmed = true;
  if (r.driveConnected) { cacheToken(r.accessToken, Number(r.expiresIn) || 0); setDrive("connected", false); }
  else { setDrive("needsReconnect", true); showGate("drive", { email: user.email }); tell(null); return; }
  hideGate();
  tell(user);
}

function afterReturn() {
  reconnecting = false;
  renderReconnect();
}

// ---------- 4.1 the sign-in screen ----------
// step: pending (Firebase hasn't answered, no cache: the screen with no buttons), signin, busy (the
// return is being redeemed), drive (step 2: Connect Google Drive), notAllowed.
export function showGate(step, opts = {}) {
  gateState = { step, ...opts };
  $("app").hidden = true;
  $("gate").hidden = false;
  const busy = step === "busy" || !!opts.busy;
  const msg = $("gate-msg");
  msg.className = "gate-msg err";
  msg.textContent = step === "notAllowed" ? AUTH_COPY.notAllowed : "";
  const signin = $("btn-signin");
  signin.hidden = !(step === "signin" || step === "busy");
  signin.disabled = busy;
  signin.setAttribute("aria-busy", String(busy));
  signin.querySelector(".g-label").hidden = busy && step !== "notAllowed";
  signin.querySelector(".spinner").hidden = !(busy && step !== "notAllowed");
  const other = $("btn-gate-out");
  other.hidden = step !== "notAllowed";
  other.disabled = busy;
  other.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span>' : "<span>Use another account</span>";
  other.setAttribute("aria-label", "Use another account");
  $("gate-step2").hidden = step !== "drive";
  $("gate-email").textContent = step === "drive" ? `Signed in as ${opts.email || ""}` : "";
  const connect = $("btn-connect-drive");
  connect.disabled = busy;
  connect.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span><span>Connect Google Drive</span>' : "<span>Connect Google Drive</span>";
  const err = $("gate-err");
  err.textContent = opts.message || "";
  const note = $("gate-note");
  note.hidden = !(step === "signin" || step === "busy" || step === "drive");
  note.textContent = step === "drive" ? AUTH_COPY.connectNote : AUTH_COPY.driveNote;
  document.body.dataset.gate = step;
}
export function hideGate() {
  gateState = { step: "in" };
  delete document.body.dataset.gate;
  $("gate").hidden = true;
}
export const gateStep = () => gateState.step;

$("btn-signin").addEventListener("click", () => signIn());
$("btn-gate-out").addEventListener("click", () => {
  if (gateState.busy) return;
  showGate("notAllowed", { ...gateState, busy: true });
  useAnotherAccount();
});
$("btn-connect-drive").addEventListener("click", async () => {
  if (gateState.busy) return;
  showGate("drive", { email: gateState.email, busy: true });
  try { await startFlow("connect"); }
  catch { showGate("drive", { email: gateState.email, message: AUTH_COPY.didntFinish }); }
});

// ---------- 3.9 / 4.16 the Reconnect Drive banner ----------
// mountReconnectBanner(host) puts a live banner at the top of host (Sort, Outbox, Piles). It shows
// only while the server says Drive needs reconnecting, and removes itself when Drive is back.
// Owners that redraw their screen call it again after; calling it twice on one host is harmless.
const banners = new Set();
export function mountReconnectBanner(host, { inset = true } = {}) {
  if (!host) return () => {};
  let el = host.querySelector(":scope > [data-reconnect-banner]");
  if (!el) {
    el = document.createElement("div");
    el.dataset.reconnectBanner = "";
    host.prepend(el);
  }
  el.classList.toggle("banner-inset", inset);
  banners.add(el);
  drawBanner(el);
  return () => { banners.delete(el); el.remove(); };
}
function drawBanner(el) {
  const show = drive === "needsReconnect" && !!user;
  el.hidden = !show;
  if (!show) { el.innerHTML = ""; return; }
  const working = reconnecting;
  el.innerHTML = banner({ kind: "reconnect", bold: AUTH_COPY.bannerBold, text: AUTH_COPY.bannerText,
    actions: button("Reconnect Drive", { small: true, "data-reconnect": "", disabled: working, "aria-busy": working ? "true" : undefined })
      + (working ? '<span class="spinner" aria-hidden="true"></span>' : "")
      + (reconnectFailed() ? `<p class="banner-fail">${esc(AUTH_COPY.reconnectFailed)}</p>` : "") });
  el.querySelector("[data-reconnect]").addEventListener("click", () => reconnectDrive());
}
// Settings and anything else that draws a Reconnect Drive control redraws through this: the
// status, the button's working state and the failure line.
const drawers = new Set();
export function watchDriveUi(fn) { drawers.add(fn); return () => drawers.delete(fn); }
export function renderReconnect() {
  for (const el of banners) { if (el.isConnected) drawBanner(el); else banners.delete(el); }
  for (const fn of drawers) { try { fn(); } catch (e) { console.error(e); } }
}
on("session:started", renderReconnect);
on("session:ended", renderReconnect);
