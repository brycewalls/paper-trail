// Owner: deck. Logic only: no SwiftUI here, so DeckScreen can be rebuilt to the design spec
// without touching this file.
import Foundation
import SwiftData

@Observable
final class DeckViewModel {
    private let env: AppEnvironment
    private let reader: ReadingQueue
    private var context: ModelContext { env.modelContainer.mainContext }

    /// Items waiting for a swipe, front of the deck first.
    private(set) var cards: [PipelineItem] = []
    private(set) var isLoading = false
    private(set) var readingCount = 0

    init(env: AppEnvironment) {
        self.env = env
        self.reader = ReadingQueue(classify: env.classify, files: env.files)
    }

    var isSample: Bool { env.isSample }

    func load() async {
        refresh()
        if cards.isEmpty && env.isSample && !isLoading { await loadSample() }
    }

    /// Simulator and sample mode: run the capture seam and read every sample.
    func loadSample() async {
        isLoading = true
        defer { isLoading = false }
        guard let docs = try? await env.capture.sampleDocuments() else { return }
        let items = CaptureIntake.add(docs, to: context)
        readingCount = items.count
        await reader.read(items)
        readingCount = 0
        try? context.save()
        refresh()
    }

    func file(_ item: PipelineItem) async { await decide(item, .file) }
    func shred(_ item: PipelineItem) async { await decide(item, .shredOnly) }

    func later(_ item: PipelineItem) {
        item.createdAt = .now
        try? context.save()
        refresh()
    }

    private func decide(_ item: PipelineItem, _ decision: PipelineDecision) async {
        item.decision = decision
        item.decidedAt = .now
        item.stage = .queued
        try? context.save()
        refresh()
        await env.outbox.enqueue(item)
        try? context.save()
    }

    func refresh() {
        cards = PipelineStore.items(in: .ready, context: context)
    }
}
