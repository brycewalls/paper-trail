// Unit tests for the iPhone app's sign-in and Drive token functions (oauth.js): the callback's code
// exchange, allowlist and handoff, the one-time redeem, and driveToken's refresh and revoke paths.
// Google's token endpoint and Firestore are stood in, so nothing leaves the machine.
// Run: node --test functions/test/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const OWNER = "owner@example.test";
process.env.ALLOWED_EMAILS = OWNER;
process.env.GCLOUD_PROJECT = "demo-test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "web-client.apps.googleusercontent.com";
const oauth = require("../oauth.js");
const fns = require("../index.js");

const CLIENT_ID = "web-client.apps.googleusercontent.com";
const NOW = new Date("2026-10-13T12:00:00Z");
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const VERIFIER = b64url(crypto.randomBytes(32));
const CHALLENGE = b64url(crypto.createHash("sha256").update(VERIFIER).digest());
const STATE = `${b64url(crypto.randomBytes(16))}.${CHALLENGE}`;
const idToken = (claims) => `${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(JSON.stringify(claims))}.sig`;
const OWNER_CLAIMS = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "g-123", email: OWNER, email_verified: true, name: "Owner Person" };
const ALL_SCOPES = `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile ${oauth.DRIVE_SCOPE}`;

// Stand-ins: Google's token endpoint answers whatever `google` holds; Firestore is two maps.
let google, calls, tokens, handoffs, deps;
beforeEach(() => {
  calls = [];
  tokens = new Map();
  handoffs = new Map();
  google = { status: 200, json: { id_token: idToken(OWNER_CLAIMS), access_token: "ya29.access", expires_in: 3599, refresh_token: "1//refresh", scope: ALL_SCOPES } };
  deps = {
    fetch: async (url, init) => {
      calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
      return { ok: google.status < 400, status: google.status, json: async () => google.json };
    },
    store: {
      async getToken(sub) { return tokens.get(sub) || null; },
      async setToken(sub, data) { tokens.set(sub, { ...(tokens.get(sub) || {}), ...data }); },
      async updateToken(sub, data) { tokens.set(sub, { ...(tokens.get(sub) || {}), ...data }); },
      async createHandoff(id, data) { assert.ok(!handoffs.has(id)); handoffs.set(id, data); },
      async takeHandoff(id) { const d = handoffs.get(id) || null; handoffs.delete(id); return d; },
    },
    config: () => ({ clientId: CLIENT_ID, clientSecret: "test-secret", redirectUri: "https://paper-trail-bw.web.app/oauth/callback" }),
    allowlist: () => [OWNER],
    now: () => NOW,
    log: () => {},
  };
});

const params = (location) => {
  assert.ok(location.startsWith("papertrail://auth?"), location);
  return Object.fromEntries(new URL(location).searchParams);
};
const signedIn = (email = OWNER, sub = "g-123", verified = true) => ({ auth: { uid: "fb-uid", token: { email, email_verified: verified, firebase: { identities: { "google.com": [sub] } } } } });
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => { assert.equal(e.code, code); return true; });
}

// ---------- state and helpers ----------
test("parseState takes nonce.challenge and nothing else", () => {
  assert.deepEqual(oauth.parseState(STATE), { nonce: STATE.split(".")[0], challenge: CHALLENGE });
  for (const bad of [undefined, "", "abc", `short.${CHALLENGE}`, `${"a".repeat(20)}.tooShort`, `${"a".repeat(20)}.${CHALLENGE}&x=1`]) assert.equal(oauth.parseState(bad), null, String(bad));
});

test("challengeFor is base64url SHA-256, the same as the app's", () => {
  assert.equal(oauth.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("decodeIdToken reads the payload and tolerates junk", () => {
  assert.equal(oauth.decodeIdToken(idToken(OWNER_CLAIMS)).sub, "g-123");
  assert.equal(oauth.decodeIdToken("nope"), null);
  assert.equal(oauth.decodeIdToken("a.!!!.c"), null);
});

// ---------- oauthCallback ----------
test("callback: exchanges the code, keeps the refresh token server side, hands off the rest", async () => {
  const out = await oauth.oauthCallback({ code: "4/code", state: STATE }, deps);
  assert.equal(out.status, 302);
  const p = params(out.location);
  assert.equal(p.state, STATE);
  assert.match(p.handoff, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(calls[0].body, { code: "4/code", client_id: CLIENT_ID, client_secret: "test-secret", redirect_uri: "https://paper-trail-bw.web.app/oauth/callback", grant_type: "authorization_code" });
  assert.equal(calls[0].url, oauth.GOOGLE_TOKEN_URL);

  const stored = tokens.get("g-123");
  assert.equal(stored.refreshToken, "1//refresh");
  assert.equal(stored.email, OWNER);
  assert.equal(stored.revokedAt, null);
  assert.match(stored.scope, /drive\.file/);

  const h = handoffs.get(p.handoff);
  assert.equal(h.idToken, google.json.id_token);
  assert.equal(h.accessToken, "ya29.access");
  assert.equal(h.driveConnected, true);
  assert.equal(h.challenge, CHALLENGE);
  assert.equal(h.expiresAt.getTime(), NOW.getTime() + 2 * 60 * 1000);
  assert.ok(!("refreshToken" in h), "the refresh token never goes in the handoff");
  assert.ok(!out.location.includes("refresh"), "the refresh token never reaches the app");
});

test("callback: a bad or missing state gets a plain page, never a redirect", async () => {
  for (const state of [undefined, "x", "papertrail://evil"]) {
    const out = await oauth.oauthCallback({ code: "c", state }, deps);
    assert.equal(out.status, 400);
    assert.equal(out.location, undefined);
  }
  assert.equal(calls.length, 0);
});

test("callback: consent declined comes back as canceled, other errors as failed", async () => {
  assert.equal(params((await oauth.oauthCallback({ error: "access_denied", state: STATE }, deps)).location).error, "canceled");
  assert.equal(params((await oauth.oauthCallback({ error: "server_error", state: STATE }, deps)).location).error, "failed");
  assert.equal(params((await oauth.oauthCallback({ state: STATE }, deps)).location).error, "failed");
  assert.equal(calls.length, 0);
});

test("callback: a failed exchange stores nothing", async () => {
  google = { status: 400, json: { error: "invalid_grant" } };
  const p = params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location);
  assert.equal(p.error, "failed");
  assert.equal(tokens.size + handoffs.size, 0);
});

test("callback: an ID token for another client or issuer is refused", async () => {
  google.json.id_token = idToken({ ...OWNER_CLAIMS, aud: "someone-else" });
  assert.equal(params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location).error, "failed");
  google.json.id_token = idToken({ ...OWNER_CLAIMS, iss: "https://evil.example" });
  assert.equal(params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location).error, "failed");
  assert.equal(tokens.size + handoffs.size, 0);
});

test("callback: an account off the allowlist stores nothing and says which account", async () => {
  google.json.id_token = idToken({ ...OWNER_CLAIMS, email: "Stranger@Example.test", sub: "g-999" });
  const p = params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location);
  assert.equal(p.error, "not_allowed");
  assert.equal(p.email, "stranger@example.test");
  assert.equal(tokens.size + handoffs.size, 0);
  google.json.id_token = idToken({ ...OWNER_CLAIMS, email_verified: false });
  assert.equal(params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location).error, "not_allowed");
});

test("callback: Drive unchecked on the consent screen signs in without connecting Drive", async () => {
  google.json.scope = "openid https://www.googleapis.com/auth/userinfo.email";
  const p = params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location);
  assert.equal(handoffs.get(p.handoff).driveConnected, false);
  assert.equal(tokens.size, 0);
});

test("callback: no new refresh token keeps the stored one if it still works", async () => {
  delete google.json.refresh_token;
  tokens.set("g-123", { refreshToken: "1//old", revokedAt: null });
  let p = params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location);
  assert.equal(handoffs.get(p.handoff).driveConnected, true);
  assert.equal(tokens.get("g-123").refreshToken, "1//old");
  tokens.set("g-123", { refreshToken: "1//old", revokedAt: "2026-10-01T00:00:00Z" });
  p = params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location);
  assert.equal(handoffs.get(p.handoff).driveConnected, false);
});

test("callback: reconnecting clears revokedAt", async () => {
  tokens.set("g-123", { refreshToken: "1//old", revokedAt: "2026-10-01T00:00:00Z" });
  await oauth.oauthCallback({ code: "c", state: STATE }, deps);
  assert.equal(tokens.get("g-123").refreshToken, "1//refresh");
  assert.equal(tokens.get("g-123").revokedAt, null);
});

// ---------- oauthRedeem ----------
async function handoffId() {
  return params((await oauth.oauthCallback({ code: "c", state: STATE }, deps)).location).handoff;
}

test("redeem: returns the tokens once, then the handoff is gone", async () => {
  const handoff = await handoffId();
  const first = await oauth.oauthRedeem({ handoff, state: STATE, verifier: VERIFIER }, deps);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { idToken: google.json.id_token, accessToken: "ya29.access", expiresIn: 3599, email: OWNER, name: "Owner Person", driveConnected: true });
  const again = await oauth.oauthRedeem({ handoff, state: STATE, verifier: VERIFIER }, deps);
  assert.equal(again.status, 404);
  assert.equal(again.json.code, "expired");
});

test("redeem: the wrong verifier or state fails and burns the handoff", async () => {
  let handoff = await handoffId();
  const wrongVerifier = await oauth.oauthRedeem({ handoff, state: STATE, verifier: b64url(crypto.randomBytes(32)) }, deps);
  assert.equal(wrongVerifier.status, 403);
  assert.equal((await oauth.oauthRedeem({ handoff, state: STATE, verifier: VERIFIER }, deps)).status, 404);

  handoff = await handoffId();
  const otherState = `${b64url(crypto.randomBytes(16))}.${CHALLENGE}`;
  assert.equal((await oauth.oauthRedeem({ handoff, state: otherState, verifier: VERIFIER }, deps)).status, 403);
});

test("redeem: after two minutes the handoff has expired", async () => {
  const handoff = await handoffId();
  const later = { ...deps, now: () => new Date(NOW.getTime() + 2 * 60 * 1000 + 1) };
  const out = await oauth.oauthRedeem({ handoff, state: STATE, verifier: VERIFIER }, later);
  assert.equal(out.status, 404);
});

test("redeem: malformed bodies are a 400 without touching the store", async () => {
  let touched = false;
  const watch = { ...deps, store: { ...deps.store, takeHandoff: async () => { touched = true; return null; } } };
  for (const body of [null, {}, { handoff: "short", state: STATE, verifier: VERIFIER }, { handoff: "a".repeat(43), state: "x", verifier: VERIFIER }, { handoff: "a".repeat(43), state: STATE, verifier: "short" }]) {
    assert.equal((await oauth.oauthRedeem(body, watch)).status, 400);
  }
  assert.equal(touched, false);
});

// ---------- driveToken ----------
test("driveToken: mints an access token from the stored refresh token", async () => {
  tokens.set("g-123", { refreshToken: "1//refresh", revokedAt: null });
  google.json = { access_token: "ya29.fresh", expires_in: 3599, scope: oauth.DRIVE_SCOPE, token_type: "Bearer" };
  const out = await oauth.driveToken(signedIn(), deps);
  assert.deepEqual(out, { accessToken: "ya29.fresh", expiresIn: 3599, expiresAt: new Date(NOW.getTime() + 3599 * 1000).toISOString() });
  assert.deepEqual(calls[0].body, { client_id: CLIENT_ID, client_secret: "test-secret", refresh_token: "1//refresh", grant_type: "refresh_token" });
});

test("driveToken: signed out, off the allowlist, or unverified are refused before Google is called", async () => {
  await rejectsWith(oauth.driveToken({}, deps), "signed_out");
  await rejectsWith(oauth.driveToken(signedIn("someone@example.test"), deps), "not_allowed");
  await rejectsWith(oauth.driveToken(signedIn(OWNER, "g-123", false), deps), "not_allowed");
  assert.equal(calls.length, 0);
});

test("driveToken: no stored token, a revoked one, or no Google identity is drive_revoked", async () => {
  await rejectsWith(oauth.driveToken(signedIn(), deps), "drive_revoked");
  tokens.set("g-123", { refreshToken: "1//x", revokedAt: "2026-10-01T00:00:00Z" });
  await rejectsWith(oauth.driveToken(signedIn(), deps), "drive_revoked");
  const noGoogle = { auth: { uid: "u", token: { email: OWNER, email_verified: true, firebase: { identities: {} } } } };
  await rejectsWith(oauth.driveToken(noGoogle, deps), "drive_revoked");
  assert.equal(calls.length, 0);
});

test("driveToken: invalid_grant marks the token revoked and answers drive_revoked", async () => {
  tokens.set("g-123", { refreshToken: "1//refresh", revokedAt: null });
  google = { status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
  await rejectsWith(oauth.driveToken(signedIn(), deps), "drive_revoked");
  assert.equal(tokens.get("g-123").revokedAt, NOW.toISOString());
  calls = [];
  await rejectsWith(oauth.driveToken(signedIn(), deps), "drive_revoked");
  assert.equal(calls.length, 0, "a revoked token isn't tried again");
});

test("driveToken: a Google outage is retryable and leaves the token alone", async () => {
  tokens.set("g-123", { refreshToken: "1//refresh", revokedAt: null });
  google = { status: 503, json: { error: "backend_error" } };
  await rejectsWith(oauth.driveToken(signedIn(), deps), "drive_unavailable");
  assert.equal(tokens.get("g-123").revokedAt, null);
});

test("driveToken: a token without the Drive scope counts as revoked", async () => {
  tokens.set("g-123", { refreshToken: "1//refresh", revokedAt: null });
  google.json = { access_token: "ya29.x", expires_in: 3599, scope: "openid" };
  await rejectsWith(oauth.driveToken(signedIn(), deps), "drive_revoked");
  assert.ok(tokens.get("g-123").revokedAt);
});

// ---------- the web app's return (#3): same flow, a different target for web nonces ----------
const WEB_NONCE = `web_${b64url(crypto.randomBytes(24))}`;
const WEB_STATE = `${WEB_NONCE}.${CHALLENGE}`;
const webParams = (location) => {
  assert.ok(location.startsWith("https://paper-trail-bw.web.app/#/auth/done?"), location);
  return Object.fromEntries(new URLSearchParams(location.split("#/auth/done?")[1]));
};

test("web nonces are web_ plus 32 base64url characters; the iPhone app's 22 never match", () => {
  assert.equal(WEB_NONCE.length, 36);
  assert.ok(oauth.isWebNonce(WEB_NONCE));
  assert.ok(!oauth.isWebNonce(STATE.split(".")[0]), "an iPhone nonce (22 characters)");
  for (const bad of ["web_short", `web_${"a".repeat(31)}`, `web_${"a".repeat(33)}`, `WEB_${"a".repeat(32)}`, `web_${"a".repeat(31)}=`, "", undefined]) assert.ok(!oauth.isWebNonce(bad), String(bad));
});

test("callback, web: a web nonce goes back to the web app with the handoff in the fragment", async () => {
  const out = await oauth.oauthCallback({ code: "4/code", state: WEB_STATE }, deps);
  assert.equal(out.status, 302);
  assert.ok(!out.location.startsWith("papertrail://"));
  const [beforeHash] = out.location.split("#");
  assert.equal(beforeHash, "https://paper-trail-bw.web.app/", "nothing before the fragment, so no server log or Referer sees the handoff");
  const p = webParams(out.location);
  assert.equal(p.state, WEB_STATE);
  assert.match(p.handoff, /^[A-Za-z0-9_-]{43}$/);
  const h = handoffs.get(p.handoff);
  assert.equal(h.nonce, WEB_NONCE);
  assert.equal(h.driveConnected, true);
  assert.equal(tokens.get("g-123").refreshToken, "1//refresh", "the refresh token is kept the same way as for the iPhone app");
  // the iPhone redeem works unchanged for the web handoff
  const r = await oauth.oauthRedeem({ handoff: p.handoff, state: WEB_STATE, verifier: VERIFIER }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.json.idToken, google.json.id_token);
});

test("callback, web: errors go back to the web app too", async () => {
  const canceled = await oauth.oauthCallback({ error: "access_denied", state: WEB_STATE }, deps);
  assert.deepEqual(webParams(canceled.location), { error: "canceled", state: WEB_STATE });
  const failed = await oauth.oauthCallback({ state: WEB_STATE }, deps);
  assert.deepEqual(webParams(failed.location), { error: "failed", state: WEB_STATE });
  google.json.id_token = idToken({ ...OWNER_CLAIMS, email: "someone@else.test", sub: "g-999" });
  const denied = await oauth.oauthCallback({ code: "c", state: WEB_STATE }, deps);
  assert.deepEqual(webParams(denied.location), { error: "not_allowed", email: "someone@else.test", state: WEB_STATE });
  assert.equal(tokens.size, 0);
});

test("callback, web: an iPhone nonce still goes to papertrail://, and web_short is treated as the iPhone's", async () => {
  const ios = await oauth.oauthCallback({ code: "c", state: STATE }, deps);
  assert.ok(ios.location.startsWith("papertrail://auth?"), ios.location);
  const shortState = `web_short_nonce_x.${CHALLENGE}`;   // passes the state regex, isn't a web nonce
  const short = await oauth.oauthCallback({ error: "access_denied", state: shortState }, deps);
  assert.ok(short.location.startsWith("papertrail://auth?"), short.location);
});

test("callback, web: the target comes from config, and a bad config value falls back to the live site", async () => {
  const cfg = deps.config;
  deps.config = () => ({ ...cfg(), webRedirect: "https://preview--paper-trail-bw.web.app/#/auth/done" });
  const out = await oauth.oauthCallback({ error: "access_denied", state: WEB_STATE }, deps);
  assert.ok(out.location.startsWith("https://preview--paper-trail-bw.web.app/#/auth/done?error=canceled"), out.location);
  for (const bad of ["javascript:alert(1)//#/auth/done", "http://paper-trail-bw.web.app/#/auth/done", "https://evil.test/#/auth/done?x=", "https://evil.test/oauth", "", undefined]) {
    deps.config = () => ({ ...cfg(), webRedirect: bad });
    const o = await oauth.oauthCallback({ error: "access_denied", state: WEB_STATE }, deps);
    assert.ok(o.location.startsWith(`${oauth.WEB_REDIRECT}?`), `${bad} -> ${o.location}`);
  }
  deps.config = cfg;
  // a value in the request never changes the target
  const tricked = await oauth.oauthCallback({ error: "access_denied", state: WEB_STATE, redirect: "https://evil.test/", webRedirect: "https://evil.test/#/auth/done" }, deps);
  assert.ok(tricked.location.startsWith(`${oauth.WEB_REDIRECT}?`), tricked.location);
});

// ---------- wiring ----------
test("index.js exports the three functions with the client secret bound", () => {
  for (const name of ["oauthCallback", "oauthRedeem", "driveToken", "classify"]) assert.ok(fns[name], name);
  const opts = fns.driveToken.__endpoint;
  assert.equal(opts.region[0], "us-central1");
  assert.ok(opts.secretEnvironmentVariables.some((s) => s.key === "GOOGLE_OAUTH_CLIENT_SECRET"));
  assert.ok(fns.oauthCallback.__endpoint.httpsTrigger, "oauthCallback is a plain HTTPS function");
  assert.ok(fns.driveToken.__endpoint.callableTrigger, "driveToken is a callable");
});

test("the driveToken callable maps OAuthError to HttpsError with details.code", async () => {
  const keep = { ...fns.oauthDeps };
  Object.assign(fns.oauthDeps, { store: deps.store, fetch: deps.fetch, now: deps.now, config: deps.config, allowlist: deps.allowlist });
  try {
    await assert.rejects(fns.driveToken.run(signedIn()), (e) => { assert.equal(e.code, "failed-precondition"); assert.equal(e.details.code, "drive_revoked"); return true; });
    tokens.set("g-123", { refreshToken: "1//refresh", revokedAt: null });
    google.json = { access_token: "ya29.fresh", expires_in: 3599, scope: oauth.DRIVE_SCOPE };
    const out = await fns.driveToken.run(signedIn());
    assert.equal(out.accessToken, "ya29.fresh");
  } finally { Object.assign(fns.oauthDeps, keep); }
});
