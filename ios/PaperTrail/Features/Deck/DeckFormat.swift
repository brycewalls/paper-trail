// Owner: deck. Display strings for cards (docs/design-spec.md 3.1, 3.8, 4.13). Pure functions,
// no SwiftUI, so the copy is unit tested.
import Foundation

enum DeckFormat {
    /// Folders that get year subfolders, created on demand (Bryce's decision 2).
    static let yearFolders: Set<String> = ["02 Taxes", "03 Money & Banking", "05 Medical"]

    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func parse(_ ymd: String) -> Date? { ymd.isEmpty ? nil : isoDay.date(from: ymd) }
    static func ymd(_ date: Date) -> String { isoDay.string(from: date) }

    /// "Jan 30, 2026", or nil for an empty or unreadable date.
    static func date(_ ymd: String) -> String? {
        parse(ymd)?.formatted(date: .abbreviated, time: .omitted)
    }

    /// "{issuer} · {date}", or "{issuer} · No date".
    static func meta(_ card: DocumentCard) -> String {
        let issuer = card.issuer.isEmpty ? "Unknown sender" : card.issuer
        return "\(issuer) · \(date(card.docDate) ?? "No date")"
    }

    /// "02 Taxes" shows as "Taxes".
    static func folderName(_ folder: String) -> String {
        let parts = folder.split(separator: " ", maxSplits: 1)
        if parts.count == 2, parts[0].allSatisfy(\.isNumber) { return String(parts[1]) }
        return folder
    }

    /// The card's folder row: "Taxes › 2025" for the three year folders, else the display name.
    /// The year comes from docDate, falling back to the filing date (today).
    static func folderPath(_ card: DocumentCard, filingDate: Date = .now) -> String {
        let name = folderName(card.folder)
        guard yearFolders.contains(card.folder) else { return name }
        let year = card.docDate.count >= 4 && card.docDate.prefix(4).allSatisfy(\.isNumber)
            ? String(card.docDate.prefix(4))
            : String(Calendar(identifier: .gregorian).component(.year, from: filingDate))
        return "\(name) › \(year)"
    }

    static func pages(_ count: Int) -> String { count == 1 ? "1 page" : "\(count) pages" }

    /// Section label in the check-fields sheet. The date uses the document type when it's known.
    static func fieldName(_ field: CardField, docType: String) -> String {
        switch field {
        case .issuer: return "Sender"
        case .docDate:
            let type = docType.lowercased()
            if type.contains("bill") || type.contains("statement") { return "Statement date" }
            if type.contains("receipt") { return "Receipt date" }
            if type.contains("explanation of benefits") || type.contains("eob") { return "Claim date" }
            return "Date"
        case .folder: return "Folder"
        case .title: return "Title"
        case .filename: return "Filename"
        case .verdict: return "Verdict"
        }
    }

    /// How a field's raw value reads on the card and in the sheet.
    static func display(_ field: CardField, _ value: String) -> String {
        switch field {
        case .docDate: date(value) ?? "No date"
        case .folder: folderName(value)
        case .verdict: Verdict(rawValue: value)?.stamp ?? value
        case .filename: value + ".pdf"
        case .issuer, .title: value
        }
    }

    /// "Check 2 fields" / "Check 1 field".
    static func checkTitle(_ count: Int) -> String { count == 1 ? "Check 1 field" : "Check \(count) fields" }
}
