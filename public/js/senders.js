// senders.js: sender rules (#21, #27), the web twin of the iPhone app's SenderRulesViewModel and
// SenderRulesScreen (spec 4.12, 3.10, 3.11). It watches users/{uid}/senders once a session starts and
// hands the live list to classify.js (setSenderRules), so every read sends them as senderHints and
// applies the matching rule when the function didn't. It also draws Settings, Sorting, "Sender
// rules · 14 ›", and the Sender rules list and rule detail in a sheet over Settings (iOS pushes them
// inside the Settings stack; the sheet's back button returns there).
//   saveRule(rule), forgetRule(key)  for the check-fields sheet's "Remember for this sender" (deck)
// Owner: deck per docs/web-contract.md; built in the capture PR with the reading queue (#83).
import { esc, on, emit } from "./ui.js";
import { FOLDER_NAMES, VERDICT } from "./config.js";
import { watchSenders, setSenderRule, deleteSenderRule } from "./store.js";
import { setSenderRules, renderFilename, folderName, FILENAME_TOKENS } from "./classify.js";
import { registerSettingsSection } from "./settings.js";
import { openSheet, actionSheet } from "./ui/sheet.js";
import { section, row, valueRow, segmented, choiceChip, emptyState, verdictStamp } from "./ui/components.js";
import { icon } from "./ui/icons.js";

let rules = [];
let loaded = false;
let unwatch = null;
const listeners = new Set();
export const senderRuleList = () => rules;

on("session:started", () => {
  if (unwatch) unwatch();
  loaded = false;
  unwatch = watchSenders((list) => {
    rules = list.map(({ id, ...r }) => ({ ...r, key: r.key || id })).filter((r) => r.issuer);
    loaded = true;
    setSenderRules(rules);
    listeners.forEach((fn) => fn());
  }, (e) => console.warn("Sender rules didn't load", e));
});
on("session:ended", () => { if (unwatch) unwatch(); unwatch = null; rules = []; loaded = false; setSenderRules([]); listeners.forEach((fn) => fn()); });

export async function saveRule(rule) {
  const r = { ...rule, updatedAt: new Date().toISOString() };
  for (const k of Object.keys(r)) if (r[k] === undefined || r[k] === null || r[k] === "") delete r[k];
  rules = [...rules.filter((x) => x.key !== r.key), r];
  setSenderRules(rules);
  await setSenderRule(r);
  emit("sender:saved", { key: r.key });
}
export async function forgetRule(key) {
  rules = rules.filter((x) => x.key !== key);
  setSenderRules(rules);
  await deleteSenderRule(key);
  emit("sender:saved", { key });
}

// ---------- copy ----------
// "Home · Scan + shred · {date}_cascade-electric-bill"; parts the rule doesn't set are left out.
export const ruleSubtitle = (r) => [r.folder && folderName(r.folder), r.verdict && verdictStamp(r.verdict), r.filenamePattern].filter(Boolean).join(" · ");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function updatedFooter(r) {
  const d = new Date(r.updatedAt || "");
  return Number.isNaN(d.getTime()) ? "" : `Updated ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
// The live preview under the pattern: "2026-09-28_cascade-electric-bill.pdf", dated today.
export function preview(r, today = new Date()) {
  if (!String(r.filenamePattern || "").trim()) return "";
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const name = renderFilename(r.filenamePattern, { issuer: r.issuer, docType: r.docType || "", docDate: day });
  return name ? `${name}.pdf` : "";
}
const sorted = () => [...rules].sort((a, b) => a.issuer.localeCompare(b.issuer, undefined, { sensitivity: "base" }));

// ---------- Settings, Sorting ----------
registerSettingsSection({
  id: "sender-rules", order: 30,
  render: () => section(valueRow("Sender rules", loaded ? String(rules.length) : "", { "data-open-senders": "", "aria-label": "Sender rules" }), { header: "Sorting" }),
  bind(el) {
    el.querySelector("[data-open-senders]").addEventListener("click", openSenderRules);
    const sync = () => {
      if (!el.isConnected) { listeners.delete(sync); return; }
      const v = el.querySelector(".row-value"); if (v) v.textContent = loaded ? String(rules.length) : "";
    };
    listeners.add(sync);
  },
});

// ---------- the Sender rules sheet: list and rule detail ----------
let open = null;
export function openSenderRules() {
  if (open) return open.sheet;
  const body = document.createElement("div");
  body.className = "senders";
  const sheet = openSheet({ title: "Sender rules", largeTitle: true, detents: ["large"], label: "Sender rules", className: "senders-sheet",
    trailing: `<button type="button" class="nav-text-btn nav-back-btn" data-senders-back>${icon("chevron.left")}<span>Settings</span></button>`, body });
  open = { sheet, body, query: "", rule: null, draft: null };
  const back = sheet.el.querySelector("[data-senders-back]");
  back.addEventListener("click", () => (open.rule ? showList() : sheet.close("back")));
  const redraw = () => { if (open && !open.rule) drawList(); };
  listeners.add(redraw);
  sheet.closed.then(() => { saveDraft(); listeners.delete(redraw); open = null; });
  drawList();
  return sheet;
}
export const sendersOpen = () => !!open;

function setHead(title, backLabel) {
  open.sheet.el.querySelector(".sheet-title").textContent = title;
  open.sheet.el.querySelector("[data-senders-back] span").textContent = backLabel;
}

function drawList() {
  const { body } = open;
  setHead("Sender rules", "Settings");
  const q = open.query.trim().toLowerCase();
  const list = sorted().filter((r) => !q || r.issuer.toLowerCase().includes(q) || String(r.docType || "").toLowerCase().includes(q));
  const keepFocus = document.activeElement && document.activeElement.matches?.("[data-senders-search]");
  body.innerHTML = `<div class="senders-search"><label class="search-pill">${icon("magnifyingglass")}<input type="search" data-senders-search placeholder="Senders" aria-label="Search senders" value="${esc(open.query)}" autocomplete="off" enterkeyhint="search"></label></div>`
    + (loaded && !rules.length
      ? emptyState({ symbol: "person.crop.rectangle.stack", title: "No sender rules yet", description: "When you fix a card with Remember for this sender on, the rule shows up here." })
      : q && !list.length
        ? emptyState({ symbol: "magnifyingglass", title: `No results for "${open.query.trim()}"`, description: "Check the spelling or try a new search." })
        : section(list.map((r) => row({ title: r.issuer, subtitle: ruleSubtitle(r), chevron: true, "data-rule": r.key })).join("")));
  const input = body.querySelector("[data-senders-search]");
  input.addEventListener("input", () => { open.query = input.value; drawList(); });
  if (keepFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  body.querySelectorAll("[data-rule]").forEach((b) => b.addEventListener("click", () => showRule(b.dataset.rule)));
}

function showList() {
  saveDraft();
  open.rule = null; open.draft = null;
  drawList();
  open.body.scrollTop = 0;
}

function showRule(key) {
  const r = rules.find((x) => x.key === key);
  if (!r) return;
  open.rule = r;
  open.draft = { ...r };
  drawRule();
  open.body.scrollTop = 0;
}

function drawRule() {
  const { body, draft, rule } = open;
  setHead(rule.issuer, "Sender rules");
  const folders = FOLDER_NAMES.map((f) => `<option value="${esc(f)}"${f === (draft.folder || "11 Other") ? " selected" : ""}>${esc(folderName(f))}</option>`).join("");
  const pv = preview(draft);
  body.innerHTML =
    section(`<label class="list-row"><span class="row-text"><span class="row-title">Folder</span></span><span class="row-trailing"><select class="row-select" data-f="folder" aria-label="Folder">${folders}</select></span></label>`)
    + section(`<div class="list-row">${segmented(Object.keys(VERDICT).map((v) => ({ value: v, label: verdictStamp(v) })), { selected: draft.verdict || "scan_shred", label: "Verdict", "data-f": "verdict" })}</div>`, { header: "Verdict" })
    + section(`<label class="list-row"><span class="row-text"><span class="row-title">Document type</span></span><input class="row-input" data-f="docType" value="${esc(draft.docType || "")}" placeholder="Document type" aria-label="Document type" autocomplete="off"></label>`)
    + section(`<div class="list-row rule-pattern"><input class="row-input mono" data-f="filenamePattern" value="${esc(draft.filenamePattern || "")}" placeholder="{date}_sender-name" aria-label="Filename pattern" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`
      + `<div class="list-row rule-chips" role="group" aria-label="Add to the filename">${FILENAME_TOKENS.map((t) => choiceChip(t, { on: String(draft.filenamePattern || "").includes(t), "data-token": t, "aria-label": `Add ${t}` })).join("")}</div>`
      + `<div class="list-row rule-preview"${pv ? "" : " hidden"}><span class="mono-caption" data-preview aria-label="Preview: ${esc(pv)}">${esc(pv)}</span></div>`,
      { header: "Filename", footer: updatedFooter(rule) })
    + section(row({ title: "Forget this sender", destructive: true, "data-action": "forget" }));
  const sync = () => {
    const p = preview(open.draft);
    const el = body.querySelector("[data-preview]");
    el.textContent = p; el.setAttribute("aria-label", `Preview: ${p}`);
    el.closest(".rule-preview").hidden = !p;
    body.querySelectorAll("[data-token]").forEach((c) => { const onNow = String(open.draft.filenamePattern || "").includes(c.dataset.token); c.classList.toggle("on", onNow); c.setAttribute("aria-checked", String(onNow)); });
  };
  body.querySelector('[data-f="folder"]').addEventListener("change", (e) => { open.draft.folder = e.target.value; });
  body.querySelector('[data-f="docType"]').addEventListener("input", (e) => { open.draft.docType = e.target.value.trim(); sync(); });
  const pat = body.querySelector('[data-f="filenamePattern"]');
  pat.addEventListener("input", () => { open.draft.filenamePattern = pat.value; sync(); });
  body.querySelector('[data-f="verdict"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-seg]"); if (!b) return;
    open.draft.verdict = b.dataset.seg;
    body.querySelectorAll('[data-f="verdict"] [data-seg]').forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  });
  body.querySelectorAll("[data-token]").forEach((c) => c.addEventListener("click", () => {
    open.draft.filenamePattern = (open.draft.filenamePattern || "") + c.dataset.token;
    pat.value = open.draft.filenamePattern; sync();
  }));
  body.querySelector('[data-action="forget"]').addEventListener("click", async () => {
    const r = open.rule;
    const choice = await actionSheet({ title: `Forget ${r.issuer}? Their cards go back to Claude's best guess.`, actions: [{ label: "Forget", value: "forget", destructive: true }] });
    if (choice !== "forget" || !open) return;
    open.draft = null; open.rule = null;
    drawList();
    try { await forgetRule(r.key); } catch (e) { console.warn("Couldn't forget the rule", e); }
  });
}

// Leaving the detail saves what changed (iOS saves on disappear).
function saveDraft() {
  if (!open || !open.rule || !open.draft) return;
  const a = open.rule, b = open.draft;
  const same = ["folder", "verdict", "docType", "filenamePattern"].every((k) => (a[k] || "") === (b[k] || ""));
  if (same) return;
  saveRule({ ...b, filenamePattern: String(b.filenamePattern || "").trim() }).catch((e) => console.warn("Couldn't save the rule", e));
}
