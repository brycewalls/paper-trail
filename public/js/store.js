// store.js: every Firestore read and write, by name. Nothing else calls B.get / B.set / B.add /
// B.update / B.del / B.watch with a path; it calls one of these. Paths are relative to users/{uid}/
// (the backend adds the uid). The data model these write is in docs/web-contract.md.
import { B } from "./backend.js";
import { slug, emit } from "./ui.js";

export const PATHS = { docs: "docs", paperless: "paperless", driveConfig: "config/drive" };

// The first read after sign-in. A permission-denied here means the account isn't on the allowlist.
export const checkAccess = () => B.get(PATHS.driveConfig);

// users/{uid}/config/drive: the Paperwork Archive folder IDs.
export const getDriveConfig = () => B.get(PATHS.driveConfig);
export const setDriveConfig = (data) => B.set(PATHS.driveConfig, data);

// Live lists. Each returns an unsubscribe function.
export const watchDocs = (cb, err) => B.watch(PATHS.docs, "filedAt", cb, err);
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

// ---------- browse (Piles, Search, Paperless; #18, #22, #23) ----------
// users/{uid}/config/settings: shredHoldDays (0, 1, 3, 7; default 3) and other per-account settings.
// Watched through the config collection (a single-doc listener isn't in the backend interface), so
// a missing doc reads as {}.
PATHS.settings = "config/settings";
export const watchSettings = (cb, err) => B.watch("config", null, (list) => {
  const s = list.find((d) => d.id === "settings") || {};
  const { id, ...rest } = s;
  cb(rest);
}, err);
// Merges a patch into config/settings, creating it when it isn't there yet (update() would fail).
export async function saveSettings(patch) {
  const cur = (await B.get(PATHS.settings)) || {};
  await B.set(PATHS.settings, { ...cur, ...patch });
}
