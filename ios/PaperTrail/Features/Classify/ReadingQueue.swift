// Owner: classify. Logic only.
//
// Moves captured items to .ready by sending each to the classify service:
// - one shared queue, at most two reads at a time across every caller (ARCHITECTURE.md, "Classify
//   contract"). Before #75 each read() call started its own two workers, so a scan review reading
//   five documents ran all five at once
// - after a quiet spell the first read goes alone (#75): Claude's prompt cache is only readable once
//   a read has answered, so reads that start together all pay to write it and none read it. The
//   second lane opens as soon as that first read is back, which is also when the first card is ready
// - OCR text plus a small first-page picture when the text is there, the pages otherwise
//   (ClassifyPayload), with the user's sender rules as hints; if the reply has no appliedRule (an
//   older function), the same rule is applied here (SenderRuleEngine), so corrections stick either way
// - automatic retries with backoff only for ClassifyErrorCode.isRetryable codes
// - unsure fields worked out from the card's confidence (#20) for the deck and the check-fields sheet
// - `onEach` runs as each item finishes, so a caller can show the first card without waiting for
//   the rest
// - wall-clock timing per read in the log (#75): enqueue to card ready, split into building the
//   payload and the classify call
// A failed read keeps its scan on disk; the card shows ClassifyCopy and "Try again" calls retry(_:).
import Foundation
import OSLog
import SwiftData

/// How long one read took, for the log and the tests (#75).
nonisolated struct ReadTiming: Sendable, Hashable {
    /// Queued (read() called) until the card is ready or the read failed.
    var total: Duration
    /// Waiting for a free lane.
    var waited: Duration
    /// Building the request (PDF render, base64).
    var build: Duration
    /// The classify call, retries included.
    var call: Duration
    var kind: String
    var ocrPrimary: Bool
    var payloadBytes: Int
}

@Observable
final class ReadingQueue {
    /// Reads in flight at once, once the prompt cache is warm.
    static let concurrency = 2
    /// How long after a read answers Claude's prompt cache is still warm (it lives five minutes from
    /// its last use; a little margin for the clock and the network).
    static let cacheWarmFor: Duration = .seconds(240)
    /// Waits before the second and third attempts. Three attempts in all.
    static let defaultBackoff: [Duration] = [.seconds(2), .seconds(8)]

    private let classify: any ClassifyService
    private let files: FileStore
    private let docs: (any DocStore)?
    private let backoff: [Duration]
    @ObservationIgnored private let clock = ContinuousClock()
    @ObservationIgnored private let log = Logger(subsystem: "PaperTrail", category: "classify")

    private struct Job {
        let item: PipelineItem
        let rules: [SenderRule]
        let queuedAt: ContinuousClock.Instant
        let onDone: ((PipelineItem) -> Void)?
    }

    @ObservationIgnored private var pending: [Job] = []
    /// Lanes running now; each takes jobs until `pending` is empty.
    @ObservationIgnored private var lanes = 0
    /// When the last read answered (success or a Claude error), for the warm-cache check.
    @ObservationIgnored private var lastAnswer: ContinuousClock.Instant?
    /// Items sent to Claude right now, for "3 reading" counts.
    private(set) var inFlight = 0
    /// The most reads that ran at once, for the tests.
    @ObservationIgnored private(set) var peakInFlight = 0
    /// Timing of each finished read, by item, for the tests (#75).
    @ObservationIgnored private(set) var timings: [UUID: ReadTiming] = [:]
    /// Callers waiting on their items.
    @ObservationIgnored private var waiters: [UUID: [CheckedContinuation<Void, Never>]] = [:]

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

    /// Reads every item that is still .captured, in order, two at a time once the cache is warm.
    /// `onEach` runs as each one finishes. Returns when all are .ready or .failed.
    func read(_ items: [PipelineItem], onEach: ((PipelineItem) -> Void)? = nil) async {
        let fresh = items.filter { $0.stage == .captured }
        guard !fresh.isEmpty else { return }
        let queuedAt = clock.now
        for item in fresh { item.stage = .reading }
        let rules = await senderRules()
        pending.append(contentsOf: fresh.map { Job(item: $0, rules: rules, queuedAt: queuedAt, onDone: onEach) })
        openLanes()
        for item in fresh where item.stage == .reading {
            await withCheckedContinuation { waiters[item.id, default: []].append($0) }
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

    /// One lane while the cache is cold, two once a read has answered recently.
    private var laneLimit: Int {
        guard let lastAnswer, clock.now - lastAnswer < Self.cacheWarmFor else { return 1 }
        return Self.concurrency
    }

    /// Starts lanes up to the limit while there's work no lane is about to pick up. A lane that is
    /// running but not reading (`lanes - inFlight`) is on its way to the next job.
    private func openLanes() {
        while lanes < laneLimit, pending.count > lanes - inFlight {
            lanes += 1
            Task { await self.runLane() }
        }
    }

    private func runLane() async {
        while !pending.isEmpty {
            let job = pending.removeFirst()
            inFlight += 1
            peakInFlight = max(peakInFlight, inFlight)
            await readOne(job)
            inFlight -= 1
            job.onDone?(job.item)
            waiters.removeValue(forKey: job.item.id)?.forEach { $0.resume() }
            // The first answer warms the cache: open the second lane for what's left.
            openLanes()
        }
        lanes -= 1
    }

    private func readOne(_ job: Job) async {
        let item = job.item
        let started = clock.now
        var built = started, answered = started
        var kind = "", primary = false, bytes = 0
        do {
            let request = try await ClassifyPayload.request(
                pdfAt: files.url(for: item.fileName), pageCount: item.pageCount,
                ocrText: item.ocrText, senderHints: job.rules)
            built = clock.now
            kind = request.kind.rawValue
            primary = request.ocrPrimary == true
            bytes = (request.pdf?.utf8.count ?? 0) + (request.images ?? []).reduce(0) { $0 + $1.data.utf8.count }
            let response = try await classifyWithRetry(request)
            answered = clock.now
            lastAnswer = answered
            var card = response.result
            if card.appliedRule == nil { card = SenderRuleEngine.apply(job.rules, to: card) }
            item.card = card
            item.model = response.model
            item.unsureFields = card.confidence?.unsureFields ?? []
            item.readErrorCode = nil
            item.stage = .ready
        } catch let failure as ClassifyFailure {
            answered = clock.now
            item.readErrorCode = failure.code.rawValue
            item.fail(at: .reading, ClassifyCopy.message(for: failure.code))
        } catch {
            answered = clock.now
            item.readErrorCode = ClassifyErrorCode.unknown.rawValue
            item.fail(at: .reading, ClassifyCopy.message(for: .unknown))
        }
        let timing = ReadTiming(total: answered - job.queuedAt, waited: started - job.queuedAt,
                                build: built - started, call: answered - built,
                                kind: kind, ocrPrimary: primary, payloadBytes: bytes)
        timings[item.id] = timing
        log.info("read \(item.stage == .ready ? "ready" : "failed", privacy: .public) in \(Self.ms(timing.total)) ms: waited \(Self.ms(timing.waited)) ms, build \(Self.ms(timing.build)) ms, classify \(Self.ms(timing.call)) ms, \(kind, privacy: .public)\(primary ? " + ocr" : "", privacy: .public), \(item.pageCount) pages, \(bytes) bytes")
    }

    nonisolated static func ms(_ d: Duration) -> Int {
        Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
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
