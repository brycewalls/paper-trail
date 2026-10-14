// Owner: piles. Logic only, no SwiftUI. Date parsing and the display strings Piles, Search and
// Paperless share (folder names, breadcrumbs, short dates).
import Foundation

nonisolated enum PileFormat {
    /// Parses the ISO 8601 strings the web app and the outbox write, with or without milliseconds.
    static func date(iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    /// A card's docDate ("YYYY-MM-DD"), read as a local calendar day.
    static func date(docDate: String) -> Date? {
        let parts = docDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, parts[0] > 0, parts[1] > 0, parts[2] > 0 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// "02 Taxes" shows as "Taxes".
    static func folderName(_ folder: String) -> String {
        let parts = folder.split(separator: " ", maxSplits: 1)
        if parts.count == 2, parts[0].count == 2, Int(parts[0]) != nil { return String(parts[1]) }
        return folder
    }

    /// The folders that get year subfolders in Drive (Bryce's decision 2 in the design spec).
    static let yearFolders: Set<String> = ["02 Taxes", "03 Money & Banking", "05 Medical"]

    /// The document's year: docDate first, then the filing date.
    static func year(of doc: FiledDoc) -> Int? {
        if let date = date(docDate: doc.docDate) { return Calendar.current.component(.year, from: date) }
        if let filed = date(iso: doc.filedAt) { return Calendar.current.component(.year, from: filed) }
        return nil
    }

    /// "Taxes › 2025" for the three year folders, otherwise just "Home".
    static func breadcrumb(for doc: FiledDoc) -> String {
        let name = folderName(doc.folder)
        guard yearFolders.contains(doc.folder), let year = year(of: doc) else { return name }
        return "\(name) › \(year)"
    }

    /// "Oct 9", with the year added when it isn't this year: "Oct 9, 2024".
    static func shortDay(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return date.formatted(.dateTime.month(.abbreviated).day())
        }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// "October 2026".
    static func monthTitle(_ date: Date) -> String {
        date.formatted(.dateTime.month(.wide).year())
    }

    /// Whole calendar days from `now` until `date` (0 when it is today or already past).
    static func daysUntil(_ date: Date, now: Date) -> Int {
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now),
                                           to: calendar.startOfDay(for: date)).day ?? 0
        return max(0, days)
    }

    /// "1 day" / "3 days".
    static func days(_ n: Int) -> String { n == 1 ? "1 day" : "\(n) days" }
}
