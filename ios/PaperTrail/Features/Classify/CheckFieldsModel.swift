// Owner: classify. Logic only: no SwiftUI here, so CheckFieldsSheet can change without touching it.
//
// The check-fields sheet's state (design spec 3.8, A2, #20, #21). One section per unsure field with
// Claude's best value ("likely"), its other guesses ("possible") and a way to give another value.
// confirm() writes the chosen values into the card, marks them confident, saves a sender rule when
// "Remember for this sender" is on, and hands the item back for the deck to file as a swipe right.
import Foundation

@Observable
final class CheckFieldsModel {
    enum Likelihood: String, Sendable { case likely, possible }

    struct Option: Hashable, Identifiable, Sendable {
        var value: String
        var likelihood: Likelihood
        var id: String { value }
    }

    let item: PipelineItem
    private let docs: any DocStore
    private let original: DocumentCard

    /// The unsure fields, in sheet order: issuer, docDate, folder, title, filename, verdict.
    let fields: [String]
    /// The value picked per field (verdict uses its raw value).
    private(set) var selection: [String: String] = [:]
    /// Fields switched to "Something else", and what was typed there.
    private(set) var customFields: Set<String> = []
    var customText: [String: String] = [:]
    /// A date picked with "Pick a date", shown as an extra chip.
    private(set) var pickedDate: String?
    /// A folder picked from "Choose another folder", shown as an extra row when it isn't a guess.
    private(set) var pickedFolder: String?
    var remember = true
    private(set) var ruleSaveFailed = false

    init(item: PipelineItem, docs: any DocStore) {
        self.item = item
        self.docs = docs
        let card = item.card ?? DocumentCard.blank
        original = card
        let unsure = item.unsureFields.isEmpty ? (card.confidence?.unsureFields ?? []) : item.unsureFields
        fields = CardConfidence.fieldOrder.filter(unsure.contains)
        for field in fields { selection[field] = Self.value(of: field, in: card) }
    }

    // MARK: Copy

    var title: String { fields.count == 1 ? "Check 1 field" : "Check \(fields.count) fields" }
    let subtitle = "Everything else looks right."

    /// Section label; Section shows it in caps. The date uses the document type when Claude knows it.
    func label(for field: String) -> String {
        switch field {
        case "issuer": "Sender"
        case "docDate":
            Self.dateLabel(docType: currentValue("docType"))
        case "folder": "Folder"
        case "title": "Title"
        case "filename": "Filename"
        case "verdict": "Verdict"
        default: field
        }
    }

    /// "Statement date" for a statement or bill, "Invoice date", "Receipt date"; otherwise "Date".
    static func dateLabel(docType: String) -> String {
        let type = docType.lowercased()
        if type.contains("statement") || type.contains("bill") { return "Statement date" }
        for word in ["invoice", "receipt", "notice", "letter", "policy", "claim"] where type.contains(word) {
            return word.prefix(1).uppercased() + word.dropFirst() + " date"
        }
        return "Date"
    }

    var rememberFooter: String {
        let issuer = currentValue("issuer")
        return "Next time, \(issuer.isEmpty ? "this sender" : issuer) files this way without asking."
    }

    let confirmTitle = "Confirm and file"

    // MARK: Options

    /// Claude's value first ("likely"), then its other guesses ("possible").
    func options(for field: String) -> [Option] {
        let best = Self.value(of: field, in: original)
        var out = best.isEmpty ? [] : [Option(value: best, likelihood: .likely)]
        for value in original.alternatives?[field] ?? [] where !value.isEmpty && !out.contains(where: { $0.value == value }) {
            out.append(Option(value: value, likelihood: .possible))
        }
        if field == "docDate", let pickedDate, !out.contains(where: { $0.value == pickedDate }) {
            out.append(Option(value: pickedDate, likelihood: .possible))
        }
        if field == "folder", let pickedFolder, !out.contains(where: { $0.value == pickedFolder }) {
            out.append(Option(value: pickedFolder, likelihood: .possible))
        }
        return out
    }

    func isSelected(_ option: Option, for field: String) -> Bool {
        !customFields.contains(field) && selection[field] == option.value
    }

    func isCustom(_ field: String) -> Bool { customFields.contains(field) }

    func select(_ value: String, for field: String) {
        selection[field] = value
        customFields.remove(field)
    }

    /// "Something else": the row turns into a text field in place.
    func chooseCustom(_ field: String) {
        customFields.insert(field)
        if customText[field] == nil { customText[field] = "" }
    }

    func pickDate(_ date: Date) {
        let value = Self.isoDay(date)
        pickedDate = value
        select(value, for: "docDate")
    }

    func pickFolder(_ folder: String) {
        pickedFolder = folder
        select(folder, for: "folder")
    }

    var verdict: Verdict {
        get { Verdict(rawValue: selection["verdict"] ?? "") ?? original.verdict }
        set { selection["verdict"] = newValue.rawValue }
    }

    /// The value a field will be confirmed with. A blank "Something else" keeps Claude's value.
    func currentValue(_ field: String) -> String {
        if customFields.contains(field) {
            let typed = (customText[field] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !typed.isEmpty { return typed }
        } else if let picked = selection[field] {
            return picked
        }
        return Self.value(of: field, in: original)
    }

    // MARK: Confirm

    /// The card with the chosen values. When the date changes and the filename still carries the
    /// old date, the filename follows it.
    func confirmedCard() -> DocumentCard {
        var card = original
        card.issuer = currentValue("issuer")
        card.docDate = Self.cleanDate(currentValue("docDate")) ?? original.docDate
        card.folder = ArchiveFolder.all.contains(currentValue("folder")) ? currentValue("folder") : original.folder
        card.title = currentValue("title")
        card.verdict = verdict
        let typedFilename = fields.contains("filename") && currentValue("filename") != original.filename
        card.filename = SenderRuleEngine.cleanName(currentValue("filename"))
        if !typedFilename, card.docDate != original.docDate {
            let old = original.docDate.isEmpty ? "0000-00-00" : original.docDate
            card.filename = card.filename.replacingOccurrences(of: old, with: card.docDate.isEmpty ? "0000-00-00" : card.docDate)
        }
        if card.paperless.issuer == original.issuer { card.paperless.issuer = card.issuer }
        if var confidence = card.confidence {
            for field in fields { confidence.fields[field] = 1 }
            confidence.overall = confidence.lowestScore
            card.confidence = confidence
        }
        if var alternatives = card.alternatives {
            for field in fields { alternatives[field] = nil }
            card.alternatives = alternatives
        }
        return card
    }

    /// Writes the card into the item, clears its unsure fields and saves the sender rule when
    /// Remember is on. A rule that fails to save never blocks filing.
    @discardableResult
    func confirm(now: Date = .now) async -> PipelineItem {
        let card = confirmedCard()
        item.card = card
        item.unsureFields = []
        if remember, slug(card.issuer) != "unknown" {
            do { try await docs.saveSenderRule(SenderRuleEngine.rule(from: card, now: now)) }
            catch { ruleSaveFailed = true }
        }
        return item
    }

    // MARK: Helpers

    static func value(of field: String, in card: DocumentCard) -> String {
        switch field {
        case "issuer": card.issuer
        case "docDate": card.docDate
        case "folder": card.folder
        case "title": card.title
        case "filename": card.filename
        case "verdict": card.verdict.rawValue
        case "docType": card.docType
        default: ""
        }
    }

    /// "Sep 28, 2026" for a YYYY-MM-DD value.
    static func displayDate(_ value: String) -> String {
        guard let date = dateFromISODay(value) else { return value.isEmpty ? "No date" : value }
        return date.formatted(.dateTime.month(.abbreviated).day().year().locale(Locale(identifier: "en_US")))
    }

    static func dateFromISODay(_ value: String) -> Date? {
        guard cleanDate(value) != nil else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = value.split(separator: "-").compactMap { Int($0) }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func isoDay(_ date: Date) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func cleanDate(_ value: String) -> String? {
        value.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil ? value : nil
    }
}

extension DocumentCard {
    /// A placeholder for a sheet opened on an item with no card (never shown in practice).
    nonisolated static let blank = DocumentCard(
        title: "", docType: "", issuer: "", docDate: "", summary: "", folder: ArchiveFolder.fallback,
        filename: "", verdict: .scanShred, verdictReason: "", retention: "", sensitive: false,
        paperless: PaperlessHint(possible: false, issuer: "", how: ""), confidence: nil, appliedRule: nil)
}
