# Paper Trail web contract (v2, Direction A)

The shared agreement for bringing the web app up to the iPhone app (ios-v0.5), issue #83. Five feature agents build on it in parallel, each on its own branch into `web-v2`. If a feature needs something this file doesn't allow, change this file first in a small PR into `web-v2`, then rebase. Don't work around it in feature code.

It replaces `docs/v2-contract.md` (#34). That file planned v2 before the iPhone app existed; where the two disagree, this file and `ios/ARCHITECTURE.md` win, because the web app must read and write the same data as the iPhone app for the same uid.

Sources of truth, in order:

1. `docs/design-spec.md` (Direction A, with Bryce's decisions) and `design/ios-directions/direction-A.png`: how every screen looks and behaves.
2. `ios/ARCHITECTURE.md`: the Firestore data model, the classify contract, the Drive rules and the auth design. The Swift code in `ios/PaperTrail` is the reference for behavior (deck, skip, undo hold, outbox, verification, year folders, sender rules, stack split, page viewer, Scan menu).
3. This file: how those map onto web modules, who owns each, and how they talk.

`node tools/contract_check.mjs` (CI, and before every merge while Actions is out of minutes) checks the parts a machine can check. See "Checks" at the end.

## Ground rules

- **Static files, no build step.** `public/` is served as is: HTML, CSS, native ES modules, the Firebase JS SDK from gstatic (`FIREBASE.version` in `config.js`), and libraries from cdnjs with an exact version. No bundler, no npm in the page.
- **Same data as the iPhone app.** Every Firestore path, field name and value below is the iPhone app's (`ios/ARCHITECTURE.md`, "Firestore data model"). New fields are optional and added to both this file and ARCHITECTURE.md in the same PR. Never rename or repurpose a field; a record the iPhone app wrote must read correctly on the web and the other way round.
- **One owner per module.** Edit a module you don't own only through its exports. If you need a new export, add the smallest one you can and name it in the PR body.
- **Downward imports, upward events.** No import cycles. A lower module reaches a higher one with an event (see Events).
- **Backend calls stay with their owners.** Firestore only in `store.js`, Drive's fetch only in `drive.js`, the classify callable only in `classify.js`, other callables only in `auth.js` (driveToken) and `classify.js`, Firebase Auth only in `auth.js`, IndexedDB only in `db.js`.
- **Both backends, same change.** A new backend method goes into `backend.js` and `tools/fake/fake-backend.js` together, with a query-string switch for its failure case.
- **The design system is the only source of looks.** Colors, type, spacing, radii, shadows and springs come from `css/tokens.css`. Pills, chips, banners, empty states, rows, sheets, menus, toasts and primary buttons come from `js/ui/`. A verdict is drawn only by `verdictBadge()`. No feature keeps its own hex values (ARCHITECTURE #49).
- **Copy** is the spec's, word for word, and follows voice-principles.md: no em dashes, no exclamation points, US spelling.
- **Dates** are ISO 8601 strings, day-only dates are `YYYY-MM-DD`, as both apps write them. No Firestore `Timestamp` objects.
- **Every swipe has a button twin** (spec 1.7), and keyboard: the deck's arrow keys are the twins on desktop.

## Owners

| Owner | Builds | Issues |
|---|---|---|
| **auth** | Sign-in screen (4.1), staying signed in with no check on open (#14), Drive through the server token flow (#15), Reconnect Drive (4.16, the auth half), the Settings shell (4.9: account, Google Drive, Sign out, footer) | #14, #15, #3, #4 |
| **outbox** | The local pipeline in IndexedDB, the upload engine (resumable upload, retries and backoff, offline, the undo hold release), md5 and page-count verification (#18), year folders (decision 2), the Outbox screen (4.4) and Earlier, the accessory states (3.7), Send back to the deck, Settings "Shred hold" | #17, #1, #18, #15 (resume after reconnect) |
| **deck** | Sort (4.2): the card, swipes and overlays, the action row, Skip and the Skipped set (#77), the undo hold, the check-fields sheet (3.8, #20), sender rules (#21) and the Sender rules screen (4.12), the card detail (4.13), Keep original confirm (4.14), bulk filing, Settings "Sender rules" and "Offer to file confident cards together". Owns `js/ui/` and `css/components.css` after this PR | #20, #21, #33, #77, #27 |
| **capture** | The Scan menu's three sources, the scanner, Import from Files and Photos (4.15), the scan review with split and join (4.11, #19, #54), the page viewer (4.11.1, #78), duplicates (#2), the PDF and text layer, OCR text | #19, #54, #74, #78, #79, #2, #32 |
| **browse** | Piles (4.5), Search with the text layer and Also in Drive (4.6, #22), Paperless and the sender detail (4.7, #23), the read-only document view (4.13 read-only) | #18 (safe rule and hold, piles side), #22, #23, #24, #25 |

Shared files (this PR's): `router.js`, `shell.js`, `css/shell.css`, `css/tokens.css`, `index.html` (each view's region is its owner's), `main.js`. Change them only with a reason in the PR body.

## Module map

All under `public/js/`. Entry `main.js` (a module script in `index.html`). jsPDF and pdf.js stay classic scripts read as the globals `jspdf` and `pdfjsLib`. Layers, lowest first: a module imports only from lower layers. "Now" is what exists after the foundation; "new" is reserved for its owner to create.

| Layer | Module | Owner | Owns |
|---|---|---|---|
| 0 | `boot.js` | auth | A classic script in `<head>`, run before the first paint: marks `<html>` with `pt-cached` when `pt-last-user` is in localStorage, so a cached account sees the app at once, never the sign-in screen (#14). No imports. |
| 0 | `config.js` | shared | Constants only: Firebase config, Drive URLs, `FOLDER_NAMES`, `YEAR_FOLDERS`, `VERDICT`, read limits, `DENIED`, `VERSION`, `APP_NAME`, `params`, `LOCAL`, `FAKE`, and the lab's `LAB`, `LAB_HOSTS`, `LAB_SITE`, `DATA_ROOT` (see "Lab"). |
| 0 | `ui.js` | shared | `$`, `esc`, `slug`, `cleanName`, `mb`, `errCode`, `reduceMotion`, `prefs` (localStorage), the event bus `on` / `emit`, the legacy `setStatus` / `setSaveNote`. |
| 0 | `md5.js` | outbox | `md5(bytes)` hex, for Drive's `md5Checksum` (#18); `sha256Hex(bytesOrBlob)` for `contentHash` (#2). |
| 0 | `items.js` | deck | The deck's in-memory items, already in `PipelineItem` names and stages (`stage`, `decision`, `decidedAt`, `card`, `unsureFields`, `skippedAt`, `createdAt`, `uid`), plus the legacy outbox's `status`. Retired when the deck moves onto `db.js`; nothing new may import it. |
| 0 | `ui/icons.js` | deck | `icon(name)`: the SF Symbol names the app uses, as line drawings. |
| 0 | `ui/motion.js` | deck | `spring(name)` for the Web Animations API (reads the CSS springs), `reduceMotion()`, `haptic(kind)`. |
| 1 | `ui/components.js` | deck | Every shared component as an HTML string: `verdictBadge`, `sensitiveChip`, `retentionChip`, `unsurePill`, `filterChip`, `choiceChip`, `statusPill`, `progressRing`, `docThumb`, `primaryButton`, `button`, `glassCircle`, `avatarButton`, `initialsOf`, `banner`, `emptyState`, `navBar`, `section`, `row`, `valueRow`, `toggleRow`, `radioRow` (with `mono`, and `field` for "Something else" as a text field in place), `segmented`, `unsureRow`, `highlight`, `outboxAccessory`, `accessoryTitle`. |
| 1 | `ui/sheet.js` | deck | `openSheet` (medium and large detents, grabber, drag to dismiss, focus trap), `actionSheet` (the confirmation dialog), `sheetOpen()`. |
| 1 | `ui/menu.js` | deck | `openMenu`, `bindMenu`, `closeMenu`: the glass pull-down menu. |
| 1 | `ui/toast.js` | deck | `toast(text, { action })`, `hideToast()`. |
| 1 | `router.js` | shared | Hash routes, per-tab stacks, `go`, `push`, `back`, `replaceQuery`, `route`, `lastTab`, `registerScreen`, `screens`. Emits `route:changed`. |
| 1 | `backend.js` | shared | `B` (Firebase, or the fake with `?fake`) and `initBackend()`. |
| 1 | `db.js` (new) | outbox | IndexedDB: the pipeline store, blobs, review sessions (see "Local pipeline"). Emits `pipeline:changed`. |
| 2 | `auth.js` | auth | Session and sign-in: `currentUser()`, `watchUser()`, `startAuth()`, `finishReturn()`, `cachedSession()`, `markNotAllowed()`, the web OAuth code flow, `driveAccessToken()`, `invalidateDriveToken()`, `reconnectDrive()`, `driveStatus()`, `signOut()`, the sign-in screen (`showGate`, `hideGate`), the Reconnect Drive banner (`mountReconnectBanner`, `watchDriveUi`). Emits `drive:status`. |
| 2 | `store.js` | browse (shared: each owner adds its own named functions) | Every Firestore read and write by name: docs, paperless, senders, config. Capture added `findByHash`, `watchSenders`, `setSenderRule`, `deleteSenderRule`; outbox `getDoc`, `putDoc`, `getSender`, `createSender`, `getSettings`, `watchSettings`, `saveSettings`. |
| 3 | `drive.js` | outbox | Drive REST: `drive()`, `withRetry`, `DriveError`, `DRIVE_COPY`, `ensureFolders`, `ensureYearFolder`, `startUpload`, `putChunk`, `uploadStatus`, `metadata`, `download`, `trash`, `search`, `CHUNK`. Gets tokens only from `auth.driveAccessToken()` (`auth.invalidateDriveToken()` on a 401, then one more try). `needsDrive`, `setNeedsDrive` (the outbox's pause); `reconnect()` runs `auth.reconnectDrive()`. The Reconnect banner is auth's; `renderDrive()` is a legacy alias for `auth.renderReconnect()`. |
| 3 | `settings.js` | auth | The Settings sheet from the avatar; `registerSettingsSection` for every other owner's rows. |
| 4 | `lab.js` | lab | The no-AI lab build (#92), inert unless `LAB`: the Lab badge and sign-in copy (`mountLabChrome`), lab settings (`labSettings`, `compareEnabled`, `setCompare`), `COMPARE_FIELDS`, `agreementStats(records)`, `LAB_COPY`, and the Settings "Lab" section (order 25). See "Lab". |
| 4 | `media.js` | capture | Canvas, pdf.js and jsPDF helpers: page renders, photos to PDF, the hidden text layer (#22), `pdfText(file)` for the PDF's own text. `ocr()` is Tesseract.js (`tesseractOcr`, the same function, is the lab's fallback, #101), and `renderPageRgba()` draws a PDF page's pixels for the lab's OCR. |
| 5 | `classify.js` | deck (capture owns `proposeSplit`) | The read: `buildPayload`, `classifyItem(item, onProgress, { senderHints })` (always `wantConfidence: true`), `normalize` (keeps `confidence`, `alternatives`, `appliedRule`), `readError`, `readErrorCode`, `READ_COPY`, confidence (`FIELD_ORDER`, `unsureFields`, `UNSURE_BELOW = 0.75`, `isConfident`, `markConfident`), sender rules (`applySenderRule`, `renderFilename`, `patternFromFilename`: the twins of `functions/lib.js` and `SenderRuleEngine`), `proposeSplit(pages)`, `readItem(item, { pdf })`, `setSenderRules`, `FILENAME_TOKENS`, `ruleFromCard`, `folderName`. A reading queue with at most two reads at once. |
| 5 | `senders.js` | deck | Sender rules: watches `senders` while signed in and hands them to `classify.setSenderRules`; `ruleList()`, `ruleFor`, `saveRule(rule)`, `forgetRule(key)`, `rememberSender(card)` (the check-fields sheet and card detail; never throws), and the Sender rules screen (4.12, #21) in a sheet over Settings (`openSenderRules`). |
| 5 | `outbox.js` | outbox | The engine: `release(id)` after the undo hold, `retry(id)`, `retryAll()`, `sendBack(id)`, `status()`, `entries()`, `refreshStatus()`, resume on load. The pure rules the view and tests share (`driveTarget`, `buildRecord`, `searchTerms`, `accessoryState`, `subtitle`, row copy, `COPY`, `RETRY_DELAYS`, `UNDO_MS`). Legacy `enqueue(it)` / `logShred(it)` / `clearOutbox()` for the in-memory deck until it moves onto `db.js`. Emits `outbox:status`, `doc:verified`. |
| 6 | `outbox-view.js` | outbox | The Outbox screen (`registerScreen("outbox")`), Earlier (`"earlier"`), the Shred hold settings row and picker (`registerSettingsSection` id `shred-hold`, order 31), `shredHoldDays()`, `holdLabel(d)`. Styles in `css/outbox.css`. |
| 6 | `deck.js` | deck | Sort: the deck, card, gestures, overlays, action row, undo hold, Skip and the Skipped sheet, bulk file, Keep original confirm, empty states, keyboard, the "Sorting" Settings section. Still adds documents and reads them (`addEach`, `addAsOne`, `pump`) until capture.js and db.js take over. Imports `shell.js` for `bindScanMenu` (the empty states' Scan menu, #79). |
| 6 | `checkfields.js` | deck | The check-fields sheet (3.8): `openCheckFields({ card, fields, focus })` resolves `{ card, remember }` or null; `openFolderPicker(current)`. |
| 6 | `detail.js` | deck | Card detail and edit (4.13), and its read-only mode for filed docs (`registerScreen("card")`, `registerScreen("doc")`). Imports `deck.js`; `main.js` imports it once so the screens register. |
| 5 | `browse.js` | browse | What Piles, Search and Paperless share: the live library (docs, paperless and `config/settings` listeners from `session:started`, `onBrowse(fn)`), the safe-to-shred rule (`shredState`), the shred hold (`holdDays`), PileFormat strings, document rows (labeled thumbnail, trailing swipe actions with keyboard and menu twins), the Reconnect banner on Piles, and the read-only document view (`openDoc(id, words)`, which registers `"doc"` on first use unless `detail.js` already did). |
| 6 | `piles.js` | browse | Piles (4.5): Shred, Keep and All filed, the safe banner, Mark n as shredded, Put away and Take out, the Sensitive filter, and the Settings "Shred hold" row (order 31; joins deck's Sorting section when it's there). |
| 6 | `search.js` | browse | Search (4.6): chips, recents (per device, localStorage `pt-recent-searches` until `db.js` `kv` lands), results, highlight, snippets, Also in Drive (`drive.search()` when outbox adds it, the Drive REST call through `drive()` until then). |
| 6 | `paperless.js` | browse | Paperless (4.7), the sender detail (`registerScreen("sender")`) and the Done list (`registerScreen("done-senders")`). |
| 7 | `scanner.js` | capture | The camera scanner (edges, flattening, auto-capture). Exports `sc`. |
| 7 | `capture.js` (new) | capture | Listens for `capture:request`; Files and Photos pickers; unsupported-file alert; hands pages to the review. |
| 7 | `review.js` (new) | capture | The scan review (4.11): groups, split and join, Split into documents, duplicates, Send to the deck. |
| 7 | `viewer.js` (new) | capture | The full-screen page viewer (4.11.1). |
| 8 | `shell.js` | shared | The app shell: tab views, pushed screens, nav bars, the dock (accessory and tab bar, search mode), avatar, the Scan menu, keyboard. Exports `scanMenuItems`, `bindScanMenu`, `setAccessoryHidden`, `shellSignedIn`, `startShell`, `pushScreen`, `goTab`, `currentTabEl`. |
| 9 | `main.js` | shared | Boot, the fake test hooks (`window.__PT__`), what a sign-in or sign-out does across modules. No feature code. |
| 0 | `lab/rules/text.js` | lab | The no-AI rules engine's text matching (#92): OCR-folded phrase search (exact, squashed, near), word-bounded names, title case. Pure, no DOM. |
| 0 | `lab/rules/fields.js` | lab | Dates (labels, ranges, OCR slips), tax years, labeled amounts, last 4 digits. Pure, no DOM. |
| 0 | `lab/rules/tables.js` | lab | Document type to folder, verdict, retention, paperless, filename and title words; paperless how-to by sender kind. Pure data. |
| 0 | `lab/rules/sensitive.js` | lab | Full SSN, account and routing numbers, medical terms. Pure, no DOM. |
| 0 | `lab/rules/compare.js` | lab | Field-by-field agreement of two cards (compare mode and `tools/lab/eval-rules.mjs`): `agreement(a, b)`, `docKind`, `sameIssuer`. Pure, no DOM. |
| 1 | `lab/rules/senders.js` | lab | Known senders (`lab/rules/known-senders.json`, extensible), letterhead, label values, agencies, vital record issuers. Pure, no DOM. |
| 1 | `lab/rules/types.js` | lab | The ordered document-type detectors and `scoreTypes`, `MIN_SCORE`. Pure, no DOM. |
| 1 | `lab/rules/templates.js` | lab | Title, filename and summary templates in Claude's card shapes. Pure, no DOM. |
| 2 | `lab/rules/engine.js` | lab | `readByRules({ pages, pageCount, filename, senderRules, today })`: the classify-shaped card with per-field confidence, alternatives and `rules` (why), with no AI. Sender rules applied like `functions/lib.js`. Runs in Node for `node --test tools/lab/*.test.mjs`. |
| 3 | `lab/engine.js` | lab reader | The one door to the rules engine: `runRules(textPages, meta)`, an adapter over `lab/rules/engine.js` `readByRules`. |
| 4 | `lab/rules-worker.js` | lab reader | A module Web Worker that runs `runRules` off the main thread. |
| 0 | `lab/ppocr.js` | lab OCR | PaddleOCR's PP-OCRv5 mobile pipeline in plain JavaScript (#101): detector input, DB boxes, upright line crops, CTC decoding, lines in reading order (`readPage`). Pure apart from the ONNX Runtime sessions it's handed; also used by `tools/lab/ocr-bench.mjs`. |
| 1 | `lab/ocr-worker.js` | lab OCR | A module Web Worker: ONNX Runtime Web 1.30.0 (WebGPU, else WebAssembly SIMD on one thread), the models from Hosting's `/lab-models/pp-ocrv5-mobile/` kept in Cache Storage, and pdf.js 5 drawing PDF pages on OffscreenCanvas, so OCR never runs on the main thread (#101, #98). |
| 5 | `lab/ocr.js` | lab OCR | The lab's OCR from the page's side: `ocrImage`, `ocrPdfPages` (one page at a time, with progress, the worker drawing the pages where it can), `ocrStatus`, `yieldToBrowser`. Falls back to `media.tesseractOcr` when PaddleOCR can't load. Imported by `lab/reader.js` and by `review.js`, which reads with it only in the lab. |
| 6 | `lab/reader.js` | lab reader | The lab's reader, no AI: `READER`, `readText` (pdf.js text layer, then on-device OCR through `lab/ocr.js` for pages without text, with progress), `labRead`, `localSplit` (stack mode by page markers), `progressCopy`. Imported by `classify.js`. |
| 6 | `lab/compare.js` | lab reader | Compare mode: records each lab read, asks `classify.claudeRead` in the background when it's on, scores the fields (`fieldAgrees`, `compareCards`, `SCORED`, `ROUTING`), the card chip (`labChip`), the compare sheet (`openCompare`) and `savePicks` (ground truth, sender rules). Imported by `deck.js`. |
| 7 | `lab/stats.js` | lab reader | Lab Stats (`openLabStats`, `computeStats`), opened from the Lab Stats row in the Settings section `lab.js` draws. |

CSS: `css/tokens.css` (tokens only), `css/components.css` (shared components), `css/shell.css` (the shell and sign-in), `css/app.css` (legacy screens, aliasing the old variable names to tokens; each owner deletes its section as it rebuilds). A new surface may add `css/<module>.css`, linked after `components.css`. `css/lab.css` (owner lab) draws only under `html.pt-lab`.

## Screens and routes

Phone first, exactly like the spec at 390 to 430 px. Wider than that, the same column (max 480 px) is centered on `--desk`. Keyboard: 1 to 4 switch tabs, `/` opens Search, Escape goes back or closes a sheet or menu, the deck's arrows are its swipes.

| Route | Screen | Owner | Notes |
|---|---|---|---|
| `#/sort` | Sort deck (4.2) | deck | Renders into `#sort-body`. Subtitle element `#deck-count`. Toolbar: Scan menu (`[data-scan-menu]`) and avatar, both shell's. |
| `#/piles` | Piles (4.5) | browse | Renders into `#piles-body`. |
| `#/paperless` | Paperless (4.7) | browse | Renders into `#paperless-body`; subtitle `#paperless-subtitle`. |
| `#/search?q=` | Search (4.6) | browse | Renders into `#search-body`. The field is the shell's (`#search-field`); listen for `search:input` / `search:submit`, or read `route().query.get("q")` on `route:changed`. |
| `#/<tab>/outbox` | Outbox (4.4) | outbox | Pushed from the accessory onto the current tab; the accessory hides while it shows. |
| `#/<tab>/outbox/earlier` | Earlier | outbox | |
| `#/sort/card:<itemId>` | Card detail and edit (4.13) | deck | Hides the accessory (`setAccessoryHidden`) for its Shred and File bar. |
| `#/<tab>/doc:<docId>` | Document view (4.13 read-only) | deck builds, browse pushes | From Piles and Search. |
| `#/paperless/sender:<senderKey>` | Sender detail | browse | |
| `#/paperless/done-senders` | Every Confirmed and Can't stop sender, from the grouped Done row | browse | |
| `#/auth/done?...` | Sign-in return (not a tab) | auth | See "Auth". |
| sheet | Settings (4.9) | auth | `openSettings()`; never a route. |
| sheet | Check fields (3.8), bulk file, Skipped (3.13), folder picker, Shred hold picker | deck, outbox | `openSheet()`. |
| full screen | Scanner, scan review (4.11), page viewer (4.11.1) | capture | Over the column; set `#app` inert while open, as the scanner does today. |

A pushed screen registers once at import: `registerScreen("outbox", { title: "Outbox", mount(el, { param, tab, query, body, setTitle }), unmount(el) })`. The shell draws its nav bar (large title, back button labeled with the screen below) and calls `mount` with `body` to render into. Until the owner registers it, the shell shows a placeholder for `outbox`.

## Firestore data model

Exactly `ios/ARCHITECTURE.md`, "Firestore data model". Summary for the web, with who writes what:

**`users/{uid}/docs/{id}`**: the card flattened in (`title`, `docType`, `issuer`, `docDate`, `summary`, `folder`, `filename`, `verdict`, `verdictReason`, `retention`, `sensitive`, `paperless {possible, issuer, how}`), plus `pages`, `filed`, `driveId`, `driveUrl`, `physical` (`to_shred`, `shredded`, `keep`, `stored`), `filedAt`, `shreddedAt`. Optional: `confidence {overall, fields, sparse}`, `fullText` (100,000 characters at most), `searchTerms` (lowercased tokens: title, issuer, docType, folder, year, amount), `amount` (string, "142.17"), `contentHash` (SHA-256 hex of the filed bytes), `sizeBytes`, `md5`, `verifiedAt`, `verifiedPages`, `source`.

- The web writes `source: "web"` on every doc it files (the iPhone app writes `"ios"`; pre-v2 web docs have none).
- **Safe to shred** (#18, one rule for both apps): a doc with `source` set is safe only when `verifiedAt` is set and the shred hold (`config/settings.shredHoldDays`, default 3) has passed since it; a left swipe (`filed: false`) has nothing to verify and is safe once the hold has passed since `filedAt`. A doc with no `source` (pre-v2 web) keeps the old rule: it's safe as soon as it's logged.
- The outbox writes the record (with `outboxId` as the doc id via `store.putDoc(id, rec)`, so a retry can't write two), then `verifiedAt`, `verifiedPages`, `md5`, `sizeBytes` once Drive's checksum matches.
- The fields `v2-contract.md` reserved and the iPhone app never adopted (`uploadState`, `verifyState`, `safeToShredAt`, `searchText`, `textChunks`, the `text` subcollection, `reviewed`, `corrected`, per-field `confidence` without `overall`) are not used. Search reads `fullText` and `searchTerms`.

**`users/{uid}/paperless/{slug(issuer)}`**: `issuer`, `how`, `status`, `firstSeen`, `doneAt`, plus optional `requestedAt`, `checkBackAt` (ISO), `steps [string]`, `stillMailingAt`, `lastSeen`, `mailHandledAt`. Status values are the iPhone app's: `todo` (To do), `requested`, `waiting_cycle`, `done` (Confirmed), `skip` (Can't stop). Pill copy comes from one `PAPERLESS_LABEL` map in `paperless.js`. The outbox creates a sender the first time a paperless-capable doc files (as today) and sets `stillMailingAt` and `lastSeen` when a new doc arrives from a sender already `requested`, `waiting_cycle` or `done`. Paperless screens only update status fields.

**`users/{uid}/senders/{slug(issuer)}`**: `key`, `issuer`, optional `folder`, `filenamePattern` (`{date}`, `{yyyy}`, `{mm}`, `{issuer}`, `{type}`), `verdict`, `docType`, `updatedAt`. Written by "Remember for this sender" and Settings, Sender rules.

**Lab build only (#92, `exp/no-ai`), under `users/{uid}/lab/data/`** (the lab's `DATA_ROOT`, see "Lab"): `config/lab` and `compare/{itemId}` (see "Lab"), and `reads/{readId}` (readId is the pipeline item's id), one per lab read: `createdAt`, `name`, `pages`, `textSource` (`text`, `ocr`, `mixed`, `none`), `textChars`, `ocrPages`, `ms`, `rules` (the card's fields), `rulesConfidence`, `appliedRule`, `unsure`, `needsLook`, `compare` (`off`, `pending`, `done`, `failed`), `contentHash`; with compare mode `claude`, `model`, `agree {field: bool}`, `agrees`, `comparedAt` or `compareError`; once Bryce picks, `picks {field: "rules"|"claude"}`, `truth {field: value}`, `pickedAt`. Written only by `store.js` (`putLabRead`, `updateLabRead`, `watchLabReads`). Compare mode also writes `compare/{readId}` with `putComparison` for the Rules vs Claude row. The live app never reads them.

**`users/{uid}/config/drive`**: `root`, `folders {name: id}`, `updatedAt`. Year folders are cached under keys like `"02 Taxes/2025"`.

**`users/{uid}/config/settings`**: `shredHoldDays` (0, 1, 3, 7; default 3). Reserved for the web: `offerBulkFile` (boolean, default `false`, decision 5; the iPhone app ignores unknown keys).

**Server only**: `oauthTokens/{googleSub}` and `oauthHandoffs/{random}`. No client reads or writes them; `tools/rules-check.mjs` proves it.

`slug()` in `ui.js` is the sender key for all three collections, and matches `SenderRule.key` and the function's `slug`.

## Local pipeline (IndexedDB, owner outbox)

The web's `PipelineItem` and `FileStore`, so a document in hand survives a reload, a closed tab and a dead connection (#17). Only `db.js` opens IndexedDB.

Database `paper-trail`, version 1:

| Store | Key | Holds |
|---|---|---|
| `items` | `id` (`crypto.randomUUID()`) | One document on its way through, fields below. Index `stage`, index `createdAt`. |
| `blobs` | string | `items/<id>.pdf`, `items/<id>.thumb.jpg` (600 px long side), `review/<session>/<n>.jpg` (review pages). |
| `reviews` | `session` | A scan review left open (`ReviewSession`): pages, groups, labels, held state. Reopens on the next launch. |
| `kv` | string | Small per-device values: recent searches, `lastTab`. (The cached user for #14 is in localStorage, `pt-last-user`, because boot has to read it synchronously.) |

Item fields (same names and stage strings as `PipelineItem`, never renamed):

| Field | Meaning |
|---|---|
| `id`, `createdAt` (ISO), `uid` | The deck is ordered by `createdAt`; dealing a card back to the front sets `createdAt` just ahead of the top. Items are per account (`uid`). |
| `stage` | `captured`, `reading`, `ready`, `queued`, `uploading`, `filed`, `verified`, `failed`. |
| `decision` | `file` or `shredOnly`, set on a swipe. |
| `decidedAt` | When the swipe happened; the undo hold runs 10 s from here. |
| `card` | The normalized `result` from classify, edited in place by the sheet and the detail. |
| `unsureFields` | In sheet order (sender, date, folder, title, filename, verdict); emptied when confirmed. |
| `readErrorCode` | The last read's `ClassifyErrorCode`. |
| `skippedAt` | Skipped on Sort (#77): stays `ready`, off the deck, never uploads. |
| `pages`, `sizeBytes`, `contentHash`, `md5`, `ocrText` | Set by capture (hash, text) and the outbox (md5 just before upload). |
| `uploadURL`, `bytesSent` | The resumable session and progress. |
| `driveId`, `driveUrl`, `docId` | Set as the upload and record land. |
| `filedAt`, `verifiedAt`, `nextRetryAt`, `attempts`, `reuploads`, `failedStage`, `errorMessage` | Outbox bookkeeping, as on the iPhone. |
| `filesPurged`, `origin` | The PDF and thumbnail were cleaned up 10 minutes after the item finished; where the item came from (`legacy-deck` for the in-memory deck's bridge). |
| `session` | Named session (#26, later). |

`db.js` exports: `openDb()`, `getItem(id)`, `putItem(item)`, `updateItem(id, patch)`, `deleteItem(id)`, `listItems({ stage, uid })`, `putBlob(key, blob)`, `getBlob(key)`, `deleteBlob(key)`, `putReview(r)`, `getReview(s)`, `deleteReview(s)`, `kvGet(k)`, `kvSet(k, v)`, `clearAccount(uid)`. Every write emits `pipeline:changed` with `{ id, stage }`. Blobs are deleted when an item is `verified` (or `filed` with `shredOnly`) plus 10 minutes, so a late Undo can still send the card back.

Sign out keeps unsent items (the spec's Sign out confirm: "Your scans stay on this phone until they upload."), but they only show for the same `uid`.

## Services and interfaces

The exports other owners may call. Each owner adds its fake support in the same PR (see "Fake backend").

**auth.js** (auth)
- `currentUser()` → `{ uid, email, name }` or `null`, available synchronously at boot from the cached session (#14).
- `watchUser(cb)`: `cb(user, { confirmed })` with the account to show, or `null` while the sign-in screen is up. The first call can come from the cache (`confirmed: false`) before Firebase answers; start Firestore listeners only on `confirmed: true` (main.js does).
- `startAuth()`, `finishReturn()`, `cachedSession()`, `markNotAllowed(email)`: main.js's boot and the allowlist probe (see "Auth").
- `invalidateDriveToken()`: drive.js calls it on a 401, so the retry mints a fresh token.
- `mountReconnectBanner(host)` → unmount: the live Reconnect Drive banner (3.9) at the top of `host`. Auth mounts it in `#sort-body` and `#piles-body` at start; the outbox calls it on the Outbox screen, and any owner that redraws its screen's body calls it again (harmless when it's already there). `watchDriveUi(fn)` → unwatch: redraw a Reconnect control (status, working state, failure line).
- `driveAccessToken()` → `Promise<string>`: cached until a minute before expiry; concurrent callers share one mint; throws `DriveAuthError("drive_revoked")` when Drive needs reconnecting, `("drive_unavailable")` when Google didn't answer (retryable), never prompts.
- `driveStatus()` → `"connected" | "needsReconnect" | "unknown"`; changes only on the server's word (spec 4.16).
- `reconnectDrive()`: runs the code flow again with the Drive scope (a full-page redirect; the page comes back through `#/auth/done`).
- `signOut()`: the spec's confirm, then Firebase sign-out and `emit("session:ended")` through main.
- Emits `drive:status` with `{ status }`.

**drive.js** (outbox): `ensureFolders(forceRebuild)`, `ensureYearFolder(folderName, year)` (02 Taxes, 03 Money & Banking and 05 Medical only, `YEAR_FOLDERS` in config), `startUpload({ name, folderId, mimeType, size })` → session URL, `putChunk(url, blob, from)`, `uploadStatus(url, size)` (`Content-Range: bytes */size`) → bytes Drive has, `metadata(fileId)` → `{ id, name, md5Checksum, size, webViewLink, trashed }`, `download(fileId)` → Blob, `trash(fileId)`, `search(text)` → files inside the archive (#22). Requests ask for `fields=id,webViewLink,md5Checksum,size`. A 401 calls `auth.driveAccessToken()` once more, then raises `DriveError("unauthorized")`.

**outbox.js** (outbox): the deck writes `{ stage: "queued", decision, decidedAt }` at the swipe, so a reload mid-hold keeps the decision; the outbox leaves a queued item alone (and out of every count) until `release(id)` or 10 s after `decidedAt`. Undo inside the hold just resets the item; after it, `sendBack(id)`. `release(id)` (the deck calls it when a hold ends: the next decision, 10 s, or leaving Sort; it also moves a `ready` item with a decision to `queued`), `sendBack(id)` → `boolean` (cancel the upload, or trash the Drive copy and delete the record; the card goes back on top), `retry(id)`, `retryAll()`, `status()` (the accessory state). Uploads one item at a time, oldest decision first; backoff 1, 2, 5, 15 minutes; offline waits for `online`; `drive_revoked` pauses without spending a retry. Emits `outbox:status` with the accessory state (shape under `outboxAccessory` in `ui/components.js`, precedence reconnect, attention, uploading, offline, idle) plus `{ counts: { uploading, waiting, attention, filedToday }, lastUploadAt }`.

**classify.js** (deck; capture owns `proposeSplit`): `readItem(item)` (queue, two at a time, first read alone when no read answered in 4 minutes), `buildPayload(item)` (the iPhone app's `ClassifyPayload`: with at least 120 non-space characters of text, `kind: "images"`, one 1000 px JPEG of page 1, `ocrText`, `ocrPrimary: true`; otherwise the PDF whole up to 10 pages and about 9 MB, or the first 10 pages at 1568 px), always `wantConfidence: true` and `senderHints`, `normalize(r)`, `unsureFields(card)`, `isConfident(card)`, `applySenderRule(card, rules)` (when a reply has no `appliedRule`), `readError(e)`, `READ_COPY`, `proposeSplit(pages)` → `[{ start, end, label }]` (split mode; a `bad_request` from an older function leaves the pages as they are).

**store.js** (browse, shared): `checkAccess`, `getDriveConfig`, `setDriveConfig`, `watchDocs`, `watchPaperless`, `saveRecord` (legacy), `getDoc(id)`, `putDoc(id, rec)` (outbox), `updateDoc`, `removeDoc`, `updateSender`, `getSender(id)`, `createSender(id, data)` (outbox), `watchSenders`, `setSenderRule`, `deleteSenderRule` (deck), `getSettings`, `watchSettings(cb)` (cb gets the settings object, `{}` when missing), `saveSettings(patch)` (merges into `config/settings`; outbox, deck), `findByHash(hash)` (capture, #2: from the docs already watched, no extra query; the outbox writes `contentHash` on every record it files).

**capture.js** (capture): listens for `capture:request` `{ source: "camera" | "files" | "photos" }` from every Scan menu; emits `capture:sent` `{ ids }` once items are in `db.js` at `captured` (or `reading`). Sort's empty states call `bindScanMenu(button)` from `shell.js`, so every entry point is the same menu (#79).

**deck.js** (deck): listens for `capture:sent` and `pipeline:changed`; calls `outbox.release` and `outbox.sendBack`; emits `deck:decided` `{ id, decision }` and `deck:skipped` `{ id }`.
- Exports for other screens: `file(it)`, `shred(it, { confirmed })`, `skip(it)` and `fileTogether(list)` (each returns `"decided" | "needsCheck" | "needsKeepConfirm" | "unavailable"`), `undo()`, `releaseHeld()`, `act(side, it)` (the animated path the buttons use), `deckCards()`, `skippedCards()`, `sortSkipped()`, `sortNow(it)`, `getItem(id)`, `saveEdits(it, card, { remember })`, `retryRead(it)`, `checks(it)`, and the formatting helpers (`fmtDate`, `folderName`, `folderPath`, `meta`, `dateLabel`).
- The hold: a decision is held for 10 s (decision 4), released by the next decision, the timer, leaving the Sort tab or the page going to the background. Releasing sets `decision`, `decidedAt` and `stage: "queued"`, then calls `outbox.release(id)` when the outbox exports it, else the legacy `enqueue` / `logShred`. Undo after the release needs `outbox.sendBack(id)`; until the outbox exports it, Undo turns off once a decision is released.

**browse** (piles, search, paperless): read Firestore through `store.js` and pending items through `db.js`; push `doc:<id>` with `pushScreen("doc", id)`.

**shell.js**: `bindScanMenu(el)`, `scanMenuItems()`, `setAccessoryHidden(key, hidden)`, `pushScreen(name, param)`, `goTab(tab)`.

**settings.js** (auth): `registerSettingsSection({ id, order, render, bind })`. Settings is drawn by `settings.js` (no static markup in `index.html`): the account row (opens Account: Email and Sign out), Google Drive (status, Reconnect Drive, Folder, Last upload), the registered sections, the footer. Last upload is the newest `outbox:status` `lastUploadAt` (or a legacy `record:saved` with `filed`). Orders: 30 Sorting (one "Sorting" header: senders.js's Sender rules `· 14 ›` at 30, outbox's Shred hold at 31, deck's bulk toggle and its footer at 32), 40 Scanning and privacy (capture: Shutter, hidden until #32; auth: Lock, see below), 50 Data (#31, later). Face ID lock (4.10) has no web equivalent worth building now; auth may add a WebAuthn lock later behind the same row.

## Events

`on(type, fn)` and `emit(type, detail)` from `ui.js`, synchronous. An event missing from this table fails `contract_check.mjs`.

| Event | Detail | Emitted by | Listened by | When |
|---|---|---|---|---|
| `route:changed` | `route()` | `router.js` | `shell.js`, features | Any navigation. |
| `session:started` | `{ uid, email, name }` | `main.js` | features | The allowed account is in and the app is showing. |
| `session:ended` | none | `main.js` | features | Signed out. |
| `drive:status` | `{ status }` | `auth.js` | `drive.js`, `outbox.js`, `settings.js` | Drive connected or needs reconnecting (server's word only). |
| `capture:request` | `{ source }` | `shell.js` (Scan menu) | `capture.js` (the legacy shim in `main.js` until then) | A Scan menu item was picked. |
| `capture:sent` | `{ ids }`, plus `items` and `blobs` until db.js lands | `review.js` (capture) | `deck.js` (`main.js` legacy bridge until then) | New items are in the pipeline. Without a pipeline store, `items` are the live item objects (each with `whenRead`, a promise that settles when Claude's read does) and `blobs[id]` is `{ pdf, thumb }`. |
| `pipeline:changed` | `{ id, stage }` | `db.js` | `deck.js`, `outbox-view.js`, `search.js` | An item was written. |
| `deck:decided` | `{ id, decision }` | `deck.js` | features | A swipe or its twin, before the hold. |
| `deck:skipped` | `{ id }` | `deck.js` | features | A card went to the Skipped set. |
| `outbox:status` | accessory state | `outbox.js` | `shell.js`, `outbox-view.js` | Anything the accessory shows changed. |
| `doc:verified` | `{ docId }` | `outbox.js` | `piles.js` | Drive's checksum matched (#18). |
| `sender:saved` | `{ key }` | `senders.js` | `deck.js` | A rule was saved or forgotten. The deck applies a saved rule to the waiting cards from that sender that weren't edited. |
| `settings:changed` | `{ key, value }` | `store.js` watchers' owner (`outbox-view.js` for `shredHoldDays`, `deck.js` for `offerBulkFile`) | features | `config/settings` changed. |
| `search:input` | `{ q }` | `shell.js` | `search.js` | Every keystroke in the bottom field (debounce in search.js, 250 ms). |
| `search:submit` | `{ q }` | `shell.js` | `search.js` | The Search key: save a recent. |
| `drive:connected` | none | `drive.js` | `outbox.js` | Legacy: Drive is usable again (`drive:status` connected, or a pause timed out). |
| `items:changed` | none | `outbox.js` | `deck.js` | Legacy: a session item changed. Replaced by `pipeline:changed`. |
| `item:added` | item | `deck.js` | features | Legacy. |
| `item:ready` | item | `deck.js` | features | Legacy. |
| `item:decided` | `{ item, dir }` | `deck.js` | features | Legacy, replaced by `deck:decided`. |
| `record:saved` | `{ item, record, id }` | `store.js` | features | Legacy. |
| `lab:read` | `{ item, source }` | `classify.js` | `lab/compare.js` | Lab build (#92): the rules read one document (`item.lab` is set). |
| `lab:progress` | `{ id, progress }` | `classify.js` | `deck.js`, `review.js` | Lab build: the reader's progress line for an item changed (`item.progress`). |
| `lab:compared` | `{ id }` | `lab/compare.js` | `deck.js` | Lab build: compare mode started, finished or failed for an item, or Bryce picked. |

## Backend interface

`B` from `backend.js`; Firebase and the fake implement the same methods (checked).

| Method | Returns | Used by |
|---|---|---|
| `onUser(cb)` | cb gets `{ uid, email, name }` or `null` | `auth.js` |
| `authorize(url)` | never returns (a full-page redirect to Google) | `auth.js` |
| `redeem({ handoff, state, verifier })` | `{ idToken, accessToken, expiresIn, email, name, driveConnected }` (POST `/oauth/redeem`); throws `{ code: "oauth/<code>" }` | `auth.js` |
| `signInWithTokens({ idToken, accessToken })` | `{ uid, email, name }` (Firebase `signInWithCredential`) | `auth.js` |
| `signOut()` | | `auth.js` |
| `classify(payload)` | the callable's response | `classify.js` |
| `call(name, data)` | any other callable's data (`driveToken`) | `auth.js`, `classify.js` |
| `watch(name, order, cb, err)` | unsubscribe | `store.js` |
| `add`, `get`, `set`, `update`, `del` | | `store.js` |
| `fetch(url, opts)` | `Response` | `drive.js` |

The popup methods (`signIn()`, `reconnect()`) are gone (#15): no popups. The cached user is auth's own (localStorage `pt-last-user`), not a backend method, so both backends behave the same.

## Fake backend

`tools/fake/fake-backend.js`, loaded on localhost with `?fake` (serve the repo root: `node tools/serve.mjs`, then `/public/index.html?fake=1`). Everything it saw is on `window.__PT_FAKE__`. Switches:

| Switch | What it does | For |
|---|---|---|
| `signedout`, `as=stranger` | Start signed out, or as an account off the list (with `signedout`, the first Google consent picks the stranger and comes back `not_allowed`) | auth |
| `nodrive` | The server holds no Drive grant (`driveToken` answers `drive_revoked`) and the next consent comes back without the Drive scope (4.1 step 2) | auth |
| `drive401` | The first upload gets a 401; a fresh token fixes it | auth, outbox |
| `driverevoked` | `call("driveToken")` answers `drive_revoked` until a Reconnect consent | auth, outbox (4.16) |
| `oauth=canceled\|not_allowed\|failed` | The next Google consent comes back with that error | auth |
| `slowauth` | Firebase takes 1.5 s to confirm the session (no check on open, #14) | auth |
| `lostsession` | Firebase confirms nobody is signed in, even with a cached user | auth |
| `offline` | Every Drive request fails as a network error | outbox |
| `slowupload` | Uploads take about 4 s | outbox (progress, undo hold) |
| `readfail` | The first read fails with `rate_limited` | deck |
| `unsure` | Reads asking for confidence come back unsure of sender and date, with alternatives (A2) | deck |
| `dupe=<sha256>` | A filed doc ("2025 W-2", filed Oct 2) with that `contentHash`, for the duplicate line (#2) | capture |
| `splitfail` | Split mode answers `bad_request`, like a function from before split mode | capture |
| `readfail=N` | The first N reads fail with `rate_limited` (`readfail` alone: one; the queue retries twice by itself) | deck, capture |
| `seed` | A filed library: docs in every pile and state (verified and not, shredded, keep, stored, a left swipe), five paperless senders in every status with a "still mailing" flag, two sender rules, `config/settings` | browse |
| `hold=<seconds>` | The deck's undo hold is this long instead of 10 s (read by `deck.js` on the fake path only) | deck, tests |
| `reader=claude` | Lab build (#92): read with the classify callable as the live app does, instead of the lab's rules (read by `lab/reader.js` on the fake path only). Only matters with `?lab`, since outside the lab the reader is always Claude. The deck, sort, capture, outbox, browse and scanner tests pass it; `lab_reader_test.mjs` doesn't | tests |

Already answered: `call("driveToken")`, split mode (`mode: "split"`, a new document at every page whose text says "page 1"), `wantConfidence` (sparse), `senderHints` (applied like `functions/lib.js applySenderRule()`: spelling, folder, verdict, type, filename pattern, those fields certain, `appliedRule`), Drive `files.get` with a real `md5Checksum`, `files.update` with `trashed: true`, `alt=media`, `fullText contains` search, and uploads returning `md5Checksum` and `size`.

The session and the server's Drive grant survive a reload (sessionStorage `pt-fake-auth`), like Firebase's persistence, because sign-in is a full-page redirect: `B.authorize(url)` records the URL and reloads on `#/auth/done?handoff=fake&state=...` (or `?error=...`), and `B.redeem` checks the verifier against the state. Use a fresh browser context per test.

Each owner adds, in its own PR: outbox (done): resumable chunks and `Content-Range: bytes */N` status (308 with `Range`), `?md5mismatch` (the first upload's checksum is wrong), `?md5pending` (the first `files.get` has no checksum), `?uploadfail=N` (the first N sessions are refused), and, read by `outbox.js` on the fake path, `?chunk=N` and `?fastretry` (retries after 1 to 4 s); the fake honors `AbortSignal`; capture, `?dupe=<sha256>` and `?splitfail` (done); browse, nothing beyond `seed` unless it needs it.

OCR on the fake path: nothing loads unless the page asks with `?ocr`; tests put a stand-in on `window.__PT_OCR__` (blob, turns) → text. In the lab, `?ocrEngine=tesseract` skips PaddleOCR and `?ocrBackend=wasm` or `webgpu` picks its runtime (#101).

Lab compare mode (#92): a test sets `window.__PT_FAKE__.answer = (payload) => result` to choose what "Claude" answers (return null for the samples).

Test hooks: `window.__PT__ = { addFiles, addPhotos, items(), scanner, outbox, db, importFiles, importPhotos, scanned, review(), reads }` (`outbox` and `db` are the modules). Add to it, don't rename; once the pipeline moves to `db.js`, `items()` returns the db's items.

**Capture and the pipeline store (capture PR).** `review.js` exports `attachStore(db)` and `resumeReview()`. Once `db.js` exists, `main.js` calls `attachStore` with the db module (it uses `putItem`, `updateItem`, `putBlob`, `getBlob`, `putReview`, `getReview`, `deleteReview`, `kvGet`, `kvSet`; the open review's session id is `kv.openReview`) and `resumeReview()` after `session:started`. From then on the review is saved after every change, items and their PDFs go to db.js, and `capture:sent` carries ids only. Until then the review lives in memory, its footnote says "Keep this page open until you send them." instead of the spec's, and leaving the page asks first.

## Auth (design for the auth agent, #14, #15, #3)

Goal: the same server token flow as the iPhone app (ARCHITECTURE "Auth"), so Drive never disconnects, plus a web return target. No popups (they break in the Home Screen app on iOS and in some browsers), no Google Identity Services SDK.

**On open (#14).** Firebase Auth keeps its persisted session (IndexedDB, `browserLocalPersistence`). At boot `auth.js` reads the last user (`{ uid, email, name }`, localStorage `pt-last-user`, because it has to be synchronous; written at every confirmed sign-in, cleared at sign-out and on an allowlist refusal) and, before the modules even load, `boot.js` keeps the sign-in screen from painting. When present, when present, the app renders straight from it: no gate, no spinner, the deck from IndexedDB. `onAuthStateChanged` confirms in the background. Only a confirmed `null` (or a permission-denied allowlist probe) shows the sign-in screen. Firestore listeners start once Firebase has the user. `checkAccess()` moves to the background too: a denial then shows "This account isn't on the list."

**Sign in and Reconnect Drive (#15), web redirect variant:**

1. `auth.js` makes a verifier (43 or more base64url characters from `crypto.getRandomValues`), `challenge = base64url(SHA-256(verifier))`, and a web nonce `"web_" + base64url(24 random bytes)` (36 characters; the iPhone app's nonces are always 22, so the function can tell them apart). `state = nonce + "." + challenge`. It saves `{ verifier, state, returnTo: location.hash }` in `sessionStorage` (`pt-oauth`), never in the URL.
2. Full-page redirect to `https://accounts.google.com/o/oauth2/v2/auth` with the web OAuth client ID (`GOOGLE_OAUTH_CLIENT_ID`, the same client the iPhone flow uses; it isn't a secret, put it in `config.js`), `redirect_uri=https://paper-trail-bw.web.app/oauth/callback`, `response_type=code`, `scope=openid email profile https://www.googleapis.com/auth/drive.file`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `state`, and `login_hint` for Reconnect.
3. `oauthCallback` (changed, see below) does everything it does today, and because the nonce is a web nonce, redirects to `https://paper-trail-bw.web.app/#/auth/done?handoff=<id>&state=<state>` instead of `papertrail://auth`. The handoff rides in the fragment, so it never reaches a server log or a Referer. Errors come back the same way: `#/auth/done?error=canceled|not_allowed|failed&state=...` (plus `email` for not_allowed).
4. The page boots on `#/auth/done`. `auth.js` checks `state` against `sessionStorage`, POSTs `{ handoff, state, verifier }` to `/oauth/redeem` (same origin, through the Hosting rewrite), clears `pt-oauth`, replaces the URL with the saved `returnTo` (no history entry), and signs in with `signInWithCredential(auth, GoogleAuthProvider.credential(idToken, accessToken))`. Same Google account, same Firebase project, so the same uid as the iPhone app.
5. `driveConnected: false` in the redeem reply means the consent skipped Drive: the sign-in screen's step 2 ("Signed in as {email}", "Connect Google Drive") per spec 4.1, which reruns the flow.
6. From then on Drive tokens come only from `B.call("driveToken")` through `driveAccessToken()`. `drive_revoked` sets `needsReconnect` (spec 4.16: banner on Sort, Outbox and Piles, the accessory state, the Settings row). A network error changes nothing.

**Function change (made in the auth PR, backward compatible, not deployed; the integrator deploys it with the web app):** in `functions/oauth.js`, `oauthCallback` picks the redirect from the parsed nonce: `isWebNonce = /^web_[A-Za-z0-9_-]{32}$/.test(nonce)`, and when true uses `WEB_REDIRECT = "https://paper-trail-bw.web.app/#/auth/done"` (a new `defineString("WEB_APP_REDIRECT")` with that default, never taken from the request, so it can't become an open redirect). Everything else stays: the same state regex already accepts a 36-character nonce, `oauthRedeem` is unchanged, the iPhone app's 22-character nonces still go to `papertrail://auth`. Add tests in `functions/test/oauth.test.mjs`: a web nonce redirects to the web target with the handoff in the fragment; an iPhone nonce still goes to `papertrail://`; errors go to the matching target; a nonce like `web_short` is treated as the iPhone's.

**Setup Bryce does** (the auth PR lists it): nothing new in Google Cloud (the redirect URI is already registered for the iPhone flow); deploy functions and hosting when he says. No secret is handled by Claude.

**Drive status** (`pt-drive-status` in localStorage, like the iPhone app's `AuthDefaults`, so the first frame is right): `connected` after a consent with Drive or a minted token, `needsReconnect` only on `drive_revoked`, `unknown` (shown as connected) otherwise. `pt-drive-consent` keeps step 2 locked across a reload. The Drive token is cached in memory and this tab's sessionStorage (`pt-drive-token`), never in localStorage or Firestore.

**Until the outbox keeps scans in IndexedDB (#17)**, legacy deck items live in memory, so a Reconnect (a full-page redirect) and Sign out first say how many scans on the page would be lost.

**Sign out.** The spec's confirm ("Sign out of Paper Trail? Your scans stay on this phone until they upload."), Firebase sign-out, clear `pt-last-user`, the Drive status and the cached Drive token. Server tokens stay (the iPhone app keeps working).

**Local and fake.** `oauthCallback` can't send a browser back to localhost, so the real flow is tested on the deployed site; locally the fake's `redeem` and `signInWithTokens` stand in, with `#/auth/done?handoff=fake&state=<saved>`.

## Design system on the web

- **Tokens** (`css/tokens.css`): spec 2.1 colors for light and dark (system neutrals, AccentColor, AccentFill, AccentSoft, CardWell, the three verdict pairs, File, FileSoft, FileFill, Danger, Unsure, UnsureSoft), glass with a solid fallback for Reduce Transparency, Increase Contrast and browsers without `backdrop-filter`; SwiftUI text styles at the default size on the Apple system font stack (`--t-large-title` to `--t-caption2`, with tracking); spacing 4 to 32; radii; the neutral card shadow and peek shadow; springs as CSS `linear()` curves simulated from `.spring(duration:bounce:)` (`--spring-snap`, `-flyoff`, `-promote`, `-undo`, `-pop`, `-smooth`, each with `-ms`), all collapsing to a 0.2 s ease-out under Reduce Motion.
- **Components** (`js/ui/components.js`, styles in `css/components.css`): see the module map. Sheets, menus and toasts mount in `#overlay`, inside the column.
- **Haptics**: `haptic()` vibrates where the browser can (Android); iOS Safari has no web haptics, so the spec's haptic moments are silent there.
- **Gallery**: `public/dev/gallery.html` shows every component, light and dark (`?theme=dark`). Not deployed (`firebase.json` ignores `dev/`). Check it after any change to `js/ui/` or the CSS.

## Lab (the no-AI build, #92)

Branch `exp/no-ai` only. The same `public/` serves two Hosting sites in project paper-trail-bw: the live app (`hosting:live`, https://paper-trail-bw.web.app, deployed only from `main` by `tools/deploy.sh`) and the lab (`hosting:lab`, https://paper-trail-lab.web.app, deployed only by `tools/deploy-lab.sh`). Targets are in `.firebaserc`.

- **Which build.** `LAB` in `config.js` is true on the lab hosts (`LAB_HOSTS`) and on localhost with `?lab` (tests: `?fake=1&lab=1`). `boot.js` makes the same test before the first paint and sets `<html class="pt-lab">`, the title, `lab.webmanifest` and the Home Screen title. Feature code reads `LAB`; it never tests the hostname itself.
- **Firestore.** `DATA_ROOT` is `["lab", "data"]` in the lab, so `backend.js` puts every path under `users/{uid}/lab/data/` (docs, paperless, senders, config, and the lab's own three below). `store.js` paths don't change. The rules give `users/{uid}/lab/**` the same owner-only rule as the rest (`tools/rules-check.mjs` has the lab cases).
  - `config/lab`: `{ reader: "rules", compareWithClaude: boolean }`. Compare is on when the field is missing. `store.watchLabSettings`, `store.saveLabSettings`.
  - `compare/{itemId}`: `{ at (ISO), agree: { <field>: boolean }, rules, claude }`, one per document read with compare on. `<field>` is one of `lab.COMPARE_FIELDS` (`title`, `docType`, `issuer`, `docDate`, `summary`, `folder`, `filename`, `verdict`, `verdictReason`, `retention`, `sensitive`, `paperless.possible`, `paperless.issuer`, `paperless.how`); a field left out wasn't scored. `rules` and `claude` are the two cards as read. `store.putComparison(id, rec)`, `store.watchComparisons`. Compare mode (`lab/compare.js`) writes it with the fields it scores; its `paperless` is stored as `paperless.possible`.
  - `reads/{readId}`: one per lab read, the reader's full record (see "Firestore", lab build): the rules' card, where the text came from, Needs a look, Claude's card and Bryce's picks. Lab Stats reads it. `store.putLabRead`, `store.updateLabRead`, `store.watchLabReads`.
- **Drive.** `ROOT_FOLDER` is "Paperwork Archive (Lab)", with the same `FOLDER_NAMES` and year folders, cached in the lab's own `config/drive`. The real archive is never opened.
- **Local data.** IndexedDB and localStorage are per origin, so the lab site's pipeline and preferences are its own.
- **Sign-in.** `auth.webNonce()` starts `lab_` in the lab. `oauthCallback` picks the return host from a fixed allowlist by that prefix (`WEB_TARGETS` in `functions/oauth.js`: `web` the live site, `lab` the lab site); the request can never name a host. Google's redirect URI stays https://paper-trail-bw.web.app/oauth/callback; the lab's `/oauth/redeem` goes through its own rewrite to the same function.
- **Reading.** The lab reads with no AI (the reader's own modules). It calls the `classify` function only for compare mode, and only while `lab.compareEnabled()` is true. Claude's answer is stored in `compare/` and `reads/` and never filed. On the lab site `lab/reader.js` sets `READER` to `"rules"`; everywhere else it stays `"claude"`, so the live app's reader never changes. The compare setting has one owner, `lab.js`; `lab/compare.js` reads it from there.
- **OCR (#101, #98).** Pages without text of their own are read by PaddleOCR (PP-OCRv5 mobile detection and English recognition, Apache-2.0) on ONNX Runtime Web 1.30.0 (MIT, pinned on jsDelivr) in `lab/ocr-worker.js`: WebGPU when the device has it and a warm-up run works, WebAssembly SIMD on one thread otherwise. The worker also draws PDF pages (pdf.js 5.4.624 on OffscreenCanvas), so OCR, drawing and the rules never run on the main thread. The models (about 12.7 MB) are in `public/lab-models/pp-ocrv5-mobile/`, which only the lab target serves, with a one-year immutable cache; they and the runtime are kept in Cache Storage (`pt-lab-ocr-v1`). If PaddleOCR can't load, the lab reads with Tesseract.js as before. `tools/lab_ocr_test.mjs` checks it with the CPU slowed 4x; `tools/lab/ocr-bench.mjs` compares the two engines on drawn corpus pages.
- **Looks.** The Lab badge (`.lab-badge`) on the sign-in title and each tab's nav bar, and the tab bar in `--lab` violet (tokens.css) instead of the blue accent.

## Checks

- `node tools/contract_check.mjs`: inline script in `index.html`, import cycles (`ui/` included), backend and IndexedDB owners, every event in the table above, the fake and Firebase backends' methods, no hex colors outside `tokens.css` (in `components.css` and `shell.css`), verdicts drawn only by `verdictBadge()` (legacy `deck.js` and `piles.js` exempt until rebuilt), no em dashes in `public/`, and every module in the module map above.
- `node tools/smoke_test.mjs` (every page, 1440 and 390 px, gallery included), `node tools/deck_test.mjs`, `node tools/sort_test.mjs` (deck: gestures, skip, hold, undo, check fields, bulk, detail), `node tools/shell_test.mjs`, `node tools/auth_test.mjs`, `node tools/outbox_test.mjs`, `node tools/capture_test.mjs`, `node tools/scanner_test.mjs`, a feature's own `tools/<feature>_test.mjs`, `node --test functions/test/*.test.mjs` (or `npm test` in `functions/`), and `node tools/rules-check.mjs` when rules change (needs `firebase login`).
- GitHub Actions is out of minutes: run all of these on the Mac before every merge and paste the output into the PR. Never merge on a red run.
- Verify in the built-in browser at 390 px and desktop, light and dark, with a clean console, against the spec and `direction-A.png`, using `?fake=1` (and `&seed` for browse).
