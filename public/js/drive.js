// drive.js: Google Drive. Owns the Drive token, the connection state in the account bar
// (#drive-dot, #drive-state, Connect Drive) and the Reconnect Drive banner, every Drive REST call,
// the Paperwork Archive folders, and the resumable upload. It knows nothing about the deck: the
// upload queue that calls uploadFile() is outbox.js.
import { DRIVE_API, DRIVE_UPLOAD, ROOT_FOLDER, FOLDER_NAMES } from "./config.js";
import { $, setStatus, on, emit } from "./ui.js";
import { B } from "./backend.js";
import { currentUser, reauthenticate, authMsg } from "./auth.js";
import { getDriveConfig, setDriveConfig } from "./store.js";
import { items } from "./items.js";

// ---------- the Drive token ----------
// signInWithPopup hands back a Google access token good for about an hour. It lives in memory and
// in this tab's sessionStorage (so a reload keeps it), never in Firestore. When Drive answers 401,
// uploads pause and the Reconnect Drive banner asks for a fresh one; the deck carries on meanwhile.
const TOKEN_KEY = "pt-drive-token";
let driveTok = null;
export function saveToken(token, uid) {
  driveTok = token ? { token, uid: uid || currentUser()?.uid, exp: Date.now() + 55 * 60 * 1000 } : null;
  try { driveTok ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify(driveTok)) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode: memory only */ }
  renderDrive();
}
export function loadToken() {
  const user = currentUser();
  try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null"); driveTok = t && t.uid === user?.uid && t.exp > Date.now() ? t : null; } catch { driveTok = null; }
}
export function currentToken() {
  return driveTok && driveTok.exp > Date.now() && driveTok.uid === currentUser()?.uid ? driveTok.token : null;
}
// Sign-in and Sign out announce the token; this module is the only one that keeps it.
on("auth:token", (r) => saveToken(r ? r.token : null, r?.uid));

// True while uploads are paused waiting for Reconnect Drive.
let needs = false;
export const needsDrive = () => needs;
export function setNeedsDrive(v) { needs = !!v; }

export function renderDrive() {
  if (!$("drive-state")) return;
  const connected = !!currentToken();
  $("drive-dot").classList.toggle("on", connected);
  $("drive-state").textContent = connected ? "Drive connected" : "Drive not connected";
  $("btn-drive").hidden = connected;
  const waiting = items.filter((i) => i.status === "filing").length;
  $("drive-banner").hidden = !needs;
  $("drive-banner-text").textContent = waiting
    ? `${waiting} upload${waiting > 1 ? "s are" : " is"} waiting. Nothing is lost, keep sorting.`
    : "Uploads pick up where they stopped.";
}
async function connectDrive() {
  for (const b of [$("btn-drive"), $("btn-reconnect")]) b.disabled = true;
  try {
    const r = await reauthenticate();
    if (!r.token) throw Object.assign(new Error("no token"), { code: "auth/no-token" });
    saveToken(r.token, r.uid);
    needs = false;
    setStatus("");
    emit("drive:connected");   // outbox.js restarts the paused uploads
  } catch (e) {
    setStatus(authMsg(e), true);
  } finally {
    for (const b of [$("btn-drive"), $("btn-reconnect")]) b.disabled = false;
    renderDrive();
  }
}
$("btn-drive").addEventListener("click", connectDrive);
$("btn-reconnect").addEventListener("click", connectDrive);

// ---------- Google Drive REST ----------
export class DriveError extends Error { constructor(code, detail) { super(detail || code); this.code = code; } }
export const DRIVE_COPY = {
  quota: "Your Google Drive is full. Free up space, then tap Try again.",
  rate: "Drive is limiting uploads right now. Wait a minute, then tap Try again.",
  api_off: "The Google Drive API isn't turned on for this project yet. Once it is, tap Try again.",
  forbidden: "Drive refused the upload. Tap Try again, and if it keeps happening, reconnect Drive.",
  network: "The upload didn't finish. Check your connection, then tap Try again.",
  server: "Drive didn't answer. Check the folder in Drive before trying again, so you don't get a duplicate.",
  too_big: "This file is too large for the browser to send in one go. Split it into smaller scans.",
  pdf: "Couldn't put these photos into one PDF. Reload the page and try again.",
};

// Every Drive call goes through here: it adds the token and turns failures into DriveError codes.
export async function drive(url, opts = {}) {
  const tok = currentToken();
  if (!tok) throw new DriveError("auth");
  let r;
  try { r = await B.fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + tok } }); }
  catch (e) { throw new DriveError("network", e?.message); }
  if (r.ok) return r;
  let reason = "";
  try { const j = await r.clone().json(); reason = [j?.error?.errors?.[0]?.reason, j?.error?.status, j?.error?.message].filter(Boolean).join(" "); } catch { /* not JSON */ }
  if (r.status === 401) { saveToken(null); throw new DriveError("auth", reason); }
  if (r.status === 403) {
    if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) throw new DriveError("quota", reason);
    if (/rateLimitExceeded|userRateLimitExceeded/i.test(reason)) throw new DriveError("rate", reason);
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(reason)) throw new DriveError("api_off", reason);
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(reason)) { saveToken(null); throw new DriveError("auth", reason); }
    throw new DriveError("forbidden", reason);
  }
  if (r.status === 404) throw new DriveError("not_found", reason);
  if (r.status === 413) throw new DriveError("too_big", reason);
  if (r.status === 429) throw new DriveError("rate", reason);
  throw new DriveError("server", `${r.status} ${reason}`);
}
// Rate limits and 5xx get two quiet retries with backoff before they reach the person.
export async function withRetry(fn) {
  for (let n = 0; ; n++) {
    try { return await fn(); }
    catch (e) {
      if (n >= 2 || !(e instanceof DriveError) || !["rate", "server"].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** n));
    }
  }
}

// The archive lives in folders this app made (drive.file can't see anything else), found or created
// on first use and cached in Firestore at users/{uid}/config/drive.
let folders = null;
export function resetFolders() { folders = null; }
const q = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function findOrCreateFolder(name, parent) {
  const query = `name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${q(parent)}' in parents and trashed = false`;
  const found = await (await withRetry(() => drive(`${DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive&pageSize=10`))).json();
  if (found.files && found.files.length) return found.files[0].id;
  const made = await (await withRetry(() => drive(`${DRIVE_API}?fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  }))).json();
  return made.id;
}
export async function ensureFolders(fresh = false) {
  if (folders && !fresh) return folders;
  if (!fresh) {
    const c = await getDriveConfig().catch(() => null);
    if (c && c.root && c.folders && FOLDER_NAMES.every((n) => c.folders[n])) return (folders = c);
  }
  setStatus("Setting up the Paperwork Archive folders in Drive", false, true);
  const root = await findOrCreateFolder(ROOT_FOLDER, "root");
  const map = {};
  for (const n of FOLDER_NAMES) map[n] = await findOrCreateFolder(n, root);
  folders = { root, folders: map, updatedAt: new Date().toISOString() };
  await setDriveConfig(folders).catch((e) => console.warn("Folder cache not saved", e));
  setStatus("");
  return folders;
}

// One file, any size: a resumable session, then a single PUT of the whole file.
export async function uploadFile(blob, name, parent) {
  const init = await withRetry(() => drive(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": String(blob.size) },
    body: JSON.stringify({ name, parents: [parent], mimeType: "application/pdf" }),
  }));
  const session = init.headers.get("Location");
  if (!session) throw new DriveError("server", "no upload session");
  const done = await drive(session, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: blob });
  const j = await done.json();
  if (!j.id) throw new DriveError("server", "no file id");
  return { driveId: j.id, driveUrl: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` };
}
