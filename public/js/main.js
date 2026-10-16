// main.js: boot and wiring. Picks the backend, starts every module (importing one runs its
// top-level listeners), and decides what a sign-in or sign-out does across modules. Feature code
// does not go here: if a feature needs to react to the session, it listens for an event instead
// (docs/v2-contract.md).
import { FAKE, DENIED } from "./config.js";
import { $, errCode, setSaveNote, emit } from "./ui.js";
import { initBackend } from "./backend.js";
import { watchUser, showGate } from "./auth.js";
import { loadToken, renderDrive, resetFolders, setNeedsDrive } from "./drive.js";
import { checkAccess, watchDocs, watchPaperless } from "./store.js";
import { items, clearItems } from "./items.js";
import { addEach, addAsOne, pump } from "./deck.js";
import { clearOutbox } from "./outbox.js";
import { setDocs, setPaperless, resetPiles, renderPiles } from "./piles.js";
import { sc } from "./scanner.js";

let unwatch = [];

async function onUser(u) {
  unwatch.forEach((f) => { try { f(); } catch { /* already gone */ } });
  unwatch = [];
  resetFolders();
  if (!u) {
    clearItems(); clearOutbox(); resetPiles(); setNeedsDrive(false);
    showGate("signin", "Sign in with the Google account whose Drive holds your Paperwork Archive.");
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
  $("acct-email").textContent = u.email;
  renderDrive();
  unwatch.push(watchDocs(setDocs, () => setSaveNote("Your log couldn't load. Reload the page to try again.")));
  unwatch.push(watchPaperless(setPaperless, () => {}));
  setSaveNote();
  pump();
  emit("session:started", u);
}

// ---------- boot ----------
(async () => {
  try {
    await initBackend();
    // Test hooks, on the fake path only: add files without the picker.
    if (FAKE) window.__PT__ = { addFiles: addEach, addPhotos: addAsOne, items: () => items, scanner: sc };
  } catch (e) {
    console.error("Paper Trail could not start", e);
    showGate("error", "Paper Trail couldn't load. Check your connection and reload the page.");
    $("btn-signin").hidden = true; $("gate-note").hidden = true;
    return;
  }
  renderPiles();
  watchUser(onUser);
})();
