// Cloud Functions for paper-trail-bw.
//   classify   HTTPS callable (2nd gen). The page sends one document (a PDF, or page images) and gets
//              back the normalized JSON card: title, folder, filename, verdict and the rest. Only a
//              signed-in, verified Google account on ALLOWED_EMAILS may call it; everyone else gets
//              permission-denied before anything reaches Claude.
//   oauthCallback, oauthRedeem, driveToken
//              Google sign-in and Drive tokens for the iPhone app and the web app (#14, #15, #3): see oauth.js.
// Config (functions/.env, deployed with the functions): ALLOWED_EMAILS, CLAUDE_MODEL, CLAUDE_EFFORT,
// GOOGLE_OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, WEB_APP_REDIRECT (optional, defaults to the live site).
// Secrets: ANTHROPIC_API_KEY and GOOGLE_OAUTH_CLIENT_SECRET, each set once with
// `firebase functions:secrets:set NAME`.
const { defineString, defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const Anthropic = require("@anthropic-ai/sdk");
const lib = require("./lib");
const deps = require("./deps");
const oauth = require("./oauth");

const REGION = "us-central1";
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ALLOWED_EMAILS = defineString("ALLOWED_EMAILS", { description: "Comma separated Google account emails allowed to use the app." });
const CLAUDE_MODEL = defineString("CLAUDE_MODEL", { default: "claude-opus-5-5", description: "Claude model that reads each document." });
const CLAUDE_EFFORT = defineString("CLAUDE_EFFORT", { default: "low", description: "Claude effort level: low, medium or high." });

let client = null;
deps.Anthropic = Anthropic.default || Anthropic;
deps.client = () => client || (client = new deps.Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 2, timeout: 240000 }));
deps.allowlist = () => lib.parseAllowlist(ALLOWED_EMAILS.value());
deps.model = () => CLAUDE_MODEL.value();
deps.effort = () => CLAUDE_EFFORT.value();
deps.today = () => new Date().toISOString().slice(0, 10);
deps.log = (msg, data) => logger.info(msg, data);

async function handler(request) {
  try {
    return await lib.classify(request, deps);
  } catch (e) {
    if (e instanceof lib.ClassifyError) throw new HttpsError(e.status, e.message, { code: e.code });
    logger.error("classify failed", e);
    throw new HttpsError("internal", "Something interrupted the read.", { code: "unknown" });
  }
}

exports.classify = onCall({
  region: REGION,
  secrets: [ANTHROPIC_API_KEY],
  timeoutSeconds: 300,
  memory: "1GiB",
  maxInstances: 3,
  concurrency: 8,
}, handler);

// ---------- Google sign-in and Drive tokens (iPhone app, #14, #15) ----------
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const GOOGLE_OAUTH_CLIENT_ID = defineString("GOOGLE_OAUTH_CLIENT_ID", { description: "The web OAuth client ID (the one Firebase Auth's Google provider uses)." });
const OAUTH_REDIRECT_URI = defineString("OAUTH_REDIRECT_URI", { default: "https://paper-trail-bw.web.app/oauth/callback", description: "Google's redirect URI, served by oauthCallback through a Hosting rewrite." });
// Where oauthCallback sends the web app's sign-in back to (web nonces only, #3). Not secret.
const WEB_APP_REDIRECT = defineString("WEB_APP_REDIRECT", { default: oauth.WEB_REDIRECT, description: "The web app's sign-in return: https://<host>/#/auth/done." });

if (!getApps().length) initializeApp();
let db = null;
const oauthDeps = {
  fetch: (...args) => fetch(...args),
  store: oauth.firestoreStore(() => db || (db = getFirestore())),
  config: () => ({ clientId: GOOGLE_OAUTH_CLIENT_ID.value(), clientSecret: GOOGLE_OAUTH_CLIENT_SECRET.value(), redirectUri: OAUTH_REDIRECT_URI.value(), webRedirect: WEB_APP_REDIRECT.value() }),
  allowlist: () => lib.parseAllowlist(ALLOWED_EMAILS.value()),
  now: () => new Date(),
  log: (msg, data) => logger.warn(msg, data),
};
exports.oauthDeps = oauthDeps;

const oauthOptions = { region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET], maxInstances: 2, timeoutSeconds: 30, memory: "256MiB" };

exports.oauthCallback = onRequest(oauthOptions, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "GET") { res.status(405).send("Method not allowed"); return; }
  try {
    const out = await oauth.oauthCallback(req.query, oauthDeps);
    if (out.location) res.redirect(out.status, out.location);
    else res.status(out.status).type("text/plain").send(out.body);
  } catch (e) {
    logger.error("oauthCallback failed", e);
    res.status(500).type("text/plain").send("Sign-in didn't finish. Go back to Paper Trail and try again.");
  }
});

exports.oauthRedeem = onRequest(oauthOptions, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ code: "bad_request" }); return; }
  try {
    const out = await oauth.oauthRedeem(req.body, oauthDeps);
    res.status(out.status).json(out.json);
  } catch (e) {
    logger.error("oauthRedeem failed", e);
    res.status(500).json({ code: "unknown" });
  }
});

exports.driveToken = onCall(oauthOptions, async (request) => {
  try {
    return await oauth.driveToken(request, oauthDeps);
  } catch (e) {
    if (e instanceof oauth.OAuthError) throw new HttpsError(e.status, e.message, { code: e.code });
    logger.error("driveToken failed", e);
    throw new HttpsError("internal", "Something interrupted the Drive token.", { code: "unknown" });
  }
});
