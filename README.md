# Paper Trail

Bryce's paperwork-scanning tool: choose a stack of PDFs or photos, Claude reads each one and stamps it Shred, Scan + shred or Keep original, and a swipe right files the **original file, at full quality** into the Paperwork Archive folder in Google Drive. Live at https://paper-trail-bw.web.app (Firebase project `paper-trail-bw`).

This replaces the claude.ai artifact version (Home Projects/Projects/2026-10 Paperwork Scan/paper-trail.html, https://claude.ai/artifact/HByu3KMANFWU4Mi5UXb4Y5), which had to shrink or split scans because artifact Drive uploads cap near 700 KB.

- Issues (bugs, changes, roadmap): https://github.com/brycewalls/paper-trail/issues
- CI runs and page screenshots: https://github.com/brycewalls/paper-trail/actions
- Releases: https://github.com/brycewalls/paper-trail/releases
- Milestones: https://github.com/brycewalls/paper-trail/milestones

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| The page | `public/index.html`, `public/css/app.css`, `public/js/` | Static files on Firebase Hosting, no build step: the markup, the Direction A design system (`css/tokens.css`, `css/components.css`, `css/shell.css`, `js/ui/`), and native ES modules (entry `js/main.js`, one module per concern; the map is in [docs/web-contract.md](docs/web-contract.md)). Every component is on `public/dev/gallery.html` (not deployed). Firebase JS SDK 12.19.0 from gstatic, pdf.js for thumbnails and page renders, jsPDF to combine photos into one PDF. Same design as the artifact, both themes, phone first. |
| Scanning | `public/js/scanner.js`, Scan document | A full-screen camera scanner (rear camera, `getUserMedia`). [jscanify](https://github.com/puffinsoft/jscanify) 1.4.2 (MIT) on the OpenCV.js build it ships (Apache 2.0) finds the page's edges live; Capture takes the full video frame, the review step has draggable corners, and Keep page flattens it with a perspective warp to 1700 px on the short side (about 200 dpi letter), JPEG 0.85, with an optional light whitening pass (Document). Done turns the pages into one PDF through the same path as photos, so a scan joins the deck like a chosen file. Both libraries load from jsdelivr, pinned with SRI, only when the scanner first opens: OpenCV.js is about 9 MB, roughly 2 to 3 MB over the wire, then cached. |
| Sign-in | Firebase Auth, Google provider | The popup asks for `drive.file` too, so the same sign-in gives a Google access token (about an hour). The token stays in memory and this tab's sessionStorage. When Drive answers 401, uploads pause and a Reconnect Drive banner gets a fresh one without losing the deck. |
| Reading | `functions/` callable `classify` (2nd gen, Node 22, us-central1, 1 GiB, 300 s) | Takes one document and returns the filing card (title, folder, filename, verdict and the rest, same prompt and fields as the artifact). Holds the Anthropic API key as a secret. Refuses anyone not signed in and on `ALLOWED_EMAILS`. |
| Filing | Drive REST v3, from the page | Finds or creates "Paperwork Archive" and its 11 numbered folders on first use (the IDs are cached in Firestore), then uploads with a resumable session in one PUT. A PDF goes up byte for byte. Photos become one PDF; an upright JPEG goes in untouched, anything else is redrawn upright at full size (up to about 16 megapixels, iPhone Safari's canvas limit). |
| The log | Firestore `users/{uid}/docs`, `users/{uid}/paperless`, `users/{uid}/config/drive` | The piles, stats and Go paperless list. Rules allow only the signed-in owner of that uid, and only an allowlisted, verified email. |

What goes to Claude: a PDF of up to 10 pages and 9 MB is sent as is (Claude reads the text and the page images). A longer or bigger PDF, and every photo, goes as page images, the first 10 pages at 1568 px on the long side. Drive always gets the original either way.

### Who can use it

Two places name the allowed accounts, and they must match:

- `functions/.env`, `ALLOWED_EMAILS` (comma separated), deployed with the function
- `firebase/firestore.rules`, the list in `allowed()`

Anyone else who signs in sees "This app is private" (the page reads Firestore, the rules refuse, the page shows the screen) and the function refuses them before anything reaches Claude.

`drive.file` means the app can only see folders and files it made itself. The artifact's old Paperwork Archive folder (made through the claude.ai Drive connector) is invisible to it, so the app makes its own "Paperwork Archive" in whichever account signs in.

### Model and cost

`claude-opus-5-5` at effort `low`, with structured outputs holding the reply to the JSON schema, the instructions cached as the system prompt, and the server-side refusal fallback on. Change it in `functions/.env` (`CLAUDE_MODEL`, `CLAUDE_EFFORT`) and redeploy the function.

A typical 2-page scan is about 4,600 input tokens of pages plus about 800 of cached instructions, and about 750 output tokens (the JSON plus a little thinking): about **$0.03 to $0.04 per document** at $4 / $20 per million tokens, so roughly 70 cents for a 20-document session. `claude-sonnet-5-5` would be about half that. Each call logs its token counts in the function logs (`classify: done`).

## Setup (once)

These need Bryce in the Google and Firebase consoles. Claude did the rest: the project, the web app, Firestore (nam5), the Drive, Firestore, Identity Toolkit and Rules APIs, the rules, and the site.

1. Upgrade `paper-trail-bw` to the Blaze plan (Cloud Functions and Secret Manager need it). Firebase console, the project, Upgrade.
2. Turn on Google sign-in: Firebase console, Authentication, Get started, Sign-in method, Google, Enable, pick the support email, Save.
3. OAuth consent screen: Google Cloud console for `paper-trail-bw`, Google Auth Platform, Audience. Leave it in Testing and add the Google account(s) that will use it as test users. Adding the `.../auth/drive.file` scope under Data Access is optional while it stays in Testing.
4. Set the API key secret (paste the key at the prompt, it never goes in a file): `firebase functions:secrets:set ANTHROPIC_API_KEY --project paper-trail-bw`
5. Deploy everything: `bash tools/deploy.sh`

## iPhone app (ios/)

A native SwiftUI app for iPhone (iOS 26 or later, built and tested for the iPhone 15 Pro Max on iOS 27), on the same Firebase project, Firestore data and Drive folders as the web app. Direction A ("Glass") from `docs/design-spec.md`: Sort (the swipe deck), Piles, Paperless and Search, with the outbox as a bar above the tabs and Settings from the avatar. The code contract is `ios/ARCHITECTURE.md`; the plan is issue #33.

### Build it

- **The IPA:** `bash tools/build_ipa.sh` writes an unsigned `ios/build/PaperTrail.ipa` (`OUT=dist bash tools/build_ipa.sh` puts it in `dist/`). It needs Xcode and XcodeGen (`brew install xcodegen`). Nothing is signed here; SideStore signs it on the phone.
- **Releases:** each iPhone build is attached to a prerelease named `ios-vX.Y` on the Releases page.
- **In the simulator:** `cd ios && xcodegen`, then `xcodebuild test -scheme PaperTrail -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max'`. Launch with `-PTSample` to run on sample data with no Google account.
- **UI walk-through:** `bash tools/ui_walkthrough.sh` taps through every screen in sample mode, in light and dark, and saves the screenshots to `dist/qa/`.
- The Xcode project is generated from `ios/project.yml`. Never edit the `.xcodeproj` by hand.

### Install it with SideStore

The app is sideloaded with SideStore on a free Apple ID, so it has no entitlements and nothing depends on the bundle ID.

1. On the iPhone, open the latest `ios-v` release on the Releases page in Safari and download `PaperTrail.ipa`.
2. Open SideStore, go to My Apps, tap the plus button, and pick `PaperTrail.ipa` from Files.
3. SideStore signs it with your Apple ID and installs it. The first launch shows the sign-in screen.

A free Apple ID signs apps for 7 days. Open SideStore and tap Refresh All before the 7 days run out (SideStore can also refresh in the background while its VPN is connected). If it lapses, the app won't open until you refresh it; your scans stay on the phone. A free Apple ID also allows 3 sideloaded apps at once, SideStore included.

To update, install the newer IPA the same way. SideStore keeps the app's data.

### Setup the iPhone app needs (once)

Sign-in uses Google's web flow with the code exchanged on the server, so Drive stays connected and nothing depends on the bundle ID. These steps need Bryce in the consoles:

1. In the Google Cloud console for `paper-trail-bw`, go to APIs & Services, then Credentials, then OAuth 2.0 Client IDs, then the "Web client (auto created by Google Service)" client, and copy its Client secret.
2. Set it as a Functions secret and paste it at the prompt: `firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET --project paper-trail-bw`
3. On that same client page, under Authorized redirect URIs, add `https://paper-trail-bw.web.app/oauth/callback` and save.
4. In APIs & Services, then Credentials, then API keys, open the key that matches `API_KEY` in `ios/GoogleService-Info.plist`. Application restrictions should be None, not "iOS apps". Keep its API restrictions.
5. Deploy the functions and Hosting once the iPhone work is on `main`: `firebase deploy --only functions,hosting --project paper-trail-bw` (adds `oauthCallback`, `oauthRedeem`, `driveToken`, the extended `classify`, and the `/oauth/callback` and `/oauth/redeem` rewrites).

## Working on it

- **Run it locally with no Google account:** `node tools/serve.mjs`, then http://localhost:5178/public/index.html?fake=1. Firebase, Claude and Drive are swapped for in-memory stand-ins (`tools/fake/fake-backend.js`). Add `&as=stranger` for the private screen, `&signedout`, `&nodrive`, `&drive401` (Reconnect Drive), `&readfail` (Try again).
- **Real sign-in locally:** http://localhost:5178/public/index.html (no `fake`) talks to the real project; localhost is an authorized domain by default. Preview channels can't do Google sign-in, so test auth here or on the live site.
- **Web contract:** [docs/web-contract.md](docs/web-contract.md) is the shared agreement for the web v2 feature branches (#83): who owns which module, the data model shared with the iPhone app, the local pipeline, the events, the fake backend and the web auth design. It replaces `docs/v2-contract.md`. `node tools/contract_check.mjs` checks the machine-checkable parts.
- **Tests:** `node tools/contract_check.mjs` (the module contract), `node --test functions/test/*.test.mjs` (the function, Claude stood in), `node tools/deck_test.mjs` (the deck end to end against the fake), `node tools/shell_test.mjs` (the app shell and the Direction A components), `node tools/scanner_test.mjs` (Scan document with a fake camera: Chromium plays a generated video of a tilted page; needs the network for OpenCV.js), `node tools/smoke_test.mjs` (every page, two widths), `node tools/rules-check.mjs` (the rules in the real rules engine, needs `firebase login`). The browser tests need `npm install --no-save playwright@1 && npx playwright install chromium`.
- **App icons:** every icon in `public/` (favicon, Home Screen, manifest, maskable) is drawn once in `tools/make_icons.mjs`. Change the art there and run `node tools/make_icons.mjs`; never edit the PNGs by hand.
- **Deploy:** `bash tools/deploy.sh` (rules, function, site) or `bash tools/deploy.sh --site` (rules and site only). Never `firebase init`; the config is hand-written. There is no CLI rollback for Hosting: roll back from the Firebase console's Hosting release history.

## The loop

1. **It starts as an issue.** A bug, a change, a roadmap idea. Open one with the matching template, or tell Claude and it opens one.
2. **Work happens on a branch named for the issue:** `fix/12-upload-retry`, `feat/20-rename-folder`.
3. **A pull request brings it back to `main`** with `Closes #12` in the body. CI runs the smoke test, the deck test, the scanner test and the function tests.
4. **Merging to `main` is the build.**
5. **A tag makes a release:** `git tag v1.1 && git push origin main --tags`. CI attaches a zip.
6. **Deploy** with `bash tools/deploy.sh`, then clear the `deploy pending` label.

## Labels

`bug` / `change` / `roadmap` / `testing` for type, `area: <part>` for where (`area: deck`, `area: drive`, `area: classify`, `area: auth`, `area: piles`), `priority: now` / `next` / `later`, `deploy pending` for merged-but-not-live, `blocked` for waiting on something.
