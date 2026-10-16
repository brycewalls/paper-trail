// The in-page half of tools/lab/ocr-bench.mjs (#101): window.bench draws a synthetic page and reads it
// with either engine. Pages are letter size at 150 dpi (1275 x 1650), drawn in a proportional font.
//   bench.draw(text, variant, seed) -> { blob, width, height }
//     variants: clean, skew (3 degrees), blur, low-contrast (faded gray print on gray paper),
//     photo (keystone perspective, a 2 degree turn, a table around the page, uneven light, sensor
//     noise and JPEG at 0.8, at a phone camera's 1512 x 2016)
//   bench.startPaddle(backend, detMax) -> { backend, loadMs }   bench.paddle(blob) -> { text, ms }
//   bench.startTesseract() -> { loadMs }                bench.tesseract(blob) -> { text, ms }
// Tesseract's versions and data match media.js (TESSERACT, langPath), so the comparison is the
// fallback the lab really has.

const W = 1275, H = 1650, MARGIN = 96;
const TESSERACT = { version: "5.1.1", core: "5.1.1" };

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

function drawText(text, { fg = "#151515", bg = "#ffffff" } = {}) {
  const c = canvas(W, H), x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  let size = 22, lines;
  for (;;) {
    x.font = `${size}px Arial, Helvetica, sans-serif`;
    lines = [];
    for (const raw of String(text).split("\n")) {
      let line = "";
      for (const word of raw.split(/(\s+)/)) {
        const next = line + word;
        if (line && x.measureText(next).width > W - 2 * MARGIN) { lines.push(line); line = word.trimStart(); }
        else line = next;
      }
      lines.push(line);
    }
    if (lines.length * size * 1.45 <= H - 2 * MARGIN || size <= 14) break;
    size -= 1;
  }
  x.fillStyle = fg; x.textBaseline = "top";
  lines.forEach((l, i) => x.fillText(l, MARGIN, MARGIN + i * size * 1.45));
  return c;
}

function skew(page, deg) {
  const c = canvas(W, H), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  x.translate(W / 2, H / 2); x.rotate((deg * Math.PI) / 180); x.drawImage(page, -W / 2, -H / 2);
  return c;
}
function blur(page, px) {
  const c = canvas(page.width, page.height), x = c.getContext("2d");
  x.filter = `blur(${px}px)`; x.drawImage(page, 0, 0);
  return c;
}
function noise(c, sigma, r) {
  const x = c.getContext("2d");
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = ((r() + r() + r() - 1.5) / 1.5) * sigma * 1.7;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}
function photo(page, r) {
  const OW = 1512, OH = 2016;
  const c = canvas(OW, OH), x = c.getContext("2d");
  const table = x.createLinearGradient(0, 0, OW, OH);
  table.addColorStop(0, "#5d4c3c"); table.addColorStop(1, "#3f3227");
  x.fillStyle = table; x.fillRect(0, 0, OW, OH);
  // Keystone: the top of the page is farther from the camera, so narrower.
  const top = OH * 0.06, qh = OH * 0.86, topW = OW * 0.78, botW = OW * 0.9;
  const strip = canvas(OW, OH), sx = strip.getContext("2d");
  for (let y = 0; y < qh; y++) {
    const t = y / qh, w = topW + (botW - topW) * t;
    const srcY = Math.pow(t, 1.08) * H;   // rows bunch up a little toward the far edge
    sx.drawImage(page, 0, srcY, W, Math.max(1, H / qh), (OW - w) / 2, top + y, w, 1);
  }
  x.save(); x.translate(OW / 2, OH / 2); x.rotate((2 * Math.PI) / 180); x.drawImage(strip, -OW / 2, -OH / 2); x.restore();
  // Uneven light: brighter near the top left, a shadow toward the bottom right.
  const light = x.createRadialGradient(OW * 0.3, OH * 0.2, OW * 0.1, OW * 0.5, OH * 0.6, OW * 1.1);
  light.addColorStop(0, "rgba(255,255,255,1)"); light.addColorStop(1, "rgba(150,140,130,1)");
  x.globalCompositeOperation = "multiply"; x.fillStyle = light; x.fillRect(0, 0, OW, OH);
  x.globalCompositeOperation = "source-over";
  noise(c, 9, r);
  return blur(c, 0.7);
}

function toBlob(c, q) { return new Promise((res) => c.toBlob(res, "image/jpeg", q)); }

window.bench = {
  async draw(text, variant, seed = 1) {
    const r = rng(seed);
    let c;
    if (variant === "low-contrast") c = blur(drawText(text, { fg: "#8f8f8f", bg: "#d9d6cf" }), 0.5);
    else {
      const page = drawText(text);
      if (variant === "skew") c = skew(page, 3);
      else if (variant === "blur") c = blur(page, 1.6);
      else if (variant === "photo") c = photo(page, r);
      else c = page;
    }
    const blob = await toBlob(c, variant === "photo" ? 0.8 : 0.92);
    return { blob, width: c.width, height: c.height };
  },

  // ---------- PaddleOCR: the lab's worker, as is ----------
  worker: null, nextId: 1,
  async startPaddle(backend = "wasm", detMax = 0) {
    const t = performance.now();
    this.worker = new Worker(new URL("../../public/js/lab/ocr-worker.js", location.href), { type: "module" });
    const ready = await new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === "ready") resolve(e.data);
        else if (e.data.type === "failed") reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => reject(new Error(e.message || "worker error"));
      this.worker.postMessage({ type: "init", backend, detMax: detMax || undefined, models: new URL("../../public/lab-models/pp-ocrv5-mobile/", location.href).href });
    });
    return { backend: ready.backend, loadMs: Math.round(performance.now() - t) };
  },
  paddle(blob) {
    const id = this.nextId++, t = performance.now();
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === "result") resolve({ text: m.result.text, ms: Math.round(performance.now() - t), inner: m.result.ms, boxes: m.result.boxes });
        else if (m.type === "error") reject(new Error(m.error));
      };
      this.worker.postMessage({ type: "image", id, blob, turns: 0, edge: 2400 }); // lab/ocr.js IMAGE_EDGE
    });
  },

  // ---------- Tesseract.js: media.js's fallback, same versions ----------
  tess: null,
  async startTesseract() {
    const t = performance.now();
    if (!window.Tesseract) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = `https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/${TESSERACT.version}/tesseract.min.js`;
        s.crossOrigin = "anonymous"; s.onload = res; s.onerror = () => rej(new Error("Tesseract didn't load"));
        document.head.append(s);
      });
    }
    this.tess = await window.Tesseract.createWorker("eng", 1, {
      workerPath: `https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/${TESSERACT.version}/worker.min.js`,
      corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT.core}`,
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
    });
    return { loadMs: Math.round(performance.now() - t) };
  },
  async tesseract(blob) {
    const t = performance.now();
    const { data } = await this.tess.recognize(blob);
    return { text: String(data.text || "").replace(/[ \t]+/g, " ").trim(), ms: Math.round(performance.now() - t) };
  },
};
