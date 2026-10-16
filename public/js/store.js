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

// ---------- the lab build (#92) ----------
// On the lab site every path above already sits under users/{uid}/lab/data/ (backend.js adds
// DATA_ROOT), so the lab's docs, paperless, senders and config never touch the real archive. Three
// more, lab only (docs/web-contract.md, "Lab"):
// users/{uid}/lab/data/config/lab: { reader: "rules", compareWithClaude } (compare defaults on).
export const LAB_SETTINGS_PATH = "config/lab";
export const watchLabSettings = (cb, err) => B.watch("config", null, (list) => {
  const { id, ...rest } = list.find((d) => d.id === "lab") || {};
  cb(rest);
}, err);
export async function saveLabSettings(patch) {
  const cur = (await B.get(LAB_SETTINGS_PATH).catch(() => null)) || {};
  const next = { ...cur, ...patch };
  delete next.id;
  await B.set(LAB_SETTINGS_PATH, defined(next));
  return next;
}
// users/{uid}/lab/data/compare/{itemId}: one per document read with compare on: { at, agree
// { field: true|false }, rules, claude }. Written by the reader, read for the stats row.
export const putComparison = (id, rec) => B.set(`compare/${id}`, defined(rec));
export const watchComparisons = (cb, err) => B.watch("compare", "at", cb, err);
// users/{uid}/lab/data/reads/{readId}: one per lab read: the rules' card, where the text came from,
// Needs a look, and with compare mode Claude's card, the per-field agreement and Bryce's picks
// (ground truth). Owners: lab/compare.js, lab/stats.js. Deep-cleaned of undefined, which Firestore
// refuses.
export const LAB_PATHS = { reads: "reads" };
const plain = (o) => JSON.parse(JSON.stringify(o));
export const watchLabReads = (cb, err) => B.watch(LAB_PATHS.reads, "createdAt", cb, err);
export const putLabRead = (id, rec) => B.set(`${LAB_PATHS.reads}/${id}`, plain(rec));
export const updateLabRead = (id, patch) => B.update(`${LAB_PATHS.reads}/${id}`, plain(patch));
// users/{uid}/lab/data/examples/{readId}: one per document Bryce filed or corrected in the lab, for
// the on-device matcher (#102): { v, s (the packed vector), docType, issuer, source ("filed" or
// "corrected"), model, revision, at }. No document text. Owner: lab/match/matcher.js.
export const watchLabExamples = (cb, err) => B.watch("examples", "at", cb, err);
export const putLabExample = (id, rec) => B.set(`examples/${id}`, plain(rec));
