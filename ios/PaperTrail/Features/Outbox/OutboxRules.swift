// Owner: outbox. Pure rules, no I/O and no SwiftUI: where a file goes in Drive, how long to wait
// before a retry, what the Firestore record looks like. Unit tested in OutboxTests.
import Foundation

// MARK: - Drive folders

/// Where one document lands in "Paperwork Archive".
nonisolated struct DriveTarget: Sendable, Hashable {
    /// One of ArchiveFolder.all.
    var folder: String
    /// "2025" for the three yearly folders, nil for the flat ones.
    var year: String?

    /// The config/drive cache key for the year subfolder, e.g. "02 Taxes/2025".
    var cacheKey: String { year.map { "\(folder)/\($0)" } ?? folder }

    /// Bryce's decision 2: only these get year subfolders, created on demand.
    static let yearlyFolders: Set<String> = ["02 Taxes", "03 Money & Banking", "05 Medical"]

    /// The year comes from docDate (YYYY-MM-DD), falling back to the filing date.
    static func plan(folder: String, docDate: String, filedAt: Date, calendar: Calendar = .current) -> DriveTarget {
        let folder = ArchiveFolder.all.contains(folder) ? folder : ArchiveFolder.fallback
        guard yearlyFolders.contains(folder) else { return DriveTarget(folder: folder, year: nil) }
        let prefix = docDate.prefix(4)
        if prefix.count == 4, let year = Int(prefix), (1900...2200).contains(year) {
            return DriveTarget(folder: folder, year: String(year))
        }
        return DriveTarget(folder: folder, year: String(calendar.component(.year, from: filedAt)))
    }
}

// MARK: - Retries

nonisolated enum RetryPolicy {
    /// Spec 3.12: automatic backoff of 1, 2, 5 and 15 minutes, then Needs attention.
    static let delays: [TimeInterval] = [60, 120, 300, 900]

    /// The wait before the next automatic try after `attempts` failures, or nil when they're used up.
    static func delay(afterAttempts attempts: Int) -> TimeInterval? {
        guard attempts >= 1, attempts <= delays.count else { return nil }
        return delays[attempts - 1]
    }
}

// MARK: - Copy

/// Every outbox string in one place, spec 3.7, 3.12 and 4.4. No em dashes, no exclamation points.
nonisolated enum OutboxCopy {
    static let driveDidntAnswer = "Drive didn't answer."
    static let retriesUsedUp = "Drive didn't take this one. Tap Retry to try again."
    static let folderMoved = "The Drive folder moved. Rebuilding it."
    static let logFailed = "Filed in Drive, but it didn't save to your log. Tap Retry to try again."
    static let checking = "Checking the Drive copy"
    static let nextInLine = "Next in line"
    static let waitingForConnection = "Waiting for a connection"
    static let reconnectFailed = "Drive didn't reconnect. Try again in a minute."

    /// "Drive has 1 of 2 pages. Uploading it again." (once), then the Retry version.
    static func pageMismatch(drive: Int, local: Int, reuploading: Bool) -> String {
        "Drive has \(drive) of \(local) \(local == 1 ? "page" : "pages"). "
            + (reuploading ? "Uploading it again." : "Tap Retry to upload it again.")
    }

    /// "Drive didn't answer. Trying again in 2 min."
    static func retrying(at next: Date, now: Date) -> String {
        let minutes = max(1, Int((next.timeIntervalSince(now) / 60).rounded(.up)))
        return "\(driveDidntAnswer) Trying again in \(minutes) min."
    }
}

// MARK: - Records

nonisolated enum OutboxRecord {
    /// "2026-10-13T17:02:11.482Z", the same as the web app's toISOString().
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// users/{uid}/docs/{autoId}, the same shape the web app's saveRecord() writes, plus the
    /// optional fields from ARCHITECTURE.md ("Firestore data model").
    static func filedDoc(card: DocumentCard, pages: Int, filed: Bool, driveID: String?, driveURL: String?,
                         filedAt: Date, sizeBytes: Int, md5: String?, contentHash: String?, ocrText: String?) -> FiledDoc {
        let folder = ArchiveFolder.all.contains(card.folder) ? card.folder : ArchiveFolder.fallback
        return FiledDoc(
            title: card.title, docType: card.docType, issuer: card.issuer, docDate: card.docDate,
            summary: card.summary, folder: folder, filename: card.filename, verdict: card.verdict,
            verdictReason: card.verdictReason, retention: card.retention, sensitive: card.sensitive,
            paperless: card.paperless, pages: pages, filed: filed,
            driveId: filed ? (driveID ?? "") : "", driveUrl: filed ? (driveURL ?? "") : "",
            physical: filed && card.verdict == .keepOriginal ? .keep : .toShred,
            filedAt: iso(filedAt), shreddedAt: nil,
            confidence: card.confidence,
            fullText: ocrText.map { String($0.prefix(100_000)) },
            searchTerms: searchTerms(card: card, filedAt: filedAt),
            amount: nil, contentHash: contentHash,
            sizeBytes: sizeBytes, md5: filed ? md5 : nil,
            verifiedAt: nil, verifiedPages: nil, source: "ios")
    }

    /// Lowercased tokens for array-contains queries (#22): title, issuer, docType, the folder's
    /// display name and the year.
    static func searchTerms(card: DocumentCard, filedAt: Date) -> [String] {
        let folderName = card.folder.split(separator: " ", maxSplits: 1).dropFirst().joined()
        let year = DriveTarget.plan(folder: "02 Taxes", docDate: card.docDate, filedAt: filedAt).year ?? ""
        let text = [card.title, card.issuer, card.docType, folderName, year].joined(separator: " ").lowercased()
        var seen = Set<String>()
        return text.split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "-" })
            .map(String.init).filter { $0.count > 1 && seen.insert($0).inserted }
    }

    /// The web app writes a paperless sender the first time a "can go paperless" doc arrives.
    /// The ledger (#23) adds lastSeen, and stillMailingAt for a sender already asked to stop.
    enum PaperlessPlan: Equatable {
        case none
        case create(PaperlessSender)
        case update(id: String, lastSeen: String, stillMailingAt: String?)
    }

    static func paperless(card: DocumentCard, existing: PaperlessSender?, at date: Date) -> PaperlessPlan {
        let issuer = card.paperless.issuer.isEmpty ? card.issuer : card.paperless.issuer
        guard card.paperless.possible, !issuer.isEmpty else { return .none }
        let id = slug(issuer)
        let now = iso(date)
        guard let existing else {
            return .create(PaperlessSender(id: id, issuer: String(issuer.prefix(100)), how: String(card.paperless.how.prefix(300)),
                                           status: .toDo, firstSeen: now, lastSeen: now))
        }
        let asked: Set<PaperlessStatus> = [.requested, .waitingCycle, .confirmed]
        return .update(id: existing.id.isEmpty ? id : existing.id, lastSeen: now,
                       stillMailingAt: asked.contains(existing.status) ? now : nil)
    }
}
