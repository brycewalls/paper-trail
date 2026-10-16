// shell.js: the app shell around every screen (spec 0, 1.1 and 4; ios RootView). Owner: shared (web
// foundation, #83). It owns:
//   - the four tabs and their views (#view-sort, #view-piles, #view-paperless, #view-search), shown
//     from the route; pushed screens rendered into #screen from the screens registry (router.js)
//   - the large-title nav bars: the compact title and glass bar appear once the large title scrolls
//   - the dock: the outbox accessory (drawn from "outbox:status") and the glass tab bar with its
//     search circle, which turns into the bottom search field on the Search tab
//   - the avatar (initials, opens Settings) and the Scan menu (every scan entry point, #79), which
//     asks capture for a source with emit("capture:request", { source })
//   - keyboard: 1 to 4 switch tabs, / opens Search, Escape goes back; arrows stay with the deck
//   - per-tab scroll positions, and safe areas for Home Screen use (css/shell.css)
// Features never touch these elements; they render into their view's .view-body, register pushed
// screens, and talk to the shell through the events in docs/web-contract.md.
import { $, on, emit } from "./ui.js";
import { TABS, TAB_TITLES, route, go, push, back, lastTab, replaceQuery, screens, startRouter } from "./router.js";
import { icon } from "./ui/icons.js";
import { navBar, emptyState, outboxAccessory, accessoryTitle, initialsOf } from "./ui/components.js";
import { APP_NAME } from "./config.js";
import { bindMenu, closeMenu } from "./ui/menu.js";
import { sheetOpen } from "./ui/sheet.js";
import { openSettings } from "./settings.js";

const TAB_ICON = { sort: "rectangle.stack", piles: "square.stack.3d.up", paperless: "leaf" };

// ---------- the Scan menu (spec 3.11: one ScanMenu for every entry point, no primaryAction) ----------
export const scanMenuItems = () => [
  { label: "Scan document", symbol: "doc.viewfinder", action: () => emit("capture:request", { source: "camera" }) },
  { label: "Import from Files", symbol: "folder", action: () => emit("capture:request", { source: "files" }) },
  { label: "Import from Photos", symbol: "photo", action: () => emit("capture:request", { source: "photos" }) },
];
export const bindScanMenu = (button) => bindMenu(button, scanMenuItems, { align: "end" });

// ---------- the outbox accessory ----------
let accState = { kind: "idle", filedToday: 0 };
const accHiders = new Set();
// A screen that owns the bottom edge (card detail's Shred and File bar) hides the accessory.
export function setAccessoryHidden(key, hidden) { if (hidden) accHiders.add(key); else accHiders.delete(key); renderDock(); }
function renderAccessory() {
  const el = $("outbox-accessory");
  el.innerHTML = outboxAccessory(accState);
  el.setAttribute("aria-label", "Outbox");
  el.setAttribute("aria-description", accessoryTitle(accState));
}

// ---------- the dock and the views ----------
let signedIn = false;
let focusSearch = false;   // "/" asks for the field once Search is showing
function renderDock() {
  const r = route();
  const dock = $("dock");
  const searching = r.isTab && r.tab === "search" && !r.stack.length;
  dock.classList.toggle("searching", searching);
  dock.classList.toggle("no-accessory", !signedIn || searching || r.top?.screen === "outbox" || accHiders.size > 0);
  $("search-close").hidden = !searching;
  $("searchfield").hidden = !searching;
  const tab = r.isTab ? r.tab : "sort";
  for (const a of document.querySelectorAll("[data-tab-link]")) a.setAttribute("aria-selected", String(a.dataset.tabLink === tab));
  // dock height drives the views' bottom padding and the toast's position
  requestAnimationFrame(() => { const h = Math.ceil(dock.getBoundingClientRect().height); $("app").style.setProperty("--dock-h", `${h}px`); });
}

const scrolls = new Map();
let shownKey = "";
let mounted = null;   // { name, el, def }

function render() {
  const r = route();
  const tab = r.isTab ? r.tab : "sort";
  const key = location.hash;
  if (shownKey) scrolls.set(shownKey, scrollY);
  closeMenu();

  const top = r.isTab ? r.top : null;
  const def = top && (screens.get(top.screen) || PLACEHOLDERS[top.screen]);
  // Unmount the previous pushed screen
  if (mounted && (!def || mounted.name !== top.screen || mounted.param !== top.param)) {
    try { mounted.def.unmount && mounted.def.unmount(mounted.el); } catch (e) { console.error(e); }
    mounted = null;
    $("screen").innerHTML = "";
  }
  for (const t of TABS) $(`view-${t}`).hidden = !!def || t !== tab;
  $("screen").hidden = !def;
  if (def && !mounted) {
    const prev = r.stack.length > 1 ? r.stack[r.stack.length - 2] : null;
    const prevDef = prev && (screens.get(prev.screen) || PLACEHOLDERS[prev.screen]);
    const backLabel = prevDef ? titleOf(prevDef, prev.param) : TAB_TITLES[tab];
    const el = $("screen");
    el.innerHTML = navBar({ title: titleOf(def, top.param), subtitle: "", back: { label: backLabel }, trailing: "" }) + '<div class="view-body"></div>';
    el.querySelector(".navbar").setAttribute("data-navbar", "");
    el.querySelector("[data-nav-back]").addEventListener("click", () => back());
    mounted = { name: top.screen, param: top.param, el, def };
    try { def.mount(el, { param: top.param, tab, query: r.query, body: el.querySelector(".view-body"), setTitle: (t, s) => setScreenTitle(el, t, s) }); }
    catch (e) { console.error(e); }
  }
  if (tab === "search" && !def) {
    const f = $("search-field");
    const q = r.query.get("q") || "";
    if (f.value !== q) f.value = q;
  }
  if (focusSearch && tab === "search") { focusSearch = false; $("searchfield").hidden = false; $("search-field").focus(); }
  renderDock();
  if (key !== shownKey) { scrollTo(0, scrolls.get(key) || 0); shownKey = key; }
  onScroll();
  document.title = def ? `${titleOf(def, top.param)} · ${APP_NAME}` : `${TAB_TITLES[tab]} · ${APP_NAME}`;
}
const titleOf = (def, param) => (typeof def.title === "function" ? def.title(param) : def.title || "");
function setScreenTitle(el, title, subtitle) {
  const t = el.querySelector(".nav-title"); if (t && title != null) t.textContent = title;
  const c = el.querySelector(".nav-compact"); if (c && title != null) c.textContent = title;
  const s = el.querySelector(".nav-subtitle"); if (s && subtitle != null) s.textContent = subtitle;
}

// Placeholders until a feature registers the real screen (the feature's registerScreen wins).
const PLACEHOLDERS = {
  outbox: { title: "Outbox", mount(el, { body }) { body.innerHTML = emptyState({ symbol: "tray", title: "Nothing in the outbox", description: "Filed documents upload from here." }); } },
};
function placeholderBodies() {
  if (!$("paperless-body").children.length) $("paperless-body").innerHTML = emptyState({ symbol: "leaf", title: "No senders yet", description: "When a scan comes from someone who offers paperless, they show up here." });
  if (!$("search-body").children.length) $("search-body").innerHTML = emptyState({ symbol: "magnifyingglass", title: "Search your documents", description: "Documents, senders and the text inside them." });
}

// ---------- large-title nav bars ----------
function onScroll() {
  const view = [...document.querySelectorAll(".view")].find((v) => !v.hidden);
  const nav = view && view.querySelector("[data-navbar]");
  if (!nav) return;
  const large = nav.querySelector(".nav-large");
  const bar = nav.querySelector(".nav-bar");
  if (!bar.offsetHeight) return;                  // not laid out yet (the app is still behind the gate)
  const scrolled = large ? scrollY > large.offsetTop + large.offsetHeight - bar.offsetHeight - 4 : scrollY > 0;
  nav.classList.toggle("scrolled", scrolled);
}

// ---------- session ----------
export function shellSignedIn(user) {
  signedIn = !!user;
  const initials = user ? initialsOf(user.name, user.email) : "";
  document.querySelectorAll("[data-avatar]").forEach((a) => { a.textContent = initials; });
  renderDock();
  requestAnimationFrame(onScroll);
}

export function startShell() {
  // Tabs keep their own stacks, so tab links go through the router instead of the raw href.
  document.querySelectorAll("[data-tab-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.tabLink); }));
  $("search-close").innerHTML = icon(TAB_ICON.sort);
  $("search-close").addEventListener("click", () => go(lastTab()));
  $("searchfield").addEventListener("submit", (e) => { e.preventDefault(); emit("search:submit", { q: $("search-field").value.trim() }); $("search-field").blur(); });
  let t = 0;
  $("search-field").addEventListener("input", () => {
    const q = $("search-field").value;
    emit("search:input", { q });
    clearTimeout(t); t = setTimeout(() => replaceQuery({ q: q.trim() }), 250);
  });
  $("outbox-accessory").addEventListener("click", () => push("outbox"));
  document.querySelectorAll("[data-avatar]").forEach((a) => a.addEventListener("click", () => openSettings()));
  document.querySelectorAll("[data-scan-menu]").forEach(bindScanMenu);
  on("outbox:status", (s) => { accState = s || accState; renderAccessory(); });
  on("route:changed", (r) => {
    render();
    if (r.isTab && r.tab === "search" && !r.stack.length) {
      $("search-close").innerHTML = icon(TAB_ICON[lastTab()] || TAB_ICON.sort);
    }
  });
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", renderDock);
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || sheetOpen() || $("app").hidden || !$("scanner").hidden) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) { if (e.key === "Escape" && e.target.id === "search-field") go(lastTab()); return; }
    if (/^[1-4]$/.test(e.key)) { go(TABS[Number(e.key) - 1]); e.preventDefault(); }
    else if (e.key === "/") { focusSearch = true; go("search"); e.preventDefault(); }
    else if (e.key === "Escape") { if (back()) e.preventDefault(); }
  });
  renderAccessory();
  placeholderBodies();
  startRouter();
}

export { push as pushScreen, go as goTab };
export const currentTabEl = () => $(`view-${route().isTab ? route().tab : "sort"}`);
