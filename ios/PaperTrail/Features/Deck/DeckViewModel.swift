// Owner: deck. Logic only: no SwiftUI here. Every gesture, button, context menu item and
// VoiceOver action on the Sort deck calls one of `file(_:)`, `shred(_:)`, `later(_:)`, `undo()`
// (docs/design-spec.md section 1, principle 7), so the screens can be rebuilt without touching this.
import Foundation
import SwiftData
import CoreGraphics

/// Which way a decided card left the deck. Undo brings it back from the same side.
enum DeckSide: Sendable, Hashable {
    /// Swipe right.
    case file
    /// Swipe left.
    case shred
}

/// What a decision call did, so the gesture knows whether to fly the card off or snap it back.
enum DeckOutcome: Sendable, Hashable {
    /// Decided: the card leaves the deck (held for undo first).
    case decided
    /// File on a card with unsure fields: the check-fields sheet opens instead (3.8).
    case needsCheck
    /// Shred on a Keep original card: the confirm opens first (4.14).
    case needsKeepConfirm
    /// Not possible on this card (File on a card that failed to read, or nothing on top).
    case unavailable
}

/// The latest decision: one card, or a bulk file as one step. Held back from the outbox for the
/// undo window (Bryce's decision 4), then released.
struct DeckDecision {
    let items: [PipelineItem]
    let decision: PipelineDecision
    /// Stage and failed stage before the decision, to restore on undo.
    let prior: [UUID: (stage: String, failed: String?)]
    var released = false

    var side: DeckSide { decision == .shredOnly ? .shred : .file }
}

@Observable
final class DeckViewModel {
    private let env: AppEnvironment
    private let reader: ReadingQueue
    private var context: ModelContext { env.modelContainer.mainContext }

    /// How long the latest decision waits before its upload starts (design spec decision 4).
    var holdDuration: Duration = .seconds(10)

    /// Cards on the deck, top first: read cards waiting for a swipe, plus cards that failed to read.
    private(set) var cards: [PipelineItem] = []
    private(set) var isLoading = false
    /// Documents still with Claude (captured or reading).
    private(set) var readingCount = 0
    /// Decisions made today, including the one held for undo (the "All sorted" empty state).
    private(set) var filedToday = 0
    /// False until anything has ever been captured: picks the first-time empty state.
    private(set) var hasHistory = false
    /// The latest decision, the one Undo reverses. Nil when there is nothing to undo.
    private(set) var last: DeckDecision?

    /// Card the check-fields sheet is open for (3.8), and the field to scroll to.
    var checking: PipelineItem?
    var checkFocus: CardField?
    /// Keep original card waiting on "Shred a Keep original?" (4.14).
    var keepConfirm: PipelineItem?

    private var holdTask: Task<Void, Never>?
    private var uploads: [Task<Void, Never>] = []

    init(env: AppEnvironment) {
        self.env = env
        self.reader = ReadingQueue(env: env)   // classify: sends and applies sender rules (#21)
    }

    var isSample: Bool { env.isSample }
    var top: PipelineItem? { cards.first }
    var canUndo: Bool { last != nil }

    // MARK: - Loading

    func load() async {
        refresh()
        if !hasHistory && env.isSample && !isLoading { await loadSample() }
    }

    /// Simulator and sample mode: run the capture seam and read every sample.
    func loadSample() async {
        isLoading = true
        defer { isLoading = false }
        guard let docs = try? await env.capture.sampleDocuments() else { return }
        let items = CaptureIntake.add(docs, to: context)
        refresh()
        await reader.read(items)
        try? context.save()
        refresh()
    }

    func refresh() {
        let held = Set((last?.released == false ? last?.items : nil)?.map(\.id) ?? [])
        let all = (try? context.fetch(FetchDescriptor<PipelineItem>(sortBy: [SortDescriptor(\.createdAt)]))) ?? []
        cards = all.filter { ($0.stage == .ready || isReadFailed($0)) && !held.contains($0.id) && $0.decision == nil }
        readingCount = all.filter { $0.stage == .captured || $0.stage == .reading }.count
        hasHistory = !all.isEmpty
        // The held decision counts too: "All sorted · 4 filed today" shouldn't read 3 for the
        // ten seconds before the last swipe is released to the outbox.
        filedToday = all.filter {
            ($0.decision == .file || $0.decision == .shredOnly) && Calendar.current.isDateInToday($0.decidedAt ?? .distantPast)
        }.count + held.count
    }

    // MARK: - Card state

    func isReadFailed(_ item: PipelineItem) -> Bool {
        item.stage == .failed && item.failedStageRaw == PipelineStage.reading.rawValue
    }

    /// The fields to check on this card, in the spec's order, from the classify agent's data.
    func checks(for item: PipelineItem) -> [FieldCheck] {
        guard let card = item.card, !isReadFailed(item) else { return [] }
        return env.classify.checkFields(for: card).fields
    }

    func unsureFields(_ item: PipelineItem) -> [CardField] { checks(for: item).map(\.field) }

    /// Ready to file without a look: Claude sent confidence, it is high, and no field is unsure.
    /// A card with no confidence data never counts.
    func isConfident(_ item: PipelineItem) -> Bool {
        guard item.stage == .ready, let card = item.card else { return false }
        return card.isConfident && checks(for: item).isEmpty
    }

    var confidentCount: Int { cards.filter(isConfident).count }

    /// "{n} to go · {m} ready to file", plus " · {r} reading" while Claude is still reading (4.2).
    /// With nothing on the deck yet but cards still reading, only "{r} reading": the empty state
    /// already says the rest, and "0 to go · 0 ready to file" would only repeat it. Empty when
    /// there is nothing on the deck and nothing reading.
    var subtitle: String {
        if cards.isEmpty { return readingCount > 0 ? "\(readingCount) reading" : "" }
        var parts = ["\(cards.count) to go", "\(confidentCount) ready to file"]
        if readingCount > 0 { parts.append("\(readingCount) reading") }
        return parts.joined(separator: " · ")
    }

    // MARK: - Bulk filing (off by default, design spec decision 5)

    /// Confident cards the bulk prompt would file: every confident card except the top one when
    /// the top is confident (the user is already looking at it).
    var bulkCandidates: [PipelineItem] {
        let confident = cards.filter(isConfident)
        if let top, isConfident(top) { return confident.filter { $0.id != top.id } }
        return confident
    }

    /// The prompt's label, or nil when it shouldn't show (setting off, or fewer than two cards).
    func bulkPromptTitle(enabled: Bool) -> String? {
        guard enabled else { return nil }
        let count = bulkCandidates.count
        guard count >= 2 else { return nil }
        if let top, isConfident(top) { return "File the other \(count) confident cards" }
        return "File the \(count) confident cards"
    }

    /// Files the chosen cards together; Undo reverses all of them as one step.
    @discardableResult
    func fileTogether(_ items: [PipelineItem]) -> DeckOutcome {
        let chosen = items.filter(isConfident)
        guard !chosen.isEmpty else { return .unavailable }
        commit(chosen, .file)
        return .decided
    }

    // MARK: - Decisions

    /// Swipe right, the File button, the menu and VoiceOver. A card with unsure fields opens the
    /// check-fields sheet instead of filing.
    @discardableResult
    func file(_ item: PipelineItem) -> DeckOutcome {
        guard cards.contains(where: { $0.id == item.id }), item.card != nil, !isReadFailed(item) else { return .unavailable }
        if !checks(for: item).isEmpty {
            checkFocus = nil
            checking = item
            return .needsCheck
        }
        commit([item], .file)
        return .decided
    }

    /// Swipe left, the Shred button, the menu and VoiceOver: log as shredded, no Drive copy.
    /// A Keep original card always asks first (4.14). A card that failed to read can still be
    /// shredded, logged without a card.
    @discardableResult
    func shred(_ item: PipelineItem) -> DeckOutcome {
        guard cards.contains(where: { $0.id == item.id }) else { return .unavailable }
        if item.card?.verdict == .keepOriginal {
            keepConfirm = item
            return .needsKeepConfirm
        }
        commit([item], .shredOnly)
        return .decided
    }

    /// "Shred anyway" in the Keep original confirm.
    @discardableResult
    func confirmKeepOriginalShred() -> DeckOutcome {
        guard let item = keepConfirm else { return .unavailable }
        keepConfirm = nil
        guard cards.contains(where: { $0.id == item.id }) else { return .unavailable }
        commit([item], .shredOnly)
        return .decided
    }

    func cancelKeepOriginalShred() { keepConfirm = nil }

    /// "Move to the back".
    func later(_ item: PipelineItem) {
        item.createdAt = .now
        try? context.save()
        refresh()
    }

    /// Undo the latest decision (one step; a bulk file is one step). Inside the hold window the
    /// cards come back with nothing to reverse. After it, the outbox sends them back (cancels the
    /// upload or trashes the Drive copy, removes the log entry). Returns the side they left from.
    @discardableResult
    func undo() async -> DeckSide? {
        guard let decision = last else { return nil }
        holdTask?.cancel()
        last = nil
        var restorable = decision.items
        if decision.released {
            var back: [PipelineItem] = []
            for item in decision.items {
                if await env.outbox.sendBack(item) { back.append(item) }
            }
            restorable = back
        }
        for item in restorable {
            item.decision = nil
            item.decidedAt = nil
            if let prior = decision.prior[item.id] {
                item.stageRaw = prior.stage
                item.failedStageRaw = prior.failed
            }
        }
        try? context.save()
        refresh()
        return decision.side
    }

    /// Ends the undo window now: the held decision goes to the outbox. Called by the next
    /// decision, the 10-second timer, and leaving the Sort tab or the app.
    func releaseHeld() {
        guard var decision = last, !decision.released else { return }
        holdTask?.cancel()
        holdTask = nil
        for item in decision.items {
            item.decision = decision.decision
            item.decidedAt = .now
            item.stage = .queued
        }
        decision.released = true
        last = decision
        try? context.save()
        let items = decision.items
        let outbox = env.outbox
        uploads.append(Task { [weak self] in
            for item in items { await outbox.enqueue(item) }
            try? self?.context.save()
            self?.refresh()
        })
        refresh()
    }

    /// Releases the held decision and waits for its uploads to be handed off (tests, background).
    func flush() async {
        releaseHeld()
        let running = uploads
        uploads.removeAll()
        for task in running { await task.value }
    }

    private func commit(_ items: [PipelineItem], _ decision: PipelineDecision) {
        releaseHeld()
        var prior: [UUID: (stage: String, failed: String?)] = [:]
        for item in items { prior[item.id] = (item.stageRaw, item.failedStageRaw) }
        last = DeckDecision(items: items, decision: decision, prior: prior)
        refresh()
        let hold = holdDuration
        holdTask = Task { [weak self] in
            try? await Task.sleep(for: hold)
            guard !Task.isCancelled else { return }
            self?.releaseHeld()
        }
    }

    // MARK: - Check fields (3.8)

    /// "Confirm and file": writes the chosen values into the card, marks them confident, saves a
    /// sender rule when asked (keyed by the confirmed issuer), then files the card.
    @discardableResult
    func confirmCheck(_ item: PipelineItem, values: [CardField: String], remember: Bool) async -> DeckOutcome {
        checking = nil
        guard var card = item.card else { return .unavailable }
        let fields = Set(checks(for: item).map(\.field)).union(values.keys)
        let oldDate = card.docDate
        for (field, value) in values { card.set(field, to: value) }
        if values[.filename] == nil { card.followDate(from: oldDate) }
        card.markConfident(fields)
        item.card = card
        try? context.save()
        if remember { await saveRule(for: card) }
        guard checks(for: item).isEmpty else { return .needsCheck }
        commit([item], .file)
        return .decided
    }

    /// Classify's check-fields sheet confirmed this card (it wrote the values, cleared the unsure
    /// fields and saved the sender rule): file it as if swiped right.
    @discardableResult
    func fileChecked(_ item: PipelineItem) -> DeckOutcome {
        checking = nil
        checkFocus = nil
        try? context.save()
        guard checks(for: item).isEmpty else { return .needsCheck }
        commit([item], .file)
        return .decided
    }

    // MARK: - Reconnect Drive (4.16)

    private(set) var reconnecting = false
    private(set) var reconnectFailed = false

    /// Only when the server says the refresh token is gone, never on a single failed request.
    var driveNeedsReconnect: Bool { env.auth.drive == .needsReconnect }

    func reconnectDrive() async {
        reconnecting = true
        reconnectFailed = false
        do { try await env.auth.reconnectDrive() } catch { reconnectFailed = true }
        reconnecting = false
    }

    func cancelCheck() {
        checking = nil
        checkFocus = nil
    }

    /// Tap an unsure row on the card: open the sheet at that field.
    func openCheck(_ item: PipelineItem, at field: CardField) {
        checkFocus = field
        checking = item
    }

    // MARK: - Card detail (4.13)

    /// "Done" in card detail: saves the edits, edited fields count as confident. A card that
    /// failed to read gets its first card this way ("Fill it in yourself") and joins the deck.
    func saveEdits(_ item: PipelineItem, card edited: DocumentCard, remember: Bool) async {
        let original = item.card
        var card = edited
        if let original, original.filename == card.filename { card.followDate(from: original.docDate) }
        let changed = CardField.allCases.filter { original?.value(of: $0) != card.value(of: $0) }
        card.markConfident(Set(changed))
        if original == nil, card.confidence == nil {
            card.confidence = CardConfidence(overall: 1, fields: [:])
        }
        item.card = card
        if isReadFailed(item) {
            item.failedStageRaw = nil
            item.errorMessage = nil
            item.stage = .ready
        }
        try? context.save()
        if remember { await saveRule(for: card) }
        refresh()
    }

    /// Whether the detail's "Remember for this sender" toggle shows: Folder, Verdict or Filename changed.
    func filingChanged(from original: DocumentCard?, to edited: DocumentCard) -> Bool {
        [.folder, .verdict, .filename].contains { original?.value(of: $0) != edited.value(of: $0) }
    }

    /// A blank card for "Fill it in yourself" on a card that failed to read.
    func blankCard(for item: PipelineItem) -> DocumentCard {
        item.card ?? DocumentCard(
            title: "", docType: "", issuer: "", docDate: "", summary: "", folder: ArchiveFolder.fallback,
            filename: "", verdict: .scanShred, verdictReason: "", retention: "", sensitive: false,
            paperless: PaperlessHint(possible: false, issuer: "", how: ""), confidence: nil, appliedRule: nil)
    }

    /// "Try again" on a card that failed to read.
    func retryRead(_ item: PipelineItem) async {
        guard isReadFailed(item) else { return }
        item.failedStageRaw = nil
        item.errorMessage = nil
        item.stage = .captured
        refresh()
        await reader.read([item])
        try? context.save()
        refresh()
    }

    private func saveRule(for card: DocumentCard) async {
        guard !card.issuer.isEmpty else { return }
        let rule = SenderRule(
            key: slug(card.issuer), issuer: card.issuer, folder: card.folder,
            filenamePattern: card.filenamePattern, verdict: card.verdict,
            docType: card.docType.isEmpty ? nil : card.docType,
            updatedAt: ISO8601DateFormatter().string(from: .now))
        try? await env.docs.saveSenderRule(rule)
    }

    // MARK: - Files and pages

    func fileURL(for item: PipelineItem) -> URL { env.files.url(for: item.fileName) }

    @ObservationIgnored private var thumbnails: [UUID: CGImage] = [:]

    /// First page for the card's scan well, rendered off the main actor and cached.
    func thumbnail(for item: PipelineItem) async -> CGImage? {
        if let cached = thumbnails[item.id] { return cached }
        let url = item.thumbnailName.map(env.files.url(for:))
        let pdf = fileURL(for: item)
        let image = await PageRenderer.firstPage(thumbnail: url, pdf: pdf, maxPixels: 900)
        if let image { thumbnails[item.id] = image }
        return image
    }

    /// Every page for the card detail's page viewer.
    func pages(for item: PipelineItem) async -> [CGImage] {
        await PageRenderer.pages(pdf: fileURL(for: item), maxPixels: 1400)
    }

    // MARK: - VoiceOver copy (section 6)

    func accessibilityLabel(for item: PipelineItem) -> String {
        guard let card = item.card, !isReadFailed(item) else {
            return "Couldn't read this one. Claude didn't answer. Your scan is saved."
        }
        var parts = ["\(card.title).", "\(card.issuer), \(DeckFormat.date(card.docDate) ?? "No date").",
                     "\(card.verdict.stamp).", "Folder \(DeckFormat.folderName(card.folder))."]
        if card.sensitive { parts.append("Sensitive.") }
        if !card.retention.isEmpty { parts.append("\(card.retention).") }
        let unsure = unsureFields(item)
        if !unsure.isEmpty {
            let names = unsure.map { DeckFormat.fieldName($0, docType: card.docType).lowercased() }
            parts.append("\(unsure.count) \(unsure.count == 1 ? "field" : "fields") to check: \(names.joined(separator: ", ")).")
        }
        return parts.joined(separator: " ")
    }

    /// Announced after a decision: "Filed {title}. Next: {next}." / "Shredded {title}." / "All sorted."
    func announcement(after side: DeckSide, title: String) -> String {
        guard let next = top else { return "All sorted." }
        switch side {
        case .file: return "Filed \(title). Next: \(next.card?.title ?? "a card that couldn't be read")."
        case .shred: return "Shredded \(title)."
        }
    }
}

extension DocumentCard {
    /// Marks these fields fully confident (the user confirmed or edited them).
    nonisolated mutating func markConfident(_ fields: Set<CardField>) {
        guard !fields.isEmpty else { return }
        var confidence = self.confidence ?? CardConfidence(overall: 0, fields: [:])
        for field in fields { confidence.fields[field.rawValue] = 1 }
        self.confidence = confidence
    }

    /// When the date changes and the filename still starts with the old date, move the prefix
    /// with it ("2024-01-08_blue-cross-eob" becomes "2024-01-09_blue-cross-eob").
    nonisolated mutating func followDate(from oldDate: String) {
        guard !oldDate.isEmpty, oldDate != docDate, !docDate.isEmpty, filename.hasPrefix(oldDate) else { return }
        filename = docDate + filename.dropFirst(oldDate.count)
    }

    /// The filename with its date prefix turned into the {date} token, for a sender rule.
    nonisolated var filenamePattern: String? {
        guard !filename.isEmpty else { return nil }
        if !docDate.isEmpty, filename.hasPrefix(docDate) {
            return "{date}" + filename.dropFirst(docDate.count)
        }
        return filename
    }
}
