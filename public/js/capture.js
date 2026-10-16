// capture.js: the Scan menu's three sources (spec 4.11, 4.15, #74, #79), the web twin of the iPhone
// app's CaptureController. Every Scan menu (the Sort toolbar, Sort's empty states, the review's "Scan
// more" / "Add more") asks for a source with emit("capture:request", { source }), and this module:
//   camera  opens the scanner (scanner.js); Done hands its pages to the scan review
//   files   the Files picker, PDFs and pictures, several at once: each file is one document, PDFs
//           keep their bytes
//   photos  the Photos picker: pictures picked together start as one document
// Everything lands on the review screen (review.js) first, so the split and join controls work the
// same way for all three. With a review open, what comes back joins it: a scan onto a scan appends
// to its last document, anything else adds documents. A file that isn't a PDF or a picture gets the
// spec's alert (3.12) and the rest still go. Pictures dropped onto the page from the desktop go the
// way of Import from Files.
// Owner: capture.
import { $, on } from "./ui.js";
import { currentUser } from "./auth.js";
import { pdfPageCount } from "./media.js";
import { actionSheet } from "./ui/sheet.js";
import { openScanner } from "./scanner.js";
import { openReview } from "./review.js";

const PICTURE = /^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/i;
const PICTURE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const isPicture = (f) => PICTURE.test(f.type || "") || (!f.type && PICTURE_EXT.test(f.name || ""));

// The pickers: one hidden input each, made here so no screen builds its own import button.
function picker(id, accept) {
  const el = document.createElement("input");
  el.type = "file"; el.id = id; el.accept = accept; el.multiple = true; el.hidden = true;
  el.setAttribute("aria-hidden", "true"); el.tabIndex = -1;
  document.body.append(el);
  return el;
}
const filesInput = picker("capture-files", "application/pdf,.pdf,image/*");
const photosInput = picker("capture-photos", "image/*");
filesInput.addEventListener("change", () => { const list = [...filesInput.files]; filesInput.value = ""; importFiles(list); });
photosInput.addEventListener("change", () => { const list = [...photosInput.files]; photosInput.value = ""; importPhotos(list); });

on("capture:request", ({ source }) => {
  if (!currentUser()) return;
  if (source === "camera") openScanner({ onDone: scanned, onPickFiles: () => filesInput.click() });
  else if (source === "files") filesInput.click();
  else if (source === "photos") photosInput.click();
});

// Scan document: one document of every page scanned, onto the end of an open scan's last document.
export function scanned(blobs) {
  const pages = [...(blobs || [])].map((image) => ({ image }));
  if (!pages.length) return;
  openReview("scan", pages, [pages.map((_, i) => i)]);
}

// Import from Files: each file is one document; a PDF keeps its bytes and gets one page per page.
export async function importFiles(list) {
  const pages = [], groups = [];
  let rejected = null;
  for (const f of list || []) {
    if (isPdf(f)) {
      let n = 0;
      try { n = await pdfPageCount(f); } catch (e) { console.warn("Couldn't open the PDF", e); }
      if (!n) { rejected = rejected || { f, why: "pdf" }; continue; }
      groups.push(Array.from({ length: n }, (_, i) => pages.length + i));
      for (let i = 0; i < n; i++) pages.push({ pdf: f, index: i, sourceName: f.name });
    } else if (isPicture(f)) {
      groups.push([pages.length]);
      pages.push({ image: f, sourceName: f.name });
    } else {
      rejected = rejected || { f, why: "type" };
    }
  }
  if (rejected) unsupported(rejected);
  if (!pages.length) return;
  openReview("files", pages, groups);
}

// Import from Photos: the pictures picked together are one document.
export function importPhotos(list) {
  const pics = [...(list || [])].filter(isPicture);
  const others = [...(list || [])].filter((f) => !isPicture(f));
  if (others.length) unsupported({ f: others[0], why: "type" });
  if (!pics.length) return;
  openReview("photos", pics.map((image) => ({ image, sourceName: image.name })), [pics.map((_, i) => i)]);
}

// Spec 3.12: "That file can't be filed", "PDFs and photos work. {filename} is a {type}."
function unsupported({ f, why }) {
  const ext = (String(f.name || "").match(/\.([a-z0-9]+)$/i) || [])[1];
  const type = why === "pdf" ? "PDF that won't open" : ext ? `.${ext.toLowerCase()} file` : f.type ? `${f.type} file` : "file of an unknown type";
  actionSheet({ title: "That file can't be filed", message: `PDFs and photos work. ${f.name || "This file"} is a ${type}.`, actions: [], cancel: "OK" });
}

// Desktop: files dropped anywhere on the app import like Import from Files.
const appEl = $("app");
appEl.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files") && !e.target.closest?.("#drop")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
appEl.addEventListener("drop", (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length || e.target.closest?.("#drop")) return;
  e.preventDefault();
  if (currentUser()) importFiles([...e.dataTransfer.files]);
});
