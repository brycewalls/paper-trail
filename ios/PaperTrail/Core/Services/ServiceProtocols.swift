// Owner: scaffold (shared contract). Each protocol's owner (in brackets) may add methods; add a
// matching stub to the fake in Core/Services/Fakes in the same PR so every other agent still builds.
//
// Features talk to the outside world only through these protocols. AppEnvironment hands out a
// live or a fake implementation, so every feature can be built and tested against fakes.
import Foundation

// MARK: - Auth [auth]

nonisolated struct Account: Sendable, Hashable {
    var uid: String
    var email: String
    var displayName: String
}

nonisolated enum DriveLink: Sendable, Hashable {
    /// The server holds a refresh token and can mint access tokens.
    case connected
    /// Never connected, or the refresh token was revoked. Show "Reconnect Drive".
    case needsReconnect
    case unknown
}

nonisolated enum AuthState: Sendable, Hashable {
    /// Firebase Auth's persisted user, available synchronously at launch (#14: no sign-in check on open).
    case signedIn(Account)
    case signedOut
    /// Signed in, but not on the allowlist.
    case notAllowed(Account)
}

protocol AuthService: AnyObject {
    /// Read at launch without waiting on the network.
    var state: AuthState { get }
    var drive: DriveLink { get }
    /// Signed in, but the first consent came back without Drive. The sign-in screen stays up with
    /// "Connect Google Drive" until it's granted (design spec 4.1). Different from a later revoke,
    /// which keeps the app usable and shows Reconnect Drive (4.16).
    var driveConsentPending: Bool { get }
    /// Runs the sign-in flow chosen in ARCHITECTURE.md ("Auth") and connects Drive server-side.
    func signIn() async throws
    /// Re-runs consent for Drive only, after a revoke.
    func reconnectDrive() async throws
    func signOut() throws
    /// A Drive access token (drive.file), minted by the server from the stored refresh token (#15).
    /// Cached until a minute before expiry.
    func driveAccessToken() async throws -> String
}

extension AuthService {
    var driveConsentPending: Bool { false }
}

// MARK: - Classify [classify]

protocol ClassifyService: AnyObject {
    /// Throws ClassifyFailure.
    func classify(_ request: ClassifyRequest) async throws -> ClassifyResponse
}

// MARK: - Drive [outbox]

nonisolated struct DriveFileMetadata: Sendable, Hashable {
    var id: String
    var name: String
    var md5Checksum: String?
    var size: Int?
    var webViewLink: String
}

nonisolated enum DriveError: Error, Sendable, Hashable {
    case unauthorized          // 401 after one token refresh: Reconnect Drive
    case notFound              // folder or file gone: rebuild the folder cache once
    case rateLimited
    case server(Int)
    case network(String)
}

protocol DriveService: AnyObject {
    /// Finds or creates "Paperwork Archive" and its 11 folders, using and refreshing the
    /// users/{uid}/config/drive cache the web app also uses.
    func ensureFolders(forceRebuild: Bool) async throws -> DriveFolderCache
    /// Starts a resumable upload session and returns its session URI. The outbox PUTs the
    /// bytes with a background URLSession.
    func startUpload(name: String, folderID: String, mimeType: String, size: Int) async throws -> URL
    func metadata(fileID: String) async throws -> DriveFileMetadata
    /// Drive's own full-text search inside the app's folders (#22). Returns file IDs.
    func search(_ text: String) async throws -> [DriveFileMetadata]
    /// The year subfolder ("2025") inside one of the numbered folders, found or created on demand
    /// and cached in config/drive under the key "02 Taxes/2025" (the web app ignores extra keys).
    func ensureYearFolder(_ year: String, in folder: String) async throws -> String
    /// The file's bytes, for reading the page count back when a checksum doesn't match (#18).
    func download(fileID: String) async throws -> Data
    /// Moves a file the app made to Drive's trash (Send back to the deck, Undo after upload).
    func trash(fileID: String) async throws
}

// MARK: - Firestore [piles reads, outbox writes docs, classify writes senders]

protocol DocStore: AnyObject {
    /// Live list of users/{uid}/docs, newest first. Ends when the caller cancels.
    func docs() -> AsyncStream<[FiledDoc]>
    func addDoc(_ doc: FiledDoc) async throws -> String
    func updateDoc(id: String, fields: [String: any Sendable]) async throws
    func deleteDoc(id: String) async throws

    func paperless() -> AsyncStream<[PaperlessSender]>
    func setPaperless(_ sender: PaperlessSender) async throws
    func updatePaperless(id: String, fields: [String: any Sendable]) async throws

    func senderRules() async throws -> [SenderRule]
    func saveSenderRule(_ rule: SenderRule) async throws
    func deleteSenderRule(key: String) async throws

    func driveFolders() async throws -> DriveFolderCache?
    func saveDriveFolders(_ cache: DriveFolderCache) async throws

    /// users/{uid}/config/settings. Missing doc: AppSettings() defaults. [outbox: shred hold]
    func settings() async throws -> AppSettings
    func saveSettings(_ settings: AppSettings) async throws
}

// MARK: - Capture [capture]

/// A document ready to enter the pipeline: a PDF on disk plus what capture learned about it.
nonisolated struct CapturedDocument: Sendable, Hashable {
    var id: UUID
    /// Relative path in FileStore.
    var fileName: String
    var pageCount: Int
    var sizeBytes: Int
    var contentHash: String
    var origin: String
    var ocrText: String?
    var thumbnailName: String?
}

protocol CaptureService: AnyObject {
    /// Pages from VisionKit's document camera, in order. Builds one PDF with a text layer.
    func makeDocument(fromScans pages: [Data]) async throws -> CapturedDocument
    /// Files picked in Files: each file is one document. PDFs keep their original bytes.
    func importFiles(_ urls: [URL]) async throws -> [CapturedDocument]
    /// Photos picked together become one document.
    func importPhotos(_ images: [Data]) async throws -> CapturedDocument
    /// Simulator test seam: sample pages as if scanned.
    func sampleDocuments() async throws -> [CapturedDocument]
}

// MARK: - Outbox [outbox]

/// What the outbox knows beyond the pipeline items themselves. Views read it for the accessory.
nonisolated struct OutboxStatus: Sendable, Hashable {
    /// False while the network path is down; uploads wait instead of failing.
    var isOnline = true
    /// Drive answered 401 even after a fresh token: uploads pause until Reconnect Drive.
    var needsReconnect = false
    /// Bumps once when the last in-flight upload of a batch verifies (success haptic).
    var batchesVerified = 0
    /// Bumps once per item that runs out of automatic retries (warning haptic).
    var itemsNeedingAttention = 0
    var lastUploadAt: Date?
}

/// The deck holds its latest decision this long before calling enqueue, so Undo never has to
/// reverse an upload (Bryce's decision 4). resumePending skips queued items younger than this.
nonisolated enum UndoWindow {
    static let hold: Duration = .seconds(10)
    static let seconds: TimeInterval = 10
}

protocol OutboxService: AnyObject {
    var status: OutboxStatus { get }
    /// Takes a decided item (stage .queued) and drives it to .filed / .verified. Calling it is the
    /// deck's release of the undo hold: the outbox starts at once.
    func enqueue(_ item: PipelineItem) async
    func retry(_ item: PipelineItem) async
    /// Called at launch, after Reconnect Drive, and when the background session wakes the app.
    func resumePending() async
    /// Cancels the upload (or trashes the Drive copy and deletes the Firestore record if it
    /// finished) and puts the card back on top of the deck. Returns false when the local file is
    /// already gone (a verified item past the undo window), so there's nothing to put back.
    @discardableResult func sendBack(_ item: PipelineItem) async -> Bool
}

