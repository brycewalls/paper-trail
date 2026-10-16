// deck.js: Sort (spec 4.2, A1, A2, A9). Owner: deck. The web twin of the iPhone app's DeckScreen and
// DeckViewModel: the card (3.1), drag with rotation and springs, the File / Shred / Skip overlays
// (3.2), the action row Shred, Undo, Skip, File (3.3), the 10-second undo hold (decision 4), the
// Skipped set and its sheet (3.13, #77), Keep original confirm (4.14), the check-fields sheet for
// unsure cards (3.8, #20, through checkfields.js), bulk filing of confident cards (setting off by
// default, decision 5), the empty and reading states (3.11), keyboard arrows and screen reader copy
// (section 6). The card detail is detail.js. It also still owns adding documents (the file inputs
// the Scan menu opens until capture.js lands) and the reading pipeline (open one at a time, read
// two at a time), on items.js until the pipeline moves to db.js (#17).
//
// Every gesture, button, menu item and key calls one of file(), shred(), skip(), undo() (spec 1.7).
// After the hold, a decision goes to the outbox: outbox.release(id) once the local-first outbox
// (#17) exports it, the legacy enqueue / logShred until then.
import { FAKE, params, READERS, YEAR_FOLDERS } from "./config.js";
import { $, esc, slug, on, emit } from "./ui.js";
import { currentUser } from "./auth.js";
import { items, newItem, findItem, isPdf } from "./items.js";
import { classifyItem, readError, readErrorCode, normalize, unsureFields, isConfident, applySenderRule, markConfident } from "./classify.js";
import { openPdfDoc, renderPage, photoJpeg } from "./media.js";
import * as outbox from "./outbox.js";
import { deleteItem } from "./db.js";
import { renderDrive } from "./drive.js";
import { watchSettings, saveSettings } from "./store.js";
import { ruleList, rememberSender } from "./senders.js";
import { registerSettingsSection } from "./settings.js";
import { route, push } from "./router.js";
import { bindScanMenu } from "./shell.js";
import { icon } from "./ui/icons.js";
import { verdictBadge, verdictStamp, sensitiveChip, retentionChip, unsurePill, unsureRow, button, primaryButton, emptyState, section, row, docThumb, toggleRow } from "./ui/components.js";
import { openSheet, actionSheet, sheetOpen } from "./ui/sheet.js";
import { openMenu } from "./ui/menu.js";
import { spring, reduceMotion, haptic } from "./ui/motion.js";
import { openCheckFields } from "./checkfields.js";
import { READER } from "./lab/reader.js";
import { labChip, openCompare } from "./lab/compare.js";

// The lab build (#92) reads with rules, not Claude: its own reading and failure copy, and the
// compare chip on the card ("Claude agrees" / "Claude differs", lab/compare.js).
const LAB = READER === "rules";
on("lab:compared", () => render());
on("lab:progress", () => { if (!deckCards().length) render(); });

// The undo window (decision 4). ?hold=<seconds> shortens it on the fake backend, for tests.
const HOLD_MS = FAKE && params.has("hold") ? Math.max(0, Number(params.get("hold")) || 0) * 1000 : 10000;
const PEEK = [{ y: 22, s: 0.96 }, { y: 36, s: 0.92 }];   // spec 2.3 and Metrics.peekOffsets / peekScales

// ---------- formatting (DeckFormat) ----------
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const fmtDate = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? DAY.format(new Date(`${ymd}T00:00:00Z`)) : "");
export const folderName = (f) => String(f || "").replace(/^\d+\s+/, "");
// "Taxes › 2025" for the three year folders (decision 2); the year from docDate, else today's.
export function folderPath(card) {
  const name = folderName(card.folder);
  if (!YEAR_FOLDERS.includes(card.folder)) return name;
  const y = /^\d{4}/.test(card.docDate || "") ? card.docDate.slice(0, 4) : String(new Date().getFullYear());
  return `${name} › ${y}`;
}
export const meta = (card) => `${card.issuer || "Unknown sender"} · ${fmtDate(card.docDate) || "No date"}`;
const pagesText = (n) => (n === 1 ? "1 page" : `${n || 0} pages`);
export const FIELD_LABEL = { issuer: "Sender", docDate: "Date", folder: "Folder", title: "Title", filename: "Filename", verdict: "Verdict" };
// "Statement date" for a bill or statement, "Receipt date", "Claim date" for an EOB; else "Date".
export function dateLabel(docType) {
  const t = String(docType || "").toLowerCase();
  if (/bill|statement/.test(t)) return "Statement date";
  if (/receipt/.test(t)) return "Receipt date";
  if (/explanation of benefits|\beob\b/.test(t)) return "Claim date";
  return "Date";
}
function fieldDisplay(field, card) {
  const v = card[field];
  if (field === "docDate") return fmtDate(v) || "No date";
  if (field === "folder") return folderPath(card);
  if (field === "verdict") return verdictStamp(v);
  if (field === "filename") return `${v}.pdf`;
  return v || (field === "issuer" ? "Unknown sender" : "Untitled");
}

// ---------- the model (DeckViewModel) ----------
let last = null;          // the latest decision: { ids, decision: "file"|"shredOnly"|null (skip), side, prior, at, released }
let holdTimer = 0;
let offerBulkFile = false;

const mine = (i) => !i.uid || i.uid === currentUser()?.uid;
export const isReadFailed = (i) => i.stage === "failed" && i.failedStage === "reading";
const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt);
function heldIds() { return new Set(last && !last.released && last.decision ? last.ids : []); }
function waiting() {
  const held = heldIds();
  return items.filter((i) => mine(i) && (i.stage === "ready" || isReadFailed(i)) && !i.decision && !held.has(i.id)).sort(byCreated);
}
export const deckCards = () => waiting().filter((i) => !i.skippedAt);
export const skippedCards = () => waiting().filter((i) => i.skippedAt).sort((a, b) => a.skippedAt.localeCompare(b.skippedAt));
export const getItem = (id) => { const it = findItem(id); return it && mine(it) ? it : null; };
const readingCount = () => items.filter((i) => mine(i) && (i.stage === "captured" || i.stage === "reading")).length;
const isToday = (iso) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
const filedToday = () => items.filter((i) => mine(i) && i.decision && isToday(i.decidedAt)).length + heldIds().size;
export const checks = (it) => (!it || !it.card || isReadFailed(it) ? [] : unsureFields(it.card));
const confident = (it) => it.stage === "ready" && isConfident(it.card);
export const canUndo = () => !!last && (!last.released || !last.decision || typeof outbox.sendBack === "function");

// Every card change goes through here, so unsureFields stays in step with the confidence.
export function setCard(it, card) { it.card = card; it.unsureFields = unsureFields(card); }

export function subtitle() {
  const cards = deckCards(), reading = readingCount();
  if (!cards.length) return reading ? `${reading} reading` : "";
  const parts = [`${cards.length} to go`, `${cards.filter(confident).length} ready to file`];
  if (reading) parts.push(`${reading} reading`);
  return parts.join(" · ");
}
// Every confident card except the top one when the top is confident (the user is looking at it).
export function bulkCandidates() {
  const cards = deckCards(), list = cards.filter(confident);
  return cards[0] && confident(cards[0]) ? list.filter((i) => i !== cards[0]) : list;
}
function bulkTitle() {
  if (!offerBulkFile) return "";
  const n = bulkCandidates().length;
  if (n < 2) return "";
  return confident(deckCards()[0]) ? `File the other ${n} confident cards` : `File the ${n} confident cards`;
}

// "decided" | "needsCheck" | "needsKeepConfirm" | "unavailable"
export function file(it) {
  if (!it || !deckCards().includes(it) || !it.card || isReadFailed(it)) return "unavailable";
  if (checks(it).length) return "needsCheck";
  commit([it], "file", "file");
  return "decided";
}
export function shred(it, { confirmed = false } = {}) {
  if (!it || !deckCards().includes(it)) return "unavailable";
  if (it.card?.verdict === "keep_original" && !confirmed) return "needsKeepConfirm";
  commit([it], "shredOnly", "shred");
  return "decided";
}
// Swipe up (#77): off the deck into the Skipped set. Releases the previous hold like any decision.
export function skip(it) {
  if (!it || !deckCards().includes(it)) return "unavailable";
  releaseHeld();
  it.skippedAt = new Date().toISOString();
  last = { ids: [it.id], decision: null, side: "skip", prior: new Map(), at: it.skippedAt, released: true };
  emit("deck:skipped", { id: it.id });
  return "decided";
}
export function fileTogether(list) {
  const chosen = list.filter((i) => deckCards().includes(i) && confident(i));
  if (!chosen.length) return "unavailable";
  commit(chosen, "file", "file");
  return "decided";
}
function commit(list, decision, side) {
  releaseHeld();
  const prior = new Map(list.map((i) => [i.id, { stage: i.stage, failedStage: i.failedStage }]));
  last = { ids: list.map((i) => i.id), decision, side, prior, at: new Date().toISOString(), released: false };
  for (const i of list) emit("deck:decided", { id: i.id, decision });
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { releaseHeld(); render(); }, HOLD_MS);
}

// Ends the undo window: the held decision goes to the outbox. Called by the next decision, the
// 10-second timer, leaving Sort, and the page going to the background.
export function releaseHeld() {
  clearTimeout(holdTimer);
  if (!last || last.released) return;
  last.released = true;
  if (!last.decision) return;
  for (const id of last.ids) {
    const it = findItem(id);
    if (!it) continue;
    it.decision = last.decision;
    it.decidedAt = last.at;
    it.stage = "queued";
    toOutbox(it);
  }
}
function toOutbox(it) {
  // The deck's cards still live in items.js (in memory), so they reach the local-first outbox
  // through its bridge: enqueue / logShred copy the card and its PDF into db.js and release it at
  // once (the hold has already run here). The record is the card as the iPhone app writes it: the
  // check sheet's alternatives and appliedRule stay local.
  if (!it.card) setCard(it, normalize({ title: it.name, verdict: "shred" }));
  const { alternatives, appliedRule, ...card } = it.card;
  void alternatives; void appliedRule;
  setCard(it, card);
  if (it.decision === "file") { it.status = "filing"; outbox.enqueue(it); }
  else { it.status = "logging"; outbox.logShred(it); }
}

// One step back. Inside the hold the cards come back with nothing to reverse; after it the outbox
// sends them back (cancels the upload or trashes the Drive copy and removes the log entry).
// Resolves the side they left from, or null.
export async function undo() {
  if (!canUndo()) return null;
  const d = last;
  last = null;
  clearTimeout(holdTimer);
  if (!d.decision) {
    for (const id of d.ids) { const it = findItem(id); if (it) it.skippedAt = null; }
    return { side: "skip", ids: d.ids };
  }
  let back = d.ids.map(findItem).filter(Boolean);
  if (d.released) {
    const ok = [];
    for (const it of back) {
      // The bridge filed it under its own pipeline id; once sent back, that pipeline copy goes.
      const pid = it.pipelineId || it.id;
      if (await outbox.sendBack(pid)) { ok.push(it); if (it.pipelineId) { it.pipelineId = null; await deleteItem(pid).catch(() => {}); } }
    }
    back = ok;
  }
  for (const it of back) {
    const p = d.prior.get(it.id) || { stage: "ready", failedStage: "" };
    it.decision = null; it.decidedAt = null; it.status = "";
    it.stage = p.stage; it.failedStage = p.failedStage;
  }
  return { side: d.side, ids: back.map((i) => i.id) };
}

// The deck is ordered by createdAt (oldest on top); dealing to the front moves each card just ahead
// of the current top, in order. A skip being undone stops being the thing to undo.
function dealToFront(list) {
  if (!list.length) return;
  const front = deckCards()[0]?.createdAt || new Date().toISOString();
  const t0 = new Date(front).getTime();
  list.forEach((it, k) => { it.createdAt = new Date(t0 - (list.length - k)).toISOString(); it.skippedAt = null; });
  if (last && !last.decision && list.some((i) => last.ids.includes(i.id))) last = null;
}
export const sortSkipped = () => dealToFront(skippedCards());
export const sortNow = (it) => { if (skippedCards().includes(it)) dealToFront([it]); };

// "Done" in the card detail: edited fields count as confident; a card that failed to read gets its
// first card this way ("Fill it in yourself") and joins the deck.
export async function saveEdits(it, edited, { remember = false } = {}) {
  const original = it.card;
  let card = { ...edited };
  if (original && original.filename === card.filename) card.filename = followDate(card.filename, original.docDate, card.docDate);
  const changed = ["issuer", "docDate", "folder", "title", "filename", "verdict"].filter((k) => !original || original[k] !== card[k]);
  if (!original && !card.confidence) card.confidence = { overall: 1, fields: {}, sparse: true };
  card = markConfident(card, changed);
  setCard(it, card);
  it.edited = true;
  if (isReadFailed(it)) { it.stage = "ready"; it.failedStage = ""; it.errorMessage = ""; it.readErrorCode = ""; }
  if (remember) await rememberSender(card);
  render();
}
// When the date changes and the filename still starts with the old one, the prefix follows.
export function followDate(filename, oldDate, newDate) {
  if (!oldDate || !newDate || oldDate === newDate || !filename.startsWith(oldDate)) return filename;
  return newDate + filename.slice(oldDate.length);
}
// A blank card for "Fill it in yourself".
export const blankCard = (it) => it.card || normalize({ title: "", issuer: "", filename: "" });

export async function retryRead(it) {
  if (!isReadFailed(it) || it.openError) return;
  it.stage = "captured"; it.failedStage = ""; it.errorMessage = ""; it.readErrorCode = "";
  pump();
}

// ---------- adding documents and reading them (moves to capture.js and db.js) ----------
function add(it) { items.push(it); emit("item:added", it); }
// Each file is one document.
export function addEach(list) {
  for (const f of [...(list || [])]) add(newItem(f.name.replace(/\.[^.]+$/, ""), [f], currentUser()?.uid || ""));
  pump();
}
// All the photos are one document (PDFs in the list are ignored).
export function addAsOne(list, name) {
  const files = [...(list || [])].filter((f) => !isPdf(f));
  if (!files.length) return;
  add(newItem(name || `${files.length} photo${files.length > 1 ? "s" : ""}`, files, currentUser()?.uid || ""));
  pump();
}
$("file").addEventListener("change", (e) => { addEach(e.target.files); e.target.value = ""; });
$("pages-file").addEventListener("change", (e) => { addAsOne(e.target.files); e.target.value = ""; });
// Drop files anywhere on Sort (desktop).
$("view-sort").addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
$("view-sort").addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); addEach(e.dataTransfer.files); });

let opening = false, reading = 0, lastAnswer = 0;
// Two reads at once, except the first after a quiet spell goes alone so the prompt cache is written
// before the next read wants it (ReadingQueue, ARCHITECTURE "Prompt cache").
export function pump() {
  if (!currentUser()) return;
  if (!opening) {
    const next = items.find((i) => mine(i) && i.stage === "captured" && !i.opened);
    if (next) { opening = true; openItem(next).finally(() => { opening = false; pump(); }); }
  }
  const limit = Date.now() - lastAnswer < 240000 ? READERS : 1;
  while (reading < limit) {
    const next = items.find((i) => mine(i) && i.stage === "captured" && i.opened);
    if (!next) break;
    reading++;
    readItem(next).finally(() => { reading--; pump(); });
  }
  render();
}
async function openItem(it) {
  try {
    if (it.kind === "pdf") {
      const doc = await openPdfDoc(it.files[0]);
      try {
        it.numPages = doc.numPages;
        it.thumb = URL.createObjectURL(await renderPage(doc, 1, 900, 0.8));
      } finally { await doc.destroy(); }
    } else {
      it.numPages = it.files.length;
      it.thumb = URL.createObjectURL(await photoJpeg(it.files[0], 900, 0.8));
    }
    it.opened = true;
  } catch (err) {
    console.warn("Open failed", err);
    it.stage = "failed"; it.failedStage = "reading"; it.readErrorCode = "bad_request";
    it.openError = it.kind === "pdf"
      ? (err?.name === "PasswordException" ? "This PDF has a password. Remove it in Files, then add it again." : "This PDF didn't open. Check that it opens in Files, then add it again.")
      : "This photo didn't open. Use a JPEG or PNG.";
  }
}
async function readItem(it) {
  it.stage = "reading"; render();
  try {
    const card = await classifyItem(it, render, { senderHints: ruleList() });
    lastAnswer = Date.now();
    setCard(it, card);
    it.stage = "ready";
    emit("item:ready", it);
  } catch (e) {
    console.warn("Read failed", e);
    it.stage = "failed"; it.failedStage = "reading";
    it.readErrorCode = readErrorCode(e);
    it.errorMessage = readError(e);
  }
}

// A rule saved from one card lands on the cards from that sender still waiting (unless edited).
on("sender:saved", ({ key }) => {
  const rule = ruleList().find((r) => r.key === key);
  if (!rule) return;
  for (const it of waiting()) if (it.card && !it.edited && !it.card.appliedRule && slug(it.card.issuer) === key) setCard(it, applySenderRule(it.card, [rule]));
  render();
});

// The legacy outbox reports through "items:changed"; map its result onto the pipeline stages.
on("items:changed", () => {
  for (const it of items) {
    if (it.status === "done" && it.stage === "queued") { it.stage = "filed"; it.filedAt = new Date().toISOString(); }
    if (it.status === "failed" && it.stage === "queued") { it.stage = "failed"; it.failedStage = "uploading"; }
  }
  render();
});

// ---------- settings: "Offer to file confident cards together" (A8, decision 5: off) ----------
let unwatchSettings = null;
on("session:started", () => {
  if (unwatchSettings) unwatchSettings();
  unwatchSettings = watchSettings((s) => {
    const v = s.offerBulkFile === true;
    if (v !== offerBulkFile) { offerBulkFile = v; emit("settings:changed", { key: "offerBulkFile", value: v }); render(); }
  }, () => {});
});
on("session:ended", () => { if (unwatchSettings) unwatchSettings(); unwatchSettings = null; offerBulkFile = false; last = null; clearTimeout(holdTimer); render(); });
registerSettingsSection({
  id: "sorting", order: 32,
  render: () => section(toggleRow("Offer to file confident cards together", { checked: offerBulkFile, id: "set-bulk" }),
    { header: "Sorting", footer: "When it's on, Sort offers to file the cards Claude is sure about in one go. You still see each one in the list first." }),
  bind(el) {
    el.querySelector("#set-bulk").addEventListener("change", async (e) => {
      offerBulkFile = e.target.checked;
      emit("settings:changed", { key: "offerBulkFile", value: offerBulkFile });
      render();
      try { await saveSettings({ offerBulkFile }); } catch (err) { console.warn("Setting didn't save", err); }
    });
  },
});

// ---------- the view ----------
const els = {
  body: $("sort-body"), prompts: $("dk-prompts"), main: $("dk-main"), stack: $("dk-stack"), empty: $("dk-empty"),
  actions: $("dk-actions"), shred: $("dk-shred"), undo: $("dk-undo"), skip: $("dk-skip"), file: $("dk-file"), live: $("dk-live"),
};
let drag = null;          // the live gesture on the top card
let pendingRender = false;
let lastAnnounced = "";

// Room for the card: the deck area less the peeks, the gap and the action row, so the action row
// sits 20 under the lowest peek and the card hugs its content up to that (DeckStackLayout).
new ResizeObserver(() => {
  const h = els.main.clientHeight;
  els.main.style.setProperty("--card-max", `${Math.max(280, h - 8 - PEEK[1].y - 20 - 54)}px`);
}).observe(els.main);

export function render() {
  if (drag) { pendingRender = true; return; }
  pendingRender = false;
  const cards = deckCards(), skipped = skippedCards();
  $("deck-count").textContent = subtitle();
  renderPrompts(skipped);
  const top = cards[0];
  els.stack.classList.toggle("is-empty", !cards.length);
  els.actions.hidden = !cards.length;
  els.empty.hidden = !!cards.length;
  if (cards.length) renderStack(cards); else { clearStack(); renderEmpty(skipped); }
  els.shred.disabled = !top;
  els.skip.disabled = !top;
  els.file.disabled = !top || !top.card || isReadFailed(top);
  const undoable = canUndo();
  els.undo.disabled = !undoable;
  els.undo.setAttribute("aria-label", undoable ? "Undo last swipe" : "Undo, nothing to undo");
  const undoTitle = undoable ? findItem(last.ids[0])?.card?.title || "" : "";
  if (undoTitle) els.undo.setAttribute("aria-description", undoTitle); else els.undo.removeAttribute("aria-description");
  renderTrouble();
  renderDrive();
}

function renderPrompts(skipped) {
  const bulk = bulkTitle();
  const html = (skipped.length ? button(`${skipped.length} skipped`, { small: true, symbol: "arrow.up.forward", "data-act": "skipped", "aria-description": "Shows the cards you skipped." }) : "")
    + (bulk ? button(bulk, { small: true, "data-act": "bulk" }) : "");
  if (els.prompts.dataset.html !== html) { els.prompts.innerHTML = html; els.prompts.dataset.html = html; }
  els.prompts.hidden = !html;
}
els.prompts.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b?.dataset.act === "skipped") openSkippedSheet();
  if (b?.dataset.act === "bulk") openBulkSheet();
});

function renderEmpty(skipped) {
  const reading = readingCount(), today = filedToday();
  const done = today ? `${today} filed today. The outbox is handling the uploads.` : "";
  let html, key;
  if (skipped.length) {
    key = `skipped:${skipped.length}:${today}`;
    html = emptyState({ symbol: "arrow.up.forward.circle", title: `${skipped.length} skipped. Sort them now?`, description: done,
      actions: button("Sort skipped", { prominent: true, "data-act": "sort-skipped" }) + button("Scan more", { "data-scan": "" }) });
  } else if (reading) {
    const prog = LAB ? (items.find((i) => mine(i) && i.stage === "reading" && i.progress) || {}).progress || "" : "";
    key = `reading:${reading}:${prog}`;
    html = emptyState({ spinner: true, title: `Reading ${reading} document${reading === 1 ? "" : "s"}`,
      description: LAB ? (prog ? `${prog}. They show up here as soon as they're read.` : "They show up here as soon as they're read.") : "They show up here as soon as Claude is done.", role: "status" });
  } else if (items.some(mine)) {
    key = `sorted:${today}`;
    html = emptyState({ symbol: "checkmark.circle", title: "All sorted", description: done, actions: button("Scan more", { "data-scan": "" }) });
  } else {
    key = "first";
    html = emptyState({ symbol: "doc.viewfinder", title: "Scan your first stack", description: LAB ? "The lab reads each document on this device with rules, no AI, and gets it ready to file." : "Claude reads each document and gets it ready to file.",
      actions: button("Scan", { prominent: true, "data-scan": "" }) });
  }
  if (els.empty.dataset.key === key) return;
  els.empty.dataset.key = key;
  els.empty.innerHTML = html;
  els.empty.querySelectorAll("[data-scan]").forEach(bindScanMenu);
}
els.empty.addEventListener("click", (e) => {
  if (e.target.closest("[data-act=sort-skipped]")) { const n = skippedCards().length; sortSkipped(); render(); announce(`${n} card${n === 1 ? "" : "s"} back on the deck.`); focusCard(); }
});

// ----- the stack: two blank peeks and the top card (the peeks only show their bottom edges) -----
function clearStack() { els.stack.querySelectorAll(".dk-peek, .dk-card:not(.dk-ghost)").forEach((n) => n.remove()); els.stack.dataset.top = ""; }
function renderStack(cards) {
  const top = cards[0];
  const peeks = Math.min(2, cards.length - 1);
  const have = els.stack.querySelectorAll(".dk-peek").length;
  for (let k = have; k < peeks; k++) els.stack.insertAdjacentHTML("afterbegin", '<div class="dk-peek" aria-hidden="true"></div>');
  [...els.stack.querySelectorAll(".dk-peek")].slice(peeks).forEach((n) => n.remove());
  [...els.stack.querySelectorAll(".dk-peek")].reverse().forEach((n, k) => { n.style.setProperty("--peek-y", `${PEEK[k].y}px`); n.style.setProperty("--peek-s", PEEK[k].s); n.style.zIndex = 2 - k; });
  const html = cardHtml(top);
  const cur = els.stack.querySelector(".dk-card:not(.dk-ghost)");
  if (cur && cur.dataset.id === top.id && cur.dataset.html === html) return;
  const hadFocus = cur && cur.contains(document.activeElement);
  const el = document.createElement("article");
  el.className = "dk-card";
  el.dataset.id = top.id;
  el.dataset.html = html;
  el.tabIndex = 0;
  el.setAttribute("aria-roledescription", "card");
  el.setAttribute("aria-label", cardLabel(top));
  el.setAttribute("aria-keyshortcuts", "ArrowRight ArrowLeft ArrowUp Enter");
  el.setAttribute("aria-description", "Right arrow files, left arrow shreds, up arrow skips. Enter opens the details.");
  el.innerHTML = html;
  if (cur) cur.replaceWith(el); else els.stack.append(el);
  bindCard(el, top);
  if (hadFocus) el.focus({ preventScroll: true });
}

function cardHtml(it) {
  const failed = isReadFailed(it) || !it.card;
  const c = it.card || {};
  const unsure = failed ? [] : checks(it);
  const has = (f) => unsure.includes(f);
  const page = it.thumb ? `<img src="${esc(it.thumb)}" alt="" draggable="false">` : `<span class="dk-page-none">${icon("doc")}</span>`;
  const shredLabel = c.verdict === "keep_original" && !failed ? "Shred? Asks first" : "Shred";
  const well = `<div class="dk-well${unsure.length ? " short" : ""}">
      <div class="dk-page">${page}</div>
      <div class="dk-badges">${unsure.length ? unsurePill(unsure.length) : ""}${failed ? "" : verdictBadge(c.verdict)}</div>
      <span class="dk-pages">${pagesText(it.numPages)}</span>
      <span class="dk-ov dk-ov-file" aria-hidden="true">${icon("checkmark")}File</span>
      <span class="dk-ov dk-ov-shred" aria-hidden="true">${icon("xmark")}${esc(shredLabel)}</span>
      <span class="dk-ov dk-ov-skip" aria-hidden="true">${icon("arrow.up.forward")}Skip</span>
    </div>`;
  if (failed) {
    return `${well}<div class="dk-body">
      <h2 class="dk-title">Couldn't read this one</h2>
      <p class="dk-meta">${esc(it.openError || (LAB ? "The lab reader stopped on this one. Your scan is saved." : "Claude didn't answer. Your scan is saved."))}</p>
      <div class="dk-fail-actions">${it.openError ? "" : button("Try again", { "data-act": "retry" })}${button("Fill it in yourself", { "data-act": "fill" })}</div>
    </div>`;
  }
  const ur = (f) => unsureRow(fieldDisplay(f, c), { "data-check": f, "aria-label": `${f === "docDate" ? dateLabel(c.docType) : FIELD_LABEL[f]}: ${fieldDisplay(f, c)}, not sure. Check it.` });
  const lines = [];
  lines.push(has("title") ? ur("title") : `<h2 class="dk-title">${esc(c.title)}</h2>`);
  if (has("issuer") || has("docDate")) {
    for (const f of ["issuer", "docDate"]) lines.push(has(f) ? ur(f) : `<p class="dk-meta">${esc(fieldDisplay(f, c))}</p>`);
  } else lines.push(`<p class="dk-meta">${esc(meta(c))}</p>`);
  lines.push(has("folder") ? ur("folder") : `<p class="dk-folder">${icon("folder")}<span>${esc(folderPath(c))}</span></p>`);
  if (c.sensitive || c.retention) lines.push(`<div class="dk-chips">${c.sensitive ? sensitiveChip() : ""}${retentionChip(c.retention)}</div>`);
  lines.push(has("filename") ? ur("filename") : `<p class="dk-filename">${esc(c.filename)}.pdf</p>`);
  if (has("verdict")) lines.push(ur("verdict"));
  const chip = labChip(it);
  if (chip) lines.push(`<div class="dk-lab">${chip}</div>`);
  return `${well}<div class="dk-body">${lines.join("")}</div>`;
}

// VoiceOver / screen reader label (section 6).
export function cardLabel(it) {
  if (isReadFailed(it) || !it.card) return LAB ? "Couldn't read this one. The lab reader stopped. Your scan is saved." : "Couldn't read this one. Claude didn't answer. Your scan is saved.";
  const c = it.card;
  const parts = [`${c.title}.`, `${c.issuer || "Unknown sender"}, ${fmtDate(c.docDate) || "No date"}.`, `${verdictStamp(c.verdict)}.`, `Folder ${folderName(c.folder)}.`];
  if (c.sensitive) parts.push("Sensitive.");
  if (c.retention) parts.push(`${c.retention}.`);
  const u = checks(it);
  if (u.length) parts.push(`${u.length} ${u.length === 1 ? "field" : "fields"} to check: ${u.map((f) => (f === "docDate" ? dateLabel(c.docType) : FIELD_LABEL[f]).toLowerCase()).join(", ")}.`);
  return parts.join(" ");
}

// ----- the gesture (spec 2.7) -----
const threshold = (w) => Math.max(110, 0.3 * w);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rotFor = (tx, w) => (reduceMotion() ? 0 : clamp((tx / Math.max(1, w)) * 10, -10, 10));
const poseCss = ({ tx = 0, ty = 0, rot = 0 } = {}) => `translate(${tx}px, ${ty}px) rotate(${rot}deg)`;

function bindCard(el, it) {
  const failed = isReadFailed(it) || !it.card;
  el.addEventListener("click", (e) => {
    if (el.dataset.dragged) { delete el.dataset.dragged; return; }
    const chk = e.target.closest("[data-check]");
    if (chk) { e.stopPropagation(); openCheck(it, chk.dataset.check); return; }
    if (e.target.closest("[data-lab-compare]")) { e.stopPropagation(); openCompare(it, { onApply: (card) => { setCard(it, card); render(); } }); return; }
    const act = e.target.closest("[data-act]");
    if (act?.dataset.act === "retry") { retryRead(it); return; }
    if (act?.dataset.act === "fill" || !act) openDetail(it);
  });
  el.addEventListener("keydown", (e) => {
    if (e.target !== el) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(it); }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = el.getBoundingClientRect(); cardMenu(el, it, r.left + 24, r.top + 24); }
  });
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); cardMenu(el, it, e.clientX, e.clientY); });

  el.addEventListener("pointerdown", (e) => {
    delete el.dataset.dragged;
    // A drag can start anywhere on the card, the Not sure rows included; a tap still taps them.
    if (e.button !== 0 || drag || e.target.closest("a, input, textarea, select")) return;
    const g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: null, w: el.offsetWidth, h: els.stack.offsetHeight, pose: {}, samples: [], crossed: {}, el, it };
    g.long = setTimeout(() => { if (!g.mode) { drag = null; cardMenu(el, it, g.x0, g.y0); el.dataset.dragged = "1"; } }, 500);
    drag = g;
    sample(g, e);
  });
  el.addEventListener("pointermove", (e) => {
    const g = drag;
    if (!g || g.el !== el || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      clearTimeout(g.long);
      if (failed) { drag = null; render(); return; }        // swipes are off on a failed card (3.1)
      g.mode = -dy > Math.abs(dx) ? "up" : "x";
      try { el.setPointerCapture(g.id); } catch { /* the pointer already left */ }
      el.getAnimations().forEach((an) => an.cancel());       // a drag interrupts the promote or undo spring
      el.classList.add("dragging");
    }
    sample(g, e);
    g.pose = g.mode === "up" ? { tx: dx * 0.15, ty: dy, rot: 0 } : { tx: dx, ty: dy * 0.15, rot: rotFor(dx, g.w) };
    el.style.transform = poseCss(g.pose);
    paintOverlays(el, g);
  });
  const end = (e) => {
    const g = drag;
    if (!g || g.el !== el || e.pointerId !== g.id) return;
    clearTimeout(g.long);
    drag = null;
    if (!g.mode) { if (pendingRender) render(); return; }
    el.dataset.dragged = "1";                              // the click that follows isn't a tap
    el.classList.remove("dragging");
    const T = threshold(g.w);
    const v = velocity(g);
    const { tx, ty } = g.pose;
    let side = null;
    if (e.type === "pointerup") {
      // Past the threshold, or a flick whose projected end passes twice it (predictedEndTranslation).
      if (g.mode === "up") { if (-ty >= T || (ty < 0 && -(ty + v.y * 250) >= 2 * T)) side = "skip"; }
      else {
        const proj = tx + v.x * 250;
        if (Math.abs(tx) >= T) side = tx > 0 ? "file" : "shred";
        else if (Math.abs(proj) >= 2 * T && Math.sign(proj) === Math.sign(tx)) side = proj > 0 ? "file" : "shred";
      }
    }
    if (side) act(side, it, { pose: g.pose, w: g.w });
    else snapBack(el);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
function sample(g, e) { g.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY }); while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift(); }
function velocity(g) {
  const s = g.samples, a = s[0], b = s[s.length - 1];
  if (!a || !b || b.t - a.t < 8) return { x: 0, y: 0 };
  return { x: (b.x - a.x) / (b.t - a.t), y: (b.y - a.y) / (b.t - a.t) };
}
function paintOverlays(el, g) {
  const T = threshold(g.w);
  const p = { file: g.mode === "x" ? g.pose.tx / T : 0, shred: g.mode === "x" ? -g.pose.tx / T : 0, skip: g.mode === "up" ? -g.pose.ty / T : 0 };
  for (const side of ["file", "shred", "skip"]) {
    const ov = el.querySelector(`.dk-ov-${side}`);
    ov.style.opacity = clamp(p[side], 0, 1);
    const crossed = p[side] >= 1;
    ov.classList.toggle("crossed", crossed);
    if (crossed && !g.crossed[side]) haptic("light");   // once per outward crossing (2.6)
    g.crossed[side] = crossed;
  }
}
function clearOverlays(el) { el.querySelectorAll(".dk-ov").forEach((o) => { o.style.opacity = ""; o.classList.remove("crossed"); }); }
function snapBack(el) {
  const from = el.style.transform || "none";
  el.style.transform = "";
  clearOverlays(el);
  if (from !== "none" && from !== "") el.animate([{ transform: from }, { transform: "none" }], { ...spring("snap"), fill: "none" });
  if (pendingRender) render();
}

// ----- deciding: the one path for swipes, buttons, keys and the menu -----
export async function act(side, it, gesture = null) {
  if (!it) return;
  const fromButton = !gesture;
  if (sheetOpen()) return;
  const el = els.stack.querySelector(`.dk-card[data-id="${CSS.escape(it.id)}"]:not(.dk-ghost)`);
  const outcome = side === "file" ? file(it) : side === "shred" ? shred(it) : skip(it);
  if (outcome === "decided") {
    if (fromButton) haptic("light");
    leave(side, el, gesture);
    return;
  }
  if (el) snapBack(el);
  if (outcome === "needsCheck") openCheck(it);
  else if (outcome === "needsKeepConfirm") confirmKeep(it);
}
// The card flies off (with the gesture's pose, or from rest for a button), the next one rises.
function leave(side, el, gesture) {
  const title = el ? findItem(el.dataset.id)?.card?.title : "";
  const decidedId = el?.dataset.id;
  if (el) {
    // Out of the stack's flow at the same spot, so the next card can take its place underneath.
    Object.assign(el.style, { position: "absolute", left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` });
    el.classList.add("dk-ghost");
    el.classList.remove("dragging");
    el.removeAttribute("tabindex");
    el.setAttribute("aria-hidden", "true");
    el.inert = true;
    const w = gesture?.w || el.offsetWidth, h = els.stack.offsetHeight;
    const from = gesture?.pose || { tx: 0, ty: 0, rot: 0 };
    if (!gesture) { const T = threshold(w); paintOverlays(el, { mode: side === "skip" ? "up" : "x", pose: side === "skip" ? { ty: -T } : { tx: side === "file" ? T : -T }, w, crossed: { file: true, shred: true, skip: true } }); }
    let frames;
    if (reduceMotion()) frames = [{ opacity: 1, transform: poseCss(from) }, { opacity: 0, transform: poseCss(from) }];
    else if (side === "skip") frames = [{ transform: poseCss(from), opacity: 1 }, { transform: poseCss({ tx: from.tx, ty: -1.2 * h }), opacity: 0 }];
    else { const x = (side === "file" ? 1.5 : -1.5) * w; frames = [{ transform: poseCss(from) }, { transform: poseCss({ tx: x, ty: from.ty, rot: rotFor(x, w) }) }]; }
    const anim = el.animate(frames, { ...spring("flyoff"), fill: "forwards" });
    anim.finished.then(() => el.remove(), () => el.remove());
  }
  render();
  const top = els.stack.querySelector(".dk-card:not(.dk-ghost)");
  if (top && top.dataset.id !== decidedId) promote(top);
  announce(after(side, title));
  focusCard();
}
function promote(el) {
  if (reduceMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  else el.animate([{ transform: `translateY(${PEEK[0].y}px) scale(${PEEK[0].s})` }, { transform: "none" }], { ...spring("promote"), fill: "none" });
}
function after(side, title) {
  const next = deckCards()[0];
  const skipped = skippedCards().length;
  if (!next) {
    const rest = skipped ? `${skipped} skipped. Sort them now?` : "All sorted.";
    return side === "skip" ? `Skipped ${title}. ${rest}` : rest;
  }
  const nextTitle = next.card?.title || "a card that couldn't be read";
  if (side === "file") return `Filed ${title}. Next: ${nextTitle}.`;
  if (side === "shred") return `Shredded ${title}.`;
  return `Skipped ${title}. Next: ${nextTitle}.`;
}

export async function undoLast() {
  const r = await undo();
  if (!r) return;
  render();
  const el = els.stack.querySelector(".dk-card:not(.dk-ghost)");
  if (el && r.ids.includes(el.dataset.id)) {
    const w = el.offsetWidth, h = els.stack.offsetHeight;
    let from;
    if (r.side === "skip") from = poseCss({ ty: -1.2 * h });
    else { const x = (r.side === "file" ? 1.5 : -1.5) * w; from = poseCss({ tx: x, rot: rotFor(x, w) }); }
    if (reduceMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    // fill "none": a filled animation would keep overriding the drag's inline transform afterwards.
    else el.animate([{ transform: from, opacity: r.side === "skip" ? 0 : 1 }, { transform: "none", opacity: 1 }], { ...spring("undo"), fill: "none" });
  }
  focusCard();
}

async function confirmKeep(it) {
  const reason = it.card?.verdictReason || "";
  const choice = await actionSheet({ title: "Shred a Keep original?", message: `Claude marked this one to keep the paper. ${reason}`.trim(),
    actions: [{ label: "Shred anyway", value: "shred", destructive: true }] });
  if (choice !== "shred") { focusCard(); return; }
  if (shred(it, { confirmed: true }) === "decided") leave("shred", els.stack.querySelector(`.dk-card[data-id="${CSS.escape(it.id)}"]`), null);
}

// The check-fields sheet (3.8). Confirm writes the values, saves the rule when asked, then files the
// card like a swipe right. Swiping the sheet down leaves the card as it was.
export async function openCheck(it, focus) {
  if (!it?.card || sheetOpen()) return;
  const result = await openCheckFields({ card: it.card, fields: checks(it), focus });
  if (!result) { focusCard(); return; }
  setCard(it, result.card);
  it.edited = true;
  if (result.remember) rememberSender(result.card);   // never blocks filing
  if (deckCards()[0] === it) act("file", it); else { file(it); render(); }
}

function openDetail(it) { push("card", it.id); }
// The detail's Shred and File bar: once the deck shows again, the same path as the action row.
// The caller pops the detail right after.
export function detailDecide(it, side) {
  const off = on("route:changed", (r) => {
    if (!(r.isTab && r.tab === "sort" && !r.stack.length)) return;
    off();
    requestAnimationFrame(() => act(side, it));
  });
}

function cardMenu(el, it, x, y) {
  const anchor = document.createElement("span");
  anchor.className = "dk-menu-anchor";
  const r = el.getBoundingClientRect();
  anchor.style.left = `${x - r.left}px`; anchor.style.top = `${y - r.top}px`;
  el.append(anchor);
  const failed = isReadFailed(it) || !it.card;
  openMenu(anchor, [
    { label: "File", symbol: "checkmark", disabled: failed, action: () => act("file", it) },
    { label: "Shred", symbol: "xmark", action: () => act("shred", it) },
    { label: "Skip", symbol: "arrow.up.forward", action: () => act("skip", it) },
    { label: "Edit details", symbol: "pencil", action: () => openDetail(it) },
  ], { align: "start" });
  // The anchor is only a position; drop it once the menu closes.
  const gone = new MutationObserver(() => { if (!document.querySelector(".menu")) { anchor.remove(); gone.disconnect(); } });
  gone.observe($("overlay"), { childList: true });
}

// ----- the action row and keys -----
els.shred.addEventListener("click", () => act("shred", deckCards()[0]));
els.file.addEventListener("click", () => act("file", deckCards()[0]));
els.skip.addEventListener("click", () => act("skip", deckCards()[0]));
els.undo.addEventListener("click", () => undoLast());
const onSortRoot = () => { const r = route(); return r.isTab && r.tab === "sort" && !r.stack.length; };
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || $("app").hidden || !onSortRoot() || sheetOpen() || !$("scanner").hidden || document.querySelector(".menu")) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") { if (canUndo()) { e.preventDefault(); undoLast(); } return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const top = deckCards()[0];
  if (!top) return;
  const side = { ArrowRight: "file", ArrowLeft: "shred", ArrowUp: "skip" }[e.key];
  if (side) { e.preventDefault(); act(side, top); }
});

function focusCard() {
  // Keep the screen reader and keyboard on the deck after an action (@AccessibilityFocusState).
  const a = document.activeElement;
  if (a && a !== document.body && !els.main.contains(a) && !a.closest?.(".dk-card")) return;
  requestAnimationFrame(() => (els.stack.querySelector(".dk-card:not(.dk-ghost)") || els.undo).focus({ preventScroll: true }));
}
function announce(text) {
  if (!text) return;
  lastAnnounced = text;
  els.live.textContent = "";
  requestAnimationFrame(() => { els.live.textContent = lastAnnounced; });
}

// ----- sheets: Skipped (3.13) and bulk file (section 5) -----
function openSkippedSheet() {
  if (sheetOpen()) return;
  const rowsHtml = () => skippedCards().map((it) => {
    const title = isReadFailed(it) || !it.card ? "Couldn't read this one" : it.card.title || "Document";
    const sub = it.card && !isReadFailed(it) && it.card.issuer ? meta(it.card) : "";
    return row({ leading: docThumb(it.thumb), title, subtitle: sub, trailing: button("Sort now", { small: true, "data-sort-now": it.id, "aria-label": `Sort now: ${title}` }), "data-skipped-row": it.id });
  }).join("");
  const n = skippedCards().length;
  const s = openSheet({ title: `${n} skipped`, label: "Skipped", className: "dk-sheet",
    body: section(rowsHtml(), { footer: "Saved on your phone until you sort them. Nothing uploads while they wait." }),
    footer: primaryButton("Sort skipped", { "data-sort-all": "" }) });
  const refresh = () => {
    const left = skippedCards().length;
    if (!left) { s.close("done"); return; }
    s.el.querySelector(".sheet-title").textContent = `${left} skipped`;
    s.body.querySelector(".group-body").innerHTML = rowsHtml();
  };
  s.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort-now]");
    if (!b) return;
    const it = findItem(b.dataset.sortNow);
    sortNow(it); render(); announce(`${it.card?.title || "The card"} is on top of the deck.`); refresh();
  });
  s.footer.querySelector("[data-sort-all]").addEventListener("click", () => {
    const n2 = skippedCards().length;
    sortSkipped(); render(); s.close("done");
    announce(`${n2} card${n2 === 1 ? "" : "s"} back on the deck.`);
  });
  s.closed.then(() => focusCard());
}

function openBulkSheet() {
  if (sheetOpen()) return;
  const list = bulkCandidates();
  if (list.length < 2) return;
  const on = new Set(list.map((i) => i.id));
  const rowHtml = (it) => {
    const checked = on.has(it.id);
    return row({ tag: "button", leading: docThumb(it.thumb), title: it.card.title, role: "checkbox", "aria-checked": String(checked), "data-bulk": it.id,
      trailing: verdictBadge(it.card.verdict) + `<span class="dk-check${checked ? " on" : ""}">${icon(checked ? "checkmark.circle.fill" : "circle")}</span>` });
  };
  const s = openSheet({ title: `File ${list.length} confident cards`, subtitle: "Claude is sure about every field on these. Each one goes to the outbox like a swipe right.",
    label: "File confident cards", className: "dk-sheet",
    body: section(list.map(rowHtml).join(""), { footer: "Keep original cards still keep their paper." }),
    footer: primaryButton(`File ${list.length}`, { "data-bulk-go": "" }) });
  const go = s.footer.querySelector("[data-bulk-go]");
  s.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-bulk]");
    if (!b) return;
    const id = b.dataset.bulk;
    if (on.has(id)) on.delete(id); else on.add(id);
    b.outerHTML = rowHtml(findItem(id));
    s.body.querySelector(`[data-bulk="${CSS.escape(id)}"]`)?.focus();
    go.querySelector("span").textContent = `File ${on.size}`;
    go.disabled = !on.size;
  });
  go.addEventListener("click", () => {
    const chosen = list.filter((i) => on.has(i.id));
    if (fileTogether(chosen) !== "decided") return;
    haptic("light");
    s.close("done");
    render();
    announce(deckCards().length ? `Filed ${chosen.length} cards.` : "All sorted.");
  });
}

// ----- legacy: uploads that failed in the in-memory outbox (the Outbox screen replaces this) -----
function renderTrouble() {
  const bad = items.filter((i) => mine(i) && i.stage === "failed" && i.failedStage === "uploading");
  const el = $("trouble");
  const html = bad.length ? section(bad.map((i) => row({ leading: docThumb(i.thumb), title: i.card?.title || i.name, subtitle: i.error || "Drive didn't take this one. Tap Retry to try again.",
    trailing: button("Retry", { small: true, "data-retry": i.id }) })).join(""), { header: "Needs attention" }) : "";
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
$("trouble").addEventListener("click", (e) => {
  const b = e.target.closest("[data-retry]");
  const it = b && findItem(b.dataset.retry);
  if (!it) return;
  it.error = ""; it.stage = "queued"; it.failedStage = "";
  if (it.decision === "file") { it.status = "filing"; outbox.enqueue(it); } else { it.status = "logging"; outbox.logShred(it); }
  render();
});

// ----- the hold ends when Sort is left or the page goes to the background -----
on("route:changed", (r) => { if (!(r.isTab && r.tab === "sort")) { releaseHeld(); render(); } });
document.addEventListener("visibilitychange", () => { if (document.hidden) { releaseHeld(); render(); } });
addEventListener("pagehide", () => releaseHeld());
