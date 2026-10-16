// Owner: piles. Logic only, no SwiftUI. The Shred, Keep and All filed piles (A5) and the
// safe-to-shred rule with the shred hold (#18). The Shred hold setting itself is outbox's
// (ARCHITECTURE.md owners); Piles only reads it.
import Foundation

/// Where a document in the shred pile stands.
nonisolated enum ShredState: Hashable, Sendable {
    /// The Drive copy is confirmed and the hold is over.
    case safe
    /// Filed from the phone, Drive's checksum not matched yet.
    case checking
    /// Verified, the hold ends on this date.
    case holding(until: Date)
}

nonisolated enum PileRules {
    /// The shred-pile state of a doc, or nil when it isn't in the shred pile.
    /// A doc is Safe only when `isSafeToShred` and the hold has passed since `verifiedAt` (#18).
    /// Web-filed docs and shred-only logs have nothing to verify and no hold.
    static func shredState(_ doc: FiledDoc, holdDays: Int, now: Date) -> ShredState? {
        guard doc.physical == .toShred else { return nil }
        guard doc.isSafeToShred else { return .checking }
        guard holdDays > 0, doc.source == "ios", doc.filed, let verified = PileFormat.date(iso: doc.verifiedAt) else {
            return .safe
        }
        let ends = verified.addingTimeInterval(TimeInterval(holdDays) * 86_400)
        return ends <= now ? .safe : .holding(until: ends)
    }
}

@Observable
final class PilesViewModel {
    enum Segment: Hashable { case shred, keep, all }
    enum AllFilter: Hashable { case all, sensitive }

    private let docs: any DocStore
    private let auth: (any AuthService)?
    var now: () -> Date = { .now }

    private(set) var all: [FiledDoc] = []
    private(set) var settings = AppSettings()
    private(set) var loaded = false

    var segment: Segment = .shred
    var allFilter: AllFilter = .all
    /// The "{n} more" row under Safe to shred expands in place.
    var showAllSafe = false
    private(set) var reconnecting = false
    private(set) var reconnectFailed = false
    /// Last write that failed, for an alert.
    var writeError: String?

    init(docs: any DocStore, auth: (any AuthService)? = nil) {
        self.docs = docs
        self.auth = auth
    }

    convenience init(env: AppEnvironment) {
        self.init(docs: env.docs, auth: env.auth)
    }

    /// The listener failed (spec 3.11 has no copy for this; see `loadFailed`).
    var loadFailed: Bool { docs.syncError != nil && !loaded }

    /// Runs for as long as the screen is on screen (call from .task).
    func watch() async {
        let docStream = docs.docs()
        let settingsStream = docs.watchSettings()
        let settingsTask = Task { for await value in settingsStream { self.settings = value } }
        defer { settingsTask.cancel() }
        for await list in docStream {
            all = list
            loaded = true
        }
    }

    // MARK: Shred

    var holdDays: Int { settings.shredHoldDays }

    func shredState(_ doc: FiledDoc) -> ShredState? {
        PileRules.shredState(doc, holdDays: holdDays, now: now())
    }

    var shredPile: [FiledDoc] { all.filter { $0.physical == .toShred } }
    var safe: [FiledDoc] { shredPile.filter { shredState($0) == .safe } }
    var waiting: [FiledDoc] { shredPile.filter { shredState($0) != .safe } }

    /// The first three safe docs, then a "{n} more" row unless expanded.
    var visibleSafe: [FiledDoc] { showAllSafe ? safe : Array(safe.prefix(3)) }
    var hiddenSafeCount: Int { showAllSafe ? 0 : max(0, safe.count - 3) }

    /// Spec 3.9, safe to shred banner: bold first sentence, then the rest.
    var safeBanner: (bold: String, rest: String)? {
        let n = safe.count
        guard n > 0 else { return nil }
        let bold = n == 1 ? "1 is safe to shred." : "\(n) are safe to shred."
        let rest = holdDays > 0
            ? "The Drive copy is confirmed and the \(holdDays)-day hold is over."
            : "The Drive copy is confirmed."
        return (bold, rest)
    }

    var markTitle: String { "Mark \(safe.count) as shredded" }
    var markConfirmTitle: String { "Mark \(safe.count) as shredded?" }

    /// The Waiting pill: "{n} days" / "1 day" / "Today", or "Checking" while the Drive check runs.
    func waitingPill(_ doc: FiledDoc) -> String {
        guard let days = waitingDaysLeft(doc) else { return "Checking" }
        return days == 0 ? "Today" : PileFormat.days(days)
    }

    /// Whole days of hold left for the shared StatusPill's Waiting kind, or nil while the Drive
    /// check runs (its Checking kind).
    func waitingDaysLeft(_ doc: FiledDoc) -> Int? {
        guard case .holding(let until) = shredState(doc) else { return nil }
        return PileFormat.daysUntil(until, now: now())
    }

    /// Why a Waiting row is waiting.
    func waitingSubtitle(_ doc: FiledDoc) -> String {
        switch shredState(doc) {
        case .holding(let until): "Drive copy confirmed · hold ends \(PileFormat.shortDay(until, now: now()))"
        default: "Checking the Drive copy"
        }
    }

    func shredSubtitle(_ doc: FiledDoc) -> String {
        doc.sensitive ? "\(doc.issuer) · Cross-cut" : doc.issuer
    }

    /// Marks every Safe doc as shredded. Waiting docs are never included.
    func markSafeShredded() async {
        let targets = safe
        for doc in targets { await markShredded(doc) }
    }

    /// Marks one doc shredded, only when it's Safe.
    func markShredded(_ doc: FiledDoc) async {
        guard shredState(doc) == .safe else { return }
        await write(doc.id, ["physical": PhysicalState.shredded.rawValue, "shreddedAt": PileFormat.iso(now())])
    }

    // MARK: Keep

    var toPutAway: [FiledDoc] { all.filter { $0.physical == .keep } }
    var inBinder: [FiledDoc] { all.filter { $0.physical == .stored } }
    var keepCount: Int { toPutAway.count + inBinder.count }

    func keepSubtitle(_ doc: FiledDoc) -> String {
        "\(doc.issuer) · \(PileFormat.folderName(doc.folder))"
    }

    func putAway(_ doc: FiledDoc) async {
        guard doc.physical == .keep else { return }
        await write(doc.id, ["physical": PhysicalState.stored.rawValue])
    }

    func takeOut(_ doc: FiledDoc) async {
        guard doc.physical == .stored else { return }
        await write(doc.id, ["physical": PhysicalState.keep.rawValue])
    }

    // MARK: All filed

    /// Everything with a Drive copy, newest first.
    var filed: [FiledDoc] {
        all.filter { $0.filed && (allFilter == .all || $0.sensitive) }
            .sorted { $0.filedAt > $1.filedAt }
    }

    var filedCount: Int { all.filter(\.filed).count }

    /// Grouped by the month it was filed ("October 2026"), newest month first.
    var filedByMonth: [(title: String, docs: [FiledDoc])] {
        var groups: [(title: String, docs: [FiledDoc])] = []
        for doc in filed {
            let title = PileFormat.date(iso: doc.filedAt).map(PileFormat.monthTitle) ?? "Earlier"
            if let last = groups.indices.last, groups[last].title == title {
                groups[last].docs.append(doc)
            } else {
                groups.append((title, [doc]))
            }
        }
        return groups
    }

    func filedSubtitle(_ doc: FiledDoc) -> String {
        "\(doc.issuer) · \(PileFormat.folderName(doc.folder))"
    }

    func driveURL(_ doc: FiledDoc) -> URL? {
        doc.driveUrl.isEmpty ? nil : URL(string: doc.driveUrl)
    }

    // MARK: Drive reconnect (spec 4.16)

    var driveNeedsReconnect: Bool { auth?.drive == .needsReconnect }

    func reconnectDrive() async {
        guard let auth else { return }
        reconnecting = true
        reconnectFailed = false
        do { try await auth.reconnectDrive() } catch { reconnectFailed = true }
        reconnecting = false
    }

    // MARK: Writes

    private func write(_ id: String, _ fields: [String: any Sendable]) async {
        do {
            try await docs.updateDoc(id: id, fields: fields)
        } catch {
            writeError = "That didn't save. Check your connection and try again."
        }
    }
}
