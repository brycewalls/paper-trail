// items.js: the documents in hand this session (in memory, not Firestore), the model the deck runs
// on. Owned by deck.js; it's a separate leaf so drive.js, outbox.js and auth.js can read it
// without importing the deck. Item shape and statuses: docs/v2-contract.md, "Session items".
export const items = [];
let seq = 0;

export const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
export const newItem = (name, files) => ({ id: ++seq, name, files, kind: files.length === 1 && isPdf(files[0]) ? "pdf" : "photos", thumb: "", numPages: 0,
  status: "loading", result: null, error: "", progress: "", editing: false, confirmLeft: false, msg: "", mode: "", drive: null, saved: false, docId: null });

export const findItem = (id) => items.find((i) => i.id === Number(id));
export const deckItems = () => items.filter((i) => ["loading", "queued", "reading", "ready"].includes(i.status));
export const pendingUploads = () => items.some((i) => i.status === "filing" || i.status === "logging");
export function clearItems() { items.length = 0; }
