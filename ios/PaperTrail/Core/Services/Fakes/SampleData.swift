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

    /// A scanned pile for stack mode (#19): the four samples, with second pages on the first two,
    /// back to back. Each page's first line is its letterhead, which the fake split goes by.
    static let stackPageTexts: [String] = [
        pageTexts[0],
        "Duke Energy\nPage 2 of 2\nUsage history\nAccount ending 4417",
        pageTexts[1],
        "Blue Cross\nPage 2 of 2\nClaim details\nThis is not a bill",
        pageTexts[2],
        pageTexts[3],
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

    // MARK: - Piles, Search and Paperless samples (owner: piles)

    /// ISO 8601 with milliseconds, the way the web app writes dates.
    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    private static func daysAgo(_ days: Double, from now: Date) -> String {
        iso(now.addingTimeInterval(-days * 86_400))
    }

    private static func doc(_ id: String, _ title: String, type: String, issuer: String, date: String,
                            folder: String, verdict: Verdict, physical: PhysicalState, sensitive: Bool = false,
                            filedAt: String, verifiedAt: String?, retention: String = "Keep 7 years",
                            text: String? = nil, amount: String? = nil, paperless: Bool = false) -> FiledDoc {
        FiledDoc(
            id: id, title: title, docType: type, issuer: issuer, docDate: date,
            summary: "\(type) from \(issuer).", folder: folder,
            filename: "\(date.isEmpty ? "0000-00-00" : date)_\(slug(issuer))-\(slug(type))", verdict: verdict,
            verdictReason: verdict == .keepOriginal ? "The paper itself has legal value." : "Drive keeps a good copy.",
            retention: retention, sensitive: sensitive,
            paperless: PaperlessHint(possible: paperless, issuer: issuer, how: paperless ? "Turn off paper statements in your account." : ""),
            pages: 1, filed: true, driveId: "drive-\(id)", driveUrl: "https://drive.google.com/file/d/drive-\(id)/view",
            physical: physical, filedAt: filedAt, verifiedAt: verifiedAt, source: "ios").with(text: text, amount: amount)
    }

    /// Extra filed documents so Piles, Search and Paperless look like A5 to A7 in sample mode.
    /// Dates are relative to `now` so the hold countdown and the safe pile stay meaningful.
    static func pileDocs(now: Date = .now) -> [FiledDoc] {
        [
            doc("pile-pharmacy", "Pharmacy receipt", type: "Receipt", issuer: "Elm Street Pharmacy", date: "2026-08-12",
                folder: "05 Medical", verdict: .scanShred, physical: .toShred, sensitive: true,
                filedAt: daysAgo(6, from: now), verifiedAt: daysAgo(6, from: now), retention: "Keep for HSA, 3 years",
                text: "Elm Street Pharmacy\nReceipt\nAmoxicillin 500 mg\nTotal $12.40", amount: "12.40"),
            doc("pile-1099", "2024 1099-INT", type: "Tax form", issuer: "Harbor Federal CU", date: "2025-01-31",
                folder: "02 Taxes", verdict: .scanShred, physical: .toShred, sensitive: true,
                filedAt: daysAgo(5, from: now), verifiedAt: daysAgo(5, from: now),
                text: "Form 1099-INT Interest Income 2024\nHarbor Federal Credit Union\nBox 1 interest income $38.12"),
            doc("pile-electric-aug", "Electric bill, August", type: "Bill", issuer: "Cascade Power & Light", date: "2026-08-28",
                folder: "06 Home", verdict: .scanShred, physical: .toShred,
                filedAt: daysAgo(30, from: now), verifiedAt: daysAgo(30, from: now), retention: "Keep 1 year",
                text: "Cascade Power & Light\nStatement date August 28, 2026\nAmount due $84.12", amount: "84.12", paperless: true),
            doc("pile-electric-oct", "Electric bill, October", type: "Bill", issuer: "Cascade Power & Light", date: "2026-10-09",
                folder: "06 Home", verdict: .scanShred, physical: .toShred,
                filedAt: daysAgo(4, from: now), verifiedAt: daysAgo(4, from: now), retention: "Keep 1 year",
                text: "Cascade Power & Light\nStatement date October 9, 2026\nAmount due $91.03", amount: "91.03", paperless: true),
            doc("pile-brightline", "Brightline Wireless bill", type: "Bill", issuer: "Brightline Wireless", date: "2026-09-15",
                folder: "03 Money & Banking", verdict: .scanShred, physical: .toShred,
                filedAt: daysAgo(5, from: now), verifiedAt: daysAgo(5, from: now), retention: "Keep 1 year",
                text: "Brightline Wireless\nMonthly statement\nAmount due $65.00", amount: "65.00", paperless: true),
            doc("pile-summit", "Summit Health Plan EOB", type: "Explanation of benefits", issuer: "Summit Health Plan",
                date: "2026-09-02", folder: "05 Medical", verdict: .scanShred, physical: .toShred, sensitive: true,
                filedAt: daysAgo(8, from: now), verifiedAt: daysAgo(8, from: now), retention: "Keep 3 years"),
            doc("pile-w2-2025", "2025 W-2", type: "Tax form", issuer: "Northwind Logistics", date: "2026-01-30",
                folder: "02 Taxes", verdict: .scanShred, physical: .toShred, sensitive: true,
                filedAt: daysAgo(1, from: now), verifiedAt: daysAgo(1, from: now),
                text: "Form W-2 Wage and Tax Statement 2025\nNorthwind Logistics\nBox 1 wages $58,200.00"),
            doc("pile-w2-2023", "2023 W-2", type: "Tax form", issuer: "Northwind Logistics", date: "2024-01-29",
                folder: "02 Taxes", verdict: .scanShred, physical: .shredded, sensitive: true,
                filedAt: "2024-02-03T15:20:00.000Z", verifiedAt: "2024-02-03T15:21:00.000Z",
                text: "Copy B. Form W-2 Wage and Tax Statement 2023. Employer Northwind Logistics. Box 1 wages, tips, other compensation $54,880.00"),
            doc("pile-w2-2023c", "2023 W-2, corrected", type: "Tax form", issuer: "Northwind Logistics", date: "2024-03-02",
                folder: "02 Taxes", verdict: .scanShred, physical: .shredded, sensitive: true,
                filedAt: "2024-03-05T15:20:00.000Z", verifiedAt: "2024-03-05T15:21:00.000Z",
                text: "Form W-2c Corrected Wage and Tax Statement 2023. Northwind Logistics."),
            doc("pile-1099-2023", "2023 1099-INT", type: "Tax form", issuer: "Harbor Federal CU", date: "2024-01-31",
                folder: "02 Taxes", verdict: .scanShred, physical: .shredded,
                filedAt: "2024-02-04T15:20:00.000Z", verifiedAt: "2024-02-04T15:21:00.000Z",
                text: "Form 1099-INT Interest Income 2023. Harbor Federal Credit Union."),
            doc("pile-birth", "Birth certificate", type: "Certificate", issuer: "Wake County", date: "1994-05-02",
                folder: "01 Identity & Legal", verdict: .keepOriginal, physical: .stored, sensitive: true,
                filedAt: daysAgo(20, from: now), verifiedAt: daysAgo(20, from: now), retention: "Keep forever"),
            doc("pile-passport", "Passport renewal receipt", type: "Receipt", issuer: "US Department of State", date: "2026-09-30",
                folder: "01 Identity & Legal", verdict: .keepOriginal, physical: .keep,
                filedAt: daysAgo(3, from: now), verifiedAt: daysAgo(3, from: now), retention: "Until the new passport arrives"),
        ]
    }

    /// The A7 ledger: one sender per status, plus Cascade still mailing after a request.
    static func paperlessSenders(now: Date = .now) -> [PaperlessSender] {
        [
            PaperlessSender(id: "cascade-power-light", issuer: "Cascade Power & Light", how: "Turn off paper bills under Billing.",
                            status: .requested, firstSeen: daysAgo(60, from: now), requestedAt: daysAgo(25, from: now),
                            checkBackAt: iso(now.addingTimeInterval(33 * 86_400)),
                            steps: ["Sign in, then Billing, then Paperless billing", "Confirm the email they send"]),
            PaperlessSender(id: "summit-health-plan", issuer: "Summit Health Plan", how: "Choose electronic EOBs in the member portal.",
                            status: .waitingCycle, firstSeen: daysAgo(40, from: now), requestedAt: daysAgo(30, from: now),
                            checkBackAt: iso(now.addingTimeInterval(15 * 86_400)), mailHandledAt: daysAgo(2, from: now)),
            PaperlessSender(id: "brightline-wireless", issuer: "Brightline Wireless", how: "Turn off paper bills in the app.",
                            status: .toDo, firstSeen: daysAgo(5, from: now),
                            steps: ["Account settings, then Billing, then Paper bill off"]),
            PaperlessSender(id: "harbor-federal", issuer: "Harbor Federal", how: "Statements, then Delivery, then Online only.",
                            status: .confirmed, firstSeen: daysAgo(90, from: now), doneAt: daysAgo(45, from: now)),
            PaperlessSender(id: "northwind", issuer: "Northwind", how: "Ask HR for electronic W-2s.",
                            status: .confirmed, firstSeen: daysAgo(120, from: now), doneAt: daysAgo(70, from: now)),
            PaperlessSender(id: "dmv", issuer: "DMV", how: "Registration renewals only come on paper.",
                            status: .cantStop, firstSeen: daysAgo(100, from: now)),
        ]
    }
}

private extension FiledDoc {
    func with(text: String?, amount: String?) -> FiledDoc {
        var copy = self
        copy.fullText = text
        copy.amount = amount
        if text != nil { copy.searchTerms = SearchIndex.terms(for: copy) }
        return copy
    }
}
