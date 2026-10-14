// The sample flow end to end against the fakes: capture seam, read, swipe, outbox.
import Foundation
import Testing
@testable import PaperTrail

@MainActor
struct DeckFlowTests {
    @Test func sampleDeckReadsEverySample() async {
        let env = AppEnvironment.sample()
        let deck = DeckViewModel(env: env)
        await deck.loadSample()
        #expect(deck.cards.count == SampleData.pageTexts.count)
        #expect(deck.cards.allSatisfy { $0.card != nil })
    }

    @Test func fileAndShredLeaveTheDeck() async throws {
        let env = AppEnvironment.sample()
        let deck = DeckViewModel(env: env)
        await deck.loadSample()
        let first = try #require(deck.cards.first)
        #expect(deck.file(first) == .decided)
        await deck.flush()
        #expect(first.stage == .verified)
        let second = try #require(deck.cards.first { $0.card?.verdict != .keepOriginal && deck.unsureFields($0).isEmpty })
        #expect(deck.shred(second) == .decided)
        await deck.flush()
        #expect(second.stage == .filed)
        #expect(second.driveFileID == nil)
        #expect(deck.cards.count == SampleData.pageTexts.count - 2)
    }

    @Test func classifyFailureMarksTheItemFailed() async throws {
        let env = AppEnvironment.sample()
        (env.classify as? FakeClassifyService)?.failure = .overloaded
        let docs = try await env.capture.sampleDocuments()
        let items = CaptureIntake.add(docs, to: env.modelContainer.mainContext)
        await ReadingQueue(classify: env.classify, files: env.files).read(items)
        #expect(items.allSatisfy { $0.stage == .failed && $0.failedStageRaw == PipelineStage.reading.rawValue })
    }
}
