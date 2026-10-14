// Owner: classify. Logic only.
//
// Moves captured items to .ready by sending each to the classify service:
// - two reads at a time (ARCHITECTURE.md, "Classify contract")
// - the PDF whole when small, page images otherwise (ClassifyPayload), with the OCR text
// - the user's sender rules as hints; if the reply has no appliedRule (the function deployed today
//   ignores hints), the same rule is applied here (SenderRuleEngine), so corrections stick either way
// - automatic retries with backoff only for ClassifyErrorCode.isRetryable codes
// - unsure fields worked out from the card's confidence (#20) for the deck and the check-fields sheet
// A failed read keeps its scan on disk; the card shows ClassifyCopy and "Try again" calls retry(_:).
import Foundation
import SwiftData

@Observable
final class ReadingQueue {
    /// Reads in flight at once.
    static let concurrency = 2
    /// Waits before the second and third attempts. Three attempts in all.
    static let defaultBackoff: [Duration] = [.seconds(2), .seconds(8)]

    private let classify: any ClassifyService
    private let files: FileStore
    private let docs: (any DocStore)?
    private let backoff: [Duration]

    private var pending: [PipelineItem] = []
    /// Items sent to Claude right now, for "3 reading" counts.
    private(set) var inFlight = 0

    /// `docs` supplies the sender rules; without it no hints are sent and no rules applied.
    init(classify: any ClassifyService, files: FileStore, docs: (any DocStore)? = nil,
         backoff: [Duration] = ReadingQueue.defaultBackoff) {
        self.classify = classify
        self.files = files
        self.docs = docs
        self.backoff = backoff
    }

    /// The queue the app uses: the environment's classify service, file store and sender rules.
    convenience init(env: AppEnvironment) {
        self.init(classify: env.classify, files: env.files, docs: env.docs)
    }

    /// Reads every item that is still .captured, two at a time. Returns when all are .ready or .failed.
    func read(_ items: [PipelineItem]) async {
        let fresh = items.filter { $0.stage == .captured }
        guard !fresh.isEmpty else { return }
        for item in fresh { item.stage = .reading }
        pending.append(contentsOf: fresh)
        let rules = await senderRules()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<Self.concurrency {
                group.addTask { await self.drain(rules: rules) }
            }
        }
    }

    /// "Try again" on a failed card: back to .captured and read again.
    func retry(_ item: PipelineItem) async {
        guard item.stage == .failed, item.failedStageRaw == PipelineStage.reading.rawValue else { return }
        item.stage = .captured
        item.failedStageRaw = nil
        item.errorMessage = nil
        item.readErrorCode = nil
        await read([item])
    }

    private func drain(rules: [SenderRule]) async {
        while !pending.isEmpty {
            let item = pending.removeFirst()
            inFlight += 1
            await readOne(item, rules: rules)
            inFlight -= 1
        }
    }

    private func readOne(_ item: PipelineItem, rules: [SenderRule]) async {
        do {
            let request = try await ClassifyPayload.request(
                pdfAt: files.url(for: item.fileName), pageCount: item.pageCount,
                ocrText: item.ocrText, senderHints: rules)
            let response = try await classifyWithRetry(request)
            var card = response.result
            if card.appliedRule == nil { card = SenderRuleEngine.apply(rules, to: card) }
            item.card = card
            item.model = response.model
            item.unsureFields = card.confidence?.unsureFields ?? []
            item.readErrorCode = nil
            item.stage = .ready
        } catch let failure as ClassifyFailure {
            item.readErrorCode = failure.code.rawValue
            item.fail(at: .reading, ClassifyCopy.message(for: failure.code))
        } catch {
            item.readErrorCode = ClassifyErrorCode.unknown.rawValue
            item.fail(at: .reading, ClassifyCopy.message(for: .unknown))
        }
    }

    private func classifyWithRetry(_ request: ClassifyRequest) async throws -> ClassifyResponse {
        var attempt = 0
        while true {
            do {
                return try await classify.classify(request)
            } catch let failure as ClassifyFailure where failure.code.isRetryable && attempt < backoff.count {
                try? await Task.sleep(for: backoff[attempt])
                attempt += 1
            }
        }
    }

    private func senderRules() async -> [SenderRule] {
        guard let docs else { return [] }
        return (try? await docs.senderRules()) ?? []
    }
}
