# Recon map: Microsoft Lens (formerly Office Lens) plus Apple's built-in Scan Documents (Notes, Files)

Scope: the capture half of the job. How a phone turns a sheet of paper into a clean, cropped, multi-page file and where that file goes. Lens is the benchmark people loved; Apple Notes and Files are the zero-install baseline Bryce already has on his iPhone.
For: Paper Trail, Bryce's phone-first Firebase web app for clearing a box of paper (scan, Claude reads it, swipe to file into the Google Drive "Paperwork Archive" or shred). The goal is to steal capture and filing ideas, not to copy either app.
Date: 2026-10-13
Method: public sources only (Microsoft and Apple support pages, press, Apple Support Community, MacPowerUsers forum, Reddit through the public Arctic Shift archive). No accounts, no logins.

**Status note.** Microsoft Lens is retired. The live Microsoft support page says Lens was retired from iOS and Android starting January 9, 2026, removed from both stores on February 9, 2026, and new scans stopped after March 9, 2026; the recommended replacement is the OneDrive app's built-in scanner (source 1). Coverage from August 2025 gave an earlier schedule (mid-October to December 2025) and named Microsoft 365 Copilot as the replacement (source 4), so the plan moved at least once. The App Store and Google Play listings now return 404, so store ratings, screenshots and store reviews could not be read (sources 20, 21). Everything below about Lens describes the app as documented before retirement.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Microsoft support: Retirement of Microsoft Lens | https://support.microsoft.com/en-gb/topic/retirement-of-microsoft-lens-fc965de7-499d-4d38-aeae-f6e48271652d | Jan 9 / Feb 9 / Mar 9, 2026 dates; OneDrive replacement; "OneDrive does not support saving scans locally on your device"; old scans viewable only while signed in |
| 2 | Microsoft support: Microsoft Lens for iOS | https://support.microsoft.com/en-us/lens/microsoft-lens-for-ios | modes, orange frame, edit tray, export targets, OCR languages, VoiceOver framing guidance |
| 3 | Microsoft support: Microsoft Lens for Android | https://support.microsoft.com/en-us/lens/microsoft-lens-for-android | adds Actions mode (Text, Table, Read, Contact, QR), Reorder, 100-image limit, reopen PDFs via My Files |
| 4 | 9to5Mac, Aug 8, 2025 | https://9to5mac.com/2025/08/08/microsoft-will-soon-discontinue-its-excellent-pdf-scanner-app/ | Copilot lacks direct save to OneNote/Word/PowerPoint, business cards, read aloud; top comment recommends QuickScan |
| 5 | TechRadar | https://www.techradar.com/pro/microsoft-is-killing-off-its-well-loved-lens-pdf-scanner-app-in-favor-of-ai | headline only readable ("well-loved Lens PDF scanner"); body did not load |
| 6 | Reddit r/androidapps, "Now that Microsoft Lens is retired, what are people using as a document scanner." (gerryf19, 2026-03-10, 63 points, 64 comments) | https://www.reddit.com/r/androidapps/comments/1rqd6is/ | read via Arctic Shift: https://arctic-shift.photon-reddit.com/api/comments/search?link_id=1rqd6is&limit=100 (first 100k chars only) |
| 7 | Reddit r/androidapps, "MS Lens Retirement: PDF Scan Alternatives" (2026-01-15, 43 comments) | https://www.reddit.com/r/androidapps/comments/1qdg9gy/ | via https://arctic-shift.photon-reddit.com/api/comments/search?link_id=1qdg9gy&limit=100 |
| 8 | Reddit r/androidapps, "Microsoft Lens alternative" (Yodl007, 2026-03-12) | https://www.reddit.com/r/androidapps/comments/1rrr5ot/ | via https://arctic-shift.photon-reddit.com/api/posts/ids?ids=1rqd6is,1rrr5ot,1rsrs0s,1mlpuli |
| 9 | Reddit r/androidapps, "alternative to Microsoft Lens" (LordKamiya, 2025-08-09) | https://www.reddit.com/r/androidapps/comments/1mlpuli/ | same Arctic Shift call as 8 |
| 10 | Reddit r/androidapps, "Is there a way to continue using MS Lens?" (Amir_kem, 2026-03-13) | https://www.reddit.com/r/androidapps/comments/1rsrs0s/ | same Arctic Shift call as 8 |
| 11 | Capterra, Microsoft Lens reviews | https://www.capterra.com/p/193405/Microsoft-Office-Lens/reviews/?page=2 | page returned 403; quotes come from search-result snippets only, reviewer names unknown, not checked against the page |
| 12 | Apple support 108963: How to scan documents on your iPhone or iPad | https://support.apple.com/en-us/108963 | Notes and Files steps, Auto vs manual (shutter or volume button), drag corners, Keep Scan, flash and filter on iOS 26, Files asks for a save location, Markup signature |
| 13 | Apple iPhone User Guide: Scan text and documents in Notes | https://support.apple.com/guide/iphone/scan-text-and-documents-iph653f28965/ios | article body did not load (table of contents only) |
| 14 | iDownloadBlog / WebNots how-to guides (iOS 11 era onward) | https://www.idownloadblog.com/2017/09/19/how-to-scan-documents-in-ios-11-notes-app/ and https://www.webnots.com/how-to-scan-documents-on-iphone-with-notes-app/ | filter names Color / Grayscale / Black & White / Photo, change filter after scan, drag to reorder, per-page rotate / delete / insert. Read through search summaries; button placement may differ on iOS 26 |
| 15 | Apple Support Community 253718020 (rankthetank, Mar 2022) | https://discussions.apple.com/thread/253718020 | Notes OCR text lost when exported as PDF |
| 16 | MacPowerUsers forum, "Scanning in iOS and OCR" (Aug 2022) | https://talk.macpowerusers.com/t/scanning-in-ios-and-ocr/30222 | Notes scans get OCR, Files scans do not, export strips OCR |
| 17 | Apple Support Community 255972759 (Craig2025, Feb 15, 2025) | https://discussions.apple.com/thread/255972759 | no way to default auto-shutter off; "jumps the gun" |
| 18 | Apple Support Community 254602935 (dogofob, Jan 31, 2023) | https://discussions.apple.com/thread/254602935 | Notes scan saved as one image instead of a multi-page PDF when lighting caused shading |
| 19 | iThinkDiff, Best iPhone Document Scanner Apps in 2026 | https://www.ithinkdiff.com/best-iphone-document-scanner-apps-ios-26/ | Preview on iOS 26 now scans; built-ins "good enough for many users"; third parties win on OCR, cloud, document management |
| 20 | App Store listing (Lens) | https://apps.apple.com/us/app/microsoft-lens-pdf-scanner/id975925059 | 404, app removed |
| 21 | Google Play listing (Lens) | https://play.google.com/store/apps/details?id=com.microsoft.office.officelens&hl=en_US | 404, app removed |

Checked and came up empty or blocked: Neowin, Windows Central and BetaNews retirement articles (403 or body not loaded), Capterra and Software Advice (403), Wayback Machine (fetch tool cannot reach it). Store ratings, review counts and screenshots for Lens: unknown.

## Core loop

**Lens:** open the app straight into the camera, pick a mode (Document, Whiteboard, Business Card, Photo; Android adds Actions), line the orange frame up with the page, tap to capture, keep capturing pages, then fix crop, filter and order in one edit tray and pick where it goes (Photos, PDF, OneDrive, OneNote, Word, PowerPoint, email) (sources 2, 3).

**Apple:** from Notes (paperclip or More, then Scan Documents) or Files (More, then Scan Documents), hold the phone over the page; in Auto mode it captures by itself, in manual you press the shutter or a volume button, drag the corners, tap Keep Scan, repeat, then Save (source 12).

## Capture

| question | Lens | Apple Notes / Files | source |
| --- | --- | --- | --- |
| Modes | Document, Whiteboard, Business Card, Photo; Android also Actions (Text, Table, Read, Contact, QR Code). Switch by swiping near the bottom | One document mode; filter choice (Color, Grayscale, Black & White, Photo) instead of modes | 2, 3, 14 |
| Live edge detection | Orange frame outlines the page in the viewfinder; "gets rid of shadows and odd angles". Capterra reviewers single out that the crop boundary shows while framing, not only after | Detects the page and auto-captures; algorithm not documented | 2, 3, 11, 12 |
| Auto-shutter | Not documented for Lens (unknown); capture is a tap on the round camera button | Auto is the default; manual via shutter or volume button. No setting to make manual the default; users say auto "jumps the gun" | 2, 12, 17 |
| Framing guidance for accessibility | VoiceOver and TalkBack speak directions like "move right" | Unknown | 2, 3 |
| Flash | Auto by default, toggle in the corner | Flash option on iOS 26; one user fixed bad scans by forcing flash On instead of Auto | 2, 12, 18 |
| Import existing photos | Yes, Picture button opens the photo library; same edit pipeline | Unknown for Notes and Files scan flow (not documented in source 12) | 2, 3 |
| Multi-page | Capture several pages in a row, edit later; Android up to 100 images per scan on devices with more than 3GB RAM | Keep scanning, all pages in one session become one document | 3, 12 |

## Cleanup and review

| feature | Lens | Apple | source |
| --- | --- | --- | --- |
| Adjust corners after capture | Yes, adjust borders, Crop tool, Confirm | Drag the corners before Keep Scan; later per-page crop via the page menu | 2, 12, 14 |
| Filters | Yes ("removing all colors" given as the example); names not documented | Color, Grayscale, Black & White, Photo; can be changed after the scan, per page | 2, 14 |
| Rotate | Yes | Yes, per page | 2, 14 |
| Delete page | Yes | Yes, per page | 2, 14 |
| Reorder pages | Android: Reorder view with drag and drop; iOS: not documented (unknown) | Drag thumbnails in the page preview | 3, 14 |
| Annotate | Pen and Text | Markup, including saved signature | 2, 12 |
| Reopen and add pages to an old PDF | Android: My Files, then edit, add or reorder | Unknown | 3 |
| File naming | Not documented. Capterra snippet: auto naming means a manual rename step. Reddit: the name became the email subject when sharing | Unknown from Apple's page | 3, 6, 11 |

## Reading and extraction

| feature | Lens | Apple | source |
| --- | --- | --- | --- |
| Searchable PDF | Yes, "Text is extracted so it can be searched" | Notes runs OCR and Notes search finds it, but exporting the PDF strips the text layer; Files scans get no OCR at all | 2, 15, 16 |
| Text to Word | OCR into an editable Word file in OneDrive, keeps "the general layout" | No | 2 |
| Table extraction | Android Actions, Table: 21 languages | No | 3 |
| Copy text | Android Actions, Text: 30 languages, handwriting English only | Select and copy inside Notes | 3, 16 |
| Read aloud | Immersive Reader | Unknown | 2, 3 |
| Business card to contact | Yes, vCard to Contacts and OneNote | No | 2, 3 |
| QR code | Android Actions | Camera app, not the scanner (unknown in the scanner) | 3 |

## Organizing and filing

- **Lens:** no folders inside the app. A Capterra reviewer says it "lacks any folder to organise the scanned images" and that PDF export is only offered right after scanning (source 11). Word, PowerPoint and PDF go to the Documents folder on OneDrive by default; the Save button changes the location (sources 2, 3).
- **Apple Files:** you choose the destination folder at save time, or start the scan from inside the target folder, which is the closest thing to filing in either app (source 12).
- **Apple Notes:** the scan lives inside a note; organizing is whatever note folder it is in (source 12).
- Neither app suggests a folder from the content, sets a document type, or knows anything about retention. That whole layer is Paper Trail's own.

## Search, retention and shredding, going paperless

None of these exist in Lens or Apple's scanners. Search is limited to Notes' OCR search inside Notes (source 15). No retention rules, shred tracking, or paperless guidance in any source. This confirms Paper Trail's read, verdict and tracker layers have no competition here; the steal is all on the capture side.

## Screens

| ID | screen | how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| L01 | Lens camera | app launch | Capture | orange page frame, round shutter, mode carousel (swipe), Picture (import) button lower left, flash toggle upper right | capturing (documented) |
| L02 | Lens edit tray | after capture | Clean up pages | Add, Filter, Crop, Rotate, Delete, Pen, Text, Reorder (Android), Done | filled (documented) |
| L03 | Lens Reorder | edit tray, Android | Order pages | all pages in one grid, drag and drop | documented |
| L04 | Lens export / Save to | Done | Pick targets | Photos/Gallery, PDF, OneNote, OneDrive, Word, PowerPoint, email; Save location control; sign-in prompt for cloud targets | sign-in prompt "may" appear (documented) |
| L05 | Lens Actions results | Actions mode, Android | Text, table, read aloud, contact, QR | copy, share | documented |
| L06 | Lens My Files | Android | Reopen and edit past PDFs | list of files | documented; no folders (reported) |
| A01 | Apple scanner camera | Notes or Files, Scan Documents | Capture | Auto / Manual toggle, flash, filter, shutter, page count thumbnail | auto fires too early (reported) |
| A02 | Apple corner adjust | after a manual shot | Fix crop | four draggable corners, Retake, Keep Scan | documented |
| A03 | Apple page review | thumbnail tap | Per-page edit | crop, filter, rotate, delete, reorder | documented in older guides |
| A04 | Files save sheet | Save | Choose folder | folder browser, Save | documented |

## Flows

```
F01 Lens: scan a multi-page bill to PDF
    L01 Document mode -> tap per page -> L02 adjust borders, filter -> Done -> L04 PDF + location -> Save
    happy path taps: ~3 + 1 per page
    edge: wrong paper size detected occasionally (Capterra snippet); cloud targets ask for sign-in

F02 Lens: import a photo already in the camera roll
    L01 Picture -> pick -> L02 adjust borders -> Done -> L04
    happy path taps: ~5
    note: Reddit users name this as the thing OneDrive's replacement scanner cannot do

F03 Apple Files: scan straight into a folder
    Files -> open target folder -> More -> Scan Documents -> auto capture pages -> Save
    happy path taps: ~4
    edge: auto captures before the page is steady; no OCR on the result

F04 Apple Notes: scan then search later
    Notes -> paperclip -> Scan Documents -> pages -> Save -> search by a word on the page
    edge: shading in the room can save a single image instead of a multi-page PDF; exported PDF loses its text
```

## Components

Page-outline overlay drawn live on the camera feed; mode or filter carousel; capture count badge; page thumbnail strip; per-page edit tray (crop, rotate, filter, delete); four-corner crop editor; drag-and-drop page grid; destination picker with remembered location; filter preview chips.

## Inferred data model

```
Scan            id, created_at, mode, page_ids[], output_targets[], name, location
Page            id, scan_id, order, raw_image, corners[4], rotation, filter, cleaned_image
OcrText         page_id, text, language, layout (Word), table (Actions)
Export          scan_id, target (photos|pdf|onedrive|onenote|word|ppt|email), path, account
Contact         (business card mode) fields -> vCard
```

Apple's model is simpler: a note or a Files PDF holding ordered pages, each page with corners, filter, rotation; OCR text held inside Notes only.

## Sync and integrations, security and privacy, pricing

- **Sync:** Lens: OneDrive, OneNote, Word, PowerPoint, Outlook; local PDF and Gallery saves needed no sign-in (sources 2, 3). Its replacement, OneDrive, cannot save scans locally (source 1). Apple: iCloud Drive through Files.
- **Sign-in:** Lens saving to cloud targets "may" ask for a Microsoft account; local saves did not. After retirement, old scans need the last active account signed in (sources 1, 3). Reddit users specifically wanted a scanner that "doesn't require me to log in to anything" (source 8).
- **Privacy:** a Lens fan liked working "locally without having to interface with Cloud services" (source 7). Lens privacy labels: unknown (store page gone).
- **Pricing:** Lens was free with no ads (widely reported; store listing gone, so unconfirmed here: unknown). Apple's scanner is free and built in.

## Feature matrix

See features-microsoft-lens.csv.

## What users say

Quotes are verbatim. Reddit quotes come from the Arctic Shift archive JSON, read through WebFetch, so they were not compared character by character against reddit.com. Capterra quotes come from search-result snippets (page blocked), reviewer unknown. No App Store or Google Play reviews were readable because the listings are gone.

**Praise (Lens)**

1. PRAISE, Reddit, cyberphreak81, 2026-04-04 (source 6): "All the scanner apps available on Google Play that I tested are far inferior to Microsoft Lens"
2. PRAISE, Reddit, sbb_2696, 2026-03-24 (source 6): "Lens really did a proper job converting columns into, well, columns."
3. PRAISE, Reddit, green_krokodile, 2026-04-10 (source 6): "the quality doesn't compare with Lens, which was fantastic."
4. PRAISE, Reddit, randomicuser350, 2026-01-15 (source 7): "I liked MS Lens because it allowed me to work locally without having to interface with Cloud services that I don't need."
5. PRAISE, Reddit, randomicuser350, 2026-01-16 (source 7): "everything is local, and it allows me to digitize documents that I have as photos in my gallery."
6. PRAISE, Reddit, UnrealRealityX, 2026-01-16 (source 7): "the nice part of lens (and word and excel) was it was an app that did what it did great, and nothing else."
7. PRAISE, Reddit post, gerryf19, 2026-03-10 (source 6): "always appreciated that naming the document automatically made it the subject when shared with an email client."
8. PRAISE, Capterra snippet, reviewer unknown (source 11): Lens "auto detects and crops the subject during picture clicking and saves time, unlike other apps where auto cropping is done as a post processing part."

**Complaints (Lens and its replacements)**

9. COMPLAINT, Capterra snippet, reviewer unknown (source 11): "lacks any folder to organise the scanned images. Also, there is no option just to select a few images and export them as a PDF."
10. COMPLAINT, Capterra snippet, reviewer unknown (source 11): "occasionally when scanning the camera can have an issue determining the proper size of the paper"
11. COMPLAINT, Capterra snippet, reviewer unknown (source 11): "scanning a large number of pages and probably multiple of them is difficult."
12. COMPLAINT about OneDrive's scanner, Reddit, ermaneng, 2026-03-23 (source 6): "it lacks the feature of editing of already taken photos as scanned like detecting edges on crop"
13. COMPLAINT about OneDrive's scanner, Reddit, desi_swag, 2026-04-03 (source 6): "It wont let you upload existing photo and then process it"
14. COMPLAINT, Reddit, zminator, 2026-01-15 (source 7): "OneDrive for iOS doesn't do OCR for pdfs"
15. REQUEST, Reddit post, Yodl007, 2026-03-12 (source 8): "I want a standalone app that doesn't require me to log in to anything."
16. COMPLAINT, Reddit, Inevitable_Review_53, 2026-04-07 (source 6): "Office Lens was the goat until Microsoft just being Microsoft and decides to kill a great product"

**Complaints (Apple Notes / Files)**

17. COMPLAINT, Apple Community, Hedgehog182 (quoted by Craig2025), date unknown (source 17): "Scanning documents into notes is cool! However, it jumps the gun"
18. REQUEST, Apple Community, Craig2025, 2025-02-15 (source 17): "I would like to set the Auto Shutter Default = OFF."
19. COMPLAINT, Apple Community, rankthetank, 2022-03-05 (source 15): "this newly created PDF is then not 'searchable' anymore, neither in Preview nor in Adobe Acrobat Reader."
20. COMPLAINT, MacPowerUsers, acertree, 2022-08-10 (source 16): "If you scan a document from the files app OCR is not applied."
21. COMPLAINT, Apple Community, dogofob, 2023-01-31 (source 18): "my resulting "document" is an image of multiple pages instead of a pdf document with separate pages."

**Patterns**

- The most praised thing about Lens is plain scan quality: edge detection and crop shown live while framing, clean output, and good OCR (quotes 1 to 3, 8).
- The most repeated complaint is about losing it: every replacement drops something people used daily, mainly importing old photos with edge detection, local saving without a login, and OCR (quotes 12 to 15).
- Apple's scanner is good enough to capture, but its auto-shutter fires early with no way to default it off, and its OCR does not survive export (quotes 17 to 20).
- Nobody in either camp organizes inside the scanner. Folders, naming and filing happen elsewhere or not at all (quote 9).

## Out of scope (cannot or should not be cloned)

- Word and PowerPoint conversion, handwriting to drawing objects, Immersive Reader, business-card vCards, whiteboard mode. Not part of clearing a paper box.
- Native camera control (volume-button shutter, hardware flash control on iOS Safari is limited; torch support in the browser is unknown on iPhone).
- Microsoft and Apple account ecosystems (OneNote, iCloud). Paper Trail's target is Google Drive.

## Size

Screens 10, flows 4, entities 5. All relevant to Paper Trail's capture step, none to reading, verdicts or tracking.

Hard parts for a web app:
1. Live page-edge detection in mobile Safari: getUserMedia plus OpenCV.js or a small library (for example jscanify) running per frame without draining the battery.
2. Auto-shutter that waits for stillness and a steady outline, with a manual mode Bryce can make the default.
3. Perspective correction and a "document" cleanup filter in canvas, keeping files small enough to upload fast.
4. Building a PDF with a hidden text layer from Claude's read (pdf-lib can place invisible text; layout accuracy unknown).

Size: **M** for a capture overhaul that matches Lens on the steps Paper Trail needs.

## Steal for Paper Trail

1. **Live page outline while framing.** Draw the detected edges on the camera feed before the shot, the thing reviewers liked most about Lens. Fits because Bryce is working through a stack and wants every capture right the first time. Effort: L.
2. **Auto-shutter with a manual default that sticks.** Capture once the outline holds still for about a second, with a visible ring filling up; a toggle to manual that is remembered. Apple users ask for exactly that default and cannot get it. Effort: M.
3. **Batch multi-page capture with a page strip.** Keep shooting pages of one document, then retake, delete, rotate or drag to reorder in a thumbnail strip before Claude reads it. Multi-page statements are common in a box of paper. Effort: M.
4. **Same edge detection on imported photos.** Run corner detection and the corner editor on camera-roll photos too, the feature people say OneDrive's scanner dropped. Bryce may already have photos of documents. Effort: S once 1 exists.
5. **Searchable PDF in Drive.** Claude already reads every page; embed that text as an invisible layer so Drive search finds "Chase 2023" inside the file. Apple strips OCR on export and OneDrive skips it, which is the top Apple complaint. Effort: M.
6. **Document cleanup filter.** Default to a high-contrast "Document" filter (Lens and Apple's Black & White), with Color and Photo per page for checks or receipts with stamps. Smaller files mean faster Drive uploads. Effort: S.
7. **Local first, sign-in never blocks scanning.** Lens fans valued "work locally" and "no login". Let Paper Trail open straight to the camera, queue captures and Claude's reads on the device, and upload when Drive is ready, with Firebase auth persisted and Drive access refreshed server side so the token does not lapse. Directly answers both of Bryce's pain points. Effort: M.
8. **Meaningful filename everywhere.** Lens users liked the document name becoming the email subject. Paper Trail already has Claude's filename; use it as the Drive name, the share title and the PDF title metadata. Effort: S.
9. **Confirm the corners, not a dialog.** After auto capture, show Apple-style four-corner handles with a magnifier only when the detected outline is low confidence; otherwise go straight to the read. Keeps the swipe flow fast. Effort: M.
