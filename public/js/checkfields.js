// checkfields.js: the check-fields sheet (spec 3.8, A2, #20) and the folder picker (4.13). Owner:
// deck. The web twin of the iPhone app's CheckFieldsSheet and CheckFieldsModel: one section per
// Not sure field in sheet order, Claude's best value ("likely") then its other guesses
// ("possible"), "Something else" as a text field in place, date chips with "Pick a date", folder
// guesses with "Choose another folder", the verdict as a segmented control, "Remember for this
// sender" (on by default), and "Confirm and file".
//
//   const r = await openCheckFields({ card, fields: ["issuer", "docDate"], focus: "docDate" });
//   r is null when the sheet was swiped away, else { card, remember }: the card with the chosen
//   values written in and those fields marked confident. The deck saves the rule and files it.
//
//   const folder = await openFolderPicker(current)   // a folder name, or null
import { FOLDER_NAMES, VERDICT } from "./config.js";
import { esc, cleanName } from "./ui.js";
import { markConfident, FIELD_ORDER } from "./classify.js";
import { icon } from "./ui/icons.js";
import { radioRow, choiceChip, segmented, toggleRow, primaryButton, section, row } from "./ui/components.js";
import { openSheet } from "./ui/sheet.js";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDate = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? DAY.format(new Date(`${ymd}T00:00:00Z`)) : "No date");
const folderName = (f) => String(f || "").replace(/^\d+\s+/, "");
const LABEL = { issuer: "Sender", folder: "Folder", title: "Title", filename: "Filename", verdict: "Verdict" };
function dateLabel(docType) {
  const t = String(docType || "").toLowerCase();
  if (/bill|statement/.test(t)) return "Statement date";
  if (/receipt/.test(t)) return "Receipt date";
  if (/explanation of benefits|\beob\b/.test(t)) return "Claim date";
  return "Date";
}
const CUSTOM = "__custom";

export function openCheckFields({ card, fields, focus } = {}) {
  const original = card;
  const list = FIELD_ORDER.filter((f) => fields.includes(f));
  const st = {
    sel: Object.fromEntries(list.map((f) => [f, original[f] || ""])),
    custom: new Set(), typed: {}, pickedDate: "", pickedFolder: "", remember: true, view: "main",
  };
  const value = (f) => {
    if (st.custom.has(f)) { const t = String(st.typed[f] || "").trim(); if (t) return t; return original[f] || ""; }
    return f in st.sel ? st.sel[f] : original[f] || "";
  };
  // Claude's value first, then its other guesses, then anything picked by hand.
  const options = (f) => {
    const out = [];
    if (original[f]) out.push({ value: original[f], hint: "likely" });
    for (const v of original.alternatives?.[f] || []) if (v && !out.some((o) => o.value === v)) out.push({ value: v, hint: "possible" });
    if (f === "docDate" && st.pickedDate && !out.some((o) => o.value === st.pickedDate)) out.push({ value: st.pickedDate, hint: "" });
    if (f === "folder" && st.pickedFolder && !out.some((o) => o.value === st.pickedFolder)) out.push({ value: st.pickedFolder, hint: "" });
    return out;
  };
  const label = (f) => (f === "docDate" ? dateLabel(value("docType") || original.docType) : LABEL[f]);
  const footerText = () => `Next time, ${value("issuer") || original.issuer || "this sender"} files this way without asking.`;

  function sectionFor(f) {
    const name = `cf-${f}`;
    let body;
    if (f === "docDate") {
      body = `<div class="chips cf-chips" role="radiogroup" aria-label="${esc(label(f))}">`
        + options(f).map((o) => choiceChip(fmtDate(o.value), { on: value(f) === o.value, "data-date": o.value })).join("")
        + choiceChip("Pick a date", { on: false, "data-pick": "", "aria-haspopup": "dialog" })
        + `</div><input type="date" class="cf-date-input" tabindex="-1" aria-hidden="true" value="${esc(value(f))}">`;
    } else if (f === "verdict") {
      body = segmented(Object.keys(VERDICT).map((v) => ({ value: v, label: VERDICT[v].stamp })), { selected: value(f), label: "Verdict", "data-verdict": "" });
    } else {
      const opts = options(f).map((o) => radioRow(f === "folder" ? folderName(o.value) : f === "filename" ? `${o.value}.pdf` : o.value,
        { checked: !st.custom.has(f) && value(f) === o.value, hint: o.hint, name, value: o.value, mono: f === "filename" }));
      let more = "";
      if (f === "folder") more = `<button type="button" class="radio-row cf-more" data-more-folder><span class="row-title">Choose another folder</span>${icon("chevron.right")}</button>`;
      else more = radioRow("Something else", { checked: st.custom.has(f), name, value: CUSTOM, mono: f === "filename",
        field: st.custom.has(f) ? { value: st.typed[f] || "", placeholder: f === "filename" ? "filename" : "Something else", label: `${LABEL[f]}, something else` } : null });
      body = `<div class="cf-options" role="radiogroup" aria-label="${esc(label(f))}">${opts.join("")}${more}</div>`;
    }
    return `<section class="cf-sec" data-field="${f}"><h3 class="group-header">${esc(label(f))}</h3>${body}</section>`;
  }
  const mainHtml = () => list.map(sectionFor).join("")
    + `<section class="cf-sec cf-remember">${section(toggleRow("Remember for this sender", { checked: st.remember, id: "cf-remember" }))}`
    + `<p class="group-footer cf-remember-foot"${st.remember ? "" : " hidden"}>${esc(footerText())}</p></section>`;

  const s = openSheet({ title: list.length === 1 ? "Check 1 field" : `Check ${list.length} fields`, subtitle: "Everything else looks right.",
    label: "Check fields", className: "cf-sheet", body: `<div class="cf-main">${mainHtml()}</div>`, footer: primaryButton("Confirm and file", { "data-confirm": "" }) });
  const main = () => s.body.querySelector(".cf-main");
  let result = null;

  const redraw = (f) => {
    const el = s.body.querySelector(`.cf-sec[data-field="${f}"]`);
    if (el) el.outerHTML = sectionFor(f);
    const foot = s.body.querySelector(".cf-remember-foot");
    if (foot) { foot.textContent = footerText(); foot.hidden = !st.remember; }
  };

  s.body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "cf-remember") { st.remember = t.checked; redraw(); return; }
    if (t.classList.contains("cf-date-input")) { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) { st.pickedDate = t.value; st.sel.docDate = t.value; redraw("docDate"); s.body.querySelector(`[data-date="${t.value}"]`)?.focus(); } return; }
    if (t.type === "radio") {
      const f = t.closest(".cf-sec").dataset.field;
      if (t.value === CUSTOM) {
        st.custom.add(f); redraw(f);
        s.body.querySelector(`.cf-sec[data-field="${f}"] .radio-field`)?.focus();
      } else { st.custom.delete(f); st.sel[f] = t.value; redraw(f); s.body.querySelector(`.cf-sec[data-field="${f}"] input[type=radio]:checked`)?.focus(); }
    }
  });
  s.body.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.classList.contains("radio-field")) return;
    const f = t.closest(".cf-sec").dataset.field;
    st.typed[f] = t.value;
    if (f === "issuer") redraw();
  });
  s.body.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-date]");
    if (chip) { st.sel.docDate = chip.dataset.date; redraw("docDate"); s.body.querySelector(`[data-date="${chip.dataset.date}"]`)?.focus(); return; }
    if (e.target.closest("[data-pick]")) {
      const input = s.body.querySelector(".cf-date-input");
      try { input.showPicker(); } catch { input.focus(); input.click(); }
      return;
    }
    const seg = e.target.closest("[data-verdict] [data-seg]");
    if (seg) { st.sel.verdict = seg.dataset.seg; redraw("verdict"); s.body.querySelector(`[data-verdict] [data-seg="${seg.dataset.seg}"]`)?.focus(); return; }
    if (e.target.closest("[data-more-folder]")) { showFolders(); return; }
    const pick = e.target.closest("[data-folder]");
    if (pick) { st.pickedFolder = pick.dataset.folder; st.sel.folder = pick.dataset.folder; st.custom.delete("folder"); showMain("folder"); return; }
    if (e.target.closest("[data-folders-back]")) showMain("folder");
  });

  // "Choose another folder" pushes the folder list inside the sheet, which goes to the large detent.
  function showFolders() {
    st.view = "folders";
    main().hidden = true;
    s.footer.hidden = true;
    s.body.insertAdjacentHTML("beforeend", `<div class="cf-folders"><div class="cf-sub-bar"><button type="button" class="nav-back" data-folders-back>${icon("chevron.left")}<span>Back</span></button><p class="cf-sub-title">Folder</p></div>`
      + folderList(value("folder")) + "</div>");
    s.setDetent("large");
    s.body.scrollTop = 0;
    s.body.querySelector("[data-folder][aria-checked=true]")?.focus();
  }
  function showMain(f) {
    st.view = "main";
    s.body.querySelector(".cf-folders")?.remove();
    main().hidden = false;
    s.footer.hidden = false;
    if (f) redraw(f);
    s.body.querySelector(`.cf-sec[data-field="${f}"] input:checked`)?.focus();
  }

  s.footer.querySelector("[data-confirm]").addEventListener("click", () => {
    result = { card: confirmedCard(), remember: st.remember };
    s.close("confirmed");
  });

  // The card with the chosen values (CheckFieldsModel.confirmedCard). When the date changes and the
  // filename wasn't typed, the filename's date follows it.
  function confirmedCard() {
    const c = { ...original };
    for (const f of list) {
      const v = value(f);
      if (f === "docDate") c.docDate = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : original.docDate;
      else if (f === "folder") c.folder = FOLDER_NAMES.includes(v) ? v : original.folder;
      else if (f === "verdict") c.verdict = VERDICT[v] ? v : original.verdict;
      else if (f === "filename") c.filename = cleanName(v).slice(0, 120) || original.filename;
      else c[f] = String(v).slice(0, f === "title" ? 140 : 100);
    }
    const typedName = list.includes("filename") && c.filename !== original.filename;
    if (!typedName && c.docDate !== original.docDate) c.filename = c.filename.replace(original.docDate || "0000-00-00", c.docDate || "0000-00-00");
    if (c.paperless && c.paperless.issuer === original.issuer) c.paperless = { ...c.paperless, issuer: c.issuer };
    return markConfident(c, list);
  }

  // Open at the field that was tapped on the card.
  if (focus) requestAnimationFrame(() => {
    const sec = s.body.querySelector(`.cf-sec[data-field="${focus}"]`);
    if (!sec) return;
    sec.scrollIntoView({ block: "nearest" });
    sec.classList.add("cf-focus");
    sec.querySelector("input:checked, .chip.on, [aria-selected=true]")?.focus({ preventScroll: true });
  });

  return s.closed.then(() => result);
}

function folderList(current) {
  return section(FOLDER_NAMES.map((f) => row({ tag: "button", title: folderName(f), "data-folder": f, role: "radio", "aria-checked": String(f === current),
    trailing: f === current ? `<span class="cf-check">${icon("checkmark")}</span>` : "" })).join(""));
}

// The folder picker on its own (card detail, 4.13): a list of the 11 folders by display name,
// checkmark on the current one.
export function openFolderPicker(current) {
  let picked = null;
  const s = openSheet({ title: "Folder", label: "Folder", detents: ["large"], className: "cf-sheet", body: folderList(current) });
  s.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-folder]");
    if (!b) return;
    picked = b.dataset.folder;
    s.close("picked");
  });
  requestAnimationFrame(() => s.body.querySelector("[aria-checked=true]")?.focus());
  return s.closed.then(() => picked);
}
