// Runs firebase/firestore.rules through the Firebase Rules test API (projects.test: a dry run of the
// rules text against made-up requests; nothing is read from or written to the database) and fails
// when a verdict differs from what the page needs. Same approach as the Hair Growth Tracker's check.
// deploy.sh runs this before the rules deploy. Needs the Firebase CLI, logged in (firebase login).
//   node tools/rules-check.mjs
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "paper-trail-bw", OWNER = "bryce.evan.walls@gmail.com";

// The CLI's own login: its refresh token, turned into an access token by its auth module.
function cliDir() {
  const bin = execFileSync("sh", ["-c", "command -v firebase"], { encoding: "utf8" }).trim();
  for (let d = dirname(realpathSync(bin)); d !== dirname(d); d = dirname(d)) {
    const pj = join(d, "package.json");
    if (existsSync(pj) && JSON.parse(readFileSync(pj, "utf8")).name === "firebase-tools") return d;
  }
  throw new Error("firebase-tools not found next to " + bin);
}
async function accessToken() {
  const authJs = join(cliDir(), "lib", "auth.js");
  const auth = createRequire(authJs)(authJs);
  const cfgPath = join(homedir(), ".config", "configstore", "firebase-tools.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const rt = cfg.tokens && cfg.tokens.refresh_token;
  if (!rt) throw new Error("the Firebase CLI is not logged in (run firebase login)");
  return (await auth.getAccessToken(rt, [])).access_token;
}

const uid = "owner_uid";
const owner = { uid, token: { email: OWNER, email_verified: true } };
const ownerCaps = { uid, token: { email: "Bryce.Evan.Walls@gmail.com", email_verified: true } };
const stranger = { uid: "other_uid", token: { email: "someone@example.com", email_verified: true } };
const strangerOwnTree = { uid: "other_uid", token: { email: "someone@example.com", email_verified: true } };
const unverified = { uid, token: { email: OWNER, email_verified: false } };
const fp = (p) => `/databases/(default)/documents/${p}`;
const doc = `users/${uid}/docs/d1`;
const CASES = [
  ["owner reads a doc", { auth: owner, path: fp(doc), method: "get" }, "ALLOW"],
  ["owner lists docs", { auth: owner, path: fp(`users/${uid}/docs`), method: "list" }, "ALLOW"],
  ["owner adds a doc", { auth: owner, path: fp(doc), method: "create", resource: { data: { title: "x" } } }, "ALLOW"],
  ["owner updates a doc", { auth: owner, path: fp(doc), method: "update", resource: { data: { physical: "shredded" } } }, "ALLOW"],
  ["owner deletes a doc", { auth: owner, path: fp(doc), method: "delete" }, "ALLOW"],
  ["owner writes paperless", { auth: owner, path: fp(`users/${uid}/paperless/duke-energy`), method: "create", resource: { data: { status: "todo" } } }, "ALLOW"],
  ["owner reads the Drive folder cache", { auth: owner, path: fp(`users/${uid}/config/drive`), method: "get" }, "ALLOW"],
  ["owner email in other capitals", { auth: ownerCaps, path: fp(doc), method: "get" }, "ALLOW"],
  ["another account reads the owner's doc", { auth: stranger, path: fp(doc), method: "get" }, "DENY"],
  ["another account writes its own subtree", { auth: strangerOwnTree, path: fp("users/other_uid/docs/d1"), method: "create", resource: { data: { title: "x" } } }, "DENY"],
  ["another account reads its own config (the private-screen probe)", { auth: strangerOwnTree, path: fp("users/other_uid/config/drive"), method: "get" }, "DENY"],
  ["unverified owner address writes", { auth: unverified, path: fp(doc), method: "create", resource: { data: { title: "x" } } }, "DENY"],
  ["owner reads another uid's tree", { auth: owner, path: fp("users/other_uid/docs/d1"), method: "get" }, "DENY"],
  ["outside users/", { auth: owner, path: fp("public/x"), method: "get" }, "DENY"],
  // Reserved for v2 (docs/v2-contract.md): these hold with today's rules and must keep holding.
  ["owner writes a sender rule (#21)", { auth: owner, path: fp(`users/${uid}/senders/duke-energy`), method: "create", resource: { data: { folder: "06 Home" } } }, "ALLOW"],
  ["owner writes a doc's full text (#22)", { auth: owner, path: fp(`${doc}/text/0`), method: "create", resource: { data: { text: "x" } } }, "ALLOW"],
  ["owner reads the server-only Drive auth (#15)", { auth: owner, path: fp(`driveAuth/${uid}`), method: "get" }, "DENY"],
  ["owner writes the server-only Drive auth (#15)", { auth: owner, path: fp(`driveAuth/${uid}`), method: "create", resource: { data: { refreshToken: "x" } } }, "DENY"],
  ["signed out", { path: fp(doc), method: "get" }, "DENY"],
  ["owner reads a Drive refresh token", { auth: owner, path: fp("oauthTokens/google_sub"), method: "get" }, "DENY"],
  ["owner lists the Drive refresh tokens", { auth: owner, path: fp("oauthTokens"), method: "list" }, "DENY"],
  ["owner writes a Drive refresh token", { auth: owner, path: fp("oauthTokens/google_sub"), method: "create", resource: { data: { refreshToken: "x" } } }, "DENY"],
  ["owner reads a sign-in handoff", { auth: owner, path: fp("oauthHandoffs/h1"), method: "get" }, "DENY"],
  ["owner lists the sign-in handoffs", { auth: owner, path: fp("oauthHandoffs"), method: "list" }, "DENY"],
  ["signed out reads a sign-in handoff", { path: fp("oauthHandoffs/h1"), method: "get" }, "DENY"],
];

try {
  const token = await accessToken();
  const body = { source: { files: [{ name: "firestore.rules", content: readFileSync(join(repo, "firebase", "firestore.rules"), "utf8") }] },
    testSuite: { testCases: CASES.map(([, request, expectation]) => ({ request, expectation })) } };
  const r = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "x-goog-user-project": PROJECT }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Rules test API ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  if (j.issues && j.issues.some((i) => i.severity === "ERROR")) throw new Error(`firestore.rules does not compile: ${JSON.stringify(j.issues)}`);
  let bad = 0;
  (j.testResults || []).forEach((t, i) => {
    const ok = t.state === "SUCCESS";
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${CASES[i][0]} -> ${CASES[i][2]}${ok ? "" : `  (${(t.debugMessages || []).join("; ") || t.state})`}`);
  });
  console.log(bad ? `\n${bad} rules check(s) failed` : "\nrules checks passed");
  process.exit(bad ? 1 : 0);
} catch (e) {
  console.error("rules check could not run:", e.message);
  process.exit(2);
}
