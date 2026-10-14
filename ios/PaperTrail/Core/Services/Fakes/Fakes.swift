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

    init(signedIn: Bool = true) {
        let bryce = Account(uid: "fake-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls")
        state = signedIn ? .signedIn(bryce) : .signedOut
    }

    func signIn() async throws {
        state = .signedIn(Account(uid: "fake-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls"))
        drive = .connected
    }
    func reconnectDrive() async throws { drive = .connected }
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

    func search(_ text: String) async throws -> [DriveFileMetadata] { [] }
}

final class FakeDocStore: DocStore {
    private var docList: [FiledDoc]
    private var senders: [PaperlessSender] = []
    private var rules: [String: SenderRule] = [:]
    private var folderCache: DriveFolderCache?
    private var docWatchers: [UUID: AsyncStream<[FiledDoc]>.Continuation] = [:]
    private var paperlessWatchers: [UUID: AsyncStream<[PaperlessSender]>.Continuation] = [:]

    init(seed: [FiledDoc] = SampleData.filedDocs(), rules: [SenderRule] = SampleData.senderRules) {
        docList = seed
        self.rules = Dictionary(uniqueKeysWithValues: rules.map { ($0.key, $0) })
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
        guard let index = docList.firstIndex(where: { $0.id == id }) else { return }
        if let raw = fields["physical"] as? String, let state = PhysicalState(rawValue: raw) { docList[index].physical = state }
        if let at = fields["shreddedAt"] as? String { docList[index].shreddedAt = at }
        if let at = fields["verifiedAt"] as? String { docList[index].verifiedAt = at }
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
        guard let index = senders.firstIndex(where: { $0.id == id }) else { return }
        if let raw = fields["status"] as? String, let status = PaperlessStatus(rawValue: raw) { senders[index].status = status }
        publishPaperless()
    }

    func senderRules() async throws -> [SenderRule] { Array(rules.values) }
    func saveSenderRule(_ rule: SenderRule) async throws { rules[rule.key] = rule }
    func deleteSenderRule(key: String) async throws { rules[key] = nil }

    func driveFolders() async throws -> DriveFolderCache? { folderCache }
    func saveDriveFolders(_ cache: DriveFolderCache) async throws { folderCache = cache }

    private func publishDocs() { for c in docWatchers.values { c.yield(docList) } }
    private func publishPaperless() { for c in paperlessWatchers.values { c.yield(senders) } }
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

final class FakeOutboxService: OutboxService {
    private(set) var enqueued: [UUID] = []

    func enqueue(_ item: PipelineItem) async {
        enqueued.append(item.id)
        item.stage = .uploading
        try? await Task.sleep(for: .milliseconds(200))
        item.driveFileID = item.decision == .file ? "fake-file-\(enqueued.count)" : nil
        item.stage = item.decision == .file ? .verified : .filed
        if item.decision == .file { item.verifiedAt = .now }
    }

    func retry(_ item: PipelineItem) async {
        item.stage = .queued
        await enqueue(item)
    }

    func resumePending() async {}
}
