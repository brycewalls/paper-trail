// router.js: hash routing for the four tabs and the screens pushed onto them, the web's TabView with
// one NavigationStack per tab (ios/ARCHITECTURE.md, "Navigation"). Owner: shared (web foundation, #83).
//
// A route is a tab and the stack of screens pushed onto it:
//   #/sort                       the deck
//   #/sort/outbox                Outbox pushed from the accessory onto Sort
//   #/sort/outbox/earlier        and Earlier pushed onto that
//   #/piles/doc:Ab12             a document view pushed onto Piles (screen "doc", param "Ab12")
//   #/paperless/sender:duke-energy
//   #/search?q=w-2%202023        Search with its query
//   #/auth/done?handoff=...      not a tab: the web sign-in return (docs/web-contract.md, "Auth")
// Each tab remembers its own stack, so switching tabs and back lands where you were. Search's
// close button returns to the tab that was showing before it (lastTab()).
//
//   route()              -> { tab, stack: [{ screen, param }], query: URLSearchParams, top }
//   go(tab)              switch tab (restores that tab's stack)
//   push(screen, param)  push onto the current tab
//   back()               pop one screen; on a tab root, nothing
//   replaceQuery(obj)    update the query without a history entry (the search field)
//   registerScreen(name, { title, mount(el, ctx), unmount?(el) })   features own their screens
//   screens.get(name)
// Every change emits "route:changed" with route(). No feature reads location.hash itself.
import { emit } from "./ui.js";

export const TABS = ["sort", "piles", "paperless", "search"];
export const TAB_TITLES = { sort: "Sort", piles: "Piles", paperless: "Paperless", search: "Search" };
const DEFAULT = "sort";
const stacks = Object.fromEntries(TABS.map((t) => [t, `#/${t}`]));
let last = DEFAULT;          // the tab before the current one (Search's close goes back to it)
let cur = null;

export const screens = new Map();
export function registerScreen(name, def) {
  if (screens.has(name)) throw new Error(`Screen ${name} is already registered`);
  screens.set(name, def);
}

export function parse(hash = location.hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const tab = parts[0] || DEFAULT;
  const stack = parts.slice(1).map((p) => { const i = p.indexOf(":"); return i < 0 ? { screen: p, param: "" } : { screen: p.slice(0, i), param: p.slice(i + 1) }; });
  return { tab, stack, query: new URLSearchParams(qs), top: stack[stack.length - 1] || null, isTab: TABS.includes(tab) };
}
export function format({ tab, stack = [], query }) {
  const path = [tab, ...stack.map((s) => (s.param ? `${s.screen}:${s.param}` : s.screen))].map(encodeURIComponent).join("/");
  const qs = query && String(query) ? `?${query}` : "";
  return `#/${path}${qs}`;
}

export const route = () => cur || parse();
export const lastTab = () => last;

function set(hash, { replace = false } = {}) {
  if (hash === location.hash) { sync(); return; }
  if (replace) { history.replaceState(history.state, "", hash); sync(); }
  else location.hash = hash;   // hashchange calls sync()
}

export function go(tab) {
  if (!TABS.includes(tab)) return;
  const r = route();
  if (r.isTab && r.tab === tab) {
    // Tapping the selected tab pops it to its root, as iOS does.
    if (r.stack.length) set(format({ tab, query: r.query }));
    return;
  }
  set(stacks[tab]);
}
export function push(screen, param = "") {
  const r = route();
  const tab = r.isTab ? r.tab : DEFAULT;
  set(format({ tab, stack: [...(r.isTab ? r.stack : []), { screen, param }], query: r.query }));
}
export function back() {
  const r = route();
  if (!r.isTab || !r.stack.length) return false;
  set(format({ tab: r.tab, stack: r.stack.slice(0, -1), query: r.query }));
  return true;
}
export function replaceQuery(obj) {
  const r = route();
  const q = new URLSearchParams(r.query);
  for (const [k, v] of Object.entries(obj)) { if (v === "" || v == null) q.delete(k); else q.set(k, v); }
  set(format({ tab: r.tab, stack: r.stack, query: q }), { replace: true });
}

function sync() {
  const next = parse();
  if (next.isTab) {
    if (cur && cur.isTab && cur.tab !== next.tab) last = cur.tab === "search" ? last : cur.tab;
    stacks[next.tab] = location.hash || `#/${next.tab}`;
  }
  cur = next;
  emit("route:changed", cur);
}

export function startRouter() {
  addEventListener("hashchange", sync);
  if (!location.hash || location.hash === "#" || location.hash === "#/") history.replaceState(history.state, "", `#/${DEFAULT}`);
  sync();
}
