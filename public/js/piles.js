// piles.js: the right-hand panel and the stats row. Owns the tabs (Shred pile, Keep originals,
// Go paperless, All filed), their lists and buttons, the counts, and the four stats. It renders
// from the Firestore lists main.js hands it (setDocs, setPaperless) and writes through store.js.
import { VERDICT } from "./config.js";
import { $, esc, setSaveNote } from "./ui.js";
import { updateDoc, updateSender, removeDoc } from "./store.js";

let docs = [], paperless = [];
let tab = "shred";

export function setDocs(list) { docs = list; renderPiles(); }
export function setPaperless(list) { paperless = list; renderPiles(); }
// Signed out: forget the lists without drawing (the gate is showing).
export function resetPiles() { docs = []; paperless = []; }

document.querySelector(".tabs").addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]"); if (!t) return;
  tab = t.dataset.tab; renderPiles();
});

$("pile").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const { act, id } = b.dataset;
  b.disabled = true;
  try {
    const now = new Date().toISOString();
    if (act === "shredded") await updateDoc(id, { physical: "shredded", shreddedAt: now });
    if (act === "unshred") await updateDoc(id, { physical: "to_shred" });
    if (act === "stored") await updateDoc(id, { physical: "stored" });
    if (act === "unstore") await updateDoc(id, { physical: "keep" });
    if (act === "pl-done") await updateSender(id, { status: "done", doneAt: now });
    if (act === "pl-skip") await updateSender(id, { status: "skip" });
    if (act === "pl-todo") await updateSender(id, { status: "todo" });
    if (act === "remove") await removeDoc(id);
  } catch {
    setSaveNote("That change didn't save. Try again.");
    b.disabled = false;
  }
});

function driveLink(d) {
  if (!d.driveUrl) return `<span class="muted">Not filed</span>`;
  const urls = d.partUrls?.length > 1 ? d.partUrls : [d.driveUrl];
  return urls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${urls.length > 1 ? `Part ${i + 1}` : "Open in Drive"}</a>`).join(" · ");
}

export function renderPiles() {
  const toShred = docs.filter((d) => d.physical === "to_shred");
  const shredded = docs.filter((d) => d.physical === "shredded");
  const keep = docs.filter((d) => d.physical === "keep" || d.physical === "stored");
  const pl = paperless.filter((p) => p.status !== "skip");
  const plDone = paperless.filter((p) => p.status === "done");

  $("st-filed").textContent = docs.filter((d) => d.filed).length;
  $("st-shred").textContent = shredded.length;
  $("st-shred-wait").textContent = toShred.length;
  $("st-keep").textContent = keep.length;
  $("st-pl").textContent = plDone.length;
  $("st-pl-all").textContent = pl.length;
  $("c-shred").textContent = toShred.length;
  $("c-keep").textContent = keep.length;
  $("c-paper").textContent = paperless.filter((p) => p.status === "todo").length;
  $("c-all").textContent = docs.length;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));

  const box = $("pile");
  const empty = (h, p) => `<div class="empty"><strong>${h}</strong><span>${p}</span></div>`;
  const line = (d, acts) => `
    <div class="item">
      <div class="meta">
        <p><strong>${esc(d.title)}</strong></p>
        <p class="mono muted">${esc(d.folder)} / ${esc(d.filename)}.pdf</p>
        <p class="note">${driveLink(d)}${d.sensitive ? " · Sensitive, cross-cut shred" : ""}</p>
      </div>
      <div class="acts">${acts}</div>
    </div>`;

  if (tab === "shred") {
    box.innerHTML = toShred.length
      ? toShred.map((d) => line(d, `<button class="btn small" data-act="shredded" data-id="${esc(d.id)}">Mark shredded</button>`)).join("")
        + (shredded.length ? `<p class="note" style="padding-top:12px">${shredded.length} already shredded.</p>` : "")
      : empty(shredded.length ? "Pile's clear" : "Nothing to shred yet", shredded.length ? `${shredded.length} documents shredded so far.` : "Documents stamped Shred or Scan + shred land here once filed. Open each in Drive before you shred it.");
  } else if (tab === "keep") {
    box.innerHTML = keep.length
      ? keep.map((d) => line(d, d.physical === "stored"
          ? `<span class="pill done">Stored</span><button class="btn small" data-act="unstore" data-id="${esc(d.id)}">Undo</button>`
          : `<button class="btn small" data-act="stored" data-id="${esc(d.id)}">Put away</button>`)).join("")
      : empty("No originals yet", "Certificates, titles, deeds and other papers you need to keep will collect here, so you know what goes in the safe folder.");
  } else if (tab === "paper") {
    const order = { todo: 0, done: 1, skip: 2 };
    const list = [...paperless].sort((a, b) => order[a.status] - order[b.status] || String(a.issuer).localeCompare(String(b.issuer)));
    box.innerHTML = list.length
      ? list.map((p) => `
        <div class="item">
          <div class="meta">
            <p><strong>${esc(p.issuer)}</strong> ${p.status === "done" ? '<span class="pill done">Paperless</span>' : p.status === "skip" ? '<span class="pill">Skipped</span>' : ""}</p>
            <p class="note">${esc(p.how)}</p>
          </div>
          <div class="acts">${p.status === "todo"
            ? `<button class="btn small" data-act="pl-done" data-id="${esc(p.id)}">Switched</button><button class="btn small" data-act="pl-skip" data-id="${esc(p.id)}">Skip</button>`
            : `<button class="btn small" data-act="pl-todo" data-id="${esc(p.id)}">Undo</button>`}</div>
        </div>`).join("")
      : empty("No senders yet", "When Claude spots mail from a company that offers e-delivery, like a bank, utility or insurer, it lands here so you can stop the paper at the source.");
  } else {
    box.innerHTML = docs.length
      ? docs.map((d) => line(d, `<span class="pill ${esc(d.verdict)}">${esc(VERDICT[d.verdict]?.stamp || "")}</span><button class="btn small" data-act="remove" data-id="${esc(d.id)}" aria-label="Remove ${esc(d.title)} from the log">Remove</button>`)).join("")
      : empty("Nothing filed yet", "Scan your first document on the left. Everything you file shows up here with a link to the PDF in Drive.");
  }
}
