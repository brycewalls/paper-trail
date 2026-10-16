// lab/compare.js: compare mode (#92). Bryce's bar for the lab is "just as good as the Claude model",
// so with compare mode on (Settings, Lab; on unless he turns it off) every lab read also asks the
// classify callable the same question the live app asks, in the background and only to measure the
// rules. Claude's answer never replaces the rules' card on its own.
//
//   - records every lab read in users/{uid}/lab/reader/reads/{readId} (store.js): the rules' card,
//     where the text came from, Needs a look, then Claude's card and the per-field agreement
//   - the card's quiet chip: "Claude agrees" / "Claude differs" (labChip), "Asking Claude" while it
//     waits, "Claude didn't answer" when it failed
//   - the compare sheet (openCompare): every field side by side; for each field that differs Bryce
//     picks Rules or Claude. The pick is ground truth (picks and truth on the read), the card takes
//     the picked values, and a pick on sender, folder or filename is saved as a sender rule
//   - fieldAgrees, compareCards: how two answers are scored, shared with lab/stats.js and the tests
//
// Events: listens for "lab:read" (classify.js) and session events; emits "lab:compared" { id }.
// Owner: lab reader.
import { esc, slug, on, emit } from "../ui.js";
import { FOLDER_NAMES, VERDICT } from "../config.js";
import { claudeRead, readCode, unsureFields, markConfident, patternFromFilename, folderName, FIELD_ORDER } from "../classify.js";
import { putLabRead, updateLabRead, watchLabSettings, saveLabSettings } from "../store.js";
import { saveRule, ruleFor } from "../senders.js";
import { openSheet } from "../ui/sheet.js";
import { section, segmented, primaryButton, verdictStamp } from "../ui/components.js";
import { icon } from "../ui/icons.js";

// ---------- scoring ----------
// Scored fields, in the order the sheet and Lab Stats show them. summary and verdictReason are prose:
// shown side by side, never scored.
export const SCORED = ["issuer", "docType", "docDate", "folder", "filename", "verdict", "title", "retention", "sensitive", "paperless"];
export const PROSE = ["summary", "verdictReason"];
// "Claude agrees" on the card means these all agree: what decides where the paper goes.
export const ROUTING = ["issuer", "docType", "docDate", "folder", "filename", "verdict", "sensitive"];
export const LAB_LABEL = { issuer: "Sender", docType: "Type", docDate: "Date", folder: "Folder", filename: "Filename", verdict: "Verdict", title: "Title",
  retention: "Keep for", sensitive: "Sensitive", paperless: "Go paperless", summary: "Summary", verdictReason: "Why" };

const STOP = new Set(["the", "a", "an", "of", "for", "and", "to", "from", "in", "on", "your", "my", "inc", "llc", "co", "corp", "corporation", "company", "ltd", "na", "n", "pdf"]);
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !STOP.has(w));
function overlap(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / new Set([...A, ...B]).size;
}
// Every word of the shorter one is in the longer one ("Duke Energy" and "Duke Energy Progress").
function contains(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return false;
  const [s, l] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
  return s.every((w) => l.has(w));
}
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");   // "W-2" and "W2"
const dateIn = (s) => (String(s || "").match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
// "Keep 7 years" and "7 years (tax backup)" agree; "Permanently" and "Keep forever" agree.
export function retentionClass(s) {
  const t = String(s || "").toLowerCase();
  if (!t.trim()) return "";
  if (/not needed|no need|don't keep|do not keep|shred/.test(t)) return "none";
  if (/perman|forever|always|indefinite|lifetime|for life/.test(t)) return "forever";
  const m = t.match(/(\d+)\s*(year|yr|month|mo)/);
  if (m) return /^m/.test(m[2]) ? `${m[1]}mo` : `${m[1]}y`;
  if (/until|while|as long as|replaced|expires|ends/.test(t)) return "until";
  return words(t).join(" ");
}
export function fieldAgrees(field, a, b) {
  a = a || {}; b = b || {};
  const x = a[field], y = b[field];
  switch (field) {
    case "docDate": case "folder": case "verdict": return String(x || "") === String(y || "");
    case "sensitive": return !!x === !!y;
    case "paperless": return !!(x && x.possible) === !!(y && y.possible);
    case "issuer": return squash(x) === squash(y) || contains(x, y);
    case "docType": return squash(x) === squash(y) || contains(x, y) || overlap(x, y) >= 0.5;
    case "filename": return slug(x) === slug(y) || (dateIn(x) === dateIn(y) && overlap(String(x).replace(/\d{4}-\d{2}-\d{2}/, ""), String(y).replace(/\d{4}-\d{2}-\d{2}/, "")) >= 0.5);
    case "title": return overlap(x, y) >= 0.5 || contains(x, y);
    case "retention": return retentionClass(x) === retentionClass(y);
    default: return String(x || "").trim().toLowerCase() === String(y || "").trim().toLowerCase();
  }
}
// { fields: { field: bool }, agrees: every ROUTING field agrees, agreed, scored }
export function compareCards(rules, claude) {
  const fields = {};
  for (const f of SCORED) fields[f] = fieldAgrees(f, rules, claude);
  const agreed = SCORED.filter((f) => fields[f]).length;
  return { fields, agrees: ROUTING.every((f) => fields[f]), agreed, scored: SCORED.length };
}
// The card's fields as stored on a read (no confidence or alternatives).
export const cardFields = (c) => (c ? Object.fromEntries([...SCORED, ...PROSE].map((f) => [f, c[f] ?? (f === "sensitive" ? false : f === "paperless" ? { possible: false, issuer: "", how: "" } : "")])) : null);

// ---------- compare mode setting (users/{uid}/lab/settings) ----------
let compareOn = true;
let unwatch = null;
const settingListeners = new Set();
export const compareEnabled = () => compareOn;
export function onCompareSetting(fn) { settingListeners.add(fn); return () => settingListeners.delete(fn); }
export async function setCompareEnabled(v) {
  compareOn = !!v;
  settingListeners.forEach((fn) => fn(compareOn));
  try { await saveLabSettings({ compareWithClaude: compareOn }); } catch (e) { console.warn("Couldn't save the lab setting", e); }
}
on("session:started", () => {
  if (unwatch) unwatch();
  unwatch = watchLabSettings((s) => {
    const v = s.compareWithClaude !== false;
    if (v !== compareOn) { compareOn = v; settingListeners.forEach((fn) => fn(compareOn)); }
  }, (e) => console.warn("Lab settings didn't load", e));
});
on("session:ended", () => { if (unwatch) unwatch(); unwatch = null; compareOn = true; });

// ---------- recording reads and asking Claude ----------
const MAX_ASKS = 2;           // Claude compares at once, like the live reading queue
let asking = 0;
const queue = [];
export const compareStats = { asked: 0, answered: 0, failed: 0 };
export const recent = [];     // the items read this visit, newest last (tests, the fake's answer hook)

function readRecord(item) {
  const lab = item.lab, card = lab.rules;
  const unsure = unsureFields(card);
  return {
    createdAt: new Date().toISOString(), name: String(item.name || "").slice(0, 140), pages: item.numPages || item.pages || 0,
    textSource: lab.textSource, textChars: lab.textChars, ocrPages: lab.ocrPages || 0, ms: lab.ms,
    rules: cardFields(card), rulesConfidence: card.confidence || null, appliedRule: card.appliedRule || "",
    unsure, needsLook: unsure.length > 0,
    compare: compareOn ? "pending" : "off",
    contentHash: item.contentHash || "",
  };
}

on("lab:read", ({ item, source }) => { record(item, source || {}); });
async function record(item, source) {
  const lab = item.lab;
  if (!lab) return;
  recent.push(item);
  if (recent.length > 50) recent.shift();
  const rec = readRecord(item);
  lab.compare = rec.compare;
  lab.claude = null; lab.agreement = null; lab.picks = null;
  try { await putLabRead(lab.readId, rec); } catch (e) { console.warn("Couldn't save the lab read", e); }
  if (!compareOn) return;
  emit("lab:compared", { id: item.id });
  await new Promise((r) => { queue.push(r); pump(); });
  try {
    compareStats.asked++;
    const { card, model } = await claudeRead(item, source);
    if (item.lab !== lab) return;   // read again meanwhile
    lab.claude = card;
    lab.agreement = compareCards(lab.rules, card);
    lab.compare = "done";
    compareStats.answered++;
    await updateLabRead(lab.readId, { compare: "done", claude: cardFields(card), model, agree: lab.agreement.fields, agrees: lab.agreement.agrees, comparedAt: new Date().toISOString() })
      .catch((e) => console.warn("Couldn't save the comparison", e));
  } catch (e) {
    console.warn("Compare didn't run", e);
    compareStats.failed++;
    if (item.lab !== lab) return;
    lab.compare = "failed";
    lab.compareError = readCode(e);
    await updateLabRead(lab.readId, { compare: "failed", compareError: lab.compareError }).catch(() => {});
  } finally {
    asking--;
    pump();
    emit("lab:compared", { id: item.id });
  }
}
function pump() {
  while (asking < MAX_ASKS && queue.length) { asking++; queue.shift()(); }
}

// ---------- the card's chip ----------
export function labChip(it) {
  const lab = it && it.lab;
  if (!lab || lab.compare === "off" || !lab.compare) return "";
  if (lab.compare === "pending") return `<span class="pill pill-gray lab-chip" data-lab-state="pending">Asking Claude</span>`;
  if (lab.compare === "failed") return `<span class="pill pill-gray lab-chip" data-lab-state="failed">Claude didn't answer</span>`;
  const agrees = lab.agreement && lab.agreement.agrees;
  const n = lab.agreement ? ROUTING.filter((f) => !lab.agreement.fields[f]).length : 0;
  const label = agrees ? "Claude agrees" : "Claude differs";
  const aria = agrees ? "Claude agrees. Compare the fields." : `Claude differs on ${n} ${n === 1 ? "field" : "fields"}. Compare and pick.`;
  return `<button type="button" class="pill pill-gray lab-chip" data-lab-compare data-lab-state="${agrees ? "agrees" : "differs"}" aria-label="${esc(aria)}">${agrees ? icon("checkmark") : ""}${label}${lab.picks ? `<span class="lab-chip-picked">· Picked</span>` : ""}</button>`;
}

// ---------- the compare sheet ----------
function show(field, c) {
  const v = c ? c[field] : "";
  if (field === "docDate") return v || "No date";
  if (field === "folder") return folderName(v) || "None";
  if (field === "verdict") return verdictStamp(v) || "None";
  if (field === "filename") return v ? `${v}.pdf` : "None";
  if (field === "sensitive") return v ? "Yes" : "No";
  if (field === "paperless") return v && v.possible ? `Yes${v.how ? `. ${v.how}` : ""}` : "No";
  return v || "None";
}
// The picked values onto the card: those fields count as sure from now on.
export function applyPicks(card, rules, claude, picks) {
  const out = { ...card };
  for (const [f, who] of Object.entries(picks)) {
    const src = who === "claude" ? claude : rules;
    if (!src) continue;
    out[f] = f === "paperless" ? { ...src.paperless } : src[f];
  }
  if (out.folder && !FOLDER_NAMES.includes(out.folder)) out.folder = card.folder;
  if (out.verdict && !VERDICT[out.verdict]) out.verdict = card.verdict;
  return markConfident(out, Object.keys(picks).filter((f) => FIELD_ORDER.includes(f)));
}
const RULE_FIELDS = ["issuer", "folder", "filename"];

// it: the deck's item; onApply(card): the deck sets the card. Resolves when the sheet closes.
export function openCompare(it, { onApply } = {}) {
  const lab = it && it.lab;
  if (!lab || lab.compare !== "done" || !lab.claude) return null;
  const rules = lab.rules, claude = lab.claude, agree = lab.agreement || compareCards(rules, claude);
  const differs = SCORED.filter((f) => !agree.fields[f]);
  const picks = { ...(lab.picks || {}) };
  const body = document.createElement("div");
  body.className = "lab-compare";
  const fieldRow = (f) => {
    const same = !!agree.fields[f];
    const pick = picks[f];
    return `<div class="lab-field${same ? " same" : " differs"}" data-field="${f}">
      <div class="lab-field-head"><span class="lab-field-name">${esc(LAB_LABEL[f])}</span><span class="lab-field-mark">${same ? `${icon("checkmark")}Same` : "Differs"}</span></div>
      <div class="lab-pair">
        <div class="lab-side${pick === "rules" ? " picked" : ""}"><span class="lab-who">Rules</span><span class="lab-val${f === "filename" ? " mono" : ""}">${esc(show(f, rules))}</span></div>
        <div class="lab-side${pick === "claude" ? " picked" : ""}"><span class="lab-who">Claude</span><span class="lab-val${f === "filename" ? " mono" : ""}">${esc(show(f, claude))}</span></div>
      </div>
      ${same ? "" : `<div class="lab-pick">${segmented([{ value: "rules", label: "Rules is right" }, { value: "claude", label: "Claude is right" }], { selected: pick || "", label: `Which ${LAB_LABEL[f].toLowerCase()} is right`, "data-pick": f })}</div>`}
    </div>`;
  };
  const prose = (f) => `<div class="lab-field prose"><div class="lab-field-head"><span class="lab-field-name">${esc(LAB_LABEL[f])}</span><span class="lab-field-mark">Not scored</span></div>
      <div class="lab-pair"><div class="lab-side"><span class="lab-who">Rules</span><span class="lab-val">${esc(show(f, rules))}</span></div>
      <div class="lab-side"><span class="lab-who">Claude</span><span class="lab-val">${esc(show(f, claude))}</span></div></div></div>`;
  body.innerHTML = (differs.length ? section(differs.map(fieldRow).join(""), { header: "Differs", footer: "Your pick is saved as the right answer. A pick on sender, folder or filename also becomes a sender rule." }) : "")
    + section(SCORED.filter((f) => agree.fields[f]).map(fieldRow).join(""), { header: "Same" })
    + section(PROSE.map(prose).join(""), { header: "Prose" });
  const agreed = SCORED.length - differs.length;
  const sheet = openSheet({ title: agree.agrees ? "Claude agrees" : "Claude differs", subtitle: `${agreed} of ${SCORED.length} fields agree.`, label: "Compare with Claude",
    detents: ["large"], className: "lab-compare-sheet", body,
    footer: differs.length ? primaryButton("Save picks", { "data-lab-save": "", disabled: !Object.keys(picks).length }) : "" });
  const save = sheet.el.querySelector("[data-lab-save]");
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-seg]");
    const group = b && b.closest("[data-pick]");
    if (!group) return;
    const f = group.dataset.pick;
    picks[f] = b.dataset.seg;
    group.querySelectorAll("[data-seg]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    const sides = group.closest(".lab-field").querySelectorAll(".lab-side");
    sides[0].classList.toggle("picked", picks[f] === "rules");
    sides[1].classList.toggle("picked", picks[f] === "claude");
    if (save) save.disabled = false;
  });
  if (save) save.addEventListener("click", async () => {
    save.disabled = true;
    await savePicks(it, picks, { onApply });
    sheet.close("saved");
  });
  return sheet;
}

// Records the picks as ground truth, puts the picked values on the card, and saves a sender rule
// when sender, folder or filename was picked. Never throws.
export async function savePicks(it, picks, { onApply } = {}) {
  const lab = it.lab;
  const chosen = Object.fromEntries(Object.entries(picks).filter(([f, v]) => SCORED.includes(f) && (v === "rules" || v === "claude")));
  if (!Object.keys(chosen).length) return null;
  const card = applyPicks(it.card || lab.rules, lab.rules, lab.claude, chosen);
  const truth = Object.fromEntries(Object.keys(chosen).map((f) => [f, card[f]]));
  lab.picks = { ...(lab.picks || {}), ...chosen };
  it.edited = true;
  if (onApply) onApply(card); else it.card = card;
  const pickedAt = new Date().toISOString();
  try { await updateLabRead(lab.readId, { picks: lab.picks, truth, pickedAt }); } catch (e) { console.warn("Couldn't save the picks", e); }
  if (Object.keys(chosen).some((f) => RULE_FIELDS.includes(f)) && slug(card.issuer) !== "unknown") {
    const rule = { ...(ruleFor(card.issuer) || {}), key: slug(card.issuer), issuer: card.issuer, folder: card.folder, filenamePattern: patternFromFilename(card.filename, card.docDate) };
    try { await saveRule(rule); } catch (e) { console.warn("Sender rule didn't save", e); }
  }
  emit("lab:compared", { id: it.id });
  return card;
}
