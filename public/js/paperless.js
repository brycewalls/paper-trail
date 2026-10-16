// paperless.js: Paperless (spec 4.7, A7; owner: browse; #23). The ledger of senders to switch to
// e-delivery: "{x} of {y} senders confirmed", the "Still mailing?" banners, Check back soon, To do
// and Done (grouped), status swipes, and the sender detail pushed as sender:<id> (status, the steps,
// the check-back date, when they were seen). Paperless records are created by whoever files the
// doc (the outbox), never here; this module only updates status fields. The counterpart of
// ios/PaperTrail/Features/Paperless (PaperlessViewModel, PaperlessScreen, SenderDetailScreen).
import { $, esc, slug } from "./ui.js";
import { registerScreen, push } from "./router.js";
import { updateSender } from "./store.js";
import { lib, onBrowse, parseISO, parseDay, shortDay, swipeRow, bindRows, rerender, saveFailed, loadFailedState } from "./browse.js";
import { section, row, banner, button, emptyState, statusPill, primaryButton } from "./ui/components.js";
import { openMenu } from "./ui/menu.js";

// Pill copy, from one map (docs/web-contract.md). Values are the iPhone app's PaperlessStatus.
export const PAPERLESS_LABEL = { todo: "To do", requested: "Requested", waiting_cycle: "Waiting a cycle", done: "Confirmed", skip: "Can't stop" };
export const STATUSES = Object.keys(PAPERLESS_LABEL);
const PILL_KIND = { todo: "todo", requested: "requested", waiting_cycle: "waiting_cycle", done: "confirmed", skip: "cant_stop" };
const pill = (status) => statusPill(PILL_KIND[status] || "todo", PAPERLESS_LABEL[status] || PAPERLESS_LABEL.todo);
const CYCLE_DAYS = 35;
const WATCHED = new Set(["requested", "waiting_cycle", "done"]);
const DAY = 86400000;
const byIssuer = (a, b) => String(a.issuer).localeCompare(String(b.issuer), undefined, { sensitivity: "base" });

// ---------- rules (PaperlessRules) ----------
// The sender a filed doc belongs to: the paperless issuer, else the doc's issuer.
const senderIdOf = (d) => slug(d.paperless?.issuer || d.issuer);
const docsOf = (s, docs = lib.docs) => docs.filter((d) => senderIdOf(d) === s.id || slug(d.issuer) === s.id);
// New paper counts from the latest of requested, confirmed or a handled flag; else the first scan.
function baseline(s) {
  const ds = [s.requestedAt, s.doneAt, s.mailHandledAt].map(parseISO).filter(Boolean);
  return ds.length ? new Date(Math.max(...ds)) : parseISO(s.firstSeen);
}
export function flagFor(s, docs = lib.docs) {
  if (!WATCHED.has(s.status)) return null;
  const since = baseline(s);
  if (!since) return null;
  let newest = null;
  for (const d of docsOf(s, docs)) { const at = parseISO(d.filedAt); if (at && at > since && (!newest || at > newest.at)) newest = { doc: d, at }; }
  if (newest) return { sender: s, ...newest };
  const at = parseISO(s.stillMailingAt);
  return at && at > since ? { sender: s, doc: null, at } : null;
}
// "Utility bill" reads as "utility bill"; acronyms like "EOB" or "W-2" keep their case.
const lowerType = (t) => t.split(" ").map((w) => (w.length > 1 && w.toUpperCase() === w ? w : w.toLowerCase())).join(" ");
export function bannerText(f) {
  if (!f.doc) return `${f.sender.issuer} sent paper mail on ${shortDay(f.at)}, after you requested paperless.`;
  const type = f.doc.docType ? lowerType(f.doc.docType) : "document";
  return `${f.sender.issuer} sent a paper ${type} on ${shortDay(parseDay(f.doc.docDate) || f.at)}, after you requested paperless.`;
}
export function ledger() {
  const s = lib.paperless;
  const counted = s.filter((x) => x.status !== "skip");
  const flags = s.map((x) => flagFor(x)).filter(Boolean).sort((a, b) => b.at - a.at);
  const checkBackSoon = s.filter((x) => x.status === "requested" || x.status === "waiting_cycle").sort((a, b) => {
    const x = parseISO(a.checkBackAt), y = parseISO(b.checkBackAt);
    return x && y ? x - y : x ? -1 : y ? 1 : byIssuer(a, b);
  });
  return {
    subtitle: counted.length ? `${counted.filter((x) => x.status === "done").length} of ${counted.length} senders confirmed` : "",
    flags, checkBackSoon,
    toDo: s.filter((x) => (x.status || "todo") === "todo" || !PAPERLESS_LABEL[x.status]).sort(byIssuer),
    confirmed: s.filter((x) => x.status === "done").sort(byIssuer),
    cantStop: s.filter((x) => x.status === "skip").sort(byIssuer),
  };
}
const checkBackText = (s) => { const d = parseISO(s.checkBackAt); return d ? `Check back ${shortDay(d)}` : "No check-back date"; };
const stepsOf = (s) => { const l = (s.steps || []).filter(Boolean); return l.length ? l : s.how ? [s.how] : []; };
const firstStep = (s) => stepsOf(s)[0] || "";
function seenText(s) {
  const dates = docsOf(s).map((d) => parseISO(d.filedAt)).filter(Boolean);
  const first = [parseISO(s.firstSeen), ...dates].filter(Boolean).sort((a, b) => a - b)[0];
  const last = [...dates, parseISO(s.lastSeen)].filter(Boolean).sort((a, b) => b - a)[0] || first;
  if (!first) return "No scans yet";
  return last && last.toDateString() !== first.toDateString() ? `First scan ${shortDay(first)} · Last scan ${shortDay(last)}` : `First scan ${shortDay(first)}`;
}

// ---------- writes ----------
const iso = (ms = Date.now()) => new Date(ms).toISOString();
async function write(id, patch) { try { await updateSender(id, patch); } catch { saveFailed(); } }
export function setStatus(s, status) {
  if (status === "requested") return write(s.id, { status, requestedAt: iso(), checkBackAt: iso(Date.now() + CYCLE_DAYS * DAY) });
  if (status === "waiting_cycle") return write(s.id, { status, checkBackAt: iso(Date.now() + CYCLE_DAYS * DAY), mailHandledAt: iso() });
  if (status === "done") return write(s.id, { status, doneAt: iso() });
  return write(s.id, { status });
}
// The trailing swipe on a row: the next step for that status.
const swipeChoices = (s) => ({ todo: ["requested", "skip"], requested: ["done", "waiting_cycle"], waiting_cycle: ["done", "waiting_cycle"], done: ["todo"], skip: ["todo"] }[s.status] || ["requested", "skip"]);
const TONE = { done: "file", requested: "accent" };
const actions = (s) => swipeChoices(s).map((c) => ({ label: PAPERLESS_LABEL[c], act: c, tone: TONE[c] || "gray" }));

// ---------- the ledger screen ----------
let showAllFlags = false;
const senderRow = (s, subtitle, status = s.status) => swipeRow(row({ tag: "button", title: s.issuer, subtitle, trailing: pill(status), "data-sender": s.id, "data-key": `s-${s.id}` }),
  actions(s), { key: `sw-${s.id}` });
export function renderPaperless() {
  const body = $("paperless-body");
  if (!body) return;
  const m = ledger();
  const sub = $("paperless-subtitle");
  if (sub) sub.textContent = m.subtitle;
  if (lib.failed && !lib.paperlessLoaded) { rerender(body, loadFailedState()); return; }
  if (!lib.paperlessLoaded) { rerender(body, ""); return; }
  let h = "";
  if (!lib.paperless.length) h += emptyState({ symbol: "leaf", title: "No senders yet", description: "When a scan comes from someone who offers paperless, they show up here." });
  const shown = showAllFlags ? m.flags : m.flags.slice(0, 2);
  for (const f of shown) {
    h += `<div class="group b-banner">${banner({ kind: "mailing", heading: "Still mailing?", text: bannerText(f), "data-flag": f.sender.id,
      actions: button("Open their steps", { small: true, "data-open-steps": f.sender.id }) + button("Wait a cycle", { small: true, "data-wait-cycle": f.sender.id }) })}</div>`;
  }
  const hidden = m.flags.length - shown.length;
  if (hidden > 0) h += section(row({ title: hidden === 1 ? "1 more sender is still mailing" : `${hidden} more senders are still mailing`, chevron: true, "data-more-flags": "", "data-key": "more-flags", class: undefined }), { "data-section": "more-flags" });
  if (m.checkBackSoon.length) h += section(m.checkBackSoon.map((s) => senderRow(s, checkBackText(s))).join(""), { header: "Check back soon", "data-section": "checkback" });
  if (m.toDo.length) h += section(m.toDo.map((s) => senderRow(s, firstStep(s), "todo")).join(""), { header: "To do", "data-section": "todo" });
  const done = [...m.confirmed, ...m.cantStop];
  if (done.length === 1) h += section(senderRow(done[0], ""), { header: "Done", "data-section": "done" });
  else if (done.length) {
    // Senders that share a status share a row (A7): "Harbor Federal, Northwind", "1 more can't stop (DMV)".
    const main = m.confirmed.length ? m.confirmed : m.cantStop;
    const subtitle = m.confirmed.length && m.cantStop.length ? `${m.cantStop.length} more can't stop (${m.cantStop.map((s) => s.issuer).join(", ")})` : "";
    h += section(row({ tag: "button", title: main.map((s) => s.issuer).join(", "), subtitle, trailing: pill(m.confirmed.length ? "done" : "skip"), "data-done-group": "", "data-key": "done-group" }),
      { header: "Done", "data-section": "done" });
  }
  rerender(body, h);
}

function bindLedger() {
  const body = $("paperless-body");
  bindRows(body, { onAct: (act, sw) => { const s = lib.paperless.find((x) => x.id === sw.querySelector("[data-sender]")?.dataset.sender); if (s) setStatus(s, act); } });
  body.addEventListener("click", (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t("[data-more-flags]")) { showAllFlags = true; renderPaperless(); return; }
    if (t("[data-open-steps]")) { push("sender", t("[data-open-steps]").dataset.openSteps); return; }
    if (t("[data-wait-cycle]")) { const s = lib.paperless.find((x) => x.id === t("[data-wait-cycle]").dataset.waitCycle); if (s) setStatus(s, "waiting_cycle"); return; }
    if (t("[data-done-group]")) { push("done-senders"); return; }
    if (t("[data-sender]")) push("sender", t("[data-sender]").dataset.sender);
  });
  onBrowse(renderPaperless);
  renderPaperless();
}
bindLedger();

// ---------- Done (every Confirmed and Can't stop sender, from the grouped row) ----------
registerScreen("done-senders", {
  title: "Done",
  mount(el, { body }) {
    bindRows(body, { onAct: (act, sw) => { const s = lib.paperless.find((x) => x.id === sw.querySelector("[data-sender]")?.dataset.sender); if (s) setStatus(s, act); } });
    body.addEventListener("click", (e) => { const r = e.target.closest("[data-sender]"); if (r) push("sender", r.dataset.sender); });
    const draw = () => {
      const m = ledger();
      const list = [...m.confirmed, ...m.cantStop];
      rerender(body, list.length ? section(list.map((s) => swipeRow(row({ tag: "button", title: s.issuer, trailing: pill(s.status), chevron: true, "data-sender": s.id, "data-key": `s-${s.id}` }),
        [{ label: PAPERLESS_LABEL.todo, act: "todo", tone: "gray" }], { key: `sw-${s.id}` })).join(""))
        : emptyState({ symbol: "leaf", title: "Nothing done yet", description: "Senders you confirm or can't stop show up here." }));
    };
    el._unsub = onBrowse(draw);
    draw();
  },
  unmount(el) { el._unsub && el._unsub(); },
});

// ---------- sender detail (spec 4.7) ----------
const PRIMARY = { todo: ["I requested it", "requested"], requested: ["It's confirmed", "done"], waiting_cycle: ["It's confirmed", "done"] };
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function detailBody(s) {
  if (!s) return lib.paperlessLoaded ? emptyState({ symbol: "leaf", title: "Sender not found" }) : emptyState({ spinner: true, title: "Loading" });
  const steps = stepsOf(s);
  const back = parseISO(s.checkBackAt) || new Date(Date.now() + CYCLE_DAYS * DAY);
  const primary = PRIMARY[s.status];
  return section(row({ tag: "button", title: "Status", trailing: `<span class="row-value" data-status-value>${esc(PAPERLESS_LABEL[s.status] || PAPERLESS_LABEL.todo)}</span>`, chevron: true,
      "data-status-menu": "", "aria-haspopup": "menu", "data-key": "status" }), { header: "Status" })
    + section(steps.length ? steps.map((t, i) => `<div class="list-row b-step"><span class="b-step-n">${i + 1}.</span><span class="row-text"><span class="row-title">${esc(t)}</span></span></div>`).join("")
      : `<div class="list-row"><span class="row-text"><span class="row-title t-muted">No steps yet. Look for paperless or e-delivery in their account settings.</span></span></div>`, { header: "How to stop paper" })
    + section(`<label class="list-row" for="b-checkback"><span class="row-text"><span class="row-title">Check back</span></span><input type="date" class="b-date" id="b-checkback" value="${ymd(back)}" data-key="checkback"></label>`, { header: "Check back" })
    + section(`<div class="list-row"><span class="row-text"><span class="row-title">${esc(seenText(s))}</span></span></div>`, { header: "Seen" })
    + (primary ? `<div class="b-doc-actions">${primaryButton(primary[0], { "data-primary": primary[1], "data-key": "primary" })}</div>` : "");
}
registerScreen("sender", {
  title: (id) => lib.paperless.find((s) => s.id === id)?.issuer || "Sender",
  mount(el, { param, body, setTitle }) {
    const get = () => lib.paperless.find((s) => s.id === param);
    body.addEventListener("click", (e) => {
      const s = get(); if (!s) return;
      const menuBtn = e.target.closest("[data-status-menu]");
      if (menuBtn) {
        openMenu(menuBtn, STATUSES.map((v) => ({ label: PAPERLESS_LABEL[v], symbol: v === s.status ? "checkmark" : undefined, action: () => { if (v !== s.status) setStatus(s, v); } })), { align: "end" });
        return;
      }
      const p = e.target.closest("[data-primary]");
      if (p) setStatus(s, p.dataset.primary);
    });
    body.addEventListener("change", (e) => {
      const s = get();
      if (!s || e.target.id !== "b-checkback") return;
      const d = parseDay(e.target.value);
      if (d) { d.setHours(9); write(s.id, { checkBackAt: d.toISOString() }); }
    });
    const draw = () => {
      const s = get();
      if (s) setTitle(s.issuer, null);
      // Don't redraw under an open date field: it would close the picker.
      if (document.activeElement?.id === "b-checkback" && body.contains(document.activeElement)) return;
      rerender(body, detailBody(s));
    };
    el._unsub = onBrowse(draw);
    draw();
  },
  unmount(el) { el._unsub && el._unsub(); },
});
