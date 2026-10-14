# Recon map: Genius Scan (The Grizzly Labs, iOS and Android)

Scope: the scanner's whole loop (capture, cleanup, naming, organizing, OCR and search, export and auto-export, cloud sync, app lock and PDF encryption, pricing) as it bears on Paper Trail.
For: Bryce's Paper Trail, a phone-first Firebase web app for clearing a box of paper. Claude reads each document, Bryce swipes right to file the original PDF into Google Drive "Paperwork Archive" (11 numbered folders) or left to shred, and the app tracks the shred pile, originals to keep, and senders to switch to paperless. Current pain: a sign-in check on every open, and Drive disconnecting because access tokens are short-lived. The goal is to find features worth stealing for the overhaul, not to copy Genius Scan.
Date: 2026-10-13
Method: public sources only (marketing and pricing pages, the public help center read as Markdown, App Store and Google Play listings, Apple's public customer review RSS feed, the developer blog, the SDK site, one review aggregator). No account, no login, no app install, no network logging. App Store screenshots were not viewed, so screen layouts below come from help-center steps, not pixels.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing page | https://thegrizzlylabs.com/genius-scan/ | auto detection, perspective correction, "A text layer is added for indexing and searching", tags, search, cloud export |
| 2 | pricing page | https://thegrizzlylabs.com/genius-scan/pricing | Basic free; Ultra $39.99/year; Teams $40 to $20 per license per year; full feature catalog |
| 3 | App Store listing (US) | https://apps.apple.com/us/app/genius-scan-pdf-scanner/id377672876 | 4.9 stars, 1.4M ratings; v8.14.1 (Sep 21, year not shown); IAPs Plus $1.99 / $11.99, Ultra $4.99 / $39.99 / $49.99; privacy labels (email and user content linked to you) |
| 4 | App Store reviews page | https://apps.apple.com/us/app/id377672876?see-all=reviews | 10 "most helpful" reviews with developer replies |
| 5 | App Store public review feed (US, most recent, pages 1 to 10) | https://itunes.apple.com/us/rss/customerreviews/page=1/id=377672876/sortby=mostrecent/json | 450 reviews read: 389 five-star, 14 four, 10 three, 7 two, 30 one; dates Mar to Oct 2026 |
| 6 | Google Play listing | https://play.google.com/store/apps/details?id=com.thegrizzlylabs.geniusscan.free&hl=en_US | 4.9 stars, 618K reviews, 10M+ downloads, updated Sep 22, 2026; 3 reviews in page (2, 4 and 5 stars) |
| 7 | help center index | https://help.geniusscan.com/llms.txt | full list of help articles; each page readable by appending .md |
| 8 | Scan documents | https://help.geniusscan.com/getting-started/quick-start-guide/scan-documents | auto-capture on stable document, volume button shutter, Batch mode default, Single toggle, auto-crop cannot be disabled, Maximize to revert |
| 9 | Quick edit actions | https://help.geniusscan.com/getting-started/quick-start-guide/quick-edit-actions | 1-second preview after each shot; magic wand for recrop, filter, rotate, delete/retake; Android adds curvature |
| 10 | Better automatic document detection | https://help.geniusscan.com/other-topics/troubleshooting-and-faq/troubleshoot-scanning/better-automatic-document-detection | contrast, four corners in frame, avoid desk edges |
| 11 | Create document name templates | https://help.geniusscan.com/document-management/renaming-documents/create-document-name-templates | default name "2015-02-21 19:55"; components date, time, location, custom text; live sample name |
| 12 | AI-powered advanced renaming | https://help.geniusscan.com/document-management/renaming-documents/ai-powered-advanced-renaming | "Genius Renaming" button suggests a name from content; iOS only |
| 13 | Rename documents manually | https://help.geniusscan.com/document-management/viewing-and-editing-documents/renaming-documents | Smart Document Renaming suggestion chips from content, other docs' names, location, calendar events; date picker on detected date |
| 14 | Search your documents | https://help.geniusscan.com/document-management/organizing-documents/search-your-documents | title, tags, content (OCR); all documents vs current folder |
| 15 | Tags | https://help.geniusscan.com/document-management/organizing-documents/tagging-documents-and-managing-tags | multiple tags per doc; tag filter in search; tags written to PDF keywords metadata on export |
| 16 | Text recognition (enable; old documents) | https://help.geniusscan.com/document-management/text-recognition-ocr/enable-text-recognition and https://help.geniusscan.com/document-management/text-recognition-ocr/apply-text-recognition-on-all-your-old-documents | OCR needs advanced plan and an active language; "Process old documents" backfill |
| 17 | Import pictures and files | https://help.geniusscan.com/document-management/importing-pictures-and-files/import-pictures-and-files-pdf-jpeg... | import photos (enhanced) and PDFs (left as is); share sheet into the app; long-press + shortcut |
| 18 | Merge and split | https://help.geniusscan.com/document-management/managing-multi-page-documents/merging-and-splitting-documents | merge has no unmerge; split by moving pages to a new document |
| 19 | Export methods by plan | https://help.geniusscan.com/exporting-and-sharing/comparison-of-export-methods-by-plan | Basic: email, share sheet, Wi-Fi sharing; Plus: cloud services and shortcuts; Ultra: Genius Cloud |
| 20 | Auto-export rules | https://help.geniusscan.com/exporting-and-sharing/export-destination-and-shortcuts/auto-export-rules-and-configuration | rules per folder with name and tag conditions; "one-way sync" re-export on edit; triggers on main list or app exit; Wi-Fi only by default |
| 21 | Export shortcuts | https://help.geniusscan.com/exporting-and-sharing/export-destination-and-shortcuts/configuring-export-shortcuts | saved destination folder; multiple accounts per service; shared drives |
| 22 | Export history | https://help.geniusscan.com/exporting-and-sharing/export-destination-and-shortcuts/check-a-documents-export-history | "Exported to..." screen; per-destination icon turns grey on error |
| 23 | Verify backups | https://help.geniusscan.com/exporting-and-sharing/export-destination-and-shortcuts/verify-if-your-documents-have-been-backed-up | overall sync badge (check / clock / warning), pending list, green and grey dots |
| 24 | Auto-delete after export | https://help.geniusscan.com/exporting-and-sharing/export-destination-and-shortcuts/automatically-delete-a-document-after-export | deletes only after upload confirmed; warns against several auto-delete rules |
| 25 | Document protection | https://help.geniusscan.com/security-and-privacy/document-protection | opt-in Face ID / passcode lock "every time you open the app"; PDF password (RC4 128-bit) per export or for all exports |
| 26 | Privacy and security overview | https://help.geniusscan.com/security-and-privacy/privacy-and-security-overview | documents "only stored on your device by default" |
| 27 | Privacy policy | https://help.geniusscan.com/security-and-privacy/privacy-policy | OCR and PDF generation on device; cloud uploads go straight from app to provider; account users may get server-side indexing and title suggestions; subprocessors AWS, Amplitude and others |
| 28 | Plan details | https://help.geniusscan.com/subscription-plans-and-account-management/plan-details-and-comparison | Ultra feature list; legacy Plus and Lifetime Plus |
| 29 | Sync and backup | https://help.geniusscan.com/cloud-storage-and-backup/built-in-cloud-overview/synchronization-and-backup | Genius Cloud syncs crops, renames, tags, page order; web app at app.geniusscan.com; no hard storage cap |
| 30 | Offloading | https://help.geniusscan.com/cloud-storage-and-backup/built-in-cloud-overview/offloading-documents | removes local files not opened for 30 days once synced |
| 31 | Blog: organizing documents | https://blog.thegrizzlylabs.com/2025/03/organizing-documents.html | nested folders, unlimited tags, naming advice "2024-02-Invoice", auto-export by tag |
| 32 | Genius Scan SDK | https://geniusscansdk.com/ | same engine for developers, includes a Web SDK; extraction of receipts (date, merchant, amount), IBAN/BIC, MICR, business cards; "run offline on-device" |
| 33 | JustUseApp problems page | https://justuseapp.com/en/app/377672876/genius-scan-pdf-scanner/problems | user problem reports (export, email, login) |
| 34 | Expense report setup | https://help.geniusscan.com/exporting-and-sharing/expense-reports/set-up-expense-report | receipt scans to expense report with custom columns and categories; Ultra, iOS only |

Checked and came up empty: Reddit (the Arctic Shift archive returned rate-limit errors on every query, and web searches surfaced no Genius Scan threads), Kimola review report (HTTP 410). Not checked: YouTube walkthroughs, press reviews.

## Core loop

Point the camera at paper, let it auto-detect and auto-capture page after page in batch mode, accept the cleaned PDF, name it (template or AI suggestion), tag or folder it, and let auto-export push it to the right cloud folder in the background.

Paper Trail's loop goes further (Claude classifies, recommends shred or keep, sets retention), so Genius Scan is the reference for the capture and export ends, not the decision in the middle.

## Capture

| question | answer | source |
| --- | --- | --- |
| How does a scan start? | + button (iOS) or Camera button (Android); long-press + for import shortcuts | 8, 17 |
| Detection | Live edge detection; snaps automatically when the document is stable (auto-capture, can be turned off in Settings, General) | 8 |
| Batch | Batch mode is the default; a counter in the shutter shows pages in the batch; ✓ ends the batch into one multipage document. Single mode is a toggle | 8 |
| Per-page fix without leaving the camera | 1-second preview after each shot with a magic wand: recrop, filter (B&W, color, photo, dark background, none), rotate, delete/retake. Android adds curvature | 9 |
| Cleanup | Perspective correction, background removal, shadow and defect cleanup, curvature correction | 3, 32 |
| Auto-crop | Cannot be disabled; Recrop, then Maximize reverts to the full photo | 8 |
| Import | Photos (get the same enhancement as scans) and PDF/JPEG/PNG files (left untouched); share sheet from Mail or Gmail into the app | 17 |
| Detection tips shown to users | Contrast with background, all four corners in frame, avoid desk and keyboard edges | 10 |
| Known capture complaints | Slow auto-scan, curvature fix per page, blurry top on iPhone 17 Pro, camera "multitasking" error | 5 |

## Reading and extraction

| capability | detail | source |
| --- | --- | --- |
| OCR | On device; adds a text layer to PDFs; needs Ultra and at least one active language | 1, 16, 27 |
| OCR backfill | "Process old documents" runs OCR on everything scanned before upgrading | 16 |
| Copy text, export as text | Yes | 7 |
| AI renaming | "Genius Renaming" suggests a whole name from content, e.g. "a business receipt or a lab report"; iOS only. Whether it runs on device is unknown (policy says account users may get server-side title suggestions) | 12, 27 |
| Smart renaming chips | Suggestions from document text, recurring words in other documents' names, nearby places, matching calendar events; orange calendar button edits the detected date | 13 |
| Structured extraction | Receipts to expense report (iOS, Ultra); business cards to contacts. SDK also extracts IBAN, BIC, MICR | 32, 34 |
| Document type, issuer, retention, shred advice | Not offered. Genius Scan never tells you what a document is or whether to keep it | 1, 2, 28 (absence) |

## Organizing and filing

- **Folders**, nestable, "the best organizing tool to reduce clutter" (31).
- **Tags**, unlimited per document, filterable in search, and written into the PDF's keywords metadata on export so desktop tools can see them (15, 31).
- **Name templates**: components for date, time, location and custom text with a live sample name; default name is a timestamp (11).
- **Merge and split**, move pages between documents; merge cannot be undone (18).
- **Sorting** and multi-select (7).
- Filing into the cloud is done by **auto-export rules**, not by the in-app folder: a rule maps a name or tag condition to a cloud folder (20).

## Search

Search by title, tags, or OCR content; from home it searches everything, inside a folder you choose All documents or Current folder; Android sorts by pertinence, alphabetical or date (14). iOS also surfaces documents in Spotlight, including offloaded ones (3, release notes). Genius Cloud web app has its own search and filter (7).

## Retention and shredding

Genius Scan has no retention schedule, no keep or shred advice, and no shred pile. The closest feature is **Delete document on success**: after an export is confirmed uploaded, the in-app copy is deleted. It only fires on a confirmed upload; for email it fires once the message is in the Mail outbox, which Genius Scan cannot verify further. They advise against several auto-delete rules because only one will run (24). Offloading drops local copies after 30 days unused, but keeps them in Genius Cloud (30).

## Going paperless

Not a feature. Marketing and reviews talk about clearing paper clutter ("allowed me to unload a lot of paper clutter", source 5), but nothing tracks senders or prompts a switch to e-statements. This whole area is Paper Trail's own.

## Sync and integrations

| item | detail | source |
| --- | --- | --- |
| Destinations | Box, Dropbox, Evernote, FTP/SFTP, Google Drive (including shared drives), OneDrive, OneNote, SugarSync, WebDAV, iCloud Drive, Nextcloud, ownCloud, Synology, Yandex, QuickBooks Online, Canvas, email, print, photos, share sheet | 2, 7, 19 |
| Connect once | "Login" per service, then connected accounts stay listed at the top of the picker; several accounts per service at once (Box, Dropbox, Google Drive, OneDrive, OneNote, FTP, WebDAV) | 20, 21 |
| Export shortcuts | Saved account + folder for one-tap export, optional delete on success | 21 |
| Auto-export | Rules with optional name, folder, name and tag conditions, auto-delete; PDFs re-exported with the same name when edited ("one-way sync"); runs when you return to the list or leave the app; Wi-Fi only unless "Auto-export on cellular" is on | 20 |
| Status | Per-destination icon on each document (grey on error, tap for the message); "Exported to..." history screen; Android green and grey dots; overall sync badge with a pending list | 22, 23 |
| Data path | Uploads go directly from the phone to the provider, not through Grizzly Labs servers; scope limited to listing folders and uploading | 27 |
| Genius Cloud | Ultra; real-time sync of crops, renames, tags and page order; web app; zip export of the whole library; offloading | 19, 29, 30 |
| Known integration complaints | Emails that never arrive (stuck in the Mail outbox), export blocked by trial pop-ups, Nextcloud hard to set up | 4, 5, 6 |

## Security and privacy

- **On-device by default**: "only stored on your device by default"; OCR, PDF generation and image processing run on the device (26, 27). SDK: "All the SDK treatments, including text recognition, run offline on-device" (32).
- **App lock is opt-in**: Face ID, Touch ID or passcode, after which it "will authenticate you every time you open the app"; a passcode is the fallback (25).
- **PDF password**: per export, or one password for all exported PDFs; RC4 128-bit (25). This is weak by current standards.
- **No 2FA** on the Genius Cloud account, which a subscriber called out for ID scans (5).
- Privacy labels: email and user content linked to you, analytics and crash data not linked (3). Subprocessors include AWS (account owners only) and Amplitude analytics (27).
- HIPAA via BAA for Teams (2).

## Pricing

Basic is free with unlimited scans and no ads (2, 28). Ultra is $39.99/year on the pricing page (2); App Store IAPs also list Ultra at $4.99 and $49.99 and legacy Plus at $1.99 and $11.99, so monthly vs annual mapping is unknown (3). Ultra gates OCR, cloud export, shortcuts, auto-export, name templates, AI renaming, auto-delete, app lock, PDF passwords and Genius Cloud (28). Legacy one-time "Genius Scan+" buyers were moved to Lifetime Plus, which lacks newer features, a recurring source of anger (5, 28).

## Screens

States marked "reported" come from reviews; "inferred" from help-center steps. No screenshots were viewed.

| ID | screen | how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Document list (home) | app open | Browse, search, start a scan | + / Camera button bottom-left, search icon, sync button with badge, per-doc export icons or dots, folders | lock screen first if Face ID on (25); review pop-up (reported, 5); trial pop-up (reported, 5) |
| S02 | Camera | + button | Capture | Live edge overlay (orange window), shutter with batch counter, Batch/Single toggle top right, ✓ done | auto-capture; "window not consistent" (reported); camera multitasking error (reported) |
| S03 | Quick edit preview | after each shot | Fix last page without leaving camera | 1-second preview, progress ring on ✓, magic wand with recrop, filter, rotate, delete | timed out, editing |
| S04 | Document view / edit | tap doc | Pages, title, tags, export | Title field, Genius Renaming button, Add tag, Edit (Recrop, Maximize, filters, curvature), Share, "Exported to..." prompt | editing; jumps to edit page after each scan (reported) |
| S05 | Rename sheet | tap title | Name the doc | Text field, suggestion chips by category, date calendar buttons, gear to hide categories | suggestions loading (inferred) |
| S06 | Search | search icon | Find docs | Field, tag picker, All documents / Current folder, sort tabs | no results (inferred) |
| S07 | Export sheet | Share | Send once | Destinations, shortcuts, gear for format, page size, password | trial wall on export (reported) |
| S08 | Export history | "Exported to..." | Audit exports | List of destination, time, status, error message | error grey (22) |
| S09 | Sync screen | sync button | Cloud status | Pending list, Backup and sync button, Storage (offload) | all synced, pending, error |
| S10 | Settings, Export | Settings | Rules and shortcuts | Add rule, Add shortcut, Auto-export on cellular | logged-in accounts at top |
| S11 | Add auto-export rule | Settings, Export | Rule setup | Service, Login, rule name, folder picker, name and tag conditions, Delete document on success | |
| S12 | Settings, General | Settings | Preferences | Auto-Capture, Face ID / passcode, Password encryption, Document name templates | |
| S13 | Name template editor | Settings, General | Template | Draggable components (date, time, location, text), sample name | |
| S14 | Text Recognition settings | Settings | OCR | Toggle, Manage Languages, Process old documents | |
| S15 | Paywall / trial | export, premium feature | Convert | 1-week trial, Ultra plans | repeats on dismiss (reported) |
| S16 | Genius Cloud web app | app.geniusscan.com | Desktop access | Search and filter, download, zip export | |

## Flows

Click counts are estimates from help steps, not observed.

```
F01 Scan a stack into one PDF
    S01 + -> S02 auto-capture page 1..n (S03 auto-dismisses each) -> ✓ -> S04
    happy path taps: 2 plus zero per page with auto-capture
    edge: auto-capture misses edges on low-contrast desks; curvature per page; retake from S03

F02 Name it
    S04 tap Genius Renaming (1 tap) or tap title -> S05 tap chips -> Save
    template applies automatically on creation if enabled (S13)

F03 File it to Drive automatically (set once)
    S10 Add rule -> Google Drive -> Login (first time only) -> folder -> condition (tag "Taxes") -> Add
    afterwards: tag a doc in S04, return to S01, upload runs in background on Wi-Fi
    edge: on cellular nothing happens by default; nothing runs while you stay in the editor

F04 Check it landed
    S01 icon on the row (grey = error) -> S04 "Exported to..." -> S08 detail
    edge: email exports only confirm reaching the Mail outbox

F05 Free up the phone
    rule with Delete document on success, or S09 Storage -> Offload rarely accessed documents

F06 Lock the app
    S12 Face ID on -> choose passcode fallback; every app open now asks for Face ID
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Live document overlay | edge quad | searching, locked, capturing | S02 |
| Shutter with batch counter | batch, single | idle, capturing | S02 |
| Timed preview with ✓ ring | iOS overlay, Android thumbnail | counting down, editing | S03 |
| Suggestion chip | content, other names, location, calendar, date | default, tapped | S05 |
| Template builder | component token, text token | dragging, preview | S13 |
| Per-destination export icon / status dot | Drive, Dropbox, email, Cloud | success, error (grey), not exported | S01, S04 |
| Sync badge | check, clock, warning | synced, pending, error | S01, S09 |
| Rule row | name, service, folder, conditions, delete flag | on, off | S10, S11 |
| Tag pill | orange when applied | applied, available | S04, S06 |

## Inferred data model

```
Document     id, title, created_at, updated_at, folder_id, tags[], page_ids[], ocr_text, ocr_lang,
             offloaded (bool), cloud_sync_state (synced | pending | error)
             evidence: 14, 15, 16, 23, 29, 30. confidence: high

Page         id, document_id, image_ref, crop_quad, filter, rotation, curvature_fix, page_size
             evidence: 8, 9, 29 (synced edits list). confidence: high

Folder       id, name, parent_id                    evidence: 31. confidence: high
Tag          id, name                               evidence: 15. confidence: high

NameTemplate id, components[] (date fmt | time | location | text)
             evidence: 11. confidence: high

ExportAccount id, service, account_label, credentials (kept on device)
             evidence: 20, 21, 27. confidence: medium

ExportShortcut id, account_id, folder, delete_on_success, shared_drives
             evidence: 21. confidence: high

AutoExportRule id, name, account_id, folder, name_condition, tag_conditions[], delete_on_success
             evidence: 20, 24. confidence: high

ExportEvent  document_id, destination, at, status (ok | error), error_message
             evidence: 22. confidence: high

Settings     auto_capture, capture_mode (batch | single), default_filter, ocr_enabled, ocr_languages[],
             app_lock (faceid | passcode), pdf_password, auto_export_cellular, name_templates_enabled
             evidence: 8, 16, 20, 25. confidence: high
```

## Feature matrix

See `features-genius-scan.csv`. Must: 13, should: 14, could: 12, skip: 7. "original" is whether Genius Scan has it; rows marked "no" are Paper Trail ideas the competitor does not cover, kept in for contrast.

## What users say

App Store quotes come from Apple's public review feed (source 5) and the reviews page (source 4); Google Play quotes from the listing (source 6). Quotes are short excerpts, verbatim including typos.

**Complaints**

1. COMPLAINT, App Store, 1 star, Nickname0946, 2026-08-20 (5): "the devs have added a frustrating amount of friction to the app to drive users to pay money"
2. COMPLAINT, App Store, 1 star, dayhiker9, 2026-09-04 (5): "When I try to export/share it says to start a 1 week trial."
3. COMPLAINT, App Store, 1 star, Unicorns and Glitters, 2026-07-11 (5): "I paid for GS+ and now you have upstage to Ultra?! For a yearly fee?"
4. COMPLAINT, App Store, 1 star, scottjames138, 2026-10-09 (5): "I was enjoying Genius Scan until the pop up asking me if I was enjoying Genius Scan popped up."
5. COMPLAINT, App Store, 1 star, notya concern, 2026-09-11 (5): "This app does not send e-mails no matter how many times you try to troubleshoot."
6. COMPLAINT, App Store, 3 stars, MCWHP, 2026-06-26 (5): "It acts like it sends but the documents never arrive."
7. COMPLAINT, Google Play, 2 stars, Matt P, 2026-06-26 (6): "I have had more than a dozen fail to send."
8. COMPLAINT, App Store, 1 star, Furball11, 2026-06-27 (5): "I lost access of my account and could never access my documents again."
9. COMPLAINT, App Store, 3 stars, Alyz123, 2026-08-24 (5): "because I had to re-download this app again, everything was lost."
10. COMPLAINT, App Store, 3 stars, BelleviewFL, 2026-09-18 (5): "still without a 2 Factor authentication for login. These are DOCUMENTS my dude."
11. COMPLAINT, App Store, 2 stars, Xristosnika, 2026-04-03 (5): "Curvature correction has to turned on individually for each page of each scan."
12. COMPLAINT, App Store, 2 stars, Pig2015, 2026-08-15 (5): "some numbers on in the excel sheet were wrong." (receipt extraction)
13. COMPLAINT, App Store, 3 stars, Furand, 2026-05-20 (5): "I find the export workflow confusing and wish I could designate a local path as the default location"
14. COMPLAINT, App Store, 3 stars, fugly_mofo, 2026-06-23 (5): "I only want my scans on my device."
15. COMPLAINT, App Store, Grammy51, 2024-06-29 (4): uneasy about granting Google Drive access; developer replied "we do not have access to any of your files." (paraphrase plus developer quote)

Tally of the 47 one-to-three-star reviews in source 5: about 13 about paywall, trial or subscription friction, about 8 about email or export not arriving, 3 about review pop-ups interrupting a scan, the rest scattered (capture quality, lost documents, support).

**Praise**

16. PRAISE, App Store, 5 stars, wlanni, 2026-07-22 (5): "auto detects the documents, straightens trapezoids to squares ... save right up to Google Drive immediately."
17. PRAISE, App Store, 5 stars, EbonCarter, 2026-08-06 (5): "Put receipts directly into my Google Drive folders"
18. PRAISE, App Store, 5 stars, BWKeyboardMan, 2026-04-13 (5): "I'm even scanning old invoices to get rid of the paper. It easily helps you change the file name based on content"
19. PRAISE, App Store, 5 stars, ThomasMartin53, 2026-03-30 (5): "allowed me to unload a lot of paper clutter."
20. PRAISE, App Store, 5 stars, MrJackDriver, 2026-10-03 (5): "AI smart document naming suggestion. Reliable cloud sync!"
21. PRAISE, App Store, aprilalison, 2024-07-03 (4): "it genuinely looks like it was a saved document, never having been printed and scanned."
22. PRAISE, App Store, Myke H, 2023-04-03 (4): praises naming templates, OCR and auto-upload to Google Drive; "Genius is the gold standard."
23. PRAISE, Google Play, 4 stars, Marcus Reyes, 2026-06-23 (6): "I'm not being pressured to buy and not one pop-up" (directly contradicts the iOS complaints; Android may show fewer prompts, unknown)
24. PRAISE, App Store, 5 stars, kemcards, 2026-04-22 (5): "I also like the genius renaming feature, although it's far from perfect."

**Requests**

25. REQUEST, App Store, 5 stars, dfghj4567, 2026-07-14 (5): "the ability to add/edit/delete a note for each recipe" (per-document notes)
26. REQUEST, Google Play, 4 stars, Marcus Reyes (6): "date should end with the year" (name format)

## Out of scope (cannot or should not be cloned)

- **Their capture engine.** Proprietary on-device detection and cleanup. Their Web SDK exists but is a paid license (32); Paper Trail can lean on the phone's own camera and document scanner via file input, or an open library, and on Claude for reading.
- **Twenty export destinations.** Paper Trail needs exactly one: Bryce's Drive. Depth over breadth.
- **Genius Cloud and offloading.** Drive is the archive; a second cloud is redundant.
- **Expense reports, business cards, fax, QuickBooks, Canvas.** Different jobs.
- **Teams, MDM, HIPAA BAA, licensing.** Single user.
- **Paywalls, trials, review prompts.** The top complaint category; a personal app should have none.
- **RC4 PDF passwords.** Weak; if Paper Trail ever encrypts, use AES via a maintained library, or rely on Drive permissions.

## Size

Screens 16 (about 9 relevant), flows 6 (about 4 relevant), entities 10 (about 7 relevant).

Hard parts if Paper Trail takes the best of it:
1. A Drive connection that never drops: needs a server-held refresh token (OAuth code flow with offline access in a Cloud Function), not the browser's 1-hour access token.
2. A reliable outbox: queued uploads with per-document status, retry, and an error message, so "filed" means confirmed in Drive.
3. Multi-page batch capture in a web app on iPhone, with a per-page retake, without a native scanner SDK.
4. Content search across filed documents (store Claude's extracted text and metadata, or lean on Drive's own full-text index).

Size: **M** for the stolen features below on top of the existing app.

## Steal for Paper Trail

1. **Connect Drive once, stay connected** (sources 20, 21). Genius Scan logs in per service once and keeps the account listed for every later export. Fits Bryce's top complaint directly: move Drive auth to a Cloud Function that holds a refresh token so swipes never hit an expired token. Effort: M.
2. **Lock is opt-in, never a sign-in gate** (25). Genius Scan opens straight to the list; Face ID only if you turn it on. Fits: keep Firebase auth persisted silently and drop the open-time check, with an optional passkey (WebAuthn) lock for the sensitive views. Effort: S.
3. **Outbox with per-document status and history** (22, 23). Grey icon on failure, tap for the message, "Exported to..." log. Fits: every right swipe becomes a queued upload with a visible state and retry, and the Drive link is stored, so a dropped connection never loses a filing. Effort: M.
4. **Shred only after a confirmed upload** (24). Delete on success fires only when the provider confirms the file. Fits: an item only lands in "safe to shred" once Drive has confirmed the PDF, which makes the left pile trustworthy. Effort: S.
5. **Name templates with live preview plus suggestion chips** (11, 13). Fits: let Bryce set the filename pattern once (for example date, issuer, title) and see a sample, with Claude's values offered as tappable chips when he wants to tweak a name. Effort: S.
6. **Rules that re-route and re-export on edit** (20). One-way sync with the same filename after an edit. Fits: if Bryce fixes a title or folder after filing, Paper Trail renames or moves the Drive file instead of leaving a stale copy. Effort: S to M.
7. **Write metadata into the PDF** (15). Tags go into PDF keywords. Fits: stamp issuer, type, date, retention and verdict into the PDF properties before upload so the file explains itself in Drive and stays searchable outside the app. Effort: S.
8. **Batch capture with a timed per-page retake** (8, 9). Fits: scanning a box is a stack job; shoot many pages into one document with a quick recrop or retake per page, then Claude reads the whole PDF. Effort: M.
9. **Search across title, tags and content, scoped all vs one folder** (14). Fits: once the box is gone, "where's the 2023 car title" is the main question; search Claude's extracted fields and text, filtered by archive folder. Effort: M.
10. **Process old documents** (16). Fits: when the Claude prompt or folder scheme changes, a one-tap re-read of earlier items keeps the archive consistent. Effort: S.
