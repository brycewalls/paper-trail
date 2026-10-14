// deck.js: the sorting deck. Owns adding documents (Choose documents, Photograph a multi-page
// document, drag and drop), the pipeline that opens files one at a time and reads two at a time,
// the cards, swipe and the Shred / Later / File buttons and arrow keys, and Needs attention.
// The item list itself is items.js. After a swipe, outbox.js takes over.
import { VERDICT, FOLDER_NAMES, READERS } from "./config.js";
import { $, esc, cleanName, reduceMotion, setStatus, on, emit } from "./ui.js";
import { currentUser } from "./auth.js";
import { items, newItem, deckItems, findItem, isPdf } from "./items.js";
import { classifyItem, readError } from "./classify.js";
import { openPdfDoc, renderPage, photoJpeg } from "./media.js";
import { enqueue, logShred } from "./outbox.js";
import { renderDrive } from "./drive.js";

let dragging = false;

// ---------- adding documents ----------
const drop = $("drop");
$("file").addEventListener("change", (e) => { addEach(e.target.files); e.target.value = ""; });
$("pages-file").addEventListener("change", (e) => { addAsOne(e.target.files); e.target.value = ""; });
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addEach(e.dataTransfer.files); });

function add(item) { items.push(item); emit("item:added", item); }
// Each file is one document.
export function addEach(list) {
  for (const f of [...(list || [])]) add(newItem(f.name.replace(/\.[^.]+$/, ""), [f]));
  setStatus("");
  pump();
}
// All the photos are one document (PDFs in the list are ignored).
export function addAsOne(list, name) {
  const files = [...(list || [])].filter((f) => !isPdf(f));
  if (!files.length) return;
  add(newItem(name || `${files.length} photo${files.length > 1 ? "s" : ""}`, files));
  setStatus("");
  pump();
}

// ---------- pipeline: open files one at a time, read two at a time ----------
let loading = false, reading = 0;
export function pump() {
  if (!currentUser()) return;
  if (!loading) {
    const next = items.find((i) => i.status === "loading");
    if (next) { loading = true; openItem(next).finally(() => { loading = false; pump(); }); }
  }
  while (reading < READERS) {
    const next = items.find((i) => i.status === "queued");
    if (!next) break;
    reading++;
    readItem(next).finally(() => { reading--; pump(); });
  }
  renderDeck();
}

async function openItem(item) {
  try {
    if (item.kind === "pdf") {
      const doc = await openPdfDoc(item.files[0]);
      try {
        item.numPages = doc.numPages;
        item.thumb = URL.createObjectURL(await renderPage(doc, 1, 700, 0.8));
      } finally { await doc.destroy(); }
    } else {
      item.numPages = item.files.length;
      item.thumb = URL.createObjectURL(await photoJpeg(item.files[0], 700, 0.8));
    }
    item.status = "queued";
  } catch (err) {
    console.warn("Open failed", err);
    item.status = "error";
    item.error = item.kind === "pdf"
      ? (err?.name === "PasswordException" ? "This PDF has a password. Remove it in Files, then add it again." : "Couldn't open this PDF. Check that it opens in Files, then add it again.")
      : "Couldn't open this photo. Use a JPEG or PNG.";
  }
}

async function readItem(item) {
  item.status = "reading"; item.progress = "Claude is reading it"; renderDeck();
  try {
    item.result = await classifyItem(item, renderDeck);
    item.status = "ready";
    emit("item:ready", item);
  } catch (e) {
    console.warn("Read failed", e);
    item.status = "error";
    item.error = readError(e);
  }
}

// ---------- the deck ----------
export function renderDeck() {
  if (dragging) return;  // re-rendered when the drag ends
  const deck = deckItems();
  const uploading = items.filter((i) => i.status === "filing").length;
  const sorted = items.filter((i) => i.status === "done").length;
  const busyReading = items.filter((i) => ["loading", "queued", "reading"].includes(i.status)).length;
  $("deck-wrap").hidden = !items.length;
  // Once a stack is loaded, shrink the picker so the deck and its buttons fit on a phone screen.
  $("drop").classList.toggle("compact", !!items.length);
  $("intake").classList.toggle("compact", !!items.length);
  $("pages-row").classList.toggle("compact", !!items.length);
  $("drop").querySelector("strong").textContent = items.length ? "Add more documents" : "Choose documents";
  const bits = [];
  if (deck.length) bits.push(`${deck.length} to sort`);
  if (busyReading) bits.push(`${busyReading} reading`);
  if (uploading) bits.push(`${uploading} uploading`);
  if (sorted) bits.push(`${sorted} done`);
  $("deck-count").textContent = bits.join(" · ");

  const el = $("deck");
  if (!deck.length) {
    el.innerHTML = items.length
      ? `<div class="done-card"><strong>Stack sorted</strong><span>${sorted} done${uploading ? `, ${uploading} still uploading` : ""}. Choose more documents to keep going.</span></div>`
      : "";
  } else {
    el.innerHTML = deck.slice(0, 3).map((it, i) => cardHtml(it, i)).reverse().join("");
    bindTop();
  }
  const top = deck[0];
  const ready = top?.status === "ready";
  $("btn-left").disabled = !ready;
  $("btn-right").disabled = !ready;
  $("btn-later").disabled = deck.length < 2;
  renderTrouble();
  renderDrive();
}
// outbox.js reports status changes this way.
on("items:changed", renderDeck);

function cardHtml(it, pos) {
  const cls = pos === 0 ? "top" : pos === 1 ? "b1" : "b2";
  const img = it.thumb ? `<img src="${it.thumb}" alt="">` : "";
  const pagesBadge = it.numPages ? `<span class="badge">${it.numPages} page${it.numPages > 1 ? "s" : ""}</span>` : "";
  if (it.status !== "ready") {
    const what = it.status === "loading" ? "Opening the file" : it.status === "queued" ? "Waiting for Claude" : it.progress || "Claude is reading it";
    return `<article class="card ${cls}" data-id="${it.id}">
      <div class="card-img">${img}${pagesBadge}</div>
      <div class="card-wait card-body"><span class="spin" aria-hidden="true"></span><strong>${esc(it.name)}</strong><span>${esc(what)}…</span></div>
    </article>`;
  }
  const r = it.result, v = VERDICT[r.verdict];
  const stay = r.verdict === "keep_original";
  return `<article class="card ${cls}" data-id="${it.id}" aria-label="${esc(r.title)}">
    <span class="swipe-tag file">File</span><span class="swipe-tag shred">Shred</span>
    <div class="card-img">${img}${pagesBadge}<span class="stamp ${r.verdict}">${esc(v.stamp)}</span></div>
    <div class="card-body">
      <div style="display:grid;gap:4px">
        <span class="label">${esc(r.docType || "Document")}${r.docDate ? " · " + esc(r.docDate) : ""}</span>
        <h3>${esc(r.title)}</h3>
        <p class="muted">${esc(r.summary)}</p>
      </div>
      ${it.msg ? `<div class="card-msg">${esc(it.msg)}</div>` : ""}
      <div class="callout verdict ${r.verdict}"><strong>${esc(v.label)}</strong><span>${esc(r.verdictReason)}</span>${r.retention ? `<span class="muted">${esc(r.retention)}</span>` : ""}</div>
      ${r.sensitive || r.paperless.possible ? `<div class="flags">${r.sensitive ? '<span class="flag warn">Sensitive, cross-cut shred</span>' : ""}${r.paperless.possible ? `<span class="flag paper">Can go paperless</span>` : ""}</div>` : ""}
      ${r.paperless.possible && r.paperless.how ? `<p class="note">${esc(r.paperless.how)}</p>` : ""}
      ${it.editing ? `
        <div class="edit">
          <label class="label" for="e-folder">Folder</label>
          <select id="e-folder">${FOLDER_NAMES.map((f) => `<option${f === r.folder ? " selected" : ""}>${esc(f)}</option>`).join("")}</select>
          <label class="label" for="e-name">File name</label>
          <input type="text" id="e-name" class="mono" value="${esc(r.filename)}">
          <button class="linkish" data-edit="done">Done</button>
        </div>` : `
        <div class="dest">
          <span class="label">Files to</span>
          <p class="mono">${esc(r.folder)} / ${esc(r.filename)}.pdf</p>
          <button class="linkish" data-edit="open">Change folder or name</button>
        </div>`}
      <p class="note">${stay ? "Swipe right and the paper goes in your keep folder." : "Either way, the paper goes on the shred pile."}</p>
    </div>
  </article>`;
}

// Drag the top card. Horizontal drags are ours; vertical ones scroll the card (touch-action: pan-y).
function bindTop() {
  const card = $("deck").querySelector(".card.top");
  if (!card) return;
  const it = items.find((i) => i.id === Number(card.dataset.id));
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]"); if (!b) return;
    it.editing = b.dataset.edit === "open"; renderDeck();
    if (it.editing) $("e-name")?.focus();
  });
  card.addEventListener("input", (e) => {
    if (e.target.id === "e-name") it.result.filename = cleanName(e.target.value) || it.result.filename;
    if (e.target.id === "e-folder") it.result.folder = e.target.value;
  });
  card.addEventListener("change", (e) => { if (e.target.id === "e-folder") it.result.folder = e.target.value; });
  if (it.status !== "ready") return;

  let x0 = 0, y0 = 0, t0 = 0, dx = 0, active = false, decided = false;
  const fileTag = card.querySelector(".swipe-tag.file"), shredTag = card.querySelector(".swipe-tag.shred");
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("input, select, textarea, button, a")) return;
    x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); dx = 0; active = true; decided = false;
  });
  card.addEventListener("pointermove", (e) => {
    if (!active) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) { active = false; return; }  // a scroll, not a swipe
      decided = true; dragging = true;
      card.classList.add("dragging");
      card.setPointerCapture?.(e.pointerId);
    }
    dx = mx;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    fileTag.style.opacity = Math.max(0, Math.min(1, dx / 100));
    shredTag.style.opacity = Math.max(0, Math.min(1, -dx / 100));
  });
  const end = () => {
    if (!active) return;
    active = false;
    if (!decided) return;
    card.classList.remove("dragging");
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t0);
    dragging = false;
    if (Math.abs(dx) > 110 || (Math.abs(dx) > 40 && speed > 0.6)) decide(it, dx > 0 ? "right" : "left", card);
    else { card.style.transform = ""; fileTag.style.opacity = 0; shredTag.style.opacity = 0; renderDeck(); }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

function flyOut(card, dir) {
  return new Promise((res) => {
    if (!card || reduceMotion) return res();
    const w = card.offsetWidth * 1.4 * (dir === "right" ? 1 : -1);
    card.style.transform = `translateX(${w}px) rotate(${w / 18}deg)`;
    card.style.opacity = "0";
    setTimeout(res, 260);
  });
}

async function decide(it, dir, card) {
  if (!it || it.status !== "ready") return;
  card = card || $("deck").querySelector(".card.top");
  if (dir === "left" && it.result.verdict === "keep_original" && !it.confirmLeft) {
    // Don't let a vital record slip onto the shred pile with one flick.
    it.confirmLeft = true;
    it.msg = "This one should stay on paper. Swipe left again to shred it anyway.";
    if (card) card.style.transform = "";
    renderDeck();
    return;
  }
  it.mode = dir;
  it.status = dir === "right" ? "filing" : "logging";
  it.editing = false;
  await flyOut(card, dir);
  renderDeck();
  emit("item:decided", { item: it, dir });
  if (dir === "right") enqueue(it);
  else logShred(it);
}

$("btn-right").addEventListener("click", () => decide(deckItems()[0], "right"));
$("btn-left").addEventListener("click", () => decide(deckItems()[0], "left"));
$("btn-later").addEventListener("click", () => {
  const top = deckItems()[0]; if (!top) return;
  items.splice(items.indexOf(top), 1); items.push(top);
  top.editing = false; renderDeck();
});
document.addEventListener("keydown", (e) => {
  if ($("app").hidden || !$("scanner").hidden || $("deck-wrap").hidden || e.target.closest?.("input, select, textarea")) return;
  if (e.key === "ArrowRight") { e.preventDefault(); decide(deckItems()[0], "right"); }
  if (e.key === "ArrowLeft") { e.preventDefault(); decide(deckItems()[0], "left"); }
});

// ---------- needs attention ----------
function renderTrouble() {
  const bad = items.filter((i) => i.status === "error" || i.status === "failed");
  $("trouble").innerHTML = bad.length ? `<span class="label">Needs attention</span>` + bad.map((i) => `
    <div class="item">
      <div class="meta">
        <p><strong>${esc(i.result?.title || i.name)}</strong></p>
        <p class="note" style="color:var(--shred)">${esc(i.error)}</p>
      </div>
      <div class="acts">
        ${i.status === "failed" || i.thumb ? `<button class="btn small" data-retry="${i.id}">Try again</button>` : ""}
        <button class="btn small" data-drop="${i.id}">Remove</button>
      </div>
    </div>`).join("") : "";
}
$("trouble").addEventListener("click", (e) => {
  const r = e.target.closest("[data-retry]"), d = e.target.closest("[data-drop]");
  const it = findItem((r || d)?.dataset.retry || (r || d)?.dataset.drop);
  if (!it) return;
  if (d) { if (it.thumb) URL.revokeObjectURL(it.thumb); items.splice(items.indexOf(it), 1); renderDeck(); return; }
  it.error = "";
  if (it.status === "failed" && it.mode === "left") { it.status = "logging"; logShred(it); }
  else if (it.status === "failed") { it.status = "filing"; enqueue(it); }
  else { it.status = it.thumb ? "queued" : "loading"; pump(); }
  renderDeck();
});
