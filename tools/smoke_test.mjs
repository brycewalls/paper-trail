// Smoke test for a static site: open every HTML page in headless Chromium at a desktop and
// a phone width, and fail on anything a visitor would hit. Runs in CI and locally:
//   node tools/smoke_test.mjs            # every .html under the repo
//   node tools/smoke_test.mjs index.html tools.html
// Fails on: console errors, uncaught page errors, requests that 4xx/5xx or never load,
// and horizontal overflow (the page is wider than the viewport). Screenshots go to tools/smoke/.
// Pages that are not meant to load on their own (a build template, a fragment) go in
// tools/smoke.ignore, one path or folder prefix per line, relative to the repo root.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';

const root = resolve(process.argv[1], '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '_archive', '_Archive', '_to_delete', 'tools']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon' };
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }];

function findPages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findPages(p, out);
    else if (extname(name) === '.html') out.push(relative(root, p));
  }
  return out.sort();
}

const ignoreFile = join(root, 'tools', 'smoke.ignore');
const ignores = existsSync(ignoreFile)
  ? readFileSync(ignoreFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  : [];
const ignored = p => ignores.some(i => p === i || p.startsWith(i.replace(/\/?$/, '/')));
const pages = (process.argv.length > 2 ? process.argv.slice(2) : findPages(root)).filter(p => !ignored(p));
if (ignores.length) console.log(`ignoring ${ignores.join(', ')} (tools/smoke.ignore)`);
if (!pages.length) { console.log('no .html pages found, nothing to test'); process.exit(0); }

// A tiny static server so pages load over http (file:// blocks fetch and some module scripts).
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(root, path === '/' ? '/index.html' : path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const outDir = join(root, 'tools', 'smoke'); mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
let failures = 0;

for (const page of pages) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const tab = await ctx.newPage();
    const problems = [];
    tab.on('console', m => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
    tab.on('pageerror', e => problems.push(`page error: ${e.message}`));
    tab.on('requestfailed', r => { if (!r.url().startsWith('data:')) problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`); });
    tab.on('response', r => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    try {
      await tab.goto(base + page.split('/').map(encodeURIComponent).join('/'), { waitUntil: 'networkidle', timeout: 30000 });
      await tab.waitForTimeout(1000); // let entrance animations settle
      const over = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) problems.push(`horizontal overflow: page is ${over}px wider than the ${vp.width}px viewport`);
      await tab.screenshot({ path: join(outDir, `${page.replace(/[\/\\]/g, '__').replace(/\.html$/, '')}-${vp.name}.png`), fullPage: true });
    } catch (e) {
      problems.push(`could not load: ${e.message.split('\n')[0]}`);
    }
    const seen = [...new Set(problems)];
    if (seen.length) { failures++; console.log(`FAIL ${page} @ ${vp.name}`); seen.forEach(p => console.log(`     ${p}`)); }
    else console.log(`ok   ${page} @ ${vp.name}`);
    await ctx.close();
  }
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} page/viewport combination(s) failed` : `\nall ${pages.length} page(s) pass at ${VIEWPORTS.length} widths`);
process.exit(failures ? 1 : 0);
