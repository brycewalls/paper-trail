# Recon map: Paperless-ngx (plus the paperless-ai and paperless-gpt add-ons)

Scope: the whole pipeline that matters to a personal paper purge: capture and ingestion (consumption folder, upload, mail, mobile clients), reading (OCR, date parsing, classifier and LLM suggestions), organizing and filing (correspondents, document types, tags, storage paths, custom fields, filename templates), the inbox and review loop, search, retention and deletion, the "keep the original or throw it away" workflow, sync and integrations, security, pricing.
For: Paper Trail, Bryce's phone-first Firebase web app that reads each scanned document with Claude, files the original PDF into Google Drive "Paperwork Archive" (11 numbered folders) on a right swipe, and tracks a shred pile, originals to keep, and senders to switch to paperless. Current pain: a sign-in check on every open, and Drive disconnecting on short-lived access tokens. The goal is features worth stealing for an overhaul, not a copy.
Date: 2026-10-13
Method: public sources only. Paperless-ngx docs (docs.paperless-ngx.com returned 403 to WebFetch, so the same Markdown sources were read from the public GitHub repo), the GitHub repos and READMEs for paperless-ai and paperless-gpt, the GitHub API for stars and release dates, the Swift Paperless App Store listing (the most-reviewed iOS client), AlternativeTo, and Reddit r/Paperlessngx through the public Arctic Shift archive. No accounts, no logins, no instance was installed or run.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Docs: Usage (source Markdown) | https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/usage.md (published at https://docs.paperless-ngx.com/usage/) | terms, web UI, adding documents, mail, duplicates, suggestions, AI, sharing, permissions, workflows, custom fields, PDF actions, history, trash, search syntax, "recommended workflow" |
| 2 | Docs: Advanced usage | https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/advanced_usage.md (https://docs.paperless-ngx.com/advanced_usage/) | matching algorithms, Auto (neural net) matching, AI features and RAG, consume hooks, filename templates, storage paths, barcodes and ASN, duplex collation, SSO |
| 3 | Docs: Configuration | https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md | session cookie age (2 weeks default), remember session, trash delay, consumer options |
| 4 | Docs: FAQ | https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/faq.md | originals never modified, checksums, export, file types, duplicates, AI privacy |
| 5 | Docs: Home / features and screenshots | https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/index.md (https://docs.paperless-ngx.com/) | feature list, screenshot captions (dashboard, three list styles, filter, bulk edit, side-by-side editor, custom fields, permissions, search, mail rules, workflow, mobile) |
| 6 | Changelog | https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/changelog.md | "Feature: Paperless AI" and "Remote OCR (Azure AI)" in 3.0.0; Apply AI Suggestions workflow action and merge-as-versions in 3.1.0 |
| 7 | GitHub repo | https://github.com/paperless-ngx/paperless-ngx | 46,636 stars, 3,231 forks, GPL-3.0, created 2022-02-12 (GitHub API, read 2026-10-13) |
| 8 | Latest release | https://github.com/paperless-ngx/paperless-ngx/releases/tag/v3.3.1 | v3.3.1 published 2026-10-12; v3.0.0 published 2026-07-22 |
| 9 | paperless-ai README | https://github.com/clusterzx/paperless-ai | 5,977 stars, MIT. Auto title/tags/type/correspondent, RAG chat, `/manual` review page. README says "This repo is currently not maintained." |
| 10 | paperless-gpt README | https://github.com/icereed/paperless-gpt | 2,770 stars, MIT. LLM OCR, title/tag/date/correspondent/custom field generation, manual vs auto review, per-type AI workflows, document linking, searchable PDFs |
| 11 | Swift Paperless (iOS client) App Store reviews | https://apps.apple.com/us/app/-/id6448698521?see-all=reviews | 4.9 stars, 74 ratings; 10 reviews read from the raw page |
| 12 | AlternativeTo | https://alternativeto.net/software/paperless-ngx/about/ | 5.0 from 3 ratings, 31 likes, 2 reviews (read via WebFetch, not checked character for character) |
| 13 | Reddit: "Paperless-ngx – I really tried to like it" | https://www.reddit.com/r/Paperlessngx/comments/1vkfhtd/ | 2026-08-10, long critique of cold start, taxonomy, workflows |
| 14 | Reddit: "I scanned a whole box of paperwork and only later noticed one page was missing" | https://www.reddit.com/r/Paperlessngx/comments/1wrr32q/ | 2026-09-27, the shred-too-early failure mode |
| 15 | Reddit: "Bulk ingestion is slow AF" | https://www.reddit.com/r/Paperlessngx/comments/1wv4cwf/ | 2026-10-01 |
| 16 | Reddit: "V3.x was supposed to solve one annoying problem - Tesseract OCR" | https://www.reddit.com/r/Paperlessngx/comments/1vflzvt/ | 2026-08-04 |
| 17 | Reddit: "How do you organize your tax documents?" | https://www.reddit.com/r/Paperlessngx/comments/1w1wuhx/ | 2026-08-29 |
| 18 | Reddit: "Day 3 dealing with duplicates" | https://www.reddit.com/r/Paperlessngx/comments/1vit9o3/ | 2026-08-08 |
| 19 | Reddit: "Getting Started?" | https://www.reddit.com/r/Paperlessngx/comments/1wlkny3/ | 2026-09-20 |
| 20 | Reddit: "2.500 documents later... I'm done!" | https://www.reddit.com/r/Paperlessngx/comments/1o7nwos/ | 2025-10-15 |
| 21 | Reddit: "paperless-ngx + paperless-ai + OpenWebUI: I am blown away" | https://www.reddit.com/r/Paperlessngx/comments/1np5sr4/ | 2025-09-24 |
| 22 | Reddit: "Wow. Why has it taken me so long to discover Paperless" | https://www.reddit.com/r/Paperlessngx/comments/1tbmoab/ | 2026-05-12 |
| 23 | Reddit: "How do You Guys Handle Retention?" | https://www.reddit.com/r/Paperlessngx/comments/1o40a0r/ | 2025-10-11 |
| 24 | Arctic Shift archive API | https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=Paperlessngx | how sources 13 to 23 were read (post and comment JSON) |

Checked and came up empty or blocked: docs.paperless-ngx.com (403 to WebFetch, so the GitHub Markdown was used; content is the same docs source), r/selfhosted search through Arctic Shift (timed out and rate limited twice), full-text Reddit search for "love" (timed out). The GitHub discussion on retention (paperless-ngx/discussions/650) was cited by a Reddit commenter but not read (unknown contents). There is no official Paperless-ngx mobile app; the docs point to a community wiki list (source 1). Paperless-ngx has no App Store or Google Play listing of its own.

## Core loop

Paper lands in a physical inbox, gets scanned (or mailed, or uploaded) into a watched folder, Paperless OCRs it, auto-assigns correspondent, type, tags and storage path from matching rules or a trained classifier (and optionally an LLM), tags it `inbox`, and the user reviews the inbox: fix the title, date, correspondent and type, remove the inbox tag. Originals worth keeping get a running Archive Serial Number (ASN) and go into a single binder sorted by ASN; everything else is thrown away (source 1, "The recommended workflow").

That last step is the closest thing in any tool to Paper Trail's verdict. The docs put it plainly: "If the document has no ASN, throw it away. Yay!" (source 1).

## Capture

| question | answer | source |
| --- | --- | --- |
| Main ingestion path | The consumption directory: a watched folder; files are OCRed, indexed, moved into Paperless storage and removed from the folder | 1 |
| Other paths | Web upload button, drag and drop anywhere in the app, REST API, incoming email, mobile clients (community, not official) | 1, 5 |
| Phone capture | No official app. Community clients (Swift Paperless on iOS, others listed on the wiki) scan and upload. Swift Paperless users praise scanning and "printing" to the app | 1, 11 |
| Mail ingestion | Mail accounts plus ordered mail rules (folder, max age, filters, attachment filename wildcards). After consuming, the rule acts on the mail: delete, mark read, flag, move to folder, or add an IMAP keyword. Checks every 10 minutes by default. Gmail and Outlook via OAuth2 with "refreshing tokens will be handled automatically" | 1 |
| Folder structure as metadata | `PAPERLESS_CONSUMER_RECURSIVE` plus `PAPERLESS_CONSUMER_SUBDIRS_AS_TAGS` turns subfolder names into tags; a Reddit user recommends this for migrating iCloud folders | 3, 22 |
| Batch separation | Separator barcodes (PATCH-T) split a scan into documents; ASN barcodes split and set the ASN; tag barcodes split and tag | 2 |
| Double-sided scans | Optional collation of two single-sided ADF passes into one document | 2 |
| Duplicates | As of v3 duplicates are not rejected by default; a Duplicates tab on each document and a Duplicates list filter; `PAPERLESS_CONSUMER_DELETE_DUPLICATES` restores rejection | 1, 4 |
| File types | PDF, PNG, JPEG, TIFF, GIF, WebP (OCRed into PDF), plain text, Office files with optional Tika | 4 |
| Password-protected PDFs | Workflow action "Password Removal" tries a list of passwords and stores the decrypted file as a new version | 1 |
| Missing-page detection | Not a feature. Users count pages by hand or rescan (source 14) | 14 |

## Reading and extraction

| question | answer | source |
| --- | --- | --- |
| OCR engine | Tesseract (100+ languages); remote OCR via Azure Document Intelligence, opt-in, can be limited to specific documents with a workflow action | 1, 5 |
| Output | Archivable PDF/A with a text layer stored next to the untouched original | 1, 5 |
| Date | "Date created" parsed from content; docs admit this "fails sometimes if the OCR is bad or multiple dates appear on the document". A Reddit commenter says alternative dates appear as clickable suggestions | 1, 13 |
| Classifier | Non-LLM ML model trained on your own documents suggests tags, correspondents, types and storage paths; retrains hourly; learns only from documents no longer in the inbox | 1, 2 |
| LLM suggestions (built in since 3.0) | Opt-in. Suggests title, tags, correspondent, type, storage path and dates. Backends: Ollama or any OpenAI-compatible API. Prefers existing tags and correspondents (3.1.0). Can be applied automatically by the "Apply AI Suggestions" workflow action, with "create missing items" and "overwrite existing values" switches | 1, 2, 6 |
| paperless-ai | Auto title, tags, type, correspondent; RAG chat; `/manual` page for hand review; rules to limit which documents are processed | 9 |
| paperless-gpt | Vision-LLM OCR, title/tag/correspondent/created-date generation, custom field extraction with Append, Update or Replace modes, document linking by cited reference numbers ("anything ambiguous is left unlinked rather than guessed"), searchable PDFs, per-document-type AI workflows triggered by tags, ad hoc multi-document analysis | 10 |
| Confidence scores | Not shown in Paperless docs (unknown). paperless-gpt's auto mode is described as handling routine documents and leaving "edge cases" for review, but no confidence number is documented | 1, 10 |
| Barcode contents | Optional: stores every barcode value (payment codes, QR) and makes them searchable | 2 |

## Organizing and filing

| concept | how it works | source |
| --- | --- | --- |
| Correspondent | Person or company a document comes from or goes to | 1 |
| Document type | Letter, bank statement, invoice, contract | 1 |
| Tags | Many per document; nested up to 5 deep (v2.19), parent tags auto-added | 1 |
| Storage path | A filename template (Jinja) that decides the folder and filename on disk, e.g. `Insurances/{{ correspondent }}/{{ created_year }}-{{ created_month }}-{{ created_day }} {{ title }}`; assigned by matching like a tag | 2 |
| Matching algorithms | None, Any, All, Exact, Regular expression, Fuzzy, Auto (neural network) per tag, correspondent, type and storage path | 2 |
| Custom fields | Text, Boolean, Date, URL, Integer, Number, Monetary, Document Link (bidirectional), Select | 1 |
| ASN | Running number written or barcode-labeled on originals you keep; one binder sorted by ASN | 1, 2 |
| Saved views | Filter sets shown on the dashboard or sidebar, like "labeled physical binders on your desk" that update themselves | 1, 5 |
| Versions | Several files under one document (v3.1 "merge as versions") | 1, 6 |
| Notes | Per-document notes, searchable | 1 |
| PDF editor | Rotate, delete, reorder pages, split, merge | 1 |

## Review (the inbox)

- An inbox tag is put on every new document; review means fixing ASN, correspondent, type, title and date, then removing the inbox tag (source 1).
- Suggestions are requested automatically when you open an inbox document (source 1).
- A `todo` tag plus a dashboard saved view is the docs' answer to "needs action" documents (source 1).
- Bulk editing of tags, correspondents, types, custom fields and permissions from the list (source 1, 5).
- paperless-gpt adds a dedicated review UI ("Approve or tweak AI's suggestions") and tag triggers: `paperless-gpt` for manual review, `paperless-gpt-auto` for automatic (source 10).
- What users want and do not get: "Analyze it. Apply what you are confident about. Show me the uncertain parts. Done." (source 13).

## Search

- Full-text search over content, title, correspondent, type and tags, scored by relevance, with autocomplete and highlighted matches; "More like this" similar documents (source 1, 5).
- Word-order-independent, accent-insensitive, separator-agnostic (a partial number like `1312` finds `A-1312/B`) (source 1).
- Field syntax: `type:invoice tag:unpaid`, `correspondent:"acme corp"`, `asn:[50 to 150]`, date ranges, custom field and notes queries, barcode values (source 1).
- Global search bar across documents, tags and workflows (source 1).
- Document chat (built in since 3.0, needs the LLM index): answers questions over one document or many, "and its answers include links to the source documents it drew from" (source 2). paperless-ai has its own RAG chat (source 9).

## Retention and shredding

- No retention policy feature as such. A Reddit user in Oct 2025: "creating real retention policies with the existing toolset seems to be a little lacking" (source 23).
- What exists now: the Scheduled workflow trigger can fire on a date custom field with a day offset, positive or negative (source 1). Combined with a "Move to Trash" action or an email action, that is a retention rule. This is newer than the Reddit thread, which said custom field triggers were not possible; treat the combination as possible but unconfirmed in practice.
- Trash: deleted documents sit in trash 30 days by default (`PAPERLESS_EMPTY_TRASH_DELAY`), restorable; an optional directory keeps the original file after the trash is emptied (source 1).
- Physical shredding is outside the app: the recommended workflow says to throw away anything without an ASN (source 1). There is no shred pile, no shred-by date, and no "safe to shred" check. Source 14 shows the cost: a misfed page discovered after the paper was gone.

## Going paperless

Not a feature. Paperless-ngx archives whatever arrives; it does not track which senders could be switched to e-statements. The nearest thing is mail ingestion (route a sender's emailed PDFs straight in) and correspondents as a list of who sends you paper (source 1). Paper Trail's "senders to switch to paperless" list has no counterpart here.

## Sync and integrations

| question | answer | source |
| --- | --- | --- |
| Where files live | Plain files on your own disk, named by your filename format; never transmitted unless you choose | 4, 5 |
| Cloud drives | No native Google Drive or iCloud sync (unknown beyond the docs; not mentioned) | 1, 5 |
| Export | Document exporter with reasonable filenames; originals can be dragged out of the media folder | 4 |
| Integrity | Checksums on all documents and a scheduled sanity checker | 4 |
| Webhooks and email | Workflow actions send documents or JSON to a URL or by email | 1 |
| Share links | Public links with optional expiry; ZIP bundles of a selection | 1 |
| API | Full REST API; third-party clients and MCP connectors exist (a Reddit user connected Claude through MCP to check for missing pages) | 1, 14 |
| Login persistence | Session cookie, "Defaults to 1209600 (2 weeks)", with `PAPERLESS_ACCOUNT_SESSION_REMEMBER` true by default | 3 |
| Third-party token refresh | For Gmail and Outlook mail accounts, OAuth2 setup is done once and "refreshing tokens will be handled automatically" | 1 |

## Security and privacy

- Self-hosted; data "is never transmitted or shared in any way, unless you explicitly choose to do so" (source 5).
- Multi-user with global and per-object permissions, owners, groups (source 1).
- Two-factor authentication, password reset, OIDC and social login, remote-user SSO (source 1, 2).
- Audit log "History" tab for every document change (source 1).
- AI is off by default; the docs warn that enabling a remote LLM sends document content to that provider; document text is passed to the LLM "as untrusted data" (source 2, 4).
- Optional GPG decryption of encrypted emails before consumption (source 2).
- Sensitive-document flag: not a feature (unknown beyond permissions). paperless-ai's manual page is suggested for sensitive documents (source 9).

## Screens

From the docs' screenshot section (source 5) and usage docs (source 1). Images were viewed by caption only, not saved.

1. Dashboard: saved views as widgets, upload button, statistics
2. Document list in three styles: table, small cards, large cards (plus slim sidebar, dark mode)
3. Filter bar: tags, correspondents, types, storage paths, custom fields, dates
4. Bulk edit menu
5. Document detail: side-by-side preview and metadata editor, suggestions, Notes, History, Versions, Duplicates, Metadata tabs
6. PDF editor (rotate, delete, reorder, split)
7. Custom fields manager and field picker
8. Management lists: tags, correspondents, document types, storage paths (each with a match and algorithm)
9. Search: autocomplete dropdown and results with highlights
10. Global search
11. Mail accounts and mail rules editor
12. Workflows editor (triggers and actions)
13. Share links and share link bundles dialog
14. Trash
15. Tasks / processing queue
16. Settings, permissions, users and groups
17. Document chat panel (toolbar)
18. Mobile web layout (three mobile screenshots)
19. paperless-gpt: review queue with approve/edit per suggestion (source 10)
20. paperless-ai: `/manual` tagging page and RAG chat (source 9)

## Flows

1. **Scan to inbox**: scanner writes to the consume folder, Paperless OCRs, matches, tags `inbox` (source 1).
2. **Review inbox**: open document, suggestions load, accept or fix correspondent, type, title, date, ASN, remove inbox tag (source 1).
3. **Keep or toss original**: decide physical keep; if kept, write or stick the next ASN, scan, file in the ASN binder; else throw away (source 1).
4. **Mail rule**: a sender's attachment is pulled in, given rule metadata, and the mail is moved or marked (source 1).
5. **Auto-file with AI**: Document Added trigger runs "Apply AI Suggestions" in the background (source 1).
6. **Scheduled reminder**: Scheduled trigger with a date custom field and day offset sends an email or moves to trash (source 1).
7. **Find a document**: search with field syntax, or ask the chat and follow source links (source 1, 2).
8. **Share**: create a link with expiry or a ZIP bundle (source 1).
9. **Migrate folders**: dump a folder tree in the consume folder with subdirs-as-tags (source 3, 22).
10. **Clean duplicates**: filter by Duplicates, review, trash (source 1).

## Components

Card list with thumbnails, tag pills with colors, filter chips, bulk-select toolbar, side-by-side viewer and form, suggestion chips (dates as clickable links per source 13), saved view widgets, workflow builder (trigger plus ordered actions), history timeline, toast and task queue (sources 1, 5, 13).

## Inferred data model

Field names are taken from the docs and search syntax where they appear; anything marked (inferred) was not confirmed in a public schema.

- **Document**: id, title, content (OCR text), created, added, modified, asn, correspondent, document_type, storage_path, tags[], owner, permissions, custom_fields[], notes[], original_filename, checksum, archive checksum, page_count, versions[], barcodes[] (sources 1, 2)
- **Tag**: name, color, parent (max depth 5), match, matching_algorithm, inbox flag (inferred name) (sources 1, 2)
- **Correspondent / DocumentType**: name, match, matching_algorithm (source 2)
- **StoragePath**: name, path template, match, matching_algorithm (source 2)
- **CustomField**: name, data_type (fixed once set), select options (source 1); **CustomFieldInstance**: document, field, value (inferred)
- **SavedView**: filter rules, show on dashboard, show in sidebar (source 1, 5)
- **MailAccount**: server or OAuth provider, tokens (source 1); **MailRule**: account, folder, max age, filters, attachment patterns, assigned metadata, action, order (source 1); **ProcessedMail**: message UID (source 1)
- **Workflow**: order, triggers[], actions[]; **Trigger**: type (consumption started, added, updated, scheduled), source, filename, path, mail rule, content match, tag and type filters, schedule date field and offset; **Action**: assignment, removal, email, webhook, move to trash, password removal, remote OCR, apply AI suggestions (source 1)
- **ShareLink**: slug, document or bundle, expiration (source 1)
- **Note**, **AuditLogEntry** (actor, change), **Task** (source 1)

Paper Trail mapping: Document ≈ `users/{uid}/docs`; folder ≈ storage path; issuer ≈ correspondent; type ≈ document type; verdict and retention ≈ custom fields; "paperless" list has no Paperless-ngx equivalent.

## Feature matrix

See `features-paperless-ngx.csv` (same columns as the hair tracker recon: feature, area, priority, original, clone, notes). Priority is for Paper Trail; "original" says whether Paperless-ngx (or an add-on, noted) has it; "clone" is "no" everywhere.

## What users say

Quotes are verbatim from the Arctic Shift JSON (Reddit) and the raw App Store page (Swift Paperless), checked character for character. The AlternativeTo quote came through WebFetch only. Reddit has no star ratings.

**Complaints**

1. COMPLAINT, Reddit, Jaikinator, 2026-08-10 (source 13): "it always feels like Paperless only becomes useful **after I already did most of the organizing work myself.**"
2. COMPLAINT, Reddit, Jaikinator, 2026-08-10 (source 13): "You start with an empty system and immediately have to design your own taxonomy."
3. COMPLAINT, Reddit, Jaikinator, 2026-08-10 (source 13): "Paperless workflows are powerful, but I constantly found myself thinking about how Paperless internally processes documents rather than what I wanted to achieve."
4. COMPLAINT, Reddit, Jaikinator, 2026-08-10 (source 13), on Auto matching: "this is a terrible **cold-start problem**."
5. COMPLAINT, Reddit, ImprovementFar1170, 2026-09-27 (source 14): "Of course, that was one of the documents whose paper copy I had already thrown away."
6. COMPLAINT, Reddit, bobnecat, 2026-08-04 (source 16): "They still use archaic Tesseract OCR as default, in 2026."
7. COMPLAINT, Reddit, BitOne2707, 2026-10-01 (source 15): "It takes between 6 and 12 hours to chug through it" (about 2,500 documents)
8. COMPLAINT, Reddit, robertw477, 2026-08-13 (source 18), on v3 allowing duplicates: "I cannot understand why this is not a setting by DEFAULT."
9. COMPLAINT, Reddit, CGS_Web_Designs, 2025-10-12 (source 23), on retention: "it's still a very manual process though, which is what I'm trying to avoid."
10. COMPLAINT, Reddit, tom888tom888, 2025-10-15 (source 20), on a 2,500 document import: "it was a grind and a real test of my motivation."
11. COMPLAINT, Reddit, shrimpdiddle, 2026-09-20 (source 19): "I tried local AI and my iGPU was swamped for hours. In the end, it yielded nothing spectacular."
12. COMPLAINT, App Store (Swift Paperless), Motley F, 2025-10-25 (source 11): "I frequently get kicked out of the document upload screen for no reason."
13. COMPLAINT, Reddit, FragDenWayne, 2026-08-10 (source 13): "I would already be happy if I could just resize the thumbnails"

**Praise**

14. PRAISE, Reddit, _blackdog6_, 2025-10-15 (source 20): "Paperless is the GOAT."
15. PRAISE, Reddit, Sufficient-Rice-587, 2026-08-10 (source 13): "For me the most winning part is to have a big library where I can search inside my documents."
16. PRAISE, Reddit, MuntoOne, 2026-08-10 (source 13): "this all is still MUCH better than having all the sheets again in filers and searching for information over hours."
17. PRAISE, Reddit, ImprovementFar1170, 2026-09-27 (source 14): "Watching the pile slowly disappear was honestly pretty satisfying."
18. PRAISE, Reddit, carlinhush, 2025-09-24 (source 21), on paperless-ai plus chat over car invoices: "tells me it is time for an oil change"
19. PRAISE, Reddit, GentleFoxes, 2025-10-16 (source 20), on tags vs folders: "you can only stick a file into one folder, hence folders are exlusionary."
20. PRAISE, Reddit, purepersistence, 2026-05-16 (source 22): "My favorite thing to host besides Immich."
21. PRAISE, App Store (Swift Paperless), mbglobetrotter, 2025-01-09 (source 11): "The whole system gets smarter as you use it and Tags get recognized and properly assigned better and better."
22. PRAISE, App Store (Swift Paperless), nota, date shown as Jun 16 (source 11): "It's made capturing documents so much easier."
23. PRAISE, App Store (Swift Paperless), King Melchizedek, 2025-07-29 (source 11): "I love being able to search through all my documents for keywords"
24. PRAISE, AlternativeTo, linusmuth, 2025-01-04 (source 12): "It works reliably."

**Advice that doubles as a feature request**

25. Reddit, undulanti, 2026-09-27 (source 14): "I don't immediately throw paperwork away, anymore at least."
26. Reddit, luziferius1337, 2026-09-27 (source 14): "a self-written script that takes the number of pages as a mandatory parameter, and it tells, if the batch is incomplete."
27. Reddit, icebear80, 2026-08-29 (source 17): everything tax-related is tagged "Taxes" plus a year sub-tag, with "a special Tax-view which I modify each year".

**Most praised:** full-text search over everything once it is in (items 15, 16, 23). **Most complained about:** the setup and organizing burden before it pays off: empty taxonomy, cold-start classifier, and workflows that need pipeline thinking (items 1 to 4, 10).

## Out of scope (cannot or should not be cloned)

- Self-hosting itself (Docker, Postgres, Redis, Tesseract, Celery workers). Paper Trail is Firebase plus Drive on purpose.
- Multi-user permissions, groups, owners, OIDC: a one-person app does not need them.
- Local OCR engine and PDF/A generation: Claude already reads the page images and text, and Drive keeps the original byte for byte.
- Mail server polling with IMAP actions: possible later through the Gmail API, but a separate project.
- Barcode separator sheets and duplex collation: Bryce scans with a phone, not an ADF.
- Public share links and ZIP bundles: Drive sharing already covers this.
- The GPL-3.0 code itself; ideas only.

## Size

Screens 18 core plus 2 add-on (about 8 relevant to Paper Trail), flows 10 (about 6 relevant), entities 15 (about 6 relevant).

Hard parts for the Paper Trail version:
1. Staying signed in and keeping Drive connected: a refresh token held server-side (Cloud Function) instead of an hour-long access token in sessionStorage, the same "authorize once, refresh automatically" pattern Paperless uses for Gmail and Outlook.
2. Learning from corrections without Paperless's cold start: Claude already gives a strong first guess, so the work is remembering Bryce's overrides per issuer and feeding them back.
3. Making shredding safe: page counts, a hold period, and a check that the Drive copy opened and matched before anything goes in the shred pile.
4. Search over extracted text without a search server (Firestore plus a small client index, or Claude over stored text).

Size: **M** for the steal list below on top of the existing app. Cloning Paperless-ngx as a whole would be L and mostly out of scope.

## Steal for Paper Trail

1. **Authorize once, refresh automatically (S/M, M with the function work).** Paperless keeps a 2-week session and refreshes mail OAuth tokens itself; Paper Trail should keep Firebase Auth persistence local (no sign-in check on open) and hold a Google refresh token in a Cloud Function so Drive never "disconnects" mid-deck. This is Bryce's top pain point. Effort: M.
2. **Confidence split: auto-file the sure ones, queue the rest (M).** paperless-gpt's auto vs manual tags and the "Apply what you are confident about. Show me the uncertain parts" wish fit the swipe deck: high-confidence cards file in one tap or batch, low-confidence ones get the full card. Effort: M.
3. **ASN for originals you keep (S).** The docs' recommended workflow is Paper Trail's keep_original verdict with a missing step: assign the next running number, put it in the Drive filename, and tell Bryce to write it on the paper and drop it in one binder sorted by number. Finding the paper later becomes a lookup. Effort: S.
4. **Shred safety hold (S/M).** Source 14's missing page is the failure Paper Trail must not have: record page count at capture, show it on the card, confirm the Drive copy opens with the same page count, and keep items in a "hold" state for a few days before they count as safe to shred. Effort: S to M.
5. **Remember corrections per sender (S/M).** Paperless matching rules and the "prefer existing" AI tweak (3.1.0) map to: when Bryce changes the folder, type or filename for an issuer, store issuer to folder and pass it to Claude as a hint next time. Fixes the cold start without a classifier. Effort: S to M.
6. **Date candidates as chips (S).** Paperless shows alternative dates as clickable suggestions; Claude can return the document date plus other dates it saw (due date, period end) so a wrong pick is one tap to fix and the filename date stays right. Effort: S.
7. **Duplicate check before filing (S).** Hash the original (Paperless uses checksums) and warn "already filed on Oct 9 as ..." before a second upload to Drive. Rescans of the same page are likely in a box purge. Effort: S.
8. **Retention dates that come due (M).** Paperless's Scheduled trigger with a date field and day offset is the right shape: Paper Trail already has a retention value, so compute a shred-by or review-by date and surface a "due this month" list for originals and Drive files. Effort: M.
9. **Search and Ask the archive with source links (M/L).** Search is the most praised thing in every source; store the extracted text and fields in Firestore, add a search box, and later a "ask" box that answers with links to the Drive files it used, like Paperless document chat. Effort: M for search, L with chat.
10. **Needs-action flag (S).** The docs' `todo` tag plus a dashboard view: a toggle on the card for "I have to do something with this" (pay, reply, cancel) and a list of them, separate from shred and keep. Effort: S.
