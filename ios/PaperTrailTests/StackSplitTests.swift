// Stack mode (#19): "Split into documents" after a multi-page scan or import. The split request
// (page texts and thumbnails), the answer turned back into groups, the review applying it with
// labels, and the person's edits and Send winning over a proposal still in flight. The function's
// side is functions/test/split.test.mjs.
import Foundation
import SwiftData
import Testing
@testable import PaperTrail

@MainActor
struct StackSplitTests {
    // MARK: - Contract

    @Test func theSplitRequestEncodesAsTheFunctionReadsIt() throws {
        let request = SplitRequest(pages: [SplitPage(text: "Duke Energy", image: ClassifyImage(type: "image/jpeg", data: "AAAA")),
                                           SplitPage(text: "Page 2", image: nil)])
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        #expect(json["mode"] as? String == "split")
        let pages = try #require(json["pages"] as? [[String: Any]])
        #expect(pages.count == 2)
        #expect(pages[0]["text"] as? String == "Duke Energy")
        #expect((pages[0]["image"] as? [String: Any])?["type"] as? String == "image/jpeg")
        #expect(pages[1]["image"] == nil)
        // No `kind`: an old function refuses it as bad_request rather than reading it as a card.
        #expect(json["kind"] == nil)
    }

    @Test func theFunctionsSplitReplyDecodes() throws {
        let json = #"{"split":{"documents":[{"start":0,"end":1,"label":"Duke Energy bill"},{"start":2,"end":2,"label":"Flyer"}]},"model":"claude-opus-5-5"}"#
        let reply = try JSONDecoder().decode(SplitResponse.self, from: Data(json.utf8))
        #expect(reply.split.documents == [SplitDocument(start: 0, end: 1, label: "Duke Energy bill"),
                                          SplitDocument(start: 2, end: 2, label: "Flyer")])
    }

    // MARK: - SplitPayload

    @Test func answersMustCoverEveryPageOnceInOrder() {
        let doc = { (s: Int, e: Int) in SplitDocument(start: s, end: e, label: "L\(s)") }
        #expect(SplitPayload.groups(from: [doc(0, 1), doc(2, 2), doc(3, 4)], pageCount: 5)?.map(\.pages)
            == [[0, 1], [2], [3, 4]])
        #expect(SplitPayload.groups(from: [doc(0, 1), doc(3, 4)], pageCount: 5) == nil)     // gap
        #expect(SplitPayload.groups(from: [doc(0, 2), doc(2, 4)], pageCount: 5) == nil)     // overlap
        #expect(SplitPayload.groups(from: [doc(0, 1)], pageCount: 5) == nil)                // short
        #expect(SplitPayload.groups(from: [doc(0, 5)], pageCount: 5) == nil)                // past the end
        #expect(SplitPayload.groups(from: [doc(1, 0)], pageCount: 2) == nil)                // backwards
        #expect(SplitPayload.groups(from: [], pageCount: 2) == nil)
    }

    @Test func theRequestCapsTextAndDropsPicturesPastTheImageLimit() {
        let long = String(repeating: "x", count: SplitPayload.maxPageChars + 10)
        let small = SplitPayload.request(texts: ["  Duke Energy \n", long], thumbnails: [Data([1, 2, 3]), nil])
        #expect(small.pages[0].text == "Duke Energy")
        #expect(small.pages[0].image == ClassifyImage(type: "image/jpeg", data: Data([1, 2, 3]).base64EncodedString()))
        #expect(small.pages[1].text.count == SplitPayload.maxPageChars)
        #expect(small.pages[1].image == nil)

        let count = SplitPayload.maxImages + 1
        let big = SplitPayload.request(texts: Array(repeating: "p", count: count),
                                       thumbnails: Array(repeating: Data([1]), count: count))
        #expect(big.pages.count == count)
        #expect(big.pages.allSatisfy { $0.image == nil })
    }

    @Test func theFakeSplitsThePileByLetterhead() {
        let documents = FakeClassifyService.split(SampleData.stackPageTexts)
        #expect(documents.map { [$0.start, $0.end] } == [[0, 1], [2, 3], [4, 4], [5, 5]])
        #expect(documents.map(\.label) == SampleData.cards.map(\.title))
    }

    // MARK: - The review

    @Test func aMultiPageScanOrImportOffersTheSplitAndASinglePageDoesNot() throws {
        let env = environment()
        #expect(try review(env: env, texts: [SampleData.pageTexts[0]]).offersSplit == false)
        let scan = try review(env: env, texts: SampleData.stackPageTexts)
        #expect(scan.offersSplit)
        #expect(scan.splitTitle == "Split into documents")
        #expect(scan.splitDetail == "Claude finds where each document starts. You can change any split after.")

        let id = UUID()
        let pages = try ReviewStore.addPDF(FakeCaptureService.pdf(fromTexts: ["One", "Two"]), session: id,
                                           files: env.files, sourceName: "pile.pdf")
        let session = ReviewSession(id: id, kind: .files, pages: pages, groups: [ReviewGroup(pageIDs: pages.map(\.id))])
        #expect(ScanReviewViewModel(session: session, env: env).offersSplit)
    }

    @Test func splittingAppliesClaudesProposalWithLabels() async throws {
        let env = environment()
        let recorder = Recorder()
        let model = try review(env: env, texts: SampleData.stackPageTexts) { request in
            recorder.requests.append(request)
            return FakeClassifyService.split(SampleData.stackPageTexts)
        }
        model.start()
        model.splitIntoDocuments()
        #expect(model.splitState == .splitting)
        #expect(model.splitDetail == "Finding where each document starts")
        #expect(!model.offersSplit)
        await model.waitUntilIdle()

        #expect(model.groups.map(\.pageIDs.count) == [2, 2, 1, 1])
        #expect(model.groups.map(\.label) == SampleData.cards.map(\.title))
        #expect(model.title == "6 pages, 4 documents")
        #expect(model.splitState == .done(documents: 4))
        #expect(model.splitDetail == "Claude found 4 documents. Fix any split with the scissors or Join.")
        #expect(!model.offersSplit)

        // One request with every page's text and a thumbnail each.
        let request = try #require(recorder.requests.first)
        #expect(recorder.requests.count == 1)
        #expect(request.pages.count == 6)
        #expect(request.pages.allSatisfy { $0.image?.type == "image/jpeg" })
        model.discard()
    }

    @Test func aLabelShowsWhileTheDocumentIsStillReading() throws {
        let env = environment()
        let model = try review(env: env, texts: [SampleData.pageTexts[0]])
        var group = model.groups[0]
        group.label = "Duke Energy bill"
        #expect(model.header(group).text == "Duke Energy bill")
        #expect(!model.header(group).isRead)
        group.label = nil
        #expect(model.header(group).text == "Reading page 1")
    }

    @Test func oneDocumentKeepsItsReadAndGetsTheLabel() async throws {
        let env = environment()
        let model = try review(env: env, texts: Array(SampleData.stackPageTexts.prefix(2))) { _ in
            [SplitDocument(start: 0, end: 1, label: "Duke Energy bill")]
        }
        model.start()
        let id = model.groups[0].id
        model.splitIntoDocuments()
        await model.waitUntilIdle()
        #expect(model.groups.map(\.id) == [id])
        #expect(model.groups[0].label == "Duke Energy bill")
        #expect(model.splitDetail == "Claude thinks this is one document. Split it with the scissors if not.")
        model.discard()
    }

    @Test func aFailedSplitLeavesThePagesAndOffersTryAgain() async throws {
        let env = environment()
        let attempts = Recorder()
        let model = try review(env: env, texts: SampleData.stackPageTexts) { request in
            attempts.requests.append(request)
            if attempts.requests.count == 1 { throw ClassifyFailure(code: .badRequest, message: "old function") }
            return FakeClassifyService.split(SampleData.stackPageTexts)
        }
        model.start()
        model.splitIntoDocuments()
        await model.waitUntilIdle()
        #expect(model.groups.map(\.pageIDs.count) == [6])
        #expect(model.splitState == .failed)
        #expect(model.splitDetail == "Claude couldn't split this stack. Split it with the scissors, or try again.")
        #expect(model.offersSplit)

        model.splitIntoDocuments()
        await model.waitUntilIdle()
        #expect(model.groups.map(\.pageIDs.count) == [2, 2, 1, 1])
        model.discard()
    }

    @Test func anAnswerThatDoesNotFitIsAFailedSplit() async throws {
        let env = environment()
        let model = try review(env: env, texts: Array(SampleData.stackPageTexts.prefix(3))) { _ in
            [SplitDocument(start: 0, end: 0, label: "A"), SplitDocument(start: 2, end: 2, label: "B")]
        }
        model.start()
        model.splitIntoDocuments()
        await model.waitUntilIdle()
        #expect(model.groups.map(\.pageIDs.count) == [3])
        #expect(model.splitState == .failed)
        model.discard()
    }

    @Test func anEditWhileClaudeSplitsWins() async throws {
        let env = environment()
        let model = try review(env: env, texts: Array(SampleData.stackPageTexts.prefix(3))) { _ in
            try? await Task.sleep(for: .milliseconds(300))
            return [SplitDocument(start: 0, end: 0, label: "A"), SplitDocument(start: 1, end: 1, label: "B"),
                    SplitDocument(start: 2, end: 2, label: "C")]
        }
        model.start()
        model.splitIntoDocuments()
        model.split(model.groups[0].id, after: 1)
        await model.waitUntilIdle()
        #expect(model.groups.map(\.pageIDs.count) == [2, 1])
        #expect(model.groups.allSatisfy { $0.label == nil })
        model.discard()
    }

    @Test func sendingWhileClaudeSplitsKeepsOneDocument() async throws {
        let env = environment()
        let model = try review(env: env, texts: Array(SampleData.stackPageTexts.prefix(2))) { _ in
            try? await Task.sleep(for: .milliseconds(200))
            return [SplitDocument(start: 0, end: 0, label: "A"), SplitDocument(start: 1, end: 1, label: "B")]
        }
        model.start()
        model.splitIntoDocuments()
        model.send()
        await model.waitUntilIdle()
        let items = try env.modelContainer.mainContext.fetch(FetchDescriptor<PipelineItem>())
        #expect(items.map(\.pageCount) == [2])
    }

    @Test func splitDocumentsGoToTheDeckAsSeparateItems() async throws {
        let env = environment()
        let model = try review(env: env, texts: SampleData.stackPageTexts) { _ in
            FakeClassifyService.split(SampleData.stackPageTexts)
        }
        model.start()
        model.splitIntoDocuments()
        await model.waitUntilIdle()
        model.send()
        await model.waitUntilIdle()
        let items = try env.modelContainer.mainContext.fetch(FetchDescriptor<PipelineItem>())
        #expect(items.map(\.pageCount).sorted() == [1, 1, 2, 2])
        #expect(items.allSatisfy { $0.stage == .ready })
    }

    @Test func addingPagesOffersTheSplitAgain() async throws {
        let env = environment()
        let model = try review(env: env, texts: Array(SampleData.stackPageTexts.prefix(2))) { _ in
            [SplitDocument(start: 0, end: 1, label: "Duke Energy bill")]
        }
        model.start()
        model.splitIntoDocuments()
        await model.waitUntilIdle()
        #expect(!model.offersSplit)
        let more = try SampleData.pageTexts.suffix(2).map {
            try ReviewStore.addImagePage(SampleScanSource.drawPage($0), session: model.session.id, files: env.files)
        }
        model.add(more, placement: .appendToLast)
        #expect(model.splitState == .idle)
        #expect(model.offersSplit)
        model.discard()
    }

    @Test func theSampleServiceSplitsTheSampleStack() async throws {
        // The default proposer is env.classify, the fake in sample mode and the simulator.
        let env = environment()
        let model = try review(env: env, texts: SampleData.stackPageTexts, proposer: nil)
        model.start()
        model.splitIntoDocuments()
        await model.waitUntilIdle()
        let fake = try #require(env.classify as? FakeClassifyService)
        #expect(fake.splitRequests.count == 1)
        #expect(fake.splitRequests[0].pages.count == 6)
        #expect(model.splitState != .splitting)
        model.discard()
    }

    // MARK: - Helpers

    final class Recorder {
        var requests: [SplitRequest] = []
    }

    private func environment() -> AppEnvironment {
        let base = AppEnvironment.sample()
        let classify = FakeClassifyService()
        classify.delay = .milliseconds(10)
        return AppEnvironment(auth: base.auth, classify: classify, drive: base.drive, docs: FakeDocStore(seed: []),
                              capture: base.capture, outbox: base.outbox, files: base.files,
                              modelContainer: base.modelContainer, isSample: true)
    }

    private func review(env: AppEnvironment, texts: [String],
                        proposer: ScanReviewViewModel.SplitProposer? = nil) throws -> ScanReviewViewModel {
        let id = UUID()
        let pages = try texts.map { try ReviewStore.addImagePage(SampleScanSource.drawPage($0), session: id, files: env.files) }
        let session = ReviewSession(id: id, kind: .scan, pages: pages, groups: [ReviewGroup(pageIDs: pages.map(\.id))])
        return ScanReviewViewModel(session: session, env: env, proposeSplit: proposer)
    }
}
