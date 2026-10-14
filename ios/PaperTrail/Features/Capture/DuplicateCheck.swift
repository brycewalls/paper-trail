// Owner: capture. Issue #2.
//
// The content hash (SHA-256 hex of the bytes that will be filed) and the duplicate check against
// documents already filed (Firestore `contentHash`) or already somewhere in the phone's pipeline.
import CryptoKit
import Foundation

nonisolated enum ContentHash {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

/// A document that has the same bytes as one being captured.
nonisolated struct DuplicateMatch: Sendable, Hashable {
    enum Kind: Sendable, Hashable {
        /// Filed before (a Firestore doc with the same contentHash).
        case filed
        /// Still on this phone: on the deck, in the outbox, or filed and kept.
        case onPhone
    }

    var kind: Kind
    var title: String
    var date: Date?

    /// The review screen's duplicate line (spec 3.12): "Already filed on Oct 2 as 2025 W-2."
    func message(now: Date = .now) -> String {
        let verb = kind == .filed ? "Already filed" : "Already scanned"
        var line = verb
        if let date { line += " on " + Self.shortDate(date, now: now) }
        if !title.isEmpty { line += " as " + title }
        return line + "."
    }

    static func shortDate(_ date: Date, now: Date) -> String {
        let calendar = Calendar.current
        let style = calendar.isDate(date, equalTo: now, toGranularity: .year)
            ? Date.FormatStyle.dateTime.month(.abbreviated).day()
            : Date.FormatStyle.dateTime.month(.abbreviated).day().year()
        return date.formatted(style.locale(Locale(identifier: "en_US")))
    }
}

/// Something already known to the app, reduced to what the check needs.
nonisolated struct KnownDocument: Sendable, Hashable {
    var contentHash: String
    var title: String
    var date: Date?
    var kind: DuplicateMatch.Kind
}

nonisolated enum DuplicateCheck {
    static func match(_ hash: String, in known: [KnownDocument]) -> DuplicateMatch? {
        // Prefer a filed copy: that's the one that would end up twice in Drive.
        let hits = known.filter { $0.contentHash == hash }
        guard let hit = hits.first(where: { $0.kind == .filed }) ?? hits.first else { return nil }
        return DuplicateMatch(kind: hit.kind, title: hit.title, date: hit.date)
    }

    static func known(from docs: [FiledDoc]) -> [KnownDocument] {
        docs.compactMap { doc in
            guard let hash = doc.contentHash, !hash.isEmpty else { return nil }
            return KnownDocument(contentHash: hash, title: doc.title, date: parseISO(doc.filedAt), kind: .filed)
        }
    }

    static func parseISO(_ string: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
}
