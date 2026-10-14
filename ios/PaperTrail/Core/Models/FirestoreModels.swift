// Owner: scaffold (shared contract). Feature agents may add optional fields and must record them
// in ARCHITECTURE.md ("Firestore data model"). The web app reads the same documents, so existing
// field names and value strings never change.
//
// Every path is under users/{uid}/. Dates are ISO 8601 strings, like the web app writes them.
import Foundation

/// What happens to the paper after filing. Values match the web app.
nonisolated enum PhysicalState: String, Codable, Sendable, CaseIterable {
    /// Waiting to be shredded (Shred and Scan + shred).
    case toShred = "to_shred"
    case shredded
    /// Keep original, not yet put away.
    case keep
    /// Keep original, put away.
    case stored
}

/// users/{uid}/docs/{autoId}: one filed (or shred-logged) document.
nonisolated struct FiledDoc: Codable, Sendable, Hashable, Identifiable {
    /// The Firestore document ID. Not stored as a field.
    var id: String = ""

    // The card, flattened in (same as the web app's `{ ...it.result }`).
    var title: String
    var docType: String
    var issuer: String
    var docDate: String
    var summary: String
    var folder: String
    var filename: String
    var verdict: Verdict
    var verdictReason: String
    var retention: String
    var sensitive: Bool
    var paperless: PaperlessHint

    var pages: Int
    /// False when swiped left (logged as shred without a Drive copy).
    var filed: Bool
    var driveId: String
    var driveUrl: String
    var physical: PhysicalState
    var filedAt: String
    var shreddedAt: String?

    // New, optional.
    var confidence: CardConfidence?          // #20
    var fullText: String?                    // #22, OCR text, capped at 100,000 characters
    var searchTerms: [String]?               // #22, lowercased tokens for array-contains queries
    var amount: String?                      // #22, the main amount if the card has one, e.g. "142.17"
    var contentHash: String?                 // #2, SHA-256 hex of the filed bytes
    var sizeBytes: Int?                      // #18
    var md5: String?                         // #18, local MD5 hex, compared with Drive's md5Checksum
    var verifiedAt: String?                  // #18, set only when Drive's checksum matched
    var verifiedPages: Int?                  // #18, page count read back from the uploaded PDF
    var source: String?                      // "ios" or absent (web)

    enum CodingKeys: String, CodingKey {
        case title, docType, issuer, docDate, summary, folder, filename, verdict, verdictReason,
             retention, sensitive, paperless, pages, filed, driveId, driveUrl, physical, filedAt,
             shreddedAt, confidence, fullText, searchTerms, amount, contentHash, sizeBytes, md5,
             verifiedAt, verifiedPages, source
    }

    /// A doc counts as safe to shred only once its Drive copy is verified (#18). Web-filed docs
    /// have no verification and stay safe by the old rule (filed and a Drive link).
    var isSafeToShred: Bool {
        guard physical == .toShred else { return false }
        if source == "ios" { return verifiedAt != nil || !filed }
        return true
    }
}

/// Paperless ledger status (#23). The first three raw values are the web app's old ones.
nonisolated enum PaperlessStatus: String, Codable, Sendable, CaseIterable {
    case toDo = "todo"
    case requested
    case waitingCycle = "waiting_cycle"
    case confirmed = "done"
    case cantStop = "skip"

    var label: String {
        switch self {
        case .toDo: "To do"
        case .requested: "Requested"
        case .waitingCycle: "Waiting a cycle"
        case .confirmed: "Confirmed"
        case .cantStop: "Can't stop"
        }
    }
}

/// users/{uid}/paperless/{slug(issuer)}: one sender to switch to e-delivery.
nonisolated struct PaperlessSender: Codable, Sendable, Hashable, Identifiable {
    var id: String = ""
    var issuer: String
    var how: String
    var status: PaperlessStatus
    var firstSeen: String
    var doneAt: String?

    // New, optional (#23).
    var requestedAt: String?
    var checkBackAt: String?
    var steps: [String]?
    /// Set when a new doc arrives from a sender already Requested, Waiting or Confirmed.
    var stillMailingAt: String?
    var lastSeen: String?

    enum CodingKeys: String, CodingKey {
        case issuer, how, status, firstSeen, doneAt, requestedAt, checkBackAt, steps, stillMailingAt, lastSeen
    }
}

/// users/{uid}/senders/{key}: a remembered correction for one sender (#21).
/// key is slug(issuer), the same slug the web app uses for paperless IDs.
nonisolated struct SenderRule: Codable, Sendable, Hashable, Identifiable {
    var id: String { key }
    var key: String
    var issuer: String
    var folder: String?
    /// e.g. "{date}_duke-energy-electric-bill". Tokens: {date}, {yyyy}, {mm}.
    var filenamePattern: String?
    var verdict: Verdict?
    var docType: String?
    var updatedAt: String
}

/// users/{uid}/config/drive: the cached Drive folder IDs. Same shape the web app writes.
nonisolated struct DriveFolderCache: Codable, Sendable, Hashable {
    var root: String
    /// Folder name (ArchiveFolder.all) to Drive folder ID.
    var folders: [String: String]
    var updatedAt: String

    var isComplete: Bool { ArchiveFolder.all.allSatisfy { folders[$0] != nil } }
}

/// users/{uid}/config/settings: app settings that follow the account.
nonisolated struct AppSettings: Codable, Sendable, Hashable {
    /// Days to wait after verification before a doc counts as safe to shred (#18). 0 = none.
    var shredHoldDays: Int = 0
}

/// The web app's slug(): lowercase, runs of anything else become one hyphen, trimmed, 60 chars.
nonisolated func slug(_ s: String) -> String {
    let lowered = s.lowercased()
    var out = ""
    var lastWasHyphen = false
    for ch in lowered.unicodeScalars {
        if ("a"..."z").contains(ch) || ("0"..."9").contains(ch) {
            out.unicodeScalars.append(ch)
            lastWasHyphen = false
        } else if !lastWasHyphen {
            out.append("-")
            lastWasHyphen = true
        }
    }
    let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let capped = String(trimmed.prefix(60))
    return capped.isEmpty ? "unknown" : capped
}
