// Capture: PDF assembly and the text layer (#22), imported bytes kept, hashing and the duplicate
// check (#2), and the review's split, join, skip and send (#19).
import CoreGraphics
import Foundation
import PDFKit
import SwiftData
import Testing
@testable import PaperTrail

@MainActor
struct CaptureTests {
    // MARK: - PDF and text layer

    @Test func textLayerMakesAScannedPageSearchable() throws {
        let page = try SampleScanSource.drawPage(SampleData.pageTexts[0])
        let lines = [
            OCRLine(text: "Duke Energy", x: 0.08, y: 0.85, width: 0.4, height: 0.04),
            OCRLine(text: "Amount due $142.17", x: 0.08, y: 0.6, width: 0.5, height: 0.03),
        ]
        let pdf = try PageAssembler.pdf([.image(jpeg: page, lines: lines)])
        let doc = try #require(PDFDocument(data: pdf))
        #expect(doc.pageCount == 1)
        let text = doc.string ?? ""
        #expect(text.contains("Duke Energy"))
        #expect(text.contains("142.17"))
        // The page keeps the photo's aspect at 8.5 inches wide.
        let box = try #require(doc.page(at: 0)?.bounds(for: .mediaBox))
        #expect(box.width == 612)
        #expect(abs(box.height - 792) < 1)
    }

    @Test func textLayerLinesSitInsideTheirBoxes() throws {
        let page = try SampleScanSource.drawPage("Box test")
        let line = OCRLine(text: "Statement", x: 0.25, y: 0.5, width: 0.5, height: 0.05)
        let pdf = try PageAssembler.pdf([.image(jpeg: page, lines: [line])])
        let pdfPage = try #require(PDFDocument(data: pdf)?.page(at: 0))
        let selection = try #require(pdfPage.selection(for: NSRange(location: 0, length: 9)))
        let bounds = selection.bounds(for: pdfPage)
        let expected = CGRect(x: 0.25 * 612, y: 0.5 * 792, width: 0.5 * 612, height: 0.05 * 792)
        #expect(abs(bounds.midX - expected.midX) < 20)
        #expect(abs(bounds.midY - expected.midY) < 20)
    }

    @Test func scanPagesAreCappedAtGoodQuality() throws {
        // A 12 MP camera frame comes out at 1700 px on the short side, upright.
        let big = try image(width: 3024, height: 4032)
        let jpeg = try PageAssembler.normalizedJPEG(from: big)
        let out = try PageAssembler.uprightImage(from: jpeg, maxShortSide: 10_000)
        #expect(out.width == 1700)
        #expect(out.height == 2267)
        let turned = try PageAssembler.uprightImage(from: PageAssembler.normalizedJPEG(from: big, quarterTurns: 1),
                                                    maxShortSide: 10_000)
        #expect(turned.width == 2267)
    }

    @Test func visionReadsASamplePage() async throws {
        let page = try SampleScanSource.drawPage(SampleData.pageTexts[0])
        let text = await TextRecognizer.recognize(jpeg: page)
        #expect(text.text.localizedCaseInsensitiveContains("Duke Energy"))
        #expect(!text.lines.isEmpty)
        #expect(text.lines.allSatisfy { (0...1).contains($0.x) && (0...1).contains($0.y) })
    }

    // MARK: - Live service

    @Test func importedPDFKeepsItsBytes() async throws {
        let files = FileStore.temporary()
        let original = FakeCaptureService.pdf(fromTexts: ["Page one", "Page two"])
        let url = URL.temporaryDirectory.appending(path: "import-\(UUID().uuidString).pdf")
        try original.write(to: url)
        let docs = try await LiveCaptureService(files: files).importFiles([url])
        let doc = try #require(docs.first)
        #expect(try files.read(doc.fileName) == original)
        #expect(doc.contentHash == ContentHash.sha256Hex(original))
        #expect(doc.pageCount == 2)
        #expect(doc.origin == "files")
        #expect(doc.ocrText?.contains("Page two") == true)
        #expect(doc.thumbnailName != nil)
    }

    @Test func photosPickedTogetherBecomeOneDocument() async throws {
        let files = FileStore.temporary()
        let photos = try SampleData.pageTexts.prefix(3).map { try SampleScanSource.drawPage($0) }
        let doc = try await LiveCaptureService(files: files).importPhotos(photos)
        #expect(doc.pageCount == 3)
        #expect(PDFDocument(data: try files.read(doc.fileName))?.pageCount == 3)
        #expect(doc.origin == "photos")
    }

    @Test func unsupportedImportNamesTheFile() {
        let error = UnsupportedImport(url: URL(filePath: "/tmp/notes.zip"))
        #expect(error.message.hasPrefix("PDFs and photos work. notes.zip is a"))
        #expect(!error.message.contains("—"))
    }

    // MARK: - Hash and duplicates (#2)

    @Test func sha256MatchesTheKnownVector() {
        #expect(ContentHash.sha256Hex(Data("abc".utf8))
                == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func duplicateOfAFiledDocNamesItAndTheDate() throws {
        var filed = SampleData.filedDocs()[0]
        filed.title = "2025 W-2"
        filed.contentHash = "abc123"
        filed.filedAt = "2026-10-02T15:00:00.000Z"
        let now = try #require(DuplicateCheck.parseISO("2026-10-13T12:00:00.000Z"))
        let match = try #require(DuplicateCheck.match("abc123", in: DuplicateCheck.known(from: [filed])))
        #expect(match.message(now: now) == "Already filed on Oct 2 as 2025 W-2.")
        #expect(DuplicateCheck.match("other", in: DuplicateCheck.known(from: [filed])) == nil)
    }

    @Test func aFiledCopyOutranksOneOnThePhone() throws {
        let known = [
            KnownDocument(contentHash: "h", title: "On the deck", date: nil, kind: .onPhone),
            KnownDocument(contentHash: "h", title: "In Drive", date: nil, kind: .filed),
        ]
        #expect(DuplicateCheck.match("h", in: known)?.title == "In Drive")
        #expect(DuplicateMatch(kind: .onPhone, title: "", date: nil).message() == "Already scanned.")
    }

    @Test func reviewFlagsAPDFFiledBefore() async throws {
        let original = FakeCaptureService.pdf(fromTexts: ["Duke Energy"])
        var filed = SampleData.filedDocs()[0]
        filed.title = "Duke Energy bill, March 2024"
        filed.contentHash = ContentHash.sha256Hex(original)
        let env = environment(docs: FakeDocStore(seed: [filed]))
        let model = try importReview(env: env, pdfs: [original])
        model.start()
        await model.waitUntilIdle()
        let group = try #require(model.groups.first)
        #expect(model.state(group).duplicate?.kind == .filed)
        #expect(model.state(group).duplicate?.message().hasSuffix("as Duke Energy bill, March 2024.") == true)
        model.setSkipped(group.id, true)
        #expect(model.sendCount == 0)
        #expect(model.canSend == false)
    }

    // MARK: - Review: split, join, send (#19)

    @Test func scanStartsAsOneDocumentAndSplitsAndJoins() async throws {
        let env = environment()
        let model = try scanReview(env: env, pages: 4)
        #expect(model.title == "4 pages, 1 document")
        #expect(model.sendTitle == "Send 1 to the deck")
        let first = try #require(model.groups.first)
        model.split(first.id, after: 0)
        #expect(model.groups.map(\.pageIDs.count) == [1, 3])
        model.split(model.groups[1].id, after: 1)
        #expect(model.groups.map(\.pageIDs.count) == [1, 2, 1])
        #expect(model.title == "4 pages, 3 documents")
        model.join(model.groups[2].id)
        #expect(model.groups.map(\.pageIDs.count) == [1, 3])
        // Joining the first document has nothing above it.
        model.join(model.groups[0].id)
        #expect(model.groups.count == 2)
        #expect(model.discardTitle == "Discard 4 pages?")
        model.discard()
    }

    @Test func deletingTheLastPageOfADocumentRemovesIt() throws {
        let model = try scanReview(env: environment(), pages: 2)
        model.split(model.groups[0].id, after: 0)
        model.deletePage(model.groups[1].pageIDs[0])
        #expect(model.groups.count == 1)
        #expect(model.pageCount == 1)
        #expect(model.title == "1 page, 1 document")
        model.discard()
    }

    @Test func sentDocumentsReachTheDeckReadWithTheirText() async throws {
        let env = environment()
        let model = try scanReview(env: env, pages: 3)
        var added = 0
        model.onAdded = { added += 1 }
        model.split(model.groups[0].id, after: 0)
        model.start()
        await model.waitUntilIdle()
        #expect(model.groups.allSatisfy { model.header($0).isRead })
        #expect(model.header(model.groups[0]).text == "Utility bill · Duke Energy")
        model.send()
        let items = try env.modelContainer.mainContext.fetch(FetchDescriptor<PipelineItem>())
        #expect(items.count == 2)
        #expect(items.allSatisfy { $0.stage == .ready && $0.contentHash?.count == 64 && $0.origin == "scan" })
        #expect(items.map(\.pageCount).sorted() == [1, 2])
        // The scanned PDF carries its OCR text, in the file and on the item.
        let one = try #require(items.first { $0.pageCount == 1 })
        #expect(one.ocrText?.localizedCaseInsensitiveContains("Duke Energy") == true)
        let pdfText = PDFDocument(data: try env.files.read(one.fileName))?.string ?? ""
        #expect(pdfText.localizedCaseInsensitiveContains("Duke Energy"))
        #expect(added >= 1)
        // The review's own page files are cleaned up once everything is in.
        #expect(ReviewStore.latest(files: env.files) == nil)
    }

    /// #66: an edit before start() used to start a second read of the same group, and the first
    /// read finishing cleared the second's task, so waitUntilIdle returned while it still ran.
    @Test func startAfterAnEditReadsEachDocumentOnce() async throws {
        let env = environment()
        let fake = try #require(env.classify as? FakeClassifyService)
        let model = try scanReview(env: env, pages: 3)
        model.split(model.groups[0].id, after: 0)
        model.split(model.groups[1].id, after: 0)
        model.start()
        await model.waitUntilIdle()
        #expect(fake.requests.count == 3)
        #expect(model.groups.allSatisfy { model.header($0).isRead })
        model.discard()
    }

    @Test func sendBeforeReadingFinishesStillDeliversEverything() async throws {
        let env = environment()
        let model = try scanReview(env: env, pages: 2)
        model.start()
        model.send()
        await model.waitUntilIdle()
        let items = try env.modelContainer.mainContext.fetch(FetchDescriptor<PipelineItem>())
        #expect(items.count == 1)
        #expect(items.first?.stage == .ready)
        #expect(items.first?.pageCount == 2)
    }

    @Test func anUntouchedImportedPDFIsFiledByteForByteAndASplitOneIsNot() async throws {
        let env = environment()
        let original = FakeCaptureService.pdf(fromTexts: ["One", "Two"])
        let model = try importReview(env: env, pdfs: [original])
        #expect(model.title == "1 file, 1 document")
        #expect(model.moreTitle == "Add more")
        model.start()
        await model.waitUntilIdle()
        let whole = try #require(model.state(model.groups[0]).document)
        #expect(try env.files.read(whole.fileName) == original)

        model.split(model.groups[0].id, after: 0)
        await model.waitUntilIdle()
        let halves = model.groups.compactMap { model.state($0).document }
        #expect(halves.map(\.pageCount) == [1, 1])
        #expect(halves.allSatisfy { (try? env.files.read($0.fileName)) != original })
        // The whole file's PDF was replaced, so its bytes are gone from the store.
        #expect((try? env.files.read(whole.fileName)) == nil)
        model.discard()
    }

    @Test func aReviewLeftOpenComesBack() throws {
        let env = environment()
        let model = try scanReview(env: env, pages: 2)
        model.split(model.groups[0].id, after: 0)
        let saved = try #require(ReviewStore.latest(files: env.files))
        #expect(saved.id == model.session.id)
        #expect(saved.groups.map(\.pageIDs.count) == [1, 1])
        model.discard()
        #expect(ReviewStore.latest(files: env.files) == nil)
    }

    // Stack mode's "Split into documents" (#19) is tested in StackSplitTests.

    // MARK: - Controller: the Scan menu and the simulator seam

    @Test func scanInTheSimulatorFeedsTheSamplePagesToReview() async throws {
        let env = environment()
        let controller = CaptureController(env: env, scannerAvailable: false, cameraAccess: { true })
        #expect(controller.usesSampleScanner)
        await controller.scan()
        #expect(controller.phase == .review)
        let review = try #require(controller.review)
        #expect(review.title == "\(SampleData.pageTexts.count) pages, 1 document")
        #expect(review.moreTitle == "Scan more")
        await controller.addMore()
        #expect(review.pageCount == SampleData.pageTexts.count * 2)
        #expect(review.documentCount == 1)
        controller.discard()
        #expect(controller.phase == nil)
        #expect(ReviewStore.latest(files: env.files) == nil)
    }

    @Test func cameraOffShowsItsScreen() async {
        let controller = CaptureController(env: environment(), scannerAvailable: true, cameraAccess: { false })
        guard !controller.usesSampleScanner else { return }  // -PTScanSeam forces the seam
        await controller.scan()
        #expect(controller.phase == .cameraOff)
        controller.scannerCanceled()
        #expect(controller.phase == nil)
    }

    @Test func filesEachBecomeADocumentAndUnsupportedOnesAreNamed() async throws {
        let env = environment()
        let controller = CaptureController(env: env, scannerAvailable: false, cameraAccess: { true })
        let folder = URL.temporaryDirectory.appending(path: "imports-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let a = folder.appending(path: "a.pdf"), b = folder.appending(path: "b.pdf")
        let zip = folder.appending(path: "notes.zip")
        try FakeCaptureService.pdf(fromTexts: ["One", "Two"]).write(to: a)
        try FakeCaptureService.pdf(fromTexts: ["Three"]).write(to: b)
        try Data("PK".utf8).write(to: zip)
        controller.importFromFiles()
        #expect(controller.filesPicker == .sort)
        await controller.filesPicked([a, zip, b], host: .sort)
        let review = try #require(controller.review)
        #expect(review.title == "2 files, 2 documents")
        #expect(review.moreTitle == "Add more")
        #expect(controller.unsupportedMessage?.hasPrefix("PDFs and photos work. notes.zip is") == true)
        controller.discard()
    }

    @Test func photosPickedTogetherStartAsOneDocumentInReview() async throws {
        let env = environment()
        let controller = CaptureController(env: env, scannerAvailable: false, cameraAccess: { true })
        let photos = try SampleData.pageTexts.prefix(2).map { try SampleScanSource.drawPage($0) }
        await controller.photosPicked(photos, host: .sort)
        let review = try #require(controller.review)
        #expect(review.title == "2 photos, 1 document")
        controller.discard()
    }

    // MARK: - Helpers

    private func environment(docs: FakeDocStore = FakeDocStore(seed: [])) -> AppEnvironment {
        let base = AppEnvironment.sample()
        let classify = FakeClassifyService()
        classify.delay = .milliseconds(10)
        return AppEnvironment(auth: base.auth, classify: classify, drive: base.drive, docs: docs,
                              capture: base.capture, outbox: base.outbox, files: base.files,
                              modelContainer: base.modelContainer, isSample: true)
    }

    private func scanSession(env: AppEnvironment, pages: Int) throws -> ReviewSession {
        let id = UUID()
        let made = try (0..<pages).map { index in
            let text = SampleData.pageTexts[index % SampleData.pageTexts.count]
            return try ReviewStore.addImagePage(SampleScanSource.drawPage(text), session: id, files: env.files)
        }
        return ReviewSession(id: id, kind: .scan, pages: made, groups: [ReviewGroup(pageIDs: made.map(\.id))])
    }

    private func scanReview(env: AppEnvironment, pages: Int) throws -> ScanReviewViewModel {
        let session = try scanSession(env: env, pages: pages)
        try ReviewStore.save(session, files: env.files)
        return ScanReviewViewModel(session: session, env: env)
    }

    private func importReview(env: AppEnvironment, pdfs: [Data]) throws -> ScanReviewViewModel {
        let id = UUID()
        let groups = try pdfs.enumerated().map { index, data in
            try ReviewStore.addPDF(data, session: id, files: env.files, sourceName: "file-\(index).pdf")
        }
        let session = ReviewSession(id: id, kind: .files, pages: groups.flatMap { $0 },
                                    groups: groups.map { ReviewGroup(pageIDs: $0.map(\.id)) })
        return ScanReviewViewModel(session: session, env: env)
    }

    private func image(width: Int, height: Int) throws -> Data {
        let ctx = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                         space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                         bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return try PageAssembler.jpeg(try #require(ctx.makeImage()), quality: 0.8)
    }
}
