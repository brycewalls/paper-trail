// Owner: scaffold. Capture writes files, Outbox reads and deletes them.
//
// The document bytes on disk, in Application Support/Documents-in-flight. Files stay until the
// item is verified (or shred-logged) and then are removed by the outbox. Paths stored in
// SwiftData are relative to `root`, because the app container path changes between installs.
import Foundation

nonisolated struct FileStore: Sendable {
    let root: URL

    /// The app's real store.
    static func appDefault() -> FileStore {
        let base = URL.applicationSupportDirectory.appending(path: "Documents-in-flight", directoryHint: .isDirectory)
        return FileStore(root: base)
    }

    /// A throwaway store for tests and previews.
    static func temporary() -> FileStore {
        FileStore(root: URL.temporaryDirectory.appending(path: "PaperTrail-\(UUID().uuidString)", directoryHint: .isDirectory))
    }

    func url(for relativePath: String) -> URL {
        root.appending(path: relativePath)
    }

    /// Writes data at items/<id>.<ext> and returns the relative path.
    @discardableResult
    func write(_ data: Data, id: UUID, ext: String) throws -> String {
        let rel = "items/\(id.uuidString).\(ext)"
        let url = url(for: rel)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return rel
    }

    func read(_ relativePath: String) throws -> Data {
        try Data(contentsOf: url(for: relativePath))
    }

    func remove(_ relativePath: String) {
        try? FileManager.default.removeItem(at: url(for: relativePath))
    }
}
