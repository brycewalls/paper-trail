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

/// Per-field confidence from 0 to 1 (#20). Optional: the function sends it only when the request
/// sets wantConfidence, and a card without it is never counted as confident.
nonisolated struct CardConfidence: Codable, Sendable, Hashable {
    /// The lowest field score (the function computes it that way).
    var overall: Double
    /// Keyed by DocumentCard field name: "title", "folder", "filename", "verdict", "docDate", "issuer".
    /// Since #75 the function sends only the fields Claude wasn't sure of (`sparse`); a field that
    /// isn't here counts as sure (`score(_:)`).
    var fields: [String: Double]
    /// New, optional (#75): true when `fields` lists only the fields Claude wasn't sure of. Missing
    /// means sure either way, so older replies (every field scored) read the same.
    var sparse: Bool? = nil

    /// The score a field without one gets: sure.
    static let assumedSure = 1.0

    /// Kept for source compatibility. A card is confident when it has confidence data and no field
    /// is below `fieldUnsureBelow` (DocumentCard.isConfident), so the deck's "ready to file" count
    /// and the "2 to check" pill can never disagree.
    static let confidentThreshold = 0.75
    /// A field below this is "Not sure" and goes in the check-fields sheet (design spec 0, 3.8).
    static let fieldUnsureBelow = 0.75
    /// The scored fields, in the order the check-fields sheet shows them: sender, date, folder,
    /// title, filename, verdict.
    static let fieldOrder = ["issuer", "docDate", "folder", "title", "filename", "verdict"]

    /// The fields below `fieldUnsureBelow`, in `fieldOrder`. A field the function didn't score
    /// isn't flagged.
    var unsureFields: [String] {
        Self.fieldOrder.filter { score($0) < Self.fieldUnsureBelow }
    }

    /// A field's score; one the function didn't list counts as sure (#75).
    func score(_ field: String) -> Double { fields[field] ?? Self.assumedSure }

    /// The lowest field score, the way the function computes `overall`.
    var lowestScore: Double { Self.fieldOrder.map(score).min() ?? Self.assumedSure }
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
    /// New, optional (#20): up to two other guesses per field, best first, keyed like
    /// `confidence.fields` ("issuer", "docDate", "folder", "title", "filename"). Sent with confidence.
    var alternatives: [String: [String]]? = nil

    /// Ready to file without a look: confidence came back and no field is "Not sure" (design spec
    /// 3.1). A card without confidence data is never confident.
    var isConfident: Bool {
        guard let confidence else { return false }
        return confidence.unsureFields.isEmpty
    }
}
