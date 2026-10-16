// outbox.js: the local-first outbox (#17), the twin of the iPhone app's LiveOutboxService. Owner:
// outbox. Every decided item is in IndexedDB (db.js) with its PDF, and this engine walks it through
// Drive and Firestore one at a time, oldest decision first:
//
//   queued    -> folders found, MD5 and SHA-256 taken, resumable session started     -> uploading
//   uploading -> bytes sent in chunks (#1), resuming from Drive's offset after a reload
//             -> Firestore record (users/{uid}/docs/{item id}) and paperless sender  -> filed
//   filed     -> Drive's md5Checksum compared with the local MD5 (#18)               -> verified
//
// A shred decision skips Drive: record written, then filed. Failures back off 1, 2, 5 and 15
// minutes, then wait for Retry (Needs attention). No connection and Drive needing a reconnect pause
// the queue without using up a retry; scanning and sorting carry on. The deck's 10-second undo hold
// (decision 4) is respected: a queued item waits for release(id) or 10 s after decidedAt, so a reload
// mid-hold can't upload early or lose the decision.
//
// The deck writes { stage: "queued", decision, decidedAt } at the swipe and calls release(id) when
// the hold ends (the next decision, 10 s, or leaving Sort). Undo inside the hold just puts the item
// back; after it, sendBack(id) cancels the upload, or trashes the Drive copy and deletes the record.
//
// Emits "outbox:status" (the accessory state, spec 3.7) and "doc:verified". Pure rules (where a file
// goes, retry delays, the record, the accessory and row copy) are exported for outbox-view.js and
// the tests. Legacy: enqueue(it) / logShred(it) take the in-memory deck's items until the deck moves
// onto db.js; they copy the item into the pipeline and release it straight away.
import { FOLDER_NAMES, YEAR_FOLDERS, FAKE, params } from "./config.js";
import { slug, cleanName, on, emit } from "./ui.js";
import * as auth from "./auth.js";
import { getItem, putItem, updateItem, listItems, putBlob, getBlob, deleteBlob, deleteItem } from "./db.js";
import { md5, sha256Hex } from "./md5.js";
import { haptic } from "./ui/motion.js";
import { putDoc, updateDoc, removeDoc, getSender, createSender, updateSender } from "./store.js";
import { DriveError, DRIVE_COPY, needsDrive, setNeedsDrive, renderDrive, ensureFolders, ensureYearFolder,
  startUpload, putChunk, uploadStatus, metadata, download, trash, CHUNK } from "./drive.js";
import { photosToPdf, openPdfDoc } from "./media.js";

// ---------- rules ----------
export const UNDO_MS = 10 * 1000;
export const KEEP_FILES_MS = 10 * 60 * 1000;       // a late Undo can still send a finished card back
export const HISTORY_DAYS = 30;                    // Earlier
// Spec 3.12: automatic backoff of 1, 2, 5 and 15 minutes, then Needs attention. ?fastretry (fake
// backend only) makes them seconds, for the tests.
export const RETRY_DELAYS = (FAKE && params.has("fastretry") ? [1, 2, 3, 4] : [60, 120, 300, 900]).map((s) => s * 1000);
export const retryDelay = (attempts) => (attempts >= 1 && attempts <= RETRY_DELAYS.length ? RETRY_DELAYS[attempts - 1] : null);
const chunkSize = () => (FAKE && Number(params.get("chunk")) > 0 ? Number(params.get("chunk")) : CHUNK);

// Every outbox string, spec 3.7, 3.12 and 4.4 (the iPhone app's OutboxCopy).
export const COPY = {
  driveDidntAnswer: "Drive didn't answer.",
  retriesUsedUp: "Drive didn't take this one. Tap Retry to try again.",
  folderMoved: "The Drive folder moved. Rebuilding it.",
  logFailed: "Filed in Drive, but it didn't save to your log. Tap Retry to try again.",
  shredLogFailed: "Couldn't save this to your log. Tap Retry to try again.",
  checking: "Checking the Drive copy",
  nextInLine: "Next in line",
  waitingForConnection: "Waiting for a connection",
  reconnectFailed: "Drive didn't reconnect. Try again in a minute.",
  noCard: "This card has no details yet. Send it back to the deck.",
  noFile: "This scan isn't on this device anymore. Scan it again to file it.",
  pageMismatch: (drive, local, reuploading) => `Drive has ${drive} of ${local} ${local === 1 ? "page" : "pages"}. `
    + (reuploading ? "Uploading it again." : "Tap Retry to upload it again."),
  retrying: (next, now = Date.now()) => `Drive didn't answer. Trying again in ${Math.max(1, Math.ceil((new Date(next) - now) / 60000))} min.`,
};

// Where one document lands in Paperwork Archive (decision 2): a year subfolder only in 02 Taxes,
// 03 Money & Banking and 05 Medical, the year from docDate, falling back to the filing date.
export function driveTarget(folder, docDate, filedAt) {
  const f = FOLDER_NAMES.includes(folder) ? folder : "11 Other";
  if (!YEAR_FOLDERS.includes(f)) return { folder: f, year: null };
  const head = String(docDate || "").slice(0, 4), y = Number(head);
  if (/^\d{4}$/.test(head) && y >= 1900 && y <= 2200) return { folder: f, year: head };
  return { folder: f, year: String(new Date(filedAt || Date.now()).getFullYear()) };
}

// Lowercased tokens for array-contains search (#22): title, issuer, docType, the folder's name, the
// year and the amount, as the iPhone app's OutboxRecord.searchTerms.
export function searchTerms(card, filedAt) {
  const folderName = String(card.folder || "").split(" ").slice(1).join(" ");
  const year = driveTarget("02 Taxes", card.docDate, filedAt).year || "";
  const text = [card.title, card.issuer, card.docType, folderName, year, card.amount].filter(Boolean).join(" ").toLowerCase();
  return [...new Set(text.split(/[^\p{L}\p{N}.-]+/u).map((t) => t.replace(/^[.-]+|[.-]+$/g, "")).filter((t) => t.length > 1))];
}

const iso = (d = Date.now()) => new Date(d).toISOString();
// users/{uid}/docs/{id}: the card flattened in plus the outbox's fields (docs/web-contract.md,
// "Firestore data model"). The same shape as the iPhone app's OutboxRecord.filedDoc, source "web".
export function buildRecord(it, filedAt) {
  const c = it.card || {};
  const filed = it.decision === "file";
  const folder = FOLDER_NAMES.includes(c.folder) ? c.folder : "11 Other";
  return {
    title: c.title || "", docType: c.docType || "", issuer: c.issuer || "", docDate: c.docDate || "", summary: c.summary || "",
    folder, filename: c.filename || "", verdict: c.verdict || "scan_shred", verdictReason: c.verdictReason || "", retention: c.retention || "",
    sensitive: !!c.sensitive, paperless: { possible: !!c.paperless?.possible, issuer: c.paperless?.issuer || "", how: c.paperless?.how || "" },
    pages: it.pages || 0, filed,
    driveId: filed ? it.driveId || "" : "", driveUrl: filed ? it.driveUrl || "" : "",
    physical: filed && c.verdict === "keep_original" ? "keep" : "to_shred",
    filedAt,
    confidence: c.confidence && typeof c.confidence.overall === "number" ? c.confidence : undefined,
    fullText: it.ocrText ? String(it.ocrText).slice(0, 100000) : undefined,
    searchTerms: searchTerms({ ...c, folder }, filedAt),
    amount: c.amount ? String(c.amount) : undefined,
    contentHash: it.contentHash || undefined,
    sizeBytes: it.sizeBytes || undefined,
    md5: filed ? it.md5 || undefined : undefined,
    source: "web",
  };
}

// ---------- what the accessory and the Outbox screen show (the iPhone app's OutboxSummary) ----------
export const isOutbox = (i) => i.decision === "file" || i.decision === "shredOnly";
export function isActive(i) {
  if (!isOutbox(i)) return false;
  if (i.stage === "queued" || i.stage === "uploading" || i.stage === "failed") return true;
  return i.stage === "filed" && i.decision === "file" && !i.verifiedAt;
}
export const isDone = (i) => isOutbox(i) && (i.stage === "verified" || (i.stage === "filed" && i.decision === "shredOnly"));
export const isFailed = (i) => isOutbox(i) && i.stage === "failed";
export const needsRetry = (i) => isFailed(i) && !i.nextRetryAt;
export const progressOf = (i) => (i.sizeBytes > 0 ? Math.min(1, (i.bytesSent || 0) / i.sizeBytes) : 0);
const t = (s) => (s ? new Date(s).getTime() : 0);
// Still inside the deck's undo hold: not the outbox's yet, so it doesn't count anywhere.
export const isHeld = (i, now = Date.now(), released = S.released) =>
  i.stage === "queued" && !released.has(i.id) && !!i.decidedAt && now - t(i.decidedAt) < UNDO_MS;

const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

// The active items plus anything finished since the oldest of them was decided, so "Uploading 2 of
// 5" counts up through one burst of swipes.
export function currentBatch(entries) {
  const active = entries.filter(isActive);
  const starts = active.map((i) => t(i.decidedAt)).filter(Boolean);
  if (!starts.length) return active;
  const start = Math.min(...starts);
  return [...active, ...entries.filter((i) => isDone(i) && t(i.filedAt) >= start)];
}
export const filedToday = (entries, now = Date.now()) =>
  entries.filter((i) => isDone(i) && i.filedAt && sameDay(i.filedAt, now)).sort((a, b) => t(b.filedAt) - t(a.filedAt));
// Done in the last 30 days, before today, newest first, grouped by day: [{ day, entries }].
export function earlier(entries, now = Date.now()) {
  const today = startOfDay(now), cutoff = today - HISTORY_DAYS * 86400000;
  const groups = new Map();
  for (const i of entries) {
    if (!isDone(i) || !i.filedAt || t(i.filedAt) >= today || t(i.filedAt) < cutoff) continue;
    const d = startOfDay(i.filedAt);
    groups.set(d, [...(groups.get(d) || []), i]);
  }
  return [...groups.keys()].sort((a, b) => b - a).map((day) => ({ day, entries: groups.get(day).sort((a, b) => t(b.filedAt) - t(a.filedAt)) }));
}
// Spec 3.7, precedence: reconnect, then needs attention, then offline, then uploading, then idle.
export function accessoryState(entries, { online = true, reconnect = false, now = Date.now() } = {}) {
  const filed = filedToday(entries, now).length;
  if (reconnect) return { kind: "reconnect", filedToday: filed };
  const retry = entries.filter(needsRetry).length;
  if (retry) return { kind: "attention", count: retry, filedToday: filed };
  const active = entries.filter(isActive);
  if (active.length) {
    if (!online) return { kind: "offline", saved: active.length, filedToday: filed };
    const batch = currentBatch(entries);
    const done = batch.filter(isDone).length, total = batch.length;
    const bytes = batch.reduce((s, i) => s + Math.max(i.sizeBytes || 0, 1), 0);
    const sent = batch.reduce((s, i) => s + (isDone(i) ? Math.max(i.sizeBytes || 0, 1) : Math.min(i.bytesSent || 0, i.sizeBytes || 0)), 0);
    return { kind: "uploading", done: Math.min(done + 1, total), total, progress: bytes ? sent / bytes : 0, filedToday: filed };
  }
  return { kind: "idle", filedToday: filed };
}
// Spec 4.4 item 1: "2 uploading · 1 needs a retry · 14 filed today", zero parts left out.
export function subtitle(entries, now = Date.now()) {
  const up = entries.filter((i) => isActive(i) && !isFailed(i)).length, failed = entries.filter(isFailed).length, today = filedToday(entries, now).length;
  const parts = [];
  if (up) parts.push(`${up} uploading`);
  if (failed) parts.push(failed === 1 ? "1 needs a retry" : `${failed} need a retry`);
  if (today) parts.push(`${today} filed today`);
  return parts.length ? parts.join(" · ") : "Nothing waiting";
}
// Uploading section: the one moving now, then the Drive check, then the rest oldest decision first.
export function uploadingSection(entries) {
  const rank = (i) => (i.stage === "uploading" ? 0 : i.stage === "filed" ? 1 : 2);
  return entries.filter((i) => isActive(i) && !isFailed(i)).sort((a, b) => rank(a) - rank(b) || t(a.decidedAt) - t(b.decidedAt));
}
export const needsAttention = (entries) => entries.filter(isFailed).sort((a, b) => t(a.decidedAt) - t(b.decidedAt));

// Row copy (spec 3.10): "{title} · {issuer short}", the issuer left off when the title names it.
// "of" and "the" too, so "City of Raleigh Utilities" reads "City" rather than "City of".
const SUFFIXES = new Set(["inc", "inc.", "llc", "co", "co.", "corp", "corp.", "cu", "ltd", "n.a.", "&", "and", "of", "the"]);
export function shortIssuer(issuer) {
  let w = String(issuer || "").split(" ").filter(Boolean);
  while (w.length && SUFFIXES.has(w[w.length - 1].toLowerCase())) w.pop();
  w = w.slice(0, 2);
  while (w.length && SUFFIXES.has(w[w.length - 1].toLowerCase())) w.pop();
  return w.join(" ");
}
export function rowTitle(title, issuer) {
  const short = shortIssuer(issuer);
  title = title || "Untitled document";
  if (!short) return title;
  const first = short.split(" ")[0].toLowerCase();
  return first && title.toLowerCase().includes(first) ? title : `${title} · ${short}`;
}
export const failedSubtitle = (i, now = Date.now()) => (i.nextRetryAt ? COPY.retrying(i.nextRetryAt, now) : i.errorMessage || COPY.retriesUsedUp);
export const waitingSubtitle = (i, online) => (i.stage === "filed" ? COPY.checking : online ? COPY.nextInLine : COPY.waitingForConnection);
export const timeOf = (d) => new Date(d || Date.now()).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
// "1 of 1 pages confirmed in Drive · 10:12 AM" for the first confirmed row, shorter after it.
export function filedSubtitle(i, isFirst) {
  const time = timeOf(i.filedAt || i.verifiedAt);
  if (i.decision === "shredOnly") return `Logged as shredded · ${time}`;
  const p = i.pages || 1;
  return `${p} of ${p} ${p === 1 ? "page" : "pages"} confirmed${isFirst ? " in Drive" : ""} · ${time}`;
}
export const firstConfirmedId = (entries) => entries.find((i) => i.decision !== "shredOnly")?.id || null;

// ---------- the engine ----------
const S = {
  online: typeof navigator === "undefined" || navigator.onLine !== false,
  released: new Set(),       // ids the deck released early (the next decision, leaving Sort)
  cancelled: new Set(),      // ids being sent back while they're in flight
  current: null,             // { id, abort, promise }
  pumping: false, again: false,
  wake: 0, probe: 0, probeMs: 15000, refreshT: 0,
  entries: [], status: { kind: "idle", filedToday: 0, counts: { uploading: 0, waiting: 0, attention: 0, filedToday: 0 }, lastUploadAt: null }, statusKey: "",
};
const uid = () => auth.currentUser()?.uid || null;
const paused = () => !S.online || needsDrive();
const CANCEL = Object.freeze({ cancelled: true });
class StepError extends Error { constructor(kind, message) { super(message || kind); this.kind = kind; } }
const timeout = (p, ms = 30000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

export const status = () => S.status;
export const entries = () => S.entries;

// The deck's hold ended (the next decision, 10 s, or leaving Sort): upload now.
export async function release(id) {
  const it = await getItem(id);
  if (!it || !isOutbox(it)) return;
  S.released.add(id);
  if (it.stage === "ready") await updateItem(id, { stage: "queued", decidedAt: it.decidedAt || iso() });
  pump();
}
export async function retry(id) {
  const it = await getItem(id);
  if (!it || it.stage !== "failed") return;
  const patch = { attempts: 0, nextRetryAt: iso(0) };
  if (String(it.errorMessage || "").startsWith("Drive has")) patch.reuploads = 0;   // a page mismatch: a fresh copy
  S.released.add(id);
  await updateItem(id, patch);
  pump();
}
export async function retryAll() {
  const u = uid(); if (!u) return;
  for (const it of await listItems({ stage: "failed", uid: u })) await retry(it.id);
}

// Undo after the hold, and "Send back to the deck": the card goes back on top of the deck. False
// when the scan isn't on this device anymore (its files were cleaned up after the late-undo window).
export async function sendBack(id) {
  let it = await getItem(id);
  if (!it || !isOutbox(it)) return false;
  if (it.decision === "file" && !(await getBlob(`items/${id}.pdf`))) return false;
  S.cancelled.add(id);
  try {
    if (S.current?.id === id) { S.current.abort.abort(); await S.current.promise.catch(() => {}); }
    it = (await getItem(id)) || it;
    if (it.driveId) await trash(it.driveId).catch((e) => console.warn("Couldn't trash the Drive copy", e));
    if (it.docId) await timeout(removeDoc(it.docId)).catch((e) => console.warn("Couldn't remove the record", e));
    const u = it.uid || uid();
    const tops = (await listItems({ stage: "ready", uid: u })).filter((i) => !i.skippedAt && i.id !== id).map((i) => t(i.createdAt));
    const top = tops.length ? Math.min(...tops) - 1 : Date.now();
    await updateItem(id, {
      createdAt: iso(Math.min(t(it.createdAt) || top, top)), stage: "ready", decision: null, decidedAt: null,
      uploadURL: null, bytesSent: 0, driveId: null, driveUrl: null, docId: null, filedAt: null, verifiedAt: null,
      nextRetryAt: null, errorMessage: null, failedStage: null, attempts: 0, reuploads: 0,
    });
    S.released.delete(id);
    return true;
  } finally {
    S.cancelled.delete(id);
    pump();
  }
}

// Run items one at a time until nothing is ready to move, then sleep until the next retry or the
// end of an undo hold. One tab at a time does this (Web Locks), since every tab shares the pipeline.
export function pump() {
  if (S.pumping) { S.again = true; return Promise.resolve(); }
  if (!uid()) return Promise.resolve();
  S.pumping = true;
  const body = async () => {
    do {
      S.again = false;
      await purge(uid());
      const tried = new Set();
      while (!paused() && uid()) {
        const item = await nextWork(uid(), tried);
        if (!item) break;
        tried.add(item.id);
        await processOne(item);
      }
    } while (S.again && !paused());
  };
  const locked = typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("paper-trail-outbox", { ifAvailable: true }, (lock) => (lock ? body() : null))
    : body();
  return Promise.resolve(locked).catch((e) => console.error("Outbox stopped", e)).finally(async () => {
    S.pumping = false;
    await refresh();
    scheduleWake();
  });
}

async function nextWork(u, tried) {
  const now = Date.now();
  const all = (await listItems({ uid: u })).filter(isOutbox).sort((a, b) => t(a.decidedAt) - t(b.decidedAt));
  return all.find((i) => {
    if (tried.has(i.id) || S.cancelled.has(i.id)) return false;
    switch (i.stage) {
      case "queued": return !isHeld(i, now);
      case "uploading": return true;
      case "filed": return i.decision === "file" && !i.verifiedAt && (!i.nextRetryAt || t(i.nextRetryAt) <= now);
      case "failed": return !!i.nextRetryAt && t(i.nextRetryAt) <= now;
      default: return false;
    }
  }) || null;
}

async function processOne(start) {
  const abort = new AbortController();
  const id = start.id;
  let it = start;
  const alive = () => { if (S.cancelled.has(id) || abort.signal.aborted) throw CANCEL; };
  const save = async (patch) => { alive(); const next = await updateItem(id, patch); if (!next) throw CANCEL; it = next; return it; };

  async function session(target, name, size, rebuild) {
    const f = await ensureFolders(rebuild);
    const folderId = target.year ? await ensureYearFolder(target.folder, target.year) : f.folders[target.folder];
    if (!folderId) throw new DriveError("not_found", `no ${target.folder} folder`);
    return startUpload({ name, folderId, mimeType: "application/pdf", size });
  }
  let freshSession = false;      // a session made in this pass has nothing to resume
  async function prepare() {
    if (!it.card) throw new StepError("message", COPY.noCard);
    const pdf = await getBlob(`items/${id}.pdf`);
    if (!pdf) throw new StepError("exhausted", COPY.noFile);
    const patch = {};
    if (!it.md5 || !it.contentHash || it.sizeBytes !== pdf.size) {
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      patch.md5 = md5(bytes);
      patch.contentHash = it.contentHash || await sha256Hex(bytes);
      patch.sizeBytes = pdf.size;
    }
    const size = patch.sizeBytes || it.sizeBytes;
    const target = driveTarget(it.card.folder, it.card.docDate, it.decidedAt || Date.now());
    const name = (cleanName(it.card.filename) || "document") + ".pdf";
    let url;
    try { url = await session(target, name, size, false); }
    catch (e) {
      if (!(e instanceof DriveError) || e.code !== "not_found") throw e;
      // The folder was deleted or trashed in Drive: make the set again, once.
      await save({ errorMessage: COPY.folderMoved });
      url = await session(target, name, size, true);
    }
    await save({ ...patch, uploadURL: url, bytesSent: 0, stage: "uploading" });
    freshSession = true;
  }
  async function upload() {
    if (it.driveId) return;                       // uploaded earlier; only the record is left
    const pdf = await getBlob(`items/${id}.pdf`);
    if (!pdf) throw new StepError("exhausted", COPY.noFile);
    for (let n = 0; n < 2; n++) {
      let fresh = freshSession;
      freshSession = false;
      if (!it.uploadURL) { await save({ stage: "queued" }); await prepare(); fresh = true; freshSession = false; }
      try {
        let offset = 0, r = null;
        if (!fresh) {                              // a session from before a reload: ask where it stands
          r = await uploadStatus(it.uploadURL, pdf.size, { signal: abort.signal });
          alive();
          offset = r.received;
          if (!r.done) await save({ bytesSent: offset });
        }
        while (!r || !r.done) {
          r = await putChunk(it.uploadURL, pdf, offset, { signal: abort.signal, chunk: chunkSize() });
          alive();
          offset = r.received;
          if (!r.done) await save({ bytesSent: offset });
        }
        await save({ driveId: r.file.id, driveUrl: r.file.webViewLink, bytesSent: pdf.size, uploadURL: null });
        return;
      } catch (e) {
        // Drive forgot the session (it lasts about a week): start a new one, once.
        if (e instanceof DriveError && (e.code === "expired" || e.code === "not_found")) { await save({ uploadURL: null, bytesSent: 0 }); continue; }
        throw e;
      }
    }
    throw new DriveError("server", "the upload session expired twice");
  }
  async function writeRecord() {
    if (!it.card) throw new StepError("message", COPY.noCard);
    const filed = it.decision === "file";
    const at = it.filedAt || iso();
    try {
      if (it.docId) { if (filed) await timeout(updateDoc(it.docId, { driveId: it.driveId || "", driveUrl: it.driveUrl || "" })); }
      else {
        await timeout(putDoc(id, buildRecord(it, at)));
        await save({ docId: id });
        await recordPaperless(it.card, at);
      }
    } catch (e) {
      if (e === CANCEL || e instanceof DriveError) throw e;
      console.warn("The record didn't save", e);
      throw new StepError("message", filed ? COPY.logFailed : COPY.shredLogFailed);
    }
    await save({ filedAt: at, stage: "filed", errorMessage: null });
    if (!filed) finished();
  }
  async function verify() {
    if (!it.driveId) { await save({ stage: "uploading" }); return; }
    const meta = await metadata(it.driveId);
    alive();
    if (!meta.md5Checksum) throw new StepError("pending");
    if (it.md5 && meta.md5Checksum.toLowerCase() === it.md5.toLowerCase()) {
      const at = iso();
      if (it.docId) await timeout(updateDoc(it.docId, { verifiedAt: at, verifiedPages: it.pages || 0, md5: it.md5, sizeBytes: it.sizeBytes || 0 }));
      await save({ verifiedAt: at, stage: "verified", errorMessage: null, nextRetryAt: null });
      emit("doc:verified", { docId: it.docId || id });
      finished();
      return;
    }
    // The copy in Drive isn't ours byte for byte: count its pages for the message, trash it, and
    // upload a fresh copy once.
    let drivePages = 0;
    try { drivePages = await pageCount(await download(it.driveId)); } catch { /* unreadable: 0 pages */ }
    await trash(it.driveId).catch(() => {});
    await save({ driveId: null, driveUrl: null, uploadURL: null, bytesSent: 0 });
    if ((it.reuploads || 0) < 1) {
      await save({ reuploads: (it.reuploads || 0) + 1, errorMessage: COPY.pageMismatch(drivePages, it.pages || 1, true), stage: "queued" });
      await prepare(); await upload(); await writeRecord(); await verify();
    } else {
      await save({ stage: "queued" });
      throw new StepError("exhausted", COPY.pageMismatch(drivePages, it.pages || 1, false));
    }
  }
  function finished() {
    S.released.delete(id);
    // One success haptic when the last in-flight upload of a batch verifies, never per document.
    if (it.decision === "file" && !S.entries.some((i) => i.id !== id && isActive(i) && i.decision === "file" && !isHeld(i))) haptic("success");
  }

  const run = (async () => {
    const startedAt = it.stage === "failed" ? it.failedStage || "queued" : it.stage;
    try {
      if (it.stage === "failed") await save({ stage: startedAt, nextRetryAt: null });
      if (it.stage === "queued") {
        if (it.decision === "shredOnly") await writeRecord();
        else await prepare();
      }
      if (it.stage === "uploading") { await upload(); await writeRecord(); }
      if (it.stage === "filed" && it.decision === "file") await verify();
      await save({ attempts: 0, nextRetryAt: null, failedStage: null, errorMessage: null });
    } catch (e) {
      await handle(e, startedAt).catch((err) => { if (err !== CANCEL) console.warn("Outbox bookkeeping failed", err); });
    }
  })();
  S.current = { id, abort, promise: run };
  await run;
  S.current = null;

  async function handle(e, startedAt) {
    if (e === CANCEL || e?.name === "AbortError" || S.cancelled.has(id)) return;
    const at = it.stage === "failed" ? startedAt : it.stage;
    if (e instanceof DriveError) {
      // Drive needs reconnecting (spec 4.16): paused, not failed; Reconnect Drive resumes it.
      if (e.code === "auth" || e.code === "revoked" || (e.code === "unauthorized" && needsDrive())) { setNeedsDrive(true); return; }
      if (e.code === "network") { goOffline(); return; }
    }
    if (!(e instanceof StepError) && !(e instanceof DriveError)) console.warn("Upload step failed", e);
    const attempts = (it.attempts || 0) + 1;
    if (e instanceof StepError && e.kind === "exhausted") return fail(at, e.message, null, it.attempts || 0);
    if (e instanceof StepError && e.kind === "pending") {
      // Drive hasn't worked out the checksum yet: stays filed ("Checking the Drive copy") and is
      // asked again on the backoff schedule; it needs attention only once every try is used up.
      const d = retryDelay(attempts);
      if (d) { await save({ stage: "filed", attempts, nextRetryAt: iso(Date.now() + d) }); return; }
      return fail("filed", COPY.retriesUsedUp, null, attempts);
    }
    const message = e instanceof StepError ? e.message
      : e instanceof DriveError && ["quota", "too_big", "api_off"].includes(e.code) ? DRIVE_COPY[e.code] : COPY.retriesUsedUp;
    const d = retryDelay(attempts);
    return fail(at, message, d ? iso(Date.now() + d) : null, attempts);
  }
  async function fail(at, message, nextRetryAt, attempts) {
    await save({ stage: "failed", failedStage: at, errorMessage: message, nextRetryAt, attempts });
    if (!nextRetryAt) haptic("warning");     // once, as it moves into Needs attention
  }
}

async function pageCount(blob) {
  const doc = await openPdfDoc(blob);
  try { return doc.numPages; } finally { await doc.destroy(); }
}

// Paperless (#23): a sender is created the first time a paperless-capable doc files; a new doc from
// one already asked to stop sets stillMailingAt.
async function recordPaperless(card, at) {
  const issuer = card.paperless?.issuer || card.issuer;
  if (!card.paperless?.possible || !issuer) return;
  const id = slug(issuer);
  const existing = await timeout(getSender(id));
  if (!existing) {
    await timeout(createSender(id, { issuer: String(issuer).slice(0, 100), how: String(card.paperless.how || "").slice(0, 300), status: "todo", firstSeen: at, lastSeen: at }));
    return;
  }
  const patch = { lastSeen: at };
  if (["requested", "waiting_cycle", "done"].includes(existing.status)) patch.stillMailingAt = at;
  await timeout(updateSender(id, patch));
}

// A finished item keeps its PDF for 10 minutes (a late Undo still works), then only its row stays,
// for Filed today and Earlier; after 30 days the row goes too.
async function purge(u) {
  const now = Date.now();
  for (const i of await listItems({ uid: u })) {
    if (!isDone(i)) continue;
    const age = now - t(i.filedAt);
    if (age > HISTORY_DAYS * 86400000 + 86400000) { await deleteItem(i.id); continue; }
    if (age > KEEP_FILES_MS && !i.filesPurged) {
      await deleteBlob(`items/${i.id}.pdf`);
      await deleteBlob(`items/${i.id}.thumb.jpg`);
      await updateItem(i.id, { filesPurged: true });
    }
  }
}

function scheduleWake() {
  clearTimeout(S.wake);
  const now = Date.now();
  const times = S.entries.flatMap((i) => {
    if ((i.stage === "failed" || i.stage === "filed") && i.nextRetryAt) return [t(i.nextRetryAt)];
    if (isHeld(i, now)) return [t(i.decidedAt) + UNDO_MS];
    return [];
  });
  if (!times.length) return;
  S.wake = setTimeout(() => pump(), Math.max(500, Math.min(...times) - now));
}

// Offline: a Drive request failed as a network error. Wait for "online", and probe now and then,
// since navigator.onLine can't be trusted to notice a connection that comes back quietly.
function goOffline() {
  S.online = false;
  refresh();
  clearTimeout(S.probe);
  S.probe = setTimeout(() => { S.probeMs = Math.min(S.probeMs * 2, 120000); S.online = true; pump(); }, S.probeMs);
}
function backOnline() {
  clearTimeout(S.probe);
  S.probeMs = 15000;
  if (!S.online) { S.online = true; refresh(); }
}

// ---------- the accessory state ----------
async function refresh() {
  const u = uid();
  const items = u ? await listItems({ uid: u }) : [];
  const now = Date.now();
  S.entries = items;
  const visible = items.filter((i) => isOutbox(i) && !isHeld(i, now));
  const st = accessoryState(visible, { online: S.online, reconnect: needsDrive(), now });
  const filedDocs = items.filter((i) => i.decision === "file" && i.driveId && i.filedAt).map((i) => t(i.filedAt));
  st.counts = {
    uploading: visible.filter((i) => isActive(i) && !isFailed(i)).length,
    waiting: visible.filter((i) => i.stage === "queued").length,
    attention: visible.filter(isFailed).length,
    filedToday: st.filedToday,
  };
  st.lastUploadAt = filedDocs.length ? iso(Math.max(...filedDocs)) : null;
  S.status = st;
  const key = JSON.stringify(st);
  if (key !== S.statusKey) { S.statusKey = key; emit("outbox:status", st); renderDrive(); }
  legacySync(items);
}
function refreshSoon() { clearTimeout(S.refreshT); S.refreshT = setTimeout(refresh, 30); }
export const refreshStatus = refresh;

on("pipeline:changed", ({ stage } = {}) => {
  refreshSoon();
  if (stage === "queued") pump();     // new work, or a hold to time
});
on("drive:connected", () => { setNeedsDrive(false); pump(); });
on("drive:status", ({ status: s } = {}) => {
  if (s === "connected") { setNeedsDrive(false); backOnline(); pump(); }
  else if (s === "needsReconnect") { setNeedsDrive(true); refresh(); }
});
on("session:started", () => { backOnline(); refresh(); pump(); });
on("session:ended", () => clearOutbox());
if (typeof window !== "undefined") {
  addEventListener("online", () => { backOnline(); pump(); });
  addEventListener("offline", () => { S.online = false; refresh(); });
  // Timers sleep in a background tab; look again when the page comes back.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pump(); });
}

// Signed out: stop, but keep every item ("Your scans stay on this phone until they upload."). They
// show again only for the same account.
export function clearOutbox() {
  if (S.current) S.current.abort.abort();
  clearTimeout(S.wake); clearTimeout(S.probe);
  S.released.clear();
  legacy.clear();
  S.entries = [];
  S.statusKey = "";
  setNeedsDrive(false);
  refresh();
}

// ---------- legacy: the in-memory deck (deck.js, items.js) until it moves onto db.js ----------
// enqueue(it) for a right swipe, logShred(it) for a left one. The item is copied into the pipeline
// (its PDF too) and released at once, since the legacy deck has no undo hold. Its status follows the
// pipeline: "done" once filed, "failed" with the row's message, then "items:changed" redraws the deck.
const legacy = new Map();   // pipeline id -> legacy item
export const enqueue = (it) => bridge(it, "file");
export const logShred = (it) => bridge(it, "shredOnly");
async function bridge(it, decision) {
  const u = uid();
  if (!u || !it?.result) return;
  if (it.pipelineId && (await getItem(it.pipelineId))) { legacy.set(it.pipelineId, it); await retry(it.pipelineId); return; }
  const id = crypto.randomUUID();
  it.pipelineId = id;
  legacy.set(id, it);
  try {
    if (decision === "file") {
      const pdf = it.kind === "pdf" ? it.files[0] : await photosToPdf(it.files);
      await putBlob(`items/${id}.pdf`, new Blob([pdf], { type: "application/pdf" }));
    }
    if (it.thumb) { try { await putBlob(`items/${id}.thumb.jpg`, await (await fetch(it.thumb)).blob()); } catch { /* no thumbnail, the row shows the doc glyph */ } }
  } catch (e) {
    console.warn("Couldn't save the scan for upload", e);
    it.status = "failed"; it.error = e instanceof DriveError ? DRIVE_COPY[e.code] || DRIVE_COPY.pdf : DRIVE_COPY.pdf;
    emit("items:changed");
    return;
  }
  const now = iso();
  await putItem({
    id, uid: u, createdAt: now, stage: "queued", decision, decidedAt: now, card: structuredClone(it.result),
    unsureFields: [], pages: it.numPages || 1, sizeBytes: 0, bytesSent: 0, attempts: 0, reuploads: 0, origin: "legacy-deck",
  });
  S.released.add(id);
  pump();
}
function legacySync(items) {
  if (!legacy.size) return;
  let changed = false;
  for (const i of items) {
    const it = legacy.get(i.id);
    if (!it) continue;
    const next = i.stage === "filed" || i.stage === "verified" ? "done" : i.stage === "failed" ? "failed" : it.status;
    if (next === "done" && !it.saved) { it.saved = true; it.docId = i.docId || i.id; }
    if (next !== it.status) { it.status = next; it.error = next === "failed" ? failedSubtitle(i) : ""; changed = true; }
    if (next === "done") legacy.delete(i.id);
  }
  if (changed) emit("items:changed");
}
