# Paper Trail v2 contract

The shared agreement every v2 feature branch builds on. If a feature needs something this file doesn't allow, change this file first, in its own small PR into `v2`, and rebase on it. Don't work around it in feature code.

Set up in #34, when `public/index.html` was split into modules with no change in behavior. `node tools/contract_check.mjs` (in CI) checks the parts a machine can check: no inline script in `index.html`, no import cycles, backend calls only from their owners, every event listed here, and the fake backend matching the real one.

Features this covers:

| Issue | Feature | Main modules |
|---|---|---|
| #15 | Drive stays connected (server-side Drive token) | `drive.js`, `auth.js`, `functions/` |
| #17 | Local-first outbox | `outbox.js` (new `outbox-db.js` allowed) |
| #18 | Safe to shred only once the Drive copy is confirmed | new `verify.js`, `piles.js` (Shred pile) |
| #19 | Stack mode: scan a pile and split it | `scanner.js`, `classify.js`, `functions/` |
| #20 | Per-field confidence, file confident cards in bulk | `deck.js`, `classify.js`, `functions/` |
| #21 | Remember corrections per sender | new `senders.js`, `classify.js`, `functions/` |
| #22 | Search everything | new `search.js`, `classify.js`, `media.js` (PDF text layer) |
| #23 | Paperless ledger | `piles.js` (Go paperless tab), `store.js` |

## Ground rules

- **One owner per module.** Edit a module you don't own only through its exported functions. If you need a new export from someone else's module, add the smallest one you can, and say so in the PR body.
- **Downward imports, upward events.** The import graph has no cycles. A lower module never imports a higher one; it emits an event the higher one listens for (see Events). `contract_check.mjs` fails on a cycle.
- **Backend calls stay with their owners.** Firestore only through `store.js`, Drive's fetch only in `drive.js`, the callable only in `classify.js`, Auth only in `auth.js`.
- **Both backends, same change.** A new backend method goes into `backend.js` and `tools/fake/fake-backend.js` in the same commit, and the fake gets a query-string switch for its failure case.
- **No behavior changes outside your issue.** No drive-by refactors in shared files; open an issue instead.
- **New files are fine and preferred** over growing a shared one. A new module gets a header comment naming its owner issue and what it owns, and a row in the module map below.
- **Timestamps are ISO 8601 strings** (`new Date().toISOString()`), dates without a time are `YYYY-MM-DD`, as today. No Firestore `Timestamp` objects.
- **Copy** follows voice-principles.md: no em dashes, no exclamation points, US spelling.

## Module map

All under `public/`. `index.html` holds only markup plus the stylesheet and script tags; the entry point is `js/main.js` (`<script type="module">`). jsPDF and pdf.js stay classic scripts in `<head>` and are read as the globals `jspdf` and `pdfjsLib`.

Import layers, lowest first. A module may import only from layers below it.

| Layer | Module | Owner | Owns |
|---|---|---|---|
| 0 | `config.js` | shared | Firebase config, Drive URLs, folder names, verdict labels, read limits, `DENIED`, `params`, `LOCAL`, `FAKE`. Constants only. |
| 0 | `ui.js` | shared | `$`, `esc`, `slug`, `cleanName`, `mb`, `errCode`, `reduceMotion`, `setStatus`, `setSaveNote`, `prefs` (localStorage), and the event bus `on` / `emit`. |
| 0 | `items.js` | #17, #20 (deck) | The in-memory session items: `items`, `newItem`, `findItem`, `deckItems`, `pendingUploads`, `clearItems`, `isPdf`. |
| 1 | `backend.js` | shared | `B`, the active backend (Firebase or the fake), and `initBackend()`. |
| 2 | `auth.js` | #15, #14, #3 | The sign-in gate, Sign in / Use a different account / Sign out, `currentUser()`, `watchUser()`, `reauthenticate()`, `showGate()`, `authMsg()`. |
| 2 | `store.js` | shared, #23 for paperless | Every Firestore read and write by name (`PATHS`, `checkAccess`, `getDriveConfig`, `setDriveConfig`, `watchDocs`, `watchPaperless`, `saveRecord`, `updateDoc`, `removeDoc`, `updateSender`). New collections get new named functions here. |
| 3 | `drive.js` | #15 | The Drive token (`saveToken`, `loadToken`, `currentToken`), `needsDrive` / `setNeedsDrive`, the account bar's Drive state and the Reconnect Drive banner (`renderDrive`), Drive REST (`drive`, `withRetry`, `DriveError`, `DRIVE_COPY`), the archive folders (`ensureFolders`, `resetFolders`), `uploadFile`. |
| 4 | `media.js` | shared, #22 for the text layer | `makeCanvas`, `canvasBlob`, `blobB64`, `openPdfDoc`, `renderPage`, `photoJpeg`, `photosToPdf`. |
| 5 | `classify.js` | #20, #21, #22, #19 (each its own field) | Building the request, `classifyItem(item, onProgress)`, `normalize()`, `readError()`, `READ_COPY`. |
| 5 | `outbox.js` | #17 | The upload queue after a swipe: `enqueue(item)`, `logShred(item)`, `runUploads()`, `clearOutbox()`, the leave-page warning. |
| 6 | `deck.js` | #20 | Adding documents, the open and read pipeline (`pump`), cards, swipe, Shred / Later / File, arrow keys, Needs attention. Exports `addEach`, `addAsOne`, `pump`, `renderDeck`. |
| 6 | `piles.js` | #18 (Shred pile), #23 (Go paperless) | The tabs, lists, counts and stats: `setDocs`, `setPaperless`, `resetPiles`, `renderPiles`. |
| 7 | `scanner.js` | #19, #32 | Scan document: camera, edge detection, capture, review and corners, flattening, page strip, toggles. Exports `sc`. |
| 8 | `main.js` | shared | Boot, the fake test hooks (`window.__PT__`), and what a sign-in or sign-out does across modules. No feature code. |

Reserved new modules (create them when the feature starts; same layer rules):

| Module | Owner | Layer | Notes |
|---|---|---|---|
| `outbox-db.js` | #17 | 1 | IndexedDB access for the outbox. Nothing else touches IndexedDB. |
| `verify.js` | #18 | 5 | Checks a filed document in Drive (`files.get` through `drive.js`), writes the verification fields through `store.js`. |
| `senders.js` | #21 | 3 | Reads and writes `users/{uid}/senders`, picks the rules to send with a read. |
| `search.js` | #22 | 6 | The search box and results. Subscribes with `store.watchDocs`; reads `text` chunks through new `store.js` functions. |

`css/app.css` is one file in sections. A feature adds rules to the section of the module that owns that UI, or, for a brand new surface, its own file `css/<module>.css` with a `<link>` added after `css/app.css` in `index.html`. Markup for a new surface goes inside the region of the page that owns it; prefer rendering into an existing container from JS.

## Session items (in memory)

What `newItem()` makes, one per document in hand:

| Field | Type | Meaning |
|---|---|---|
| `id` | number | Session-only id, counts up. |
| `name` | string | File name or "Scan, 2 pages" until Claude reads it. |
| `files` | File[] | One PDF, or one or more photos that become one PDF. |
| `kind` | `"pdf"` \| `"photos"` | |
| `thumb` | string | Object URL of page 1. |
| `numPages` | number | |
| `status` | see below | |
| `result` | object \| null | The normalized card from `classify` (the response's `result`). Edits on the card change it in place. |
| `error`, `progress`, `msg` | string | Copy shown on the card or in Needs attention. |
| `editing`, `confirmLeft` | boolean | Card state. |
| `mode` | `""` \| `"right"` \| `"left"` | The swipe. |
| `drive` | `{ driveId, driveUrl }` \| null | Set once the upload finished, so a retry doesn't upload twice. |
| `saved` | boolean | The `docs` record exists. |
| `docId` | string \| null | Its Firestore id, set by `saveRecord`. |

Statuses: `loading` (opening the file) → `queued` → `reading` → `ready` (on the deck) → `filing` (right swipe, in the outbox) or `logging` (left swipe) → `done`. Off the deck: `error` (couldn't open or read; Try again) and `failed` (couldn't file or log; Try again). `deckItems()` is `loading`, `queued`, `reading`, `ready`.

Reserved item fields: #17 `outboxId` (string, the IndexedDB key); #19 `stackId` (string) and `split` (`{ from, to }`, zero-based page indexes into the scanned stack); #20 `confident` (boolean, every field at or above the threshold).

## Firestore data model

Everything a person owns lives under `users/{uid}/`. The rules allow only the signed-in owner of that uid on the allowlist. Anything outside `users/` is denied to every client by the catch-all rule, which is how server-only data stays server-only (rules are OR-ed, so a deny can't be carved out of `users/{uid}/{document=**}`).

### Now

**`users/{uid}/docs/{autoId}`**, one per sorted document. Written by `store.saveRecord`, listed newest first by `filedAt` (up to 1,000).

| Field | Type | Notes |
|---|---|---|
| `title`, `docType`, `issuer`, `summary`, `verdictReason`, `retention` | string | From the card. |
| `docDate` | string | `YYYY-MM-DD` or `""`. |
| `folder` | string | One of `FOLDER_NAMES`. |
| `filename` | string | No extension. |
| `verdict` | `"shred"` \| `"scan_shred"` \| `"keep_original"` | |
| `sensitive` | boolean | |
| `paperless` | `{ possible, issuer, how }` | |
| `pages` | number | |
| `filed` | boolean | `true` after a right swipe filed it to Drive. |
| `driveId`, `driveUrl` | string | `""` when not filed. |
| `physical` | `"to_shred"` \| `"shredded"` \| `"keep"` \| `"stored"` | Where the paper is. |
| `filedAt` | ISO string | When it was logged. |
| `shreddedAt` | ISO string | Set by Mark shredded. |
| `partUrls` | string[] | Read only, from artifact-era records split into parts. |

**`users/{uid}/paperless/{senderKey}`**, one per sender that offers e-delivery, made the first time one is filed.

| Field | Type | Notes |
|---|---|---|
| `issuer` | string | Display name. |
| `how` | string | Claude's one-line how-to. |
| `status` | `"todo"` \| `"done"` \| `"skip"` | |
| `firstSeen` | ISO string | |
| `doneAt` | ISO string | Set by Switched. |

**`users/{uid}/config/drive`**: `{ root, folders: { [folderName]: id }, updatedAt }`, the Paperwork Archive folder IDs. Its read after sign-in is also the allowlist probe.

**`senderKey`** is `slug(issuer)` from `ui.js` (lowercase, hyphens, 60 characters at most), the same key the paperless docs already use. #21's senders and #23's ledger share it.

### Reserved for v2

A record written before v2 has none of these fields. Every feature treats a missing field as the pre-v2 behavior (listed per feature) and never back-fills old records unless its issue says to.

**#17 Local-first outbox.** The queue itself lives on the phone (IndexedDB database `paper-trail`, object store `outbox`, keyed by `outboxId`), holding the files, the card and the swipe until the upload and the log both land. Firestore gets the status:

| Field on `docs` | Type | Meaning |
|---|---|---|
| `uploadState` | `"waiting"` \| `"uploading"` \| `"filed"` \| `"failed"` | Right swipes only. Missing on a pre-v2 record: `filed` decides. |
| `uploadError` | string | A `DRIVE_COPY` key when `failed`. |
| `uploadAttempts` | number | |
| `queuedAt`, `uploadedAt` | ISO string | |
| `outboxId` | string | `crypto.randomUUID()`; also the doc id when the outbox writes the record itself (`store.putDoc(id, rec)`, a new export, so a retry can't make a second record). |

**#18 Safe to shred.**

| Field on `docs` | Type | Meaning |
|---|---|---|
| `verifiedAt` | ISO string | When the Drive copy was found and checked. |
| `drivePageCount` | number | Pages in the Drive file, compared with `pages`. |
| `verifyState` | `"pending"` \| `"verified"` \| `"mismatch"` \| `"missing"` | |
| `safeToShredAt` | ISO string | `verifiedAt` plus the optional hold. The Shred pile counts a paper as safe only when this is set and in the past. |

Pre-v2 records (no `verifyState`) count as safe, as today. A left swipe (`filed: false`) has nothing to verify: `safeToShredAt` is its `filedAt`. The hold length is a constant in `verify.js`.

**#20 Confidence.**

| Field on `docs` | Type | Meaning |
|---|---|---|
| `confidence` | `{ [field]: number }` | 0 to 1, from the response, for the fields listed under Classify. |
| `reviewed` | boolean | `true` when the card was opened and looked at before filing; `false` when it went out in a bulk file. |

The threshold is `CONFIDENT = 0.85` in `classify.js`.

**#21 Senders.** `users/{uid}/senders/{senderKey}` (already allowed by the rules):

| Field | Type | Meaning |
|---|---|---|
| `issuer` | string | Display name. |
| `aliases` | string[] | Other issuer spellings that map here. |
| `folder` | string | One of `FOLDER_NAMES`, or missing. |
| `verdict` | verdict | Or missing. |
| `docType` | string | Or missing. |
| `filenamePattern` | string | Tokens `{date}`, `{issuer}`, `{type}`, for example `{date}_duke-energy-electric-bill`. Or missing. |
| `count` | number | Documents seen from this sender. |
| `source` | `"correction"` \| `"manual"` | |
| `updatedAt` | ISO string | |

Also on `docs`: `senderKey` (string) and `corrected` (string[], the card fields changed before filing).

**#22 Search.**

| Where | Field | Meaning |
|---|---|---|
| `docs` | `searchText` | string, lowercase, at most 2,000 characters: title, issuer, docType, summary, folder, filename, amount. What the in-app search reads, since the docs list is already loaded. |
| `docs` | `amount` | number or missing, the main dollar amount. |
| `docs` | `textChunks` | number of chunks below, 0 or missing when there's no full text. |
| `docs` | `textChars` | number, the full text's length. |
| `users/{uid}/docs/{docId}/text/{n}` | `{ n, text, fromPage, toPage }` | The full text in chunks, `n` from 0. Each `text` is at most 250,000 characters, which stays under Firestore's 1 MiB document limit even at 4 bytes a character. A subcollection keeps the docs list light: `watchDocs` never loads it. |

The hidden text layer in each Drive PDF is #22's change to `media.photosToPdf` (photos) and an upload-time option for PDFs.

**#23 Paperless ledger.** On `users/{uid}/paperless/{senderKey}`:

| Field | Type | Meaning |
|---|---|---|
| `status` | `"todo"` \| `"requested"` \| `"waiting"` \| `"confirmed"` \| `"cant_stop"` \| `"skip"` | Pre-v2 `"done"` reads as `"confirmed"`; write the new values only. |
| `steps` | string | The person's own go-paperless steps, edited in the app. `how` stays Claude's. |
| `requestedAt`, `confirmedAt` | ISO string | `doneAt` on pre-v2 records reads as `confirmedAt`. |
| `checkBackOn` | `YYYY-MM-DD` | When to look again (a billing cycle after requesting). |
| `lastSeenAt` | ISO string | The newest document filed from this sender. |
| `stillMailing` | boolean | Set when a new scan arrives from a sender that is `confirmed`. |
| `stillMailingAt` | ISO string | |

The stats row's "Paperless" counts `confirmed` (and pre-v2 `done`).

**#15 Drive token, server side.** A top-level collection the rules already deny to every client, read and written only by Cloud Functions through the Admin SDK:

`driveAuth/{uid}`: `{ refreshToken, scope, email, updatedAt }`, plus `accessToken` and `accessTokenExp` (ISO) as a cache if useful. Never under `users/{uid}`, where the owner could read it. `tools/rules-check.mjs` already asserts the owner can neither read nor write it; keep those cases.

New callables (names reserved): `driveConnect` (`{ code }` from Google's code flow → `{ ok, email }`; stores the refresh token) and `driveToken` (`{}` → `{ token, exp }`, an access token minted from the stored refresh token; `failed-precondition` with `details.code: "drive_not_connected"` when there is none). On the page, `drive.js` asks `driveToken` when `currentToken()` is empty or a call answers 401, and only falls back to Reconnect Drive when that fails. Other modules still never read the token.

This needs things only Bryce can do, so the PR must spell them out: an OAuth client (Web application) in the Google Cloud console for `paper-trail-bw` with the authorized origins, and its client secret stored with `firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET --project paper-trail-bw`. Claude never handles the secret value.

## Backend interface

`B` from `backend.js`. Firebase and the fake implement the same methods:

| Method | Returns | Used by |
|---|---|---|
| `onUser(cb)` | cb gets `{ uid, email }` or `null` | `auth.js` |
| `signIn()` | `{ uid, token }` | `auth.js` |
| `reconnect()` | `{ uid, token }` | `auth.js` |
| `signOut()` | | `auth.js` |
| `classify(payload)` | the callable's response | `classify.js` |
| `watch(name, order, cb, err)` | unsubscribe | `store.js` |
| `add(name, data)` | new id | `store.js` |
| `get(path)` | data or `null` | `store.js` |
| `set(path, data)`, `update(path, data)`, `del(path)` | | `store.js` |
| `fetch(url, opts)` | `Response` | `drive.js` |

Paths are relative to `users/{uid}/`. Reserved additions: `call(name, data)` for the new callables (#15, and #19 if the split is its own callable), and `watchSub(path, cb, err)` for a subcollection (#22's text, only if search needs it live). Add both to the fake in the same change.

## Classify request and response

The page sends one call per document through `B.classify(payload)`; `functions/lib.js` validates it. New fields are optional on both sides, so an old page and a new function (or the other way round) still work. Each feature adds its field to the function's `validate`, schema, prompt and `normalize`, and to the page's `normalize` in `classify.js`. Keep each feature's additions in its own clearly marked block in `lib.js` to keep rebases clean.

### Request

| Field | Type | Now or reserved |
|---|---|---|
| `kind` | `"pdf"` \| `"images"` | now |
| `pdf` | base64 string | now, `kind: "pdf"` |
| `images` | `[{ type: "image/jpeg" \| "image/png" \| "image/webp", data }]`, at most 10 | now, `kind: "images"` |
| `totalPages` | number | now |
| `task` | `"classify"` \| `"split"` | #19. Missing means `classify`. |
| `include` | string[], for example `["fullText"]` | #22. Asks for the full text; it costs output tokens, so it is opt-in. For a PDF that already has a text layer, prefer pdf.js's text on the page and don't ask. |
| `senderRules` | `[{ senderKey, issuer, aliases?, folder?, verdict?, docType?, filenamePattern? }]`, at most 50, 2,000 characters in all | #21. The rules most likely to apply; the prompt tells Claude to follow a matching rule. |

The whole request stays under `MAX_SEND_CHARS` (24 MB of base64).

### Response

`{ result, model }` today. Reserved additions:

| Field | Type | Owner | Meaning |
|---|---|---|---|
| `result.confidence` | `{ title, docType, issuer, docDate, folder, filename, verdict, paperless }`, each 0 to 1 | #20 | How sure Claude is of each field. |
| `result.senderKey` | string | #21 | `slug(issuer)`, computed by `normalize`, not by Claude. |
| `result.ruleApplied` | string | #21 | The `senderKey` of the rule Claude followed, if any. |
| `result.amount` | number | #22 | The main dollar amount, if there is one. |
| `fullText` | string, at most 500,000 characters | #22 | Only when `include` asked for it. Outside `result`, so the card stays small. |
| `splits` | `[{ from, to, title, confidence }]` | #19 | Only for `task: "split"`: zero-based, inclusive page ranges into the images sent, in order, covering every page. No `result` then; each part is classified with a normal call afterward. |

Errors keep today's shape: an `HttpsError` whose `details.code` is a `READ_COPY` key. A new code gets its copy in `READ_COPY` in the same change.

## Events

`on(type, fn)` and `emit(type, detail)` from `ui.js`. Synchronous: listeners run in subscription order before `emit` returns, so an event behaves like the direct call it replaces. Lower modules use events to reach higher ones. An event not in this table fails `contract_check.mjs`; add the row in the PR that adds the event.

| Event | Detail | Emitted by | Listened by | When |
|---|---|---|---|---|
| `auth:token` | `{ token, uid }` or `null` | `auth.js` | `drive.js` | A sign-in returned a Drive token, or Sign out cleared it. |
| `drive:connected` | none | `drive.js` | `outbox.js` | Reconnect Drive or Connect Drive got a fresh token. |
| `items:changed` | none | `outbox.js` (and any module below the deck that changes an item) | `deck.js` | An item's status changed; the deck redraws. |
| `session:started` | `{ uid, email }` | `main.js` | features | The allowed account is in and the app is showing. |
| `session:ended` | none | `main.js` | features | Signed out. |
| `item:added` | item | `deck.js` | features | A document joined the session (chosen, photographed or scanned). |
| `item:ready` | item | `deck.js` | features | Claude read it and the card is ready. |
| `item:decided` | `{ item, dir }` | `deck.js` | features | Swiped, before it goes to the outbox. `dir` is `"right"` or `"left"`. |
| `record:saved` | `{ item, record, id }` | `store.js` | features | Its `docs` record was written for the first time. |
| `outbox:changed` | `{ waiting, uploading, failed }` | `outbox.js` | #17's history view | Reserved, #17. |
| `doc:verified` | `{ id, verifyState }` | `verify.js` | `piles.js` | Reserved, #18. |
| `sender:saved` | `{ senderKey }` | `senders.js` | `deck.js` | Reserved, #21. |

### Functions modules call on each other

The exports in the module map are the API. The ones features are expected to use across modules:

- Deck: `addEach(files)`, `addAsOne(files, name)` (scanner, #19 stack splits), `pump()`, `renderDeck()`.
- Outbox: `enqueue(item)` for a right swipe, `logShred(item)` for a left swipe. #17 may add `retry(outboxId)` and `history()`.
- Drive: `uploadFile(blob, name, parentId)`, `ensureFolders()`, `drive(url, opts)` for any other Drive REST call (#18's `files.get`), `renderDrive()`.
- Store: the named functions only. New ones reserved: `putDoc(id, rec)` (#17), `watchSenders`, `getSender`, `setSender` (#21), `getText`, `setText` (#22), `updateSender` already exists for #23.
- Classify: `classifyItem(item, onProgress)`, `normalize(r)`, `readError(e)`. #19 adds `splitStack(images)`.
- Auth: `currentUser()`, `reauthenticate()`.

## Tests and checks

- `node tools/contract_check.mjs`: this contract's machine-checkable rules.
- `node tools/smoke_test.mjs`, `node tools/deck_test.mjs`, `node tools/scanner_test.mjs`: the page against the fake. A feature adds its own checks to `deck_test.mjs` in its own numbered block, or a new `tools/<feature>_test.mjs` plus a CI step.
- `node --test functions/test/*.test.mjs`: the function. Each new request or response field gets a test.
- `node tools/rules-check.mjs`: needs `firebase login`, so it runs in `tools/deploy.sh`, not CI. A new collection gets ALLOW and DENY cases.
- The fake test hooks are `window.__PT__ = { addFiles, addPhotos, items(), scanner }` and `window.__PT_FAKE__` (the fake's state). Add to them; don't rename.
