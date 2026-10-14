// Outbox (#17, #1, #18): the engine against a fake transport and a stub Drive, the Drive REST
// client against a stubbed URLSession, and the pure rules behind the accessory and the screen.
import Foundation
import SwiftData
import Testing
@testable import PaperTrail

// MARK: - Doubles

nonisolated final class FakeTransport: UploadTransport, @unchecked Sendable {
    struct Call: Equatable { var id: UUID; var offset: Int; var total: Int }
    var calls: [Call] = []
    var queries = 0
    var failures: [any Error] = []
    var restored: Result<UploadReply, any Error>?
    var queryAnswer: ResumeState = .resumeAt(0)
    var replyID = "drive-file"
    var cancelled: [UUID] = []

    func setProgressHandler(_ handler: @escaping @Sendable (UUID, Int) -> Void) {}

    func upload(id: UUID, file: URL, to session: URL, offset: Int, total: Int, token: String?) async throws -> UploadReply {
        calls.append(Call(id: id, offset: offset, total: total))
        if !failures.isEmpty { throw failures.removeFirst() }
        return UploadReply(id: "\(replyID)-\(calls.count)", webViewLink: "https://drive.google.com/file/d/x/view", md5Checksum: nil, size: nil)
    }

    func attach(id: UUID) async -> Result<UploadReply, any Error>? {
        defer { restored = nil }
        return restored
    }

    func query(session: URL, total: Int) async throws -> ResumeState {
        queries += 1
        return queryAnswer
    }

    func cancel(id: UUID) async { cancelled.append(id) }
}

final class StubDrive: DriveService {
    var md5Answers: [String?] = []
    var defaultMD5: String?
    var downloadData = Data()
    private(set) var sessions: [(name: String, folderID: String, size: Int)] = []
    private(set) var yearFolders: [String] = []
    private(set) var trashed: [String] = []
    var startFailures: [DriveError] = []
    private(set) var rebuilds = 0

    func ensureFolders(forceRebuild: Bool) async throws -> DriveFolderCache {
        if forceRebuild { rebuilds += 1 }
        var map: [String: String] = [:]
        for name in ArchiveFolder.all { map[name] = "folder-\(name)" }
        return DriveFolderCache(root: "root", folders: map, updatedAt: "")
    }
    func ensureYearFolder(_ year: String, in folder: String) async throws -> String {
        yearFolders.append("\(folder)/\(year)")
        return "folder-\(folder)/\(year)"
    }
    func startUpload(name: String, folderID: String, mimeType: String, size: Int) async throws -> URL {
        if !startFailures.isEmpty { throw startFailures.removeFirst() }
        sessions.append((name, folderID, size))
        return URL(string: "https://upload.example/session/\(sessions.count)")!
    }
    func metadata(fileID: String) async throws -> DriveFileMetadata {
        let md5 = md5Answers.isEmpty ? defaultMD5 : md5Answers.removeFirst()
        return DriveFileMetadata(id: fileID, name: "x.pdf", md5Checksum: md5, size: nil, webViewLink: "https://drive.google.com/file/d/\(fileID)/view")
    }
    func search(_ text: String) async throws -> [DriveFileMetadata] { [] }
    func download(fileID: String) async throws -> Data { downloadData }
    func trash(fileID: String) async throws { trashed.append(fileID) }
}

final class Clock {
    var date = Date(timeIntervalSince1970: 1_790_000_000)
    func advance(_ seconds: TimeInterval) { date = date.addingTimeInterval(seconds) }
}

@MainActor
struct OutboxHarness {
    let files = FileStore.temporary()
    let container = PipelineStore.container(inMemory: true)
    let docs = FakeDocStore(seed: [])
    let auth = FakeAuthService()
    let drive = StubDrive()
    let transport = FakeTransport()
    let clock = Clock()
    let outbox: LiveOutboxService

    init() {
        let clock = clock
        outbox = LiveOutboxService(auth: auth, drive: drive, docs: docs, files: files, container: container,
                                   transport: transport, now: { clock.date })
    }

    var context: ModelContext { container.mainContext }

    /// A decided item with a real PDF on disk.
    func item(card: DocumentCard = SampleData.cards[0], decision: PipelineDecision = .file,
              decidedSecondsAgo: TimeInterval = 60, stage: PipelineStage = .queued) throws -> PipelineItem {
        let id = UUID()
        let pdf = FakeCaptureService.pdf(fromTexts: ["Page one"])
        let name = try files.write(pdf, id: id, ext: "pdf")
        let item = PipelineItem(id: id, fileName: name, pageCount: 1, sizeBytes: pdf.count, origin: "scan", stage: stage)
        item.card = card
        item.decision = decision
        item.decidedAt = clock.date.addingTimeInterval(-decidedSecondsAgo)
        context.insert(item)
        try context.save()
        return item
    }

    func localMD5(_ item: PipelineItem) async throws -> String {
        try await LiveOutboxService.md5Hex(of: files.url(for: item.fileName))
    }

    func records() async -> [FiledDoc] {
        for await list in docs.docs() { return list }
        return []
    }

    func paperless() async -> [PaperlessSender] {
        for await list in docs.paperless() { return list }
        return []
    }
}

// MARK: - Engine

@MainActor
struct OutboxEngineTests {
    @Test func fileUploadsWritesTheRecordAndVerifies() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.enqueue(item)

        #expect(item.stage == .verified)
        #expect(item.verifiedAt == h.clock.date)
        #expect(h.drive.sessions.first?.name == "2024-03-12_duke-energy-electric-bill.pdf")
        #expect(h.drive.sessions.first?.folderID == "folder-06 Home")
        #expect(h.transport.calls == [.init(id: item.id, offset: 0, total: item.sizeBytes)])
        let record = try #require(await h.records().first)
        #expect(record.filed && record.source == "ios" && record.driveId == "drive-file-1")
        #expect(record.md5 == item.md5 && record.sizeBytes == item.sizeBytes)
        #expect(record.physical == .toShred)
        #expect(record.verifiedAt == OutboxRecord.iso(h.clock.date))
        #expect(record.verifiedPages == 1)
        #expect(h.outbox.status.batchesVerified == 1)
    }

    @Test func yearlyFoldersGetAYearSubfolder() async throws {
        let h = OutboxHarness()
        var card = SampleData.cards[0]
        card.folder = "02 Taxes"
        card.docDate = "2025-01-30"
        let item = try h.item(card: card)
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.enqueue(item)
        #expect(h.drive.yearFolders == ["02 Taxes/2025"])
        #expect(h.drive.sessions.first?.folderID == "folder-02 Taxes/2025")
    }

    @Test func shredOnlyLogsWithoutDrive() async throws {
        let h = OutboxHarness()
        let item = try h.item(card: SampleData.cards[3], decision: .shredOnly)
        await h.outbox.enqueue(item)
        #expect(item.stage == .filed)
        #expect(h.transport.calls.isEmpty && h.drive.sessions.isEmpty)
        let record = try #require(await h.records().first)
        #expect(!record.filed && record.driveId.isEmpty && record.physical == .toShred && record.md5 == nil)
    }

    @Test func keepOriginalIsLoggedAsKeep() async throws {
        let h = OutboxHarness()
        let item = try h.item(card: SampleData.cards[2])
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.enqueue(item)
        #expect(await h.records().first?.physical == .keep)
    }

    @Test func failuresBackOffThenNeedAttention() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.drive.defaultMD5 = try await h.localMD5(item)
        h.transport.failures = Array(repeating: DriveError.server(503), count: 5)
        await h.outbox.enqueue(item)
        #expect(item.stage == .failed && item.attempts == 1)
        #expect(item.nextRetryAt == h.clock.date.addingTimeInterval(60))

        for delay in [120.0, 300, 900] {
            h.clock.advance(3600)
            await h.outbox.pump()
            #expect(item.nextRetryAt == h.clock.date.addingTimeInterval(delay))
        }
        h.clock.advance(3600)
        await h.outbox.pump()
        #expect(item.stage == .failed && item.nextRetryAt == nil)
        #expect(item.errorMessage == OutboxCopy.retriesUsedUp)
        #expect(h.outbox.status.itemsNeedingAttention == 1)

        // Retry by hand: the session is asked where it stands, and the upload finishes.
        h.transport.queryAnswer = .resumeAt(0)
        await h.outbox.retry(item)
        #expect(item.stage == .verified)
    }

    @Test func aRevokedDrivePausesWithoutUsingARetry() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.auth.drive = .needsReconnect
        h.transport.failures = [DriveError.unauthorized]
        await h.outbox.enqueue(item)
        #expect(h.outbox.status.needsReconnect)
        #expect(item.stage == .uploading && item.attempts == 0)

        // Reconnect Drive resumes the same item from where it stopped.
        try await h.auth.reconnectDrive()
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.resumePending()
        #expect(!h.outbox.status.needsReconnect)
        #expect(item.stage == .verified)
    }

    @Test func aSingle401WhileConnectedBacksOffInstead() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.transport.failures = [DriveError.unauthorized]
        await h.outbox.enqueue(item)
        #expect(!h.outbox.status.needsReconnect)
        #expect(item.stage == .failed && item.attempts == 1 && item.nextRetryAt != nil)
    }

    @Test func aChecksumDriveHasntComputedYetIsCheckedAgain() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        let md5 = try await h.localMD5(item)
        h.drive.md5Answers = [nil]
        h.drive.defaultMD5 = md5
        await h.outbox.enqueue(item)
        #expect(item.stage == .filed && item.nextRetryAt == h.clock.date.addingTimeInterval(60))
        #expect(OutboxSummary.needsAttention([OutboxEntry(item)]).isEmpty)
        h.clock.advance(61)
        await h.outbox.pump()
        #expect(item.stage == .verified && item.nextRetryAt == nil)
    }

    @Test func resumesFromDrivesOffsetAfterARelaunch() async throws {
        let h = OutboxHarness()
        let item = try h.item(stage: .uploading)
        item.md5 = try await h.localMD5(item)
        item.uploadSessionURL = "https://upload.example/session/old"
        item.bytesSent = 100
        h.drive.defaultMD5 = item.md5
        h.transport.queryAnswer = .resumeAt(512)
        await h.outbox.pump()
        #expect(h.transport.queries == 1)
        #expect(h.transport.calls == [.init(id: item.id, offset: 512, total: item.sizeBytes)])
        #expect(h.drive.sessions.isEmpty)
        #expect(item.stage == .verified)
    }

    @Test func aTaskThatSurvivedTheKillIsAttached() async throws {
        let h = OutboxHarness()
        let item = try h.item(stage: .uploading)
        item.md5 = try await h.localMD5(item)
        item.uploadSessionURL = "https://upload.example/session/old"
        h.drive.defaultMD5 = item.md5
        h.transport.restored = .success(UploadReply(id: "restored", webViewLink: nil, md5Checksum: nil, size: nil))
        await h.outbox.pump()
        #expect(h.transport.calls.isEmpty)
        #expect(item.driveFileID == "restored" && item.stage == .verified)
    }

    @Test func anExpiredSessionStartsANewOne() async throws {
        let h = OutboxHarness()
        let item = try h.item(stage: .uploading)
        item.md5 = try await h.localMD5(item)
        item.uploadSessionURL = "https://upload.example/session/old"
        h.drive.defaultMD5 = item.md5
        h.transport.queryAnswer = .expired
        await h.outbox.pump()
        #expect(h.drive.sessions.count == 1)
        #expect(h.transport.calls.map(\.offset) == [0])
        #expect(item.stage == .verified)
    }

    @Test func aChecksumMismatchUploadsAgainOnce() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        let md5 = try await h.localMD5(item)
        h.drive.md5Answers = ["0000", md5]
        h.drive.downloadData = FakeCaptureService.pdf(fromTexts: ["Half"])
        await h.outbox.enqueue(item)
        #expect(h.drive.trashed == ["drive-file-1"])
        #expect(item.reuploads == 1 && item.stage == .verified)
        #expect(item.driveFileID == "drive-file-2")
        #expect(await h.records().first?.driveId == "drive-file-2")
    }

    @Test func aSecondMismatchNeedsAttention() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.drive.defaultMD5 = "0000"
        h.drive.downloadData = Data()
        await h.outbox.enqueue(item)
        #expect(item.stage == .failed && item.nextRetryAt == nil)
        #expect(item.errorMessage == "Drive has 0 of 1 page. Tap Retry to upload it again.")
        #expect(h.drive.trashed.count == 2)
    }

    @Test func theUndoHoldIsRespectedOnRelaunch() async throws {
        let h = OutboxHarness()
        let item = try h.item(decidedSecondsAgo: 3)
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.pump()
        #expect(item.stage == .queued && h.transport.calls.isEmpty)
        h.clock.advance(UndoWindow.seconds)
        await h.outbox.pump()
        #expect(item.stage == .verified)
    }

    @Test func enqueueReleasesTheHoldAtOnce() async throws {
        let h = OutboxHarness()
        let item = try h.item(decidedSecondsAgo: 1)
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.enqueue(item)
        #expect(item.stage == .verified)
    }

    @Test func sendBackUndoesTheUploadAndTheRecord() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.enqueue(item)
        #expect(await h.records().count == 1)
        #expect(await h.outbox.sendBack(item))
        #expect(item.stage == .ready && item.decision == nil && item.driveFileID == nil)
        #expect(h.drive.trashed == ["drive-file-1"])
        #expect(await h.records().isEmpty)
        #expect(h.transport.cancelled == [item.id])
    }

    @Test func finishedFilesAreRemovedAfterTheUndoWindow() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.drive.defaultMD5 = try await h.localMD5(item)
        await h.outbox.enqueue(item)
        let path = h.files.url(for: item.fileName).path
        #expect(FileManager.default.fileExists(atPath: path))
        h.clock.advance(h.outbox.keepFilesFor + 1)
        h.outbox.purgeFinishedFiles()
        #expect(!FileManager.default.fileExists(atPath: path))
        #expect(await h.outbox.sendBack(item) == false)
    }

    @Test func aMissingFolderIsRebuiltOnce() async throws {
        let h = OutboxHarness()
        let item = try h.item()
        h.drive.defaultMD5 = try await h.localMD5(item)
        h.drive.startFailures = [.notFound]
        await h.outbox.enqueue(item)
        #expect(h.drive.rebuilds == 1)
        #expect(item.stage == .verified)
    }

    @Test func paperlessSenderIsCreatedThenFlaggedWhenStillMailing() async throws {
        let h = OutboxHarness()
        let first = try h.item(card: SampleData.cards[0], decision: .shredOnly)
        await h.outbox.enqueue(first)
        var sender = try #require(await h.paperless().first)
        #expect(sender.id == "duke-energy" && sender.status == .toDo && sender.stillMailingAt == nil)

        try await h.docs.updatePaperless(id: sender.id, fields: ["status": PaperlessStatus.requested.rawValue])
        h.clock.advance(86_400)
        let second = try h.item(card: SampleData.cards[0], decision: .shredOnly)
        await h.outbox.enqueue(second)
        sender = try #require(await h.paperless().first)
        #expect(sender.stillMailingAt == OutboxRecord.iso(h.clock.date))
        #expect(sender.lastSeen == OutboxRecord.iso(h.clock.date))
    }
}

// MARK: - Rules

struct OutboxRuleTests {
    let filed = Date(timeIntervalSince1970: 1_790_000_000)  // 2026-09

    @Test func onlyTheThreeYearlyFoldersGetYears() {
        #expect(DriveTarget.plan(folder: "02 Taxes", docDate: "2025-04-15", filedAt: filed) == DriveTarget(folder: "02 Taxes", year: "2025"))
        #expect(DriveTarget.plan(folder: "03 Money & Banking", docDate: "2024-01-01", filedAt: filed).cacheKey == "03 Money & Banking/2024")
        #expect(DriveTarget.plan(folder: "05 Medical", docDate: "", filedAt: filed).year == "2026")
        #expect(DriveTarget.plan(folder: "06 Home", docDate: "2025-04-15", filedAt: filed).year == nil)
        #expect(DriveTarget.plan(folder: "Nonsense", docDate: "2025-04-15", filedAt: filed).folder == "11 Other")
        #expect(DriveTarget.plan(folder: "02 Taxes", docDate: "0000-00-00", filedAt: filed).year == "2026")
    }

    @Test func backoffIsOneTwoFiveFifteen() {
        #expect((1...5).map(RetryPolicy.delay(afterAttempts:)) == [60, 120, 300, 900, nil])
    }

    @Test func copyHasNoDashesOrExclamationPoints() {
        let all = [OutboxCopy.retriesUsedUp, OutboxCopy.folderMoved, OutboxCopy.logFailed, OutboxCopy.reconnectFailed,
                   OutboxCopy.pageMismatch(drive: 1, local: 2, reuploading: true),
                   OutboxCopy.retrying(at: filed.addingTimeInterval(90), now: filed)]
        #expect(all.allSatisfy { !$0.contains("\u{2014}") && !$0.contains("!") })
        #expect(OutboxCopy.retrying(at: filed.addingTimeInterval(90), now: filed) == "Drive didn't answer. Trying again in 2 min.")
        #expect(OutboxCopy.pageMismatch(drive: 1, local: 2, reuploading: true) == "Drive has 1 of 2 pages. Uploading it again.")
    }

    @Test func paperlessPlan() {
        let card = SampleData.cards[0]
        guard case .create(let sender) = OutboxRecord.paperless(card: card, existing: nil, at: filed) else {
            Issue.record("expected create"); return
        }
        #expect(sender.id == "duke-energy" && sender.status == .toDo && sender.firstSeen == sender.lastSeen)
        var existing = sender
        existing.status = .confirmed
        #expect(OutboxRecord.paperless(card: card, existing: existing, at: filed)
                == .update(id: "duke-energy", lastSeen: OutboxRecord.iso(filed), stillMailingAt: OutboxRecord.iso(filed)))
        existing.status = .cantStop
        #expect(OutboxRecord.paperless(card: card, existing: existing, at: filed)
                == .update(id: "duke-energy", lastSeen: OutboxRecord.iso(filed), stillMailingAt: nil))
        #expect(OutboxRecord.paperless(card: SampleData.cards[2], existing: nil, at: filed) == .none)
    }

    @Test func recordMatchesTheWebShape() {
        let doc = OutboxRecord.filedDoc(card: SampleData.cards[1], pages: 2, filed: true, driveID: "d", driveURL: "u",
                                        filedAt: filed, sizeBytes: 10, md5: "abc", contentHash: "h", ocrText: "text")
        #expect(doc.filedAt.hasSuffix("Z") && doc.filedAt.contains("."))
        #expect(doc.searchTerms?.contains("blue") == true && doc.searchTerms?.contains("medical") == true)
        #expect(doc.searchTerms?.contains("2024") == true)
        #expect(doc.verifiedAt == nil && doc.source == "ios" && doc.pages == 2)
    }

    @Test func resumeStateParsing() throws {
        #expect(try BackgroundUploader.resumeState(status: 308, range: "bytes=0-1023", body: Data()) == .resumeAt(1024))
        #expect(try BackgroundUploader.resumeState(status: 308, range: nil, body: Data()) == .resumeAt(0))
        #expect(try BackgroundUploader.resumeState(status: 404, range: nil, body: Data()) == .expired)
        let done = try BackgroundUploader.resumeState(status: 200, range: nil, body: Data(#"{"id":"f1","md5Checksum":"aa"}"#.utf8))
        #expect(done == .complete(UploadReply(id: "f1", webViewLink: nil, md5Checksum: "aa", size: nil)))
        #expect(throws: DriveError.unauthorized) { try BackgroundUploader.resumeState(status: 401, range: nil, body: Data()) }
    }
}

// MARK: - Accessory and screen

struct OutboxSummaryTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    func entry(_ stage: PipelineStage, decision: PipelineDecision = .file, minutesAgo: Double = 5, sent: Int = 0,
               retry: Date? = nil, filedMinutesAgo: Double? = nil) -> OutboxEntry {
        OutboxEntry(title: "Doc", issuer: "Issuer", stage: stage, decision: decision,
                    decidedAt: now.addingTimeInterval(-minutesAgo * 60),
                    filedAt: filedMinutesAgo.map { now.addingTimeInterval(-$0 * 60) },
                    verifiedAt: stage == .verified ? now : nil, nextRetryAt: retry, sizeBytes: 1000, bytesSent: sent)
    }

    @Test func states() {
        let s = OutboxStatus()
        #expect(OutboxSummary.accessory([], status: s, driveNeedsReconnect: false, now: now) == .empty)
        #expect(OutboxSummary.accessory([entry(.verified, filedMinutesAgo: 1)], status: s, driveNeedsReconnect: false, now: now) == .caughtUp(filedToday: 1))

        let batch = [entry(.verified, minutesAgo: 6, filedMinutesAgo: 4), entry(.uploading, minutesAgo: 5, sent: 500), entry(.queued, minutesAgo: 4)]
        #expect(OutboxSummary.accessory(batch, status: s, driveNeedsReconnect: false, now: now) == .uploading(current: 2, total: 3, fraction: 0.5))
        #expect(AccessoryState.uploading(current: 2, total: 3, fraction: 0.5).title == "Uploading 2 of 3")

        var offline = s
        offline.isOnline = false
        #expect(OutboxSummary.accessory(batch, status: offline, driveNeedsReconnect: false, now: now) == .offline(saved: 2))

        let retrying = batch + [entry(.failed, retry: now.addingTimeInterval(60))]
        #expect(OutboxSummary.accessory(retrying, status: s, driveNeedsReconnect: false, now: now) == .uploading(current: 2, total: 4, fraction: 0.375))
        let attention = batch + [entry(.failed), entry(.failed)]
        #expect(OutboxSummary.accessory(attention, status: s, driveNeedsReconnect: false, now: now) == .needsRetry(2))
        #expect(AccessoryState.needsRetry(2).title == "2 need a retry" && AccessoryState.needsRetry(1).title == "1 needs a retry")
        #expect(OutboxSummary.accessory(attention, status: s, driveNeedsReconnect: true, now: now) == .reconnect)
    }

    @Test func titlesMatchTheSpec() {
        #expect(AccessoryState.caughtUp(filedToday: 14).title == "All caught up · 14 filed today")
        #expect(AccessoryState.offline(saved: 3).title == "Waiting for a connection · 3 saved on your phone")
        #expect(AccessoryState.reconnect.title == "Reconnect Drive to keep filing")
        #expect(AccessoryState.empty.title == "Outbox is empty")
        #expect(AccessoryState.uploading(current: 2, total: 5, fraction: 0).inlineText == "2 of 5")
    }

    @Test func subtitle() {
        let list = [entry(.uploading), entry(.queued), entry(.failed), entry(.verified, filedMinutesAgo: 2)]
        #expect(OutboxSummary.subtitle(list, now: now) == "2 uploading · 1 needs a retry · 1 filed today")
        #expect(OutboxSummary.subtitle([], now: now) == "Nothing waiting")
    }

    @Test func rowTitles() {
        #expect(OutboxSummary.rowTitle(title: "1099-INT", issuer: "Harbor Federal CU") == "1099-INT · Harbor Federal")
        #expect(OutboxSummary.rowTitle(title: "Electric bill", issuer: "Cascade Power & Light") == "Electric bill · Cascade Power")
        #expect(OutboxSummary.rowTitle(title: "Brightline Wireless bill", issuer: "Brightline Wireless") == "Brightline Wireless bill")
        #expect(OutboxSummary.rowTitle(title: "Vehicle title", issuer: "NC DMV") == "Vehicle title · NC DMV")
    }

    @Test func filedRowsAndEarlier() {
        let first = entry(.verified, filedMinutesAgo: 1)
        #expect(OutboxSummary.filedSubtitle(first, isFirst: true).hasPrefix("1 of 1 pages confirmed in Drive · "))
        #expect(OutboxSummary.filedSubtitle(first, isFirst: false).hasPrefix("1 of 1 pages confirmed · "))
        #expect(OutboxSummary.filedSubtitle(entry(.filed, decision: .shredOnly, filedMinutesAgo: 1), isFirst: true).hasPrefix("Logged as shredded · "))
        // #59: shred-only rows on top don't take the "in Drive" wording from the first filed row.
        let shred = entry(.filed, decision: .shredOnly, filedMinutesAgo: 0)
        #expect(OutboxSummary.firstConfirmedID([shred, first]) == first.id)
        #expect(OutboxSummary.firstConfirmedID([shred]) == nil)
        let old = entry(.verified, filedMinutesAgo: 60 * 24 * 3)
        let ancient = entry(.verified, filedMinutesAgo: 60 * 24 * 40)
        #expect(OutboxSummary.earlier([first, old, ancient], now: now).flatMap(\.entries).map(\.id) == [old.id])
    }
}

// MARK: - Drive REST

nonisolated final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, [String: String], Data))?
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var request = request
        if request.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 4096); if n <= 0 { break }; data.append(buffer, count: n) }
            stream.close()
            request.httpBody = data
        }
        Self.requests.append(request)
        let (status, headers, body) = Self.handler?(request) ?? (500, [:], Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
@Suite(.serialized)
struct LiveDriveServiceTests {
    func service(docs: FakeDocStore = FakeDocStore(seed: [])) -> LiveDriveService {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        StubURLProtocol.requests = []
        return LiveDriveService(auth: FakeAuthService(), docs: docs, session: URLSession(configuration: config))
    }

    func completeCache() -> DriveFolderCache {
        var map: [String: String] = [:]
        for name in ArchiveFolder.all { map[name] = "id-\(slug(name))" }
        return DriveFolderCache(root: "root-id", folders: map, updatedAt: "2026-10-01T00:00:00.000Z")
    }

    @Test func aCompleteWebCacheIsUsedAsIs() async throws {
        let docs = FakeDocStore(seed: [])
        try await docs.saveDriveFolders(completeCache())
        let drive = service(docs: docs)
        StubURLProtocol.handler = { _ in (500, [:], Data()) }
        let cache = try await drive.ensureFolders(forceRebuild: false)
        #expect(cache.root == "root-id")
        #expect(StubURLProtocol.requests.isEmpty)
    }

    @Test func missingFoldersAreFoundOrCreatedAndCached() async throws {
        let docs = FakeDocStore(seed: [])
        let drive = service(docs: docs)
        var created = 0
        StubURLProtocol.handler = { request in
            if request.httpMethod == "POST" {
                created += 1
                return (200, [:], Data(#"{"id":"made-\#(created)"}"#.utf8))
            }
            return (200, [:], Data(#"{"files":[]}"#.utf8))
        }
        let cache = try await drive.ensureFolders(forceRebuild: true)
        #expect(created == 12 && cache.isComplete && cache.root == "made-1")
        let first = try #require(StubURLProtocol.requests.first?.url)
        let q = URLComponents(url: first, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value
        #expect(q == "name = 'Paperwork Archive' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false")
        #expect(try await docs.driveFolders()?.folders["02 Taxes"] == "made-3")
        #expect(StubURLProtocol.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer fake-access-token" })
    }

    @Test func yearFolderIsCachedUnderItsKey() async throws {
        let docs = FakeDocStore(seed: [])
        try await docs.saveDriveFolders(completeCache())
        let drive = service(docs: docs)
        StubURLProtocol.handler = { _ in (200, [:], Data(#"{"files":[{"id":"y2025","name":"2025"}]}"#.utf8)) }
        let id = try await drive.ensureYearFolder("2025", in: "02 Taxes")
        #expect(id == "y2025")
        let saved = try #require(try await docs.driveFolders())
        #expect(saved.folders["02 Taxes/2025"] == "y2025" && saved.isComplete)
        _ = try await drive.ensureYearFolder("2025", in: "02 Taxes")
        #expect(StubURLProtocol.requests.count == 1)
    }

    @Test func startUploadAsksForAResumableSession() async throws {
        let drive = service()
        StubURLProtocol.handler = { _ in (200, ["Location": "https://upload.example/s1"], Data()) }
        let url = try await drive.startUpload(name: "a.pdf", folderID: "f1", mimeType: "application/pdf", size: 1234)
        #expect(url.absoluteString == "https://upload.example/s1")
        let request = try #require(StubURLProtocol.requests.first)
        #expect(request.url?.query?.contains("uploadType=resumable") == true)
        #expect(request.url?.query?.contains("md5Checksum") == true)
        #expect(request.value(forHTTPHeaderField: "X-Upload-Content-Length") == "1234")
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        #expect(body?["name"] as? String == "a.pdf" && (body?["parents"] as? [String]) == ["f1"])
    }

    @Test func unauthorizedAfterOneRefresh() async throws {
        let drive = service()
        StubURLProtocol.handler = { _ in (401, [:], Data()) }
        await #expect(throws: DriveError.unauthorized) { try await drive.metadata(fileID: "x") }
        #expect(StubURLProtocol.requests.count == 2)
    }

    @Test func metadataReadsTheChecksum() async throws {
        let drive = service()
        StubURLProtocol.handler = { _ in (200, [:], Data(#"{"id":"x","name":"a.pdf","md5Checksum":"abc","size":"42","webViewLink":"https://d/x"}"#.utf8)) }
        let meta = try await drive.metadata(fileID: "x")
        #expect(meta.md5Checksum == "abc" && meta.size == 42 && meta.webViewLink == "https://d/x")
    }
}

// MARK: - Shred hold

@MainActor
struct ShredHoldTests {
    @Test func savesToSettings() async throws {
        let docs = FakeDocStore(seed: [])
        let model = ShredHoldModel(docs: docs)
        await model.load()
        #expect(model.days == 0 && ShredHoldModel.label(0) == "None")
        await model.choose(3)
        #expect(try await docs.settings().shredHoldDays == 3)
        #expect(ShredHoldModel.label(3) == "3 days" && ShredHoldModel.label(1) == "1 day")
    }
}
