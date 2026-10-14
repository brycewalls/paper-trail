// Owner: scaffold (shared contract). Changes need a note in ARCHITECTURE.md and the PR body.
//
// The filing card Claude returns for one document: the `result` object of the `classify`
// callable (functions/lib.js, normalize()). Field names match the JSON exactly, so the same
// struct decodes the function's reply and the web app's Firestore records.
import Foundation

/// The three stamps. Raw values are the strings the function and Firestore use.
nonisolated enum Verdict: String, Codable, CaseIterable, Sendable, Hashable {
    case shred
    case scanShred = "scan_shred"
    case keepOriginal = "keep_original"

    /// The stamp text, same as the web app's VERDICT map.
    var stamp: String {
        switch self {
        case .shred: "Shred"
        case .scanShred: "Scan + shred"
        case .keepOriginal: "Keep original"
        }
    }

    /// What the paper should do after filing.
    var label: String {
        switch self {
        case .shred: "Shred it"
        case .scanShred: "Scan, then shred"
        case .keepOriginal: "Keep the paper"
        }
    }
}

/// The 11 numbered Drive folders under "Paperwork Archive". Must match FOLDER_NAMES in functions/lib.js.
nonisolated enum ArchiveFolder {
    static let all: [String] = [
        "01 Identity & Legal",
        "02 Taxes",
        "03 Money & Banking",
        "04 Insurance",
        "05 Medical",
        "06 Home",
        "07 Auto",
        "08 Work & Income",
        "09 Warranties & Manuals",
        "10 Personal & Sentimental",
        "11 Other",
    ]
    static let fallback = "11 Other"
    static let rootName = "Paperwork Archive"
}

nonisolated struct PaperlessHint: Codable, Sendable, Hashable {
    var possible: Bool
    var issuer: String
    var how: String
}

/// Per-field confidence from 0 to 1 (#20). Optional: the live function does not send it yet,
/// and a card without it is treated as "needs a look" for every field.
nonisolated struct CardConfidence: Codable, Sendable, Hashable {
    /// Overall confidence for the card as a whole.
    var overall: Double
    /// Keyed by DocumentCard field name: "title", "folder", "filename", "verdict", "docDate", "issuer".
    var fields: [String: Double]

    /// A card at or above this overall score can be filed by "File all confident".
    static let confidentThreshold = 0.85
}

nonisolated struct DocumentCard: Codable, Sendable, Hashable {
    var title: String
    var docType: String
    var issuer: String
    /// YYYY-MM-DD or empty.
    var docDate: String
    var summary: String
    /// One of ArchiveFolder.all.
    var folder: String
    /// No extension. The Drive file is `filename + ".pdf"`.
    var filename: String
    var verdict: Verdict
    var verdictReason: String
    var retention: String
    var sensitive: Bool
    var paperless: PaperlessHint
    /// New, optional (#20).
    var confidence: CardConfidence?
    /// New, optional (#21): the key of the sender rule the function applied, if any.
    var appliedRule: String?

    var isConfident: Bool {
        guard let confidence else { return false }
        return confidence.overall >= CardConfidence.confidentThreshold
    }
}
