// outbox-view.js: the Outbox screen (spec 4.4, A4), Earlier, and the Settings "Shred hold" row and
// picker (#18). Owner: outbox. The Outbox is pushed onto the current tab from the accessory
// (#/<tab>/outbox), and Earlier onto it (#/<tab>/outbox/earlier); the shell hides the accessory
// while the Outbox shows. Everything here reads the pipeline through outbox.js and acts through it.
//
// Rows (spec 3.10) open their menu on a tap, a right-click or Enter: Retry and Send back to the
// deck for Needs attention, Send back to the deck while uploading, Open in Drive once filed. The
// Retry button on a Needs attention row is the trailing swipe's twin.
import { esc, on, emit } from "./ui.js";
import { registerScreen, push } from "./router.js";
import { icon } from "./ui/icons.js";
import { section, row, valueRow, banner, emptyState, button, docThumb } from "./ui/components.js";
import { openMenu } from "./ui/menu.js";
import { openSheet } from "./ui/sheet.js";
import { toast } from "./ui/toast.js";
import { getBlob } from "./db.js";
import { watchSettings, saveSettings } from "./store.js";
import { needsDrive, reconnect } from "./drive.js";
import { registerSettingsSection } from "./settings.js";
import * as outbox from "./outbox.js";
import { COPY, isOutbox, isHeld, isFailed, progressOf, subtitle, needsAttention, uploadingSection, filedToday, earlier,
  rowTitle, failedSubtitle, waitingSubtitle, filedSubtitle, firstConfirmedId } from "./outbox.js";

// ---------- thumbnails (object URLs from the pipeline's blobs, made once per item) ----------
const thumbs = new Map();   // id -> url, or "" while loading / when there's none
function thumbOf(id, redraw) {
  if (thumbs.has(id)) return thumbs.get(id);
  thumbs.set(id, "");
  getBlob(`items/${id}.thumb.jpg`).then((b) => { if (b) { thumbs.set(id, URL.createObjectURL(b)); redraw(); } }).catch(() => {});
  return "";
}
function dropThumbs() { for (const u of thumbs.values()) if (u) URL.revokeObjectURL(u); thumbs.clear(); }

const visible = () => { const now = Date.now(); return outbox.entries().filter((i) => isOutbox(i) && !isHeld(i, now)); };
const byId = (id) => outbox.entries().find((i) => i.id === id);

// ---------- rows ----------
const rowAttrs = (i, kind) => ({ tag: "div", "data-ob-row": i.id, "data-kind": kind, tabindex: "0", role: "button", "aria-haspopup": "menu" });
function attentionRow(i, redraw) {
  return row({ ...rowAttrs(i, "attention"), leading: docThumb(thumbOf(i.id, redraw)), title: rowTitle(i.card?.title, i.card?.issuer),
    subtitle: failedSubtitle(i), trailing: button("Retry", { small: true, "data-retry": i.id }) });
}
function uploadingRow(i, online, redraw) {
  const moving = i.stage === "uploading";
  const pct = Math.round(progressOf(i) * 100);
  return row({ ...rowAttrs(i, "uploading"), leading: docThumb(thumbOf(i.id, redraw)), title: rowTitle(i.card?.title, i.card?.issuer),
    subtitleHtml: moving ? `<span class="ob-progress" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span>`
      : esc(waitingSubtitle(i, online)),
    trailing: moving ? `<span class="ob-pct">${pct}%</span>` : "" });
}
function filedRow(i, isFirst) {
  const shred = i.decision === "shredOnly";
  return row({ ...rowAttrs(i, "filed"), leading: `<span class="ob-mark ${shred ? "shred" : "file"}" aria-hidden="true">${icon(shred ? "xmark" : "checkmark")}</span>`,
    title: rowTitle(i.card?.title, i.card?.issuer), subtitle: filedSubtitle(i, isFirst) });
}
// Spec 3.9: the Reconnect Drive banner, on the Outbox when Drive needs it.
const reconnectBanner = ({ working = false, error = "" } = {}) => banner({ kind: "reconnect", bold: "Drive needs reconnecting.",
  text: "Your scans are safe on this phone and upload once it's back.",
  actions: button(working ? "Reconnecting" : "Reconnect Drive", { small: true, "data-reconnect": "", disabled: working, "aria-busy": working ? "true" : undefined })
    + (error ? `<p class="ob-note">${esc(error)}</p>` : ""), "data-ob-banner": "" });

function menuFor(i) {
  if (!i) return [];
  const back = { label: "Send back to the deck", symbol: "arrow.uturn.backward", action: () => sendBack(i.id) };
  if (isFailed(i)) return [{ label: "Retry", symbol: "arrow.clockwise", action: () => outbox.retry(i.id) }, back];
  if (i.stage === "verified" || (i.stage === "filed" && (i.decision === "shredOnly" || i.verifiedAt))) {
    return i.driveUrl ? [{ label: "Open in Drive", symbol: "arrow.up.forward", action: () => open(i.driveUrl, "_blank", "noopener") }] : [];
  }
  return [back];
}
async function sendBack(id) {
  const ok = await outbox.sendBack(id);
  toast(ok ? "Sent back to the deck." : "This scan isn't on this device anymore.");
}

// Wires a list body once: taps and keys on rows open their menu; Retry and Reconnect buttons act.
function bindList(body, state) {
  body.addEventListener("click", async (e) => {
    const r = e.target.closest("[data-retry]");
    if (r) { e.stopPropagation(); outbox.retry(r.dataset.retry); return; }
    if (e.target.closest("[data-reconnect]")) { runReconnect(state); return; }
    if (e.target.closest("[data-earlier]")) { push("earlier"); return; }
    const rowEl = e.target.closest("[data-ob-row]");
    if (rowEl) showMenu(rowEl);
  });
  body.addEventListener("contextmenu", (e) => { const rowEl = e.target.closest("[data-ob-row]"); if (rowEl) { e.preventDefault(); showMenu(rowEl); } });
  body.addEventListener("keydown", (e) => {
    const rowEl = e.target.closest?.("[data-ob-row]");
    if (rowEl && e.target === rowEl && (e.key === "Enter" || e.key === " " || e.key === "ContextMenu")) { e.preventDefault(); showMenu(rowEl); }
  });
}
function showMenu(rowEl) {
  const items = menuFor(byId(rowEl.dataset.obRow));
  if (items.length) openMenu(rowEl, items, { align: "end" });
}
async function runReconnect(state) {
  state.reconnecting = true; state.reconnectError = ""; state.redraw();
  try { await reconnect(); }
  catch (e) { console.warn("Reconnect failed", e); state.reconnectError = COPY.reconnectFailed; }
  finally { state.reconnecting = false; state.redraw(); }
}

// Re-render without losing the focused row or button.
function paint(body, html) {
  const a = document.activeElement;
  const key = body.contains(a) ? (a.dataset.obRow && `[data-ob-row="${a.dataset.obRow}"]`) || (a.dataset.retry && `[data-retry="${a.dataset.retry}"]`) || (a.hasAttribute("data-reconnect") && "[data-reconnect]") || (a.hasAttribute("data-earlier") && "[data-earlier]") : null;
  body.innerHTML = html;
  if (key) body.querySelector(key)?.focus({ preventScroll: true });
}

// ---------- the Outbox (4.4) ----------
function outboxScreen() {
  let state = null;
  return {
    title: "Outbox",
    mount(el, { body, setTitle }) {
      body.classList.add("outbox-body");
      const trailing = el.querySelector(".nav-trailing");
      state = { reconnecting: false, reconnectError: "", t: 0, redraw: () => { clearTimeout(state.t); state.t = setTimeout(render, 16); } };
      const render = () => {
        if (!body.isConnected) return;
        const list = visible();
        const online = outbox.status().kind !== "offline";
        const reconnectNeeded = needsDrive();
        setTitle(null, subtitle(list));
        const failed = list.some(isFailed);
        if (!!trailing.querySelector("[data-retry-all]") !== failed) trailing.innerHTML = failed ? '<button type="button" class="nav-text-btn" data-retry-all>Retry all</button>' : "";
        const attention = needsAttention(list), uploading = uploadingSection(list), today = filedToday(list), older = earlier(list);
        const first = firstConfirmedId(today);
        let html = reconnectNeeded ? reconnectBanner({ working: state.reconnecting, error: state.reconnectError }) : "";
        if (attention.length) html += section(attention.map((i) => attentionRow(i, state.redraw)).join(""), { header: "Needs attention" });
        if (uploading.length) html += section(uploading.map((i) => uploadingRow(i, online, state.redraw)).join(""), { header: "Uploading" });
        if (today.length) html += section(today.map((i) => filedRow(i, i.id === first)).join(""), { header: "Filed today" });
        if (older.length) html += section(row({ title: "Earlier", chevron: true, "data-earlier": "", "data-action": "earlier" }));
        if (!list.length && !reconnectNeeded) html = emptyState({ symbol: "tray", title: "Nothing in the outbox", description: "Filed documents upload from here." });
        paint(body, html);
      };
      state.render = render;
      trailing.addEventListener("click", (e) => { if (e.target.closest("[data-retry-all]")) outbox.retryAll(); });
      bindList(body, state);
      state.off = [on("pipeline:changed", state.redraw), on("outbox:status", state.redraw)];
      state.tick = setInterval(state.redraw, 30000);     // "Trying again in 2 min." counts down
      render();
      outbox.refreshStatus();
    },
    unmount() {
      if (!state) return;
      state.off.forEach((f) => f());
      clearInterval(state.tick); clearTimeout(state.t);
      dropThumbs();
      state = null;
    },
  };
}

// ---------- Earlier: the last 30 days, grouped by day ----------
const dayLabel = (d) => new Date(d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
function earlierScreen() {
  let off = null;
  return {
    title: "Earlier",
    mount(el, { body, setTitle }) {
      body.classList.add("outbox-body");
      setTitle(null, "The last 30 days");
      const state = { redraw: () => render() };
      const render = () => {
        if (!body.isConnected) return;
        const groups = earlier(visible());
        paint(body, groups.length ? groups.map((g) => section(g.entries.map((i) => filedRow(i, false)).join(""), { header: dayLabel(g.day) })).join("")
          : emptyState({ symbol: "tray", title: "Nothing earlier", description: "Documents filed in the last 30 days show up here." }));
      };
      bindList(body, state);
      off = on("pipeline:changed", render);
      render();
    },
    unmount() { if (off) off(); off = null; },
  };
}

registerScreen("outbox", outboxScreen());
registerScreen("earlier", earlierScreen());

// ---------- Settings, Sorting: "Shred hold · 3 days ›" (#18) ----------
// users/{uid}/config/settings.shredHoldDays, so it follows the account to the iPhone app.
export const HOLD_CHOICES = [0, 1, 3, 7];
export const holdLabel = (d) => (d === 0 ? "None" : d === 1 ? "1 day" : `${d} days`);
const HOLD_FOOTER = "A document counts as safe to shred once its Drive copy is confirmed and this many days have passed.";
const HOLD_FAILED = "That didn't save. Check your connection and try again.";
let holdDays = 3;
let unwatch = null;
export const shredHoldDays = () => holdDays;

on("session:started", () => {
  if (unwatch) unwatch();
  unwatch = watchSettings((s) => {
    const d = HOLD_CHOICES.includes(s.shredHoldDays) ? s.shredHoldDays : 3;
    if (d !== holdDays) { holdDays = d; emit("settings:changed", { key: "shredHoldDays", value: d }); }
    paintHoldRow();
  }, () => {});
});
on("session:ended", () => { if (unwatch) unwatch(); unwatch = null; holdDays = 3; });

let holdRowHost = null;
const holdRow = () => valueRow("Shred hold", holdLabel(holdDays), { "data-shred-hold": "", "data-action": "shred-hold" });
function paintHoldRow() {
  const b = holdRowHost?.querySelector("[data-shred-hold]");
  if (b) b.querySelector(".row-value").textContent = holdLabel(holdDays);
}
registerSettingsSection({
  id: "shred-hold", order: 31,
  render: () => section(holdRow(), { header: "Sorting" }),
  bind(el) { holdRowHost = el; el.querySelector("[data-shred-hold]").addEventListener("click", openHoldPicker); },
});

function openHoldPicker() {
  const choices = (failed) => section(HOLD_CHOICES.map((d) => row({
    title: holdLabel(d), trailing: d === holdDays ? icon("checkmark") : "", tag: "button",
    "data-hold": String(d), role: "radio", "aria-checked": String(d === holdDays),
  }).replace('class="list-row', 'class="list-row hold-choice')).join(""), { footer: failed ? HOLD_FAILED : HOLD_FOOTER, role: "radiogroup", "aria-label": "Shred hold" });
  const s = openSheet({ title: "Shred hold", detents: ["medium"], label: "Shred hold", body: choices(false) });
  s.body.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-hold]"); if (!b) return;
    const d = Number(b.dataset.hold), before = holdDays;
    if (d === before) return;
    holdDays = d;
    s.body.innerHTML = choices(false);
    s.body.querySelector(`[data-hold="${d}"]`)?.focus();
    paintHoldRow();
    try { await saveSettings({ shredHoldDays: d }); emit("settings:changed", { key: "shredHoldDays", value: d }); }
    catch (err) {
      console.warn("Shred hold didn't save", err);
      holdDays = before;
      s.body.innerHTML = choices(true);
      paintHoldRow();
    }
  });
  return s;
}

// The legacy Settings Drive section reads "Last upload" from here once auth adds the row.
export const lastUploadAt = () => outbox.status().lastUploadAt;
