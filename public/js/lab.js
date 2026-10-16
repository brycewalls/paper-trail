// lab.js: the no-AI lab build (#92). Owner: lab (infra). Nothing here runs on the live site: every
// export is inert unless LAB (config.js) is true, which only paper-trail-lab.web.app (or localhost
// with ?lab) makes it.
//   - The Lab badge on the sign-in screen and each tab's nav bar, and the lab's sign-in copy. The
//     tab bar's tint and <html class="pt-lab"> come from boot.js and css/lab.css.
//   - Lab settings (users/{uid}/lab/data/config/lab): the reader (Rules) and "Compare with Claude"
//     (on by default; Bryce approved compare mode). compareEnabled() is what the reader asks before
//     it calls classify for a comparison.
//   - The "Rules vs Claude" stats from users/{uid}/lab/data/compare: agreementStats() per field.
//   - The Lab section in Settings (order 25, after Google Drive), with a row that opens Lab Stats
//     (lab/stats.js).
// docs/web-contract.md, "Lab".
import { LAB, ROOT_FOLDER } from "./config.js";
import { esc, on } from "./ui.js";
import { watchLabSettings, saveLabSettings, watchComparisons } from "./store.js";
import { registerSettingsSection } from "./settings.js";
import { section, row, toggleRow, valueRow } from "./ui/components.js";

export { LAB };

// The fields compare mode scores, in the card's order. paperless.* are scored one by one.
export const COMPARE_FIELDS = ["title", "docType", "issuer", "docDate", "summary", "folder", "filename", "verdict",
  "verdictReason", "retention", "sensitive", "paperless.possible", "paperless.issuer", "paperless.how"];

export const LAB_COPY = {
  badge: "Lab",
  lede: "The lab build. Rules read each document with no AI, file it to a separate Drive folder, and tell you what to shred.",
  reader: "Rules, no AI",
  compare: "Compare with Claude",
  compareSub: "Claude reads each document too, only to score the rules. Nothing it says is filed.",
  stats: "Rules vs Claude",
  none: "No comparisons yet",
  footer: `Lab data stays apart from your real archive: its own records, and Drive files in "${ROOT_FOLDER}".`,
};

// ---------- settings ----------
let settings = { reader: "rules", compareWithClaude: true };
let records = [];
let unwatch = [];
let host = null;   // the open Settings sheet's section element

export const labSettings = () => ({ ...settings });
// Off only when Bryce turned it off; on by default and before the settings load.
export const compareEnabled = () => LAB && settings.compareWithClaude !== false;
export async function setCompare(onOff) {
  settings = { ...settings, compareWithClaude: !!onOff };
  draw();
  await saveLabSettings({ reader: "rules", compareWithClaude: !!onOff });
}

// ---------- stats ----------
const pct = (n) => `${Math.round(n * 100)}%`;
// records: compare docs, each { agree: { field: boolean } }. A field a record didn't score is left
// out of that field's count. overall is every scored field across every record.
export function agreementStats(list) {
  const fields = Object.fromEntries(COMPARE_FIELDS.map((f) => [f, { agree: 0, total: 0, rate: null }]));
  let agree = 0, total = 0, docs = 0;
  for (const r of list || []) {
    const a = r && r.agree;
    if (!a || typeof a !== "object") continue;
    docs++;
    for (const f of COMPARE_FIELDS) {
      if (typeof a[f] !== "boolean") continue;
      fields[f].total++; total++;
      if (a[f]) { fields[f].agree++; agree++; }
    }
  }
  for (const f of COMPARE_FIELDS) fields[f].rate = fields[f].total ? fields[f].agree / fields[f].total : null;
  return { docs, agree, total, overall: total ? agree / total : null, fields };
}

function statsHtml() {
  const s = agreementStats(records);
  if (!s.docs) return row({ title: LAB_COPY.stats, trailing: `<span class="row-value" id="lab-stats">${esc(LAB_COPY.none)}</span>` });
  const head = row({ title: LAB_COPY.stats, subtitle: `${s.docs} ${s.docs === 1 ? "document" : "documents"}`,
    trailing: `<span class="row-value" id="lab-stats">${esc(pct(s.overall))} agree</span>` });
  const rowsDl = COMPARE_FIELDS.filter((f) => s.fields[f].total)
    .map((f) => `<dt>${esc(f)}</dt><dd>${esc(pct(s.fields[f].rate))} (${s.fields[f].agree} of ${s.fields[f].total})</dd>`).join("");
  return head + `<dl class="lab-stats-fields" id="lab-stats-fields" aria-label="Agreement by field">${rowsDl}</dl>`;
}

function sectionHtml() {
  return section(
    row({ title: "Reader", trailing: `<span class="row-value" id="lab-reader">${esc(LAB_COPY.reader)}</span>` })
    + toggleRow(LAB_COPY.compare, { id: "lab-compare", checked: compareEnabled(), subtitle: LAB_COPY.compareSub })
    + `<div id="lab-stats-host">${statsHtml()}</div>`
    + valueRow("Lab Stats", "", { "data-open-lab-stats": "", "aria-label": "Lab Stats" }),
    { header: "Lab", footer: LAB_COPY.footer, id: "settings-lab" });
}

function draw() {
  if (!host || !host.isConnected) { host = null; return; }
  const t = host.querySelector("#lab-compare");
  if (t) t.checked = compareEnabled();
  const s = host.querySelector("#lab-stats-host");
  if (s) s.innerHTML = statsHtml();
}

// ---------- chrome: the badge and the sign-in copy ----------
const badge = () => `<span class="lab-badge">${esc(LAB_COPY.badge)}</span>`;
export function mountLabChrome(doc = document) {
  if (!LAB) return;
  const title = doc.querySelector(".gate-title");
  if (title && !title.querySelector(".lab-badge")) title.insertAdjacentHTML("beforeend", " " + badge());
  const lede = doc.querySelector(".gate-lede");
  if (lede) lede.textContent = LAB_COPY.lede;
  for (const lead of doc.querySelectorAll(".view[data-tab] .nav-leading")) {
    if (!lead.querySelector(".lab-badge")) lead.insertAdjacentHTML("beforeend", badge());
  }
}

if (LAB) {
  mountLabChrome();
  registerSettingsSection({ id: "lab", order: 25, render: sectionHtml,
    bind(el) {
      host = el;
      el.querySelector("#lab-compare")?.addEventListener("change", (e) => {
        setCompare(e.target.checked).catch((err) => console.warn("Lab settings didn't save", err));
      });
      // Lab Stats (lab/stats.js, the reader's): agreement per field, your picks, Needs a look.
      el.querySelector("[data-open-lab-stats]")?.addEventListener("click", () => {
        import("./lab/stats.js").then((m) => m.openLabStats()).catch((err) => console.warn("Lab Stats didn't open", err));
      });
    } });
  on("session:started", () => {
    unwatch.forEach((f) => f());
    unwatch = [
      watchLabSettings((s) => { settings = { reader: "rules", compareWithClaude: true, ...s }; draw(); }, (e) => console.warn("Lab settings", e)),
      watchComparisons((list) => { records = list; draw(); }, (e) => console.warn("Lab comparisons", e)),
    ];
  });
  on("session:ended", () => {
    unwatch.forEach((f) => f());
    unwatch = [];
    settings = { reader: "rules", compareWithClaude: true };
    records = [];
  });
}
