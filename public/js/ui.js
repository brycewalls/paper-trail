// ui.js: shared helpers every module may use. Leaf module: imports nothing.
//   DOM and text: $, esc, slug, cleanName, mb, errCode, reduceMotion
//   The status line under the deck and the save note under the piles: setStatus, setSaveNote
//   Per-device preferences (localStorage, safe in private mode): prefs
//   The event bus modules use to talk without importing each other: on, emit (see docs/web-contract.md)
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const slug = (s) => String(s || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "unknown";
export const cleanName = (s) => String(s || "").trim().replace(/\.pdf$/i, "").replace(/[\/\\:*?"<>|]/g, "-");
export const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
export const errCode = (e) => String((e && e.code) || "");
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function setSaveNote(msg) { const n = $("save-note"); if (n) n.textContent = msg || "Your log saves automatically."; }
export function setStatus(msg, err = false, spin = false) {
  const s = $("status");
  s.className = "status" + (err ? " err" : "");
  s.innerHTML = (spin ? '<span class="spin" aria-hidden="true"></span>' : "") + esc(msg);
}

export const prefs = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

// ---------- event bus ----------
// Synchronous: emit() runs every listener before it returns, in the order they subscribed, so an
// event behaves exactly like the direct call it replaces. Event names and payloads are listed in
// docs/web-contract.md; add a new one there before using it.
const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
  return () => { const l = listeners.get(type); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
}
export function emit(type, detail) {
  for (const fn of [...(listeners.get(type) || [])]) fn(detail);
}
