// search.js: Search (spec 4.6, A6; owner: browse; #22). The search circle opens the bottom field
// (the shell's #search-field); this module draws #search-body: the filter chips, Recent and
// Suggested before typing, then instant results over the fields and the full text (debounced
// 250 ms) with the matches highlighted and a snippet, and "Also in Drive" from Drive's own
// full-text search. Tapping a result opens the document view, with Open in Drive. Closing Search
// goes back to the tab you came from (the shell, #61). The counterpart of
// ios/PaperTrail/Features/Search (SearchIndex, SearchViewModel, SearchScreen).
import { DRIVE_API } from "./config.js";
import { $, esc, on, prefs } from "./ui.js";
import { route, replaceQuery } from "./router.js";
import { getDriveConfig } from "./store.js";
import * as Drive from "./drive.js";
import { lib, onBrowse, folderName, yearOf, breadcrumb, thumb, swipeRow, bindRows, driveMenu, rerender, snippet, highlightWords, openDoc, loadFailedState } from "./browse.js";
import { icon } from "./ui/icons.js";
import { section, row, filterChip, emptyState } from "./ui/components.js";

// ---------- the index (SearchIndex) ----------
// Lowercased words, split on spaces and the punctuation around them; hyphens and dots inside a word
// stay ("w-2", "142.17").
export const words = (text) => String(text || "").toLowerCase().split(/[\s,;()]+/)
  .map((w) => w.replace(/^[.:"'!?·›“”]+|[.:"'!?·›“”]+$/g, "")).filter(Boolean);
// Four-digit years in the query (1900 to 2100). Typing one turns its chip on.
export const yearsIn = (q) => words(q).filter((w) => /^\d{4}$/.test(w) && +w >= 1900 && +w <= 2100).map(Number);
// Known document types the query names in full.
export function typesIn(q, known) {
  const s = ` ${words(q).join(" ")} `;
  return known.filter((t) => { const w = words(t).join(" "); return w && s.includes(` ${w} `); });
}
export function haystack(d) {
  const y = yearOf(d);
  return [d.title, d.issuer, d.docType, folderName(d.folder), d.docDate, y ? String(y) : "", d.amount || "", ...(d.searchTerms || []), d.fullText || ""]
    .join(" \n ").toLowerCase();
}
// filters: Set of keys "type:W-2", "year:2023", "sensitive", "keep".
export function passes(d, filters) {
  const types = [...filters].filter((f) => f.startsWith("type:")).map((f) => f.slice(5));
  const years = [...filters].filter((f) => f.startsWith("year:")).map((f) => Number(f.slice(5)));
  if (types.length && !types.includes(d.docType)) return false;
  // A 2023 W-2 is dated January 2024, so a year also matches the year written on the doc.
  if (years.length) { const y = yearOf(d), text = haystack(d); if (!years.some((x) => x === y || text.includes(String(x)))) return false; }
  if (filters.has("sensitive") && !d.sensitive) return false;
  if (filters.has("keep") && d.verdict !== "keep_original") return false;
  return true;
}
// Every word must match somewhere. Title matches rank first, then sender, then type and folder,
// then the text; ties go to the newest filing.
export function searchDocs(docs, query, filters) {
  const qw = words(query);
  if (!qw.length && !filters.size) return [];
  const hits = [];
  for (const d of docs) {
    if (!passes(d, filters)) continue;
    const text = haystack(d);
    if (!qw.every((w) => text.includes(w))) continue;
    const title = String(d.title || "").toLowerCase(), issuer = String(d.issuer || "").toLowerCase(), meta = `${d.docType || ""} ${d.folder || ""}`.toLowerCase();
    let score = 0;
    for (const w of qw) score += title.includes(w) ? 3 : issuer.includes(w) ? 2 : meta.includes(w) ? 1 : 0;
    hits.push({ doc: d, score, snippet: snippet(d.fullText, qw) });
  }
  return hits.sort((a, b) => b.score - a.score || String(b.doc.filedAt).localeCompare(String(a.doc.filedAt)));
}

// ---------- state (SearchViewModel) ----------
const RECENTS = "pt-recent-searches", RECENTS_MAX = 8;
const st = { query: "", searched: "", picked: new Set(), hits: [], driveHits: [], pending: false, recents: readRecents() };
function readRecents() { try { const r = JSON.parse(prefs.get(RECENTS) || "[]"); return Array.isArray(r) ? r.filter((x) => typeof x === "string") : []; } catch { return []; } }
const saveRecents = () => prefs.set(RECENTS, JSON.stringify(st.recents));

// Types present in the library, most common first.
function knownTypes() {
  const n = new Map();
  for (const d of lib.docs) if (d.docType) n.set(d.docType, (n.get(d.docType) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
const typedFilters = () => new Set([...yearsIn(st.query).map((y) => `year:${y}`), ...typesIn(st.query, knownTypes()).map((t) => `type:${t}`)]);
const activeFilters = () => new Set([...st.picked, ...typedFilters()]);
const chipTitle = (k) => (k === "sensitive" ? "Sensitive" : k === "keep" ? "Keep originals" : k.slice(5));
// The chip row: the two most common types, years typed or picked plus the two newest in the library,
// then Sensitive and Keep originals. Chips that are on never drop out of the row.
function chips() {
  const out = [], add = (k) => { if (!out.includes(k)) out.push(k); };
  const active = [...activeFilters()].sort();
  knownTypes().slice(0, 2).forEach((t) => add(`type:${t}`));
  active.filter((k) => k.startsWith("type:")).forEach(add);
  active.filter((k) => k.startsWith("year:")).forEach(add);
  [...new Set(lib.docs.map(yearOf).filter(Boolean))].sort((a, b) => b - a).slice(0, 2).forEach((y) => add(`year:${y}`));
  add("sensitive"); add("keep");
  return out;
}
// The three most common senders, for Suggested.
function suggested() {
  const n = new Map();
  for (const d of lib.docs) if (d.issuer) n.set(d.issuer, (n.get(d.issuer) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([s]) => s);
}
const isSearching = () => words(st.searched).length > 0 || activeFilters().size > 0;
const refreshLocal = () => { st.hits = searchDocs(lib.docs, st.searched, activeFilters()); };

let timer = 0, runId = 0;
function schedule() { clearTimeout(timer); st.pending = true; timer = setTimeout(runSearch, 250); }
export async function runSearch() {
  clearTimeout(timer);
  st.searched = st.query;
  st.pending = false;
  refreshLocal();
  const text = st.query.trim();
  const id = ++runId;
  if (!text) st.driveHits = [];
  render();
  if (!text) return;
  const found = await driveSearch(text);
  if (id !== runId) return;
  const known = new Set(lib.docs.map((d) => d.driveId).filter(Boolean));
  st.driveHits = found.filter((f) => !known.has(f.id));
  render();
}

// "Also in Drive" (#22, the hidden text layer): Drive's full-text search inside the archive. Uses
// drive.search() once outbox adds it (docs/web-contract.md), the Drive REST call through drive()
// until then. No Drive token, or any failure: no Drive results, nothing else changes.
let folderNames = null;
async function driveSearch(text) {
  try {
    if (typeof Drive.currentToken === "function" && !Drive.currentToken()) return [];
    let files;
    if (typeof Drive.search === "function") files = await Drive.search(text);
    else {
      const q = `fullText contains '${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
      const r = await Drive.drive(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,parents,webViewLink)")}&pageSize=20&spaces=drive`);
      files = (await r.json()).files || [];
    }
    if (!folderNames) {
      const cfg = await getDriveConfig().catch(() => null);
      folderNames = new Map(Object.entries(cfg?.folders || {}).map(([name, fid]) => [fid, name]));
    }
    return (files || []).map((f) => ({ ...f, folder: folderNames.get(f.parents?.[0]) || "" }));
  } catch { return []; }
}

export function remember(text = st.query) {
  const q = String(text || "").trim();
  if (!q) return;
  st.recents = [q, ...st.recents.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENTS_MAX);
  saveRecents();
}
// Recents and Suggested run straight away, and the field shows the text.
function use(text) {
  st.query = text;
  replaceQuery({ q: text });
  runSearch();
}

// ---------- rendering ----------
function resultRow(h, hw) {
  const d = h.doc;
  const meta = esc([d.issuer, breadcrumb(d)].filter(Boolean).join(" · "));
  const snip = h.snippet ? `<span class="b-snippet">${highlightWords(`“${h.snippet}”`, hw)}</span>` : "";
  return row({ tag: "button", leading: thumb(d), titleHtml: highlightWords(d.title || "Untitled", hw), subtitleHtml: meta + snip,
    "data-result": d.id, "data-key": `r-${d.id}`, "data-drive-url": d.driveUrl || undefined });
}
function driveRow(f, hw) {
  return row({ tag: "a", href: f.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view`, target: "_blank", rel: "noopener",
    leading: thumb(null), titleHtml: highlightWords(f.name, hw), subtitle: f.folder ? `In Drive · ${folderName(f.folder)}` : "In Drive",
    trailing: `<span class="b-out">${icon("arrow.up.forward")}</span>`, "data-drive-hit": f.id, "data-key": `dh-${f.id}`, "aria-description": "Opens in Drive" });
}
export function render() {
  const body = $("search-body");
  if (!body) return;
  if (lib.failed && !lib.docsLoaded) { rerender(body, loadFailedState()); return; }
  const active = activeFilters();
  const hw = words(st.searched);
  let h = `<div class="b-chipwrap"><div class="chips scroll b-chips" role="group" aria-label="Filters">${chips().map((k) => filterChip(chipTitle(k), { on: active.has(k), "data-chip": k })).join("")}</div></div>`;
  if (isSearching()) {
    if (st.hits.length) h += section(st.hits.map((x) => resultRow(x, hw)).join(""), { header: st.hits.length === 1 ? "1 result" : `${st.hits.length} results`, "data-section": "results" });
    if (st.driveHits.length) h += section(st.driveHits.map((f) => driveRow(f, hw)).join(""), { header: "Also in Drive", "data-section": "drive" });
    if (!st.hits.length && !st.driveHits.length && !st.pending) {
      const q = st.searched.trim();
      h += emptyState({ symbol: "magnifyingglass", title: q ? `No Results for “${q}”` : "No Results", description: "Check the spelling or try a new search.", "data-no-results": "" });
    }
  } else {
    if (st.recents.length) h += section(st.recents.map((r, i) => swipeRow(row({ tag: "button", leading: icon("clock"), title: r, "data-recent": r, "data-key": `rc-${i}` }),
      [{ label: "Remove", act: "remove", tone: "danger" }], { key: `rcs-${r}` })).join(""), { header: "Recent", "data-section": "recent" });
    const sug = suggested();
    if (sug.length) h += `<section class="group b-suggested"><h3 class="group-header">Suggested</h3><div class="b-chipwrap flush"><div class="chips scroll">${sug.map((s) => filterChip(s, { "data-suggest": s })).join("")}</div></div></section>`;
  }
  rerender(body, h);
}

function toggle(k) {
  if (st.picked.has(k)) st.picked.delete(k);
  else if (typedFilters().has(k)) {
    // A chip the query turned on: take its words out of the query.
    const drop = new Set(words(chipTitle(k)));
    st.query = words(st.query).filter((w) => !drop.has(w)).join(" ");
    replaceQuery({ q: st.query });
    runSearch();
    return;
  } else st.picked.add(k);
  refreshLocal();
  render();
}

function bind() {
  const body = $("search-body");
  body.innerHTML = "";
  bindRows(body, {
    onAct: (a, s) => { if (a === "remove") { const r = s.querySelector("[data-recent]")?.dataset.recent; st.recents = st.recents.filter((x) => x !== r); saveRecents(); render(); } },
    menuFor: driveMenu,
  });
  body.addEventListener("click", (e) => {
    const c = e.target.closest("[data-chip]"); if (c) { toggle(c.dataset.chip); return; }
    const r = e.target.closest("[data-recent]"); if (r) { use(r.dataset.recent); return; }
    const s = e.target.closest("[data-suggest]"); if (s) { use(s.dataset.suggest); return; }
    const res = e.target.closest("[data-result]"); if (res) { remember(); openDoc(res.dataset.result, words(st.searched)); return; }
    if (e.target.closest("[data-drive-hit]")) remember();
  });
  on("search:input", ({ q }) => { st.query = q || ""; schedule(); render(); });
  on("search:submit", ({ q }) => { st.query = q || ""; remember(); runSearch(); });
  on("route:changed", (r) => {
    if (!r.isTab || r.tab !== "search" || r.stack.length) return;
    const q = r.query.get("q") || "";
    if (q.trim() !== st.query.trim()) { st.query = q; runSearch(); }
  });
  onBrowse(() => { refreshLocal(); render(); });
  const r = route();
  if (r.isTab && r.tab === "search") st.query = st.searched = r.query.get("q") || "";
  refreshLocal();
  render();
}
bind();
