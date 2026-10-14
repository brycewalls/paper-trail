// auth.js: sign-in and the session's user. Owns the sign-in gate (#gate), the Sign in, Use a
// different account and Sign out buttons, the signed-in user, and the copy for Firebase Auth errors.
// It never stores the Drive token itself: a fresh token is announced with emit("auth:token") and
// drive.js keeps it. main.js decides what happens when the user changes (watchUser).
import { FIREBASE } from "./config.js";
import { $, esc, errCode, emit } from "./ui.js";
import { B } from "./backend.js";
import { pendingUploads } from "./items.js";

let user = null;
export const currentUser = () => user;

// Calls cb with { uid, email } or null on every auth change, after currentUser() is updated.
export function watchUser(cb) { B.onUser((u) => { user = u; cb(u); }); }

// The same account again, for a fresh Drive token. Resolves { uid, token }.
export function reauthenticate() { return B.reconnect(); }

// ---------- sign-in gate ----------
export function showGate(state, msg) {
  $("app").hidden = true;
  $("gate").hidden = false;
  const m = $("gate-msg");
  m.className = "gate-msg" + (state === "denied" || state === "error" ? " err" : "");
  m.innerHTML = state === "busy" ? `<span class="spin" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:8px"></span>${esc(msg)}` : esc(msg);
  $("btn-signin").hidden = state !== "signin" && state !== "error";
  $("gate-note").hidden = state !== "signin" && state !== "error";
  $("btn-gate-out").hidden = state !== "denied";
}
export function authMsg(e) {
  const c = errCode(e);
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request" || c === "auth/user-cancelled") return "Sign-in was closed before it finished.";
  if (c === "auth/operation-not-allowed" || c === "auth/configuration-not-found") return "Google sign-in isn't switched on for this project yet.";
  if (c === "auth/unauthorized-domain") return `This address can't sign in. Open ${FIREBASE.site}.`;
  if (c === "auth/network-request-failed") return "Google couldn't be reached. Check your connection and try again.";
  if (c === "auth/too-many-requests") return "Too many sign-in attempts in a row. Wait a minute and try again.";
  if (c === "auth/popup-blocked") return "The browser blocked the sign-in window. Allow pop-ups for this site and try again.";
  if (c === "auth/user-mismatch") return "That was a different Google account. Pick the one you signed in with.";
  return `Sign-in didn't finish (${c || "unknown"}). Try again.`;
}

$("btn-signin").addEventListener("click", async () => {
  showGate("busy", "Waiting for Google…");
  try {
    const r = await B.signIn();
    if (r.token) emit("auth:token", { token: r.token, uid: r.uid });
  } catch (e) {
    showGate("error", authMsg(e));
  }
});
$("btn-gate-out").addEventListener("click", () => B.signOut());
$("btn-signout").addEventListener("click", () => {
  if (pendingUploads() && !confirm("Uploads are still running. Sign out anyway?")) return;
  emit("auth:token", null); B.signOut();
});
