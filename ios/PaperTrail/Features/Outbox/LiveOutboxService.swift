// Owner: outbox. The local-first outbox (#17): every decided item is in SwiftData with its PDF on
// disk, and this engine walks it through Drive and Firestore one at a time:
//
//   queued    -> folders found, local MD5 taken, resumable session started      -> uploading
//   uploading -> bytes PUT by the background session (resumes from Drive's offset)
//             -> Firestore record (and paperless sender) written                -> filed
//   filed     -> Drive's md5Checksum compared with the local MD5 (#18)          -> verified
//
// A shred decision skips Drive: record written, then filed. Failures back off 1, 2, 5 and 15
// minutes, then wait for Retry. No connection and Drive needing a reconnect pause the queue
// without using up retries. The deck's undo hold (UndoWindow) is respected on relaunch.
import CryptoKit
import Foundation
import Network
import PDFKit
import SwiftData

@Observable
final class LiveOutboxService: OutboxService {
    private(set) var status = OutboxStatus()

    @ObservationIgnored private let auth: any AuthService
    @ObservationIgnored private let drive: any DriveService
    @ObservationIgnored private let docs: any DocStore
    @ObservationIgnored private let files: FileStore
    @ObservationIgnored private let container: ModelContainer
    @ObservationIgnored private let transport: any UploadTransport
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var released: Set<UUID> = []
    @ObservationIgnored private var pumping = false
    @ObservationIgnored private var pumpAgain = false
    @ObservationIgnored private var wakeTask: Task<Void, Never>?
    @ObservationIgnored private var monitor: NWPathMonitor?
    /// How long a finished item keeps its PDF, so the deck's late Undo can still send it back.
    @ObservationIgnored var keepFilesFor: TimeInterval = 10 * 60

    private var context: ModelContext { container.mainContext }

    init(auth: any AuthService, drive: any DriveService, docs: any DocStore, files: FileStore,
         container: ModelContainer, transport: any UploadTransport = BackgroundUploader.shared,
         now: @escaping () -> Date = { .now }) {
        self.auth = auth
        self.drive = drive
        self.docs = docs
        self.files = files
        self.container = container
        self.transport = transport
        self.now = now
        transport.setProgressHandler { [weak self] id, sent in
            Task { @MainActor in self?.progress(id: id, sent: sent) }
        }
    }

    // MARK: OutboxService

    func enqueue(_ item: PipelineItem) async {
        released.insert(item.id)
        await pump()
    }

    func retry(_ item: PipelineItem) async {
        guard item.stage == .failed else { return }
        item.attempts = 0
        item.nextRetryAt = .distantPast
        if item.errorMessage?.hasPrefix("Drive has") == true {
            // Page mismatch: upload a fresh copy.
            item.reuploads = 0
        }
        released.insert(item.id)
        await pump()
    }

    func resumePending() async {
        startMonitor()
        if auth.drive == .connected { status.needsReconnect = false }
        await pump()
    }

    @discardableResult
    func sendBack(_ item: PipelineItem) async -> Bool {
        guard FileManager.default.fileExists(atPath: files.url(for: item.fileName).path) else { return false }
        await transport.cancel(id: item.id)
        if let fileID = item.driveFileID { try? await drive.trash(fileID: fileID) }
        if let docID = item.firestoreDocID { try? await docs.deleteDoc(id: docID) }
        released.remove(item.id)
        let top = (PipelineStore.items(in: .ready, context: context).first?.createdAt ?? now()).addingTimeInterval(-1)
        item.createdAt = min(item.createdAt, top)
        item.decision = nil
        item.decidedAt = nil
        item.uploadSessionURL = nil
        item.bytesSent = 0
        item.driveFileID = nil
        item.driveURL = nil
        item.verifiedAt = nil
        item.firestoreDocID = nil
        item.filedAt = nil
        item.nextRetryAt = nil
        item.errorMessage = nil
        item.failedStageRaw = nil
        item.attempts = 0
        item.reuploads = 0
        item.stage = .ready
        try? context.save()
        return true
    }

    // MARK: The queue

    /// Runs items one at a time until nothing is ready to move, then sleeps until the next retry
    /// or the end of an undo hold.
    func pump() async {
        if pumping { pumpAgain = true; return }
        pumping = true
        defer { pumping = false }
        repeat {
            pumpAgain = false
            purgeFinishedFiles()
            var tried: Set<UUID> = []
            while !status.needsReconnect, status.isOnline, let item = nextWork(excluding: tried) {
                tried.insert(item.id)
                await process(item)
            }
        } while pumpAgain
        scheduleWake()
    }

    func nextWork(excluding tried: Set<UUID>) -> PipelineItem? {
        let date = now()
        let all = (try? context.fetch(FetchDescriptor<PipelineItem>(sortBy: [SortDescriptor(\.decidedAt)]))) ?? []
        return all.first { item in
            guard !tried.contains(item.id), item.decision == .file || item.decision == .shredOnly else { return false }
            switch item.stage {
            case .queued: return isReleased(item, at: date)
            case .uploading: return true
            case .filed: return item.decision == .file && item.verifiedAt == nil && (item.nextRetryAt.map { $0 <= date } ?? true)
            case .failed: return item.nextRetryAt.map { $0 <= date } ?? false
            default: return false
            }
        }
    }

    func isReleased(_ item: PipelineItem, at date: Date) -> Bool {
        released.contains(item.id) || (item.decidedAt.map { date.timeIntervalSince($0) >= UndoWindow.seconds } ?? true)
    }

    private func process(_ item: PipelineItem) async {
        if item.stage == .failed {
            item.stage = item.failedStageRaw.flatMap(PipelineStage.init(rawValue:)) ?? .queued
            item.nextRetryAt = nil
        }
        let startedAt = item.stage
        do {
            if item.stage == .queued {
                if item.decision == .shredOnly {
                    try await writeRecord(item)
                } else {
                    try await prepare(item)
                }
            }
            if item.stage == .uploading {
                try await upload(item)
                try await writeRecord(item)
            }
            if item.stage == .filed && item.decision == .file {
                try await verify(item)
            }
            item.attempts = 0
            item.nextRetryAt = nil
            item.errorMessage = nil
            item.failedStageRaw = nil
        } catch {
            handle(error, item: item, startedAt: startedAt)
        }
        try? context.save()
    }

    // MARK: Steps

    private func prepare(_ item: PipelineItem) async throws {
        guard let card = item.card else { throw OutboxStepError.message("This card has no details yet. Send it back to the deck.") }
        if item.md5 == nil {
            let url = files.url(for: item.fileName)
            item.md5 = try await Self.md5Hex(of: url)
            if let size = try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int { item.sizeBytes = size }
        }
        let target = DriveTarget.plan(folder: card.folder, docDate: card.docDate, filedAt: item.decidedAt ?? now())
        let name = card.filename + ".pdf"
        let session: URL
        do {
            session = try await startSession(target: target, name: name, size: item.sizeBytes, rebuild: false)
        } catch DriveError.notFound {
            // The folder was deleted or trashed in Drive: make the set again, once (same as the web app).
            item.errorMessage = OutboxCopy.folderMoved
            session = try await startSession(target: target, name: name, size: item.sizeBytes, rebuild: true)
        }
        item.uploadSessionURL = session.absoluteString
        item.bytesSent = 0
        item.stage = .uploading
        try? context.save()
    }

    private func startSession(target: DriveTarget, name: String, size: Int, rebuild: Bool) async throws -> URL {
        let cache = try await drive.ensureFolders(forceRebuild: rebuild)
        let folderID: String
        if let year = target.year {
            folderID = try await drive.ensureYearFolder(year, in: target.folder)
        } else {
            guard let id = cache.folders[target.folder] else { throw DriveError.notFound }
            folderID = id
        }
        return try await drive.startUpload(name: name, folderID: folderID, mimeType: "application/pdf", size: size)
    }

    /// PUTs the bytes. A session made earlier is asked where it stands first, so a relaunch or a
    /// dropped connection resumes from Drive's offset instead of starting over. An expired
    /// session is replaced once.
    private func upload(_ item: PipelineItem) async throws {
        guard item.driveFileID == nil else { return }  // uploaded earlier; only the record is left
        for _ in 0..<2 {
            var fresh = false
            if item.uploadSessionURL == nil {
                item.stage = .queued
                try await prepare(item)
                fresh = true
            }
            guard let raw = item.uploadSessionURL, let session = URL(string: raw) else { throw DriveError.server(0) }
            do {
                let reply = try await uploadOnce(item, session: session, fresh: fresh)
                accept(reply, item: item)
                return
            } catch UploadFailure.sessionExpired {
                item.uploadSessionURL = nil
                item.bytesSent = 0
            }
        }
        throw DriveError.server(410)
    }

    private func uploadOnce(_ item: PipelineItem, session: URL, fresh: Bool) async throws -> UploadReply {
        var mustQuery = !fresh
        if !fresh, let restored = await transport.attach(id: item.id) {
            switch restored {
            case .success(let reply): return reply
            case .failure(UploadFailure.sessionExpired): throw UploadFailure.sessionExpired
            case .failure: mustQuery = true
            }
        }
        var offset = 0
        if mustQuery {
            switch try await transport.query(session: session, total: item.sizeBytes) {
            case .complete(let done): return done
            case .resumeAt(let at): offset = at
            case .expired: throw UploadFailure.sessionExpired
            }
        }
        item.bytesSent = offset
        let token = try? await auth.driveAccessToken()
        return try await transport.upload(id: item.id, file: files.url(for: item.fileName), to: session,
                                          offset: offset, total: item.sizeBytes, token: token)
    }

    private func accept(_ reply: UploadReply, item: PipelineItem) {
        item.driveFileID = reply.id
        item.driveURL = reply.webViewLink ?? "https://drive.google.com/file/d/\(reply.id)/view"
        item.bytesSent = item.sizeBytes
        item.uploadSessionURL = nil
        status.lastUploadAt = now()
    }

    /// The Firestore record (users/{uid}/docs) and the paperless sender, like the web app's saveRecord().
    private func writeRecord(_ item: PipelineItem) async throws {
        guard let card = item.card else { throw OutboxStepError.message("This card has no details yet. Send it back to the deck.") }
        let filed = item.decision == .file
        let at = item.filedAt ?? now()
        do {
            if let docID = item.firestoreDocID {
                if filed { try await docs.updateDoc(id: docID, fields: ["driveId": item.driveFileID ?? "", "driveUrl": item.driveURL ?? ""]) }
            } else {
                let record = OutboxRecord.filedDoc(card: card, pages: item.pageCount, filed: filed,
                                                   driveID: item.driveFileID, driveURL: item.driveURL, filedAt: at,
                                                   sizeBytes: item.sizeBytes, md5: item.md5,
                                                   contentHash: item.contentHash, ocrText: item.ocrText)
                item.firestoreDocID = try await docs.addDoc(record)
                try? context.save()
                try await recordPaperless(card, at: at)
            }
        } catch let error as DriveError {
            throw error
        } catch {
            throw OutboxStepError.message(filed ? OutboxCopy.logFailed : "Couldn't save this to your log. Tap Retry to try again.")
        }
        item.filedAt = at
        item.stage = .filed
        if !filed { finished(item) }
    }

    private func recordPaperless(_ card: DocumentCard, at date: Date) async throws {
        guard card.paperless.possible else { return }
        let id = slug(card.paperless.issuer.isEmpty ? card.issuer : card.paperless.issuer)
        var existing: PaperlessSender?
        for await list in docs.paperless() {
            existing = list.first { $0.id == id }
            break
        }
        switch OutboxRecord.paperless(card: card, existing: existing, at: date) {
        case .none: break
        case .create(let sender): try await docs.setPaperless(sender)
        case .update(let id, let lastSeen, let stillMailing):
            var fields: [String: any Sendable] = ["lastSeen": lastSeen]
            if let stillMailing { fields["stillMailingAt"] = stillMailing }
            try await docs.updatePaperless(id: id, fields: fields)
        }
    }

    /// #18: Drive's md5Checksum must match the local MD5 before the doc counts as safe to shred.
    private func verify(_ item: PipelineItem) async throws {
        guard let fileID = item.driveFileID else { item.stage = .uploading; return }
        let meta = try await drive.metadata(fileID: fileID)
        guard let remote = meta.md5Checksum else { throw OutboxStepError.pending }
        if let local = item.md5, remote.lowercased() == local.lowercased() {
            let at = now()
            item.verifiedAt = at
            if let docID = item.firestoreDocID {
                try await docs.updateDoc(id: docID, fields: ["verifiedAt": OutboxRecord.iso(at), "verifiedPages": item.pageCount])
            }
            item.stage = .verified
            item.errorMessage = nil
            finished(item)
            return
        }
        // The copy in Drive isn't ours byte for byte: count its pages for the message, then
        // upload a fresh copy once.
        let data = (try? await drive.download(fileID: fileID)) ?? Data()
        let drivePages = await Self.pageCount(of: data)
        try? await drive.trash(fileID: fileID)
        item.driveFileID = nil
        item.driveURL = nil
        item.uploadSessionURL = nil
        item.bytesSent = 0
        if item.reuploads < 1 {
            item.reuploads += 1
            item.errorMessage = OutboxCopy.pageMismatch(drive: drivePages, local: item.pageCount, reuploading: true)
            item.stage = .queued
            try await prepare(item)
            try await upload(item)
            try await writeRecord(item)
            try await verify(item)
        } else {
            item.stage = .queued
            throw OutboxStepError.exhausted(OutboxCopy.pageMismatch(drive: drivePages, local: item.pageCount, reuploading: false))
        }
    }

    // MARK: Failures

    private func handle(_ error: any Error, item: PipelineItem, startedAt: PipelineStage) {
        let at = item.stage == .failed ? startedAt : item.stage
        switch error {
        case DriveError.unauthorized where auth.drive == .needsReconnect:
            // The server says the refresh token is gone (spec 4.16): paused, not failed.
            // Reconnect Drive resumes it. No retry is used up. A single 401 while the server
            // still holds a token is an ordinary failure and backs off below.
            status.needsReconnect = true
            return
        case DriveError.network:
            if monitor?.currentPath.status != .satisfied && monitor != nil {
                status.isOnline = false
                return
            }
        case OutboxStepError.exhausted(let message):
            item.fail(at: at, message)
            item.nextRetryAt = nil
            status.itemsNeedingAttention += 1
            return
        case OutboxStepError.pending:
            // Drive hasn't computed the checksum yet. The item stays filed ("Checking the Drive
            // copy") and is asked again on the backoff schedule; it only needs attention once
            // every try is used up.
            item.attempts += 1
            if let delay = RetryPolicy.delay(afterAttempts: item.attempts) {
                item.stage = .filed
                item.nextRetryAt = now().addingTimeInterval(delay)
            } else {
                item.fail(at: .filed, OutboxCopy.retriesUsedUp)
                item.nextRetryAt = nil
                status.itemsNeedingAttention += 1
            }
            return
        default:
            break
        }
        item.attempts += 1
        let message: String
        if case OutboxStepError.message(let text) = error { message = text } else { message = OutboxCopy.retriesUsedUp }
        item.fail(at: at, message)
        if let delay = RetryPolicy.delay(afterAttempts: item.attempts) {
            item.nextRetryAt = now().addingTimeInterval(delay)
        } else {
            item.nextRetryAt = nil
            status.itemsNeedingAttention += 1
        }
    }

    // MARK: Finishing

    private func finished(_ item: PipelineItem) {
        released.remove(item.id)
        status.lastUploadAt = item.decision == .file ? now() : status.lastUploadAt
        if item.decision == .file && !hasActiveUploads(besides: item.id) { status.batchesVerified += 1 }
    }

    private func hasActiveUploads(besides id: UUID) -> Bool {
        let all = (try? context.fetch(FetchDescriptor<PipelineItem>())) ?? []
        return all.contains { $0.id != id && OutboxEntry($0).isActive && $0.decision == .file }
    }

    /// Removes the PDF and thumbnail of items the outbox finished a while ago (ARCHITECTURE.md:
    /// deleted once verified, or filed for a shred). The short delay keeps the deck's late Undo working.
    func purgeFinishedFiles() {
        let cutoff = now().addingTimeInterval(-keepFilesFor)
        let all = (try? context.fetch(FetchDescriptor<PipelineItem>())) ?? []
        for item in all where OutboxEntry(item).isDone && (item.filedAt ?? .distantPast) <= cutoff {
            let path = files.url(for: item.fileName).path
            guard FileManager.default.fileExists(atPath: path) else { continue }
            files.remove(item.fileName)
            if let thumb = item.thumbnailName { files.remove(thumb) }
        }
    }

    // MARK: Progress, network, timers

    private func progress(id: UUID, sent: Int) {
        let raw = id
        let descriptor = FetchDescriptor<PipelineItem>(predicate: #Predicate { $0.id == raw })
        guard let item = try? context.fetch(descriptor).first, item.stage == .uploading else { return }
        item.bytesSent = min(sent, item.sizeBytes)
    }

    private func startMonitor() {
        guard monitor == nil else { return }
        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.status.isOnline != online else { return }
                self.status.isOnline = online
                if online { await self.pump() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "papertrail.outbox.network"))
    }

    /// Sleeps until the earliest retry or undo-hold end, then pumps again.
    private func scheduleWake() {
        wakeTask?.cancel()
        let date = now()
        let all = (try? context.fetch(FetchDescriptor<PipelineItem>())) ?? []
        let times = all.compactMap { item -> Date? in
            if item.stage == .failed || item.stage == .filed { return item.nextRetryAt }
            if item.stage == .queued, !isReleased(item, at: date), let decided = item.decidedAt {
                return decided.addingTimeInterval(UndoWindow.seconds)
            }
            return nil
        }
        guard let next = times.min() else { return }
        let wait = max(0.5, next.timeIntervalSince(date))
        wakeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            await self?.pump()
        }
    }

    /// The system relaunched the app for the background session: reconnect it, let it deliver
    /// its events, then carry on with whatever finished.
    static func handleBackgroundEvents(_ env: AppEnvironment) async {
        BackgroundUploader.shared.reconnect()
        await BackgroundUploader.shared.waitForBackgroundEvents()
        await env.outbox.resumePending()
    }

    // MARK: Off the main actor

    @concurrent nonisolated static func md5Hex(of url: URL) async throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = Insecure.MD5()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    @concurrent nonisolated static func pageCount(of data: Data) async -> Int {
        PDFDocument(data: data)?.pageCount ?? 0
    }
}

nonisolated enum OutboxStepError: Error, Sendable, Equatable {
    /// Friendly copy for the row.
    case message(String)
    /// No more automatic tries: straight to Needs attention with this copy.
    case exhausted(String)
    /// Drive hasn't computed the checksum yet; check again shortly.
    case pending
}
