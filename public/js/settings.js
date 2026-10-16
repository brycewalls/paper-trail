// settings.js: the Settings sheet from the avatar (spec 4.9). Owner: auth (the shell, the account
// row, the Google Drive section, Sign out, the footer). Every other section belongs to the feature
// that owns the setting and is added with registerSettingsSection(), in that feature's own module:
//
//   registerSettingsSection({ id: "sorting", order: 30, render: () => section(rows, { header: "Sorting" }),
//                             bind(el) { el.querySelector("#set-bulk").onchange = ... } });
//
// Orders, so the sections land where spec 4.9 puts them: Google Drive rows are static (auth),
// 30 Sorting (deck: Sender rules, Offer to file confident cards together; outbox: Shred hold),
// 40 Scanning and privacy (capture: Shutter; auth: Lock), 50 Data.
// The static part lives in index.html (#settings-panel) so drive.js and auth.js can bind their
// buttons at load; opening Settings moves it into a sheet and closing moves it back.
import { $, esc } from "./ui.js";
import { VERSION } from "./config.js";
import { currentUser } from "./auth.js";
import { openSheet } from "./ui/sheet.js";
import { initialsOf } from "./ui/components.js";

const sections = [];
export function registerSettingsSection(def) {
  if (sections.some((s) => s.id === def.id)) throw new Error(`Settings section ${def.id} is already registered`);
  sections.push(def);
  sections.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

let open = null;
export function openSettings() {
  if (open) return open;
  const panel = $("settings-panel");
  const u = currentUser() || {};
  $("acct-name").textContent = u.name || (u.email ? u.email.split("@")[0] : "");
  $("acct-email").textContent = u.email || "";
  panel.querySelectorAll("[data-avatar-static]").forEach((a) => { a.textContent = initialsOf(u.name, u.email); });
  $("settings-version").textContent = `Paper Trail ${VERSION}`;
  const host = $("settings-sections");
  host.innerHTML = sections.map((s) => `<div data-settings-section="${esc(s.id)}">${s.render()}</div>`).join("");
  for (const s of sections) s.bind && s.bind(host.querySelector(`[data-settings-section="${s.id}"]`));
  panel.hidden = false;
  open = openSheet({ title: "Settings", largeTitle: true, detents: ["large"], label: "Settings", className: "settings-sheet",
    trailing: '<button type="button" class="nav-text-btn" data-settings-done>Done</button>', body: panel });
  open.el.querySelector("[data-settings-done]").addEventListener("click", () => open.close("done"));
  open.closed.then(() => {
    panel.hidden = true;
    document.body.append(panel);       // back to the page, so its buttons keep their listeners
    open = null;
  });
  return open;
}
export const closeSettings = () => open && open.close("done");
