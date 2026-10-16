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
import { watchUser, startAuth, finishReturn, cachedSession, markNotAllowed, showGate } from "./auth.js";
import { renderDrive, resetFolders, setNeedsDrive } from "./drive.js";
import { checkAccess, watchDocs, watchPaperless } from "./store.js";
import { items, clearItems } from "./items.js";
import { addEach, addAsOne, pump } from "./deck.js";
import { clearOutbox } from "./outbox.js";
import { setDocs, setPaperless, resetPiles, renderPiles } from "./piles.js";
import { sc } from "./scanner.js";
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
  clearItems(); clearOutbox(); resetPiles(); setNeedsDrive(false); shellSignedIn(null);
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
  unwatch.push(watchDocs(setDocs, () => setSaveNote("Your log couldn't load. Reload the page to try again.")));
  unwatch.push(watchPaperless(setPaperless, () => {}));
  // Firestore rules decide who's allowed: a refused read means this account isn't on the list.
  // In the background, so opening the app never waits on it (#14).
  checkAccess().catch((e) => { if (/permission-denied/.test(errCode(e)) && shown === u.uid) markNotAllowed(u.email); });
}

// The Scan menu asks for a source with "capture:request" (shell.js). Until capture's new review
// screen lands, the request opens the legacy scanner and pickers.
on("capture:request", ({ source }) => {
  if (source === "camera") $("btn-scan").click();
  else $(source === "photos" ? "pages-file" : "file").click();
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
    if (FAKE) window.__PT__ = { addFiles: addEach, addPhotos: addAsOne, items: () => items, scanner: sc };
  } catch (e) {
    console.error("Paper Trail could not start", e);
    document.documentElement.classList.remove("pt-cached");
    showGate("signin", { message: "Paper Trail couldn't load. Check your connection and reload the page." });
    $("btn-signin").hidden = true; $("gate-note").hidden = true;
    return;
  }
  renderPiles();
  startShell();
  watchUser(onUser);
  startAuth();
  document.documentElement.classList.remove("pt-cached");
})();
