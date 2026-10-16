// The whole pipeline in one pass, with only the network stood in: scan review, reading, the deck's
// swipe and undo hold, the live outbox engine (upload, Firestore record, checksum verification),
// then Piles, Search and Paperless reading what the outbox wrote. Classify, Drive and the upload
// transport are the test doubles; everything between them is the app's real code.
import Foundation
import SwiftData
import Testing
@testable import PaperTrail

@MainActor
@Suite struct FullFlowTests {
    @Test func scanToDeckToDriveToPilesSearchAndPaperless() async throws {
        let files = FileStore.temporary()
        let container = PipelineStore.container(inMemory: true)
        let docs = FakeDocStore(seed: [], rules: [])
        let auth = FakeAuthService()
        let drive = StubDrive()
        let classify = FakeClassifyService()
        classify.delay = .milliseconds(10)
        let outbox = LiveOutboxService(auth: auth, drive: drive, docs: docs, files: files,
                                       container: container, transport: FakeTransport())
        let env = AppEnvironment(auth: auth, classify: classify, drive: drive, docs: docs,
                                 capture: FakeCaptureService(files: files), outbox: outbox,
                                 files: files, modelContainer: container, isSample: false)

        // 1. Scan: one page through the review screen, read while it's open, then sent.
        let page = try ReviewStore.addImagePage(SampleScanSource.drawPage(SampleData.pageTexts[0]),
                                                session: UUID(), files: files)
        let session = ReviewSession(id: UUID(), kind: .scan, pages: [page], groups: [ReviewGroup(pageIDs: [page.id])])
        let review = ScanReviewViewModel(session: session, env: env)
        review.start()
        await review.waitUntilIdle()
        #expect(review.header(review.groups[0]).isRead)
        review.send()

        // 2. The deck: the card is there, read with its text.
        let deck = DeckViewModel(env: env)
        await deck.load()
        let card = try #require(deck.top)
        #expect(card.stage == .ready)
        #expect(card.card?.issuer == "Duke Energy")
        #expect(card.ocrText?.contains("Duke Energy") == true)

        // 3. File it, undo inside the hold (nothing to reverse), file again, release the hold.
        if deck.file(card) == .needsCheck {
            let checked = await CheckFieldsModel(item: card, docs: docs).confirm()
            #expect(deck.fileChecked(checked) == .decided)
        }
        #expect(deck.top == nil || deck.top?.id != card.id)
        #expect(await deck.undo() == .file)
        #expect(deck.top?.id == card.id)
        #expect(card.decision == nil)
        #expect(deck.file(card) == .decided)
        drive.defaultMD5 = try await LiveOutboxService.md5Hex(of: files.url(for: card.fileName))
        deck.releaseHeld()

        // 4. The outbox uploads, writes the record and verifies Drive's checksum.
        for _ in 0..<200 where card.stage != .verified { try await Task.sleep(for: .milliseconds(25)) }
        #expect(card.stage == .verified)
        #expect(card.verifiedAt != nil)
        let record = try #require(await firstList(docs.docs()).first)
        #expect(record.issuer == "Duke Energy")
        #expect(record.verifiedAt != nil)
        #expect(record.source == "ios")

        // 5. Piles, Search and Paperless read what the outbox wrote.
        let piles = PilesViewModel(docs: docs)
        let watching = Task { await piles.watch() }
        for _ in 0..<100 where !piles.loaded { try await Task.sleep(for: .milliseconds(10)) }
        #expect(piles.all.contains { $0.id == record.id })
        if record.physical == .toShred {
            #expect(piles.shredPile.contains { $0.id == record.id })
        }
        watching.cancel()

        let search = SearchViewModel(docs: docs, drive: drive, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let searching = Task { await search.watch() }
        for _ in 0..<100 where !search.loaded { try await Task.sleep(for: .milliseconds(10)) }
        search.query = "duke"
        await search.runSearch()
        #expect(search.hits.contains { $0.doc.id == record.id })
        searching.cancel()

        if record.paperless.possible {
            let paperless = PaperlessViewModel(docs: docs)
            let watchingSenders = Task { await paperless.watch() }
            for _ in 0..<100 where !paperless.loaded { try await Task.sleep(for: .milliseconds(10)) }
            #expect(paperless.senders.contains { $0.issuer == "Duke Energy" })
            watchingSenders.cancel()
        }
    }

    private func firstList<T>(_ stream: AsyncStream<[T]>) async -> [T] {
        for await list in stream { return list }
        return []
    }
}
