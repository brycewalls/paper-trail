# Recon map: Adobe Scan (iOS, Android)

Scope: the capture flow (auto-capture, edge detection, cleanup, filters, multi-page), auto naming, OCR, document type recognition (receipts, business cards, IDs) and search, plus the sync, privacy and pricing choices around them.
For: Paper Trail, Bryce's phone-first Firebase web app for clearing a box of paper. He scans or picks a document, Claude reads it (title, type, issuer, date, folder, filename, verdict shred / scan_shred / keep_original, retention, sensitive flag, go-paperless tip), and he swipes right to file the PDF into his Google Drive "Paperwork Archive" (11 numbered folders) or left to shred. Current pain: a sign-in check on every open, and Drive disconnecting on short-lived access tokens. The goal is features worth stealing, not a copy.
Date: 2026-10-13
Method: public sources only (Adobe help docs, release notes, marketing page, App Store and Google Play listings and reviews, Adobe Community forum threads, press). No account, no login, no app install. Reddit could not be read: the public Arctic Shift archive returned "Too many requests" on every attempt, so no Reddit quotes are included.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Store listing (US) | https://apps.apple.com/us/app/adobe-scan-pdf-ocr-scanner/id1199564834 | 4.9 stars, 1.6M ratings; v26.09.29 (Sep 29); 418.3 MB; iOS 18+; IAP $3.99 to $69.99 (Scan Plus $4.99/mo or $19.99/yr, Scan Premium $9.99/mo); privacy labels incl. "Data used to track you: Identifiers"; version history |
| 2 | App Store all reviews | https://apps.apple.com/us/app/id1199564834?see-all=reviews | 10 reviews shown, mostly 2018 to 2023, overwhelmingly positive |
| 3 | Google Play listing | https://play.google.com/store/apps/details?id=com.adobe.scan.android&hl=en_US | 4.5 stars, about 3.0M reviews, 100M+ downloads, updated Oct 8, 2026; full description; 3 reviews in page |
| 4 | Help: Take scans (iOS) | https://www.adobe.com/devnet-docs/adobescan/ios/en/scan.html | capture modes, auto-capture prompts, default names per mode, ID card two-sided flow, gallery document detection, quick actions |
| 5 | Help: Take scans (Android) | https://www.adobe.com/devnet-docs/adobescan/android/en/scan.html | High-Speed Scan, flash modes, filter names, cleanup fill, multi-select page edits, OCR language packs, settings list |
| 6 | Help: Modify your scans (iOS) | https://www.adobe.com/devnet-docs/adobescan/ios/en/modify.html | 9 filters, default filter, cleanup, markup, resize, "Scan in progress" resume dialog |
| 7 | Help: Manage scans (iOS) | https://www.adobe.com/devnet-docs/adobescan/ios/en/findingfiles.html | Recent vs All scans, sort, search by name or content with type and date filters, rename suggestions, business card to contacts, import with document detection |
| 8 | Help: Manage subscriptions (iOS) | https://www.adobe.com/devnet-docs/adobescan/ios/en/managingsubscriptions.html | free vs Premium features; yearly has 7-day trial |
| 9 | Help index (iOS) | https://www.adobe.com/devnet-docs/adobescan/ios/en/ | full topic list incl. Siri shortcuts, Files app, "Save a copy to Google drive or Dropbox" |
| 10 | Release notes (Android) | https://www.adobe.com/go/scan-android-release-notes | High Speed Scan beta (2023), AI Assistant (May 2025), Generative summary (Aug 2025), auto straighten (Nov 2025) |
| 11 | Marketing page | https://www.adobe.com/acrobat/mobile/scanner-app.html | "suggests filenames and dates", custom folders, encryption in transit and at rest |
| 12 | Community: file name from OCR | https://community.adobe.com/questions-517/adobe-scan-file-name-from-ocr-11678 | Adobe staff (2021, 2024): Scan does not name files from captured text |
| 13 | Community: May 2020 release notes | https://community.adobe.com/questions-517/what-s-new-with-the-adobe-scan-may-2020-release-10605 | OCR-based filename suggestions in the rename dialog, on-device OCR only |
| 14 | Community: turn off cloud upload | https://community.adobe.com/t5/adobe-scan-discussions/turn-off-adobe-scan-cloud-upload/m-p/12938023 | staff: "the application cannot function without uploading the files to the cloud" (2024) |
| 15 | Community: OCR on 600 pages | https://community.adobe.com/questions-517/ocr-on-scans-up-to-600-pages-12100 | Premium OCR cap 100 pages complaints |
| 16 | Community: 25-page limit | https://community.adobe.com/t5/adobe-scan-discussions/limit-25-pages-counting-method/m-p/13136638/highlight/true | older free OCR cap of 25 pages; now 5 per source 3 |
| 17 | Community: no access to my scans | https://community.adobe.com/questions-517/no-access-for-my-documents-i-scanned-using-adobe-scan-11648 | scans live only in Document Cloud, so sign-in is required to see them |
| 18 | Community: Files app auth loop | https://community.adobe.com/t5/adobe-scan-discussions/adobe-scan-and-files-app-ios-and-auth-endless-loop/m-p/14527367 | repeated auth prompts from the iOS Files provider (2024) |
| 19 | Ubergizmo (2017) | https://ubergizmo.com/2017/11/adobe-scan-automatic-document-detection/amp | Sensei scans the camera roll and surfaces only document photos |
| 20 | Adobe Experience League lab | https://experienceleague.adobe.com/en/docs/document-cloud-learn/lab719/gsd/scan | "auto-detects your receipt"; no receipt fields described |

Checked and came up empty or blocked: Reddit (Arctic Shift API rate-limited, HTTP 429); a gHacks "Why I won't be using Adobe Scan" link resolved to a news index, not the article; no current official doc on receipt field extraction.

## Core loop

Point the camera at paper, let auto-capture find the edges and snap, keep scanning more pages (or let High-Speed Scan do it hands-free), tidy in Review (crop, filter, cleanup, reorder), tap Save PDF, which OCRs and uploads to Adobe Document Cloud. Later, find the file by name or by its text. (4, 5, 6, 7)

Paper Trail's loop is different in kind: Adobe Scan stops at "a searchable PDF in the cloud". Paper Trail continues to a decision (file, shred, keep the original) and a destination folder. Adobe has no verdict, retention or paperless concept.

## Capture

| question | answer | source |
| --- | --- | --- |
| Modes | Document (default), Book (two facing pages split on a dotted center line), Whiteboard (full frame, no edge detection), Form (opens Fill & Sign), ID card (front, then prompts for back, combined into one page), Business card (Save to Contacts). Picked by the user before capture. | 4, 5 |
| Auto-capture | On by default, toggleable. Live edge detection with blue corner dots. Prompts: "Looking for document", "Capturing… hold steady", "No document found. Capture manually". | 4, 5 |
| Manual capture | Center document, tap shutter. | 4 |
| Flash | Always on, always off, or auto (dark settings only). | 5 |
| Multi-page | After each capture: "Keep scanning" or "Retake". High-Speed Scan (Premium) captures page after page without tapping Keep scanning. | 4, 5, 8 |
| Curved pages | Straighten fixes curvature, now automatic on every capture in document or book mode and on imports (Nov 2025), and works when not all four corners are visible (2026). Toggle per page in crop. | 1, 10 |
| Crop | Drag handles or "Auto-Detect" to re-find borders. | 4 |
| Filters | iOS: Original color, Auto-color, Vintage look, Light text, Crumpled, Warm color, Cool color, Grayscale, Whiteboard. Android lists five (Original color, Auto-color, Light text, Grayscale, Whiteboard). "Apply to all pages". Default filter is a preference. | 5, 6 |
| Cleanup | Eraser that fills with surrounding color or a picked color (eyedropper). Magic eraser (Premium) removes fingers, shadows, stains, creases in one tap; auto finger removal added Apr 2026. | 1, 3, 5, 6 |
| Adjust | Brightness and contrast sliders, apply to all pages; markup pen; resize all pages to a paper size such as "A4 Portrait". | 5, 6 |
| Import | From the photo library; document detection sorts document photos ahead of selfies and artwork; "Show More Documents" / "Show All Photos"; last month first. Play listing calls this "Smart library": it "finds documents, receipts, and photos in your library". | 3, 7, 19 |
| Interrupted scan | Leaving an unsaved capture shows a "Scan in progress" dialog with "Continue" or "Save now", plus a notification. | 6 |
| Voice | Siri shortcuts to start a scan (iOS). | 9 |

## Reading and extraction

| question | answer | source |
| --- | --- | --- |
| OCR | Automatic on save; makes text searchable, copyable, and (Premium) editable. English plus 18 languages; on-device language packs. | 1, 5 |
| OCR limit | Free: 5 pages per scan; Premium: up to 100. Earlier free cap was 25. Users with long documents complain. | 3, 15, 16 |
| Type recognition | Mostly user-chosen mode. Business cards are detected and offer Save Contact. Gallery import separates documents from non-documents. A learning lab says it "auto-detects your receipt", but no receipt fields (merchant, total, date) are documented: unknown. | 4, 7, 19, 20 |
| Field extraction | Business card contact fields only. Phone and email in text trigger quick action buttons (email, call, copy). No dates, amounts or issuers extracted into fields. | 4, 7 |
| AI | AI Assistant answers questions about a scan with citations (May 2025); Generative summary gives a shareable key-points overview (Aug 2025). Pricing tier for these: unknown from public pages. | 3, 10 |

## Organizing and filing

| question | answer | source |
| --- | --- | --- |
| Default names | Per mode: "Adobe Scan + date", "Book + date", "Whiteboard + date", "ID card + date", "Business Card + date". Default name template is a preference with tappable suggestion chips. | 4, 7, 12 |
| Smart names | The rename dialog on the Review screen shows suggestions from recognized text, only when OCR ran on device; server OCR gives date suggestions only. Adobe staff in 2021 and 2024 said Scan does not name files from text. Current state: conflicting, treat as unknown. | 7, 12, 13 |
| Folders | Custom folders claimed on marketing page and Play listing; help docs do not describe them. | 3, 11 |
| Library views | "View Recent scans" / "View All scans"; "Sort by Name" / "Sort by Date"; multi-select. | 7 |
| Destinations | Save PDF uploads to Adobe Document Cloud (always). Copy to device, Google Drive, Dropbox, email, link, Acrobat Reader, iOS Files provider. "Save as JPEG" for some modes. | 4, 5, 9 |

## Search

From the home screen, search by file name or by content (OCR text), with filters for document type and date range. Search within an open file. Quality depends on OCR. On-device versus server search: unknown. (7)

## Retention and shredding

None. Adobe Scan has no keep/shred verdict, retention period, or "originals to keep" list. The closest thing is deleting a file from Document Cloud, which staff warn is unrecoverable. (14)

## Going paperless

None. No sender tracking or paperless suggestions. The pitch is "paper to digital" in general. (1, 3)

## Sync and integrations

- Every saved scan uploads to Document Cloud; there is no opt-out and no local-only mode (staff, 2024). (14)
- Scans are only visible after sign-in because they live in the cloud. (17)
- Upload problems are a recurring forum topic: stuck "in progress", slow uploads, files in Recent but not in All scans. (14)
- iOS Files provider exists but one user hit an "endless loop" of auth prompts. (18)
- Google Drive and Dropbox are copy targets, not the primary store. One Play reviewer saves to Google Drive "instead of Adobe Cloud" without trouble. (3, 9)
- Opens in Acrobat Reader for sign, fill, comment; Siri shortcuts; Contacts. (4, 9)

## Security and privacy

- Encryption in transit and at rest in Document Cloud. (11)
- Password-protect a scan (Premium). (8)
- App Store privacy label lists Identifiers as "Data used to track you", and Search History, User Content and Contact Info as linked to the user. (1)
- Delete account in settings; send usage data toggle. (9)
- No sensitive-document flag or redaction concept beyond the cleanup eraser.

## Pricing

Free core scanning. Scan Plus $4.99/mo or $19.99/yr; Scan Premium $9.99/mo; Acrobat subscriptions also unlock it. Yearly plans have a 7-day trial. Premium unlocks High-Speed Scan, Magic eraser, password protection, combine, compress, export to Office, edit text, OCR to 100 pages. (1, 3, 8)

## Screens

States marked "seen" come from help docs; "reported" from reviews or forums; "inferred" from copy.

| ID | screen | how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign in | first run | Adobe ID, Google, Apple, company/school ID | provider buttons | "unable to sign in" (reported 14, 17) |
| S02 | Capture | home camera button | Shoot pages | mode carousel (Whiteboard, Book, Document, ID card, Business card), auto-capture toggle, flash, import thumbnail, shutter, live corner dots, status banner | searching, holding steady, no document found (seen 4) |
| S03 | Post-capture sheet | after a snap | Continue or redo | "Keep scanning", "Retake", page count thumbnail | seen 4 |
| S04 | Review | after capture | Fix pages before save | page strip, crop, rotate, filter, cleanup, markup, resize, reorder, add, delete, rename pencil, "Save PDF" | seen 6 |
| S05 | Rename dialog | pencil on S04 | Name the file | text field, suggestion chips from OCR text or date, "Edit Default Name" | seen 7 |
| S06 | Photo picker | add-photo icon | Import | documents first, "Show More Documents", "Show All Photos" | seen 7 |
| S07 | Recent scans home | app open | Recent files | file cards with quick actions (share, Save as JPEG / Save to Contacts / Fill & Sign), search bar | seen 4, 7 |
| S08 | All scans | overflow | Full library | sort by name or date, multi-select | seen 7 |
| S09 | Search results | search bar | Find by name or content | type and date range filters | seen 7 |
| S10 | Preview | tap a file | Read the PDF | find in file, text actions (copy, email, call, web), AI Assistant, Generative summary | seen 7, 10 |
| S11 | Scan in progress | reopen with unsaved capture | Recover work | "Continue", "Save now" | seen 6 |
| S12 | Preferences | profile icon | Settings | default filter, default file name, OCR language, save originals to gallery, cellular data, borders, usage data, delete account | seen 5, 9 |
| S13 | Paywall | Premium feature tap | Subscribe | monthly and yearly, 7-day trial on yearly | trial vanishes on monthly (reported 3) |

## Flows

1. **Scan a stack (free):** S02 auto-captures page 1, S03 "Keep scanning", repeat, S04 review, S05 name, Save PDF, OCR plus upload.
2. **Scan a stack (Premium):** High-Speed Scan, pages captured back to back with no tap between, then S04.
3. **ID card:** capture front, prompt for back, both combined onto one page, "Review and save". (4)
4. **Business card:** capture, OCR, Save Contact, pre-filled New Contact form with thumbnail. (7)
5. **Import from camera roll:** S06 surfaces document photos, select, review, save. (7)
6. **Find a document later:** S07 search, filter by type and date, open, find in file. (7)
7. **Recover an interrupted scan:** S11 Continue or Save now. (6)
8. **Send to Drive:** open file, Save a copy to Google Drive. (9)

## Components

Corner-dot edge overlay; capture status banner with three states; mode carousel; post-capture Keep scanning / Retake sheet; page thumbnail strip with long-press multi-select; filter tray with "Apply to all pages"; eraser with fill-color eyedropper; rename dialog with suggestion chips; file card with a mode-specific third quick action; search with type and date filters; resume dialog.

## Inferred data model

```
User        id, adobe_id, auth_provider (adobe | google | apple | enterprise), subscription_tier, preferences
            evidence: S01, S12, 8, 9          confidence: medium

Preferences default_filter, default_name_template, ocr_language, save_originals_to_gallery, cellular_ok, auto_capture
            evidence: 5, 6, 9                 confidence: high

Scan        id, user_id, mode (document | book | whiteboard | form | id_card | business_card), name, created_at,
            status (in_progress | saved | uploading | failed), cloud_id, folder_id, password_protected
            evidence: 4, 6, 14                confidence: medium

Page        scan_id, order, image_ref, crop_quad, filter, brightness, contrast, straighten_on, cleanup_strokes, markup
            evidence: 4, 5, 6                 confidence: medium

OcrText     scan_id, page, text, language, on_device (bool)
            evidence: 5, 7, 13                confidence: medium

Contact     scan_id, name, phone, email, company (business card only)
            evidence: 7                       confidence: medium

Folder      id, user_id, name
            evidence: 3, 11                   confidence: low (no help doc)
```

## Feature matrix

See features-adobe-scan.csv.

## What users say

App Store and Google Play quotes are from the store pages as fetched (App Store excerpts came through a summarizer limited to short passages; Play quotes were pulled from the raw page HTML). Forum quotes came through WebFetch and were not checked character for character. Store star ratings for App Store reviews were not displayed.

**Praise**

1. PRAISE, App Store, OhDiedraDarling, 2018-09-01 (source 2): "The app scanned so well, I could hardly step to the next page before Adobe Scan had the previous page formatted."
2. PRAISE, App Store, manDown1130, 2020-11-03 (source 2): "it gets it right on the first time."
3. PRAISE, App Store, Newskoolwhtboy23!, 2019-12-11 (source 1): "there isn’t any other way u will get the OCR accuracy that will auto save to an amazing platform"
4. PRAISE, App Store, denniscd, 2018-01-18 (source 1): "I always return to Adobe Scan after trying everything else new."
5. PRAISE, Google Play, 5 stars, A Google user, 2019-01-30 (source 3): "I prefer to save to my Google Drive account instead of Adobe Cloud and there is no problem with that."
6. MIXED, App Store, DragonScale22, 2022-04-04 (source 2): "the default scan filter can be a bit finicky depending on how dark you write" (still "the best scanner I've found")

**Complaints**

7. COMPLAINT, Google Play, 1 star, Randy Conner, 2026-06-27 (source 3): "Once you start to sign up for the product and you change it to pay by monthly, magically the 7-Day free trial vanishes without any warning."
8. COMPLAINT, Google Play, 1 star, Jason Wood, 2024-01-05 (source 3): "If it were a one-time $10-25, maybe. But $9.99/monthly?? Not going to happen."
9. COMPLAINT, App Store, everyones_favorite_freak_of_nature, 2023-06-04 (source 2): "it deleted all the cloud files I had. It was a huge loss"
10. COMPLAINT, App Store, Vanessa123456780, 2019-07-22 (source 2): "the app still doesn't "find" the document's edges as precisely as I'd like."
11. COMPLAINT, App Store, Newskoolwhtboy23!, 2019-12-11 (source 2): "the Document auto sensor takes a pretty good amount of pics before u r ready"
12. COMPLAINT, App Store, OhDiedraDarling, 2018-09-01 (source 2): "A'S' did not close a doc' if I had a short delay between pages."
13. COMPLAINT, Adobe Community, giriprasads90253262, 2017-06-29 (source 14): "Is there any way to turn off the automatic upload to cloud feature ?"
14. COMPLAINT, Adobe Community, Rick N, 2022-05-19 (source 14): "Recently the upload is painfully slow everytime."
15. COMPLAINT, Adobe Community, Steve24510832qtru, 2022-05-18 (source 14): "I can see them in the app under 'recent scans' but they are not showing up in 'view all scans' or in the cloud."
16. COMPLAINT, Adobe Community, eduardo_3923, 2025-04-21 (source 15): "the limitation of 100 pages destroys my use case."

Staff answer worth noting, Adobe Community, Souvik Sadhu, 2024-03-13 (source 14): "the application cannot function without uploading the files to the cloud for processing."

**Patterns**

- Most praised: capture speed and accuracy. Auto edge detection plus cleanup gets a usable page on the first try with no fiddling.
- Most complained about: money. Subscription price, trial terms that change by plan, and a free OCR cap that shrank from 25 to 5 pages.
- Close second: the cloud. Forced upload, no local-only mode, sign-in required to see your own scans, stuck uploads, and lost cloud files. This mirrors Paper Trail's Drive disconnect pain exactly.
- Auto-capture can fire too early (quote 11) or miss edges (quote 10).

## Out of scope (cannot or should not be cloned)

- **Adobe Sensei models and Document Cloud.** Proprietary. Paper Trail uses Claude for reading and Google Drive for storage; browser-side edge detection can come from OpenCV.js or jscanify.
- **Magic eraser (generative fill of fingers, stains).** Heavy ML. A simple crop plus Auto-color filter covers most of a paperwork box.
- **Office export, combine, compress, Fill & Sign.** Acrobat territory and not needed to clear a box.
- **Native Siri shortcuts and Contacts write.** Native-app only; a web app can at best use a Home Screen shortcut or share target.
- **Subscription paywall.** Personal app, no billing.
- **Forced cloud upload and mandatory sign-in.** The anti-pattern to avoid, not a feature.

## Size

Screens 13 (about 9 relevant), flows 8 (about 6 relevant), entities 7 (about 5 relevant).

Hard parts for Paper Trail:
1. Live edge detection and auto-capture in a mobile browser at usable frame rates (OpenCV.js in a worker, or jscanify), with a stability check so it does not fire before the page is still.
2. A local-first queue so captures survive a dropped Drive token or closed tab, then upload when auth is fresh.
3. Content search across filed documents without re-downloading PDFs, which means storing Claude's extracted text alongside each Drive file.

## Steal for Paper Trail

1. **Auto-capture with live corner dots and three plain status lines** ("Looking for document", "Hold steady", "Can't find edges, tap to shoot"). A box of paper is all flat pages, so hands-free capture is the biggest speed win. Effort: M.
2. **Stack mode (High-Speed Scan).** Keep shooting page after page with no tap between, then split into documents. Clearing a box is exactly the stack case Adobe charges for. Effort: M.
3. **"Scan in progress" resume, done local-first.** Keep every capture and every pending swipe in IndexedDB and replay them to Drive when the token is fresh, so a Drive disconnect never loses work or blocks the swipe. Directly fixes the current pain, and avoids Adobe's most hated behavior (cloud required to function). Effort: M.
4. **Rename suggestion chips.** Show Claude's filename plus two or three alternates (issuer, date, type variants) as tappable chips, and a default name template in settings. Cheap, and it fixes the times Claude's name is close but not right. Effort: S.
5. **Smart library import.** When picking from the camera roll, surface photos that look like documents first (Claude or a cheap on-device check), then "Show all photos". Bryce already has receipts and letters sitting in Photos. Effort: S to M.
6. **Search by content with type and date filters.** Store Claude's extracted text and fields in Firestore and search across them, filtering by folder, type and date. Turns the archive into something he can query, not only browse. Effort: M.
7. **ID card two-sided capture onto one page.** Front, prompt for back, combine. Insurance cards, licenses and benefit cards are common in a paperwork box, and both sides matter. Effort: S.
8. **One filter tray with Auto-color as the default and "Apply to all pages".** Smaller, legible PDFs in Drive without per-page fiddling; Grayscale and Light text for faint or pencil pages. Effort: S.
9. **Text quick actions in the review card.** Detected phone, email and URL become tap targets, so the go-paperless tip can link straight to the sender's billing or paperless page. Effort: S.
10. **Auto straighten for curled or folded pages.** Old folded letters and receipts curl; perspective correction is the minimum, curvature is a stretch goal. Effort: M (perspective) to L (curvature).
