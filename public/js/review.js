// review.js: the scan review (spec 4.11, A3; imports land here too, 4.15), the web twin of the iPhone
// app's ScanReviewScreen and ScanReviewViewModel. Pages are grouped into documents; each group is
// read as it forms: text (the PDF's own text layer, or OCR of the picture), one PDF built with a
// hidden text layer (or an imported PDF's own bytes when the group is exactly that file), its SHA-256
// and the duplicate check (#2), then Claude through the reading queue (classify.readItem).
//
//   - scissors between two pages split a document; "Join" between two documents merges the lower one
//     into the one above; a long press (or right click) on a page offers Rotate and Delete page
//   - tap a page: the full-screen page viewer (viewer.js, #78)
//   - "Split into documents" (#19, stack mode) asks Claude where each document in a pile starts
//   - a scanned pile (#54): a multi-page scan group is read for text and built at once, but
//     Claude's read waits until the split is decided ("Reads when you split or send"): Split into
//     documents finishing (split, one document, or failed), a cut or join, or Send. Imports and
//     photos read at once
//   - "Send {d} to the deck": read groups go now, the rest as they finish (capture:sent)
//   - Cancel asks "Discard {p} pages?"
//   - "Scan more" / "Add more" is the Scan menu (#79); capture.js adds what it brings to this review
//
// Where documents go: when a pipeline store is attached (attachStore, the db.js interface in
// docs/web-contract.md "Local pipeline"), items and their PDFs are written there and the review itself
// is saved after every change, so it reopens after a reload. Until db.js lands, capture:sent carries
// the items and their blobs in memory, and main.js hands them to the legacy deck.
// Owner: capture.
import { $, esc, on, emit } from "./ui.js";
import { currentUser } from "./auth.js";
import { findByHash } from "./store.js";
import { readItem, proposeSplit, SPLIT } from "./classify.js";
import { openPdfDoc, pageImage, pdfPageText, ocr, assemblePdf, sha256Hex } from "./media.js";
import { primaryButton, statusPill, choiceChip } from "./ui/components.js";
import { icon } from "./ui/icons.js";
import { bindMenu, openMenu, closeMenu } from "./ui/menu.js";
import { actionSheet, sheetOpen } from "./ui/sheet.js";
import { openViewer, refreshViewer, closeViewer, viewerOpen } from "./viewer.js";


const THUMB_EDGE = 260;          // 66 x 86 pt at 3x
const ITEM_THUMB_EDGE = 600;     // the deck card's thumbnail
const FULL_EDGE = 2800;          // a PDF or turned page in the viewer
const MAX_FULL_TEXT = 100_000;   // fullText on the doc
const HELD = "Reads when you split or send";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const uuid = () => crypto.randomUUID();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const newGroup = (pageIds, label = null) => ({ id: uuid(), pageIds, skipped: false, sent: false, label });

let current = null;          // the review on screen
const all = new Set();       // every review still working (a sent one keeps reading its groups)
const sentHashes = new Map();// hash -> { title, date }: sent this visit, for "Already scanned"
let store = null;

// The pipeline store (db.js). main.js attaches it once db.js exists; see the header.
export function attachStore(s) { store = s; }
export const reviewOpen = () => !!current;
export const reviewKind = () => current && current.kind;
// For tests: the review on screen (or the last one) as plain data.
let last = null;
export const reviewState = () => (current || last ? (current || last).snapshot() : null);

// pages: [{ image: Blob } | { pdf: File, index }] each with an optional sourceName; groups: lists of
// indexes into pages, one per document. With a review open, the pages join it instead: a scan onto
// a scan appends to its last document (Scan more), anything else adds documents.
export function openReview(kind, pages, groups) {
  if (current) { current.add(pages, kind === "scan" && current.kind === "scan" ? "appendToLast" : groups); return current; }
  current = last = new Review({ kind, pages, groups });
  current.show();
  return current;
}

// "Already filed on Oct 2 as 2025 W-2." (spec 3.12); "Already scanned" for one still on this device.
export function duplicateLine(d) {
  let s = d.kind === "filed" ? "Already filed" : "Already scanned";
  const t = new Date(d.date || "");
  if (!Number.isNaN(t.getTime())) s += ` on ${MONTHS[t.getMonth()]} ${t.getDate()}${t.getFullYear() !== new Date().getFullYear() ? `, ${t.getFullYear()}` : ""}`;
  if (d.title) s += ` as ${d.title}`;
  return s + ".";
}

class Review {
  constructor({ kind, pages = [], groups = [], id, createdAt, held }) {
    this.id = id || uuid();
    this.kind = kind;
    this.createdAt = createdAt || new Date().toISOString();
    this.pages = pages.map((p) => this.makePage(p));
    this.groups = groups.map((g) => (Array.isArray(g) ? newGroup(g.map((i) => this.pages[i].id)) : { ...g }));
    this.states = new Map();       // group id -> { status, page, header, duplicate, item, pdf, thumb }
    this.undecided = new Set(held || (kind === "scan" ? this.groups.filter((g) => g.pageIds.length > 1).map((g) => g.id) : []));
    this.split = { state: "idle" };
    this.sent = false;
    this.inserted = new Set();
    this.thumbs = new Map();       // page id -> object URL
    this.texts = new Map();        // `${page.id}-${turns}` -> Promise<{ text, words, width }>
    this.pdfDocs = new Map();      // File -> Promise<pdf.js doc>
    this.savedBlobs = new Set();
    this.fileKeys = new WeakMap();
    this.queued = false;
    all.add(this);
  }
  makePage(p) {
    return { id: p.id || uuid(), image: p.image || null, pdf: p.pdf || null, index: p.index ?? null, sourceName: p.sourceName || "", turns: p.turns || 0 };
  }

  // ---------- what the screen shows ----------
  pagesOf(g) { return g.pageIds.map((id) => this.pages.find((p) => p.id === id)).filter(Boolean); }
  pageCount() { return this.groups.reduce((n, g) => n + g.pageIds.length, 0); }
  sendCount() { return this.groups.filter((g) => !g.skipped).length; }
  title() {
    const docs = plural(this.groups.length, "document", "documents");
    if (this.kind === "files") return `${plural(new Set(this.groups.flatMap((g) => this.pagesOf(g)).map((p) => p.pdf || p.id)).size, "file", "files")}, ${docs}`;
    if (this.kind === "photos") return `${plural(this.pageCount(), "photo", "photos")}, ${docs}`;
    return `${plural(this.pageCount(), "page", "pages")}, ${docs}`;
  }
  header(g) {
    const st = this.states.get(g.id) || { status: "reading", page: 1 };
    if (st.status === "read") return { text: st.header, read: true };
    if (st.status === "failed") return { text: "Couldn't read this one", failed: true };
    if (st.status === "held") return { text: g.label || HELD, held: true };
    return { text: g.label || `Reading page ${st.page || 1}` };
  }
  hasStack() { return this.groups.some((g) => g.pageIds.length > 1); }
  offersSplit() { return !this.sent && this.hasStack() && (this.split.state === "idle" || this.split.state === "failed"); }
  splitDetail() {
    switch (this.split.state) {
      case "splitting": return "Finding where each document starts";
      case "done": return this.split.documents === 1 ? "Claude thinks this is one document. Split it with the scissors if not." : `Claude found ${this.split.documents} documents. Fix any split with the scissors or Join.`;
      case "failed": return "Claude couldn't split this stack. Split it with the scissors, or try again.";
      default: return "Claude finds where each document starts. You can change any split after.";
    }
  }
  snapshot() {
    return {
      kind: this.kind, title: this.title(), sent: this.sent, split: this.split.state, splitDetail: this.splitDetail(), documents: this.groups.length, pages: this.pageCount(),
      groups: this.groups.map((g) => { const st = this.states.get(g.id) || {}; return { id: g.id, pages: g.pageIds.length, skipped: g.skipped, label: g.label, status: st.status || "reading", header: this.header(g).text, duplicate: st.duplicate ? duplicateLine(st.duplicate) : "", item: st.item || null }; }),
    };
  }

  // ---------- the screen ----------
  show() {
    const root = $("review");
    this.opener = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add("covered");
    // Everything else in the column goes inert; sheets and menus still mount in #overlay.
    for (const el of $("app").children) if (el !== root && el.id !== "overlay" && el.id !== "viewer" && !el.inert) { el.inert = true; el.dataset.reviewInert = "1"; }
    this.draw();
    root.querySelector(".review-cancel").focus({ preventScroll: true });
    this.persist();
    this.pages.forEach((p) => this.loadThumb(p));
    this.groups.forEach((g) => this.process(g));
  }
  hide() {
    const root = $("review");
    root.hidden = true;
    root.innerHTML = "";
    document.documentElement.classList.remove("covered");
    for (const el of $("app").children) if (el.dataset.reviewInert) { el.inert = false; delete el.dataset.reviewInert; }
    if (current === this) current = null;
    const o = this.opener;
    if (o && o.isConnected && !o.closest("[inert]") && !o.closest("[hidden]")) o.focus({ preventScroll: true });
    else document.querySelector("#view-sort:not([hidden]) [data-scan-menu]")?.focus({ preventScroll: true });
  }
  render() {
    if (current !== this || this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (current === this) this.draw(); });
  }
  draw() {
    const root = $("review");
    const scroller = root.querySelector(".review-scroll");
    const keep = scroller ? scroller.scrollTop : 0;
    const strips = new Map([...root.querySelectorAll("[data-strip]")].map((s) => [s.dataset.strip, s.scrollLeft]));
    const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const more = this.kind === "scan" ? "Scan more" : "Add more";
    const showSplit = this.split.state === "splitting" || this.split.state === "done" ? !this.sent : this.offersSplit();
    root.innerHTML = `
      <div class="review-bar">
        <button type="button" class="nav-text-btn review-cancel" data-focus="cancel">Cancel</button>
        <span></span>
        <button type="button" class="nav-text-btn review-more" data-scan-more data-focus="more">${esc(more)}</button>
      </div>
      <div class="review-scroll">
        <div class="review-head">
          <h1 class="review-title" id="review-title">${esc(this.title())}</h1>
          <p class="review-subtitle">Tap between pages to split or join</p>
        </div>
        ${showSplit ? `<section class="group review-split"><div class="group-body">${this.splitRow()}</div></section>` : ""}
        ${this.groups.map((g, i) => this.groupHtml(g, i)).join("")}
      </div>
      <div class="review-send">
        ${primaryButton(`Send ${this.sendCount()} to the deck`, { disabled: !this.sendCount() || this.sent, "data-send": "", "data-focus": "send" })}
        <p class="review-foot">${store ? "Saved on your phone. Nothing is lost if you close the app." : "Keep this page open until you send them."}</p>
      </div>`;
    root.querySelector(".review-scroll").scrollTop = keep;
    for (const [id, left] of strips) { const s = root.querySelector(`[data-strip="${CSS.escape(id)}"]`); if (s) s.scrollLeft = left; }
    if (focusKey) root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    this.bind(root);
    if (viewerOpen()) refreshViewer();
  }
  splitRow() {
    const d = esc(this.splitDetail());
    if (this.split.state === "idle") return `<button type="button" class="list-row two-line split-offer" data-split data-focus="split"><span class="row-leading">${icon("rectangle.split.3x1")}</span>
      <span class="row-text"><span class="row-title">Split into documents</span><span class="row-subtitle">${d}</span></span></button>`;
    if (this.split.state === "splitting") return `<div class="list-row split-busy" role="status"><span class="spinner" aria-hidden="true"></span><span class="row-text"><span class="row-subtitle">${d}</span></span></div>`;
    if (this.split.state === "done") return `<div class="list-row split-done" role="status"><span class="row-leading">${icon("checkmark.circle.fill")}</span><span class="row-text"><span class="row-title">${d}</span></span></div>`;
    return `<div class="list-row two-line split-failed" role="status"><span class="row-leading">${icon("exclamationmark.triangle.fill")}</span>
      <span class="row-text"><span class="row-title">${d}</span><span><button type="button" class="link-btn" data-split data-focus="split">Try again</button></span></span></div>`;
  }
  groupHtml(g, i) {
    const st = this.states.get(g.id) || {};
    const h = this.header(g);
    const pages = this.pagesOf(g);
    let before = 0;
    for (const x of this.groups) { if (x === g) break; before += x.pageIds.length; }
    const strip = pages.map((p, k) => {
      const n = before + k + 1;
      const cut = k < pages.length - 1 ? `<button type="button" class="split-here" data-cut="${esc(g.id)}" data-after="${k}" data-focus="cut-${esc(p.id)}" aria-label="Split here" title="Split here" aria-description="Makes a new document starting after page ${n}.">${icon("scissors")}</button>` : "";
      const url = this.thumbs.get(p.id);
      return `<button type="button" class="page-thumb" data-page="${esc(p.id)}" data-focus="page-${esc(p.id)}" aria-label="Page ${n}" aria-description="Opens the page full screen. Long press, or Shift F10, for Rotate and Delete page.">${url ? `<img src="${esc(url)}" alt="" draggable="false">` : '<span class="spinner" aria-hidden="true"></span>'}</button>${cut}`;
    }).join("");
    const dup = st.duplicate ? `<div class="dup-line"><p>${icon("exclamationmark.triangle.fill")}<span>${esc(duplicateLine(st.duplicate))}</span></p>
      <div class="dup-chips" role="radiogroup" aria-label="Duplicate">${choiceChip("Skip", { on: g.skipped, "data-skip": g.id, "data-focus": `skip-${g.id}` })}${choiceChip("File again", { on: !g.skipped, "data-again": g.id, "data-focus": `again-${g.id}` })}</div></div>` : "";
    return `${i > 0 ? `<div class="join-wrap"><button type="button" class="join-btn" data-join="${esc(g.id)}" data-focus="join-${esc(g.id)}" aria-description="Joins this document with the one above.">${icon("link")}<span>Join</span></button></div>` : ""}
      <section class="group review-group${g.skipped ? " skipped" : ""}" data-group="${esc(g.id)}" aria-label="Document ${i + 1}">
        <div class="group-body"><div class="review-doc">
          <div class="review-doc-head"><p class="doc-h${h.read ? " read" : ""}">${esc(h.text)}</p>${h.failed || h.held ? "" : statusPill(h.read ? "read" : "reading")}</div>
          ${dup}
          <div class="page-strip" data-strip="${esc(g.id)}">${strip}</div>
        </div></div>
      </section>`;
  }
  bind(root) {
    root.querySelector(".review-cancel").addEventListener("click", () => this.cancel());
    bindMenu(root.querySelector("[data-scan-more]"), scanItems, { align: "end" });
    root.querySelector("[data-send]").addEventListener("click", () => this.send());
    root.querySelectorAll("[data-split]").forEach((b) => b.addEventListener("click", () => this.splitIntoDocuments()));
    root.querySelectorAll("[data-cut]").forEach((b) => b.addEventListener("click", () => this.splitGroup(b.dataset.cut, Number(b.dataset.after))));
    root.querySelectorAll("[data-join]").forEach((b) => b.addEventListener("click", () => this.joinGroup(b.dataset.join)));
    root.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => this.setSkipped(b.dataset.skip, true)));
    root.querySelectorAll("[data-again]").forEach((b) => b.addEventListener("click", () => this.setSkipped(b.dataset.again, false)));
    root.querySelectorAll("[data-page]").forEach((b) => {
      const id = b.dataset.page;
      let timer = 0, long = false;
      b.addEventListener("click", (e) => { if (long) { long = false; e.preventDefault(); return; } this.openPage(id); });
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); this.pageMenu(b, id); });
      b.addEventListener("keydown", (e) => { if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") { e.preventDefault(); this.pageMenu(b, id); } });
      b.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") return;
        long = false; clearTimeout(timer);
        timer = setTimeout(() => { long = true; this.pageMenu(b, id); }, 500);
      });
      const stop = () => clearTimeout(timer);
      ["pointerup", "pointercancel", "pointerleave", "pointermove"].forEach((t) => b.addEventListener(t, (e) => { if (t !== "pointermove" || Math.abs(e.movementX) + Math.abs(e.movementY) > 4) stop(); }));
    });
  }
  pageMenu(anchor, id) {
    closeMenu();
    openMenu(anchor, [
      { label: "Rotate", symbol: "rotate.right", action: () => this.rotate(id) },
      { label: "Delete page", symbol: "trash", destructive: true, action: () => this.deletePage(id) },
    ], { align: "start" });
  }

  // ---------- editing ----------
  splitGroup(gid, after) {
    if (this.sent) return;
    const at = this.groups.findIndex((g) => g.id === gid);
    if (at < 0) return;
    const ids = this.groups[at].pageIds;
    if (after < 0 || after >= ids.length - 1) return;
    this.replace(at, [newGroup(ids.slice(0, after + 1)), newGroup(ids.slice(after + 1))]);
  }
  joinGroup(gid) {
    if (this.sent) return;
    const at = this.groups.findIndex((g) => g.id === gid);
    if (at <= 0) return;
    const merged = newGroup([...this.groups[at - 1].pageIds, ...this.groups[at].pageIds]);
    this.drop(this.groups[at]);
    this.undecided.delete(this.groups[at].id);
    this.groups.splice(at, 1);
    this.replace(at - 1, [merged]);
  }
  rotate(pid) {
    const p = this.pages.find((x) => x.id === pid);
    if (this.sent || !p) return;
    p.turns = (p.turns + 1) % 4;
    this.loadThumb(p);
    const at = this.groups.findIndex((g) => g.pageIds.includes(pid));
    if (at >= 0) this.replace(at, [newGroup([...this.groups[at].pageIds], this.groups[at].label)], { keepsHold: true });
  }
  deletePage(pid) {
    const at = this.groups.findIndex((g) => g.pageIds.includes(pid));
    if (this.sent || at < 0) return;
    const rest = this.groups[at].pageIds.filter((x) => x !== pid);
    this.pages = this.pages.filter((p) => p.id !== pid);
    if (this.thumbs.has(pid)) { URL.revokeObjectURL(this.thumbs.get(pid)); this.thumbs.delete(pid); }
    if (rest.length) { this.replace(at, [newGroup(rest, this.groups[at].label)], { keepsHold: true }); return; }
    this.drop(this.groups[at]);
    this.undecided.delete(this.groups[at].id);
    this.groups.splice(at, 1);
    if (!this.groups.length) { this.discard(); return; }
    this.persist();
    this.render();
  }
  setSkipped(gid, skipped) {
    const g = this.groups.find((x) => x.id === gid);
    if (!g || this.sent) return;
    g.skipped = skipped;
    this.persist();
    this.render();
  }
  // keepsHold: still the same undecided pile (a page turned or deleted). holds: the new groups are
  // undecided piles (pages scanned onto the end). Otherwise the split is decided: read them once built.
  replace(at, groups, { keepsHold = false, holds = false } = {}) {
    const old = this.groups[at];
    const pile = holds || (keepsHold && this.undecided.has(old.id));
    this.undecided.delete(old.id);
    this.drop(old);
    this.groups.splice(at, 1, ...groups);
    if (pile) groups.filter((g) => g.pageIds.length > 1).forEach((g) => this.undecided.add(g.id));
    this.persist();
    groups.forEach((g) => this.process(g));
    this.render();
  }
  // Adds pages (Scan more, Add more). placement: "appendToLast", or index lists into `pages`.
  add(pages, placement) {
    if (this.sent || !pages.length) return;
    const made = pages.map((p) => this.makePage(p));
    this.pages.push(...made);
    if (this.split.state !== "splitting") this.split = { state: "idle" };   // new pages may be a new stack
    made.forEach((p) => this.loadThumb(p));
    if (placement === "appendToLast" && this.groups.length) {
      const at = this.groups.length - 1;
      // Scan more onto a pile makes it a pile again: hold its read for the split (#54).
      this.replace(at, [newGroup([...this.groups[at].pageIds, ...made.map((p) => p.id)])], { holds: this.kind === "scan" });
      return;
    }
    const lists = placement === "appendToLast" ? [made.map((_, i) => i)] : placement;
    const add = lists.map((ix) => newGroup(ix.map((i) => made[i].id)));
    this.groups.push(...add);
    this.persist();
    add.forEach((g) => this.process(g));
    this.render();
  }
  // Forgets a group's read, unless it already went to the deck.
  drop(g) { if (!this.inserted.has(g.id)) this.states.delete(g.id); }
  isCurrent(gid) { return this.groups.some((g) => g.id === gid); }

  // ---------- reading a group ----------
  process(g) {
    this.states.set(g.id, { status: "reading", page: 1 });
    this.read(g).catch((e) => {
      console.warn("Couldn't build the document", e);
      const st = this.states.get(g.id);
      if (st && this.isCurrent(g.id)) { st.status = "failed"; this.render(); }
    });
  }
  async read(g) {
    const gid = g.id;
    const pages = this.pagesOf(g);
    const found = [];
    for (let i = 0; i < pages.length; i++) {
      if (!this.isCurrent(gid)) return;
      this.states.get(gid).page = i + 1;
      this.render();
      found.push(await this.textFor(pages[i]));
    }
    if (!this.isCurrent(gid)) return;
    const pdf = await this.buildPdf(pages, found);
    if (!this.isCurrent(gid)) return;
    const [hash, thumb] = await Promise.all([sha256Hex(pdf), pageImage(pages[0], ITEM_THUMB_EDGE, 0.8, await this.pdfDocFor(pages[0]))]);
    if (!this.isCurrent(gid)) return;
    const st = this.states.get(gid);
    const u = currentUser();
    const item = {
      id: uuid(), createdAt: new Date().toISOString(), uid: u ? u.uid : "", stage: "captured", origin: this.kind, source: "web",
      name: g.label || (pages[0].sourceName || "").replace(/\.[^.]+$/, "") || `${this.kind === "scan" ? "Scan" : "Photos"}, ${plural(pages.length, "page", "pages")}`,
      pages: pages.length, sizeBytes: pdf.size, contentHash: hash,
      ocrText: found.map((t) => t.text).filter(Boolean).join("\n\n").slice(0, MAX_FULL_TEXT),
      card: null, unsureFields: [], readErrorCode: null,
    };
    item.whenRead = new Promise((r) => { st.settle = r; });
    Object.assign(st, { item, pdf, thumb, duplicate: duplicateFor(hash) });
    if (this.sent) this.insert(gid);
    // A scanned pile waits here, read for text and built, until its split is decided (#54).
    if (this.undecided.has(gid) && !this.sent) { st.status = "held"; this.render(); return; }
    await this.classify(gid);
  }
  async classify(gid) {
    const st = this.states.get(gid);
    if (!st || !st.item) return;
    st.status = "reading";
    st.page = st.item.pages;
    this.render();
    await readItem(st.item, { pdf: st.pdf });
    st.status = st.item.stage === "ready" ? "read" : "failed";
    const c = st.item.card;
    st.header = c ? [c.docType, c.issuer].filter(Boolean).join(" · ") || c.title : "";
    st.settle(st.item);
    if (this.inserted.has(gid) && store) await store.updateItem(st.item.id, plainItem(st.item)).catch((e) => console.warn("Couldn't save the read", e));
    this.render();
    this.finishIfDone();
  }
  // The split is decided for every held pile: read them.
  releaseHeld() { const ids = [...this.undecided]; this.undecided.clear(); ids.forEach((id) => this.readHeld(id)); }
  decide(gid) { if (this.undecided.delete(gid)) this.readHeld(gid); }
  // A group still being built reads on its own once built, since it's no longer undecided.
  readHeld(gid) { const st = this.states.get(gid); if (st && st.status === "held" && st.item) this.classify(gid); }

  // One page's text: the PDF's own text layer, or OCR of the picture (also of a scanned PDF page
  // with no text of its own). Cached per page and turn.
  textFor(p) {
    const key = `${p.id}-${p.turns}`;
    if (!this.texts.has(key)) {
      this.texts.set(key, (async () => {
        if (p.pdf) {
          const doc = await this.pdfDocFor(p);
          const own = await pdfPageText(doc, p.index + 1).catch(() => "");
          if (own.replace(/\s+/g, "")) return { text: own, words: [], width: 0 };
          return { ...(await ocr(await pageImage(p, 2000, 0.9, doc))), words: [], width: 0 };
        }
        const r = await ocr(p.image, p.turns);
        return { text: r.text, words: r.words, width: r.width };
      })());
    }
    return this.texts.get(key);
  }
  pdfDocFor(p) {
    if (!p.pdf) return Promise.resolve(null);
    if (!this.pdfDocs.has(p.pdf)) this.pdfDocs.set(p.pdf, openPdfDoc(p.pdf));
    return this.pdfDocs.get(p.pdf);
  }
  // An imported PDF's own bytes when the group is exactly that file, untouched; otherwise assembled.
  async buildPdf(pages, found) {
    const first = pages[0];
    if (first.pdf && pages.every((p) => p.pdf === first.pdf && !p.turns)) {
      const doc = await this.pdfDocFor(first);
      if (doc && pages.length === doc.numPages && pages.every((p, i) => p.index === i)) return first.pdf;
    }
    return assemblePdf(pages.map((p, i) => (p.pdf ? { pdf: p.pdf, index: p.index, turns: p.turns } : { image: p.image, turns: p.turns, words: found[i].words, wordsWidth: found[i].width })));
  }

  // ---------- stack mode (#19) ----------
  async splitIntoDocuments() {
    if (!this.offersSplit()) return;
    this.split = { state: "splitting" };
    this.render();
    let ok = true;
    for (const g of this.groups.filter((x) => x.pageIds.length > 1)) {
      if (this.sent) return;
      if (!(await this.propose(g))) ok = false;
    }
    if (this.split.state === "splitting") this.split = ok ? { state: "done", documents: this.groups.length } : { state: "failed" };
    // Split, one document or failed (kept as it was): the split is decided, so read what's left.
    this.releaseHeld();
    this.render();
  }
  // Asks for one group's split and applies it. False when it failed (the pages stay as they were);
  // true when applied, or when an edit or Send made it moot.
  async propose(g) {
    const pages = this.pagesOf(g);
    if (pages.length > SPLIT.maxPages) return false;
    const withImages = pages.length <= SPLIT.maxImages;
    const input = [];
    for (const p of pages) {
      if (!this.isCurrent(g.id) || this.sent) return true;
      const t = await this.textFor(p);
      input.push({ text: t.text, image: withImages ? await pageImage(p, SPLIT.thumbEdge, 0.8, await this.pdfDocFor(p)).catch(() => null) : null });
    }
    let docs;
    try { docs = await proposeSplit(input); } catch (e) { console.warn("Split failed", e); return !this.isCurrent(g.id) || this.sent; }
    // The person split, joined or edited while Claude was proposing, or sent: their call wins.
    const at = this.groups.findIndex((x) => x.id === g.id);
    if (at < 0 || this.sent) return true;
    if (docs.length === 1) {
      this.groups[at].label = docs[0].label || null;
      this.persist();
      this.decide(g.id);
      this.render();
      return true;
    }
    const ids = g.pageIds;
    this.replace(at, docs.map((d) => newGroup(ids.slice(d.start, d.end + 1), d.label || null)));
    return true;
  }

  // ---------- the page viewer (#78) ----------
  position(pid) {
    let before = 0;
    for (let i = 0; i < this.groups.length; i++) {
      const at = this.groups[i].pageIds.indexOf(pid);
      if (at >= 0) return { page: before + at + 1, pages: this.pageCount(), document: i + 1, pageInDocument: at + 1, documentPages: this.groups[i].pageIds.length };
      before += this.groups[i].pageIds.length;
    }
    return null;
  }
  openPage(pid) {
    if (this.sent || viewerOpen()) return;
    const groupAt = (id) => this.groups[this.position(id).document - 1];
    const review = $("review");
    openViewer({
      ids: () => this.groups.flatMap((g) => g.pageIds),
      position: (id) => this.position(id),
      canCut: (id) => { const s = this.position(id); return !this.sent && !!s && s.pageInDocument < s.documentPages; },
      hasCutBefore: (id) => { const s = this.position(id); return !!s && s.pageInDocument === 1 && s.document > 1; },
      hasCutAfter: (id) => { const s = this.position(id); return !!s && s.pageInDocument === s.documentPages && s.document < this.groups.length; },
      cut: (id) => { this.splitGroup(groupAt(id).id, this.position(id).pageInDocument - 1); this.draw(); },
      joinBefore: (id) => { this.joinGroup(groupAt(id).id); this.draw(); },
      joinAfter: (id) => { this.joinGroup(this.groups[this.position(id).document].id); this.draw(); },
      thumb: (id) => this.thumbs.get(id) || "",
      thumbEl: (id) => review.querySelector(`[data-page="${CSS.escape(id)}"]`),
      full: async (id) => {
        const p = this.pages.find((x) => x.id === id);
        if (!p) return null;
        if (p.image && !p.turns) return p.image;
        return pageImage(p, FULL_EDGE, 0.9, await this.pdfDocFor(p));
      },
      // While paging, the strip follows, so closing zooms back into the page's thumbnail.
      onPage: (id) => review.querySelector(`[data-page="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "center" }),
      onClose: (id) => {
        const t = review.querySelector(`[data-page="${CSS.escape(id)}"]`);
        if (t) { t.scrollIntoView({ block: "nearest", inline: "center" }); t.focus({ preventScroll: true }); }
      },
    }, pid);
  }

  // ---------- thumbnails ----------
  async loadThumb(p) {
    const turns = p.turns;
    try {
      const blob = await pageImage(p, THUMB_EDGE, 0.8, await this.pdfDocFor(p));
      if (!this.pages.includes(p) || p.turns !== turns) return;
      if (this.thumbs.has(p.id)) URL.revokeObjectURL(this.thumbs.get(p.id));
      this.thumbs.set(p.id, URL.createObjectURL(blob));
      if (current !== this) return;
      const b = $("review").querySelector(`[data-page="${CSS.escape(p.id)}"]`);
      if (b) b.innerHTML = `<img src="${esc(this.thumbs.get(p.id))}" alt="" draggable="false">`;
    } catch (e) { console.warn("Couldn't draw a page", e); }
  }

  // ---------- send and discard ----------
  // "Send {d} to the deck": read groups go now, the rest join the deck as they finish.
  send() {
    if (this.sent || !this.sendCount()) return;
    closeViewer();
    this.sent = true;
    for (const g of this.groups) if (g.skipped) this.drop(g); else this.insert(g.id);
    this.groups = this.groups.filter((g) => !g.skipped);
    this.persist();
    this.releaseHeld();   // Send keeps each pile as one document: read it now (#54)
    this.hide();
    this.finishIfDone();
  }
  insert(gid) {
    const st = this.states.get(gid);
    if (this.inserted.has(gid) || !st || !st.item) return;
    this.inserted.add(gid);
    const g = this.groups.find((x) => x.id === gid);
    if (g) g.sent = true;
    const item = st.item;
    sentHashes.set(item.contentHash, { title: item.card ? item.card.title : item.name, date: item.createdAt });
    if (store) {
      Promise.all([store.putBlob(`items/${item.id}.pdf`, st.pdf), store.putBlob(`items/${item.id}.thumb.jpg`, st.thumb)])
        .then(() => store.putItem(plainItem(item)))
        .then(() => emit("capture:sent", { ids: [item.id] }), (e) => console.warn("Couldn't save the document", e));
    } else {
      emit("capture:sent", { ids: [item.id], items: [item], blobs: { [item.id]: { pdf: st.pdf, thumb: st.thumb } } });
    }
  }
  // Once every sent group is on the deck and read, the review's pages aren't needed.
  finishIfDone() {
    if (!this.sent || !this.groups.every((g) => this.inserted.has(g.id) && ["read", "failed"].includes(this.states.get(g.id)?.status))) return;
    if (store) store.deleteReview(this.id).catch(() => {});
    this.release();
  }
  release() {
    for (const url of this.thumbs.values()) URL.revokeObjectURL(url);
    this.thumbs.clear(); this.texts.clear();
    for (const d of this.pdfDocs.values()) d.then((doc) => doc.destroy(), () => {});
    this.pdfDocs.clear();
    all.delete(this);
  }
  async cancel() {
    const choice = await actionSheet({ title: `Discard ${plural(this.pageCount(), "page", "pages")}?`, actions: [{ label: "Discard", value: "discard", destructive: true }], cancel: "Keep editing" });
    if (choice === "discard") this.discard();
  }
  // Cancel, then Discard: nothing reaches the deck and every page is let go.
  discard() {
    closeViewer();
    this.undecided.clear();
    this.groups = [];
    if (store) { store.deleteReview(this.id).catch(() => {}); store.kvSet("openReview", "").catch(() => {}); }
    this.hide();
    this.release();
  }

  // ---------- saving the review (db.js reviews store, when attached) ----------
  persist() {
    if (!store || this.sent) return;
    const key = (p) => (p.image ? `review/${this.id}/${p.id}.jpg` : `review/${this.id}/${this.fileKey(p.pdf)}.pdf`);
    const pages = this.pages.map((p) => ({ id: p.id, sourceName: p.sourceName, turns: p.turns, index: p.index, [p.image ? "blob" : "pdf"]: key(p) }));
    const blobs = this.pages.map((p) => [key(p), p.image || p.pdf]).filter(([k]) => !this.savedBlobs.has(k));
    Promise.all(blobs.map(([k, b]) => store.putBlob(k, b).then(() => this.savedBlobs.add(k))))
      .then(() => store.putReview({ session: this.id, kind: this.kind, createdAt: this.createdAt, pages, groups: this.groups.map((g) => ({ ...g })), held: [...this.undecided] }))
      .then(() => store.kvSet("openReview", this.id))
      .catch((e) => console.warn("Couldn't save the review", e));
  }
  fileKey(f) { if (!this.fileKeys.has(f)) this.fileKeys.set(f, uuid()); return this.fileKeys.get(f); }
}

// The Scan menu (#79): the same three items as shell.js scanMenuItems(). review.js sits below the
// shell, so it builds them here; capture.js adds what they bring to this review.
const scanItems = () => [
  { label: "Scan document", symbol: "doc.viewfinder", action: () => emit("capture:request", { source: "camera" }) },
  { label: "Import from Files", symbol: "folder", action: () => emit("capture:request", { source: "files" }) },
  { label: "Import from Photos", symbol: "photo", action: () => emit("capture:request", { source: "photos" }) },
];
function duplicateFor(hash) {
  const filed = findByHash(hash);
  if (filed) return { kind: "filed", title: filed.title || "", date: filed.filedAt || "" };
  const here = sentHashes.get(hash);
  return here ? { kind: "onPhone", title: here.title, date: here.date } : null;
}
// The item as db.js stores it: no promises.
const plainItem = (it) => Object.fromEntries(Object.entries(it).filter(([k, v]) => k !== "whenRead" && typeof v !== "function"));

// Reopens a review left open when the page closed (spec 4.11). Once per launch, after sign-in.
export async function resumeReview() {
  if (!store || current) return;
  const id = await store.kvGet("openReview").catch(() => null);
  const saved = id && await store.getReview(id).catch(() => null);
  if (!saved || current) return;
  const files = new Map();
  const pages = [];
  for (const p of saved.pages) {
    if (p.blob) { const b = await store.getBlob(p.blob).catch(() => null); if (b) pages.push({ ...p, image: b }); continue; }
    if (!files.has(p.pdf)) files.set(p.pdf, await store.getBlob(p.pdf).catch(() => null));
    const f = files.get(p.pdf);
    if (f) pages.push({ ...p, pdf: f instanceof File ? f : new File([f], p.sourceName || "document.pdf", { type: "application/pdf" }) });
  }
  const groups = saved.groups.filter((g) => !g.sent).map((g) => ({ ...g, pageIds: g.pageIds.filter((x) => pages.some((p) => p.id === x)) })).filter((g) => g.pageIds.length);
  if (!groups.length) { store.deleteReview(id).catch(() => {}); return; }
  current = last = new Review({ id: saved.session, kind: saved.kind, createdAt: saved.createdAt, pages, groups, held: (saved.held || []).filter((h) => groups.some((g) => g.id === h)) });
  current.show();
}

// Leaving with an unsent review and nowhere to keep it: the browser asks first.
addEventListener("beforeunload", (e) => { if (current && !store) { e.preventDefault(); e.returnValue = ""; } });
on("session:ended", () => { if (current) current.discard(); });
// Escape: the review's Cancel, unless a sheet, a menu or the viewer has it.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !current || viewerOpen() || sheetOpen() || document.querySelector(".menu")) return;
  e.preventDefault();
  current.cancel();
});
