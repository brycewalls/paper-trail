// lab/stats.js: Settings, Lab (#92): the "Compare with Claude" switch and Lab Stats, a sheet over
// Settings (like Sender rules) built from users/{uid}/lab/reader/reads:
//   - agreement per field across every compared document (lab/compare.js SCORED, scored by fieldAgrees)
//   - how often Bryce sided with the rules or with Claude when they differed (his picks)
//   - the "Needs a look" rate: lab reads that came back with a field the rules weren't sure of
//   computeStats(reads) is pure, for the sheet and the tests.
// Owner: lab reader.
import { esc } from "../ui.js";
import { watchLabReads } from "../store.js";
import { registerSettingsSection } from "../settings.js";
import { openSheet } from "../ui/sheet.js";
import { section, row, toggleRow, valueRow, emptyState } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { SCORED, LAB_LABEL, compareEnabled, setCompareEnabled, onCompareSetting } from "./compare.js";

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
export function computeStats(reads) {
  const list = (reads || []).filter((r) => r && r.rules);
  const compared = list.filter((r) => r.compare === "done" && r.agree);
  const fields = SCORED.map((f) => {
    const agreed = compared.filter((r) => r.agree[f]).length;
    return { field: f, label: LAB_LABEL[f], agreed, of: compared.length, pct: pct(agreed, compared.length) };
  });
  let rules = 0, claude = 0;
  for (const r of list) for (const v of Object.values(r.picks || {})) { if (v === "rules") rules++; else if (v === "claude") claude++; }
  const needsLook = list.filter((r) => r.needsLook).length;
  const agreesAll = compared.filter((r) => r.agrees).length;
  const bySource = {};
  for (const r of list) bySource[r.textSource || "none"] = (bySource[r.textSource || "none"] || 0) + 1;
  return {
    reads: list.length, compared: compared.length, failed: list.filter((r) => r.compare === "failed").length,
    agreesAll, agreesAllPct: pct(agreesAll, compared.length),
    needsLook, needsLookPct: pct(needsLook, list.length),
    picks: { rules, claude, total: rules + claude, rulesPct: pct(rules, rules + claude), claudePct: pct(claude, rules + claude) },
    fields, bySource,
  };
}

// ---------- Settings, Lab ----------
let count = null;   // compared documents, for the row's value once the sheet has loaded them
registerSettingsSection({
  id: "lab", order: 45,
  render: () => section(
    toggleRow("Compare with Claude", { checked: compareEnabled(), id: "lab-compare", subtitle: "Also asks Claude, only to measure the rules", "data-lab-toggle": "" })
    + valueRow("Lab Stats", count === null ? "" : String(count), { "data-open-lab-stats": "", "aria-label": "Lab Stats" }),
    { header: "Lab", footer: "The lab reads with on-device text and rules, no AI. Compare mode sends each document to Claude too, the same way the live app does, so the stats can show how close the rules get." }),
  bind(el) {
    const sw = el.querySelector("[data-lab-toggle]");
    sw.addEventListener("change", () => setCompareEnabled(sw.checked));
    const off = onCompareSetting((v) => { if (!el.isConnected) { off(); return; } sw.checked = v; });
    el.querySelector("[data-open-lab-stats]").addEventListener("click", openLabStats);
  },
});

// ---------- the Lab Stats sheet ----------
let open = null;
export const labStatsOpen = () => !!open;
export function openLabStats() {
  if (open) return open.sheet;
  const body = document.createElement("div");
  body.className = "lab-stats";
  body.innerHTML = emptyState({ spinner: true, title: "Loading", role: "status" });
  const sheet = openSheet({ title: "Lab Stats", largeTitle: true, detents: ["large"], label: "Lab Stats", className: "lab-stats-sheet",
    trailing: `<button type="button" class="nav-text-btn nav-back-btn" data-lab-back>${icon("chevron.left")}<span>Settings</span></button>`, body });
  open = { sheet, body };
  sheet.el.querySelector("[data-lab-back]").addEventListener("click", () => sheet.close("back"));
  const stop = watchLabReads((list) => { if (open) draw(computeStats(list)); }, (e) => {
    console.warn("Lab reads didn't load", e);
    if (open) body.innerHTML = emptyState({ symbol: "exclamationmark.triangle.fill", title: "Lab Stats didn't load", description: "Check your connection, then open Lab Stats again." });
  });
  sheet.closed.then(() => { stop(); open = null; });
  return sheet;
}

const bar = (p) => `<span class="lab-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, p))}%"></span></span>`;
function statRow(title, value, { sub = "", p = null, ...a } = {}) {
  return row({ title, subtitle: sub, trailing: `${p === null ? "" : bar(p)}<span class="row-value">${esc(value)}</span>`, ...a });
}
function draw(s) {
  count = s.compared;
  const { body } = open;
  if (!s.reads) {
    body.innerHTML = emptyState({ symbol: "rectangle.stack", title: "No lab reads yet", description: "Scan or import a few documents. Each one the rules read shows up here, and with compare mode on, how Claude would have read it." });
    return;
  }
  const overview = section(
    statRow("Documents read", String(s.reads), { "data-stat": "reads" })
    + statRow("Compared with Claude", String(s.compared), { sub: s.failed ? `${s.failed} didn't get an answer` : "", "data-stat": "compared" })
    + statRow("Claude agrees on routing", s.compared ? `${s.agreesAllPct}%` : "None yet", { p: s.compared ? s.agreesAllPct : null, sub: "Sender, type, date, folder, filename, verdict and sensitive all match", "data-stat": "agrees" })
    + statRow("Needs a look", `${s.needsLookPct}%`, { p: s.needsLookPct, sub: `${s.needsLook} of ${s.reads} came back with a field to check`, "data-stat": "needs-look" }),
    { header: "Overview" });
  const fields = s.compared
    ? section(s.fields.map((f) => statRow(f.label, `${f.pct}%`, { p: f.pct, sub: `${f.agreed} of ${f.of}`, "data-stat-field": f.field })).join(""),
      { header: "Agreement by field", footer: "A field agrees when the rules and Claude give the same answer, allowing for spelling and word order. Summary and Why are prose and aren't scored." })
    : section(row({ title: "Nothing compared yet", subtitle: "Turn on Compare with Claude in Settings, Lab." }), { header: "Agreement by field" });
  const picks = section(s.picks.total
    ? statRow("Sided with the rules", `${s.picks.rulesPct}%`, { p: s.picks.rulesPct, sub: `${s.picks.rules} of ${s.picks.total} picks`, "data-stat": "picks-rules" })
      + statRow("Sided with Claude", `${s.picks.claudePct}%`, { p: s.picks.claudePct, sub: `${s.picks.claude} of ${s.picks.total} picks`, "data-stat": "picks-claude" })
    : row({ title: "No picks yet", subtitle: "Tap Claude differs on a card to pick which answer is right." }),
  { header: "Your picks" });
  const src = Object.entries(s.bySource).map(([k, n]) => statRow({ text: "PDF text layer", ocr: "On-device OCR", mixed: "Text layer and OCR", none: "No text found" }[k] || k, String(n), { "data-stat-source": k })).join("");
  body.innerHTML = overview + fields + picks + section(src, { header: "Where the text came from" });
}
