// browse.js: what Piles, Search and Paperless share (owner: browse; spec 4.5 to 4.7, #18, #22, #23).
// The web's FirestoreDocStore and PileFormat (ios/PaperTrail/Features/Piles):
//   - the live library: the docs, paperless and config/settings listeners, started with the session
//     and stopped at sign-out; onBrowse(fn) hears every change
//   - the safe-to-shred rule with the shred hold (docs/web-contract.md, "Safe to shred")
//   - the display strings the three screens share: folder names, breadcrumbs, short dates, months
//   - document rows: the labeled thumbnail, trailing swipe actions with their keyboard and menu twins
//   - the read-only document view pushed from Piles and Search (spec 4.13 read-only, "doc:<id>")
//   - the Reconnect Drive banner on Piles (spec 4.16)
import { YEAR_FOLDERS } from "./config.js";
import { $, esc, on, emit } from "./ui.js";
import { registerScreen, screens, push } from "./router.js";
import { watchDocs, watchPaperless, watchSettings } from "./store.js";
import * as Auth from "./auth.js";
import { icon } from "./ui/icons.js";
import { verdictBadge, sensitiveChip, section, row, banner, button, emptyState } from "./ui/components.js";
import { openMenu } from "./ui/menu.js";
import { toast } from "./ui/toast.js";

// ---------- the live library ----------
export const lib = { docs: [], paperless: [], settings: {}, docsLoaded: false, paperlessLoaded: false, failed: false, driveStatus: "unknown" };
const subs = new Set();
export function onBrowse(fn) { subs.add(fn); return () => subs.delete(fn); }
function changed() { for (const fn of [...subs]) { try { fn(lib); } catch (e) { console.error(e); } } }

let unwatch = [];
let tick = 0;
function stop() {
  unwatch.forEach((f) => { try { f(); } catch { /* already gone */ } });
  unwatch = [];
  clearInterval(tick);
}
export function startLibrary() {
  stop();
  lib.failed = false;
  const fail = () => { lib.failed = true; changed(); };
  unwatch.push(watchDocs((list) => { lib.docs = list; lib.docsLoaded = true; lib.failed = false; changed(); }, fail));
  unwatch.push(watchPaperless((list) => { lib.paperless = list; lib.paperlessLoaded = true; changed(); }, fail));
  unwatch.push(watchSettings((s) => {
    const before = lib.settings.shredHoldDays;
    lib.settings = s || {};
    if (before !== lib.settings.shredHoldDays) emit("settings:changed", { key: "shredHoldDays", value: holdDays() });
    changed();
  }, () => {}));
  // Holds end and check-back dates arrive while the page sits open.
  tick = setInterval(changed, 60000);
}
on("session:started", startLibrary);
on("session:ended", () => {
  stop();
  Object.assign(lib, { docs: [], paperless: [], settings: {}, docsLoaded: false, paperlessLoaded: false, failed: false, driveStatus: "unknown" });
  changed();
});
on("doc:verified", changed);
on("drive:status", (d) => { lib.driveStatus = d?.status || "unknown"; changed(); });

// The shred hold (config/settings.shredHoldDays), 3 days when it was never set.
export const holdDays = () => (Number.isInteger(lib.settings.shredHoldDays) ? lib.settings.shredHoldDays : 3);

// ---------- dates and names (PileFormat) ----------
const DAY = 86400000;
export const parseISO = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
// A card's docDate ("YYYY-MM-DD") as a local calendar day.
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
export const isoNow = () => new Date().toISOString();
// "Oct 9", with the year when it isn't this year: "Oct 9, 2024".
export function shortDay(d, now = new Date()) {
  if (!d) return "";
  const o = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) o.year = "numeric";
  return d.toLocaleDateString("en-US", o);
}
export const monthTitle = (d) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// Whole calendar days from now until d (0 when it's today or already past).
export const daysUntil = (d, now = new Date()) => Math.max(0, Math.round((startOfDay(d) - startOfDay(now)) / DAY));
export const days = (n) => (n === 1 ? "1 day" : `${n} days`);
// "02 Taxes" shows as "Taxes".
export const folderName = (f) => { const m = /^\d{2} (.+)$/.exec(String(f || "")); return m ? m[1] : String(f || ""); };
export function yearOf(doc) {
  const d = parseDay(doc.docDate) || parseISO(doc.filedAt);
  return d ? d.getFullYear() : null;
}
// "Taxes › 2025" for the three year folders (decision 2), otherwise just "Home".
export function breadcrumb(doc) {
  const name = folderName(doc.folder);
  const y = yearOf(doc);
  return YEAR_FOLDERS.includes(doc.folder) && y ? `${name} › ${y}` : name;
}

// ---------- safe to shred (#18; docs/web-contract.md, one rule for both apps) ----------
// Returns null when the doc isn't in the shred pile, else { kind: "safe" }, { kind: "checking" }
// (the Drive copy isn't verified yet) or { kind: "holding", until }.
//   - no source (pre-v2 web): safe as soon as it's logged
//   - a left swipe (filed: false): nothing to verify; safe once the hold has passed since filedAt
//   - anything else with a source: safe once verifiedAt is set and the hold has passed since it
export function shredState(doc, hold = holdDays(), now = Date.now()) {
  if (doc.physical !== "to_shred") return null;
  if (!doc.source) return { kind: "safe" };
  let base;
  if (doc.filed === false) base = parseISO(doc.filedAt);
  else { if (!doc.verifiedAt) return { kind: "checking" }; base = parseISO(doc.verifiedAt); }
  if (!hold || !base) return { kind: "safe" };
  const until = new Date(base.getTime() + hold * DAY);
  return until.getTime() <= now ? { kind: "safe" } : { kind: "holding", until };
}

// ---------- rows ----------
// The form name a row thumbnail prints (A5's "1099-INT", "W-2 2025"): a word with letters and
// digits, over the title's year when it has one. Plain titles draw lines only.
export function thumbLabel(doc) {
  const words = String(doc?.title || "").split(/[ ,]+/).filter(Boolean);
  const form = words.find((w) => /[a-z]/i.test(w) && /\d/.test(w) && w.length <= 8 && !/^\d{4}$/.test(w));
  if (!form) return "";
  const year = words.find((w) => /^\d{4}$/.test(w));
  return year ? `${form}\n${year}` : form;
}
export function thumb(doc) {
  const label = doc ? thumbLabel(doc) : "";
  return `<span class="doc-thumb b-thumb" aria-hidden="true">${label ? `<span class="b-thumb-label">${esc(label).replace("\n", "<br>")}</span>` : ""}<span class="b-thumb-lines"></span></span>`;
}

// A row with trailing swipe actions (spec 3.10). actions: [{ label, act, tone: "file" | "accent" | "gray" | "danger" }].
// The actions sit behind the row: a drag left shows them, a long drag runs the first one. Every
// action is also a real button (Tab to it and the row slides open) and in the row's context menu.
export function swipeRow(inner, actions = [], { key = "" } = {}) {
  if (!actions.length) return inner;
  return `<div class="b-swipe" data-swipe${key ? ` data-key="${esc(key)}"` : ""}>`
    + `<div class="b-swipe-actions">${actions.map((a) => `<button type="button" class="b-swipe-act tone-${esc(a.tone || "gray")}" data-swipe-act="${esc(a.act)}">${esc(a.label)}</button>`).join("")}</div>`
    + `<div class="b-swipe-content">${inner}</div></div>`;
}

// Wires every swipe row and context menu under root. onAct(act, swipeEl) runs an action;
// menuFor(rowEl) returns extra menu items for a row (Open in Drive).
export function bindRows(root, { onAct, menuFor } = {}) {
  let drag = null, suppressClick = false;
  const closeAll = (except) => root.querySelectorAll(".b-swipe.open").forEach((s) => { if (s !== except) setOffset(s, 0); });
  const width = (s) => s.querySelector(".b-swipe-actions").offsetWidth;
  function setOffset(s, x, animate = true) {
    const c = s.querySelector(".b-swipe-content");
    c.style.transition = animate ? "" : "none";
    c.style.transform = x ? `translateX(${x}px)` : "";
    s.classList.toggle("open", x < 0);
  }
  root.addEventListener("pointerdown", (e) => {
    const c = e.target.closest(".b-swipe-content");
    if (!c || e.button !== 0) return;
    const s = c.parentElement;
    drag = { s, x: e.clientX, y: e.clientY, start: s.classList.contains("open") ? -width(s) : 0, dx: 0, live: false, id: e.pointerId };
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.live) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8) return;
      drag.live = true; closeAll(drag.s); drag.s.classList.add("dragging");
      try { drag.s.querySelector(".b-swipe-content").setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    drag.dx = dx;
    const w = drag.s.offsetWidth;
    let x = Math.min(0, drag.start + dx);
    if (x < -w * 0.85) x = -w * 0.85;
    setOffset(drag.s, x, false);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.live) return;
    d.s.classList.remove("dragging");
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const x = Math.min(0, d.start + d.dx), w = width(d.s), full = d.s.offsetWidth;
    if (x < -full * 0.55) { setOffset(d.s, 0); onAct && onAct(d.s.querySelector("[data-swipe-act]").dataset.swipeAct, d.s); return; }
    setOffset(d.s, x < -w / 2 ? -w : 0);
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
  root.addEventListener("click", (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); return; }
    const a = e.target.closest("[data-swipe-act]");
    if (a) { e.stopPropagation(); const s = a.closest(".b-swipe"); setOffset(s, 0); onAct && onAct(a.dataset.swipeAct, s); return; }
    // A tap on an open row closes it instead of opening the document.
    const open = e.target.closest(".b-swipe.open");
    if (open) { e.stopPropagation(); e.preventDefault(); setOffset(open, 0); }
  }, true);
  // Tab onto a hidden action: slide the row open so the focused button shows.
  root.addEventListener("focusin", (e) => {
    const a = e.target.closest("[data-swipe-act]");
    if (a) { const s = a.closest(".b-swipe"); closeAll(s); setOffset(s, -width(s)); }
    else if (!e.target.closest(".b-swipe.open")) closeAll();
  });
  // Long press or right click: the row's actions and Open in Drive as a menu.
  root.addEventListener("contextmenu", (e) => {
    const r = e.target.closest(".list-row");
    if (!r || !root.contains(r)) return;
    const s = r.closest(".b-swipe");
    const items = [
      ...(s ? [...s.querySelectorAll("[data-swipe-act]")].map((b) => ({ label: b.textContent, action: () => onAct(b.dataset.swipeAct, s) })) : []),
      ...((menuFor && menuFor(r)) || []),
    ];
    if (!items.length) return;
    e.preventDefault();
    openMenu(r, items, { align: "end" });
  });
}

// The "Open in Drive" menu item for a row carrying data-drive-url.
export const driveMenu = (r) => (r.dataset.driveUrl ? [{ label: "Open in Drive", symbol: "arrow.up.forward", action: () => window.open(r.dataset.driveUrl, "_blank", "noopener") }] : []);

// Re-renders a container's HTML and puts focus back on the element that had it (by data-key).
export function rerender(el, html) {
  const active = document.activeElement;
  const inside = active && el.contains(active);
  const key = inside ? active.closest("[data-key]")?.dataset.key : null;
  const exact = !inside ? null : active.dataset.seg ? `[data-seg="${active.dataset.seg}"]` : active.dataset.swipeAct ? `[data-swipe-act="${active.dataset.swipeAct}"]` : active.dataset.chip ? `[data-chip="${CSS.escape(active.dataset.chip)}"]` : null;
  const y = scrollY;
  el.innerHTML = html;
  if (inside) {
    const host = key ? el.querySelector(`[data-key="${CSS.escape(key)}"]`) : exact ? el : null;
    const target = host && ((exact && host.querySelector(exact)) || (host.matches("button, a, input") ? host : host.querySelector("button, a, input")));
    if (target) target.focus({ preventScroll: true });
  }
  if (scrollY !== y) scrollTo(0, y);
}

export const saveFailed = () => toast("That didn't save. Check your connection and try again.");

// The listener failed before anything loaded (not in spec 3.11; worded like the iPhone app's).
export const loadFailedState = () => emptyState({ symbol: "exclamationmark.icloud.fill", title: "Couldn't load your documents",
  description: "Paper Trail couldn't reach your library. Check your connection, then try again.",
  actions: button("Try again", { "data-browse-retry": "" }) });

// ---------- Reconnect Drive (spec 3.9, 4.16): on Piles while the server has no Drive token ----------
// The banner is auth's (one banner everywhere, with its working and failed states); Piles mounts it
// again after every redraw.
export function placeReconnect(el) { if (typeof Auth.mountReconnectBanner === "function") Auth.mountReconnectBanner(el); }
document.addEventListener("click", (e) => { if (e.target.closest("[data-browse-retry]")) startLibrary(); });

// ---------- the read-only document view (spec 4.13 read-only; pushed as doc:<id>) ----------
// Deck's detail.js may register "doc" itself; when it hasn't, this one is registered the first time
// a document is opened, so the two never collide.
let docWords = [];
const ensureDocScreen = () => { if (!screens.has("doc")) registerScreen("doc", DOC_SCREEN); };
export function openDoc(id, words = []) {
  docWords = words;
  ensureDocScreen();
  push("doc", id);
}
// A reload or a link straight to #/<tab>/doc:<id> (this runs before the shell draws the route).
on("route:changed", (r) => { if (r.stack?.some((s) => s.screen === "doc")) ensureDocScreen(); });
const PAPER = { to_shred: "In the shred pile", keep: "To put away", stored: "In the binder" };
function paperText(doc) {
  if (doc.physical === "shredded") { const d = parseISO(doc.shreddedAt); return d ? `Shredded ${shortDay(d)}` : "Shredded"; }
  return PAPER[doc.physical] || "";
}
const kv = (title, value) => `<div class="list-row b-kv"><span class="row-text"><span class="row-title">${esc(title)}</span></span><span class="row-trailing"><span class="row-value">${esc(value)}</span></span></div>`;
// About 120 characters of the text around the first match, cut at word boundaries (SearchIndex.snippet).
export function snippet(text, words, before = 30, after = 90) {
  if (!text || !words.length) return null;
  const flat = String(text).replace(/\s+/g, " ");
  const low = flat.toLowerCase();
  let at = -1, len = 0;
  for (const w of words) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; } }
  if (at < 0) return null;
  let lo = Math.max(0, at - before), hi = Math.min(flat.length, at + len + after);
  if (lo > 0) { const sp = flat.indexOf(" ", lo); if (sp >= 0 && sp < at) lo = sp + 1; }
  if (hi < flat.length) { const sp = flat.lastIndexOf(" ", hi); if (sp > at + len) hi = sp; }
  let out = flat.slice(lo, hi).trim();
  if (lo > 0) out = "…" + out;
  if (hi < flat.length) out += "…";
  return out;
}
export function highlightWords(text, words) {
  const ws = words.filter(Boolean);
  if (!ws.length) return esc(text);
  const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return String(text ?? "").split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join("");
}
function docBody(doc) {
  if (!doc) return lib.docsLoaded ? emptyState({ symbol: "doc", title: "Document not found", description: "It may have been removed from your log." }) : emptyState({ spinner: true, title: "Loading" });
  const day = parseDay(doc.docDate);
  const snip = snippet(doc.fullText, docWords, 80, 240);
  return section(`<div class="list-row b-doc-head">${verdictBadge(doc.verdict, { size: "large" })}${doc.verdictReason ? `<p class="b-doc-why">Why: ${esc(doc.verdictReason)}</p>` : ""}</div>`)
    + (snip ? section(`<div class="list-row b-text"><span class="row-text"><span class="row-subtitle">${highlightWords(`“${snip}”`, docWords)}</span></span></div>`, { header: "Matching text" }) : "")
    + section(kv("Title", doc.title) + kv("Sender", doc.issuer) + kv("Date", day ? day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date") + kv("Type", doc.docType), { header: "Details" })
    + section(kv("Folder", breadcrumb(doc))
      + `<div class="list-row two-line"><span class="row-text"><span class="row-subtitle">Filename</span><span class="t-mono t-muted">${esc(doc.filename)}.pdf</span></span></div>`
      + kv("Paper", paperText(doc)), { header: "Filing" })
    + section((doc.summary ? `<div class="list-row two-line"><span class="row-text"><span class="row-title">${esc(doc.summary)}</span></span></div>` : "")
      + kv("Retention", doc.retention || "Not set")
      + (doc.sensitive ? row({ title: "Sensitive", trailing: sensitiveChip() }) : ""), { header: "About" });
}
const DOC_SCREEN = {
  title: (id) => lib.docs.find((d) => d.id === id)?.title || "Document",
  mount(el, { param, body, setTitle }) {
    const draw = () => {
      const doc = lib.docs.find((d) => d.id === param);
      if (doc) { setTitle(doc.title, null); document.title = `${doc.title} · Paper Trail`; }
      const trailing = el.querySelector(".nav-trailing");
      trailing.innerHTML = doc?.driveUrl
        ? `<button type="button" class="glass-circle small" data-share aria-label="Share">${icon("square.and.arrow.up")}</button><a class="nav-text-btn b-nav-link" href="${esc(doc.driveUrl)}" target="_blank" rel="noopener">Open in Drive</a>` : "";
      const share = trailing.querySelector("[data-share]");
      if (share) share.onclick = async () => {
        try {
          if (navigator.share) await navigator.share({ title: doc.title, url: doc.driveUrl });
          else { await navigator.clipboard.writeText(doc.driveUrl); toast("Drive link copied"); }
        } catch { /* closed the share sheet */ }
      };
      rerender(body, docBody(doc));
    };
    el._unsub = onBrowse(draw);
    draw();
  },
  unmount(el) { el._unsub && el._unsub(); el.querySelector(".nav-trailing").innerHTML = ""; },
};
