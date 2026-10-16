// Owner: scaffold. When you add a method to a protocol in ServiceProtocols.swift, add the fake's
// version here in the same PR. Fakes never touch the network.
//
// In-memory stand-ins for every service. Used by the simulator's sample mode, unit tests and
// SwiftUI previews.
import Foundation
import UIKit

@Observable
final class FakeAuthService: AuthService {
    var state: AuthState
    var drive: DriveLink = .connected
    var driveConsentPending = false
    /// Set to make signIn and reconnectDrive fail with this.
    var failure: AuthFailure?

    init(signedIn: Bool = true) {
        let bryce = Account(uid: "fake-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls")
        state = signedIn ? .signedIn(bryce) : .signedOut
    }

    func signIn() async throws {
        if let failure { throw failure }
        state = .signedIn(Account(uid: "fake-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls"))
        drive = .connected
        driveConsentPending = false
    }
    func reconnectDrive() async throws {
        if let failure { throw failure }
        drive = .connected
        driveConsentPending = false
    }
    func signOut() throws { state = .signedOut }
    func driveAccessToken() async throws -> String {
        if drive != .connected { throw DriveError.unauthorized }
        return "fake-access-token"
    }
}

final class FakeClassifyService: ClassifyService {
    var delay: Duration = .milliseconds(300)
    /// Set to make every call fail with this code.
    var failure: ClassifyErrorCode?
    private(set) var requests: [ClassifyRequest] = []

    func classify(_ request: ClassifyRequest) async throws -> ClassifyResponse {
        requests.append(request)
        try? await Task.sleep(for: delay)
        if let failure { throw ClassifyFailure(code: failure, message: "Fake failure") }
        // Like the function: apply the matching sender rule and say which (#21).
        let card = SenderRuleEngine.apply(request.senderHints ?? [], to: SampleData.card(forText: request.ocrText))
        return ClassifyResponse(result: card, model: "fake")
    }

    private(set) var splitRequests: [SplitRequest] = []

    /// Stack mode (#19), for the simulator, sample mode and tests: a page starts a new document
    /// when its first line (the letterhead) differs from the page before. Labels are the sample
    /// card's title for that text.
    func proposeSplit(_ request: SplitRequest) async throws -> [SplitDocument] {
        splitRequests.append(request)
        try? await Task.sleep(for: delay * 3)
        if let failure { throw ClassifyFailure(code: failure, message: "Fake failure") }
        return Self.split(request.pages.map(\.text))
    }

    static func split(_ texts: [String]) -> [SplitDocument] {
        let heads = texts.map { $0.split(separator: "\n").first.map(String.init) ?? "" }
        var documents: [SplitDocument] = []
        for (index, head) in heads.enumerated() {
            if index > 0, head == heads[index - 1] || head.isEmpty {
                documents[documents.count - 1].end = index
            } else {
                documents.append(SplitDocument(start: index, end: index, label: SampleData.card(forText: texts[index]).title))
            }
        }
        return documents
    }
}

final class FakeDriveService: DriveService {
    private(set) var uploads: [(name: String, folderID: String)] = []

    func ensureFolders(forceRebuild: Bool) async throws -> DriveFolderCache {
        var map: [String: String] = [:]
        for (index, name) in ArchiveFolder.all.enumerated() { map[name] = "fake-folder-\(index + 1)" }
        return DriveFolderCache(root: "fake-root", folders: map, updatedAt: ISO8601DateFormatter().string(from: .now))
    }

    func startUpload(name: String, folderID: String, mimeType: String, size: Int) async throws -> URL {
        uploads.append((name, folderID))
        return URL(string: "https://example.invalid/upload/\(uploads.count)")!
    }

    func metadata(fileID: String) async throws -> DriveFileMetadata {
        DriveFileMetadata(id: fileID, name: "\(fileID).pdf", md5Checksum: nil, size: nil,
                          webViewLink: "https://drive.google.com/file/d/\(fileID)/view")
    }

    /// What `search` returns; tests set it for "Also in Drive" [piles].
    var searchResults: [DriveFileMetadata] = []
    func search(_ text: String) async throws -> [DriveFileMetadata] { searchResults }

    private(set) var trashed: [String] = []

    func ensureYearFolder(_ year: String, in folder: String) async throws -> String {
        "fake-folder-\(slug(folder))-\(year)"
    }

    func download(fileID: String) async throws -> Data { Data() }

    func trash(fileID: String) async throws { trashed.append(fileID) }
}

final class FakeDocStore: DocStore {
    private var docList: [FiledDoc]
    private var senders: [PaperlessSender]
    private var rules: [String: SenderRule] = [:]
    private var folderCache: DriveFolderCache?
    private var appSettings: AppSettings
    private var docWatchers: [UUID: AsyncStream<[FiledDoc]>.Continuation] = [:]
    private var paperlessWatchers: [UUID: AsyncStream<[PaperlessSender]>.Continuation] = [:]
    private var settingsWatchers: [UUID: AsyncStream<AppSettings>.Continuation] = [:]
    /// Every update call, in order, so tests can check what was written.
    private(set) var writes: [(path: String, fields: [String: any Sendable])] = []
    /// Tests set these to see how screens handle a failed write or a failed listener.
    var failWrites = false
    var syncError: DocStoreError?

    init(seed: [FiledDoc] = SampleData.filedDocs(), paperless: [PaperlessSender] = [],
         settings: AppSettings = AppSettings(), rules: [SenderRule] = SampleData.senderRules) {
        docList = seed
        senders = paperless
        appSettings = settings
        self.rules = Dictionary(uniqueKeysWithValues: rules.map { ($0.key, $0) })
    }

    /// The simulator's sample library (-PTSample): enough documents and senders that Piles,
    /// Search and Paperless look like A5 to A7, with a 3-day shred hold. [piles]
    static func sampleLibrary() -> FakeDocStore {
        FakeDocStore(seed: SampleData.filedDocs() + SampleData.pileDocs(), paperless: SampleData.paperlessSenders(),
                     settings: AppSettings(shredHoldDays: 3))
    }

    func docs() -> AsyncStream<[FiledDoc]> {
        let (stream, continuation) = AsyncStream<[FiledDoc]>.makeStream()
        let key = UUID()
        docWatchers[key] = continuation
        continuation.yield(docList)
        continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.docWatchers[key] = nil } }
        return stream
    }

    func addDoc(_ doc: FiledDoc) async throws -> String {
        var doc = doc
        doc.id = "fake-doc-\(docList.count + 1)"
        docList.insert(doc, at: 0)
        publishDocs()
        return doc.id
    }

    func updateDoc(id: String, fields: [String: any Sendable]) async throws {
        if failWrites { throw DocStoreError.listener("fake write failure") }
        writes.append(("docs/\(id)", fields))
        guard let index = docList.firstIndex(where: { $0.id == id }) else { return }
        docList[index] = Self.merged(fields, into: docList[index], keepID: id)
        publishDocs()
    }

    func deleteDoc(id: String) async throws {
        docList.removeAll { $0.id == id }
        publishDocs()
    }

    func paperless() -> AsyncStream<[PaperlessSender]> {
        let (stream, continuation) = AsyncStream<[PaperlessSender]>.makeStream()
        let key = UUID()
        paperlessWatchers[key] = continuation
        continuation.yield(senders)
        continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.paperlessWatchers[key] = nil } }
        return stream
    }

    func setPaperless(_ sender: PaperlessSender) async throws {
        senders.removeAll { $0.id == sender.id }
        senders.append(sender)
        publishPaperless()
    }

    func updatePaperless(id: String, fields: [String: any Sendable]) async throws {
        if failWrites { throw DocStoreError.listener("fake write failure") }
        writes.append(("paperless/\(id)", fields))
        guard let index = senders.firstIndex(where: { $0.id == id }) else { return }
        senders[index] = Self.merged(fields, into: senders[index], keepID: id)
        publishPaperless()
    }

    func senderRules() async throws -> [SenderRule] { Array(rules.values) }
    func saveSenderRule(_ rule: SenderRule) async throws { rules[rule.key] = rule }
    func deleteSenderRule(key: String) async throws { rules[key] = nil }

    func driveFolders() async throws -> DriveFolderCache? { folderCache }
    func saveDriveFolders(_ cache: DriveFolderCache) async throws { folderCache = cache }

    func settings() async throws -> AppSettings { appSettings }
    func saveSettings(_ settings: AppSettings) async throws {
        appSettings = settings
        for c in settingsWatchers.values { c.yield(settings) }
    }

    func watchSettings() -> AsyncStream<AppSettings> {
        let (stream, continuation) = AsyncStream<AppSettings>.makeStream()
        let key = UUID()
        settingsWatchers[key] = continuation
        continuation.yield(appSettings)
        continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.settingsWatchers[key] = nil } }
        return stream
    }

    private func publishDocs() { for c in docWatchers.values { c.yield(docList) } }
    private func publishPaperless() { for c in paperlessWatchers.values { c.yield(senders) } }

    /// Applies a Firestore-style field update to a Codable record by round-tripping it through JSON,
    /// so the fake accepts any field the live store does.
    private static func merged<T: Codable>(_ fields: [String: any Sendable], into value: T, keepID: String?) -> T {
        guard let data = try? JSONEncoder().encode(value),
              var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return value }
        for (key, field) in fields { object[key] = field }
        guard let out = try? JSONSerialization.data(withJSONObject: object),
              var decoded = try? JSONDecoder().decode(T.self, from: out) else { return value }
        if let keepID {
            if var doc = decoded as? FiledDoc { doc.id = keepID; decoded = doc as! T }
            if var sender = decoded as? PaperlessSender { sender.id = keepID; decoded = sender as! T }
        }
        return decoded
    }
}

final class FakeCaptureService: CaptureService {
    let files: FileStore

    init(files: FileStore) { self.files = files }

    func makeDocument(fromScans pages: [Data]) async throws -> CapturedDocument {
        try store(pdf: Self.pdf(fromTexts: ["Scanned page"]), pages: max(1, pages.count), origin: "scan", text: nil)
    }

    func importFiles(_ urls: [URL]) async throws -> [CapturedDocument] {
        try urls.map { url in
            try store(pdf: Data(contentsOf: url), pages: 1, origin: "files", text: nil)
        }
    }

    func importPhotos(_ images: [Data]) async throws -> CapturedDocument {
        try store(pdf: Self.pdf(fromTexts: ["Photo"]), pages: max(1, images.count), origin: "photos", text: nil)
    }

    func sampleDocuments() async throws -> [CapturedDocument] {
        try SampleData.pageTexts.map { text in
            try store(pdf: Self.pdf(fromTexts: [text]), pages: 1, origin: "scan", text: text)
        }
    }

    private func store(pdf: Data, pages: Int, origin: String, text: String?) throws -> CapturedDocument {
        let id = UUID()
        let name = try files.write(pdf, id: id, ext: "pdf")
        return CapturedDocument(id: id, fileName: name, pageCount: pages, sizeBytes: pdf.count,
                                contentHash: "fake-\(id.uuidString)", origin: origin, ocrText: text, thumbnailName: nil)
    }

    /// A letter-size PDF with one page per text, drawn plainly.
    static func pdf(fromTexts texts: [String]) -> Data {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        return UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            for text in texts {
                context.beginPage()
                let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 22)]
                (text as NSString).draw(in: bounds.insetBy(dx: 60, dy: 80), withAttributes: attributes)
            }
        }
    }
}

@Observable
final class FakeOutboxService: OutboxService {
    private(set) var enqueued: [UUID] = []
    var status = OutboxStatus()

    func enqueue(_ item: PipelineItem) async {
        enqueued.append(item.id)
        item.stage = .uploading
        try? await Task.sleep(for: .milliseconds(200))
        item.driveFileID = item.decision == .file ? "fake-file-\(enqueued.count)" : nil
        item.stage = item.decision == .file ? .verified : .filed
        item.filedAt = .now
        if item.decision == .file { item.verifiedAt = .now }
    }

    func retry(_ item: PipelineItem) async {
        item.stage = .queued
        await enqueue(item)
    }

    func resumePending() async {}

    private(set) var sentBack: [UUID] = []
    /// Tests: act like a verified item whose local file is already gone.
    var refuseSendBack = false

    @discardableResult func sendBack(_ item: PipelineItem) async -> Bool {
        sentBack.append(item.id)
        if refuseSendBack { return false }
        item.decision = nil
        item.decidedAt = nil
        item.stage = .ready
        item.driveFileID = nil
        item.driveURL = nil
        item.verifiedAt = nil
        item.filedAt = nil
        item.firestoreDocID = nil
        return true
    }
}
