// Owner: outbox. What the accessory and the Outbox screen show, computed from the pipeline items
// and the outbox status. No SwiftUI, so every state in spec 3.7 and 4.4 is unit tested.
import Foundation

/// A value snapshot of one PipelineItem, so the rules work on plain data.
nonisolated struct OutboxEntry: Sendable, Hashable, Identifiable {
    var id: UUID
    var title: String
    var issuer: String
    var stage: PipelineStage
    var decision: PipelineDecision?
    var decidedAt: Date?
    var filedAt: Date?
    var verifiedAt: Date?
    var nextRetryAt: Date?
    var errorMessage: String?
    var pageCount: Int
    var sizeBytes: Int
    var bytesSent: Int
    var driveURL: String?

    init(_ item: PipelineItem) {
        id = item.id
        title = item.card?.title ?? "Untitled document"
        issuer = item.card?.issuer ?? ""
        stage = item.stage
        decision = item.decision
        decidedAt = item.decidedAt
        filedAt = item.filedAt
        verifiedAt = item.verifiedAt
        nextRetryAt = item.nextRetryAt
        errorMessage = item.errorMessage
        pageCount = item.pageCount
        sizeBytes = item.sizeBytes
        bytesSent = item.bytesSent
        driveURL = item.driveURL
    }

    init(id: UUID = UUID(), title: String, issuer: String, stage: PipelineStage, decision: PipelineDecision? = .file,
         decidedAt: Date? = nil, filedAt: Date? = nil, verifiedAt: Date? = nil, nextRetryAt: Date? = nil,
         errorMessage: String? = nil, pageCount: Int = 1, sizeBytes: Int = 1000, bytesSent: Int = 0, driveURL: String? = nil) {
        self.id = id; self.title = title; self.issuer = issuer; self.stage = stage; self.decision = decision
        self.decidedAt = decidedAt; self.filedAt = filedAt; self.verifiedAt = verifiedAt; self.nextRetryAt = nextRetryAt
        self.errorMessage = errorMessage; self.pageCount = pageCount; self.sizeBytes = sizeBytes
        self.bytesSent = bytesSent; self.driveURL = driveURL
    }

    /// In the outbox at all: decided, not "later".
    var isOutbox: Bool { decision == .file || decision == .shredOnly }
    /// Still has work to do (counts toward "Uploading 2 of 5").
    var isActive: Bool {
        guard isOutbox else { return false }
        switch stage {
        case .queued, .uploading: return true
        case .filed: return decision == .file && verifiedAt == nil
        case .failed: return true
        default: return false
        }
    }
    var isDone: Bool { isOutbox && (stage == .verified || (stage == .filed && decision == .shredOnly)) }
    var isFailed: Bool { isOutbox && stage == .failed }
    /// Automatic retries used up.
    var needsRetry: Bool { isFailed && nextRetryAt == nil }
    var progress: Double {
        guard sizeBytes > 0 else { return 0 }
        return min(1, Double(bytesSent) / Double(sizeBytes))
    }
}

nonisolated enum AccessoryState: Sendable, Hashable {
    case caughtUp(filedToday: Int)
    case empty
    case uploading(current: Int, total: Int, fraction: Double)
    case offline(saved: Int)
    case needsRetry(Int)
    case reconnect

    var title: String {
        switch self {
        case .caughtUp(let n): "All caught up · \(n) filed today"
        case .empty: "Outbox is empty"
        case .uploading(let current, let total, _): "Uploading \(current) of \(total)"
        case .offline(let saved): "Waiting for a connection · \(saved) saved on your phone"
        case .needsRetry(let n): n == 1 ? "1 needs a retry" : "\(n) need a retry"
        case .reconnect: "Reconnect Drive to keep filing"
        }
    }

    /// The short text beside the glyph when the tab bar is minimized.
    var inlineText: String? {
        switch self {
        case .caughtUp(let n): "\(n)"
        case .empty, .reconnect: nil
        case .uploading(let current, let total, _): "\(current) of \(total)"
        case .offline(let saved): "\(saved)"
        case .needsRetry(let n): "\(n)"
        }
    }
}

nonisolated enum OutboxSummary {
    /// Spec 3.7. Reconnect outranks everything, then needs attention, then offline, then uploading.
    static func accessory(_ entries: [OutboxEntry], status: OutboxStatus, driveNeedsReconnect: Bool,
                          now: Date = .now, calendar: Calendar = .current) -> AccessoryState {
        if status.needsReconnect || driveNeedsReconnect { return .reconnect }
        let retry = entries.filter(\.needsRetry).count
        if retry > 0 { return .needsRetry(retry) }
        let active = entries.filter(\.isActive)
        if !active.isEmpty {
            if !status.isOnline { return .offline(saved: active.count) }
            let batch = currentBatch(entries)
            let done = batch.filter(\.isDone).count
            let total = batch.count
            let bytes = batch.reduce(0) { $0 + max($1.sizeBytes, 1) }
            let sent = batch.reduce(0) { $0 + ($1.isDone ? max($1.sizeBytes, 1) : min($1.bytesSent, $1.sizeBytes)) }
            return .uploading(current: min(done + 1, total), total: total,
                              fraction: bytes > 0 ? Double(sent) / Double(bytes) : 0)
        }
        let today = filedToday(entries, now: now, calendar: calendar).count
        return today > 0 ? .caughtUp(filedToday: today) : .empty
    }

    /// The active items plus anything that finished since the oldest of them was decided, so
    /// "Uploading 2 of 5" counts up through one burst of swipes.
    static func currentBatch(_ entries: [OutboxEntry]) -> [OutboxEntry] {
        let active = entries.filter(\.isActive)
        guard let start = active.compactMap(\.decidedAt).min() else { return active }
        let finished = entries.filter { $0.isDone && ($0.filedAt ?? .distantPast) >= start }
        return active + finished
    }

    static func filedToday(_ entries: [OutboxEntry], now: Date = .now, calendar: Calendar = .current) -> [OutboxEntry] {
        entries.filter { $0.isDone && $0.filedAt.map { calendar.isDate($0, inSameDayAs: now) } == true }
            .sorted { ($0.filedAt ?? .distantPast) > ($1.filedAt ?? .distantPast) }
    }

    /// Done in the last 30 days, before today, newest first, grouped by day.
    static func earlier(_ entries: [OutboxEntry], now: Date = .now, calendar: Calendar = .current) -> [(day: Date, entries: [OutboxEntry])] {
        let startOfToday = calendar.startOfDay(for: now)
        guard let cutoff = calendar.date(byAdding: .day, value: -30, to: startOfToday) else { return [] }
        let old = entries.filter { e in e.isDone && e.filedAt.map { $0 < startOfToday && $0 >= cutoff } == true }
        let groups = Dictionary(grouping: old) { calendar.startOfDay(for: $0.filedAt ?? now) }
        return groups.keys.sorted(by: >).map { day in
            (day, groups[day, default: []].sorted { ($0.filedAt ?? .distantPast) > ($1.filedAt ?? .distantPast) })
        }
    }

    /// Spec 4.4, item 1: "2 uploading · 1 needs a retry · 14 filed today", zero parts left out.
    static func subtitle(_ entries: [OutboxEntry], now: Date = .now, calendar: Calendar = .current) -> String {
        let uploading = entries.filter { $0.isActive && !$0.isFailed }.count
        let failed = entries.filter(\.isFailed).count
        let today = filedToday(entries, now: now, calendar: calendar).count
        var parts: [String] = []
        if uploading > 0 { parts.append("\(uploading) uploading") }
        if failed > 0 { parts.append(failed == 1 ? "1 needs a retry" : "\(failed) need a retry") }
        if today > 0 { parts.append("\(today) filed today") }
        return parts.isEmpty ? "Nothing waiting" : parts.joined(separator: " · ")
    }

    /// Uploading section order: the one moving now, then the rest oldest decision first.
    static func uploadingSection(_ entries: [OutboxEntry]) -> [OutboxEntry] {
        entries.filter { $0.isActive && !$0.isFailed }.sorted { a, b in
            let ra = a.stage == .uploading ? 0 : (a.stage == .filed ? 1 : 2)
            let rb = b.stage == .uploading ? 0 : (b.stage == .filed ? 1 : 2)
            if ra != rb { return ra < rb }
            return (a.decidedAt ?? .distantPast) < (b.decidedAt ?? .distantPast)
        }
    }

    static func needsAttention(_ entries: [OutboxEntry]) -> [OutboxEntry] {
        entries.filter(\.isFailed).sorted { ($0.decidedAt ?? .distantPast) < ($1.decidedAt ?? .distantPast) }
    }

    // MARK: Row copy (spec 3.10)

    /// "{title} · {issuer short}". The issuer is left off when the title already names it.
    static func rowTitle(title: String, issuer: String) -> String {
        let short = shortIssuer(issuer)
        guard !short.isEmpty else { return title }
        let firstWord = short.split(separator: " ").first.map { String($0).lowercased() } ?? ""
        if !firstWord.isEmpty && title.lowercased().contains(firstWord) { return title }
        return "\(title) · \(short)"
    }

    /// "Harbor Federal CU" to "Harbor Federal", "Cascade Power & Light" to "Cascade Power".
    static func shortIssuer(_ issuer: String) -> String {
        let suffixes: Set<String> = ["inc", "inc.", "llc", "co", "co.", "corp", "corp.", "cu", "ltd", "n.a.", "&", "and"]
        var words = issuer.split(separator: " ").map(String.init)
        while let last = words.last, suffixes.contains(last.lowercased()) { words.removeLast() }
        words = Array(words.prefix(2))
        while let last = words.last, suffixes.contains(last.lowercased()) { words.removeLast() }
        return words.joined(separator: " ")
    }

    static func failedSubtitle(_ entry: OutboxEntry, now: Date = .now) -> String {
        if let next = entry.nextRetryAt { return OutboxCopy.retrying(at: next, now: now) }
        return entry.errorMessage ?? OutboxCopy.retriesUsedUp
    }

    static func waitingSubtitle(_ entry: OutboxEntry, isOnline: Bool) -> String {
        if entry.stage == .filed { return OutboxCopy.checking }
        return isOnline ? OutboxCopy.nextInLine : OutboxCopy.waitingForConnection
    }

    /// "1 of 1 pages confirmed in Drive · 10:12 AM" for the first row, shorter after it.
    static func filedSubtitle(_ entry: OutboxEntry, isFirst: Bool) -> String {
        let time = (entry.filedAt ?? entry.verifiedAt ?? .now).formatted(date: .omitted, time: .shortened)
        if entry.decision == .shredOnly { return "Logged as shredded · \(time)" }
        let pages = entry.pageCount
        return "\(pages) of \(pages) pages confirmed\(isFirst ? " in Drive" : "") · \(time)"
    }
}
