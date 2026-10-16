// Paper Trail, Firebase version. Ported from the claude.ai artifact (Home Projects/Projects/
// 2026-10 Paperwork Scan/paper-trail.html). The artifact's capabilities are replaced:
//   sample (Claude)    -> the `classify` HTTPS callable (functions/), which holds the API key
//   mcp (Google Drive) -> Drive REST v3 from this page with the signed-in account's OAuth token,
//                         scope drive.file only; the ORIGINAL file is uploaded at full size
//   db                 -> Firestore under users/{uid}/ (docs, paperless, config)
// On localhost, ?fake=1 swaps all three for in-memory stand-ins (tools/fake/fake-backend.js) so the
// deck can be exercised without a Google account. Serve the repo root for that: node tools/serve.mjs
//
// config.js: constants only. No DOM, no imports. The module map is in docs/web-contract.md.

// ---------- the no-AI lab build (#92) ----------
// The same files serve two Hosting sites. On the lab site (paper-trail-lab.web.app), or on localhost
// with ?lab, LAB is true: Firestore moves to users/{uid}/lab/data/ (DATA_ROOT, applied in backend.js),
// Drive files into "Paperwork Archive (Lab)", and the app wears the Lab badge and tint (lab.js).
// IndexedDB and localStorage are per origin, so the lab site's local pipeline is its own too.
// docs/web-contract.md, "Lab".
export const LAB_HOSTS = ["paper-trail-lab.web.app", "paper-trail-lab.firebaseapp.com"];
export const LAB = LAB_HOSTS.includes(location.hostname)
  || (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && new URLSearchParams(location.search).has("lab"));
export const LAB_SITE = "https://paper-trail-lab.web.app";
// Path segments between users/{uid} and every collection: [] for the live app, ["lab", "data"] here.
export const DATA_ROOT = LAB ? ["lab", "data"] : [];
export const FIREBASE = {
  version: "12.19.0",
  config: { apiKey: "AIzaSyBeYnYKS4RnbptfZFZU5xSE9UYO-Brn5_E", authDomain: "paper-trail-bw.firebaseapp.com", projectId: "paper-trail-bw",
    storageBucket: "paper-trail-bw.firebasestorage.app", messagingSenderId: "814219266285", appId: "1:814219266285:web:d6ba6274d93d735662e4e4" },
  site: "paper-trail-bw.web.app",
};
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
// Google sign-in (#15, #3): the same web OAuth client the iPhone app uses (not a secret; Firebase
// Auth's Google provider uses it too, so the ID token signs in to the same uid). Google sends the
// code to oauthCallback through the Hosting rewrite; web nonces come back to #/auth/done.
export const OAUTH = {
  clientId: "814219266285-pe2scelka1o9m98bt0v0f5fohumfs8f6.apps.googleusercontent.com",
  redirectUri: "https://paper-trail-bw.web.app/oauth/callback",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  redeemPath: "/oauth/redeem",
};
export const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
// The lab files into its own folder, with the same 11 subfolders, never into the real archive.
export const ROOT_FOLDER = LAB ? "Paperwork Archive (Lab)" : "Paperwork Archive";
export const FOLDER_NAMES = [
  "01 Identity & Legal", "02 Taxes", "03 Money & Banking", "04 Insurance", "05 Medical", "06 Home",
  "07 Auto", "08 Work & Income", "09 Warranties & Manuals", "10 Personal & Sentimental", "11 Other",
];
// Year subfolders (decision 2): only these three, e.g. "02 Taxes/2025", created on demand.
export const YEAR_FOLDERS = ["02 Taxes", "03 Money & Banking", "05 Medical"];
export const VERDICT = {
  shred: { stamp: "Shred", label: "Shred it" },
  scan_shred: { stamp: "Scan + shred", label: "Scan, then shred" },
  keep_original: { stamp: "Keep original", label: "Keep the paper" },
};
// What goes to Claude. A PDF up to these limits is sent as is (Claude reads PDFs natively, text and
// page images both). A bigger one, and every photo, goes as page images: the first READ_PAGES pages,
// READ_EDGE px on the long side. Drive always gets the original, whatever was sent here.
export const PDF_MAX_PAGES = 10, PDF_MAX_BYTES = 9 * 1024 * 1024;
export const READ_PAGES = 10, READ_EDGE = 1568;
export const MAX_SEND_CHARS = 24 * 1024 * 1024;   // base64 characters; the function refuses more
export const READERS = 2;                         // documents Claude reads at once

// A read error when the account isn't on the allowlist (the sign-in screen says "This account isn't on the list.").
export const DENIED = "This account isn't on the list. Sign in with a different Google account.";

// Shown in the Settings footer ("Paper Trail {version}"). The web app's own version, not the iPhone app's.
export const VERSION = LAB ? "2.0 (web) Lab" : "2.0 (web)";
// The name in the browser tab ("Sort · Paper Trail"); the lab's says Lab.
export const APP_NAME = LAB ? "Paper Trail Lab" : "Paper Trail";

// ---------- backend: Firebase, or the local stand-in ----------
export const params = new URLSearchParams(location.search);
export const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const FAKE = LOCAL && params.has("fake");
