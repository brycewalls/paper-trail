// main.js: boot and wiring. Picks the backend, starts every module (importing one runs its
// top-level listeners), and decides what a sign-in or sign-out does across modules. Feature code
// does not go here: if a feature needs to react to the session, it listens for an event instead
// (docs/web-contract.md).
//
// Session order (#14): the app renders from auth's cached user before Firebase answers; Firestore
// listeners and the allowlist probe start once Firebase confirms the user.
import { FAKE } from "./config.js";
import { $, errCode, setSaveNote, emit, on } from "./ui.js";
import { initBackend } from "./backend.js";
import { watchUser, startAuth, finishReturn, cachedSession, markNotAllowed, showGate, currentUser } from "./auth.js";
import { renderDrive, resetFolders, setNeedsDrive } from "./drive.js";
import { checkAccess } from "./store.js";
import { items, clearItems, newItem } from "./items.js";
import { addEach, addAsOne, pump } from "./deck.js";
import "./detail.js";   // registers the card detail and document screens (deck)
import * as outbox from "./outbox.js";
import * as db from "./db.js";
import "./outbox-view.js";            // registers the Outbox and Earlier screens and the Shred hold row
// Browse (Piles, Search, Paperless) starts its own listeners on "session:started" (browse.js).
import "./piles.js";
import "./search.js";
import "./paperless.js";
import { sc } from "./scanner.js";
import { scanned, importFiles, importPhotos } from "./capture.js";
import { reviewState } from "./review.js";
import { queueStats } from "./classify.js";
import "./senders.js";
import * as labCompare from "./lab/compare.js";   // compare mode (#92): listens for lab:read
import * as labStats from "./lab/stats.js";       // Settings, Lab: compare toggle and Lab Stats
import { startShell, shellSignedIn } from "./shell.js";

let unwatch = [];
let shown = null;        // uid the app is showing
let watching = null;     // uid the Firestore listeners are for

function stopWatching() {
  unwatch.forEach((f) => { try { f(); } catch { /* already gone */ } });
  unwatch = [];
  watching = null;
}
function endSession() {
  stopWatching();
  resetFolders();
  clearItems(); outbox.clearOutbox(); setNeedsDrive(false); shellSignedIn(null);
  $("app").hidden = true;
  if (shown) { shown = null; emit("session:ended"); }
}

function onUser(u, { confirmed }) {
  document.documentElement.classList.remove("pt-cached");
  if (!u) { endSession(); return; }
  if (shown && shown !== u.uid) endSession();
  if (shown !== u.uid) {
    shown = u.uid;
    $("app").hidden = false;
    $("app").classList.add("app-enter");
    shellSignedIn(u);
    renderDrive();
    setSaveNote();
    pump();
    emit("session:started", u);
  } else {
    shellSignedIn(u);    // the name may have arrived with the confirmation
  }
  if (!confirmed || watching === u.uid) return;
  watching = u.uid;
  // Firestore rules decide who's allowed: a refused read means this account isn't on the list.
  // In the background, so opening the app never waits on it (#14).
  checkAccess().catch((e) => { if (/permission-denied/.test(errCode(e)) && shown === u.uid) markNotAllowed(u.email); });
}

// Legacy bridge (capture, #83): until db.js and the rebuilt deck land, "capture:sent" carries the
// review's documents in memory and they join the legacy deck here as session items: the PDF the
// review built (or the imported original), its thumbnail, and Claude's card once the read is back.
// With db.js attached (review.attachStore), capture writes the pipeline instead and sends ids only,
// and this goes.
on("capture:sent", ({ items: sent, blobs }) => {
  if (!sent) return;
  const uid = currentUser()?.uid || "";
  for (const it of sent) {
    const b = blobs[it.id];
    const li = newItem(it.name, [new File([b.pdf], `${it.name}.pdf`, { type: "application/pdf" })], uid);
    Object.assign(li, { kind: "pdf", numPages: it.pages, thumb: URL.createObjectURL(b.thumb), ocrText: it.ocrText, contentHash: it.contentHash, opened: true, stage: "reading" });
    const settle = () => {
      // it.lab (#92) is shared, not copied: compare mode fills it in after the card lands on the deck.
      if (it.stage === "ready") { li.card = it.card; li.unsureFields = it.unsureFields || []; li.lab = it.lab; li.stage = "ready"; }
      else { li.stage = "failed"; li.failedStage = "reading"; li.readErrorCode = it.readErrorCode || "unknown"; li.errorMessage = it.errorMessage || "Something interrupted the read. Tap Try again."; }
      pump();
    };
    if (it.stage === "ready" || it.stage === "failed") settle(); else it.whenRead.then(settle);
    items.push(li);
  }
  pump();
});

// ---------- boot ----------
(async () => {
  // A sign-in return (#/auth/done) leaves the address bar before anything reads it.
  finishReturn();
  const cached = cachedSession();
  if (cached) { $("gate").hidden = true; $("app").hidden = false; shellSignedIn(cached); }
  try {
    await initBackend();
    // Test hooks, on the fake path only: add files without the picker.
    if (FAKE) window.__PT__ = { addFiles: addEach, addPhotos: addAsOne, items: () => items, scanner: sc, outbox, db,
      importFiles, importPhotos, scanned, review: reviewState, reads: queueStats, lab: { compare: labCompare, stats: labStats } };
  } catch (e) {
    console.error("Paper Trail could not start", e);
    document.documentElement.classList.remove("pt-cached");
    showGate("signin", { message: "Paper Trail couldn't load. Check your connection and reload the page." });
    $("btn-signin").hidden = true; $("gate-note").hidden = true;
    return;
  }
  startShell();
  watchUser(onUser);
  startAuth();
  document.documentElement.classList.remove("pt-cached");
})();
