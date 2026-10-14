// Owner: outbox. PUTs a file to a Drive resumable session with a background URLSession, so the
// upload keeps going while the app is suspended and the system relaunches the app to report it
// if the app was killed. Each task is tagged with the PipelineItem's UUID (taskDescription), so a
// relaunched app can find its tasks again. Nothing here depends on the bundle ID.
import Foundation

/// What Drive returns when the last byte lands (the `fields` asked for in startUpload).
nonisolated struct UploadReply: Sendable, Hashable, Decodable {
    var id: String
    var webViewLink: String?
    var md5Checksum: String?
    var size: String?
}

/// Where a session stands, from a `Content-Range: bytes */total` status query.
nonisolated enum ResumeState: Sendable, Hashable {
    case complete(UploadReply)
    /// Drive has bytes 0..<offset. Upload the rest from offset.
    case resumeAt(Int)
    /// The session URI is gone (404 or 410): start a new session.
    case expired
}

nonisolated enum UploadFailure: Error, Sendable, Hashable {
    case sessionExpired
    case cancelled
}

/// The seam between the outbox engine and the network, so the engine is tested without
/// background sessions (which can't run in unit tests).
nonisolated protocol UploadTransport: AnyObject, Sendable {
    /// Called with (item id, total bytes Drive has so far) as the upload moves.
    func setProgressHandler(_ handler: @escaping @Sendable (UUID, Int) -> Void)
    /// Uploads `file` from byte `offset` to the end. Returns when Drive answers.
    func upload(id: UUID, file: URL, to session: URL, offset: Int, total: Int, token: String?) async throws -> UploadReply
    /// A task for this item that survived a relaunch, awaited to the end. Nil when there is none.
    func attach(id: UUID) async -> Result<UploadReply, any Error>?
    func query(session: URL, total: Int) async throws -> ResumeState
    func cancel(id: UUID) async
}

nonisolated final class BackgroundUploader: NSObject, UploadTransport, URLSessionDataDelegate, @unchecked Sendable {
    /// Arbitrary, not derived from the bundle ID.
    static let identifier = "papertrail.outbox.uploads"
    static let shared = BackgroundUploader()

    private let lock = NSLock()
    private var bodies: [Int: Data] = [:]
    private var offsets: [String: Int] = [:]
    private var waiters: [String: CheckedContinuation<UploadReply, any Error>] = [:]
    private var finished: [String: Result<UploadReply, any Error>] = [:]
    private var eventWaiters: [CheckedContinuation<Void, Never>] = []
    private var progress: (@Sendable (UUID, Int) -> Void)?
    private let sliceDirectory = URL.cachesDirectory.appending(path: "outbox-slices", directoryHint: .isDirectory)

    private var storedSession: URLSession?

    private var session: URLSession {
        lock.withLock {
            if let storedSession { return storedSession }
            let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
            config.isDiscretionary = false
            config.sessionSendsLaunchEvents = true
            config.allowsCellularAccess = true
            let made = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            storedSession = made
            return made
        }
    }

    /// Recreates the session so a relaunched app receives the events of tasks it started earlier.
    func reconnect() { _ = session }

    func setProgressHandler(_ handler: @escaping @Sendable (UUID, Int) -> Void) {
        lock.withLock { progress = handler }
    }

    func upload(id: UUID, file: URL, to sessionURL: URL, offset: Int, total: Int, token: String?) async throws -> UploadReply {
        let key = id.uuidString
        var request = URLRequest(url: sessionURL)
        request.httpMethod = "PUT"
        request.setValue("application/pdf", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        var source = file
        if offset > 0 {
            request.setValue("bytes \(offset)-\(total - 1)/\(total)", forHTTPHeaderField: "Content-Range")
            source = try writeSlice(of: file, from: offset, key: key)
        }
        let task = session.uploadTask(with: request, fromFile: source)
        task.taskDescription = key
        return try await withCheckedThrowingContinuation { continuation in
            lock.withLock {
                finished[key] = nil
                offsets[key] = offset
                waiters[key] = continuation
            }
            task.resume()
        }
    }

    func attach(id: UUID) async -> Result<UploadReply, any Error>? {
        let key = id.uuidString
        if let done = lock.withLock({ finished.removeValue(forKey: key) }) { return done }
        let tasks = await session.allTasks
        guard tasks.contains(where: { $0.taskDescription == key && $0.state == .running }) else { return nil }
        do {
            let reply = try await withCheckedThrowingContinuation { continuation in
                let early: Result<UploadReply, any Error>? = lock.withLock {
                    if let done = finished.removeValue(forKey: key) { return done }
                    waiters[key] = continuation
                    return nil
                }
                if let early { continuation.resume(with: early) }
            }
            return .success(reply)
        } catch {
            return .failure(error)
        }
    }

    func query(session sessionURL: URL, total: Int) async throws -> ResumeState {
        var request = URLRequest(url: sessionURL)
        request.httpMethod = "PUT"
        request.setValue("0", forHTTPHeaderField: "Content-Length")
        request.setValue("bytes */\(total)", forHTTPHeaderField: "Content-Range")
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.upload(for: request, from: Data()) } catch {
            throw DriveError.network("\(error)")
        }
        guard let http = response as? HTTPURLResponse else { throw DriveError.server(0) }
        return try Self.resumeState(status: http.statusCode, range: http.value(forHTTPHeaderField: "Range"), body: data)
    }

    /// 308 with "Range: bytes=0-1234" means Drive has 1235 bytes; no Range means none.
    static func resumeState(status: Int, range: String?, body: Data) throws -> ResumeState {
        switch status {
        case 200, 201: return .complete(try decodeReply(body))
        case 308:
            guard let range, let last = range.split(separator: "-").last, let end = Int(last) else { return .resumeAt(0) }
            return .resumeAt(end + 1)
        case 404, 410: return .expired
        default: throw LiveDriveService.error(status: status, body: body) ?? DriveError.server(status)
        }
    }

    static func decodeReply(_ body: Data) throws -> UploadReply {
        do { return try JSONDecoder().decode(UploadReply.self, from: body) } catch { throw DriveError.server(200) }
    }

    func cancel(id: UUID) async {
        let key = id.uuidString
        for task in await session.allTasks where task.taskDescription == key { task.cancel() }
    }

    /// Waits until the system has delivered every event for a background relaunch (or 25 s).
    func waitForBackgroundEvents() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await withCheckedContinuation { c in self.lock.withLock { self.eventWaiters.append(c) } } }
            group.addTask { try? await Task.sleep(for: .seconds(25)) }
            await group.next()
            group.cancelAll()
            let pending = self.lock.withLock { () -> [CheckedContinuation<Void, Never>] in
                defer { self.eventWaiters.removeAll() }
                return self.eventWaiters
            }
            pending.forEach { $0.resume() }
        }
    }

    private func writeSlice(of file: URL, from offset: Int, key: String) throws -> URL {
        try FileManager.default.createDirectory(at: sliceDirectory, withIntermediateDirectories: true)
        let out = sliceDirectory.appending(path: "\(key).part")
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(offset))
        let rest = try handle.readToEnd() ?? Data()
        try rest.write(to: out, options: .atomic)
        return out
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.withLock { bodies[dataTask.taskIdentifier, default: Data()].append(data) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let key = task.taskDescription, let id = UUID(uuidString: key) else { return }
        let (handler, offset) = lock.withLock { (progress, offsets[key] ?? 0) }
        handler?(id, offset + Int(totalBytesSent))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let key = task.taskDescription else { return }
        let body = lock.withLock { bodies.removeValue(forKey: task.taskIdentifier) ?? Data() }
        let result: Result<UploadReply, any Error>
        if let error {
            let code = (error as? URLError)?.code
            result = .failure(code == .cancelled ? UploadFailure.cancelled : DriveError.network("\(code?.rawValue ?? -1)"))
        } else if let http = task.response as? HTTPURLResponse {
            switch http.statusCode {
            case 200, 201: result = Result { try Self.decodeReply(body) }
            case 404, 410: result = .failure(UploadFailure.sessionExpired)
            case 308: result = .failure(DriveError.server(308))
            default: result = .failure(LiveDriveService.error(status: http.statusCode, body: body) ?? DriveError.server(http.statusCode))
            }
        } else {
            result = .failure(DriveError.server(0))
        }
        try? FileManager.default.removeItem(at: sliceDirectory.appending(path: "\(key).part"))
        let waiter = lock.withLock { () -> CheckedContinuation<UploadReply, any Error>? in
            offsets[key] = nil
            if let waiter = waiters.removeValue(forKey: key) { return waiter }
            finished[key] = result
            return nil
        }
        waiter?.resume(with: result)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let pending = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
            defer { eventWaiters.removeAll() }
            return eventWaiters
        }
        pending.forEach { $0.resume() }
    }
}
