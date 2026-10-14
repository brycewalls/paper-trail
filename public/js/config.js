// Paper Trail, Firebase version. Ported from the claude.ai artifact (Home Projects/Projects/
// 2026-10 Paperwork Scan/paper-trail.html). The artifact's capabilities are replaced:
//   sample (Claude)    -> the `classify` HTTPS callable (functions/), which holds the API key
//   mcp (Google Drive) -> Drive REST v3 from this page with the signed-in account's OAuth token,
//                         scope drive.file only; the ORIGINAL file is uploaded at full size
//   db                 -> Firestore under users/{uid}/ (docs, paperless, config)
// On localhost, ?fake=1 swaps all three for in-memory stand-ins (tools/fake/fake-backend.js) so the
// deck can be exercised without a Google account. Serve the repo root for that: node tools/serve.mjs
//
// config.js: constants only. No DOM, no imports. The module map is in docs/v2-contract.md.
export const FIREBASE = {
  version: "12.19.0",
  config: { apiKey: "AIzaSyBeYnYKS4RnbptfZFZU5xSE9UYO-Brn5_E", authDomain: "paper-trail-bw.firebaseapp.com", projectId: "paper-trail-bw",
    storageBucket: "paper-trail-bw.firebasestorage.app", messagingSenderId: "814219266285", appId: "1:814219266285:web:d6ba6274d93d735662e4e4" },
  site: "paper-trail-bw.web.app",
};
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const ROOT_FOLDER = "Paperwork Archive";
export const FOLDER_NAMES = [
  "01 Identity & Legal", "02 Taxes", "03 Money & Banking", "04 Insurance", "05 Medical", "06 Home",
  "07 Auto", "08 Work & Income", "09 Warranties & Manuals", "10 Personal & Sentimental", "11 Other",
];
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

// Shown on the gate and as a read error when the account isn't on the allowlist.
export const DENIED = "This app is private. That account does not have access.";

// ---------- backend: Firebase, or the local stand-in ----------
export const params = new URLSearchParams(location.search);
export const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const FAKE = LOCAL && params.has("fake");
