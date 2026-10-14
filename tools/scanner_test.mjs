// Scanner test: drives Scan document in headless Chromium with a fake rear camera. Chromium plays a
// generated .y4m of a tilted, perspective-skewed sheet of paper on a dark desk as the camera, and the
// page runs against tools/fake/fake-backend.js. Checks that the page's edges are found live, that
// Capture flattens and crops the page (the corners come out as paper and the text lines come out
// level), corner dragging, delete and retake, that Done adds ONE item to the deck that files as one
// multi-page PDF, that Cancel adds nothing, auto-capture fires once per page, the camera stops when the
// scanner closes, and the denied / no camera / unsupported copy. Runs in CI and locally:
//   npm install --no-save playwright@1 && npx playwright install chromium
//   node tools/scanner_test.mjs
// Needs the network: OpenCV.js and jscanify load from jsdelivr, as they do in the app.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/public/index.html?fake=1`;
const shots = join(root, "tools", "smoke");
mkdirSync(shots, { recursive: true });

// ---------- the fake camera: a sheet of paper, tilted and in perspective, on a dark desk ----------
const W = 1280, H = 960;
const QUAD = [{ x: 430, y: 120 }, { x: 900, y: 170 }, { x: 860, y: 880 }, { x: 340, y: 830 }];  // TL TR BR BL
// Ink: a title bar and eleven body lines at fixed heights on the page, so a flattened page can be
// checked for level lines. Line k spans v = 0.22 + 0.06k to 0.24 + 0.06k.
const LINES = [{ v0: 0.09, v1: 0.13, u0: 0.1, u1: 0.62 }, ...Array.from({ length: 11 }, (_, k) => ({ v0: 0.22 + 0.06 * k, v1: 0.24 + 0.06 * k, u0: 0.1, u1: 0.9 - (k % 3) * 0.12 }))];
function squareToQuad([p0, p1, p2, p3]) {
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}
function invert3([a, b, c, d, e, f, g, h, i]) {
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
}
function makeY4m(path) {
  const inv = invert3(squareToQuad(QUAD));
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = inv[6] * x + inv[7] * y + inv[8], u = (inv[0] * x + inv[1] * y + inv[2]) / z, v = (inv[3] * x + inv[4] * y + inv[5]) / z;
    let c;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const ink = LINES.some((l) => v >= l.v0 && v <= l.v1 && u >= l.u0 && u <= l.u1);
      c = ink ? [38, 38, 46] : [246, 244, 238];
    } else {
      // A hard, striped desk grain on purpose: without the blur before detection, its edges join the
      // page's outline and the top corners land on the frame edge.
      const n = ((x * 73856093) ^ (y * 19349663)) % 13 - 6;
      c = [62 + n, 54 + n, 46 + n];
    }
    rgb.set(c, (y * W + x) * 3);
  }
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  for (let i = 0; i < W * H; i++) Y[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const o = ((y + dy) * W + x + dx) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; }
    r /= 4; g /= 4; b /= 4;
    const o = (y / 2) * (W / 2) + x / 2;
    U[o] = Math.round(-0.1687 * r - 0.3313 * g + 0.5 * b + 128);
    V[o] = Math.round(0.5 * r - 0.4187 * g - 0.0813 * b + 128);
  }
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
}
const y4m = join(tmpdir(), `paper-trail-fake-camera-${process.pid}.y4m`);
makeY4m(y4m);

// ---------- harness ----------
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
async function open({ viewport = { width: 1280, height: 900 }, colorScheme = "light", init } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme });
  await ctx.grantPermissions(["camera"]);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  return { ctx, page, problems };
}
const sc = (page, fn, arg) => page.evaluate(fn, arg);
const near = (a, b, tol) => a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) <= tol);
const TOL = 0.03 * Math.hypot(W, H);  // corners within 3% of the frame diagonal
async function waitLive(page) {
  await page.waitForFunction(() => { const s = window.__PT__.scanner; return s.libs === "ready" && s.live && s.view === "camera"; }, null, { timeout: 90000 });
}
async function captureAndReview(page) {
  await page.waitForSelector("#sc-shutter:not([disabled])");
  await page.click("#sc-shutter");
  await page.waitForSelector("#sc-review:not([hidden])");
}
async function keep(page) {
  const n = await sc(page, () => window.__PT__.scanner.pages.length);
  await page.click("#sc-keep");
  await page.waitForFunction((n) => { const s = window.__PT__.scanner; return s.view === "camera" && !s.busy && s.pages.length >= n; }, n, { timeout: 15000 });
}
// Measures a kept page: its size, the four corner patches, and rows across the ink lines.
const measurePage = (page, i) => page.evaluate(async ({ i, lines }) => {
  const p = window.__PT__.scanner.pages[i];
  const bmp = await createImageBitmap(p.blob);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
  const lum = (x0, y0, w, h) => { const d = x.getImageData(Math.round(x0), Math.round(y0), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data; let s = 0; for (let j = 0; j < d.length; j += 4) s += 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; return s / (d.length / 4); };
  const Wd = c.width, Ht = c.height, e = 0.03;
  const corners = [[e, e], [1 - e - 0.02, e], [1 - e - 0.02, 1 - e - 0.02], [e, 1 - e - 0.02]].map(([u, v]) => lum(u * Wd, v * Ht, 0.02 * Wd, 0.02 * Ht));
  const row = (v) => lum(0.15 * Wd, v * Ht, 0.3 * Wd, 2);
  const first = lines[1], last = lines[lines.length - 1];
  return { w: Wd, h: Ht, corners, inkTop: row((first.v0 + first.v1) / 2), gapTop: row(first.v1 + 0.02), inkBottom: row((last.v0 + last.v1) / 2), gapBottom: row(last.v1 + 0.02), bytes: [...new Uint8Array(await p.blob.arrayBuffer())] };
}, { i, lines: LINES });

try {
  // 1. Scan a two-page document, with a corner drag, a delete and a retake on the way.
  {
    const { ctx, page, problems } = await open();
    await page.click("#btn-scan");
    check(await page.isVisible("#scanner"), "Scan document opens the scanner full screen");
    check(/Getting the scanner ready/.test(await page.textContent("#sc-msg")), "it says Getting the scanner ready while OpenCV loads");
    check(await page.evaluate(() => document.getElementById("sc-video").hasAttribute("playsinline")), "the video is playsinline, so iPhone Safari doesn't take it full screen");
    await waitLive(page);
    const cam = await sc(page, () => { const v = document.getElementById("sc-video"), s = window.__PT__.scanner; return { w: v.videoWidth, h: v.videoHeight, live: s.live, facing: s.stream.getVideoTracks()[0].getSettings() }; });
    check(cam.w === W && cam.h === H, `the fake rear camera is streaming (${cam.w}x${cam.h})`);
    check(near(cam.live, QUAD, TOL), "the page's edges are found live, all four corners within 3% of the frame diagonal");
    check(/Page found/.test(await page.textContent("#sc-msg")), "it says Page found");
    const outline = await page.evaluate(() => { const c = document.getElementById("sc-overlay"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    check(outline > 1000, "the outline is drawn over the video");
    await page.screenshot({ path: join(shots, "scanner-live-desktop.png") });

    // Page 1: capture, check the review, keep it as found.
    await captureAndReview(page);
    const rev = await sc(page, () => { const r = window.__PT__.scanner.review; return { found: r.found, corners: r.corners, w: r.canvas.width }; });
    check(rev.found && near(rev.corners, QUAD, TOL), `Capture finds the page again on the full-resolution still (${rev.corners.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ")})`);
    check(await page.isVisible(".sc-handle[data-corner='0']") && (await page.$$(".sc-handle:not([hidden])")).length === 4, "the review shows four corner handles");
    await page.waitForTimeout(500);  // let the capture flash fade
    await page.screenshot({ path: join(shots, "scanner-review-desktop.png") });
    await keep(page);
    const m1 = await measurePage(page, 0);
    check(Math.min(m1.w, m1.h) === 1700, `the flattened page is 1700 px on the short side (${m1.w}x${m1.h})`);
    check(m1.h > m1.w, "the flattened page is upright (portrait)");
    check(m1.corners.every((l) => l > 200), `the page is cropped to the paper: all four corners are white (${m1.corners.map(Math.round).join(", ")})`);
    check(m1.inkTop < 110 && m1.gapTop > 200 && m1.inkBottom < 110 && m1.gapBottom > 200,
      `the perspective is flattened: the first and last text lines come out level (ink ${Math.round(m1.inkTop)} / ${Math.round(m1.inkBottom)}, gaps ${Math.round(m1.gapTop)} / ${Math.round(m1.gapBottom)})`);
    check(m1.bytes[0] === 0xff && m1.bytes[1] === 0xd8, "the page is a JPEG");
    check((await page.$$(".sc-thumb")).length === 1 && (await page.textContent("#sc-count")).trim() === "1 page", "page 1 shows in the strip");

    // Page 2: drag the top left corner, nudge it with the keyboard, keep it.
    await captureAndReview(page);
    const h0 = await page.$(".sc-handle[data-corner='0']");
    const b = await h0.boundingBox();
    const before = await sc(page, () => ({ ...window.__PT__.scanner.review.corners[0] }));
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    const dragged = await sc(page, () => ({ ...window.__PT__.scanner.review.corners[0] }));
    check(dragged.x > before.x + 20 && dragged.y > before.y + 15, "a corner handle drags");
    await page.focus(".sc-handle[data-corner='0']");
    await page.keyboard.press("ArrowLeft");
    const nudged = await sc(page, () => ({ ...window.__PT__.scanner.review.corners[0] }));
    check(nudged.x < dragged.x, "arrow keys move a focused corner");
    await keep(page);

    // Page 3: keep it in Color, then delete it from the strip.
    await captureAndReview(page);
    await page.click(".seg [data-mode=color]");
    check(await sc(page, () => window.__PT__.scanner.review.mode) === "color", "Color / Document switches the page style");
    await keep(page);
    check(await sc(page, () => window.__PT__.scanner.pages.length) === 3, "three pages kept");
    await page.click(".sc-thumb[data-page='2']");
    await page.waitForSelector("#sc-delete:not([hidden])");
    await page.click("#sc-delete");
    await page.waitForFunction(() => window.__PT__.scanner.view === "camera");
    check(await sc(page, () => window.__PT__.scanner.pages.length) === 2, "Delete removes a page");

    // Retake page 1 from the strip.
    const oldFirst = await sc(page, () => window.__PT__.scanner.pages[0].thumb);
    await page.click(".sc-thumb[data-page='0']");
    await page.waitForSelector("#sc-delete:not([hidden])");
    await page.click("#sc-retake");
    await page.waitForFunction(() => window.__PT__.scanner.view === "camera");
    await page.waitForFunction(() => /Retaking page 1/.test(document.getElementById("sc-msg").textContent), null, { timeout: 10000 });
    check(true, "Retake goes back to the camera and says which page");
    await captureAndReview(page);
    check((await page.textContent("#sc-keep")).trim() === "Use this page", "a retake's review offers Use this page");
    await keep(page);
    const after = await sc(page, () => ({ n: window.__PT__.scanner.pages.length, first: window.__PT__.scanner.pages[0].thumb }));
    check(after.n === 2 && after.first !== oldFirst, "the retake replaces page 1, still two pages");

    // Done: one item, two pages, filed as one PDF.
    const pageBytes = (await measurePage(page, 1)).bytes;
    await sc(page, () => { window.__tracks = window.__PT__.scanner.stream.getTracks(); });
    const itemsBefore = await sc(page, () => window.__PT__.items().length);
    await page.click("#sc-done");
    await page.waitForSelector("#scanner", { state: "hidden" });
    const added = await sc(page, () => window.__PT__.items().map((i) => ({ name: i.name, files: i.files.length, kind: i.kind })));
    check(itemsBefore === 0 && added.length === 1 && added[0].files === 2 && added[0].kind === "photos", "Done adds ONE item to the deck, with both pages");
    check(added[0]?.name === "Scan, 2 pages", "it's named Scan, 2 pages until Claude reads it");
    check(await sc(page, () => window.__tracks.every((t) => t.readyState === "ended") && !window.__PT__.scanner.stream), "closing the scanner stops the camera");
    check(await page.evaluate(() => document.activeElement?.id) === "btn-scan", "focus goes back to Scan document");
    await page.waitForSelector(".card.top .stamp", { timeout: 20000 });
    const call = await sc(page, () => window.__PT_FAKE__.classifyCalls[0]);
    check(call?.kind === "images" && call.images.length === 2, "Claude gets both scanned pages");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.__PT_FAKE__.files.length === 1, null, { timeout: 20000 });
    const pdf = Buffer.from(await sc(page, () => [...window.__PT_FAKE__.files[0].bytes]));
    const text = pdf.toString("latin1");
    check(text.startsWith("%PDF") && (text.match(/\/Type \/Page\b/g) || []).length === 2, "the scan files to Drive as one two-page PDF");
    check(pdf.includes(Buffer.from(pageBytes)), "the flattened page JPEG is inside the PDF untouched");

    // Cancel: scan a page, cancel, nothing joins the deck.
    await page.click("#btn-scan");
    await waitLive(page);
    await captureAndReview(page);
    await keep(page);
    await sc(page, () => { window.__tracks = window.__PT__.scanner.stream.getTracks(); });
    await page.click("#sc-cancel");  // the discard question is accepted
    await page.waitForSelector("#scanner", { state: "hidden" });
    check(await sc(page, () => window.__PT__.items().length) === 1, "Cancel discards the scan: nothing new joins the deck");
    check(await sc(page, () => window.__tracks.every((t) => t.readyState === "ended")), "Cancel stops the camera");

    // Auto-capture: fires once when the page holds still, then waits for the next page.
    await page.click("#btn-scan");
    await waitLive(page);
    await page.click("#sc-auto");
    check(await page.getAttribute("#sc-auto", "aria-pressed") === "true", "Auto-capture turns on");
    await page.waitForFunction(() => window.__PT__.scanner.pages.length === 1, null, { timeout: 15000 }).then(() => check(true, "auto-capture keeps a page once it holds steady"), () => check(false, "auto-capture keeps a page once it holds steady"));
    await page.waitForTimeout(3500);
    check(await sc(page, () => window.__PT__.scanner.pages.length) === 1, "auto-capture doesn't keep the same page twice");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#scanner", { state: "hidden" });
    check(await sc(page, () => window.__PT__.items().length) === 1, "Escape cancels the scanner");
    check(problems.length === 0, `no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 2. Phone width, dark theme: the scanner fits with no sideways scroll.
  {
    const { ctx, page, problems } = await open({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    await page.screenshot({ path: join(shots, "scanner-intake-phone-dark.png") });
    await page.click("#btn-scan");
    await waitLive(page);
    const fitOk = await page.evaluate(() => {
      const inView = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
      return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, shutter: inView("sc-shutter"), done: inView("sc-done"), cancel: inView("sc-cancel"), auto: inView("sc-auto") };
    });
    check(fitOk.over <= 1 && fitOk.shutter && fitOk.done && fitOk.cancel && fitOk.auto, "at 390px every scanner control is on screen, no sideways scroll");
    await page.screenshot({ path: join(shots, "scanner-live-phone-dark.png") });
    await captureAndReview(page);
    const revFit = await page.evaluate(() => [...document.querySelectorAll(".sc-handle"), document.getElementById("sc-keep"), document.getElementById("sc-retake")].every((el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }));
    check(revFit, "at 390px the review's handles and buttons are on screen");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, "scanner-review-phone-dark.png") });
    check(problems.length === 0, `no console errors at 390px (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }

  // 3. The camera refused, missing, or not available: clear copy, and Choose documents still works.
  const reject = (name) => `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("test", ${JSON.stringify(name)}));`;
  for (const [what, init, heading, retry] of [
    ["denied permission", reject("NotAllowedError"), "Camera access is off", true],
    ["no camera", reject("NotFoundError"), "No camera found", false],
    ["no camera API", "Object.defineProperty(navigator, 'mediaDevices', { value: undefined });", "This browser can't use the camera", false],
  ]) {
    const { ctx, page, problems } = await open({ init });
    await page.click("#btn-scan");
    await page.waitForSelector("#sc-error:not([hidden])");
    check((await page.textContent("#sc-err-h")).trim() === heading && (await page.isVisible("#sc-retry")) === retry, `${what}: "${heading}"${retry ? " with Try again" : ""}`);
    if (what === "denied permission") await page.screenshot({ path: join(shots, "scanner-denied-desktop.png") });
    const chooser = page.waitForEvent("filechooser", { timeout: 5000 }).then(() => true, () => false);
    await page.click("#sc-pick");
    check(await chooser && await page.isHidden("#scanner"), `${what}: Choose documents instead closes the scanner and opens the file picker`);
    check(problems.length === 0, `${what}: no console errors (${problems.join(" | ") || "none"})`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.log("FAIL the test stopped:", e.message.split("\n")[0]);
}

await browser.close(); server.close();
rmSync(y4m, { force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall scanner checks passed");
process.exit(failures ? 1 : 0);
