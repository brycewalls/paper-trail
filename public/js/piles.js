// piles.js: Piles (spec 4.5, A5; owner: browse; #18, #24). The Shred, Keep and All filed segments
// with plain counts ("Shred 9", #58), the safe-to-shred banner and "Mark n as shredded", Put away
// and Take out, All filed by month with the Sensitive filter, and the Shred hold row in Settings.
// Renders into #piles-body from the live library in browse.js and writes through store.js. The
// counterpart of ios/PaperTrail/Features/Piles (PilesScreen, PilesViewModel).
import { $, esc, prefs } from "./ui.js";
import { updateDoc, saveSettings } from "./store.js";
import { lib, onBrowse, holdDays, shredState, parseISO, shortDay, monthTitle, daysUntil, days, folderName, isoNow,
  thumb, swipeRow, bindRows, driveMenu, rerender, saveFailed, loadFailedState, reconnectBanner, openDoc } from "./browse.js";
import { registerSettingsSection } from "./settings.js";
import { icon } from "./ui/icons.js";
import { verdictBadge, statusPill, section, row, banner, emptyState, segmented } from "./ui/components.js";
import { bindMenu, openMenu } from "./ui/menu.js";
import { actionSheet } from "./ui/sheet.js";

const ui = { segment: ["shred", "keep", "all"].includes(prefs.get("pt-piles-segment")) ? prefs.get("pt-piles-segment") : "shred", filter: "all", showAllSafe: false };

// ---------- the model (PilesViewModel) ----------
export function piles(now = Date.now()) {
  const hold = holdDays();
  const pile = lib.docs.filter((d) => d.physical === "to_shred");
  const state = new Map(pile.map((d) => [d.id, shredState(d, hold, now)]));
  const safe = pile.filter((d) => state.get(d.id)?.kind === "safe");
  const waiting = pile.filter((d) => state.get(d.id)?.kind !== "safe");
  const toPutAway = lib.docs.filter((d) => d.physical === "keep");
  const inBinder = lib.docs.filter((d) => d.physical === "stored");
  const filedAll = lib.docs.filter((d) => d.filed);
  const filed = filedAll.filter((d) => ui.filter === "all" || d.sensitive).sort((a, b) => String(b.filedAt).localeCompare(String(a.filedAt)));
  return { hold, pile, state, safe, waiting, toPutAway, inBinder, filedAll, filed };
}
// Spec 3.9: "6 are safe to shred." then the rest.
export function safeBannerCopy(n, hold) {
  if (!n) return null;
  return { bold: n === 1 ? "1 is safe to shred." : `${n} are safe to shred.`,
    text: hold > 0 ? `The Drive copy is confirmed and the ${hold}-day hold is over.` : "The Drive copy is confirmed." };
}
const shredSubtitle = (d) => (d.sensitive ? `${d.issuer} · Cross-cut` : d.issuer || "");
const keepSubtitle = (d) => [d.issuer, folderName(d.folder)].filter(Boolean).join(" · ");
function waitingCopy(st) {
  if (st?.kind !== "holding") return { pill: "Checking", sub: "Checking the Drive copy" };
  const n = daysUntil(st.until);
  return { pill: n === 0 ? "Today" : days(n), sub: `Drive copy confirmed · hold ends ${shortDay(st.until)}` };
}

// ---------- rendering ----------
const docRow = (d, subtitle, trailing) => row({ tag: "button", leading: thumb(d), title: d.title || "Untitled", subtitle, trailing,
  "data-open": d.id, "data-key": `doc-${d.id}`, "data-drive-url": d.driveUrl || undefined });

function shredSegment(m) {
  let h = "";
  if (lib.docsLoaded && !m.pile.length) h += emptyState({ symbol: "checkmark.circle", title: "Nothing to shred", description: "Documents you file show up here once their Drive copy is confirmed." });
  const copy = safeBannerCopy(m.safe.length, m.hold);
  if (copy) h += `<div class="group b-banner">${banner({ kind: "safe", ...copy, "data-safe-banner": "" })}</div>`;
  if (m.safe.length) {
    const shown = ui.showAllSafe ? m.safe : m.safe.slice(0, 3);
    const more = m.safe.length - shown.length;
    h += section(shown.map((d) => swipeRow(docRow(d, shredSubtitle(d), statusPill("safe")), [{ label: "Shredded", act: "shredded", tone: "file" }], { key: `sw-${d.id}` })).join("")
      + (more > 0 ? row({ title: `${more} more`, chevron: true, "data-more-safe": "", "data-key": "more-safe", "aria-label": `${more} more safe to shred` }) : ""),
    { header: "Safe to shred", "data-section": "safe" });
  }
  if (m.waiting.length) {
    h += section(m.waiting.map((d) => { const w = waitingCopy(m.state.get(d.id)); return docRow(d, w.sub, statusPill("waiting", w.pill)); }).join(""),
      { header: "Waiting", "data-section": "waiting" });
  }
  // Floating glass button above the accessory; Waiting rows are never included.
  if (m.safe.length) h += `<div class="b-float"><button type="button" class="glass b-mark" data-mark data-key="mark">Mark ${m.safe.length} as shredded</button></div>`;
  return h;
}
function keepSegment(m) {
  let h = "";
  if (lib.docsLoaded && !m.toPutAway.length && !m.inBinder.length) h += emptyState({ symbol: "archivebox", title: "No originals to keep", description: "Cards marked Keep original show up here." });
  if (m.toPutAway.length) h += section(m.toPutAway.map((d) => swipeRow(docRow(d, keepSubtitle(d), ""), [{ label: "Put away", act: "putaway", tone: "accent" }], { key: `sw-${d.id}` })).join(""),
    { header: "To put away", "data-section": "putaway" });
  if (m.inBinder.length) h += section(m.inBinder.map((d) => swipeRow(docRow(d, keepSubtitle(d), `<span class="b-stored" role="img" aria-label="Put away">${icon("archivebox")}</span>`),
    [{ label: "Take out", act: "takeout", tone: "gray" }], { key: `sw-${d.id}` })).join(""), { header: "In the binder", "data-section": "binder" });
  return h;
}
function allSegment(m) {
  if (lib.docsLoaded && !m.filed.length) {
    return ui.filter === "sensitive" && m.filedAll.length
      ? emptyState({ symbol: "lock.fill", title: "Nothing sensitive", description: "No filed documents are marked Sensitive." })
      : emptyState({ symbol: "folder", title: "Nothing filed yet", description: "Everything you file to Drive shows up here." });
  }
  const groups = [];
  for (const d of m.filed) {
    const at = parseISO(d.filedAt);
    const title = at ? monthTitle(at) : "Earlier";
    if (groups.length && groups[groups.length - 1].title === title) groups[groups.length - 1].docs.push(d);
    else groups.push({ title, docs: [d] });
  }
  return groups.map((g) => section(g.docs.map((d) => docRow(d, keepSubtitle(d), verdictBadge(d.verdict))).join(""), { header: g.title, "data-section": "month" })).join("");
}

export function renderPiles() {
  const body = $("piles-body");
  if (!body) return;
  const m = piles();
  const filter = $("piles-filter");
  if (filter) {
    filter.hidden = ui.segment !== "all";
    filter.classList.toggle("on", ui.filter !== "all");
    filter.setAttribute("aria-label", ui.filter === "all" ? "Filter" : "Filter, showing Sensitive");
  }
  if (lib.failed && !lib.docsLoaded) { rerender(body, reconnectBanner() + loadFailedState()); return; }
  const seg = `<div class="b-seg">${segmented([
    { value: "shred", label: `Shred ${m.pile.length}` },
    { value: "keep", label: `Keep ${m.toPutAway.length + m.inBinder.length}` },
    { value: "all", label: `All filed ${m.filedAll.length}` },
  ], { selected: ui.segment, label: "Pile", "data-key": "seg" })}</div>`;
  const content = ui.segment === "shred" ? shredSegment(m) : ui.segment === "keep" ? keepSegment(m) : allSegment(m);
  rerender(body, reconnectBanner() + seg + content);
}

// ---------- actions ----------
async function write(id, patch) { try { await updateDoc(id, patch); } catch { saveFailed(); } }
async function act(name, swipeEl) {
  const id = swipeEl.querySelector("[data-open]")?.dataset.open;
  const d = lib.docs.find((x) => x.id === id);
  if (!d) return;
  if (name === "shredded" && shredState(d)?.kind === "safe") await write(id, { physical: "shredded", shreddedAt: isoNow() });
  if (name === "putaway" && d.physical === "keep") await write(id, { physical: "stored" });
  if (name === "takeout" && d.physical === "stored") await write(id, { physical: "keep" });
}
export async function markSafeShredded() {
  const { safe } = piles();
  const now = isoNow();
  try { await Promise.all(safe.map((d) => updateDoc(d.id, { physical: "shredded", shreddedAt: now }))); } catch { saveFailed(); }
}

function bind() {
  const body = $("piles-body");
  body.innerHTML = "";
  bindRows(body, { onAct: act, menuFor: driveMenu });
  body.addEventListener("click", async (e) => {
    const seg = e.target.closest("[data-seg]");
    if (seg) { ui.segment = seg.dataset.seg; prefs.set("pt-piles-segment", ui.segment); renderPiles(); return; }
    if (e.target.closest("[data-more-safe]")) { ui.showAllSafe = true; renderPiles(); return; }
    if (e.target.closest("[data-mark]")) {
      const n = piles().safe.length;
      if (!n) return;
      const label = `Mark ${n} as shredded`;
      const choice = await actionSheet({ title: `${label}?`, message: "Do this once the paper has gone through the shredder.", actions: [{ label, value: "mark" }] });
      if (choice === "mark") await markSafeShredded();
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) openDoc(open.dataset.open);
  });
  // Arrow keys move between segments, like the system segmented control.
  body.addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-seg]");
    if (!b || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const order = ["shred", "keep", "all"];
    ui.segment = order[(order.indexOf(ui.segment) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
    prefs.set("pt-piles-segment", ui.segment);
    renderPiles();
    body.querySelector(`[data-seg="${ui.segment}"]`)?.focus();
    e.preventDefault();
  });
  const filter = $("piles-filter");
  if (filter) {
    filter.innerHTML = icon("line.3.horizontal.decrease");
    bindMenu(filter, () => [
      { label: "All", symbol: ui.filter === "all" ? "checkmark" : undefined, action: () => { ui.filter = "all"; renderPiles(); } },
      { label: "Sensitive", symbol: ui.filter === "sensitive" ? "checkmark" : undefined, action: () => { ui.filter = "sensitive"; renderPiles(); } },
    ]);
  }
  onBrowse(renderPiles);
  renderPiles();
}
bind();

// ---------- Settings, Sorting: "Shred hold · 3 days ›" (spec 4.9; #18) ----------
// The iPhone app files this row under outbox (ShredHoldSetting.swift); spec 4.9 lists it for piles.
// When deck's Sorting section is in the sheet, the row joins it; otherwise it brings its own header.
export const holdLabel = (n) => (n === 0 ? "None" : days(n));
const HOLD_CHOICES = [0, 1, 3, 7];
const HOLD_FOOTER = "A document counts as safe to shred once its Drive copy is confirmed and this many days have passed.";
const holdRow = () => row({ title: "Shred hold", trailing: `<span class="row-value" data-hold-value>${esc(holdLabel(holdDays()))}</span>`, chevron: true, id: "set-shred-hold", "aria-haspopup": "menu" });
try {
  registerSettingsSection({
    id: "shred-hold", order: 31,
    render: () => section(holdRow(), { header: "Sorting", footer: HOLD_FOOTER }),
    bind(el) {
      const sorting = el.previousElementSibling?.matches?.('[data-settings-section="sorting"]') ? el.previousElementSibling.querySelector(".group-body") : null;
      if (sorting) { sorting.insertAdjacentHTML("beforeend", holdRow()); el.innerHTML = ""; }
      const btn = (sorting || el).querySelector("#set-shred-hold");
      btn.addEventListener("click", () => openMenu(btn, HOLD_CHOICES.map((n) => ({
        label: holdLabel(n), symbol: n === holdDays() ? "checkmark" : undefined,
        action: async () => {
          btn.querySelector("[data-hold-value]").textContent = holdLabel(n);
          try { await saveSettings({ shredHoldDays: n }); } catch { saveFailed(); btn.querySelector("[data-hold-value]").textContent = holdLabel(holdDays()); }
        },
      })), { align: "end" }));
    },
  });
} catch (e) { console.warn(e.message); }
