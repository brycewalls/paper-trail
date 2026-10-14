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
| The page | `public/index.html` | One static file on Firebase Hosting, no build step. Firebase JS SDK 12.19.0 from gstatic, pdf.js for thumbnails and page renders, jsPDF to combine photos into one PDF. Same design as the artifact, both themes, phone first. |
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

## Working on it

- **Run it locally with no Google account:** `node tools/serve.mjs`, then http://localhost:5178/public/index.html?fake=1. Firebase, Claude and Drive are swapped for in-memory stand-ins (`tools/fake/fake-backend.js`). Add `&as=stranger` for the private screen, `&signedout`, `&nodrive`, `&drive401` (Reconnect Drive), `&readfail` (Try again).
- **Real sign-in locally:** http://localhost:5178/public/index.html (no `fake`) talks to the real project; localhost is an authorized domain by default. Preview channels can't do Google sign-in, so test auth here or on the live site.
- **Tests:** `node --test functions/test/*.test.mjs` (the function, Claude stood in), `node tools/deck_test.mjs` (the deck end to end against the fake), `node tools/smoke_test.mjs` (every page, two widths), `node tools/rules-check.mjs` (the rules in the real rules engine, needs `firebase login`). The first two need `npm install --no-save playwright@1 && npx playwright install chromium`.
- **App icons:** every icon in `public/` (favicon, Home Screen, manifest, maskable) is drawn once in `tools/make_icons.mjs`. Change the art there and run `node tools/make_icons.mjs`; never edit the PNGs by hand.
- **Deploy:** `bash tools/deploy.sh` (rules, function, site) or `bash tools/deploy.sh --site` (rules and site only). Never `firebase init`; the config is hand-written. There is no CLI rollback for Hosting: roll back from the Firebase console's Hosting release history.

## The loop

1. **It starts as an issue.** A bug, a change, a roadmap idea. Open one with the matching template, or tell Claude and it opens one.
2. **Work happens on a branch named for the issue:** `fix/12-upload-retry`, `feat/20-rename-folder`.
3. **A pull request brings it back to `main`** with `Closes #12` in the body. CI runs the smoke test, the deck test and the function tests.
4. **Merging to `main` is the build.**
5. **A tag makes a release:** `git tag v1.1 && git push origin main --tags`. CI attaches a zip.
6. **Deploy** with `bash tools/deploy.sh`, then clear the `deploy pending` label.

## Labels

`bug` / `change` / `roadmap` / `testing` for type, `area: <part>` for where (`area: deck`, `area: drive`, `area: classify`, `area: auth`, `area: piles`), `priority: now` / `next` / `later`, `deploy pending` for merged-but-not-live, `blocked` for waiting on something.
