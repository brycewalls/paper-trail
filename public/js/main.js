// main.js: boot and wiring. Picks the backend, starts every module (importing one runs its
// top-level listeners), and decides what a sign-in or sign-out does across modules. Feature code
// does not go here: if a feature needs to react to the session, it listens for an event instead
// (docs/web-contract.md).
import { FAKE, DENIED } from "./config.js";
import { $, errCode, setSaveNote, emit, on } from "./ui.js";
import { initBackend } from "./backend.js";
import { watchUser, showGate } from "./auth.js";
import { loadToken, renderDrive, resetFolders, setNeedsDrive } from "./drive.js";
import { checkAccess, watchDocs, watchPaperless } from "./store.js";
import { items, clearItems, newItem } from "./items.js";
import { addEach, addAsOne, pump } from "./deck.js";
import { clearOutbox } from "./outbox.js";
import { setDocs, setPaperless, resetPiles, renderPiles } from "./piles.js";
import { sc } from "./scanner.js";
import { scanned, importFiles, importPhotos } from "./capture.js";
import { reviewState } from "./review.js";
import { queueStats } from "./classify.js";
import "./senders.js";
import { startShell, shellSignedIn } from "./shell.js";

let unwatch = [];

async function onUser(u) {
  unwatch.forEach((f) => { try { f(); } catch { /* already gone */ } });
  unwatch = [];
  resetFolders();
  if (!u) {
    clearItems(); clearOutbox(); resetPiles(); setNeedsDrive(false); shellSignedIn(null);
    showGate("signin", "");
    emit("session:ended");
    return;
  }
  showGate("busy", "Checking your account…");
  // Firestore rules decide who's allowed: a refused read here means this account isn't on the list.
  try { await checkAccess(); }
  catch (e) {
    if (/permission-denied/.test(errCode(e))) { showGate("denied", DENIED); return; }
    showGate("error", "Your log couldn't be reached. Check your connection, then sign in again.");
    return;
  }
  loadToken();
  $("gate").hidden = true;
  $("app").hidden = false;
  shellSignedIn(u);
  renderDrive();
  unwatch.push(watchDocs(setDocs, () => setSaveNote("Your log couldn't load. Reload the page to try again.")));
  unwatch.push(watchPaperless(setPaperless, () => {}));
  setSaveNote();
  pump();
  emit("session:started", u);
}

// Legacy bridge (capture, #83): until db.js and the rebuilt deck land, "capture:sent" carries the
// review's documents in memory and they join the legacy deck here as session items: the PDF the
// review built (or the imported original), its thumbnail, and Claude's card once the read is back.
// With db.js attached (review.attachStore), capture writes the pipeline instead and sends ids only,
// and this goes.
on("capture:sent", ({ items: sent, blobs }) => {
  if (!sent) return;
  for (const it of sent) {
    const b = blobs[it.id];
    const li = newItem(it.name, [new File([b.pdf], `${it.name}.pdf`, { type: "application/pdf" })]);
    Object.assign(li, { kind: "pdf", numPages: it.pages, thumb: URL.createObjectURL(b.thumb), ocrText: it.ocrText, contentHash: it.contentHash, status: "reading", progress: "Claude is reading it" });
    const settle = () => {
      if (it.stage === "ready") { li.result = it.card; li.status = "ready"; }
      else { li.status = "error"; li.error = it.errorMessage || "Something interrupted the read. Tap Try again."; }
      pump();
    };
    if (it.stage === "ready" || it.stage === "failed") settle(); else it.whenRead.then(settle);
    items.push(li);
  }
  pump();
});

// ---------- boot ----------
(async () => {
  try {
    await initBackend();
    // Test hooks, on the fake path only: add files without the picker.
    if (FAKE) window.__PT__ = { addFiles: addEach, addPhotos: addAsOne, items: () => items, scanner: sc,
      importFiles, importPhotos, scanned, review: reviewState, reads: queueStats };
  } catch (e) {
    console.error("Paper Trail could not start", e);
    showGate("error", "Paper Trail couldn't load. Check your connection and reload the page.");
    $("btn-signin").hidden = true; $("gate-note").hidden = true;
    return;
  }
  renderPiles();
  startShell();
  watchUser(onUser);
})();
