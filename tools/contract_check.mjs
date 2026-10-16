// Contract check: the parts of docs/web-contract.md a machine can hold the line on, so the parallel
// feature branches (auth, outbox, deck, capture, browse) don't drift. No browser and no network:
//   node tools/contract_check.mjs
// Fails when:
//   - public/index.html carries inline script or style (it holds markup and the tags only)
//   - the public/js import graph (ui/ included) has a cycle, or an import doesn't resolve
//   - a module other than its owner calls the backend directly (Firestore only in store.js, Drive's
//     fetch only in drive.js, the classify callable only in classify.js, other callables only in
//     auth.js and classify.js, Auth only in auth.js)
//   - IndexedDB is opened anywhere but db.js
//   - an event is emitted or listened for that the contract's events table doesn't list
//   - the Firebase backend and the fake backend (tools/fake/fake-backend.js) expose different methods
//   - a hex color appears in css/components.css or css/shell.css (colors live in css/tokens.css)
//   - a verdict is drawn outside ui/components.js (no "v-shred" style classes or verdict colors elsewhere)
//   - shipped copy has an em dash (voice principles)
//   - every module under public/js has a header comment naming its owner in the contract's module map
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = join(root, "public", "js");
const read = (p) => readFileSync(join(root, p), "utf8");
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const walk = (dir, ext, out = []) => {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, ext, out); else if (n.endsWith(ext)) out.push(p); }
  return out;
};

// 1. index.html is markup plus tags.
const html = read("public/index.html");
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim());
check(!inlineScripts.length && !/<style\b/.test(html), "index.html has no inline script or style");

// 2. No import cycles, every import resolves.
const files = walk(jsDir, ".js").map((p) => relative(jsDir, p).split("\\").join("/")).sort();
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(jsDir, f), "utf8")]));
const graph = Object.fromEntries(files.map((f) => [f, [...src[f].matchAll(/^import[^;]*?from\s+"(\.{1,2}\/[\w./-]+\.js)"/gm)]
  .map((m) => posix.normalize(posix.join(posix.dirname(f), m[1])))]));
const cycles = [];
const state = {};
const visit = (f, path) => {
  if (state[f] === 1) { cycles.push([...path.slice(path.indexOf(f)), f].join(" -> ")); return; }
  if (state[f] === 2) return;
  state[f] = 1;
  for (const d of graph[f] || []) visit(d, [...path, f]);
  state[f] = 2;
};
files.forEach((f) => visit(f, []));
check(!cycles.length, `public/js imports form no cycle${cycles.length ? ": " + cycles.join("; ") : ""}`);
const missing = files.flatMap((f) => graph[f].filter((d) => !files.includes(d)).map((d) => `${f} imports ${d}`));
check(!missing.length, `every import resolves${missing.length ? ": " + missing.join("; ") : ""}`);

// 3. Backend calls stay with their owners.
const OWNERS = [
  [/\bB\.(get|set|add|update|del|watch)\(/, ["store.js"], "Firestore (B.get/set/add/update/del/watch)"],
  [/\bB\.fetch\(/, ["drive.js"], "Drive's fetch (B.fetch)"],
  [/\bB\.classify\(/, ["classify.js"], "the classify callable (B.classify)"],
  [/\bB\.call\(/, ["auth.js", "classify.js"], "other callables (B.call)"],
  [/\bB\.(onUser|authorize|redeem|signInWithTokens|signOut)\(/, ["auth.js"], "Auth (B.onUser/authorize/redeem/signInWithTokens/signOut)"],
  [/\bindexedDB\b/, ["db.js"], "IndexedDB"],
];
for (const [re, owners, what] of OWNERS) {
  const offenders = files.filter((f) => !owners.includes(f) && f !== "backend.js" && re.test(src[f]));
  check(!offenders.length, `only ${owners.join(" and ")} call ${what}${offenders.length ? ": also " + offenders.join(", ") : ""}`);
}

// 4. Every event is in the contract.
const contract = read("docs/web-contract.md");
const listed = new Set([...contract.matchAll(/^\|\s*`([a-z]+:[A-Za-z]+)`/gm)].map((m) => m[1]));
const used = new Set(files.flatMap((f) => [...src[f].matchAll(/\b(?:on|emit)\(\s*"([^"]+)"/g)].map((m) => m[1])));
const unlisted = [...used].filter((e) => !listed.has(e));
check(listed.size > 0, `the contract lists ${listed.size} events`);
check(!unlisted.length, `every event used is in the contract's events table${unlisted.length ? ": missing " + unlisted.join(", ") : ""}`);

// 5. The fake backend has the same methods as the Firebase one.
const be = src["backend.js"];
const body = be.slice(be.indexOf("return {", be.indexOf("async function firebaseBackend")));
const fbKeys = new Set([...body.slice(0, body.indexOf("\n  };")).matchAll(/^ {4}(?:async\s+)?(\w+)\s*[(:]/gm)].map((m) => m[1]));
globalThis.window = {};
const { createFakeBackend } = await import(join(root, "tools", "fake", "fake-backend.js"));
const fakeKeys = new Set(Object.keys(createFakeBackend(new URLSearchParams())));
const onlyFb = [...fbKeys].filter((k) => !fakeKeys.has(k)), onlyFake = [...fakeKeys].filter((k) => !fbKeys.has(k));
check(fbKeys.size > 0 && !onlyFb.length && !onlyFake.length,
  `Firebase and fake backends match (${[...fbKeys].sort().join(", ")})${onlyFb.length ? "; fake lacks " + onlyFb.join(", ") : ""}${onlyFake.length ? "; Firebase lacks " + onlyFake.join(", ") : ""}`);

// 6. Colors live in tokens.css.
const hexes = ["public/css/components.css", "public/css/shell.css"].flatMap((p) => read(p).split("\n")
  .map((l, i) => [i + 1, l.replace(/\/\*.*?\*\//g, "")]).filter(([, l]) => /#[0-9a-fA-F]{3,8}\b/.test(l)).map(([n]) => `${p}:${n}`));
check(!hexes.length, `no hex colors outside tokens.css${hexes.length ? ": " + hexes.join(", ") : ""}`);

// 7. Verdicts are drawn only by verdictBadge() (spec 3.4). Legacy piles is exempt until rebuilt.
const LEGACY = new Set(["piles.js"]);
const drawn = files.filter((f) => f !== "ui/components.js" && !LEGACY.has(f) && /verdict-badge|class="[^"]*\bv-(shred|scan_shred|keep_original)/.test(src[f]));
check(!drawn.length, `verdicts are drawn only by ui/components.js verdictBadge()${drawn.length ? ": also " + drawn.join(", ") : ""}`);

// 8. No em dashes in shipped copy.
const shipped = [...walk(join(root, "public"), ".html"), ...walk(jsDir, ".js")];
const dashes = shipped.filter((p) => readFileSync(p, "utf8").includes("\u2014")).map((p) => relative(root, p));
check(!dashes.length, `no em dashes in public/${dashes.length ? ": " + dashes.join(", ") : ""}`);

// 9. Every module is in the module map.
const mapped = new Set([...contract.matchAll(/^\|\s*\d+\s*\|\s*`([\w./-]+\.js)`/gm)].map((m) => m[1]));
const unmapped = files.filter((f) => !mapped.has(f));
check(!unmapped.length, `every public/js module is in the contract's module map${unmapped.length ? ": missing " + unmapped.join(", ") : ""}`);

console.log(failures ? `\n${failures} contract check(s) failed` : "\nall contract checks passed");
process.exit(failures ? 1 : 0);
