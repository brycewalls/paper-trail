// Owner: outbox. Drive REST v3 with the drive.file scope, the same calls the web app makes
// (public/index.html, findOrCreateFolder / ensureFolders / uploadFile). The bytes themselves go
// up through BackgroundUploader; this file starts the session and does everything else.
import Foundation

final class LiveDriveService: DriveService {
    static let api = URL(string: "https://www.googleapis.com/drive/v3/files")!
    static let upload = URL(string: "https://www.googleapis.com/upload/drive/v3/files")!
    static let folderMime = "application/vnd.google-apps.folder"

    private let auth: any AuthService
    private let docs: any DocStore
    private let session: URLSession
    private var cache: DriveFolderCache?

    init(auth: any AuthService, docs: any DocStore, session: URLSession = .shared) {
        self.auth = auth
        self.docs = docs
        self.session = session
    }

    // MARK: Folders

    func ensureFolders(forceRebuild: Bool) async throws -> DriveFolderCache {
        if !forceRebuild {
            if let cache, cache.isComplete { return cache }
            if let stored = try? await docs.driveFolders(), stored.isComplete, !stored.root.isEmpty {
                cache = stored
                return stored
            }
        }
        let root = try await findOrCreateFolder(ArchiveFolder.rootName, parent: "root")
        var map: [String: String] = [:]
        for name in ArchiveFolder.all { map[name] = try await findOrCreateFolder(name, parent: root) }
        let built = DriveFolderCache(root: root, folders: map, updatedAt: OutboxRecord.iso(.now))
        cache = built
        try? await docs.saveDriveFolders(built)
        return built
    }

    func ensureYearFolder(_ year: String, in folder: String) async throws -> String {
        var current = try await ensureFolders(forceRebuild: false)
        let key = "\(folder)/\(year)"
        if let id = current.folders[key] { return id }
        guard let parent = current.folders[folder] else { throw DriveError.notFound }
        let id = try await findOrCreateFolder(year, parent: parent)
        current.folders[key] = id
        current.updatedAt = OutboxRecord.iso(.now)
        cache = current
        try? await docs.saveDriveFolders(current)
        return id
    }

    /// The web app's query: same name, a folder, inside the parent, not trashed.
    func findOrCreateFolder(_ name: String, parent: String) async throws -> String {
        let query = "name = '\(Self.escape(name))' and mimeType = '\(Self.folderMime)' and '\(Self.escape(parent))' in parents and trashed = false"
        var components = URLComponents(url: Self.api, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query), URLQueryItem(name: "fields", value: "files(id,name)"),
            URLQueryItem(name: "spaces", value: "drive"), URLQueryItem(name: "pageSize", value: "10"),
        ]
        let found: FileList = try await json(URLRequest(url: components.url!))
        if let first = found.files.first { return first.id }

        var create = URLRequest(url: Self.api.appending(queryItems: [URLQueryItem(name: "fields", value: "id")]))
        create.httpMethod = "POST"
        create.setValue("application/json; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "mimeType": Self.folderMime, "parents": [parent]])
        let made: FileRef = try await json(create)
        return made.id
    }

    // MARK: Files

    func startUpload(name: String, folderID: String, mimeType: String, size: Int) async throws -> URL {
        var request = URLRequest(url: Self.upload.appending(queryItems: [
            URLQueryItem(name: "uploadType", value: "resumable"),
            URLQueryItem(name: "fields", value: "id,webViewLink,md5Checksum,size"),
        ]))
        request.httpMethod = "POST"
        request.setValue("application/json; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.setValue(mimeType, forHTTPHeaderField: "X-Upload-Content-Type")
        request.setValue(String(size), forHTTPHeaderField: "X-Upload-Content-Length")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "parents": [folderID], "mimeType": mimeType])
        let (_, response) = try await send(request)
        guard let location = response.value(forHTTPHeaderField: "Location"), let url = URL(string: location) else {
            throw DriveError.server(response.statusCode)
        }
        return url
    }

    func metadata(fileID: String) async throws -> DriveFileMetadata {
        let url = Self.api.appending(path: fileID).appending(queryItems: [
            URLQueryItem(name: "fields", value: "id,name,md5Checksum,size,webViewLink"),
        ])
        let file: FileInfo = try await json(URLRequest(url: url))
        return file.metadata
    }

    func download(fileID: String) async throws -> Data {
        let url = Self.api.appending(path: fileID).appending(queryItems: [URLQueryItem(name: "alt", value: "media")])
        return try await send(URLRequest(url: url)).0
    }

    func trash(fileID: String) async throws {
        var request = URLRequest(url: Self.api.appending(path: fileID).appending(queryItems: [URLQueryItem(name: "fields", value: "id")]))
        request.httpMethod = "PATCH"
        request.setValue("application/json; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["trashed": true])
        _ = try await send(request)
    }

    func search(_ text: String) async throws -> [DriveFileMetadata] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        var components = URLComponents(url: Self.api, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: "fullText contains '\(Self.escape(trimmed))' and mimeType != '\(Self.folderMime)' and trashed = false"),
            URLQueryItem(name: "fields", value: "files(id,name,md5Checksum,size,webViewLink)"),
            URLQueryItem(name: "spaces", value: "drive"), URLQueryItem(name: "pageSize", value: "20"),
        ]
        let list: FileInfoList = try await json(URLRequest(url: components.url!))
        return list.files.map(\.metadata)
    }

    // MARK: Transport

    /// The web app's q(): escape backslashes and single quotes in a Drive query string.
    nonisolated static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
    }

    private func json<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, _) = try await send(request)
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw DriveError.server(200) }
    }

    /// Adds the token, refreshes it once on a 401, and maps statuses to DriveError.
    private func send(_ request: URLRequest, refreshed: Bool = false) async throws -> (Data, HTTPURLResponse) {
        var request = request
        let token = try await auth.driveAccessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw DriveError.network((error as? URLError)?.code.rawValue.description ?? "\(error)")
        }
        guard let http = response as? HTTPURLResponse else { throw DriveError.server(0) }
        if http.statusCode == 401 && !refreshed { return try await send(request, refreshed: true) }
        if let error = Self.error(status: http.statusCode, body: data) { throw error }
        return (data, http)
    }

    nonisolated static func error(status: Int, body: Data) -> DriveError? {
        switch status {
        case 200..<300, 308: return nil
        case 401: return .unauthorized
        case 404, 410: return .notFound
        case 429: return .rateLimited
        case 403:
            let text = String(decoding: body, as: UTF8.self)
            return text.contains("ateLimitExceeded") ? .rateLimited : .server(403)
        default: return .server(status)
        }
    }
}

// MARK: - Drive JSON

nonisolated struct FileRef: Decodable, Sendable { var id: String }
nonisolated struct FileList: Decodable, Sendable { var files: [FileRef] }

nonisolated struct FileInfo: Decodable, Sendable {
    var id: String
    var name: String?
    var md5Checksum: String?
    /// Drive sends size as a string.
    var size: String?
    var webViewLink: String?

    var metadata: DriveFileMetadata {
        DriveFileMetadata(id: id, name: name ?? "", md5Checksum: md5Checksum, size: size.flatMap { Int($0) },
                          webViewLink: webViewLink ?? "https://drive.google.com/file/d/\(id)/view")
    }
}

nonisolated struct FileInfoList: Decodable, Sendable { var files: [FileInfo] }
