// Owner: scaffold. Any agent may add samples; keep the existing ones stable, tests rely on them.
//
// Made-up documents for the fakes, previews, tests and the simulator's sample deck.
import Foundation

enum SampleData {
    /// Plain text for each sample's page, used to draw the sample PDFs and as their OCR text.
    static let pageTexts: [String] = [
        "Duke Energy\nElectric bill\nStatement date March 12, 2024\nAccount ending 4417\nAmount due $142.17",
        "Blue Cross\nExplanation of benefits\nClaim date January 8, 2024\nThis is not a bill",
        "North Carolina\nCertificate of title\nVehicle 2019 Honda Civic\nIssued June 3, 2019",
        "Big Box Furniture\nLimited time offer\n40% off sofas this weekend only",
    ]

    static let cards: [DocumentCard] = [
        DocumentCard(
            title: "Duke Energy bill, March 2024", docType: "Utility bill", issuer: "Duke Energy",
            docDate: "2024-03-12", summary: "Electric bill for account ending 4417, $142.17 due.",
            folder: "06 Home", filename: "2024-03-12_duke-energy-electric-bill", verdict: .scanShred,
            verdictReason: "Routine bill worth a record for a year.", retention: "Keep 1 year",
            sensitive: false,
            paperless: PaperlessHint(possible: true, issuer: "Duke Energy", how: "Turn on paperless billing under Account, then Billing preferences."),
            confidence: CardConfidence(overall: 0.94, fields: ["title": 0.97, "folder": 0.95, "verdict": 0.92, "docDate": 0.99]),
            appliedRule: nil),
        DocumentCard(
            title: "Blue Cross EOB, January 2024", docType: "Explanation of benefits", issuer: "Blue Cross",
            docDate: "2024-01-08", summary: "Explanation of benefits for a January visit, nothing owed.",
            folder: "05 Medical", filename: "2024-01-08_blue-cross-eob", verdict: .scanShred,
            verdictReason: "Medical record worth keeping digitally.", retention: "Keep 3 years",
            sensitive: true,
            paperless: PaperlessHint(possible: true, issuer: "Blue Cross", how: "Choose electronic EOBs in the member portal."),
            confidence: CardConfidence(overall: 0.62, fields: ["title": 0.9, "folder": 0.88, "verdict": 0.55, "docDate": 0.6]),
            appliedRule: nil,
            alternatives: ["docDate": ["2024-01-15"]]),
        DocumentCard(
            title: "Honda Civic title", docType: "Vehicle title", issuer: "NC DMV",
            docDate: "2019-06-03", summary: "Certificate of title for a 2019 Honda Civic.",
            folder: "07 Auto", filename: "2019-06-03_nc-dmv-honda-civic-title", verdict: .keepOriginal,
            verdictReason: "A vehicle title has legal value on paper.", retention: "Until you sell the car",
            sensitive: false,
            paperless: PaperlessHint(possible: false, issuer: "NC DMV", how: ""),
            confidence: CardConfidence(overall: 0.97, fields: [:]),
            appliedRule: nil),
        DocumentCard(
            title: "Furniture sale flyer", docType: "Advertisement", issuer: "Big Box Furniture",
            docDate: "", summary: "A weekend sofa sale ad.",
            folder: "11 Other", filename: "0000-00-00_big-box-furniture-flyer", verdict: .shred,
            verdictReason: "Junk mail with nothing worth keeping.", retention: "Not needed",
            sensitive: false,
            paperless: PaperlessHint(possible: false, issuer: "Big Box Furniture", how: ""),
            confidence: CardConfidence(overall: 0.99, fields: [:]),
            appliedRule: nil),
    ]

    /// The design spec's A2 card (classify): sender and statement date unsure, with Claude's other
    /// guesses. Not on the sample deck, so the deck's counts stay the same.
    static let cascadeBill = DocumentCard(
        title: "Electric bill, September", docType: "Utility bill", issuer: "Cascade Power & Light",
        docDate: "2026-09-28", summary: "Electric bill, $96.40 due Oct 18 on account ending 0412.",
        folder: "06 Home", filename: "2026-09-28_cascade-power-electric-bill", verdict: .scanShred,
        verdictReason: "Routine bill worth a record for a year.", retention: "Keep 1 year", sensitive: false,
        paperless: PaperlessHint(possible: true, issuer: "Cascade Power & Light", how: "Account settings, then Billing, then Paper bill off."),
        confidence: CardConfidence(overall: 0.58, fields: ["issuer": 0.62, "docDate": 0.58, "folder": 0.9, "title": 0.95, "filename": 0.88, "verdict": 0.93]),
        appliedRule: nil,
        alternatives: ["issuer": ["Cascade Natural Gas"], "docDate": ["2026-10-03"], "folder": ["03 Money & Banking"], "title": [], "filename": []])

    /// Sender rules for previews and the sample Settings list (classify).
    static let senderRules: [SenderRule] = [
        SenderRule(key: "duke-energy", issuer: "Duke Energy", folder: "06 Home", filenamePattern: "{date}_duke-energy-electric-bill",
                   verdict: .scanShred, docType: "Utility bill", updatedAt: "2026-10-09T15:04:00.000Z"),
        SenderRule(key: "harbor-federal-cu", issuer: "Harbor Federal CU", folder: "02 Taxes", filenamePattern: "{yyyy}_harbor-federal-1099-int",
                   verdict: .scanShred, docType: "1099-INT", updatedAt: "2026-10-02T10:00:00.000Z"),
        SenderRule(key: "big-box-furniture", issuer: "Big Box Furniture", folder: "11 Other", filenamePattern: nil,
                   verdict: .shred, docType: "Advertisement", updatedAt: "2026-09-21T18:30:00.000Z"),
    ]

    /// A card for an OCR text, matched by the first line, or the first sample.
    static func card(forText text: String?) -> DocumentCard {
        guard let first = text?.split(separator: "\n").first.map(String.init),
              let index = pageTexts.firstIndex(where: { $0.hasPrefix(first) }) else { return cards[0] }
        return cards[index]
    }

    static func filedDocs() -> [FiledDoc] {
        cards.enumerated().map { index, card in
            FiledDoc(
                id: "sample-\(index)",
                title: card.title, docType: card.docType, issuer: card.issuer, docDate: card.docDate,
                summary: card.summary, folder: card.folder, filename: card.filename, verdict: card.verdict,
                verdictReason: card.verdictReason, retention: card.retention, sensitive: card.sensitive,
                paperless: card.paperless, pages: 1, filed: card.verdict != .shred,
                driveId: card.verdict == .shred ? "" : "drive-\(index)",
                driveUrl: card.verdict == .shred ? "" : "https://drive.google.com/file/d/drive-\(index)/view",
                physical: card.verdict == .keepOriginal ? .keep : .toShred,
                filedAt: "2026-10-1\(index)T12:00:00.000Z", source: "ios")
        }
    }
}
