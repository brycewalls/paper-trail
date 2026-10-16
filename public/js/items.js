// items.js: the documents in hand this session, the model the Sort deck runs on. Owner: deck.
// In memory until the deck moves onto db.js (outbox, #17); every field below already uses the
// iPhone app's PipelineItem names and stage strings (docs/web-contract.md, "Local pipeline"), so
// that move swaps the storage, not the deck. It's a leaf so drive.js, outbox.js and auth.js can read
// it without importing the deck. Nothing new may import it (contract): new readers go through db.js.
//
//   stage        captured (opening the file), reading, ready, queued (released to the outbox),
//                filed, failed (failedStage says where: "reading" or "uploading")
//   decision     "file" | "shredOnly", set when the undo hold ends (decidedAt: the swipe)
//   card         the normalized classify result (classify.normalize), edited in place
//   unsureFields the card's Not sure fields in sheet order, kept in step by setCard()
//   skippedAt    on the Skipped set (#77): off the deck, never uploads
//   status       legacy outbox.js bookkeeping only: "filing" / "logging" while it works, then
//                "done" or "failed". Retired with the legacy outbox.
export const items = [];

export const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export function newItem(name, files, uid = "") {
  const it = {
    id: uuid(), createdAt: new Date().toISOString(), uid, name, files,
    kind: files.length === 1 && isPdf(files[0]) ? "pdf" : "photos",
    thumb: "", numPages: 0,
    stage: "captured", failedStage: "", readErrorCode: "", errorMessage: "", openError: "",
    card: null, unsureFields: [], decision: null, decidedAt: null, skippedAt: null, filedAt: null,
    // legacy outbox.js and store.saveRecord
    status: "", progress: "", error: "", drive: null, saved: false, docId: null,
  };
  // outbox.js and store.saveRecord still read the card as `result`.
  Object.defineProperty(it, "result", { get() { return it.card; }, set(v) { it.card = v; }, enumerable: false });
  Object.defineProperty(it, "pages", { get() { return it.numPages; }, enumerable: false });
  return it;
}

export const findItem = (id) => items.find((i) => i.id === String(id));
// Uploads the legacy outbox is still working on (Sign out and closing the tab ask first).
export const pendingUploads = () => items.some((i) => i.status === "filing" || i.status === "logging");
export function clearItems() {
  for (const i of items) if (i.thumb) URL.revokeObjectURL(i.thumb);
  items.length = 0;
}
