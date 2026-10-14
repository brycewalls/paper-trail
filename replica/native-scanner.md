# Native scanner research: matching and beating Apple's Scan Documents

_Written 2026-10-13 for issue #32 (brycewalls/paper-trail), feeding the native Swift rewrite (#33). Builds on `recon-microsoft-lens.md` (Apple's scanner as a user sees it) and `overhaul-shortlist.md`. Every claim cites a source ID from the table below. Anything not confirmed is marked **unknown**._

## Bottom line

Build a **custom scanner** (AVFoundation capture, Vision document segmentation, Core Image correction), and use **VisionKit's `VNDocumentCameraViewController` only as a short-lived stopgap** so the rest of the native app (outbox, PDF with text layer, Drive upload, deck) can be built and tested on the phone while the custom camera is underway. VisionKit cannot meet issue #32's "beat it" list: you can't set the shutter default, it caps a session at 24 scans, and it hands back only finished UIImages. Don't take WeScan as a dependency (archived, older detector, deprecated APIs), but borrow its ideas under its MIT license. Commercial SDKs are quote-only and aimed at businesses; not worth it for a personal sideloaded app.

Rough effort: stopgap 1 to 2 days; custom scanner at Apple parity about 2 to 3 weeks of part-time sessions; stack mode and ID cards another 1 to 1.5 weeks on top. Details in section 6.

## Sources

| ID | Source | URL |
|---|---|---|
| S1 | Apple docs: VNDocumentCameraViewController | https://developer.apple.com/documentation/visionkit/vndocumentcameraviewcontroller |
| S2 | Apple docs: VNDocumentCameraScan | https://developer.apple.com/documentation/visionkit/vndocumentcamerascan |
| S3 | Scanbot blog: iOS document scanners, WeScan vs VisionKit (Oct 2025, vendor-written) | https://scanbot.io/blog/ios-document-scanners-wescan-vs-visionkit/ |
| S4 | Apple Developer Forums 792003: DataScannerViewController in the Simulator (AvdLee, Jul 2025) | https://developer.apple.com/forums/thread/792003 |
| S5 | Apple Developer Forums 77335: simulating the camera in Xcode | https://developer.apple.com/forums/thread/77335 |
| S6 | Antoine van der Lee: simulator camera via RocketSim | https://www.avanderlee.com/xcode/simulator-camera-test-your-app-without-a-physical-device/ |
| S7 | WWDC21 10041: Extract document data using Vision | https://developer.apple.com/videos/play/wwdc2021/10041/ |
| S8 | Apple docs: VNDetectDocumentSegmentationRequest (iOS 15+) | https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest |
| S9 | Apple docs: DetectDocumentSegmentationRequest (Swift API, iOS 18+) | https://developer.apple.com/documentation/vision/detectdocumentsegmentationrequest |
| S10 | Apple docs: RecognizeDocumentsRequest (iOS 26+) | https://developer.apple.com/documentation/vision/recognizedocumentsrequest |
| S11 | WWDC25 272: Read documents using the Vision framework | https://developer.apple.com/videos/play/wwdc2025/272/ |
| S12 | Apple docs: DetectLensSmudgeRequest (iOS 26+, A14 or later) | https://developer.apple.com/documentation/vision/detectlenssmudgerequest |
| S13 | Apple docs: VNTrackRectangleRequest | https://developer.apple.com/documentation/vision/vntrackrectanglerequest |
| S14 | Apple docs: VNGenerateImageFeaturePrintRequest | https://developer.apple.com/documentation/vision/vngenerateimagefeatureprintrequest |
| S15 | Apple docs: VNRecognizeTextRequest | https://developer.apple.com/documentation/vision/vnrecognizetextrequest |
| S16 | Apple docs: DataScannerViewController (iOS 16+) | https://developer.apple.com/documentation/visionkit/datascannerviewcontroller |
| S17 | Apple docs: AVCapturePhotoOutput.maxPhotoQualityPrioritization | https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/maxphotoqualityprioritization |
| S18 | Apple docs: AVCapturePhotoOutput.maxPhotoDimensions (iOS 16+) | https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/maxphotodimensions |
| S19 | Apple docs: AVCapturePhotoOutput.isHighResolutionCaptureEnabled (deprecated, iOS 10 to 16) | https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/ishighresolutioncaptureenabled |
| S20 | Apple docs: CIFilter.documentEnhancer() (CIDocumentEnhancer) | https://developer.apple.com/documentation/coreimage/cifilter-swift.class/documentenhancer() |
| S21 | Apple docs: CGTextDrawingMode.invisible | https://developer.apple.com/documentation/coregraphics/cgtextdrawingmode/invisible |
| S22 | WeScan repo (archived, MIT) | https://github.com/WeTransferArchive/WeScan |
| S23 | WeScan source: RectangleFeaturesFunnel.swift, CaptureSessionManager.swift, VisionRectangleDetector.swift, ZoomGestureController.swift (read via GitHub API 2026-10-13) | https://github.com/WeTransferArchive/WeScan/tree/master/Sources/WeScan |
| S24 | Scanbot Document Scanner SDK product page | https://scanbot.io/document-scanner-sdk/ |
| S25 | Scanbot docs: pricing and licensing model | https://docs.scanbot.io/faq/pricing-and-licensing-model/ |
| S26 | Genius Scan SDK home page | https://geniusscansdk.com |
| S27 | Genius Scan SDK licensing | https://geniusscansdk.com/license/licensing/ |
| S28 | Dynamsoft Mobile Document Scanner pricing (ask for quote) | https://www.dynamsoft.com/mobile-document-scanner/ask-for-quote/ |
| S29 | Nutrient (PSPDFKit) guide: scan to searchable PDF on iOS | https://www.nutrient.io/guides/ios/conversion/scan-to-searchable-pdf |
| S30 | Google Drive API: manage file metadata (indexable text) | https://developers.google.com/workspace/drive/api/guides/file |
| S31 | Google Drive API: upload file data (OCR, contentHints) | https://developers.google.com/workspace/drive/api/guides/manage-uploads |
| S32 | Apple Developer: supported capabilities (iOS), membership tiers | https://developer.apple.com/help/account/reference/supported-capabilities-ios |
| S33 | Gigazine: SideStore sideloading on iOS (Jun 2026) | https://gigazine.net/gsc_news/en/20260628-sidestore-sideloading-ios/ |
| S34 | mybyways: limits on free Apple developer accounts (10 App IDs) | https://mybyways.com/blog/new-limitations-imposed-on-free-apple-developer-account |
| S35 | Apple Support 108963: scan documents on iPhone (Notes and Files) | https://support.apple.com/en-us/108963 |
| S36 | Apple Support Community 255972759: no way to default auto-shutter off | https://discussions.apple.com/thread/255972759 |
| S37 | Apple Support Community 253718020: Notes PDF export loses OCR text | https://discussions.apple.com/thread/253718020 |
| S38 | Daniel Saidi: detecting text in images with the Vision framework (Jan 2026) | https://danielsaidi.com/blog/2026/01/10/detecting-text-in-images-with-the-vision-framework |

## 1. VisionKit's VNDocumentCameraViewController

**What you get.** A system view controller that presents Apple's own camera pass-through for scanning paper page by page; the result is images by page number, which your app can turn into a PDF [S1]. Available iOS 13+ [S1]. On devices with a Neural Engine it already uses the ML document segmentation detector rather than the older rectangle detector [S7], so its edge finding is as good as the custom pipeline's starting point.

**API surface (the whole thing).** `delegate`, `isSupported` [S1], and a delegate that receives a `VNDocumentCameraScan` with `title`, `pageCount`, and `imageOfPage(at:) -> UIImage` [S2]. That is it.

**What you cannot customize.** None of these are exposed in the class reference [S1, S2], and the Scanbot comparison confirms there are "very few customization options out of the box," not even button colors [S3]:
- Shutter default: no property for auto versus manual. Apple's users ask for exactly this and can't get it [S36]. Paper Trail's "remembered default" is impossible here.
- UI: fixed. No overlay, no custom buttons, no "send to deck" step inside the flow.
- Stack mode: no. There's a built-in limit of **24 scans per session** and no way to change it [S3].
- Per-page metadata: none. No corner points, no confidence, no raw frame, no capture time [S2].
- Image resolution and format: no setting; you get a `UIImage` [S2]. Actual pixel dimensions: **unknown** (not documented; measure on device). Whether the image is pre-filter or post-filter: **unknown**; it appears to be whatever filter the user picked in the scanner UI [S35].
- Output: UIImage only, no PDF [S3].

**Known limits and bugs.** iOS 26 / iPadOS 26 UI bugs, including the Cancel button not appearing on iPad [S3]. Fixes ship only with iOS updates [S3].

**Simulator.** The Simulator has no camera [S5]. With RocketSim streaming the Mac camera into the Simulator, one developer reports `VNDocumentCameraViewController` works (while `DataScannerViewController` fails with `ScanningUnavailable`) [S4, S6]. Whether `isSupported` returns true in a stock Simulator: **unknown**. Plan to test on the iPhone.

**SideStore and a free Apple ID.** Camera access is an Info.plist usage string (`NSCameraUsageDescription`) plus the user's consent [S16], not a provisioning capability; camera doesn't appear in Apple's capability table [S32]. So no entitlement problem is expected for VisionKit, AVFoundation or Vision. The real free-account limits are SideStore's: three active apps including SideStore itself, seven-day re-signing, and a cap of about 10 App IDs per week [S33, S34]. The App ID reset window is reported as both 7 and 4 days by different sources: **unknown** which applies now [S33, S34]. Free accounts reportedly lack some entitlements (for example push notifications) [S33]; none of them are needed for capture.

## 2. A custom pipeline

**Building blocks, all on device:**

| Job | API | Notes |
|---|---|---|
| Camera preview and frames | `AVCaptureSession` + `AVCaptureVideoDataOutput` | Standard |
| Live page edges | `VNDetectDocumentSegmentationRequest` (iOS 15+) or `DetectDocumentSegmentationRequest` (Swift, iOS 18+) [S8, S9] | ML model trained on paper, receipts, notes and labels; returns four corners plus a segmentation mask; runs in real time on Neural Engine devices [S7]. Better than `VNDetectRectanglesRequest`, which is CPU-only, struggles with obscured corners and folds, and returns many nested rectangles you must choose between [S7] |
| Smooth overlay between detections | `VNTrackRectangleRequest` [S13] | Tracks a found quad across frames |
| High-resolution still | `AVCapturePhotoOutput` with `maxPhotoDimensions` (iOS 16+) and `maxPhotoQualityPrioritization = .quality` [S17, S18] | Default is `.balanced`; `.quality` trades shot-to-shot time for noise reduction and low-light detail; set both before `startRunning()` or the session rebuilds [S17, S18] |
| Flatten | `CIPerspectiveCorrection` with the four corners scaled to image size [S7] | Apple's WWDC sample shows the exact code [S7] |
| Clean up (shadows, white background, contrast) | `CIDocumentEnhancer` / `CIFilter.documentEnhancer()` (iOS 13+) [S20] | Removes unwanted shadows while whitening the background [S20]; chain grayscale or B/W thresholding for Apple's other filter options |
| Smudged lens warning | `DetectLensSmudgeRequest` (iOS 26+, A14 or later) [S12] | Returns 0 to 1; Apple's sample uses 0.9; motion blur can false-positive, so run it on a steady frame [S12] |
| Text with positions | `VNRecognizeTextRequest` (iOS 13+) [S15] | Returns observations with bounding boxes; needed for the PDF text layer (section 4) |
| Structured reading | `RecognizeDocumentsRequest` (iOS 26+) [S10] | Paragraphs, tables, lists, barcodes, and detected data such as dates, money amounts, phone numbers, tracking and payment IDs; 26 languages [S11, S38] |
| Live text and codes in the viewfinder | `DataScannerViewController` (iOS 16+) [S16] | Not a document scanner; useful only if we want live QR or text highlighting. Has `capturePhoto()` and an overlay view [S16] |

**What matching Apple's quality takes.**
- **Live edge overlay.** Run segmentation on every Nth video frame on a background queue, draw the quad in a `CAShapeLayer`, and smooth it. WeScan's `RectangleFeaturesFunnel` is a good model: it keeps the last 8 detections, needs at least 3, and only shows a quad that matches its neighbors within a pixel threshold [S23].
- **Steadiness-based auto-capture.** Fire only after the quad has held still across a run of frames. WeScan does this with an auto-scan pass count inside the funnel and resets it when no rectangle is seen for 3 frames [S23]. We can be stricter than Apple (whose auto "jumps the gun" [S36]) by also requiring low device motion and a minimum page area. Tuning thresholds needs the real phone.
- **High-resolution still with quality prioritization.** Use the still, not the video frame, for the saved page; re-run segmentation on the still to refine corners [S7, S17, S18]. WeScan still uses the deprecated `isHighResolutionCaptureEnabled` [S19, S23], one reason not to take it as-is.
- **Glare and shadows.** Shadows: `CIDocumentEnhancer` [S20]. Glare: Apple has no glare-detection API that we found (**unknown** whether one exists). A practical approach is to measure blown-out highlight area inside the quad and ask the user to tilt, or keep flash off by default. Multi-frame glare removal (as some commercial SDKs advertise) is a research-grade job: **unknown** effort, not in scope.
- **Magnifier on corner drag.** Not a framework feature; it's a loupe view that renders the zoomed image region under the finger. WeScan ships one (`ZoomGestureController` in its Edit folder) [S23].
- **Capture speed.** Apple's speed is the bar; the `.quality` setting adds shot-to-shot time [S17]. In stack mode we can drop to `.balanced` per photo (allowed, since settings can go lower than the output's max) [S17].

## 3. Benchmarks

| Option | Beyond Apple's scanner | License and cost for Bryce |
|---|---|---|
| **WeScan** | Full UI control, PDF or UIImage output, a corner magnifier, open source [S3, S22, S23]. But it's single-page (no batch) [S3], uses `VNDetectRectanglesRequest` rather than document segmentation [S23], fails to compile on newer Xcode because of an `@available` stored-property pattern [S3], and uses a deprecated capture API [S19, S23] | MIT, free [S22]. **Not maintained:** the repo moved to `WeTransferArchive` and is archived; last release 3.0.0 on 2023-09-13, last commit 2024-12-11 (a CODEOWNERS change); 12 forks, none with traction (checked via GitHub API, 2026-10-13) [S22] |
| **Scanbot SDK** (now Apryse) | Auto-snapping when ideally positioned, a document quality analyzer that rates scans acceptable or not and prompts a rescan, shadow removal and binarization filters, searchable PDF with an embedded text layer, customizable UI [S24] | Fixed annual fee per app, quote only, unlimited scans; 7-day trial [S25]. Real price: **unknown** |
| **Genius Scan SDK** | Border highlighting, perspective and curvature correction, cleanup filters, OCR, searchable and selectable PDF text, full UI customization; iOS 15+ [S26] | Flat annual fee per app, quote only; runs 60 seconds without a key, free 30-day trial key [S27]. Real price: **unknown** |
| **Dynamsoft** | Document normalizer SDK; iOS licensing is quote only [S28] | Published tiers are for the web product (1,299 a year for up to 50 browser clients) [S28]; iOS price **unknown** |
| **Nutrient (PSPDFKit)** | OCR that writes recognized text back into the PDF as invisible text [S29] | Commercial; price **unknown** |

What the commercial SDKs add that's worth stealing: the **quality gate** (blur, smudge, too-dark warnings before you keep a page) [S24], **curvature correction** for bent pages [S26], and **searchable PDF output** [S24, S26]. All are aimed at businesses with quote-based annual licenses [S25, S27, S28], and their license keys are tied to a bundle ID [S27], which fights with SideStore re-signing (bundle IDs can be rewritten on install: **unknown** whether that breaks their keys).

## 4. Searchable PDFs on iOS

**How.** Draw each page image into a PDF context (`UIGraphicsPDFRenderer` or `CGContext`), then draw the recognized text on top with the text drawing mode set to `.invisible`, which updates the text position without painting it [S21]. Position each line using the bounding boxes from `VNRecognizeTextRequest` [S15], scaling the font so each string spans its box. This is the same pattern Nutrient sells as a feature [S29]. PDFKit itself has no "add invisible text" call that we found (**unknown**), so Core Graphics does the work and PDFKit is only used for viewing.

**Which text.** Use **Vision OCR for the layer**, because the layer needs per-line positions and Vision gives them [S15]. Claude's reading is better at meaning but doesn't come back with coordinates in Paper Trail's current flow, so it isn't suited to a positioned layer. Claude's output (sender, summary, fields) belongs in the app's own search index (#22) and in the Drive filename and description.

**This fixes Apple's two OCR complaints.** Notes' exported PDF loses its text [S37], and Files scans get no OCR at all (recon source 16). Our PDF carries the text inside the file, so it survives export and any viewer can search it.

**How Google Drive indexes it.** Drive automatically indexes recognized file types for search, "including text documents, PDFs, images with text" [S30]. A PDF with a real text layer is plain text to Drive. For files Drive doesn't understand, apps can supply up to 128 KB of HTML in `contentHints.indexableText` [S30, S31]. Whether `indexableText` adds to or is ignored for PDFs: **unknown** (the docs only describe it for other file types [S30]). Cheap to test: upload one PDF with a made-up word only in `indexableText` and search for it.

## 5. Stack mode feasibility (#19)

**Capture loop (on device, feasible).** Stay in a continuous auto-capture loop with no page cap (VisionKit's 24-scan cap rules it out [S3]). A new page is accepted when:
1. a document quad is present and steady (section 2) [S7, S23],
2. the scene changed since the last kept page: compare a `VNGenerateImageFeaturePrintRequest` feature print of the new frame against the last capture and require a minimum distance [S14], which stops duplicate captures of the same sheet, and
3. ideally there was a "page swap" moment in between (quad lost or motion spike) to rearm the shutter.

Haptic plus a count bump confirms each page so Bryce can keep feeding without looking.

**Splitting into documents.** Two layers:
- **On device (fast hints):** `RecognizeDocumentsRequest` on iOS 26 can find "Page 1 of 3" text, barcodes, dates and money amounts per page [S10, S11]; a blank-page or separator-sheet check is cheap. These give suggested breaks that show live during the scan.
- **Claude (the real split):** Claude already reads every page; it can say which pages share a sender, account number and statement date, and where a new document starts. This is better than any on-device heuristic for mixed mail, and it's how Adobe's paid High-Speed Scan is described in the shortlist (overhaul-shortlist.md, item 4). The deck then shows one card per document with a "split here / merge" fix.

Verdict: feasible. The capture loop is the risky part (false triggers, duplicates) and must be tuned on the phone with a real pile.

## 6. Recommendation

**Hybrid, custom-first.**

1. **Stopgap (1 to 2 days):** wire `VNDocumentCameraViewController` into the native app so the outbox, PDF builder with Vision text layer, Drive upload and deck can be built and tested now. Accept its limits (auto default, 24 pages).
2. **Custom scanner at parity (about 2 to 3 weeks of part-time sessions):** AVFoundation capture, live segmentation overlay with funnel smoothing, steadiness auto-capture with a remembered auto/manual default, `.quality` high-res stills, perspective correction, `CIDocumentEnhancer` and B/W filters, corner editor with magnifier, page review (reorder, rotate, delete, retake), smudge and blur warnings, and "Done" goes straight into the deck.
3. **Beyond Apple (about 1 to 1.5 weeks more):** stack mode with feature-print duplicate guard and Claude splitting (#19); ID card front and back composited on one PDF page (#28), using the same quad detection with an ID-card aspect ratio check.
4. **WeScan:** read it, copy patterns (funnel, magnifier, corner view) with MIT attribution, but don't depend on it [S22, S23].
5. **Commercial SDKs:** skip [S25, S27, S28].

Minimum iOS: target iOS 18 for the Swift Vision API [S9], and light up `RecognizeDocumentsRequest` and smudge detection when the phone runs iOS 26 [S10, S12]. Which iOS and iPhone model Bryce has: **unknown**; smudge detection needs A14 or later [S12].

**Simulator versus iPhone.**

| Can test in the Simulator | Needs Bryce's iPhone |
|---|---|
| PDF builder and invisible text layer, Vision OCR on saved photos, perspective correction and filters on saved photos, corner editor and magnifier, page review, deck handoff, outbox and Drive upload, stack-split logic fed from a folder of saved frames | Anything with the camera (the Simulator has none [S5]); auto-capture timing and steadiness thresholds; overlay frame rate; glare and lighting; VisionKit itself (`isSupported` in the Simulator is unknown); smudge detection (A14+ [S12]); SideStore install and 7-day refresh [S33] |

Design tip: put the capture pipeline behind a "frame source" protocol so the Simulator can play back recorded iPhone video through the same detection code. RocketSim can also stream the Mac camera into the Simulator [S6].

## Comparison

| | Apple Notes / Files | VisionKit | Custom | WeScan | Commercial SDK |
|---|---|---|---|---|---|
| Live edge detection | Yes [S35] | Yes, ML segmentation [S7] | Yes, same ML model [S7, S9] | Yes, older rectangle detector [S23] | Yes [S24, S26] |
| Auto shutter | Yes, default on [S35] | Yes, not configurable [S1] | Yes, tunable | Yes [S23] | Yes (Scanbot) [S24] |
| Remembered manual/auto default | No [S36] | No [S1] | **Yes** | Possible with forking | Likely, **unknown** |
| Stack mode, no page cap | Unknown cap | No, 24 per session [S3] | **Yes** | No, single page [S3] | Unknown |
| Resolution and quality control | No | No [S2] | **Yes** [S17, S18] | Deprecated API [S19] | Unknown |
| Searchable PDF kept on export | No [S37] | No, images only [S3] | **Yes** [S15, S21] | No | Yes [S24, S26] |
| Straight into the deck | No | Partly (after it closes) | **Yes** | Yes | Yes |
| UI customization | None | None [S3] | Full | Full [S3] | High [S24, S26] |
| Maintained | Apple | Apple, fixes with iOS [S3] | Us | Archived [S22] | Vendor |
| Cost | Free | Free | Our time | Free, MIT [S22] | Annual quote [S25, S27] |
