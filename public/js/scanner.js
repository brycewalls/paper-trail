// scanner.js: Scan document, the full-screen camera scanner (#scanner). Owns the camera, live edge
// detection, capture, the review step and its corner handles, flattening, the page strip, and the
// Color / Document and Auto-capture toggles. Done hands the pages to the deck as one document
// (deck.addAsOne), the same path as Photograph a multi-page document.
import { FIREBASE } from "./config.js";
import { $, esc, reduceMotion, prefs } from "./ui.js";
import { canvasBlob, makeCanvas } from "./media.js";
import { addAsOne } from "./deck.js";

// ---------- the document scanner ----------
// Scan document opens the rear camera full screen. jscanify (MIT) on OpenCV.js (Apache 2.0) finds the
// page on a small copy of each video frame and the outline is drawn live over the video. Capture
// grabs the full video frame, the review step shows draggable corners (the whole frame when no page
// was found), and Keep page flattens it with a perspective warp to about 200 dpi letter: 1700 px on
// the short side, JPEG 0.85, with an optional light whitening pass (Document). Done hands the pages
// to the same photos-to-one-PDF path as "Photograph a multi-page document", so a scan joins the deck
// exactly like a chosen file. Both libraries load the first time the scanner opens, pinned and
// checked with SRI: OpenCV.js is about 9 MB (about 2 to 3 MB over the wire, then cached).
const SCAN_LIBS = [
  { src: "https://cdn.jsdelivr.net/npm/jscanify@1.4.2/src/opencv.js", integrity: "sha384-gIQOiZ94Y7O29uYShJN17TQmC+8BFBNvRQ9dw9Uj9jTXckygNQz59FfqlrMzh3KT" },
  { src: "https://cdn.jsdelivr.net/npm/jscanify@1.4.2/src/jscanify.js", integrity: "sha384-1lFiUI8fK3enJqIHszlQ9u3upmgE3Z0Jj0Pr9vubGa2amHhsn06NurXsHxJLX6Dz" },
];
const CAM_CONSTRAINTS = { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } } };
const DETECT_EDGE = 560;     // px, long side of the copy edge detection runs on
const DETECT_EVERY = 110;    // ms between live detections
const STILL_MAX = 3000;      // px, long side of the captured still the page is cut from
const PAGE_SHORT = 1700, PAGE_MAX = 3400, PAGE_Q = 0.85;
const STEADY_TICKS = 8;      // detections in a row that barely move before auto-capture fires
const MODE_KEY = "pt-scan-mode", AUTO_KEY = "pt-scan-auto";
const SCAN_ERRORS = {
  insecure: ["The camera needs a secure connection", `Open Paper Trail at ${FIREBASE.site} to scan. Choose documents works here.`],
  unsupported: ["This browser can't use the camera", "Choose documents still works. Pick PDFs or photos instead."],
  denied: ["Camera access is off", "Paper Trail needs the camera to scan. On iPhone, open Settings, then Apps, then Safari, then Camera, and choose Ask or Allow. Then tap Try again."],
  notfound: ["No camera found", "This device doesn't have a camera Paper Trail can use. Choose documents works instead."],
  busy: ["The camera is busy", "Another app may be using it. Close that app, then tap Try again."],
  stopped: ["The camera stopped", "Tap Try again to turn it back on. Pages you already kept are still here."],
  unknown: ["The camera didn't start", "Tap Try again. If it keeps happening, use Choose documents instead."],
};

export const sc = {
  open: false, gen: 0, view: "camera", stream: null, cvs: null, libs: "loading", busy: false,
  pages: [], review: null, retakeIndex: null, note: null,
  live: null, prev: null, misses: 0, steady: 0, timer: 0,
  mode: prefs.get(MODE_KEY) === "color" ? "color" : "document",
  auto: prefs.get(AUTO_KEY) === "1", armed: true, armRef: null, cooldown: 0,
  small: null, warned: false,
};

let scanLibs = null;
function loadScript({ src, integrity }) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.integrity = integrity; s.crossOrigin = "anonymous"; s.async = true;
    s.onload = res; s.onerror = () => { s.remove(); rej(new Error("Couldn't load " + src)); };
    document.head.appendChild(s);
  });
}
// OpenCV.js compiles its WebAssembly after the script runs; cv.Mat appears once it's ready. Polling
// avoids awaiting the Emscripten module, whose .then() can loop forever.
function cvReady() {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      if (window.cv && window.cv.Mat && window.cv.imread) return res();
      if (Date.now() - t0 > 60000) return rej(new Error("OpenCV didn't start"));
      setTimeout(tick, 80);
    })();
  });
}
function loadScanLibs() {
  if (!scanLibs) {
    scanLibs = (async () => {
      if (!window.cv) await loadScript(SCAN_LIBS[0]);
      if (!window.jscanify) await loadScript(SCAN_LIBS[1]);
      await cvReady();
      return new window.jscanify();
    })();
    scanLibs.catch(() => { scanLibs = null; });  // the next open tries again
  }
  return scanLibs;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fit = (w, h, W, H) => { const s = Math.min(W / w, H / h); return { s, x: (W - w * s) / 2, y: (H - h * s) / 2 }; };
const fullFrame = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const camColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Corners as [top left, top right, bottom right, bottom left].
function orderQuad(pts) {
  const by = (f) => pts.reduce((a, b) => (f(b) > f(a) ? b : a));
  return [by((p) => -(p.x + p.y)), by((p) => p.x - p.y), by((p) => p.x + p.y), by((p) => p.y - p.x)];
}
function validQuad(q, W, H) {
  if (new Set(q.map((p) => p.x + "," + p.y)).size < 4) return false;
  let sign = 0, area = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0 || (sign && Math.sign(cross) !== sign)) return false;
    sign = Math.sign(cross);
    area += a.x * b.y - b.x * a.y;
    if (dist(a, b) < 0.08 * Math.min(W, H)) return false;
  }
  return Math.abs(area) / 2 >= 0.12 * W * H;
}

// jscanify finds the page's outline (the biggest contour). Its four-point simplification is used
// when it's a clean quadrilateral; otherwise jscanify's own corner pick. Returns corners in the
// canvas's pixels, or null when there's no believable page.
function findQuad(canvas) {
  const cv = window.cv;
  let img = null, contour = null, approx = null;
  try {
    img = cv.imread(canvas);
    // Soften desk grain and paper texture first, so their edges don't join the page's outline.
    cv.GaussianBlur(img, img, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    contour = sc.cvs.findPaperContour(img);
    if (!contour) return null;
    approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
    let pts;
    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      const d = approx.data32S;
      pts = [0, 1, 2, 3].map((i) => ({ x: d[2 * i], y: d[2 * i + 1] }));
    } else {
      const c = sc.cvs.getCornerPoints(contour);
      pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
      if (pts.some((p) => !p)) return null;
    }
    const q = orderQuad(pts);
    return validQuad(q, canvas.width, canvas.height) ? q : null;
  } catch (e) {
    if (!sc.warned) { sc.warned = true; console.warn("Edge detection failed", e); }
    return null;
  } finally {
    img?.delete(); contour?.delete(); approx?.delete();
  }
}
// Detect on a small copy of `src` (a video or a canvas) and scale the corners back up.
function detectOn(src, w, h) {
  const k = Math.min(1, DETECT_EDGE / Math.max(w, h));
  if (!sc.small) sc.small = makeCanvas(1, 1);
  const c = sc.small, W = Math.round(w * k), H = Math.round(h * k);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  c.getContext("2d", { willReadFrequently: true }).drawImage(src, 0, 0, W, H);
  const q = findQuad(c);
  return q && q.map((p) => ({ x: p.x / k, y: p.y / k }));
}

// ---------- scanner: open, close, camera ----------
function openScanner() {
  if (sc.open) return;
  Object.assign(sc, { open: true, pages: [], retakeIndex: null, note: null, live: null, prev: null, steady: 0, armed: true });
  $("scanner").hidden = false;
  $("app").inert = true;
  document.documentElement.classList.add("scanning");
  syncToggles();
  renderStrip();
  showCamera();
  if (!sc.cvs) {
    sc.libs = "loading";
    loadScanLibs().then((s) => { sc.cvs = s; sc.libs = "ready"; updateMsg(); },
      (e) => { console.warn("Scanner libraries didn't load", e); sc.libs = "failed"; updateMsg(); });
  }
  $("sc-cancel").focus();
  startCamera();
}
function closeScanner() {
  sc.open = false; sc.gen++;
  stopCamera();
  clearTimeout(sc.timer);
  closeReview();
  sc.pages.forEach((p) => URL.revokeObjectURL(p.thumb));
  Object.assign(sc, { pages: [], retakeIndex: null, live: null, prev: null, steady: 0, note: null });
  $("scanner").hidden = true;
  $("app").inert = false;
  document.documentElement.classList.remove("scanning");
  // Back to whatever opened it: the legacy button when it shows, else Sort's Scan menu button (#79).
  ($("btn-scan").offsetParent ? $("btn-scan") : $("btn-scan-menu")).focus();
}
function cancelScan() {
  const n = sc.pages.length;
  if (n && !confirm(`Discard the ${n} page${n > 1 ? "s" : ""} you scanned?`)) return false;
  closeScanner();
  return true;
}
function finishScan() {
  const n = sc.pages.length;
  if (!n || sc.busy) return;
  const files = sc.pages.map((p, i) => new File([p.blob], `scan-page-${i + 1}.jpg`, { type: "image/jpeg" }));
  closeScanner();
  addAsOne(files, `Scan, ${n} page${n > 1 ? "s" : ""}`);
}

function stopCamera() {
  if (sc.stream) sc.stream.getTracks().forEach((t) => t.stop());
  sc.stream = null;
  const v = $("sc-video");
  v.pause?.(); v.srcObject = null;
}
function camError(e) {
  const n = e?.name || "";
  if (/NotAllowed|Security|PermissionDenied/.test(n)) return "denied";
  if (/NotFound|DevicesNotFound|Overconstrained/.test(n)) return "notfound";
  if (/NotReadable|TrackStart|Abort/.test(n)) return "busy";
  return "unknown";
}
async function startCamera() {
  const gen = ++sc.gen;
  stopCamera();
  if (!window.isSecureContext) return showScanError("insecure");
  if (!navigator.mediaDevices?.getUserMedia) return showScanError("unsupported");
  updateMsg();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(CAM_CONSTRAINTS); }
  catch (e) {
    if (gen === sc.gen && sc.open) { console.warn("Camera didn't start", e); showScanError(camError(e)); }
    return;
  }
  if (gen !== sc.gen || !sc.open || document.hidden) { stream.getTracks().forEach((t) => t.stop()); return; }
  sc.stream = stream;
  // A track the browser ends on its own (another app took the camera, say). Our own stop() doesn't fire this.
  stream.getVideoTracks()[0]?.addEventListener("ended", () => { if (sc.stream === stream) { stopCamera(); showScanError("stopped"); } });
  const v = $("sc-video");
  v.srcObject = stream;
  try { await v.play(); } catch { /* muted + playsinline is allowed to autoplay; metadata below decides */ }
  if (!v.videoWidth) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
  if (gen !== sc.gen) return;
  updateMsg();
  scheduleDetect();
}
document.addEventListener("visibilitychange", () => {
  if (!sc.open) return;
  if (document.hidden) { sc.gen++; stopCamera(); clearTimeout(sc.timer); }
  else if (sc.view !== "error") startCamera();
});
window.addEventListener("pagehide", () => { if (sc.open) { sc.gen++; stopCamera(); } });

function showScanError(code) {
  const [h, p] = SCAN_ERRORS[code] || SCAN_ERRORS.unknown;
  sc.view = "error";
  clearTimeout(sc.timer);
  closeReview();
  $("sc-review").hidden = true;
  $("sc-err-h").textContent = h;
  $("sc-err-p").textContent = p;
  $("sc-retry").hidden = ["insecure", "unsupported", "notfound"].includes(code);
  $("sc-error").hidden = false;
  $("sc-error").dataset.code = code;
  $("sc-cam").hidden = false; $("sc-rev").hidden = true;
  $("sc-shutter").disabled = true;
  setMsg("");
  drawOverlay();
  ($("sc-retry").hidden ? $("sc-pick") : $("sc-retry")).focus();
}

// ---------- scanner: the live view ----------
function setMsg(text, spin = false) {
  const el = $("sc-msg");
  const html = (spin ? '<span class="spin" aria-hidden="true"></span>' : "") + esc(text);
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = !text;
}
function updateMsg() {
  if (!sc.open || sc.view !== "camera") return;
  const v = $("sc-video");
  const live = !!sc.stream && v.videoWidth > 0;
  $("sc-shutter").disabled = !live || sc.libs === "loading" || sc.busy;
  if (!live || sc.libs === "loading") return setMsg("Getting the scanner ready", true);
  if (sc.busy) return setMsg("Capturing", true);
  if (sc.note && sc.note.until > Date.now()) return setMsg(sc.note.text);
  const pre = sc.retakeIndex != null ? `Retaking page ${sc.retakeIndex + 1}. ` : "";
  if (sc.libs === "failed") return setMsg(pre + "Edge detection didn't load, so pages save as the whole photo. Reopen the scanner to try again.");
  if (sc.live) return setMsg(pre + (sc.auto ? "Page found. Hold steady." : "Page found. Hold still and capture."));
  setMsg(pre + "Point the camera at the page. A darker surface behind it helps.");
}
function showCamera() {
  sc.view = "camera";
  $("sc-review").hidden = true;
  $("sc-error").hidden = true;
  $("sc-cam").hidden = false;
  $("sc-rev").hidden = true;
  $("sc-strip").inert = false;
  renderStrip();
  drawOverlay();
  updateMsg();
  scheduleDetect();
}
function scheduleDetect() {
  clearTimeout(sc.timer);
  if (sc.open && sc.view === "camera" && sc.stream) sc.timer = setTimeout(detectTick, DETECT_EVERY);
}
function detectTick() {
  if (!sc.open || sc.view !== "camera" || !sc.stream) return;
  if (sc.busy) return scheduleDetect();
  const v = $("sc-video");
  if (sc.cvs && v.videoWidth) {
    const raw = detectOn(v, v.videoWidth, v.videoHeight);
    const diag = Math.hypot(v.videoWidth, v.videoHeight);
    const moved = (a, b) => (a && b ? Math.max(...a.map((p, i) => dist(p, b[i]))) : Infinity);
    if (raw) {
      const m = moved(raw, sc.prev);
      sc.steady = m < 0.012 * diag ? sc.steady + 1 : 0;
      // Ease the outline toward each new detection so it doesn't jitter, but jump when the page moves a lot.
      sc.live = sc.live && moved(raw, sc.live) < 0.08 * diag ? sc.live.map((p, i) => ({ x: (p.x + raw[i].x) / 2, y: (p.y + raw[i].y) / 2 })) : raw;
      sc.misses = 0;
      if (!sc.armed && moved(raw, sc.armRef) > 0.1 * diag) sc.armed = true;
    } else {
      sc.steady = 0;
      if (++sc.misses >= 3) { sc.live = null; sc.armed = true; }
    }
    sc.prev = raw;
    drawOverlay();
    updateMsg();
    // Auto-capture fires once per page: after a capture it waits for the page to leave or move a lot.
    if (sc.auto && sc.armed && raw && sc.steady >= STEADY_TICKS && Date.now() > sc.cooldown) { capture(true); return; }
  }
  scheduleDetect();
}
function drawOverlay() {
  const c = $("sc-overlay"), st = $("sc-stage"), v = $("sc-video");
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = st.clientWidth, H = st.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const x = c.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  if (!sc.live || sc.view !== "camera" || !v.videoWidth) return;
  const f = fit(v.videoWidth, v.videoHeight, W, H);
  x.beginPath();
  sc.live.forEach((p, i) => x[i ? "lineTo" : "moveTo"](f.x + p.x * f.s, f.y + p.y * f.s));
  x.closePath();
  x.fillStyle = camColor("--cam-fill"); x.fill();
  x.lineWidth = 3; x.lineJoin = "round"; x.strokeStyle = camColor("--cam-edge"); x.stroke();
}
function flash() {
  if (reduceMotion) return;
  const f = $("sc-flash");
  f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
}

// Capture grabs the full video frame (iPhone Safari has no ImageCapture). The corners come from a
// fresh detection on the still, else the live outline, else the whole frame.
async function capture(auto = false) {
  const v = $("sc-video");
  if (sc.busy || !sc.stream || sc.view !== "camera" || !v.videoWidth) return;
  sc.busy = true;
  clearTimeout(sc.timer);
  updateMsg();
  flash();
  try {
    const vw = v.videoWidth, vh = v.videoHeight, k = Math.min(1, STILL_MAX / Math.max(vw, vh));
    const still = makeCanvas(Math.round(vw * k), Math.round(vh * k));
    still.getContext("2d").drawImage(v, 0, 0, still.width, still.height);
    let corners = sc.cvs ? detectOn(still, still.width, still.height) : null;
    if (!corners && sc.live) corners = sc.live.map((p) => ({ x: p.x * k, y: p.y * k }));
    const r = { canvas: still, corners: corners || fullFrame(still.width, still.height), found: !!corners, mode: sc.mode, index: sc.retakeIndex, editing: false };
    if (auto && corners) {
      Object.assign(sc, { armed: false, armRef: sc.live || sc.prev, cooldown: Date.now() + 1500, steady: 0, review: r });
      sc.busy = false;
      await keepPage();
      sc.note = { text: `Page ${sc.pages.length} kept. Turn to the next page, or tap Done.`, until: Date.now() + 2500 };
    } else {
      sc.busy = false;
      openReview(r);
    }
  } catch (e) {
    console.warn("Capture failed", e);
    sc.note = { text: "That capture didn't work. Try again.", until: Date.now() + 2500 };
  } finally {
    sc.busy = false;
    if (sc.view === "camera") { updateMsg(); scheduleDetect(); }
  }
}

// ---------- scanner: review and corner handles ----------
const handles = [...document.querySelectorAll(".sc-handle")];
function openReview(r) {
  clearTimeout(sc.timer);
  sc.review = r;
  sc.view = "review";
  r.drawn = false;
  $("sc-review").hidden = false;
  $("sc-cam").hidden = true;
  $("sc-rev").hidden = false;
  $("sc-strip").inert = true;
  $("sc-delete").hidden = !r.editing;
  $("sc-keep").textContent = r.editing ? "Save page" : r.index != null ? "Use this page" : "Keep page";
  syncToggles();
  drawOverlay();
  layoutReview();
  renderStrip();
  setMsg(!sc.cvs ? "Edge detection isn't ready, so the whole photo is saved."
    : r.editing ? `Page ${r.index + 1}. Drag the corners, retake it, or delete it.`
    : r.found ? "Drag the corners if the outline is off."
    : "No page found, so the whole photo is selected. Drag the corners to the page's edges.");
  $("sc-keep").focus();
}
function closeReview() {
  const r = sc.review;
  if (!r) return;
  r.canvas.width = r.canvas.height = 0;  // frees the still's memory right away (iPhone Safari caps canvas memory)
  sc.review = null;
  const c = $("sc-still"); c.width = c.height = 0;
}
function layoutReview() {
  const r = sc.review;
  if (!r || sc.view !== "review") return;
  const st = $("sc-stage"), W = st.clientWidth, H = st.clientHeight, pad = 26;
  const f = fit(r.canvas.width, r.canvas.height, Math.max(1, W - pad * 2), Math.max(1, H - pad * 2));
  f.x += pad; f.y += pad;
  r.fit = f;
  const c = $("sc-still"), dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = r.canvas.width * f.s, ch = r.canvas.height * f.s;
  Object.assign(c.style, { left: f.x + "px", top: f.y + "px", width: cw + "px", height: ch + "px" });
  const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
  if (!r.drawn || c.width !== pw || c.height !== ph) {
    c.width = pw; c.height = ph;
    c.getContext("2d").drawImage(r.canvas, 0, 0, pw, ph);
    r.drawn = true;
  }
  drawQuad();
}
function drawQuad() {
  const r = sc.review, f = r.fit, st = $("sc-stage");
  const pts = r.corners.map((p) => [f.x + p.x * f.s, f.y + p.y * f.s]);
  $("sc-quad").setAttribute("viewBox", `0 0 ${st.clientWidth} ${st.clientHeight}`);
  $("sc-poly").setAttribute("points", pts.map((p) => p.join(",")).join(" "));
  $("sc-dim").setAttribute("d", `M${f.x} ${f.y}h${r.canvas.width * f.s}v${r.canvas.height * f.s}h${-r.canvas.width * f.s}Z M${pts.map((p) => p.join(" ")).join(" L")}Z`);
  handles.forEach((h, i) => { h.style.left = pts[i][0] + "px"; h.style.top = pts[i][1] + "px"; h.hidden = !sc.cvs; });
}
function setCorner(i, x, y) {
  const r = sc.review;
  r.corners[i] = { x: Math.max(0, Math.min(r.canvas.width, x)), y: Math.max(0, Math.min(r.canvas.height, y)) };
  drawQuad();
}
handles.forEach((h, i) => {
  let off = null;
  h.addEventListener("pointerdown", (e) => {
    if (!sc.review) return;
    e.preventDefault();
    const b = h.getBoundingClientRect();
    off = { x: e.clientX - (b.left + b.width / 2), y: e.clientY - (b.top + b.height / 2) };
    h.setPointerCapture?.(e.pointerId);
    h.classList.add("dragging");
    h.focus();
  });
  h.addEventListener("pointermove", (e) => {
    if (!off || !sc.review) return;
    const st = $("sc-stage").getBoundingClientRect(), f = sc.review.fit;
    setCorner(i, (e.clientX - off.x - st.left - f.x) / f.s, (e.clientY - off.y - st.top - f.y) / f.s);
  });
  const end = () => { off = null; h.classList.remove("dragging"); };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
  h.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step || !sc.review) return;
    e.preventDefault();
    const r = sc.review, n = (e.shiftKey ? 0.05 : 0.01) * Math.max(r.canvas.width, r.canvas.height);
    setCorner(i, r.corners[i].x + step[0] * n, r.corners[i].y + step[1] * n);
  });
});

// Keep page: flatten at about 200 dpi letter (1700 px on the short side), lighten if Document.
function flatten(src, q, mode) {
  const [tl, tr, br, bl] = q;
  const w = (dist(tl, tr) + dist(bl, br)) / 2, h = (dist(tl, bl) + dist(tr, br)) / 2;
  let s = PAGE_SHORT / Math.max(1, Math.min(w, h));
  if (Math.max(w, h) * s > PAGE_MAX) s = PAGE_MAX / Math.max(w, h);
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  let out;
  if (sc.cvs) out = sc.cvs.extractPaper(src, W, H, { topLeftCorner: tl, topRightCorner: tr, bottomLeftCorner: bl, bottomRightCorner: br });
  else { out = makeCanvas(W, H); out.getContext("2d").drawImage(src, 0, 0, W, H); }  // corners are the whole frame here
  if (mode === "document") whiten(out);
  return out;
}
// A light levels pass: the darkest ink goes to black and typical paper to white, same curve on
// every channel so colored ink and stamps keep their color.
function whiten(c) {
  const x = c.getContext("2d");
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 16) { hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; n++; }
  const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  const lo = pct(0.02), hi = pct(0.7);
  if (hi - lo < 48) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo);
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  x.putImageData(img, 0, 0);
}
async function keepPage() {
  const r = sc.review;
  if (!r || sc.busy) return;
  sc.busy = true;
  $("sc-keep").disabled = true;
  setMsg("Flattening the page", true);
  await new Promise((res) => setTimeout(res, 30));  // let the message paint
  try {
    const out = flatten(r.canvas, r.corners, r.mode);
    const blob = await canvasBlob(out, PAGE_Q);
    const still = r.stillBlob || await canvasBlob(r.canvas, 0.9);
    const page = { blob, still, corners: r.corners.map((p) => ({ ...p })), mode: r.mode, w: out.width, h: out.height, thumb: URL.createObjectURL(blob) };
    out.width = out.height = 0;
    if (r.index != null && sc.pages[r.index]) { URL.revokeObjectURL(sc.pages[r.index].thumb); sc.pages[r.index] = page; }
    else sc.pages.push(page);
    sc.retakeIndex = null;
    closeReview();
    sc.busy = false;
    showCamera();
    const t = $("sc-strip").querySelectorAll(".sc-thumb")[r.index ?? sc.pages.length - 1];
    t?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  } catch (e) {
    console.warn("Flatten failed", e);
    sc.busy = false;
    if (sc.view !== "review") closeReview();
    setMsg("Couldn't flatten that page. Tap Retake and try again.");
  } finally {
    $("sc-keep").disabled = false;
  }
}
async function editPage(i) {
  const p = sc.pages[i];
  if (!p || sc.busy || sc.view !== "camera") return;
  sc.busy = true;
  try {
    const bmp = await createImageBitmap(p.still);
    const c = makeCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close?.();
    sc.busy = false;
    openReview({ canvas: c, corners: p.corners.map((q) => ({ ...q })), found: true, mode: p.mode, index: i, editing: true, stillBlob: p.still });
  } catch (e) {
    console.warn("Couldn't reopen the page", e);
    sc.busy = false;
    sc.note = { text: "Couldn't open that page. Delete it and scan it again.", until: Date.now() + 3000 };
    updateMsg();
  }
}
function leaveReview(retake) {
  const r = sc.review;
  if (r?.editing && retake) sc.retakeIndex = r.index;
  closeReview();
  showCamera();
  $("sc-shutter").disabled ? $("sc-cancel").focus() : $("sc-shutter").focus();
}
function renderStrip() {
  const n = sc.pages.length;
  const current = sc.review?.editing ? sc.review.index : sc.retakeIndex;
  $("sc-strip").innerHTML = n
    ? sc.pages.map((p, i) => `<button type="button" class="sc-thumb" data-page="${i}" aria-label="Page ${i + 1}. Adjust, retake or delete it."${current === i ? ' aria-current="true"' : ""}><img src="${p.thumb}" alt=""><span>${i + 1}</span></button>`).join("")
    : `<p class="note">Pages you keep line up here. Tap one to adjust, retake or delete it.</p>`;
  $("sc-count").textContent = n ? `${n} page${n > 1 ? "s" : ""}` : "No pages yet";
  $("sc-done").disabled = !n;
  $("sc-done").textContent = n ? `Done (${n})` : "Done";
}
function syncToggles() {
  const mode = sc.review ? sc.review.mode : sc.mode;
  document.querySelectorAll(".seg [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("sc-auto").setAttribute("aria-pressed", String(sc.auto));
}

$("btn-scan").addEventListener("click", openScanner);
$("sc-cancel").addEventListener("click", cancelScan);
$("sc-done").addEventListener("click", finishScan);
$("sc-shutter").addEventListener("click", () => capture(false));
$("sc-keep").addEventListener("click", keepPage);
$("sc-retake").addEventListener("click", () => leaveReview(true));
$("sc-delete").addEventListener("click", () => {
  const r = sc.review;
  if (!r?.editing) return;
  URL.revokeObjectURL(sc.pages[r.index].thumb);
  sc.pages.splice(r.index, 1);
  sc.retakeIndex = null;
  leaveReview(false);
});
$("sc-retry").addEventListener("click", () => { showCamera(); startCamera(); });
$("sc-pick").addEventListener("click", () => { if (cancelScan()) $("file").click(); });
$("sc-auto").addEventListener("click", () => {
  sc.auto = !sc.auto; sc.armed = true; sc.steady = 0;
  prefs.set(AUTO_KEY, sc.auto ? "1" : "0");
  syncToggles(); updateMsg();
});
document.querySelector(".seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  sc.mode = b.dataset.mode;
  if (sc.review) sc.review.mode = sc.mode;
  prefs.set(MODE_KEY, sc.mode);
  syncToggles();
});
$("sc-strip").addEventListener("click", (e) => {
  const t = e.target.closest("[data-page]");
  if (t) editPage(Number(t.dataset.page));
});
$("scanner").addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.preventDefault();
  if (sc.view === "review") leaveReview(false);
  else cancelScan();
});
window.addEventListener("resize", () => { if (sc.open) { drawOverlay(); layoutReview(); } });
