// lab/ppocr.js: PaddleOCR's PP-OCRv5 mobile pipeline in plain JavaScript (#101), for the lab's OCR
// worker (lab/ocr-worker.js) and the benchmark (tools/lab/ocr-bench.mjs). No DOM, no network: the
// caller hands in RGBA pixels and two ONNX Runtime sessions. Pure apart from session.run.
//
//   readPage(img, { ort, det, rec, dict, detMax, onProgress }) -> { text, lines, words, width, height, ms }
//     img        { data: Uint8ClampedArray RGBA, width, height }, the upright page picture
//     det, rec   ort.InferenceSession for PP-OCRv5_mobile_det and en_PP-OCRv5_mobile_rec
//     dict       the recognizer's characters, in order (lab-models/.../dict-en.txt, one per line)
//     detMax     the detector's long side in pixels (multiples of 32), 1280 by default
//     onProgress (0..1) as the page goes: the detector is the first fifth, the lines the rest
//   text is the page as lines, top to bottom, each line's pieces left to right; words are the
//   pieces with their boxes in the picture's pixels ({ text, x, y, w, h, score }).
//
// The steps follow PaddleOCR's own inference config for these models (inference.yml): the detector
// takes BGR normalized with the ImageNet mean and std, and its probability map goes through DB
// post-processing (threshold 0.3, box score 0.6, unclip 1.5); each box is cut out upright, scaled
// to 48 px high, normalized to [-1, 1] and read with greedy CTC decoding (score under 0.5 dropped).
// Owner: lab OCR.

export const DET_MAX = 1280;
const DB = { thresh: 0.3, boxThresh: 0.6, unclip: 1.5, minSize: 3, maxCandidates: 1000 };
const REC_H = 48, REC_MIN_W = 320, REC_MAX_W = 3200, REC_BATCH = 6, DROP_SCORE = 0.5;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

// ---------- pixels ----------
// Area-averaged resize (sharp enough for downscaling a page; bilinear when it grows).
export function resizeRgba(src, w, h) {
  const { data, width: sw, height: sh } = src;
  const out = new Uint8ClampedArray(w * h * 4);
  const kx = sw / w, ky = sh / h;
  if (kx <= 1 && ky <= 1) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = sampleBilinear(data, sw, sh, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
      const o = (y * w + x) * 4;
      out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = 255;
    }
    return { data: out, width: w, height: h };
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * ky)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * kx)));
      let r = 0, g = 0, b = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      }
      const n = (y1 - y0) * (x1 - x0), o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}
const px = [0, 0, 0];
function sampleBilinear(data, w, h, fx, fy) {
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
  const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const ax = fx - x0, ay = fy - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * ax;
    const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * ax;
    px[c] = top + (bot - top) * ay;
  }
  return px;
}

// ---------- detection ----------
export function detSize(width, height, detMax = DET_MAX) {
  const k = detMax / Math.max(width, height);
  const r32 = (v) => Math.max(32, Math.round(v / 32) * 32);
  return { w: r32(width * k), h: r32(height * k) };
}
// RGBA -> the detector's [1, 3, h, w] float tensor (BGR, ImageNet mean and std, as inference.yml).
export function detTensorData(img) {
  const { data, width: w, height: h } = img, n = w * h;
  const out = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (data[p + 2] / 255 - MEAN[0]) / STD[0];          // B
    out[n + i] = (data[p + 1] / 255 - MEAN[1]) / STD[1];      // G
    out[2 * n + i] = (data[p] / 255 - MEAN[2]) / STD[2];      // R
  }
  return out;
}

// DB post-processing: the probability map -> rotated boxes in the original picture's pixels.
// Each box: { cx, cy, w, h, angle } (w along the text, angle in radians) plus score and pts.
export function dbBoxes(prob, mw, mh, srcW, srcH) {
  const n = mw * mh;
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  const boxes = [];
  let next = 0;
  for (let s = 0; s < n && boxes.length < DB.maxCandidates; s++) {
    if (label[s] || prob[s] <= DB.thresh) continue;
    next++;
    let top = 0, count = 0, sum = 0;
    stack[top++] = s; label[s] = next;
    const pts = [];
    while (top) {
      const i = stack[--top];
      const x = i % mw, y = (i - x) / mw;
      count++; sum += prob[i];
      // Only edge pixels can be on the hull.
      let edge = false;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) { edge = true; continue; }
        const j = ny * mw + nx;
        if (prob[j] <= DB.thresh) { edge = true; continue; }
        if (!label[j]) { label[j] = next; stack[top++] = j; }
      }
      // Pixel coordinates, as OpenCV's contours give them to PaddleOCR (not pixel corners, which
      // would make every box a pixel taller and the unclipped crop's letters too narrow to read).
      if (edge) pts.push(x, y);
    }
    if (count < 4) continue;
    const r = minAreaRect(pts);
    if (Math.min(r.w, r.h) < DB.minSize) continue;
    const score = sum / count;
    if (score < DB.boxThresh) continue;
    // Unclip: grow the rectangle by area * ratio / perimeter on every side (pyclipper's offset of a
    // rectangle), then back to the original picture's scale.
    const d = (r.w * r.h * DB.unclip) / (2 * (r.w + r.h));
    let w = r.w + 2 * d, h = r.h + 2 * d;
    if (Math.min(w, h) < DB.minSize + 2) continue;
    const sx = srcW / mw, sy = srcH / mh;
    // Scale the rotated rectangle by scaling its corners.
    const c = corners(r.cx, r.cy, w, h, r.angle).map(([x, y]) => [x * sx, y * sy]);
    const box = rectFromCorners(c);
    box.score = score;
    boxes.push(box);
  }
  return boxes;
}
function corners(cx, cy, w, h, a) {
  const ca = Math.cos(a), sa = Math.sin(a), hw = w / 2, hh = h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * ca - y * sa, cy + x * sa + y * ca]);
}
// Corners in order (tl, tr, br, bl of the rotated frame) -> { cx, cy, w, h, angle } with w the
// longer side kept near horizontal, and the axis-aligned bounds.
function rectFromCorners(c) {
  const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2;
  const e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1]], e2 = [c[3][0] - c[0][0], c[3][1] - c[0][1]];
  // The text runs along whichever side is nearer horizontal (a page is upright by now).
  let w = Math.hypot(...e1), h = Math.hypot(...e2), angle = Math.atan2(e1[1], e1[0]);
  const other = Math.atan2(e2[1], e2[0]);
  if (Math.abs(Math.cos(other)) > Math.abs(Math.cos(angle))) { [w, h] = [h, w]; angle = other; }
  // Keep text reading left to right: the angle within (-90, 90] degrees.
  if (angle > Math.PI / 2) angle -= Math.PI; else if (angle <= -Math.PI / 2) angle += Math.PI;
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  return { cx, cy, w, h, angle, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
// The smallest rotated rectangle around points [x0, y0, x1, y1, ...] (convex hull, then each hull
// edge's direction).
export function minAreaRect(flat) {
  const p = [];
  for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]);
  const hull = convexHull(p);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of hull) {
      const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = { area, cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, w: maxU - minU, h: maxV - minV, angle: Math.atan2(uy, ux) };
    }
  }
  if (!best) { const x = p[0] ? p[0][0] : 0, y = p[0] ? p[0][1] : 0; return { cx: x, cy: y, w: 0, h: 0, angle: 0 }; }
  return best;
}
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// ---------- recognition ----------
// One box cut out upright and scaled to REC_H high: the line's own RGBA pixels, bilinear.
export function cropLine(img, box) {
  const ratio = box.w / Math.max(1, box.h);
  const w = Math.max(1, Math.min(REC_MAX_W, Math.ceil(REC_H * ratio)));
  const out = new Float32Array(3 * REC_H * w);
  const ca = Math.cos(box.angle), sa = Math.sin(box.angle);
  const kx = box.w / w, ky = box.h / REC_H, n = REC_H * w;
  for (let y = 0; y < REC_H; y++) {
    const v = (y + 0.5) * ky - box.h / 2;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) * kx - box.w / 2;
      const p = sampleBilinear(img.data, img.width, img.height, box.cx + u * ca - v * sa - 0.5, box.cy + u * sa + v * ca - 0.5);
      const i = y * w + x;
      out[i] = p[2] / 127.5 - 1; out[n + i] = p[1] / 127.5 - 1; out[2 * n + i] = p[0] / 127.5 - 1; // BGR
    }
  }
  return { data: out, w };
}
// Greedy CTC: argmax per step, repeats merged, blanks (0) dropped. Class k is dict[k - 1]; the last
// class is the space.
export function ctcDecode(probs, steps, classes, dict, offset = 0) {
  let text = "", sum = 0, count = 0, prev = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0, bestP = -Infinity;
    const base = offset + t * classes;
    for (let c = 0; c < classes; c++) { const v = probs[base + c]; if (v > bestP) { bestP = v; best = c; } }
    if (best !== 0 && best !== prev) {
      text += best - 1 < dict.length ? dict[best - 1] : " ";
      sum += bestP; count++;
    }
    prev = best;
  }
  return { text, score: count ? sum / count : 0 };
}

// ---------- lines ----------
// Pieces -> the page's text: rows of pieces whose middles share a band, each left to right. A page
// photographed at a slant is grouped along its own slant (the pieces' median angle), so a wide
// form's columns don't trade rows.
export function linesFromWords(words) {
  const slanted = words.filter((w) => typeof w.angle === "number" && w.bw > 2 * w.bh).map((w) => w.angle).sort((a, b) => a - b);
  const theta = slanted.length ? slanted[Math.floor(slanted.length / 2)] : 0;
  const ca = Math.cos(theta), sa = Math.sin(theta);
  const items = words.map((w) => {
    const cx = w.cx ?? w.x + w.w / 2, cy = w.cy ?? w.y + w.h / 2;
    return { text: w.text, u: cx * ca + cy * sa, v: -cx * sa + cy * ca, h: w.bh ?? w.h };
  }).sort((a, b) => a.v - b.v);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.v - it.v) < Math.min(r.h, it.h) * 0.5);
    if (row) { row.items.push(it); row.v = (row.v * (row.items.length - 1) + it.v) / row.items.length; row.h = Math.max(row.h, it.h); }
    else rows.push({ v: it.v, h: it.h, items: [it] });
  }
  rows.sort((a, b) => a.v - b.v);
  return rows.map((r) => r.items.sort((a, b) => a.u - b.u).map((w) => w.text).join("   "));
}

// ---------- one page ----------
export async function readPage(img, { ort, det, rec, dict, detMax = DET_MAX, onProgress = () => {} } = {}) {
  const t0 = now();
  const size = detSize(img.width, img.height, detMax);
  const small = resizeRgba(img, size.w, size.h);
  const detIn = new ort.Tensor("float32", detTensorData(small), [1, 3, size.h, size.w]);
  const detOut = await det.run({ [det.inputNames[0]]: detIn });
  const map = detOut[det.outputNames[0]];
  const boxes = dbBoxes(map.data, size.w, size.h, img.width, img.height);
  disposeAll(detIn, detOut);
  const tDet = now();
  onProgress(0.2);

  // Crops, sorted by shape so a batch pads little; read REC_BATCH at a time.
  const crops = boxes.map((b, i) => ({ i, box: b, ratio: b.w / Math.max(1, b.h) })).sort((a, b) => a.ratio - b.ratio);
  const results = new Array(boxes.length);
  for (let s = 0; s < crops.length; s += REC_BATCH) {
    const batch = crops.slice(s, s + REC_BATCH).map((c) => ({ ...c, crop: cropLine(img, c.box) }));
    const maxW = Math.max(REC_MIN_W, ...batch.map((c) => c.crop.w));
    const W = Math.min(REC_MAX_W, Math.ceil(maxW / 8) * 8);
    const plane = REC_H * W;
    const data = new Float32Array(batch.length * 3 * plane);   // padding is 0, mid-gray after normalizing
    batch.forEach((c, b) => {
      for (let ch = 0; ch < 3; ch++) for (let y = 0; y < REC_H; y++) {
        const from = c.crop.data.subarray(ch * REC_H * c.crop.w + y * c.crop.w, ch * REC_H * c.crop.w + (y + 1) * c.crop.w);
        data.set(from.length > W ? from.subarray(0, W) : from, b * 3 * plane + ch * plane + y * W);
      }
    });
    const recIn = new ort.Tensor("float32", data, [batch.length, 3, REC_H, W]);
    const recOut = await rec.run({ [rec.inputNames[0]]: recIn });
    const out = recOut[rec.outputNames[0]];
    const [, steps, classes] = out.dims;
    const probs = out.data;
    batch.forEach((c, b) => { results[c.i] = ctcDecode(probs, steps, classes, dict, b * steps * classes); });
    disposeAll(recIn, recOut);
    onProgress(0.2 + 0.8 * Math.min(1, (s + batch.length) / crops.length));
  }

  const found = [];
  boxes.forEach((b, i) => {
    const r = results[i];
    if (!r || r.score < DROP_SCORE || !r.text.trim()) return;
    found.push({ text: r.text.trim(), cx: b.cx, cy: b.cy, angle: b.angle, bw: b.w, bh: b.h, box: b, score: r.score });
  });
  const lines = linesFromWords(found);
  const words = found.map(({ text, box: b, score }) => ({ text, x: Math.round(b.x0), y: Math.round(b.y0), w: Math.round(b.x1 - b.x0), h: Math.round(b.y1 - b.y0), score: Math.round(score * 1000) / 1000 }));
  onProgress(1);
  return { text: lines.join("\n"), lines, words, width: img.width, height: img.height,
    ms: { det: Math.round(tDet - t0), rec: Math.round(now() - tDet), total: Math.round(now() - t0) }, boxes: boxes.length };
}
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function disposeAll(...xs) {
  for (const x of xs) {
    if (!x) continue;
    if (typeof x.dispose === "function") { try { x.dispose(); } catch { /* already gone */ } continue; }
    for (const v of Object.values(x)) if (v && typeof v.dispose === "function") { try { v.dispose(); } catch { /* gone */ } }
  }
}

// The dictionary file: one character per line (the recognizer's order). The trailing space class is
// implied by ctcDecode.
export function parseDict(text) {
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => l.replace(/\r$/, ""));
}
