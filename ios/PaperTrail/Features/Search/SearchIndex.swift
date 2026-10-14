// Owner: piles (search, #22). Logic only, no SwiftUI. The on-device index: matching, ranking,
// filter chips, highlight ranges and snippets over the filed docs Firestore already syncs.
import Foundation

/// A filter chip on the Search screen.
nonisolated enum SearchFilter: Hashable, Sendable {
    case docType(String)
    case year(Int)
    case sensitive
    case keepOriginals

    var title: String {
        switch self {
        case .docType(let type): type
        case .year(let year): String(year)
        case .sensitive: "Sensitive"
        case .keepOriginals: "Keep originals"
        }
    }
}

nonisolated struct SearchHit: Identifiable, Hashable, Sendable {
    var doc: FiledDoc
    var score: Int
    /// A short piece of the OCR text around the first match, or nil when the text didn't match.
    var snippet: String?
    var id: String { doc.id }
}

nonisolated enum SearchIndex {
    /// Lowercased tokens for `FiledDoc.searchTerms` (title, issuer, docType, folder, year, amount),
    /// for Firestore array-contains queries. The outbox writes these when it files a doc.
    static func terms(for doc: FiledDoc) -> [String] {
        var parts = [doc.title, doc.issuer, doc.docType, PileFormat.folderName(doc.folder)]
        if let year = PileFormat.year(of: doc) { parts.append(String(year)) }
        if let amount = doc.amount { parts.append(amount) }
        var seen = Set<String>()
        return parts.flatMap(words).filter { seen.insert($0).inserted }
    }

    /// Lowercased words, split on spaces and the punctuation around them. Hyphens and dots inside
    /// a word stay ("w-2", "142.17").
    static func words(_ text: String) -> [String] {
        text.lowercased()
            .split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" || $0 == "(" || $0 == ")" })
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: ".:\"'!?·›")) }
            .filter { !$0.isEmpty }
    }

    /// Four-digit years in the query (1900 to 2100). Typing one turns its chip on.
    static func years(in query: String) -> [Int] {
        words(query).compactMap { word in
            guard word.count == 4, let year = Int(word), (1900...2100).contains(year) else { return nil }
            return year
        }
    }

    /// Known document types the query names in full ("tax form 2023" names "Tax form").
    static func docTypes(in query: String, known: [String]) -> [String] {
        let q = " " + words(query).joined(separator: " ") + " "
        return known.filter { type in
            let t = words(type).joined(separator: " ")
            return !t.isEmpty && q.contains(" \(t) ")
        }
    }

    /// Everything a query word can match, lowercased.
    static func haystack(_ doc: FiledDoc) -> String {
        var parts = [doc.title, doc.issuer, doc.docType, PileFormat.folderName(doc.folder), doc.docDate]
        if let year = PileFormat.year(of: doc) { parts.append(String(year)) }
        if let amount = doc.amount { parts.append(amount) }
        parts += doc.searchTerms ?? []
        parts.append(doc.fullText ?? "")
        return parts.joined(separator: " \n ").lowercased()
    }

    static func passes(_ doc: FiledDoc, filters: Set<SearchFilter>) -> Bool {
        let types = filters.compactMap { if case .docType(let t) = $0 { t } else { nil } }
        let years = filters.compactMap { if case .year(let y) = $0 { y } else { nil } }
        if !types.isEmpty, !types.contains(doc.docType) { return false }
        if !years.isEmpty {
            // A 2023 W-2 is dated January 2024, so a year also matches the year written on the doc.
            let docYear = PileFormat.year(of: doc)
            let text = haystack(doc)
            if !years.contains(where: { $0 == docYear || text.contains(String($0)) }) { return false }
        }
        if filters.contains(.sensitive), !doc.sensitive { return false }
        if filters.contains(.keepOriginals), doc.verdict != .keepOriginal { return false }
        return true
    }

    /// Every word must match somewhere. Title matches rank first, then sender, then type and
    /// folder, then the OCR text; ties go to the newest filing.
    static func search(_ docs: [FiledDoc], query: String, filters: Set<SearchFilter>) -> [SearchHit] {
        let queryWords = words(query)
        guard !queryWords.isEmpty || !filters.isEmpty else { return [] }
        var hits: [SearchHit] = []
        for doc in docs where passes(doc, filters: filters) {
            let text = haystack(doc)
            guard queryWords.allSatisfy({ text.contains($0) }) else { continue }
            var score = 0
            let title = doc.title.lowercased(), issuer = doc.issuer.lowercased()
            let meta = (doc.docType + " " + doc.folder).lowercased()
            for word in queryWords {
                if title.contains(word) { score += 3 } else if issuer.contains(word) { score += 2 } else if meta.contains(word) { score += 1 }
            }
            hits.append(SearchHit(doc: doc, score: score, snippet: snippet(doc.fullText, words: queryWords)))
        }
        return hits.sorted { a, b in
            a.score != b.score ? a.score > b.score : a.doc.filedAt > b.doc.filedAt
        }
    }

    /// Case-insensitive ranges of every query word in `text`, for highlighting.
    static func ranges(of words: [String], in text: String) -> [Range<String.Index>] {
        var out: [Range<String.Index>] = []
        for word in words where !word.isEmpty {
            var start = text.startIndex
            while start < text.endIndex,
                  let found = text.range(of: word, options: [.caseInsensitive, .diacriticInsensitive], range: start..<text.endIndex) {
                out.append(found)
                start = found.upperBound
            }
        }
        return out.sorted { $0.lowerBound < $1.lowerBound }
    }

    /// About 120 characters of the OCR text around the first matching word, cut at word
    /// boundaries, with an ellipsis where it was cut.
    static func snippet(_ fullText: String?, words: [String], before: Int = 30, after: Int = 90) -> String? {
        guard let fullText, !words.isEmpty else { return nil }
        let flat = fullText.split(whereSeparator: \.isNewline).joined(separator: " ")
            .replacingOccurrences(of: "  ", with: " ")
        guard let first = ranges(of: words, in: flat).first else { return nil }
        var lower = flat.index(first.lowerBound, offsetBy: -before, limitedBy: flat.startIndex) ?? flat.startIndex
        var upper = flat.index(first.upperBound, offsetBy: after, limitedBy: flat.endIndex) ?? flat.endIndex
        if lower > flat.startIndex, let space = flat[lower..<first.lowerBound].firstIndex(of: " ") {
            lower = flat.index(after: space)
        }
        if upper < flat.endIndex, let space = flat[first.upperBound..<upper].lastIndex(of: " ") {
            upper = space
        }
        var out = String(flat[lower..<upper]).trimmingCharacters(in: .whitespaces)
        if lower > flat.startIndex { out = "…" + out }
        if upper < flat.endIndex { out += "…" }
        return out
    }
}
