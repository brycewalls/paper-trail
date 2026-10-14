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
            appliedRule: nil),
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
