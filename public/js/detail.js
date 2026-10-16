// detail.js: card detail and edit (spec 4.13), pushed from the deck by a tap, "Edit details" or
// "Fill it in yourself" (#/sort/card:<itemId>), and its read-only mode for filed documents, which
// Piles and Search push (#/<tab>/doc:<docId>). Owner: deck. The web twin of CardDetailScreen: the
// page viewer, the verdict and why, Details, Filing (folder picker, filename with suggestion chips,
// verdict), About, "Remember for this sender" once Folder, Verdict or Filename changes, "Done" to
// save, and a Shred and File bar that runs exactly like the deck's action row.
import { FOLDER_NAMES, VERDICT } from "./config.js";
import { esc, slug, cleanName } from "./ui.js";
import { registerScreen, back } from "./router.js";
import { setAccessoryHidden } from "./shell.js";
import { openPdfDoc, renderPage, photoJpeg } from "./media.js";
import { unsureFields } from "./classify.js";
import { getItem, isReadFailed, saveEdits, blankCard, detailDecide, folderPath, fmtDate, followDate, dateLabel } from "./deck.js";
import { openFolderPicker } from "./checkfields.js";
import { icon } from "./ui/icons.js";
import { verdictBadge, section, row, segmented, toggleRow, emptyState, filterChip, sensitiveChip, button } from "./ui/components.js";
import { toast } from "./ui/toast.js";

// ---------- pages: rendered once per item and kept for the session ----------
const pageCache = new Map();   // item id -> Promise<[objectURL]>
function pagesFor(it) {
  if (!pageCache.has(it.id)) pageCache.set(it.id, (async () => {
    const out = [];
    if (it.kind === "pdf") {
      const doc = await openPdfDoc(it.files[0]);
      try { for (let n = 1; n <= Math.min(doc.numPages, 30); n++) out.push(URL.createObjectURL(await renderPage(doc, n, 1400, 0.85))); }
      finally { await doc.destroy(); }
    } else {
      for (const f of it.files.slice(0, 30)) out.push(URL.createObjectURL(await photoJpeg(f, 1400, 0.85)));
    }
    return out;
  })().catch((e) => { console.warn("Pages didn't render", e); pageCache.delete(it.id); return it.thumb ? [it.thumb] : []; }));
  return pageCache.get(it.id);
}

function pageViewer(urls) {
  if (!urls.length) return `<div class="cd-pages empty" aria-hidden="true">${icon("doc")}</div>`;
  return `<div class="cd-viewer"><div class="cd-pages" tabindex="0" role="group" aria-roledescription="pages" aria-label="${urls.length === 1 ? "1 page" : `${urls.length} pages`}. Open full screen with Enter.">`
    + urls.map((u, i) => `<button type="button" class="cd-page" data-page="${i}" aria-label="Page ${i + 1} of ${urls.length}"><img src="${esc(u)}" alt="" draggable="false"></button>`).join("")
    + `</div>${urls.length > 1 ? `<div class="cd-dots" aria-hidden="true">${urls.map((_, i) => `<span${i ? "" : ' class="on"'}></span>`).join("")}</div>` : ""}</div>`;
}
function bindViewer(root, urls, title) {
  const strip = root.querySelector(".cd-pages:not(.empty)");
  if (!strip) return;
  const dots = root.querySelectorAll(".cd-dots span");
  strip.addEventListener("scroll", () => {
    const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
    dots.forEach((d, k) => d.classList.toggle("on", k === i));
  }, { passive: true });
  strip.addEventListener("click", (e) => { const b = e.target.closest("[data-page]"); if (b) fullScreen(urls, Number(b.dataset.page), title); });
  strip.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === strip) fullScreen(urls, 0, title); });
}
// Tap opens the pages full screen; pinch or the browser's zoom works on them (PDFView with zoom).
function fullScreen(urls, start, title) {
  const layer = document.getElementById("overlay");
  const opener = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "cd-full";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", title || "Pages");
  wrap.innerHTML = `<div class="cd-full-bar"><p class="cd-full-title">${esc(title || "")}</p><button type="button" class="nav-text-btn" data-full-done>Done</button></div>`
    + `<div class="cd-full-pages">${urls.map((u, i) => `<img src="${esc(u)}" alt="Page ${i + 1} of ${urls.length}" data-n="${i}">`).join("")}</div>`;
  layer.append(wrap);
  document.getElementById("app").querySelectorAll(":scope > :not(#overlay)").forEach((n) => { n.inert = true; n.dataset.fullInert = "1"; });
  const close = () => {
    wrap.remove();
    document.querySelectorAll("[data-full-inert]").forEach((n) => { n.inert = false; delete n.dataset.fullInert; });
    removeEventListener("keydown", onKey, true);
    opener?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  addEventListener("keydown", onKey, true);
  wrap.querySelector("[data-full-done]").addEventListener("click", close);
  wrap.querySelector("[data-full-done]").focus();
  wrap.querySelector(`[data-n="${start}"]`)?.scrollIntoView({ block: "start" });
}

// ---------- shared pieces ----------
const notSure = (on, k) => (on ? `<span class="unsure-tag" data-unsure="${k}">Not sure</span>` : "");
const fieldRow = (label, inputHtml, unsure = false, k = "") =>
  `<label class="list-row cd-row"><span class="cd-label">${esc(label)}</span><span class="cd-input">${inputHtml}</span>${notSure(unsure, k)}</label>`;
const valueRow = (label, value) => row({ title: label, trailing: `<span class="row-value cd-value">${esc(value)}</span>` });

// Filename suggestions (#27): the card's own date, year, sender and type, appended at the cursor.
function nameChips(c) {
  const date = c.docDate || "";
  const list = [date, date.slice(0, 4), slug(c.issuer) !== "unknown" ? slug(c.issuer) : "", slug(c.docType) !== "unknown" ? slug(c.docType) : ""]
    .filter((v, i, a) => v && a.indexOf(v) === i);
  return list.length ? `<div class="chips cd-name-chips" aria-label="Add to the filename">${list.map((v) => filterChip(v, { "data-name-chip": v, "aria-label": `Add ${v}` })).join("")}</div>` : "";
}

// ---------- card detail and edit (#/sort/card:<id>) ----------
registerScreen("card", {
  title: (id) => getItem(id)?.card?.title || "Details",
  mount(el, { param, body, setTitle }) {
    const it = getItem(param);
    el.querySelector(".navbar").classList.add("inline", "cd-nav");
    const large = el.querySelector(".nav-large"); if (large) large.hidden = true;
    if (!it) {
      setTitle("Details");
      body.innerHTML = emptyState({ symbol: "doc", title: "Nothing to show", description: "This card isn't on the deck anymore." });
      return;
    }
    setAccessoryHidden("card", true);
    const original = it.card ? { ...it.card } : null;
    const draft = { ...blankCard(it) };
    const unsure = new Set(unsureFields(it.card));
    let remember = true;
    const filingChanged = () => !original || ["folder", "verdict", "filename"].some((k) => original[k] !== draft[k]);
    setTitle(draft.title || "Details");

    el.querySelector(".nav-trailing").innerHTML = '<button type="button" class="nav-text-btn" data-done>Done</button>';
    body.classList.add("cd-body");
    body.innerHTML = `<div class="cd-viewer-slot">${pageViewer(it.thumb ? [it.thumb] : [])}</div>
      <div class="cd-head"><span class="cd-verdict">${verdictBadge(draft.verdict, { size: "large" })}</span>${draft.verdictReason ? `<p class="cd-why">Why: ${esc(draft.verdictReason)}</p>` : ""}</div>
      ${section(
        fieldRow("Title", `<input type="text" data-k="title" value="${esc(draft.title)}" placeholder="Title" autocomplete="off">`, unsure.has("title"), "title")
        + fieldRow("Sender", `<input type="text" data-k="issuer" value="${esc(draft.issuer)}" placeholder="Sender" autocomplete="off">`, unsure.has("issuer"), "issuer")
        + fieldRow(dateLabel(draft.docType), `<input type="date" data-k="docDate" value="${esc(draft.docDate)}">`, unsure.has("docDate"), "docDate")
        + fieldRow("Type", `<input type="text" data-k="docType" value="${esc(draft.docType)}" placeholder="Type" autocomplete="off">`), { header: "Details" })}
      ${section(
        `<button type="button" class="list-row cd-row" data-pick-folder><span class="cd-label">Folder</span><span class="cd-input cd-folder-value">${esc(folderPath(draft))}</span>${notSure(unsure.has("folder"), "folder")}<span class="row-chevron">${icon("chevron.right")}</span></button>`
        + `<div class="list-row cd-row cd-stack"><label class="cd-line" for="cd-filename"><span class="cd-label">Filename</span>${notSure(unsure.has("filename"), "filename")}</label>`
        + `<span class="cd-name"><input type="text" id="cd-filename" data-k="filename" class="mono" value="${esc(draft.filename)}" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="cd-suffix">.pdf</span></span>`
        + `<span class="cd-chips-slot">${nameChips(draft)}</span></div>`
        + `<div class="list-row cd-row cd-stack"><span class="cd-line"><span class="cd-label" id="cd-verdict-l">Verdict</span>${notSure(unsure.has("verdict"), "verdict")}</span>`
        + segmented(Object.keys(VERDICT).map((v) => ({ value: v, label: VERDICT[v].stamp })), { selected: draft.verdict, label: "Verdict", "data-verdict": "" }) + `</div>`,
        { header: "Filing" })}
      ${section(
        `<label class="list-row cd-row cd-stack"><span class="cd-label">Summary</span><textarea data-k="summary" rows="3" placeholder="Summary">${esc(draft.summary)}</textarea></label>`
        + fieldRow("Retention", `<input type="text" data-k="retention" value="${esc(draft.retention)}" placeholder="Retention" autocomplete="off">`)
        + toggleRow("Sensitive", { checked: draft.sensitive, id: "cd-sensitive" }), { header: "About" })}
      <div class="cd-remember" hidden>${section(toggleRow("Remember for this sender", { checked: remember, id: "cd-remember" }))}<p class="group-footer cd-remember-foot"></p></div>
      <div class="cd-bar" role="group" aria-label="Decide">
        <button type="button" class="dk-act dk-shred" data-side="shred">${icon("xmark")}<span>Shred</span></button>
        <button type="button" class="dk-act dk-file" data-side="file">${icon("checkmark")}<span>File</span></button>
      </div>`;

    const $q = (s) => body.querySelector(s);
    const refresh = () => {
      $q(".cd-folder-value").textContent = folderPath(draft);
      $q(".cd-verdict").innerHTML = verdictBadge(draft.verdict, { size: "large" });
      const show = filingChanged() && !!original;
      $q(".cd-remember").hidden = !show;
      $q(".cd-remember-foot").textContent = remember ? `Next time, ${draft.issuer || "this sender"} files this way without asking.` : "";
      $q(".cd-remember-foot").hidden = !remember;
      $q("[data-side=file]").disabled = !draft.title && !draft.filename;
      $q(".cd-chips-slot").innerHTML = nameChips(draft);
      setTitle(draft.title || "Details");
    };
    // "Not sure" stays on a field until it's edited (4.13).
    const clearUnsure = (k) => { if (unsure.delete(k)) body.querySelector(`[data-unsure="${k}"]`)?.remove(); };
    body.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      let v = e.target.value;
      if (k === "filename") v = cleanName(v);
      if (k === "docDate" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const old = draft[k];
      draft[k] = v;
      if (k === "docDate" && original && draft.filename === (original.filename)) { draft.filename = followDate(draft.filename, old, v); $q("#cd-filename").value = draft.filename; }
      clearUnsure(k);
      refresh();
    });
    body.addEventListener("change", (e) => {
      if (e.target.id === "cd-sensitive") draft.sensitive = e.target.checked;
      if (e.target.id === "cd-remember") { remember = e.target.checked; refresh(); }
    });
    body.addEventListener("click", async (e) => {
      const seg = e.target.closest("[data-verdict] [data-seg]");
      if (seg) {
        draft.verdict = seg.dataset.seg;
        seg.parentElement.querySelectorAll("[data-seg]").forEach((b) => b.setAttribute("aria-selected", String(b === seg)));
        clearUnsure("verdict");
        refresh();
        return;
      }
      if (e.target.closest("[data-pick-folder]")) {
        const f = await openFolderPicker(draft.folder);
        if (f && FOLDER_NAMES.includes(f)) { draft.folder = f; clearUnsure("folder"); refresh(); }
        return;
      }
      const chip = e.target.closest("[data-name-chip]");
      if (chip) {
        const input = $q("#cd-filename");
        const v = chip.dataset.nameChip;
        const at = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, at), after = input.value.slice(input.selectionEnd ?? at);
        const sep = before && !/[_-]$/.test(before) ? "_" : "";
        input.value = cleanName(before + sep + v + after);
        draft.filename = input.value;
        clearUnsure("filename");
        refresh();
        input.focus();
        return;
      }
      const side = e.target.closest("[data-side]")?.dataset.side;
      if (side) {
        if (changed()) await save();
        detailDecide(it, side);
        back();
      }
    });
    const changed = () => JSON.stringify(draft) !== JSON.stringify(original || blankCard(it));
    const save = () => saveEdits(it, { ...draft, filename: cleanName(draft.filename).slice(0, 120) || draft.filename }, { remember: remember && filingChanged() && !!original });
    el.querySelector("[data-done]").addEventListener("click", async () => {
      if (changed()) await save();
      if (remember && filingChanged() && original && draft.issuer) toast("Sender rule saved");
      back();
    });
    refresh();

    pagesFor(it).then((urls) => {
      if (!body.isConnected) return;
      $q(".cd-viewer-slot").innerHTML = pageViewer(urls);
      bindViewer(body, urls, draft.title);
    });
    if (isReadFailed(it) && !it.card) $q("[data-k=title]").focus();
  },
  unmount() { setAccessoryHidden("card", false); },
});

// The read-only document view (#/<tab>/doc:<docId>) is browse.js's: it reads the live library, so
// it shows Search's matching text and the paper's state, and updates as the doc changes.
