// Builds every app icon in public/ from one drawing: three piles of paper (Shred, Scan + shred,
// Keep original), each topped with its stamp color, on dark ink. Issue #10, direction C.
//   node tools/make_icons.mjs
// Change the art in ART below, then rerun. Needs Playwright's Chromium (see the README's Tests line).
import { writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");

const INK = "#16202b";   // the app's --ink token, the tile ground
const PAPER = "#e6ebf0"; // dark theme --ink, the sheets
// Stamp colors from the dark theme, so they stay bright on the dark tile.
const SHRED = "#ff8a7f", SCAN = "#8fa8ff", KEEP = "#f2c05a";

// The drawing, in a 100 by 100 box, centered on (50, 50).
const ART = `
  <g fill="${PAPER}">
    <rect x="22" y="53.5" width="16" height="16" rx="1.5"/>
    <rect x="42" y="35.5" width="16" height="34" rx="1.5"/>
    <rect x="62" y="44.5" width="16" height="25" rx="1.5"/>
  </g>
  <g stroke="${INK}" stroke-width="1.6">
    <path d="M22 59.5h16M22 64.5h16"/>
    <path d="M42 41.5h16M42 47.5h16M42 53.5h16M42 59.5h16M42 64.5h16"/>
    <path d="M62 50.5h16M62 55.5h16M62 60.5h16M62 65h16"/>
  </g>
  <rect x="21" y="45.5" width="18" height="8" rx="1.5" fill="${SHRED}" transform="rotate(-6 30 49.5)"/>
  <rect x="41" y="25.5" width="18" height="9" rx="1.5" fill="${SCAN}" transform="rotate(5 50 30)"/>
  <rect x="61" y="35.5" width="18" height="8" rx="1.5" fill="${KEEP}" transform="rotate(-3 70 39.5)"/>
  <path d="M19 73.5h62" stroke="${PAPER}" stroke-width="3" stroke-linecap="round"/>`;

const art = (scale) => `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${ART}</g>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>\n`;

// Rounded tile with transparent corners: browser tabs and the "any" manifest icons. Art scaled up
// so it still reads at 16px.
const tile = svg(`<rect width="100" height="100" rx="22" fill="${INK}"/>${art(1.18)}`);
// Opaque, full bleed: iOS rounds the corners itself and turns transparency black.
const apple = svg(`<rect width="100" height="100" fill="${INK}"/>${art(1.12)}`);
// Maskable: full bleed, art inside the central 80% circle so any Android mask keeps all of it.
const maskable = svg(`<rect width="100" height="100" fill="${INK}"/>${art(0.92)}`);

writeFileSync(join(out, "favicon.svg"), tile);

const pngs = [
  ["favicon-32.png", tile, 32],
  ["apple-touch-icon.png", apple, 180],
  ["icon-192.png", tile, 192],
  ["icon-512.png", tile, 512],
  ["icon-maskable-192.png", maskable, 192],
  ["icon-maskable-512.png", maskable, 512],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, source, size] of pngs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}">`);
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  await page.screenshot({ path: join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`public/${name}  ${size}px`);
}
await browser.close();
console.log("public/favicon.svg");
