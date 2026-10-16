// db.js: the local pipeline in IndexedDB, the web's PipelineItem and FileStore (#17). A document in
// hand survives a reload, a closed tab and a dead connection because it lives here, not in memory.
// Owner: outbox. The only module that opens IndexedDB (docs/web-contract.md, "Local pipeline").
//
// Database "paper-trail", version 1:
//   items    key id (crypto.randomUUID()), indexes stage and createdAt: one document on its way through
//   blobs    key string: items/<id>.pdf, items/<id>.thumb.jpg, review/<session>/<n>.jpg
//   reviews  key session: a scan review left open
//   kv       key string: small per-device values (lastUser, recent searches, lastTab)
//
// Every item write emits "pipeline:changed" with { id, stage } once the transaction has committed.
// updateItem() reads and writes in one transaction, so the deck and the outbox can each patch their
// own fields of the same item without losing the other's.
//
// Where IndexedDB can't open (some private windows, blocked storage) the same API runs on memory, so
// the app still works for the session; nothing survives a reload then.
import { emit } from "./ui.js";

const NAME = "paper-trail", VERSION = 1;
let ready = null;
let mem = null;     // the in-memory fallback: { items, blobs, reviews, kv } Maps

const STORES = { items: "id", blobs: null, reviews: "session", kv: null };

export function openDb() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(NAME, VERSION); } catch { resolve(memory()); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        const s = db.createObjectStore("items", { keyPath: "id" });
        s.createIndex("stage", "stage");
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      if (!db.objectStoreNames.contains("reviews")) db.createObjectStore("reviews", { keyPath: "session" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();   // another tab is upgrading; let it
      resolve(db);
    };
    req.onerror = () => { console.warn("IndexedDB unavailable, keeping the pipeline in memory", req.error); resolve(memory()); };
    req.onblocked = () => console.warn("IndexedDB upgrade is waiting for another tab to close");
  });
  return ready;
}
function memory() {
  mem = mem || Object.fromEntries(Object.keys(STORES).map((k) => [k, new Map()]));
  return null;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("aborted")); });
const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

async function run(store, mode, fn) {
  const db = await openDb();
  if (!db) return fn(null, mem[store]);
  const tx = db.transaction(store, mode);
  const out = fn(tx.objectStore(store), null);
  const value = out instanceof IDBRequest ? result(out) : Promise.resolve(out);
  await done(tx);
  return value;
}

// ---------- items ----------
export async function getItem(id) {
  if (!id) return null;
  const v = await run("items", "readonly", (s, m) => (m ? clone(m.get(id)) : s.get(id)));
  return v || null;
}
export async function putItem(item) {
  if (!item || !item.id) throw new Error("putItem needs an id");
  await run("items", "readwrite", (s, m) => (m ? void m.set(item.id, clone(item)) : s.put(item)));
  emit("pipeline:changed", { id: item.id, stage: item.stage });
  return item;
}
// Merge a patch into the stored item in one transaction. Resolves the new item, or null if it's gone.
export async function updateItem(id, patch) {
  let next = null;
  const db = await openDb();
  if (!db) {
    const cur = mem.items.get(id);
    if (cur) { next = { ...cur, ...clone(patch) }; mem.items.set(id, next); next = clone(next); }
  } else {
    const tx = db.transaction("items", "readwrite");
    const s = tx.objectStore("items");
    const r = s.get(id);
    r.onsuccess = () => { if (r.result) { next = { ...r.result, ...patch }; s.put(next); } };
    await done(tx);
  }
  if (next) emit("pipeline:changed", { id, stage: next.stage });
  return next;
}
// Removes the item and its blobs.
export async function deleteItem(id) {
  await run("items", "readwrite", (s, m) => (m ? void m.delete(id) : s.delete(id)));
  await deleteBlob(`items/${id}.pdf`);
  await deleteBlob(`items/${id}.thumb.jpg`);
  emit("pipeline:changed", { id, stage: null });
}
// Every item, oldest first, for one account (uid) and optionally one stage.
export async function listItems({ stage, uid } = {}) {
  const all = await run("items", "readonly", (s, m) => (m ? [...m.values()].map(clone) : (stage ? s.index("stage").getAll(stage) : s.getAll())));
  return all.filter((i) => (!stage || i.stage === stage) && (!uid || i.uid === uid))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ---------- blobs ----------
export const putBlob = (key, blob) => run("blobs", "readwrite", (s, m) => (m ? void m.set(key, blob) : s.put(blob, key)));
export const getBlob = async (key) => (await run("blobs", "readonly", (s, m) => (m ? m.get(key) : s.get(key)))) || null;
export const deleteBlob = (key) => run("blobs", "readwrite", (s, m) => (m ? void m.delete(key) : s.delete(key)));

// ---------- review sessions (capture) ----------
export const putReview = (r) => run("reviews", "readwrite", (s, m) => (m ? void m.set(r.session, clone(r)) : s.put(r)));
export const getReview = async (session) => (await run("reviews", "readonly", (s, m) => (m ? clone(m.get(session)) : s.get(session)))) || null;
export const deleteReview = (session) => run("reviews", "readwrite", (s, m) => (m ? void m.delete(session) : s.delete(session)));

// ---------- small per-device values ----------
export const kvGet = async (k) => { const v = await run("kv", "readonly", (s, m) => (m ? clone(m.get(k)) : s.get(k))); return v === undefined ? null : v; };
export const kvSet = (k, v) => run("kv", "readwrite", (s, m) => (m ? void m.set(k, clone(v)) : s.put(v, k)));

// Forget one account's items and their blobs on this device (not used by Sign out, which keeps
// unsent scans: "Your scans stay on this phone until they upload.").
export async function clearAccount(uid) {
  for (const it of await listItems({ uid })) await deleteItem(it.id);
}
