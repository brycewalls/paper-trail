// drive.js: Google Drive REST. Owner: outbox. Every Drive request goes through drive() here (the
// only module that calls B.fetch), the Paperwork Archive folders and the year subfolders (decision
// 2), the resumable upload in chunks (#1), metadata with md5Checksum (#18), download, trash and
// search. It knows nothing about the deck or the pipeline: the queue that calls these is outbox.js.
//
// Tokens come only from auth.driveAccessToken() (#15, docs/web-contract.md "Auth"); a 401 calls
// auth.invalidateDriveToken() and tries once more with a fresh token. The Reconnect Drive banner and
// the Settings rows are auth's, drawn from auth.driveStatus(); renderDrive() asks auth to redraw them.
import { DRIVE_API, DRIVE_UPLOAD, ROOT_FOLDER, FOLDER_NAMES, YEAR_FOLDERS } from "./config.js";
import { B } from "./backend.js";
import { driveAccessToken, invalidateDriveToken, driveStatus, reconnectDrive, renderReconnect } from "./auth.js";
import { getDriveConfig, setDriveConfig } from "./store.js";

// A token for the next request. fresh: the last one got a 401, so mint again.
async function accessToken(fresh = false) {
  if (fresh) invalidateDriveToken();
  try { return await driveAccessToken(); }
  catch (e) {
    const code = e?.code || e?.message;
    if (code === "drive_revoked") throw new DriveError("revoked");
    if (code === "signed_out") throw new DriveError("auth", "signed out");
    throw new DriveError("network", String(code || "drive_unavailable"));   // Google didn't answer: retryable
  }
}

// True while uploads wait for Reconnect Drive (the outbox sets it on a refused token, or the server
// says the grant is gone).
let needs = false;
export const needsDrive = () => needs || driveStatus() === "needsReconnect";
export function setNeedsDrive(v) { needs = !!v; renderDrive(); }
export const renderDrive = () => renderReconnect();

// Reconnect Drive (spec 4.16): auth's code flow, a full-page redirect. The outbox resumes on
// "drive:status" connected when the page comes back.
export async function reconnect() { return reconnectDrive(); }

// ---------- Google Drive REST ----------
// Codes: auth (signed out), revoked (the server lost the refresh
// token: Reconnect), unauthorized (a 401 after a fresh token), network, quota, rate, api_off,
// forbidden, not_found, expired (an upload session Drive no longer knows), too_big, server.
export class DriveError extends Error { constructor(code, detail) { super(detail || code); this.code = code; this.name = "DriveError"; } }
export const DRIVE_COPY = {
  quota: "Your Google Drive is full. Free up space, then tap Retry.",
  rate: "Drive is limiting uploads right now. Wait a minute, then tap Retry.",
  api_off: "The Google Drive API isn't turned on for this project yet. Once it is, tap Retry.",
  forbidden: "Drive refused the upload. Tap Retry, and if it keeps happening, reconnect Drive.",
  network: "The upload didn't finish. Check your connection, then tap Retry.",
  server: "Drive didn't take this one. Tap Retry to try again.",
  too_big: "This file is too large to send. Split it into smaller scans.",
  pdf: "Couldn't put these photos into one PDF. Reload the page and try again.",
};

// Every Drive call goes through here: it adds the token and turns failures into DriveError codes.
// accept: extra statuses that aren't failures (308 for the resumable upload). signal: AbortSignal.
export async function drive(url, opts = {}) {
  const { accept = [], signal, ...init } = opts;
  for (let attempt = 0; ; attempt++) {
    const tok = await accessToken(attempt > 0);
    let r;
    try { r = await B.fetch(url, { ...init, signal, headers: { ...(init.headers || {}), Authorization: "Bearer " + tok } }); }
    catch (e) {
      if (e?.name === "AbortError") throw e;
      throw new DriveError("network", e?.message);
    }
    if (r.ok || accept.includes(r.status)) return r;
    let reason = "";
    try { const j = await r.clone().json(); reason = [j?.error?.errors?.[0]?.reason, j?.error?.status, j?.error?.message].filter(Boolean).join(" "); } catch { /* not JSON */ }
    if (r.status === 401) {
      if (attempt === 0) continue;       // one fresh token, then give up
      throw new DriveError("unauthorized", reason);
    }
    if (r.status === 403) {
      if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) throw new DriveError("quota", reason);
      if (/rateLimitExceeded|userRateLimitExceeded/i.test(reason)) throw new DriveError("rate", reason);
      if (/accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(reason)) throw new DriveError("api_off", reason);
      if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(reason)) {
        invalidateDriveToken();
        throw new DriveError("unauthorized", reason);
      }
      throw new DriveError("forbidden", reason);
    }
    if (r.status === 404) throw new DriveError("not_found", reason);
    if (r.status === 410) throw new DriveError("expired", reason);
    if (r.status === 413) throw new DriveError("too_big", reason);
    if (r.status === 429) throw new DriveError("rate", reason);
    throw new DriveError("server", `${r.status} ${reason}`);
  }
}
// Rate limits and 5xx get two quiet retries with backoff before they reach the outbox's own retries.
export async function withRetry(fn) {
  for (let n = 0; ; n++) {
    try { return await fn(); }
    catch (e) {
      if (n >= 2 || !(e instanceof DriveError) || !["rate", "server"].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** n));
    }
  }
}

// ---------- folders ----------
// The archive lives in folders this app made (drive.file can't see anything else), found or created
// on first use and cached in Firestore at users/{uid}/config/drive. Year folders are cached in the
// same map under "02 Taxes/2025", as the iPhone app does.
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
  const root = await findOrCreateFolder(ROOT_FOLDER, "root");
  const map = {};
  for (const n of FOLDER_NAMES) map[n] = await findOrCreateFolder(n, root);
  folders = { root, folders: map, updatedAt: new Date().toISOString() };
  await setDriveConfig(folders).catch((e) => console.warn("Folder cache not saved", e));
  return folders;
}
// "02 Taxes/2025", made on demand inside 02 Taxes, 03 Money & Banking and 05 Medical only.
export async function ensureYearFolder(folderName, year) {
  const f = await ensureFolders();
  if (!YEAR_FOLDERS.includes(folderName) || !year) return f.folders[folderName];
  const key = `${folderName}/${year}`;
  if (f.folders[key]) return f.folders[key];
  const parent = f.folders[folderName];
  if (!parent) throw new DriveError("not_found", `no ${folderName} folder`);
  const id = await findOrCreateFolder(String(year), parent);
  folders = { ...f, folders: { ...f.folders, [key]: id }, updatedAt: new Date().toISOString() };
  await setDriveConfig(folders).catch((e) => console.warn("Folder cache not saved", e));
  return id;
}

// ---------- the resumable upload (#1) ----------
// startUpload makes a session; putChunk sends one piece (every piece but the last a multiple of
// 256 KiB); uploadStatus asks Drive how much it has (Content-Range: bytes */size), so a reload or a
// dropped connection resumes from Drive's offset. The final piece's reply is the file.
const FILE_FIELDS = "id,name,webViewLink,md5Checksum,size,trashed";
export const CHUNK = 256 * 1024 * 4;   // 1 MiB

export async function startUpload({ name, folderId, mimeType = "application/pdf", size }) {
  const init = await withRetry(() => drive(`${DRIVE_UPLOAD}?uploadType=resumable&fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ name, parents: [folderId], mimeType }),
  }));
  const session = init.headers.get("Location");
  if (!session) throw new DriveError("server", "no upload session");
  return session;
}
// Drive's 308 says "bytes=0-524287": it has 524288 bytes.
const received = (r) => { const m = /bytes=0-(\d+)/.exec(r.headers.get("Range") || ""); return m ? Number(m[1]) + 1 : 0; };
async function finished(r) {
  const j = await r.json();
  if (!j.id) throw new DriveError("server", "no file id");
  return { done: true, received: Number(j.size) || 0, file: { ...j, webViewLink: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` } };
}
// Sends blob[from, from + CHUNK) to the session. Resolves { done: false, received } or { done: true, file }.
export async function putChunk(url, blob, from, { signal, chunk = CHUNK } = {}) {
  const end = Math.min(blob.size, from + chunk);
  const r = await drive(url, {
    method: "PUT", accept: [308], signal,
    headers: { "Content-Type": blob.type || "application/pdf", "Content-Range": `bytes ${from}-${end - 1}/${blob.size}` },
    body: blob.slice(from, end),
  });
  if (r.status === 308) return { done: false, received: r.headers.get("Range") ? received(r) : end };
  return finished(r);
}
// How many bytes Drive has for this session. A finished session answers with the file.
export async function uploadStatus(url, size, { signal } = {}) {
  const r = await drive(url, { method: "PUT", accept: [308], signal, headers: { "Content-Range": `bytes */${size}` } });
  if (r.status === 308) return { done: false, received: received(r) };
  return finished(r);
}

// ---------- files ----------
export async function metadata(fileId) {
  return (await withRetry(() => drive(`${DRIVE_API}/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`))).json();
}
export async function download(fileId) {
  return (await withRetry(() => drive(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`))).blob();
}
export async function trash(fileId) {
  await withRetry(() => drive(`${DRIVE_API}/${encodeURIComponent(fileId)}?fields=id,trashed`, {
    method: "PATCH", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ trashed: true }),
  }));
}
// Full-text search over the files this app made (#22, Also in Drive).
export async function search(text) {
  const query = `fullText contains '${q(String(text || ""))}' and trashed = false`;
  const r = await withRetry(() => drive(`${DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,parents,webViewLink)&spaces=drive&pageSize=25`));
  return (await r.json()).files || [];
}
