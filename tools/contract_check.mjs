// Contract check: the parts of docs/v2-contract.md a machine can hold the line on, so parallel
// feature branches don't drift. Runs in CI and locally, no browser and no network:
//   node tools/contract_check.mjs
// Fails when:
//   - public/index.html carries inline script or style (it holds markup and the tags only)
//   - the public/js import graph has a cycle (lower layers talk upward with events, not imports)
//   - a module other than its owner calls the backend directly (Firestore only in store.js, Drive's
//     fetch only in drive.js, the callable only in classify.js, Auth only in auth.js)
//   - an event is emitted or listened for that the contract's events table doesn't list
//   - the Firebase backend and the fake backend (tools/fake/fake-backend.js) expose different methods
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = join(root, "public", "js");
const read = (p) => readFileSync(join(root, p), "utf8");
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };

// 1. index.html is markup plus tags.
const html = read("public/index.html");
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim());
check(!inlineScripts.length && !/<style\b/.test(html), "index.html has no inline script or style");

// 2. No import cycles.
const files = readdirSync(jsDir).filter((f) => f.endsWith(".js")).sort();
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(jsDir, f), "utf8")]));
const graph = Object.fromEntries(files.map((f) => [f, [...src[f].matchAll(/^import[^;]*?from\s+"\.\/([\w-]+\.js)"/gm)].map((m) => m[1])]));
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
  [/\bB\.(get|set|add|update|del|watch)\(/, "store.js", "Firestore (B.get/set/add/update/del/watch)"],
  [/\bB\.fetch\(/, "drive.js", "Drive's fetch (B.fetch)"],
  [/\bB\.classify\(/, "classify.js", "the classify callable (B.classify)"],
  [/\bB\.(onUser|signIn|reconnect|signOut)\(/, "auth.js", "Auth (B.onUser/signIn/reconnect/signOut)"],
];
for (const [re, owner, what] of OWNERS) {
  const offenders = files.filter((f) => f !== owner && f !== "backend.js" && re.test(src[f]));
  check(!offenders.length, `only ${owner} calls ${what}${offenders.length ? ": also " + offenders.join(", ") : ""}`);
}

// 4. Every event is in the contract.
const contract = read("docs/v2-contract.md");
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

console.log(failures ? `\n${failures} contract check(s) failed` : "\nall contract checks passed");
process.exit(failures ? 1 : 0);
