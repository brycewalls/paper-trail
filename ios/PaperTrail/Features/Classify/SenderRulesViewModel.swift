// Owner: classify. Logic only.
//
// The Sender rules list and rule detail (design spec 4.12, #21, #27), and the count on the Settings
// row. Rules live in users/{uid}/senders through DocStore.
import Foundation

@Observable
final class SenderRulesViewModel {
    private let docs: any DocStore
    private(set) var rules: [SenderRule] = []
    private(set) var hasLoaded = false
    var query = ""

    init(docs: any DocStore) { self.docs = docs }

    /// A to Z by sender, filtered by the search field.
    var visible: [SenderRule] {
        let sorted = rules.sorted { $0.issuer.localizedCaseInsensitiveCompare($1.issuer) == .orderedAscending }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return sorted }
        return sorted.filter { $0.issuer.localizedCaseInsensitiveContains(q) || ($0.docType ?? "").localizedCaseInsensitiveContains(q) }
    }

    var count: Int { rules.count }

    func load() async {
        rules = (try? await docs.senderRules()) ?? rules
        hasLoaded = true
    }

    func forget(_ rule: SenderRule) async {
        rules.removeAll { $0.key == rule.key }
        try? await docs.deleteSenderRule(key: rule.key)
    }

    func save(_ rule: SenderRule) async {
        var rule = rule
        rule.updatedAt = SenderRuleEngine.isoString(.now)
        if let index = rules.firstIndex(where: { $0.key == rule.key }) { rules[index] = rule } else { rules.append(rule) }
        try? await docs.saveSenderRule(rule)
    }

    // MARK: Copy

    /// "Home · Scan + shred · {date}_cascade-electric-bill"; parts the rule doesn't set are left out.
    static func subtitle(for rule: SenderRule) -> String {
        [rule.folder.map(SenderRuleEngine.folderName), rule.verdict?.stamp, rule.filenamePattern]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "Updated Oct 9".
    static func updatedFooter(for rule: SenderRule) -> String? {
        guard let date = SenderRuleEngine.date(fromISO: rule.updatedAt) else { return nil }
        return "Updated " + date.formatted(.dateTime.month(.abbreviated).day().locale(Locale(identifier: "en_US")))
    }

    static func forgetTitle(for rule: SenderRule) -> String {
        "Forget \(rule.issuer)? Their cards go back to Claude's best guess."
    }

    /// The live filename preview under the pattern field: "2026-09-28_cascade-electric-bill.pdf".
    static func preview(pattern: String, rule: SenderRule, docType: String, today: Date = .now) -> String {
        guard !pattern.trimmingCharacters(in: .whitespaces).isEmpty else { return "" }
        let card = DocumentCard(
            title: "", docType: docType, issuer: rule.issuer, docDate: CheckFieldsModel.isoDay(today), summary: "",
            folder: rule.folder ?? ArchiveFolder.fallback, filename: "", verdict: rule.verdict ?? .scanShred,
            verdictReason: "", retention: "", sensitive: false,
            paperless: PaperlessHint(possible: false, issuer: rule.issuer, how: ""), confidence: nil, appliedRule: nil)
        let name = SenderRuleEngine.renderFilename(pattern, card: card)
        return name.isEmpty ? "" : name + ".pdf"
    }
}
