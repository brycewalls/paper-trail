// ui/components.js: Direction A's shared components for the web, the counterpart of the iPhone app's
// Core/UI (docs/design-spec.md section 3). Every function returns an HTML string; screens compose
// them and wire events by data attributes. Styles are in css/components.css. Owner: deck (shared UI).
//
// Rule for every agent (spec 3.4, ARCHITECTURE #49): never draw a verdict any other way than
// verdictBadge(), never hand-build a pill, chip, banner, empty state or primary button. A later swap
// to rubber stamps changes verdictBadge() and its CSS only.
//
// Visual check: public/dev/gallery.html renders every component in both themes.
import { esc } from "../ui.js";
import { icon } from "./icons.js";

const VERDICTS = { shred: "Shred", scan_shred: "Scan + shred", keep_original: "Keep original" };
export const verdictStamp = (v) => VERDICTS[v] || "";
const attrs = (a = {}) => Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("");

// ---------- 3.4 VerdictBadge: the only place a verdict is drawn ----------
// size: "regular" on cards and lists, "large" in the card detail. Never give it a fixed width or height.
export function verdictBadge(verdict, { size = "regular" } = {}) {
  const stamp = verdictStamp(verdict);
  if (!stamp) return "";
  return `<span class="verdict-badge v-${esc(verdict)}${size === "large" ? " large" : ""}" role="img" aria-label="Verdict: ${esc(stamp)}">${esc(stamp)}</span>`;
}

// ---------- 3.5 Chips and pills ----------
export const sensitiveChip = () => `<span class="pill pill-unsure">${icon("lock.fill")}Sensitive</span>`;
export const retentionChip = (text) => text ? `<span class="pill pill-gray pill-trunc" title="${esc(text)}">${esc(text)}</span>` : "";
export const unsurePill = (n) => n > 0 ? `<span class="pill pill-unsure">${n} to check</span>` : "";
// FilterChip (search) and ChoiceChip (sheet dates) look the same; on = selected.
export function filterChip(label, { on = false, ...a } = {}) {
  return `<button type="button" class="chip${on ? " on" : ""}" aria-pressed="${on}"${attrs(a)}>${esc(label)}</button>`;
}
export const choiceChip = (label, { on = false, ...a } = {}) =>
  `<button type="button" class="chip${on ? " on" : ""}" role="radio" aria-checked="${on}"${attrs(a)}>${esc(label)}</button>`;

// ---------- 3.6 StatusPill ----------
// kind: safe, waiting, todo, requested, waiting_cycle, confirmed, cant_stop, read, reading.
// text overrides the default copy (Waiting shows "3 days", "1 day", "Today" or "Checking").
const STATUS = {
  safe: ["Safe", "pill-file"], waiting: ["Waiting", "pill-gray", "clock"], todo: ["To do", "pill-gray"],
  requested: ["Requested", "pill-unsure"], waiting_cycle: ["Waiting a cycle", "pill-accent"],
  confirmed: ["Confirmed", "pill-file"], cant_stop: ["Can't stop", "pill-gray"],
  read: ["Read", "pill-file"], reading: ["Reading", "pill-gray"],
};
export function statusPill(kind, text) {
  const [label, cls, sym] = STATUS[kind] || [kind, "pill-gray"];
  return `<span class="pill ${cls}">${sym ? icon(sym) : ""}${esc(text || label)}</span>`;
}

// ---------- ProgressRing (30 pt, 3 pt stroke, accent over the separator track) ----------
export function progressRing(value = 0, { size = 30, stroke = 3, label } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || `${Math.round(v * 100)} percent`)}">`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ring-track"/>`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ring-value" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

// ---------- DocThumbnail (36 x 46 on CardWell, radius 6) ----------
export function docThumb(src, { large = false, alt = "" } = {}) {
  return `<span class="doc-thumb${large ? " large" : ""}">${src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : icon("doc")}</span>`;
}

// ---------- Buttons ----------
// PrimaryButton (spec 3.8 item 5): full width, AccentFill, white headline, capsule, 52 tall.
export function primaryButton(title, { working = false, disabled = false, ...a } = {}) {
  return `<button type="button" class="btn-primary"${disabled || working ? " disabled" : ""}${working ? ' aria-busy="true"' : ""}${attrs(a)}>`
    + `${working ? '<span class="spinner" aria-hidden="true"></span>' : ""}<span>${esc(title)}</span></button>`;
}
// .bordered / .borderedProminent capsules; small = .controlSize(.small).
export function button(title, { prominent = false, small = false, symbol, destructive = false, ...a } = {}) {
  const cls = ["cbtn", prominent ? "prominent" : "bordered", small ? "small" : "", destructive ? "destructive" : ""].filter(Boolean).join(" ");
  return `<button type="button" class="${cls}"${attrs(a)}>${symbol ? icon(symbol) : ""}<span>${esc(title)}</span></button>`;
}
// Glass circle (Undo, Skip, search circle, toolbar buttons).
export function glassCircle(symbol, label, { size = "regular", ...a } = {}) {
  return `<button type="button" class="glass-circle${size === "small" ? " small" : ""}" aria-label="${esc(label)}"${attrs(a)}>${icon(symbol)}</button>`;
}
// Avatar: initials on AccentSoft, accent text, 36 pt. Opens Settings.
export function avatarButton(initials, { size = 36, ...a } = {}) {
  return `<button type="button" class="avatar" style="--avatar:${size}px" aria-label="Settings"${attrs(a)}>${esc(initials || "")}</button>`;
}
export const initialsOf = (name, email) => {
  const src = String(name || "").trim() || String(email || "").split("@")[0];
  const parts = src.split(/[\s._-]+/).filter((p) => /^[a-z]/i.test(p));
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
};

// ---------- 3.9 Banners (never glass; lines up with an inset grouped section) ----------
// kind: safe (FileSoft), mailing (UnsureSoft), reconnect (ShredSoft). bold is the first sentence.
export function banner({ kind = "safe", bold = "", text = "", heading = "", actions = "", ...a } = {}) {
  const sym = { safe: "checkmark", mailing: "exclamationmark.triangle.fill", reconnect: "exclamationmark.icloud.fill" }[kind];
  return `<div class="banner b-${esc(kind)}" role="${kind === "reconnect" ? "alert" : "status"}"${attrs(a)}>`
    + `<span class="banner-sym">${icon(sym)}</span><div class="banner-body">`
    + (heading ? `<p class="banner-heading">${esc(heading)}</p>` : "")
    + `<p>${bold ? `<strong>${esc(bold)}</strong> ` : ""}${esc(text)}</p>`
    + (actions ? `<div class="banner-actions">${actions}</div>` : "") + `</div></div>`;
}

// ---------- 3.11 Empty and error states (ContentUnavailableView) ----------
export function emptyState({ symbol, title, description = "", actions = "", spinner = false, ...a } = {}) {
  return `<div class="empty-state"${attrs(a)}>`
    + (spinner ? '<span class="spinner large" aria-hidden="true"></span>' : symbol ? `<span class="empty-sym">${icon(symbol)}</span>` : "")
    + `<h2 class="empty-title">${esc(title)}</h2>`
    + (description ? `<p class="empty-desc">${esc(description)}</p>` : "")
    + (actions ? `<div class="empty-actions">${actions}</div>` : "") + `</div>`;
}

// ---------- Large-title nav bar ----------
// trailing: HTML for the toolbar (Scan menu button, avatar, Done). back: { label, ...attrs } for a
// pushed screen. The compact title fades in when the large title scrolls under the bar (shell.js).
export function navBar({ title, subtitle = "", trailing = "", leading = "", back, subtitleId, large = true } = {}) {
  const backBtn = back ? `<button type="button" class="nav-back" data-nav-back${attrs(Object.fromEntries(Object.entries(back).filter(([k]) => k !== "label")))}>${icon("chevron.left")}<span>${esc(back.label || "Back")}</span></button>` : "";
  return `<header class="navbar${large ? "" : " inline"}">`
    + `<div class="nav-bar"><div class="nav-leading">${backBtn}${leading}</div><p class="nav-compact" aria-hidden="true">${esc(title)}</p><div class="nav-trailing">${trailing}</div></div>`
    + (large ? `<div class="nav-large"><h1 class="nav-title">${esc(title)}</h1>${subtitle !== null ? `<p class="nav-subtitle"${subtitleId ? ` id="${esc(subtitleId)}"` : ""}>${esc(subtitle)}</p>` : ""}</div>` : "")
    + `</header>`;
}

// ---------- Inset grouped lists ----------
// header is drawn in caps (Section(caps:)), footer in footnote. rows: HTML from row() and friends.
export function section(rows, { header = "", footer = "", ...a } = {}) {
  return `<section class="group"${attrs(a)}>`
    + (header ? `<h3 class="group-header">${esc(header)}</h3>` : "")
    + `<div class="group-body">${rows}</div>`
    + (footer ? `<p class="group-footer">${esc(footer)}</p>` : "") + `</section>`;
}
// One row (spec 3.10). leading/trailing are HTML; chevron adds the disclosure; tag "a" with href, or
// "button" (default when it has an action), or "div" for a static row.
export function row({ leading = "", title = "", titleHtml = "", subtitle = "", subtitleHtml = "", trailing = "", chevron = false, tag, destructive = false, accent = false, ...a } = {}) {
  const t = tag || (a.href ? "a" : a["data-action"] || chevron ? "button" : "div");
  const cls = ["list-row", destructive ? "destructive" : "", accent ? "accent" : "", subtitle || subtitleHtml ? "two-line" : ""].filter(Boolean).join(" ");
  return `<${t} class="${cls}"${t === "button" ? ' type="button"' : ""}${attrs(a)}>`
    + (leading ? `<span class="row-leading">${leading}</span>` : "")
    + `<span class="row-text"><span class="row-title">${titleHtml || esc(title)}</span>`
    + (subtitle || subtitleHtml ? `<span class="row-subtitle">${subtitleHtml || esc(subtitle)}</span>` : "") + `</span>`
    + (trailing ? `<span class="row-trailing">${trailing}</span>` : "")
    + (chevron ? `<span class="row-chevron">${icon("chevron.right")}</span>` : "") + `</${t}>`;
}
// "Shred hold · 3 days ›" style row.
export const valueRow = (title, value, a = {}) => row({ title, trailing: `<span class="row-value">${esc(value)}</span>`, chevron: true, ...a });
// Toggle row: a real checkbox styled as the iOS switch.
export function toggleRow(title, { checked = false, id, subtitle = "", ...a } = {}) {
  const tid = id || `t-${Math.random().toString(36).slice(2, 8)}`;
  return `<label class="list-row toggle-row${subtitle ? " two-line" : ""}" for="${esc(tid)}"><span class="row-text"><span class="row-title">${esc(title)}</span>`
    + (subtitle ? `<span class="row-subtitle">${esc(subtitle)}</span>` : "")
    + `</span><input type="checkbox" role="switch" class="switch" id="${esc(tid)}"${checked ? " checked" : ""}${attrs(a)}></label>`;
}
// Radio row (check-fields sheet): Claude's value with "likely" / "possible" trailing. mono draws the
// title in SF Mono (filenames). field: { value, placeholder, label } turns the row's title into a
// text field in place ("Something else", spec 3.8); the input gets class "radio-field".
export function radioRow(title, { checked = false, hint = "", name = "r", value, mono = false, field, ...a } = {}) {
  const body = field
    ? `<input type="text" class="radio-field${mono ? " mono" : ""}" value="${esc(field.value || "")}" placeholder="${esc(field.placeholder || title)}" aria-label="${esc(field.label || title)}" autocomplete="off" spellcheck="false">`
    : `<span class="row-title${mono ? " t-mono" : ""}">${esc(title)}</span>`;
  return `<label class="radio-row${checked ? " on" : ""}${field ? " has-field" : ""}"><input type="radio" name="${esc(name)}" value="${esc(value ?? title)}"${checked ? " checked" : ""}${field ? ` aria-label="${esc(title)}"` : ""}${attrs(a)}>`
    + `<span class="radio-dot" aria-hidden="true"></span>${body}${hint ? `<span class="radio-hint">${esc(hint)}</span>` : ""}</label>`;
}

// ---------- Segmented control (Piles: "Shred 9", "Keep 3", "All filed 64") ----------
export function segmented(items, { selected, label = "", ...a } = {}) {
  return `<div class="segmented" role="tablist"${label ? ` aria-label="${esc(label)}"` : ""}${attrs(a)}>`
    + items.map((it) => `<button type="button" role="tab" data-seg="${esc(it.value)}" aria-selected="${it.value === selected}">${esc(it.label)}</button>`).join("")
    + `</div>`;
}

// ---------- Deck card pieces that other screens reuse ----------
// UnsureRow: UnsureSoft background, radius 10, value leading, "Not sure" trailing.
export const unsureRow = (value, a = {}) =>
  `<button type="button" class="unsure-row"${attrs(a)}><span>${esc(value)}</span><span class="unsure-tag">Not sure</span></button>`;
// Search highlight: wraps every case-insensitive match of the query words in <mark>.
export function highlight(text, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return esc(text);
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  // split() with a capture group puts the matches at the odd indexes; escape every piece.
  return String(text ?? "").split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}

// ---------- 3.7 OutboxAccessory: the bar above the tab bar ----------
// state (from outbox.js's "outbox:status" event, docs/web-contract.md):
//   { kind: "idle", filedToday }           checkmark.circle.fill + "All caught up · 14 filed today",
//                                          or tray + "Outbox is empty" when filedToday is 0
//   { kind: "uploading", done, total, progress }   ring + "Uploading 2 of 5"
//   { kind: "offline", saved }              wifi.slash + "Waiting for a connection · 3 saved on your phone"
//   { kind: "attention", count }            triangle + "1 needs a retry" / "3 need a retry"
//   { kind: "reconnect" }                   icloud + "Reconnect Drive to keep filing"
// Precedence is the outbox's job (reconnect, then attention, then uploading). Returns the inner HTML
// of the accessory button; inline: true is the compact form used when the tab bar is minimized.
export function accessoryTitle(s = { kind: "idle", filedToday: 0 }) {
  switch (s.kind) {
    case "uploading": return `Uploading ${s.done} of ${s.total}`;
    case "offline": return `Waiting for a connection · ${s.saved} saved on your phone`;
    case "attention": return `${s.count} ${s.count === 1 ? "needs" : "need"} a retry`;
    case "reconnect": return "Reconnect Drive to keep filing";
    default: return s.filedToday ? `All caught up · ${s.filedToday} filed today` : "Outbox is empty";
  }
}
export function outboxAccessory(s = { kind: "idle", filedToday: 0 }, { inline = false } = {}) {
  const glyph = {
    uploading: () => progressRing(s.progress || 0, { label: `${Math.round((s.progress || 0) * 100)} percent` }),
    offline: () => `<span class="acc-sym muted">${icon("wifi.slash")}</span>`,
    attention: () => `<span class="acc-sym unsure">${icon("exclamationmark.triangle.fill")}</span>`,
    reconnect: () => `<span class="acc-sym danger">${icon("exclamationmark.icloud.fill")}</span>`,
    idle: () => s.filedToday ? `<span class="acc-sym file">${icon("checkmark.circle.fill")}</span>` : `<span class="acc-sym muted">${icon("tray")}</span>`,
  }[s.kind] || (() => "");
  const count = { uploading: `${s.done} of ${s.total}`, offline: s.saved, attention: s.count, idle: s.filedToday || "" }[s.kind] ?? "";
  if (inline) return `${glyph()}<span class="acc-count">${esc(count)}</span>`;
  return `${glyph()}<span class="acc-title">${esc(accessoryTitle(s))}</span><span class="acc-trail">Outbox</span>${icon("chevron.right")}`;
}
