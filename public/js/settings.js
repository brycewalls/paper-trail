// settings.js: the Settings sheet from the avatar (spec 4.9). Owner: auth (the shell, the account
// row and its Account page with Sign out, the Google Drive section, the footer). Every other
// section belongs to the feature that owns the setting and is added with registerSettingsSection(),
// in that feature's own module:
//
//   registerSettingsSection({ id: "sorting", order: 30, render: () => section(rows, { header: "Sorting" }),
//                             bind(el) { el.querySelector("#set-bulk").onchange = ... } });
//
// Orders, so the sections land where spec 4.9 puts them: the account row and Google Drive come
// first (auth), then Sorting (30 senders.js: Sender rules; 31 outbox-view.js: Shred hold; 32 deck.js:
// Offer to file confident cards together, with the footer; joined into one group by joinGroups()),
// 40 Scanning and privacy (capture: Shutter; auth: Lock, later), 50 Data.
// The iPhone twin is ios/PaperTrail/Features/Settings/SettingsScreen.swift and
// Features/Auth/AccountSettings.swift.
import { esc, on } from "./ui.js";
import { VERSION, ROOT_FOLDER } from "./config.js";
import { currentUser, driveStatus, reconnectDrive, reconnectBusy, reconnectFailed, signOut, watchDriveUi, AUTH_COPY } from "./auth.js";
import { getDriveConfig } from "./store.js";
import { openSheet } from "./ui/sheet.js";
import { initialsOf, section, row } from "./ui/components.js";
import { icon } from "./ui/icons.js";

const sections = [];
export function registerSettingsSection(def) {
  if (sections.some((s) => s.id === def.id)) throw new Error(`Settings section ${def.id} is already registered`);
  sections.push(def);
  sections.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

// ---------- "Last upload" (4.9): the outbox's lastUploadAt, or the legacy record:saved ----------
let lastUpload = "";
const noteUpload = (iso) => { if (iso && (!lastUpload || iso > lastUpload)) { lastUpload = iso; if (open) drawDrive(); } };
on("outbox:status", (s) => noteUpload(s && s.lastUploadAt));
on("record:saved", (r) => { if (r && r.record && r.record.filed) noteUpload(r.record.filedAt); });
on("session:ended", () => { lastUpload = ""; folderUrl = ""; });

// "Just now", "2 min ago", "3 hr ago", "Yesterday", "4 days ago", then the date.
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

// ---------- the sheet ----------
const FOLDER_SEARCH = `https://drive.google.com/drive/search?q=${encodeURIComponent(`"${ROOT_FOLDER}"`)}`;
let folderUrl = "";
let open = null;

function accountRow(u) {
  const name = u.name || (u.email ? u.email.split("@")[0] : "");
  return row({ leading: `<span class="avatar" style="--avatar:48px" aria-hidden="true">${esc(initialsOf(u.name, u.email))}</span>`,
    titleHtml: `<span class="account-name">${esc(name)}</span>`, subtitle: u.email || "", chevron: true, id: "settings-account", "data-settings-account": "", "aria-label": `${name}, ${u.email || ""}. Account` });
}

function driveRows() {
  const connected = driveStatus() !== "needsReconnect";
  const working = reconnectBusy();
  const status = `<div class="list-row two-line drive-status" id="drive-row">`
    + `<span class="row-leading"><span class="dot${connected ? " on" : ""}" id="drive-dot" aria-hidden="true"></span></span>`
    + `<span class="row-text"><span class="row-title" id="drive-state">${connected ? "Connected" : "Not connected"}</span>`
    + `<span class="row-subtitle" id="drive-sub">${esc(connected ? "Stays connected on the server. No sign-in prompts." : "Reconnect to keep filing. Your scans are safe on this phone.")}</span></span></div>`;
  const reconnect = connected ? "" : `<button type="button" class="list-row accent reconnect-row" id="btn-drive" data-reconnect${working ? ' disabled aria-busy="true"' : ""}>`
    + `<span class="row-text"><span class="row-title">Reconnect Drive</span>`
    + (reconnectFailed() ? `<span class="row-subtitle danger" id="drive-fail">${esc(AUTH_COPY.reconnectFailed)}</span>` : "") + `</span>`
    + (working ? '<span class="row-trailing"><span class="spinner" aria-hidden="true"></span></span>' : "") + `</button>`;
  const folder = row({ title: "Folder", trailing: `<span class="row-value">${esc(ROOT_FOLDER)}</span>`, chevron: true, href: folderUrl || FOLDER_SEARCH,
    target: "_blank", rel: "noopener", id: "drive-folder", "aria-description": "Opens the folder in Drive" });
  const last = row({ title: "Last upload", trailing: `<span class="row-value" id="drive-last">${esc(lastUpload ? relativeTime(lastUpload) : "None yet")}</span>` });
  return status + reconnect + folder + last;
}

function mainPage(u) {
  return `<div class="settings-page" data-page="main">`
    + section(accountRow(u))
    + `<div data-settings-drive>${section(driveRows(), { header: "Google Drive", id: "settings-drive" })}</div>`
    + `<div id="settings-sections">${sections.map((s) => `<div data-settings-section="${esc(s.id)}">${s.render()}</div>`).join("")}</div>`
    + `<p class="group-footer settings-version" id="settings-version">Paper Trail ${esc(VERSION)}</p>`
    + `</div>`;
}
function accountPage(u) {
  return `<div class="settings-page" data-page="account" hidden>`
    + `<button type="button" class="nav-back settings-back" data-settings-back>${icon("chevron.left")}<span>Settings</span></button>`
    + section(row({ title: "Email", trailing: `<span class="row-value" id="acct-email">${esc(u.email || "")}</span>` }))
    + section(`<button type="button" class="list-row destructive centered" id="btn-signout"><span class="row-text"><span class="row-title">Sign out</span></span></button>`)
    + `</div>`;
}

function drawDrive() {
  const host = open && open.body.querySelector("[data-settings-drive]");
  if (!host) return;
  const hadFocus = host.contains(document.activeElement) ? document.activeElement.id : "";
  host.innerHTML = section(driveRows(), { header: "Google Drive", id: "settings-drive" });
  host.querySelector("[data-reconnect]")?.addEventListener("click", () => reconnectDrive());
  if (hadFocus) host.querySelector(`#${hadFocus}`)?.focus({ preventScroll: true });
}

function showPage(name) {
  if (!open) return;
  for (const p of open.body.querySelectorAll(".settings-page")) p.hidden = p.dataset.page !== name;
  const title = open.el.querySelector(".sheet-title");
  if (title) title.textContent = name === "account" ? "Account" : "Settings";
  open.el.querySelector(".sheet-head")?.classList.toggle("large", name !== "account");
  open.body.scrollTop = 0;
  (name === "account" ? open.body.querySelector("[data-settings-back]") : open.body.querySelector("#settings-account"))?.focus({ preventScroll: true });
}

// Sections from different owners that share a header ("Sorting": senders.js's Sender rules at 30,
// outbox-view.js's Shred hold at 31, deck.js's bulk toggle and footer at 32) draw as one inset group,
// as spec 4.9 shows them. Visual only: each owner keeps its own element, so its bind() still works.
function joinGroups(host) {
  if (!host) return;
  let prev = null, prevHeader = "";
  for (const wrap of host.querySelectorAll(":scope > [data-settings-section]")) {
    const groups = wrap.querySelectorAll(":scope > .group");
    if (!groups.length) continue;
    const first = groups[0], header = first.querySelector(":scope > .group-header")?.textContent.trim() || "";
    if (prev && header && header === prevHeader && !prev.querySelector(":scope > .group-footer")) {
      prev.classList.add("join-next");
      first.classList.add("join-prev");
      first.querySelector(":scope > .group-header").hidden = true;
    }
    prev = groups[groups.length - 1];
    prevHeader = prev.querySelector(":scope > .group-header")?.textContent.trim() || prevHeader;
  }
}

export function openSettings() {
  if (open) return open;
  const u = currentUser() || {};
  const body = document.createElement("div");
  body.className = "settings-panel";
  body.id = "settings-panel";
  body.innerHTML = mainPage(u) + accountPage(u);
  open = openSheet({ title: "Settings", largeTitle: true, detents: ["large"], label: "Settings", className: "settings-sheet",
    trailing: '<button type="button" class="nav-text-btn" data-settings-done>Done</button>', body });
  for (const s of sections) s.bind && s.bind(body.querySelector(`[data-settings-section="${s.id}"]`));
  joinGroups(body.querySelector("#settings-sections"));
  open.el.querySelector("[data-settings-done]").addEventListener("click", () => open.close("done"));
  body.querySelector("[data-settings-account]").addEventListener("click", () => showPage("account"));
  body.querySelector("[data-settings-back]").addEventListener("click", () => showPage("main"));
  body.querySelector("#btn-signout").addEventListener("click", async () => {
    const sheet = open;
    if (await signOut()) sheet && sheet.close("signed-out");
  });
  drawDrive();
  const unwatch = watchDriveUi(drawDrive);
  // The folder's own link once the archive exists (users/{uid}/config/drive), else a Drive search.
  if (!folderUrl && u.uid) getDriveConfig().then((c) => { if (c && c.root) { folderUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(c.root)}`; drawDrive(); } }).catch(() => {});
  open.closed.then(() => { unwatch(); open = null; });
  return open;
}
export const closeSettings = () => open && open.close("done");
export const settingsOpen = () => !!open;
