// The component gallery: every shared component from js/ui/ with the spec's copy, so a change can
// be checked by eye in both themes before it reaches a screen. Theme: the segmented control at the
// top, or ?theme=dark|light. Not deployed (firebase.json ignores dev/).
import {
  verdictBadge, sensitiveChip, retentionChip, unsurePill, filterChip, choiceChip, statusPill, progressRing, docThumb,
  primaryButton, button, glassCircle, avatarButton, banner, emptyState, navBar, section, row, valueRow, toggleRow, radioRow,
  segmented, unsureRow, highlight, outboxAccessory,
} from "../js/ui/components.js";
import { icon } from "../js/ui/icons.js";
import { openSheet, actionSheet } from "../js/ui/sheet.js";
import { bindMenu } from "../js/ui/menu.js";
import { toast } from "../js/ui/toast.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const setTheme = (t) => { if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t; };
setTheme(params.get("theme") || "system");

$("g-nav").outerHTML = navBar({ title: "Components", subtitle: "Direction A on the web", trailing: glassCircle("doc.viewfinder", "Scan", { size: "small", id: "g-scan" }) + avatarButton("BW", { id: "g-avatar" }) });

const swatch = (name) => `<span class="g-swatch"><i style="background:var(--${name})"></i>${name}</span>`;
const thumb = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="92"><rect width="72" height="92" fill="#fff"/><g fill="#c9ced6"><rect x="8" y="10" width="34" height="5"/><rect x="8" y="22" width="56" height="3"/><rect x="8" y="29" width="56" height="3"/><rect x="8" y="36" width="40" height="3"/><rect x="8" y="50" width="26" height="14"/><rect x="38" y="50" width="26" height="14"/></g></svg>');

const ACC = [
  { kind: "idle", filedToday: 14 }, { kind: "idle", filedToday: 0 }, { kind: "uploading", done: 2, total: 5, progress: 0.62 },
  { kind: "offline", saved: 3 }, { kind: "attention", count: 1 }, { kind: "attention", count: 3 }, { kind: "reconnect" },
];

$("g-body").innerHTML = [
  `<div class="g-pad">${segmented([{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }], { selected: params.get("theme") || "system", label: "Theme", id: "g-theme" })}</div>`,

  section(`<div class="g-pad" style="padding:16px">
    <div class="g-swatches">${["background", "surface", "card-well", "accent", "accent-fill", "accent-soft", "shred", "shred-soft", "keep", "keep-soft", "file", "file-soft", "file-fill", "unsure", "unsure-soft", "separator"].map(swatch).join("")}</div></div>`, { header: "Colors" }),

  section(`<div class="g-pad g-type" style="padding:16px">
    <p class="t-large-title">Large title 34</p><p class="t-title2">2025 W-2 (title2 bold)</p><p class="t-title3" style="font-weight:700">Check 2 fields</p>
    <p class="t-headline">Headline 17</p><p class="t-body">Body 17. Pharmacy receipt</p><p class="t-subheadline t-muted">Northwind Logistics · Jan 30, 2026</p>
    <p class="t-footnote t-muted">Footnote 13. Drive copy confirmed · hold ends Oct 15</p><p class="t-caption">Caption 12</p><p class="t-mono t-muted">2026-01-30_W-2_Northwind-Logistics.pdf</p></div>`, { header: "Type" }),

  section(`<div class="g-pad" style="padding:16px">
    <div class="g-row">${verdictBadge("shred")}${verdictBadge("scan_shred")}${verdictBadge("keep_original")}</div>
    <div class="g-row">${verdictBadge("scan_shred", { size: "large" })}</div>
    <div class="g-row">${sensitiveChip()}${retentionChip("Keep 7 years")}${retentionChip("Keep for HSA, 3 years")}${unsurePill(2)}</div>
    <div class="g-row">${statusPill("safe")}${statusPill("waiting", "2 days")}${statusPill("waiting", "Checking")}${statusPill("todo")}${statusPill("requested")}${statusPill("waiting_cycle")}${statusPill("confirmed")}${statusPill("cant_stop")}${statusPill("read")}${statusPill("reading")}</div>
    <div class="g-row" role="group" aria-label="Filters">${filterChip("Tax forms", { on: true })}${filterChip("2023", { on: true })}${filterChip("Sensitive")}${filterChip("Keep originals")}</div>
    <div class="g-row" role="radiogroup" aria-label="Statement date">${choiceChip("Sep 28, 2026", { on: true })}${choiceChip("Oct 3 (due date)")}${choiceChip("Pick a date")}</div>
  </div>`, { header: "Verdicts, pills and chips" }),

  section(`<div class="g-pad" style="padding:16px">
    <div class="g-row">${progressRing(0.62)}${progressRing(0.2)}${docThumb(thumb)}${docThumb(null)}${docThumb(thumb, { large: true })}${avatarButton("BW")}${avatarButton("BW", { size: 48 })}</div>
    ${primaryButton("Confirm and file")}
    ${primaryButton("Send 3 to the deck", { working: true })}
    ${primaryButton("File 7", { disabled: true })}
    <div class="g-row">${button("Scan", { prominent: true })}${button("Scan more")}${button("Retry", { small: true })}${button("3 skipped", { small: true, symbol: "arrow.up.forward" })}${button("Forget", { destructive: true })}</div>
    <div class="g-row">${glassCircle("arrow.uturn.backward", "Undo last swipe")}${glassCircle("arrow.up.forward", "Skip")}${glassCircle("arrow.uturn.backward", "Undo, nothing to undo", { disabled: true })}</div>
    ${unsureRow("Cascade Power & Light")}${unsureRow("Sep 28, 2026")}
  </div>`, { header: "Buttons and controls" }),

  `<div class="g-pad">${banner({ kind: "safe", bold: "6 are safe to shred.", text: "The Drive copy is confirmed and the 3-day hold is over." })}
    ${banner({ kind: "mailing", heading: "Still mailing?", text: "Cascade Power & Light sent a paper bill on Oct 9, after you requested paperless.", actions: button("Open their steps", { small: true }) + button("Wait a cycle", { small: true }) })}
    ${banner({ kind: "reconnect", bold: "Drive needs reconnecting.", text: "Your scans are safe on this phone and upload once it's back.", actions: button("Reconnect Drive", { small: true }) })}</div>`,

  section(
    row({ leading: docThumb(thumb), title: "1099-INT · Harbor Federal", subtitle: "Drive didn't answer. Trying again in 2 min.", trailing: button("Retry", { small: true }) })
    + row({ leading: docThumb(thumb), title: "Electric bill · Cascade", subtitleHtml: '<progress value="0.62" max="1" style="width:100%"></progress>', trailing: "62%" })
    + row({ leading: docThumb(thumb), title: "2025 W-2 · Northwind", subtitle: "Next in line" })
    + row({ leading: `<span style="color:var(--file)">${icon("checkmark", { size: 22 })}</span>`, title: "Pharmacy receipt · Elm Street", subtitle: "1 of 1 pages confirmed in Drive · 10:12 AM" }),
    { header: "Outbox rows" }),

  section(
    row({ leading: docThumb(thumb), title: "Pharmacy receipt", subtitle: "Elm Street Pharmacy · Cross-cut", trailing: statusPill("safe"), "data-action": "open" })
    + row({ leading: docThumb(thumb), title: "2025 W-2", subtitle: "Drive copy confirmed · hold ends Oct 15", trailing: statusPill("waiting", "2 days"), "data-action": "open" })
    + row({ title: "3 more", chevron: true, "data-action": "more" }),
    { header: "Safe to shred" }),

  section(
    row({ leading: docThumb(thumb), titleHtml: highlight("2023 W-2", "w-2 2023"), subtitleHtml: `Northwind Logistics · Taxes › 2023<br>“…${highlight("Form W-2 Wage and Tax Statement 2023, box 1 wages", "w-2 2023")}…”` })
    + row({ leading: `<span class="row-leading">${icon("clock", { size: 20 })}</span>`, title: "car title", "data-action": "recent" }),
    { header: "3 results" }),

  section(
    valueRow("Sender rules", "14", { "data-action": "rules" }) + valueRow("Shred hold", "3 days", { "data-action": "hold" })
    + toggleRow("Offer to file confident cards together", { checked: true, id: "g-bulk" }),
    { header: "Sorting", footer: "When it's on, Sort offers to file the cards Claude is sure about in one go. You still see each one in the list first." }),

  section(row({ title: "Sign out", destructive: true, "data-action": "signout" }) + row({ title: "Reconnect Drive", accent: true, "data-action": "reconnect" })),

  `<div class="g-pad">${segmented([{ value: "shred", label: "Shred 9" }, { value: "keep", label: "Keep 3" }, { value: "all", label: "All filed 64" }], { selected: "shred", label: "Piles" })}</div>`,

  section(`<div style="padding:16px;display:grid;gap:8px">${radioRow("Cascade Power & Light", { checked: true, hint: "likely", name: "sender" })}${radioRow("Cascade Natural Gas", { hint: "possible", name: "sender" })}${radioRow("Something else", { name: "sender" })}</div>`, { header: "Sender" }),

  section(ACC.map((s) => `<div class="list-row"><div class="accessory" style="box-shadow:none;padding:0">${outboxAccessory(s)}</div></div>`).join(""), { header: "Outbox accessory, every state" }),

  `<div class="g-card"><div class="well">${docThumb(thumb, { large: true })}${verdictBadge("scan_shred")}</div><div class="body">
    <p class="t-title2" style="margin:0">2025 W-2</p><p class="t-subheadline t-muted" style="margin:0">Northwind Logistics · Jan 30, 2026</p>
    <p class="t-subheadline" style="margin:0"><span class="t-muted">${icon("folder")}</span> Taxes › 2025</p>
    <div class="g-row">${sensitiveChip()}${retentionChip("Keep 7 years")}</div><p class="t-mono t-muted" style="margin:0">2026-01-30_W-2_Northwind-Logistics.pdf</p></div></div>`,

  section(emptyState({ symbol: "doc.viewfinder", title: "Scan your first stack", description: "Claude reads each document and gets it ready to file.", actions: button("Scan", { prominent: true }) })),
  section(emptyState({ symbol: "arrow.up.forward.circle", title: "3 skipped. Sort them now?", description: "14 filed today. The outbox is handling the uploads.", actions: button("Sort skipped", { prominent: true }) + button("Scan more") })),
  section(emptyState({ spinner: true, title: "Reading 3 documents", description: "They show up here as soon as Claude is done." })),

  `<div class="g-pad">
    ${button("Open a medium sheet", { id: "g-sheet" })}${button("Open a large sheet", { id: "g-sheet-l" })}
    ${button("Confirmation dialog", { id: "g-confirm" })}${button("Scan menu", { id: "g-menu", symbol: "doc.viewfinder" })}${button("Toast", { id: "g-toast" })}</div>`,
].join("");

// tab bar sample
$("g-tabs").innerHTML = [["Sort", "rectangle.stack", true], ["Piles", "square.stack.3d.up"], ["Paperless", "leaf"]]
  .map(([l, s, on]) => `<a class="tabbar-item" role="tab" href="#${l}" aria-selected="${!!on}">${icon(s, { size: 24 })}<span>${l}</span></a>`).join("");
$("g-search").innerHTML = icon("magnifyingglass", { size: 22 });
let acc = 2;
const drawAcc = () => { $("outbox-accessory").innerHTML = outboxAccessory(ACC[acc]); };
drawAcc();
$("outbox-accessory").addEventListener("click", () => { acc = (acc + 1) % ACC.length; drawAcc(); });
requestAnimationFrame(() => $("app").style.setProperty("--dock-h", `${Math.ceil($("dock").getBoundingClientRect().height)}px`));

// theme switch
$("g-theme").addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg]"); if (!b) return;
  $("g-theme").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  setTheme(b.dataset.seg);
});

// sheets, dialog, menu, toast
const checkFields = () => section(`<div style="padding:12px;display:grid;gap:8px">${radioRow("Cascade Power & Light", { checked: true, hint: "likely", name: "s2" })}${radioRow("Cascade Natural Gas", { hint: "possible", name: "s2" })}</div>`, { header: "Sender" })
  + section(`<div class="g-row" style="padding:12px" role="radiogroup" aria-label="Statement date">${choiceChip("Sep 28, 2026", { on: true })}${choiceChip("Oct 3 (due date)")}</div>`, { header: "Statement date" })
  + section(toggleRow("Remember for this sender", { checked: true }), { footer: "Next time, Cascade Power & Light files this way without asking." });
$("g-sheet").addEventListener("click", () => {
  const s = openSheet({ title: "Check 2 fields", subtitle: "Everything else looks right.", body: checkFields(), footer: primaryButton("Confirm and file", { "data-confirm": true }) });
  s.footer.querySelector("[data-confirm]").addEventListener("click", () => { s.close("confirmed"); toast("Filed Electric bill, September"); });
});
$("g-sheet-l").addEventListener("click", () => openSheet({ title: "3 skipped", body: section(["Pharmacy receipt", "2023 1099-INT", "Vehicle title"].map((t) => row({ leading: docThumb(thumb), title: t, subtitle: "Elm Street Pharmacy · Aug 12, 2026", trailing: button("Sort now", { small: true }) })).join(""), { footer: "Saved on your phone until you sort them. Nothing uploads while they wait." }), footer: primaryButton("Sort skipped"), detents: ["medium", "large"], initial: "large" }));
$("g-confirm").addEventListener("click", async () => {
  const v = await actionSheet({ title: "Shred a Keep original?", message: "Claude marked this one to keep the paper. A title is the legal proof of ownership.", actions: [{ label: "Shred anyway", value: "shred", destructive: true }] });
  toast(v ? "Shredded Vehicle title" : "Kept on the deck");
});
const scanItems = () => [
  { label: "Scan document", symbol: "doc.viewfinder", action: () => toast("Scan document") },
  { label: "Import from Files", symbol: "folder", action: () => toast("Import from Files") },
  { label: "Import from Photos", symbol: "photo", action: () => toast("Import from Photos") },
];
bindMenu($("g-menu"), scanItems, { align: "start" });
bindMenu($("g-scan"), scanItems);
$("g-toast").addEventListener("click", () => toast("3 cards back on the deck", { action: { label: "Undo", fn: () => toast("Undone") } }));

// The nav bar's glass appears once the large title scrolls under it, as in the app shell.
addEventListener("scroll", () => document.querySelector(".navbar").classList.toggle("scrolled", scrollY > 60), { passive: true });
