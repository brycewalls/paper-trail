// Google sign-in and Drive tokens for the iPhone app (#14, #15). See ios/ARCHITECTURE.md, "Auth".
// Kept apart from the Firebase wiring in index.js so the unit tests can run it with Google and
// Firestore stood in.
//
//   oauthCallback  HTTPS GET, Google's redirect URI (https://paper-trail-bw.web.app/oauth/callback
//                  through a Hosting rewrite). Exchanges the code with the web client's secret,
//                  checks the allowlist, keeps the refresh token server side in oauthTokens/{sub},
//                  parks the ID and access tokens in a one-time oauthHandoffs/{random} doc and
//                  sends the browser back to the app: papertrail://auth?handoff=...&state=...
//                  The web app's sign-in (#3, #15) uses the same function: its nonces are "web_" plus
//                  32 base64url characters (the iPhone app's are always 22), and those go back to
//                  https://paper-trail-bw.web.app/#/auth/done?handoff=...&state=... instead. The
//                  handoff rides in the fragment, so it never reaches a server log or a Referer.
//                  The no-AI lab build (#92) signs in the same way from its own Hosting site: its
//                  nonces are "lab_" plus 32 characters and go back to
//                  https://paper-trail-lab.web.app/#/auth/done. The nonce picks the return host
//                  from WEB_TARGETS, a fixed allowlist, so the request can never name one.
//   oauthRedeem    HTTPS POST from the app: { handoff, state, verifier }. Single use, 2 minutes.
//                  Returns the ID and access tokens the app signs in to Firebase with.
//   driveToken     Callable, signed in and allowlisted. Mints a Drive access token from the stored
//                  refresh token. invalid_grant marks the token revoked and answers drive_revoked,
//                  which the app shows as Reconnect Drive.
//
// The app's state is "<nonce>.<challenge>", where challenge is base64url(SHA-256(verifier)) and the
// verifier never leaves the phone. So the papertrail:// redirect alone can't redeem a handoff.
const crypto = require("node:crypto");
const { isAllowed } = require("./lib");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const APP_REDIRECT = "papertrail://auth";
// The web app's return target. Comes from config (WEB_APP_REDIRECT), never from the request, so the
// callback can't be turned into an open redirect.
const WEB_REDIRECT = "https://paper-trail-bw.web.app/#/auth/done";
const LAB_REDIRECT = "https://paper-trail-lab.web.app/#/auth/done";
// The web return hosts a sign-in may pick, by its nonce's prefix. Nothing else is ever a target.
// "web" is the live app (WEB_APP_REDIRECT may still move it, see webTarget); "lab" is the lab build.
const WEB_TARGETS = Object.freeze({ web: WEB_REDIRECT, lab: LAB_REDIRECT });
const WEB_NONCE_RE = /^(web|lab)_[A-Za-z0-9_-]{32}$/;
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const STATE_RE = /^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43}$/;
const HANDOFF_RE = /^[A-Za-z0-9_-]{32,128}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

class OAuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const challengeFor = (verifier) => b64url(crypto.createHash("sha256").update(verifier).digest());
const randomId = () => b64url(crypto.randomBytes(32));

function parseState(state) {
  if (typeof state !== "string" || !STATE_RE.test(state)) return null;
  const [nonce, challenge] = state.split(".");
  return { nonce, challenge };
}

const isWebNonce = (nonce) => WEB_NONCE_RE.test(String(nonce || ""));
// "web", "lab", or "" for the iPhone app's nonces (and anything else).
const webKind = (nonce) => { const m = WEB_NONCE_RE.exec(String(nonce || "")); return m ? m[1] : ""; };

// Only an https URL on a fixed host can be the web target; anything else falls back to the default.
function webTarget(configured) {
  const v = String(configured || "");
  return /^https:\/\/[a-z0-9.-]+(:\d+)?\/#\/auth\/done$/.test(v) ? v : WEB_REDIRECT;
}

// The return for one sign-in: papertrail://auth for the iPhone app, else the web host its nonce
// names. The lab's host is fixed; only the live one follows config.
function returnTarget(nonce, cfg) {
  const kind = webKind(nonce);
  if (kind === "lab") return WEB_TARGETS.lab;
  if (kind === "web") return webTarget(cfg && cfg.webRedirect);
  return APP_REDIRECT;
}

// Where the app (and only the app) gets sent back to. Every value is URL encoded. base is
// APP_REDIRECT for the iPhone app, or the web target for a web nonce.
function appRedirect(params, base = APP_REDIRECT) {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return `${base}?${q}`;
}

// The ID token comes straight from Google's token endpoint over TLS, so its payload is read
// without checking the signature (OpenID Connect Core 3.1.3.7, item 6). aud, iss and the email are
// still checked.
function decodeIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
}

const scopesOf = (s) => String(s || "").split(/\s+/).filter(Boolean);

async function postForm(fetchFn, url, form) {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  let json = {};
  try { json = await res.json(); } catch { json = {}; }
  return { ok: res.ok, status: res.status, json };
}

// ---------- oauthCallback ----------
// query: the redirect's query string as an object. Returns { status, location } or { status, body }.
// deps: { fetch, store, config(): { clientId, clientSecret, redirectUri, webRedirect }, allowlist(), now(), log }
async function oauthCallback(query, deps) {
  const q = query || {};
  const parsed = parseState(q.state);
  if (!parsed) return { status: 400, body: "This sign-in link isn't valid. Go back to Paper Trail and try again." };
  const cfg = deps.config();
  const base = returnTarget(parsed.nonce, cfg);
  const back = (params) => ({ status: 302, location: appRedirect({ ...params, state: q.state }, base) });

  if (q.error) return back({ error: q.error === "access_denied" ? "canceled" : "failed" });
  if (typeof q.code !== "string" || !q.code) return back({ error: "failed" });

  const { clientId, clientSecret, redirectUri } = cfg;
  const exchange = await postForm(deps.fetch, GOOGLE_TOKEN_URL, {
    code: q.code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
  });
  if (!exchange.ok || !exchange.json.id_token) {
    deps.log("oauth code exchange failed", { status: exchange.status, error: exchange.json.error });
    return back({ error: "failed" });
  }
  const tokens = exchange.json;
  const claims = decodeIdToken(tokens.id_token);
  if (!claims || claims.aud !== clientId || !GOOGLE_ISSUERS.has(claims.iss) || !claims.sub) {
    deps.log("oauth id token rejected", { aud: claims && claims.aud, iss: claims && claims.iss });
    return back({ error: "failed" });
  }
  const email = String(claims.email || "").trim().toLowerCase();
  if (!isAllowed({ email, email_verified: claims.email_verified === true }, deps.allowlist())) {
    return back({ error: "not_allowed", email });
  }

  const now = deps.now();
  const scopes = scopesOf(tokens.scope);
  let driveConnected = false;
  if (scopes.includes(DRIVE_SCOPE)) {
    if (tokens.refresh_token) {
      await deps.store.setToken(claims.sub, {
        refreshToken: tokens.refresh_token, email, scope: scopes.join(" "), updatedAt: now.toISOString(), revokedAt: null,
      });
      driveConnected = true;
    } else {
      // Google only skips the refresh token when it already issued one; keep using that one.
      const existing = await deps.store.getToken(claims.sub);
      driveConnected = !!(existing && existing.refreshToken && !existing.revokedAt);
    }
  }

  const handoff = randomId();
  await deps.store.createHandoff(handoff, {
    nonce: parsed.nonce, challenge: parsed.challenge,
    idToken: tokens.id_token, accessToken: tokens.access_token || "", expiresIn: Number(tokens.expires_in) || 0,
    email, name: String(claims.name || ""), sub: claims.sub, driveConnected,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
  });
  return back({ handoff });
}

// ---------- oauthRedeem ----------
// body: { handoff, state, verifier }. Returns { status, json }. The handoff is deleted on the first
// read whatever happens next, so it can't be tried twice.
async function oauthRedeem(body, deps) {
  const b = body && typeof body === "object" ? body : {};
  const parsed = parseState(b.state);
  if (!parsed || typeof b.handoff !== "string" || !HANDOFF_RE.test(b.handoff) || typeof b.verifier !== "string" || !VERIFIER_RE.test(b.verifier)) {
    return { status: 400, json: { code: "bad_request" } };
  }
  const doc = await deps.store.takeHandoff(b.handoff);
  if (!doc) return { status: 404, json: { code: "expired" } };
  const expiresAt = doc.expiresAt instanceof Date ? doc.expiresAt : (doc.expiresAt && doc.expiresAt.toDate ? doc.expiresAt.toDate() : new Date(0));
  if (expiresAt.getTime() <= deps.now().getTime()) return { status: 404, json: { code: "expired" } };
  if (doc.nonce !== parsed.nonce || doc.challenge !== parsed.challenge || challengeFor(b.verifier) !== doc.challenge) {
    return { status: 403, json: { code: "mismatch" } };
  }
  return {
    status: 200,
    json: { idToken: doc.idToken, accessToken: doc.accessToken, expiresIn: doc.expiresIn, email: doc.email, name: doc.name, driveConnected: doc.driveConnected === true },
  };
}

// ---------- driveToken ----------
// request: the callable's request. Returns { accessToken, expiresIn, expiresAt } or throws OAuthError.
async function driveToken(request, deps) {
  if (!request || !request.auth) throw new OAuthError("unauthenticated", "signed_out", "Sign in first.");
  const token = request.auth.token || {};
  if (!isAllowed(token, deps.allowlist())) throw new OAuthError("permission-denied", "not_allowed", "This app is private.");
  const ids = token.firebase && token.firebase.identities && token.firebase.identities["google.com"];
  const sub = Array.isArray(ids) && ids.length ? String(ids[0]) : "";
  if (!sub) throw new OAuthError("failed-precondition", "drive_revoked", "Connect Google Drive first.");

  const stored = await deps.store.getToken(sub);
  if (!stored || !stored.refreshToken || stored.revokedAt) throw new OAuthError("failed-precondition", "drive_revoked", "Drive needs reconnecting.");

  const { clientId, clientSecret } = deps.config();
  const res = await postForm(deps.fetch, GOOGLE_TOKEN_URL, {
    client_id: clientId, client_secret: clientSecret, refresh_token: stored.refreshToken, grant_type: "refresh_token",
  });
  if (!res.ok || !res.json.access_token) {
    if (res.json.error === "invalid_grant") {
      await deps.store.updateToken(sub, { revokedAt: deps.now().toISOString() });
      throw new OAuthError("failed-precondition", "drive_revoked", "Drive needs reconnecting.");
    }
    deps.log("drive token refresh failed", { status: res.status, error: res.json.error });
    throw new OAuthError("unavailable", "drive_unavailable", "Google didn't answer. Try again in a minute.");
  }
  if (res.json.scope && !scopesOf(res.json.scope).includes(DRIVE_SCOPE)) {
    await deps.store.updateToken(sub, { revokedAt: deps.now().toISOString() });
    throw new OAuthError("failed-precondition", "drive_revoked", "Drive needs reconnecting.");
  }
  const expiresIn = Number(res.json.expires_in) || 3600;
  return { accessToken: res.json.access_token, expiresIn, expiresAt: new Date(deps.now().getTime() + expiresIn * 1000).toISOString() };
}

// The Firestore side of `store`, used by index.js. Top-level collections the rules close to every
// client (firebase/firestore.rules); only the Admin SDK reaches them.
function firestoreStore(db) {
  const tokens = () => db().collection("oauthTokens");
  const handoffs = () => db().collection("oauthHandoffs");
  return {
    async getToken(sub) { const s = await tokens().doc(sub).get(); return s.exists ? s.data() : null; },
    async setToken(sub, data) { await tokens().doc(sub).set(data, { merge: true }); },
    async updateToken(sub, data) { await tokens().doc(sub).set(data, { merge: true }); },
    async createHandoff(id, data) { await handoffs().doc(id).create(data); },
    async takeHandoff(id) {
      const ref = handoffs().doc(id);
      return db().runTransaction(async (t) => {
        const s = await t.get(ref);
        if (!s.exists) return null;
        t.delete(ref);
        return s.data();
      });
    },
  };
}

module.exports = {
  GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, DRIVE_SCOPE, APP_REDIRECT, WEB_REDIRECT, LAB_REDIRECT, WEB_TARGETS, HANDOFF_TTL_MS,
  isWebNonce, webKind, webTarget, returnTarget,
  OAuthError, oauthCallback, oauthRedeem, driveToken, firestoreStore, parseState, challengeFor, decodeIdToken, appRedirect,
};
