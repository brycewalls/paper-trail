// Owner: classify. Logic only.
//
// Sender rules (#21), the Swift twin of applySenderRule() and renderFilename() in functions/lib.js.
// The function applies the matching rule itself and sets `appliedRule`; the reading queue runs the
// same rule here when the reply has no `appliedRule` (the function deployed today ignores
// senderHints), so a remembered correction works against either version. Both sides must give the
// same answer for the same card and rule: functions/test/confidence-and-senders.test.mjs and
// PaperTrailTests/ClassifyTests.swift test the same cases.
import Foundation

nonisolated enum SenderRuleEngine {
    /// The pattern tokens, in the order the rule detail's suggestion chips show them (#27).
    static let tokens = ["{date}", "{yyyy}", "{mm}", "{issuer}", "{type}"]

    /// The rule whose key is the card's sender slug, if any.
    static func rule(for card: DocumentCard, in rules: [SenderRule]) -> SenderRule? {
        let key = slug(card.issuer)
        guard key != "unknown" else { return nil }
        return rules.first { $0.key == key }
    }

    /// Applies the matching rule the same way every time: the rule's spelling of the sender, then its
    /// folder, verdict, document type and filename pattern, each only if the rule has one. Fields the
    /// rule set become certain (confidence 1, no other guesses). Unchanged when no rule matches.
    static func apply(_ rules: [SenderRule], to card: DocumentCard) -> DocumentCard {
        guard let rule = rule(for: card, in: rules) else { return card }
        var out = card
        var set = ["issuer"]
        out.issuer = rule.issuer
        out.appliedRule = rule.key
        if let folder = rule.folder, ArchiveFolder.all.contains(folder) { out.folder = folder; set.append("folder") }
        if let verdict = rule.verdict { out.verdict = verdict; set.append("verdict") }
        if let type = rule.docType?.trimmingCharacters(in: .whitespaces), !type.isEmpty { out.docType = type }
        if let pattern = rule.filenamePattern, !pattern.isEmpty {
            let name = renderFilename(pattern, card: out)
            if !name.isEmpty { out.filename = name; set.append("filename") }
        }
        if slug(out.paperless.issuer) == rule.key { out.paperless.issuer = rule.issuer }
        if var confidence = out.confidence {
            for field in set { confidence.fields[field] = 1 }
            confidence.overall = CardConfidence.fieldOrder.map { confidence.fields[$0] ?? 0 }.min() ?? 0
            out.confidence = confidence
        }
        if var alternatives = out.alternatives {
            for field in set where alternatives[field] != nil { alternatives[field] = [] }
            out.alternatives = alternatives
        }
        return out
    }

    /// Fills a pattern's tokens from the card. {date} is the docDate (0000-00-00 when there is none),
    /// {yyyy} and {mm} its parts, {issuer} and {type} the slugs of the sender and document type.
    static func renderFilename(_ pattern: String, card: DocumentCard) -> String {
        let date = card.docDate.isEmpty ? "0000-00-00" : card.docDate
        let filled = pattern
            .replacingOccurrences(of: "{date}", with: date)
            .replacingOccurrences(of: "{yyyy}", with: String(date.prefix(4)))
            .replacingOccurrences(of: "{mm}", with: String(date.dropFirst(5).prefix(2)))
            .replacingOccurrences(of: "{issuer}", with: slug(card.issuer))
            .replacingOccurrences(of: "{type}", with: slug(card.docType))
        return String(cleanName(filled).prefix(120))
    }

    /// The pattern a confirmed filename implies: its docDate becomes {date}, so next month's bill
    /// from the same sender gets next month's date. A filename without the date is kept as is.
    static func pattern(fromFilename filename: String, docDate: String) -> String {
        let name = cleanName(filename)
        guard !docDate.isEmpty, name.contains(docDate) else { return name }
        return name.replacingOccurrences(of: docDate, with: "{date}")
    }

    /// The rule a confirmed card implies, keyed by its sender.
    static func rule(from card: DocumentCard, now: Date = .now) -> SenderRule {
        SenderRule(key: slug(card.issuer), issuer: card.issuer, folder: card.folder,
                   filenamePattern: pattern(fromFilename: card.filename, docDate: card.docDate),
                   verdict: card.verdict, docType: card.docType.isEmpty ? nil : card.docType,
                   updatedAt: isoString(now))
    }

    /// functions/lib.js cleanName(): trims, drops a trailing .pdf, and turns path characters into hyphens.
    static func cleanName(_ s: String) -> String {
        var name = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.lowercased().hasSuffix(".pdf") { name = String(name.dropLast(4)) }
        let bad = CharacterSet(charactersIn: "/\\:*?\"<>|")
        return String(name.unicodeScalars.map { bad.contains($0) ? "-" : Character($0) })
    }

    /// "02 Taxes" shows as "Taxes" (design spec 3.1).
    static func folderName(_ folder: String) -> String {
        guard let space = folder.firstIndex(of: " "), folder[..<space].allSatisfy(\.isNumber) else { return folder }
        return String(folder[folder.index(after: space)...])
    }

    /// "2026-10-13T12:00:00.000Z", the shape the web app's toISOString() writes.
    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func date(fromISO string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }
}
