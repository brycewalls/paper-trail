// viewer.js: the full-screen page viewer (spec 4.11.1, #78), the web twin of the iPhone app's
// PageViewerScreen and PageViewerModel. Opens from a page thumbnail in the scan review with a zoom
// out of that thumbnail and holds every page of the review in order, across documents.
//   - title "Page 3 of 8 · Document 2"; Done (or a swipe down, or Escape) closes back into the
//     thumbnail of the page showing
//   - one page per screen, swipe or arrow keys to page; pinch (or ctrl + wheel, the trackpad's
//     pinch) zooms up to 4x, double-tap zooms to 2.5x around the tap or back to fit; a zoomed page
//     pans instead of paging, and a page paged away goes back to fit
//   - bottom glass capsules: "Join with page 2" when a document starts here, then "Cut after page 3"
//     or "Join with page 4"; each calls the review's own split and join, so the review behind changes
//   - full-size pictures only for the page showing and one either side; the thumbnail shows until
//     the full page arrives
// Owner: capture. The review passes everything in (openViewer(model)); this module keeps no review
// state of its own.
import { $, esc } from "./ui.js";
import { icon } from "./ui/icons.js";
import { reduceMotion, spring } from "./ui/motion.js";

const MAX_ZOOM = 4, TAP_ZOOM = 2.5;
let v = null;   // the open viewer

// model: { ids() -> page ids in order, position(id) -> { page, pages, document, pageInDocument,
//   documentPages }, canCut(id), hasCutBefore(id), hasCutAfter(id), cut(id), joinBefore(id),
//   joinAfter(id), thumb(id) -> url, full(id) -> Promise<Blob>, thumbEl(id) -> element, onPage(id),
//   onClose(id) }
export function openViewer(model, start) {
  if (v) return;
  const root = $("viewer");
  root.innerHTML = `
    <div class="viewer-bar"><span></span><h2 class="viewer-title" id="viewer-title" aria-live="polite"></h2>
      <button type="button" class="nav-text-btn" data-viewer-done>Done</button></div>
    <div class="viewer-track" data-track tabindex="-1"></div>
    <div class="viewer-actions" data-actions></div>
    <p class="vh" data-announce role="status" aria-live="polite"></p>`;
  v = { model, root, current: start, zoom: null, full: new Map(), loading: new Set(), closing: false };
  root.hidden = false;
  document.documentElement.classList.add("viewing");
  // The review behind (and everything else in the column) is inert until the viewer closes.
  v.inerted = [...$("app").children].filter((el) => el !== root && el.id !== "overlay" && !el.inert);
  v.inerted.forEach((el) => { el.inert = true; });
  drawPages();
  bindTrack();
  root.querySelector("[data-viewer-done]").addEventListener("click", () => closeViewer());
  document.addEventListener("keydown", onKey, true);
  scrollToCurrent(false);
  refresh();
  zoomIn(start);
  root.querySelector("[data-viewer-done]").focus({ preventScroll: true });
}
export const viewerOpen = () => !!v;
export const viewerPage = () => (v ? v.current : null);

// The review changed (a cut or join here, or behind): redraw the title and buttons.
export function refreshViewer() {
  if (!v) return;
  const ids = v.model.ids();
  if (!ids.includes(v.current)) { closeViewer(); return; }
  if (ids.join() !== [...v.root.querySelectorAll("[data-page]")].map((p) => p.dataset.page).join()) { drawPages(); scrollToCurrent(false); }
  refresh();
}

export function closeViewer() {
  if (!v || v.closing) return;
  const s = v;
  s.closing = true;
  const id = s.current;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    s.root.hidden = true;
    s.root.innerHTML = "";
    for (const url of s.full.values()) URL.revokeObjectURL(url);
    document.documentElement.classList.remove("viewing");
    s.inerted.forEach((el) => { el.inert = false; });
    document.removeEventListener("keydown", onKey, true);
    v = null;
    s.model.onClose(id);
  };
  const img = s.root.querySelector(`[data-page="${CSS.escape(id)}"] img`);
  const thumb = s.model.thumbEl(id);
  if (reduceMotion() || !img || !thumb) { done(); return; }
  s.root.classList.add("closing");
  const a = img.getBoundingClientRect(), b = thumb.getBoundingClientRect();
  if (!a.width || !b.width) { done(); return; }
  const anim = spring("promote");
  img.animate([{ transform: "none" }, { transform: flip(a, b) }], { ...anim, fill: "forwards" }).finished.then(done, done);
  setTimeout(done, anim.duration + 200);   // a throttled or hidden page may never finish the animation
}

// ---------- drawing ----------
function drawPages() {
  const ids = v.model.ids();
  const track = v.root.querySelector("[data-track]");
  track.innerHTML = ids.map((id) => {
    const p = v.model.position(id);
    return `<div class="viewer-page" data-page="${esc(id)}" role="img" aria-roledescription="page" aria-label="Page ${p.page} of ${p.pages}, document ${p.document}">
      <div class="viewer-zoom"><img alt="" draggable="false" src="${esc(v.full.get(id) || v.model.thumb(id) || "")}"></div></div>`;
  }).join("");
}

function refresh() {
  const { model, current } = v;
  const p = model.position(current);
  if (!p) return;
  v.root.querySelector(".viewer-title").textContent = `Page ${p.page} of ${p.pages} · Document ${p.document}`;
  v.root.setAttribute("aria-label", `Page ${p.page} of ${p.pages}, document ${p.document}`);
  const acts = [];
  if (model.hasCutBefore(current)) acts.push(`<button type="button" class="glass-capsule" data-act="join-before">${icon("link")}<span>Join with page ${p.page - 1}</span></button>`);
  if (model.canCut(current)) acts.push(`<button type="button" class="glass-capsule" data-act="cut">${icon("scissors")}<span>Cut after page ${p.page}</span></button>`);
  else if (model.hasCutAfter(current)) acts.push(`<button type="button" class="glass-capsule" data-act="join-after">${icon("link")}<span>Join with page ${p.page + 1}</span></button>`);
  const bar = v.root.querySelector("[data-actions]");
  const had = bar.contains(document.activeElement) ? [...bar.children].indexOf(document.activeElement) : -1;
  if (bar.innerHTML === acts.join("")) { if (model.onPage) model.onPage(current); loadAround(); return; }
  bar.innerHTML = acts.join("");
  bar.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.act)));
  if (had >= 0) (bar.children[Math.min(had, bar.children.length - 1)] || v.root.querySelector("[data-viewer-done]")).focus({ preventScroll: true });
  if (model.onPage) model.onPage(current);
  loadAround();
}

function act(kind) {
  const id = v.current;
  const before = v.model.position(id);
  if (kind === "cut") v.model.cut(id);
  else if (kind === "join-before") v.model.joinBefore(id);
  else v.model.joinAfter(id);
  if (!v) return;
  const after = v.model.position(id);
  const say = kind === "cut" ? `Cut after page ${before.page}. The next page starts document ${after.document + 1}.`
    : kind === "join-before" ? `Joined with page ${before.page - 1}. This page is in document ${after.document} now.`
    : `Joined with page ${before.page + 1}.`;
  v.root.querySelector("[data-announce]").textContent = say;
  refresh();
  v.root.querySelector("[data-actions] [data-act]")?.focus({ preventScroll: true });
}

// Full-size pictures for the page showing and one either side; the rest drop back to the thumbnail.
function loadAround() {
  const ids = v.model.ids();
  const at = ids.indexOf(v.current);
  const keep = new Set(ids.slice(Math.max(0, at - 1), at + 2));
  for (const [id, url] of v.full) {
    if (keep.has(id)) continue;
    URL.revokeObjectURL(url); v.full.delete(id);
    const img = v.root.querySelector(`[data-page="${CSS.escape(id)}"] img`);
    if (img) img.src = v.model.thumb(id) || "";
  }
  for (const id of keep) {
    if (v.full.has(id) || v.loading.has(id)) continue;
    const s = v;
    s.loading.add(id);
    s.model.full(id).then((blob) => {
      s.loading.delete(id);
      if (v !== s || !blob) return;
      if (!new Set(s.model.ids().slice(Math.max(0, s.model.ids().indexOf(s.current) - 1), s.model.ids().indexOf(s.current) + 2)).has(id)) return;
      const url = URL.createObjectURL(blob);
      s.full.set(id, url);
      const img = s.root.querySelector(`[data-page="${CSS.escape(id)}"] img`);
      if (img) img.src = url;
    }, () => s.loading.delete(id));
  }
}

// ---------- paging, zoom, swipe down ----------
function scrollToCurrent(smooth) {
  const track = v.root.querySelector("[data-track]");
  const el = track.querySelector(`[data-page="${CSS.escape(v.current)}"]`);
  if (el) track.scrollTo({ left: el.offsetLeft, behavior: smooth && !reduceMotion() ? "smooth" : "instant" });
}
export function goPage(delta) {
  if (!v) return;
  const ids = v.model.ids();
  const at = ids.indexOf(v.current) + delta;
  if (at < 0 || at >= ids.length) return;
  resetZoom();
  v.current = ids[at];
  scrollToCurrent(true);
  refresh();
}

function onKey(e) {
  if (!v || e.target.closest?.(".sheet-wrap, .action-sheet-wrap, .menu")) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (v.zoom && v.zoom.k > 1) resetZoom(true); else closeViewer(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); goPage(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); goPage(-1); }
}

const zoomEl = (id) => v.root.querySelector(`[data-page="${CSS.escape(id)}"] .viewer-zoom`);
function applyZoom(animate = false) {
  const z = v.zoom;
  const el = zoomEl(v.current);
  if (!el) return;
  el.style.transition = animate && !reduceMotion() ? `transform ${spring("promote").duration}ms ${spring("promote").easing}` : "none";
  el.style.transform = z && z.k > 1 ? `translate(${z.x}px, ${z.y}px) scale(${z.k})` : "";
  v.root.querySelector("[data-track]").classList.toggle("zoomed", !!(z && z.k > 1));
}
function resetZoom(animate = false) {
  if (!v.zoom) return;
  v.zoom = null;
  applyZoom(animate);
  v.root.querySelectorAll(".viewer-zoom").forEach((el) => { if (!animate) el.style.transform = ""; });
}
// Zoom to k around a point (client coordinates), keeping that point still.
function zoomAt(k, cx, cy, animate) {
  const el = zoomEl(v.current);
  const page = el.parentElement.getBoundingClientRect();
  const z = v.zoom || { k: 1, x: 0, y: 0 };
  k = Math.max(1, Math.min(MAX_ZOOM, k));
  // the point under (cx, cy) in the unzoomed page's coordinates, from its center
  const ox = cx - page.left - page.width / 2, oy = cy - page.top - page.height / 2;
  const px = (ox - z.x) / z.k, py = (oy - z.y) / z.k;
  const nz = { k, x: ox - px * k, y: oy - py * k };
  v.zoom = k > 1.01 ? clampPan(nz, page) : null;
  applyZoom(animate);
}
function clampPan(z, page) {
  const img = zoomEl(v.current).querySelector("img");
  const r = img.getBoundingClientRect();
  const cur = v.zoom || { k: 1 };
  const w = (r.width / cur.k) * z.k, h = (r.height / cur.k) * z.k;
  const mx = Math.max(0, (w - page.width) / 2), my = Math.max(0, (h - page.height) / 2);
  return { k: z.k, x: Math.max(-mx, Math.min(mx, z.x)), y: Math.max(-my, Math.min(my, z.y)) };
}

function bindTrack() {
  const track = v.root.querySelector("[data-track]");
  let t = 0;
  track.addEventListener("scroll", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!v || (v.zoom && v.zoom.k > 1)) return;
      const ids = v.model.ids();
      const at = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      const id = ids[Math.max(0, Math.min(ids.length - 1, at))];
      if (id && id !== v.current) { resetZoom(); v.current = id; refresh(); }
    }, 90);
  }, { passive: true });

  // Pointers: two fingers pinch; one finger pans a zoomed page, or drags down to close at fit.
  const pts = new Map();
  let pinch = null, pan = null, down = null, lastTap = 0;
  track.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: v.zoom ? v.zoom.k : 1 };
      pan = null; down = null;
    } else if (pts.size === 1) {
      if (v.zoom && v.zoom.k > 1) pan = { x: e.clientX, y: e.clientY, z: { ...v.zoom } };
      else down = { x: e.clientX, y: e.clientY, t: performance.now(), dy: 0, vertical: null };
      track.setPointerCapture?.(e.pointerId);
    }
  });
  track.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch.k * (d / Math.max(1, pinch.d)), (a.x + b.x) / 2, (a.y + b.y) / 2, false);
    } else if (pan) {
      const page = zoomEl(v.current).parentElement.getBoundingClientRect();
      v.zoom = clampPan({ k: pan.z.k, x: pan.z.x + e.clientX - pan.x, y: pan.z.y + e.clientY - pan.y }, page);
      applyZoom(false);
    } else if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (down.vertical === null && Math.hypot(dx, dy) > 8) down.vertical = Math.abs(dy) > Math.abs(dx) && dy > 0;
      if (down.vertical) {
        e.preventDefault();
        down.dy = Math.max(0, dy);
        const el = zoomEl(v.current);
        el.style.transition = "none";
        el.style.transform = `translateY(${down.dy}px) scale(${1 - Math.min(0.2, down.dy / 1500)})`;
        v.root.style.setProperty("--viewer-fade", String(Math.max(0.3, 1 - down.dy / 400)));
      }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch && pts.size < 2) { pinch = null; if (v.zoom && v.zoom.k <= 1.01) resetZoom(true); return; }
    if (pan) { pan = null; return; }
    if (down) {
      const d = down; down = null;
      if (d.vertical) {
        v.root.style.removeProperty("--viewer-fade");
        if (d.dy > 110) { closeViewer(); return; }
        const el = zoomEl(v.current); el.style.transition = ""; el.style.transform = "";
        return;
      }
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved < 10 && performance.now() - d.t < 300) {
        const now = performance.now();
        if (now - lastTap < 320) { lastTap = 0; zoomAt(TAP_ZOOM, e.clientX, e.clientY, true); }
        else lastTap = now;
      }
    } else if (!pts.size && e.type === "pointerup" && v.zoom && v.zoom.k > 1) {
      // a double tap on a zoomed page goes back to fit
      const now = performance.now();
      if (now - lastTap < 320) { lastTap = 0; resetZoom(true); } else lastTap = now;
    }
  };
  track.addEventListener("pointerup", up);
  track.addEventListener("pointercancel", up);
  track.addEventListener("dblclick", (e) => { e.preventDefault(); });
  // Trackpad pinch arrives as ctrl + wheel.
  track.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt((v.zoom ? v.zoom.k : 1) * Math.exp(-e.deltaY / 100), e.clientX, e.clientY, false);
  }, { passive: false });
}

// The zoom from (and back into) the thumbnail: a FLIP of the page picture.
function zoomIn(id) {
  const img = v.root.querySelector(`[data-page="${CSS.escape(id)}"] img`);
  const thumb = v.model.thumbEl(id);
  if (reduceMotion() || !img || !thumb) { v.root.classList.add("shown"); return; }
  requestAnimationFrame(() => {
    const a = img.getBoundingClientRect(), b = thumb.getBoundingClientRect();
    v.root.classList.add("shown");
    if (!a.width || !b.width) return;
    img.animate([{ transform: flip(a, b) }, { transform: "none" }], spring("promote"));
  });
}
// The transform that puts rect a where rect b is (scale from a's center).
function flip(a, b) {
  const k = Math.min(b.width / a.width, b.height / a.height);
  return `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${k})`;
}
