// Owner: piles (paperless ledger, #23). Logic only, no SwiftUI. Design spec 4.7 (A7).
import Foundation

/// A sender already asked to stop paper who sent paper anyway.
nonisolated struct MailingFlag: Identifiable, Hashable, Sendable {
    var sender: PaperlessSender
    /// The newest paper document from them since the request, when the app has it.
    var doc: FiledDoc?
    /// When it arrived (the doc's filing date, or `stillMailingAt`).
    var at: Date
    var id: String { sender.id }
}

nonisolated enum PaperlessRules {
    /// Statuses where new paper means the request didn't take.
    static let watched: Set<PaperlessStatus> = [.requested, .waitingCycle, .confirmed]
    static let cycleDays = 35

    /// The paperless record a filed doc belongs to: slug of the paperless issuer, else the doc's issuer.
    static func senderID(for doc: FiledDoc) -> String {
        slug(doc.paperless.issuer.isEmpty ? doc.issuer : doc.paperless.issuer)
    }

    static func docs(of sender: PaperlessSender, in docs: [FiledDoc]) -> [FiledDoc] {
        docs.filter { senderID(for: $0) == sender.id || slug($0.issuer) == sender.id }
    }

    /// From when new paper counts as "still mailing": the latest of when Bryce requested it,
    /// confirmed it, or last handled a flag (Wait a cycle). Falls back to the first scan.
    static func baseline(_ sender: PaperlessSender) -> Date? {
        [sender.requestedAt, sender.doneAt, sender.mailHandledAt]
            .compactMap(PileFormat.date(iso:)).max() ?? PileFormat.date(iso: sender.firstSeen)
    }

    static func flag(_ sender: PaperlessSender, docs: [FiledDoc]) -> MailingFlag? {
        guard watched.contains(sender.status), let since = baseline(sender) else { return nil }
        let newest = self.docs(of: sender, in: docs)
            .compactMap { doc in PileFormat.date(iso: doc.filedAt).map { (doc, $0) } }
            .filter { $0.1 > since }
            .max { $0.1 < $1.1 }
        if let newest { return MailingFlag(sender: sender, doc: newest.0, at: newest.1) }
        if let at = PileFormat.date(iso: sender.stillMailingAt), at > since {
            return MailingFlag(sender: sender, doc: nil, at: at)
        }
        return nil
    }

    /// Spec 3.9: "{issuer} sent a paper {docType} on {date}, after you requested paperless."
    static func bannerText(_ flag: MailingFlag, now: Date) -> String {
        guard let doc = flag.doc else {
            return "\(flag.sender.issuer) sent paper mail on \(PileFormat.shortDay(flag.at, now: now)), after you requested paperless."
        }
        let type = doc.docType.isEmpty ? "document" : lowercasedType(doc.docType)
        let day = PileFormat.date(docDate: doc.docDate) ?? flag.at
        return "\(flag.sender.issuer) sent a paper \(type) on \(PileFormat.shortDay(day, now: now)), after you requested paperless."
    }

    /// "Utility bill" reads as "utility bill"; acronyms like "EOB" or "W-2" keep their case.
    static func lowercasedType(_ type: String) -> String {
        type.split(separator: " ").map { word in
            word.count > 1 && word.uppercased() == word ? String(word) : word.lowercased()
        }.joined(separator: " ")
    }
}

@Observable
final class PaperlessViewModel {
    private let store: any DocStore
    var now: () -> Date = { .now }

    private(set) var senders: [PaperlessSender] = []
    private(set) var docs: [FiledDoc] = []
    private(set) var sendersLoaded = false
    private(set) var docsLoaded = false
    var showAllFlags = false
    var writeError: String?

    init(docs: any DocStore) { store = docs }

    convenience init(env: AppEnvironment) { self.init(docs: env.docs) }

    var loaded: Bool { sendersLoaded && docsLoaded }
    var loadFailed: Bool { store.syncError != nil && !loaded }

    /// Runs while the screen is showing. Paperless records are created by whoever files the doc
    /// (the web app, or the outbox on the phone), never here, so two writers can't race.
    func watch() async {
        let senderStream = store.paperless()
        let docStream = store.docs()
        let docsTask = Task {
            for await list in docStream {
                self.docs = list
                self.docsLoaded = true
            }
        }
        defer { docsTask.cancel() }
        for await list in senderStream {
            senders = list
            sendersLoaded = true
        }
    }

    // MARK: Sections

    /// "{x} of {y} senders confirmed". Can't stop senders don't count toward y.
    var subtitle: String? {
        let counted = senders.filter { $0.status != .cantStop }
        guard !counted.isEmpty else { return nil }
        let done = counted.filter { $0.status == .confirmed }.count
        return "\(done) of \(counted.count) senders confirmed"
    }

    /// Newest first.
    var flags: [MailingFlag] {
        senders.compactMap { PaperlessRules.flag($0, docs: docs) }.sorted { $0.at > $1.at }
    }

    /// At most two banners, then a "{n} more senders are still mailing" row.
    var visibleFlags: [MailingFlag] { showAllFlags ? flags : Array(flags.prefix(2)) }
    var hiddenFlagCount: Int { showAllFlags ? 0 : max(0, flags.count - 2) }
    var moreFlagsText: String {
        hiddenFlagCount == 1 ? "1 more sender is still mailing" : "\(hiddenFlagCount) more senders are still mailing"
    }

    func bannerText(_ flag: MailingFlag) -> String { PaperlessRules.bannerText(flag, now: now()) }

    /// Requested and Waiting a cycle, soonest check-back first.
    var checkBackSoon: [PaperlessSender] {
        senders.filter { $0.status == .requested || $0.status == .waitingCycle }
            .sorted { a, b in
                switch (PileFormat.date(iso: a.checkBackAt), PileFormat.date(iso: b.checkBackAt)) {
                case let (x?, y?): x < y
                case (.some, nil): true
                case (nil, .some): false
                case (nil, nil): a.issuer < b.issuer
                }
            }
    }

    var toDo: [PaperlessSender] {
        senders.filter { $0.status == .toDo }.sorted { $0.issuer.localizedCaseInsensitiveCompare($1.issuer) == .orderedAscending }
    }

    var confirmed: [PaperlessSender] {
        senders.filter { $0.status == .confirmed }.sorted { $0.issuer.localizedCaseInsensitiveCompare($1.issuer) == .orderedAscending }
    }

    var cantStop: [PaperlessSender] {
        senders.filter { $0.status == .cantStop }.sorted { $0.issuer.localizedCaseInsensitiveCompare($1.issuer) == .orderedAscending }
    }

    /// The Done section groups senders that share a status into one row (A7):
    /// "Harbor Federal, Northwind" with "1 more can't stop (DMV)" under it.
    var doneGroup: (title: String, status: PaperlessStatus, subtitle: String?)? {
        if !confirmed.isEmpty {
            let names = confirmed.map(\.issuer).joined(separator: ", ")
            var sub: String?
            if !cantStop.isEmpty {
                sub = "\(cantStop.count) more can't stop (\(cantStop.map(\.issuer).joined(separator: ", ")))"
            }
            return (names, .confirmed, sub)
        }
        if !cantStop.isEmpty {
            return (cantStop.map(\.issuer).joined(separator: ", "), .cantStop, nil)
        }
        return nil
    }

    var doneSenders: [PaperlessSender] { confirmed + cantStop }

    func checkBackText(_ sender: PaperlessSender) -> String {
        guard let date = PileFormat.date(iso: sender.checkBackAt) else { return "No check-back date" }
        return "Check back \(PileFormat.shortDay(date, now: now()))"
    }

    /// The first step, or `how` when there are no steps.
    func firstStep(_ sender: PaperlessSender) -> String {
        sender.steps?.first(where: { !$0.isEmpty }) ?? sender.how
    }

    func steps(_ sender: PaperlessSender) -> [String] {
        let list = (sender.steps ?? []).filter { !$0.isEmpty }
        return list.isEmpty ? (sender.how.isEmpty ? [] : [sender.how]) : list
    }

    /// "First scan Aug 3 · Last scan Oct 9".
    func seenText(_ sender: PaperlessSender) -> String {
        let dates = PaperlessRules.docs(of: sender, in: docs).compactMap { PileFormat.date(iso: $0.filedAt) }
        let first = ([PileFormat.date(iso: sender.firstSeen)].compactMap { $0 } + dates).min()
        let last = (dates + [PileFormat.date(iso: sender.lastSeen)].compactMap { $0 }).max() ?? first
        guard let first else { return "No scans yet" }
        let n = now()
        if let last, !Calendar.current.isDate(last, inSameDayAs: first) {
            return "First scan \(PileFormat.shortDay(first, now: n)) · Last scan \(PileFormat.shortDay(last, now: n))"
        }
        return "First scan \(PileFormat.shortDay(first, now: n))"
    }

    func sender(id: String) -> PaperlessSender? { senders.first { $0.id == id } }

    // MARK: Actions

    /// Status changes from the detail picker and the row swipes.
    func setStatus(_ sender: PaperlessSender, to status: PaperlessStatus) async {
        switch status {
        case .requested: await markRequested(sender)
        case .waitingCycle: await waitACycle(sender)
        case .confirmed: await confirm(sender)
        case .toDo, .cantStop: await write(sender, ["status": status.rawValue])
        }
    }

    /// "I requested it": Requested, check back in 35 days.
    func markRequested(_ sender: PaperlessSender) async {
        let n = now()
        await write(sender, [
            "status": PaperlessStatus.requested.rawValue,
            "requestedAt": PileFormat.iso(n),
            "checkBackAt": PileFormat.iso(n.addingTimeInterval(TimeInterval(PaperlessRules.cycleDays) * 86_400)),
        ])
    }

    /// "Wait a cycle": Waiting a cycle, check back in 35 days, and this flag is handled.
    func waitACycle(_ sender: PaperlessSender) async {
        let n = now()
        await write(sender, [
            "status": PaperlessStatus.waitingCycle.rawValue,
            "checkBackAt": PileFormat.iso(n.addingTimeInterval(TimeInterval(PaperlessRules.cycleDays) * 86_400)),
            "mailHandledAt": PileFormat.iso(n),
        ])
    }

    /// "It's confirmed". The web app's done value, with doneAt.
    func confirm(_ sender: PaperlessSender) async {
        await write(sender, ["status": PaperlessStatus.confirmed.rawValue, "doneAt": PileFormat.iso(now())])
    }

    func setCheckBack(_ sender: PaperlessSender, to date: Date) async {
        await write(sender, ["checkBackAt": PileFormat.iso(date)])
    }

    /// The trailing swipe on a row: the next step for that status.
    func swipeChoices(_ sender: PaperlessSender) -> [PaperlessStatus] {
        switch sender.status {
        case .toDo: [.requested, .cantStop]
        case .requested, .waitingCycle: [.confirmed, .waitingCycle]
        case .confirmed, .cantStop: [.toDo]
        }
    }

    private func write(_ sender: PaperlessSender, _ fields: [String: any Sendable]) async {
        do {
            try await store.updatePaperless(id: sender.id, fields: fields)
        } catch {
            writeError = "That didn't save. Check your connection and try again."
        }
    }
}
