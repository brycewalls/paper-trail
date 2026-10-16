// outbox.js: what happens after a swipe. A right swipe is queued and filed to Drive (one at a time,
// behind the deck, so swiping never waits on Drive) and then logged; a left swipe is only logged.
// Today the queue lives in memory; #17 makes it local-first. Changes an item's status and then
// emits "items:changed" so the deck redraws; it never imports the deck.
import { DriveError, DRIVE_COPY, currentToken, needsDrive, setNeedsDrive, ensureFolders, uploadFile, renderDrive } from "./drive.js";
import { photosToPdf } from "./media.js";
import { saveRecord } from "./store.js";
import { setStatus, mb, on, emit } from "./ui.js";
import { pendingUploads } from "./items.js";
import { driveStatus } from "./auth.js";

// The accessory's reconnect state (3.7, 4.16), until the outbox rebuild (#17) emits the full
// accessory state with counts. Reconnect outranks everything; otherwise the idle state.
const accessory = () => emit("outbox:status", driveStatus() === "needsReconnect" ? { kind: "reconnect" } : { kind: "idle", filedToday: 0 });
on("drive:status", accessory);
on("session:started", accessory);

const uploads = [];
let uploading = false;

// File a ready item (status already "filing") to Drive, then log it.
export function enqueue(it) { uploads.push(it); runUploads(); }
export function clearOutbox() { uploads.length = 0; }

export async function runUploads() {
  if (uploading || needsDrive()) return;
  uploading = true;
  while (uploads.length && !needsDrive()) {
    const it = uploads[0];
    try {
      if (!it.drive) it.drive = await fileToDrive(it);  // kept, so a retry after a log hiccup doesn't upload twice
      await saveRecord(it, { filed: true, ...it.drive, physical: it.result.verdict === "keep_original" ? "keep" : "to_shred" });
      it.status = "done";
      uploads.shift();
    } catch (e) {
      if (e instanceof DriveError && e.code === "auth") {
        setNeedsDrive(true);  // stays at the front of the queue; Reconnect Drive restarts the loop
        it.progress = "";
      } else {
        uploads.shift();
        it.status = "failed";
        it.progress = "";
        it.error = it.drive ? "Filed in Drive, but couldn't save it to your log. Tap Try again."
          : e instanceof DriveError ? (DRIVE_COPY[e.code] || DRIVE_COPY.server)
          : "The upload didn't finish. Check the folder in Drive, then tap Try again.";
        console.warn("Upload failed", e);
      }
    }
    setStatus("");
    emit("items:changed");
  }
  uploading = false;
  renderDrive();
}
on("drive:connected", runUploads);

async function fileToDrive(it) {
  if (!currentToken()) throw new DriveError("auth");
  const blob = it.kind === "pdf" ? it.files[0] : await photosToPdf(it.files);
  setStatus(`Uploading ${it.result.filename}.pdf (${mb(blob.size)})`, false, true);
  let f = await ensureFolders();
  const name = it.result.filename + ".pdf";
  try {
    return await uploadFile(blob, name, f.folders[it.result.folder]);
  } catch (e) {
    if (!(e instanceof DriveError) || e.code !== "not_found") throw e;
    // The folder was deleted or trashed in Drive: make the set again, once.
    f = await ensureFolders(true);
    return await uploadFile(blob, name, f.folders[it.result.folder]);
  }
}

// Log a left swipe (status already "logging"): on the shred pile, not filed.
export async function logShred(it) {
  try {
    await saveRecord(it, { filed: false, driveId: "", driveUrl: "", physical: "to_shred" });
    it.status = "done";
  } catch {
    it.status = "failed"; it.error = "Couldn't save this to your log. Try again.";
  }
  emit("items:changed");
}

window.addEventListener("beforeunload", (e) => { if (pendingUploads()) { e.preventDefault(); e.returnValue = ""; } });
