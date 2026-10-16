// store.js: every Firestore read and write, by name. Nothing else calls B.get / B.set / B.add /
// B.update / B.del / B.watch with a path; it calls one of these. Paths are relative to users/{uid}/
// (the backend adds the uid). The data model these write is in docs/web-contract.md.
import { B } from "./backend.js";
import { slug, emit } from "./ui.js";

export const PATHS = { docs: "docs", paperless: "paperless", senders: "senders", driveConfig: "config/drive" };

// The first read after sign-in. A permission-denied here means the account isn't on the allowlist.
export const checkAccess = () => B.get(PATHS.driveConfig);

// users/{uid}/config/drive: the Paperwork Archive folder IDs.
export const getDriveConfig = () => B.get(PATHS.driveConfig);
export const setDriveConfig = (data) => B.set(PATHS.driveConfig, data);

// Live lists. Each returns an unsubscribe function.
// watchDocs also keeps the latest list for findByHash (capture, #2), so the duplicate check needs no
// extra query.
let knownDocs = [];
export function watchDocs(cb, err) { knownDocs = []; return B.watch(PATHS.docs, "filedAt", (list) => { knownDocs = list; cb(list); }, err); }
export const watchPaperless = (cb, err) => B.watch(PATHS.paperless, null, cb, err);

// users/{uid}/docs/{auto id}: one per sorted document; plus users/{uid}/paperless/{slug(issuer)}
// the first time a sender that offers e-delivery shows up.
export async function saveRecord(it, extra) {
  const rec = { ...it.result, pages: it.numPages, ...extra, filedAt: new Date().toISOString() };
  if (!it.saved) { it.docId = await B.add(PATHS.docs, rec); it.saved = true; emit("record:saved", { item: it, record: rec, id: it.docId }); }
  if (rec.paperless.possible && rec.paperless.issuer) {
    const path = PATHS.paperless + "/" + slug(rec.paperless.issuer);
    if (!(await B.get(path))) await B.set(path, { issuer: rec.paperless.issuer, how: rec.paperless.how, status: "todo", firstSeen: rec.filedAt });
  }
}

export const updateDoc = (id, data) => B.update(PATHS.docs + "/" + id, data);
export const removeDoc = (id) => B.del(PATHS.docs + "/" + id);
export const updateSender = (id, data) => B.update(PATHS.paperless + "/" + id, data);

// ---------- outbox (#17, #18) ----------
// users/{uid}/docs/{outboxId}: the outbox writes each record under the pipeline item's id, so a
// retry overwrites instead of writing a second copy. Undefined fields are left out (Firestore
// refuses them).
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
export const getDoc = (id) => B.get(PATHS.docs + "/" + id);
export const putDoc = (id, rec) => B.set(PATHS.docs + "/" + id, defined(rec));
// users/{uid}/paperless/{slug(issuer)}: created the first time a paperless-capable doc files.
export const getSender = (id) => B.get(PATHS.paperless + "/" + id);
export const createSender = (id, data) => B.set(PATHS.paperless + "/" + id, defined(data));

// users/{uid}/config/settings: shredHoldDays (0, 1, 3, 7; default 3), offerBulkFile (web only).
export const SETTINGS_PATH = "config/settings";
export const getSettings = () => B.get(SETTINGS_PATH);
// Watches config/settings; cb gets the settings object ({} when it doesn't exist yet).
export const watchSettings = (cb, err) => B.watch("config", null, (list) => {
  const { id, ...rest } = list.find((d) => d.id === "settings") || {};
  cb(rest);
}, err);
// Merges a patch into config/settings, keeping keys the other app or feature wrote.
export async function saveSettings(patch) {
  const cur = (await B.get(SETTINGS_PATH).catch(() => null)) || {};
  const next = { ...cur, ...patch };
  delete next.id;
  await B.set(SETTINGS_PATH, defined(next));
  return next;
}
// ---------- capture (#2) ----------
// A filed doc with these exact bytes (SHA-256 hex), from the docs already watched; null when none.
export const findByHash = (hash) => (hash && knownDocs.find((d) => d.contentHash === hash)) || null;

// ---------- sender rules (#21): users/{uid}/senders/{slug(issuer)} ----------
export const watchSenders = (cb, err) => B.watch(PATHS.senders, null, cb, err);
export const setSenderRule = (rule) => B.set(`${PATHS.senders}/${rule.key}`, rule);
export const deleteSenderRule = (key) => B.del(`${PATHS.senders}/${key}`);
