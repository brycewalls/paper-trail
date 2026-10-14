// Owner: scaffold (shared contract). Outbox owns upload fields, Capture owns capture fields,
// Classify owns reading fields, Deck owns the decision. Add properties only with a default value
// (SwiftData lightweight migration) and record them in ARCHITECTURE.md.
//
// One document on its way through the phone. It lives in SwiftData (on device only) from the
// moment it is captured until it is filed and verified, so nothing is lost if the app is killed.
// The document's bytes are a file in FileStore, never inside the database.
import Foundation
import SwiftData

/// Where an item is. Raw values are stored, so never rename one.
nonisolated enum PipelineStage: String, Codable, Sendable, CaseIterable {
    /// Captured or imported, PDF on disk, OCR may still be running.
    case captured
    /// Sent to classify, waiting for the card.
    case reading
    /// Card is back; the item is on the deck waiting for a swipe.
    case ready
    /// Swiped. Waiting for the outbox (upload and/or the Firestore log write).
    case queued
    /// Drive upload in progress.
    case uploading
    /// Drive upload done (or not needed) and the Firestore record written.
    case filed
    /// Drive's md5Checksum matched the local file (#18). Terminal for decision == .file.
    case verified
    /// Something failed. `failedStage` says where, `errorMessage` says what.
    case failed

    var isOnDeck: Bool { self == .ready }
    var isInOutbox: Bool { [.queued, .uploading, .filed, .failed].contains(self) }
}

/// What the swipe decided.
nonisolated enum PipelineDecision: String, Codable, Sendable {
    /// Swipe right: upload to Drive, then log.
    case file
    /// Swipe left: log as shred, no Drive copy.
    case shredOnly
    /// Later: back of the deck, no decision yet.
    case later
}

@Model
final class PipelineItem {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var stageRaw: String
    var failedStageRaw: String?
    var errorMessage: String?
    var attempts: Int

    // Capture
    /// Path relative to FileStore's root, e.g. "items/<uuid>.pdf".
    var fileName: String
    var pageCount: Int
    var sizeBytes: Int
    /// SHA-256 hex of the file (#2 duplicate check).
    var contentHash: String?
    /// "scan", "files" or "photos".
    var origin: String
    var ocrText: String?
    /// Relative path of the first-page thumbnail (JPEG) in FileStore.
    var thumbnailName: String?

    // Reading
    var card: DocumentCard?
    var model: String?

    // Decision (Deck)
    var decisionRaw: String?
    var decidedAt: Date?

    // Outbox
    var uploadSessionURL: String?
    var bytesSent: Int
    var driveFileID: String?
    var driveURL: String?
    var md5: String?
    var verifiedAt: Date?
    var firestoreDocID: String?

    init(id: UUID = UUID(), fileName: String, pageCount: Int, sizeBytes: Int, origin: String, stage: PipelineStage = .captured) {
        self.id = id
        self.createdAt = .now
        self.stageRaw = stage.rawValue
        self.attempts = 0
        self.fileName = fileName
        self.pageCount = pageCount
        self.sizeBytes = sizeBytes
        self.origin = origin
        self.bytesSent = 0
    }

    var stage: PipelineStage {
        get { PipelineStage(rawValue: stageRaw) ?? .failed }
        set { stageRaw = newValue.rawValue }
    }

    var decision: PipelineDecision? {
        get { decisionRaw.flatMap(PipelineDecision.init(rawValue:)) }
        set { decisionRaw = newValue?.rawValue }
    }

    func fail(at stage: PipelineStage, _ message: String) {
        failedStageRaw = stage.rawValue
        errorMessage = message
        self.stage = .failed
    }
}
