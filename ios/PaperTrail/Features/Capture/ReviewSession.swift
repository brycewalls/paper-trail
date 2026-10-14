// Owner: capture. Issues #19 (splitting), #17 (nothing lost).
//
// The scan review in progress, saved to FileStore after every change: the pages (written before
// the review screen appears) and how they're grouped into documents. If the app closes mid-review,
// the next launch reopens it from here.
import Foundation

nonisolated struct ReviewPage: Codable, Sendable, Hashable, Identifiable {
    var id: UUID
    /// Relative path of the page JPEG in FileStore (scans, photos, image files).
    var image: String?
    /// Relative path of the imported PDF this page comes from, and its 0-based page index.
    var pdf: String?
    var pdfIndex: Int?
    /// The imported file's name, for the "{n} files" title.
    var sourceName: String?
    var quarterTurns: Int = 0
}

nonisolated struct ReviewGroup: Codable, Sendable, Hashable, Identifiable {
    /// A new ID every time the group's pages change, so a stale read is never applied.
    var id: UUID = UUID()
    var pageIDs: [UUID]
    /// "Skip" on the duplicate line.
    var skipped: Bool = false
    /// Already added to the deck. A review reopened after a relaunch leaves these out.
    var sent: Bool = false
}

nonisolated struct ReviewSession: Codable, Sendable, Hashable, Identifiable {
    enum Kind: String, Codable, Sendable {
        case scan, files, photos

        /// PipelineItem.origin
        var origin: String { rawValue }
    }

    var id: UUID = UUID()
    var kind: Kind
    var createdAt: Date = .now
    var pages: [ReviewPage] = []
    var groups: [ReviewGroup] = []

    var folder: String { ReviewStore.folder(id) }

    func page(_ id: UUID) -> ReviewPage? { pages.first { $0.id == id } }
}

nonisolated enum ReviewStore {
    static let root = "review"

    static func folder(_ id: UUID) -> String { "\(root)/\(id.uuidString)" }
    static func manifest(_ id: UUID) -> String { "\(folder(id))/manifest.json" }

    static func save(_ session: ReviewSession, files: FileStore) throws {
        let data = try JSONEncoder().encode(session)
        try files.writeFile(data, at: manifest(session.id))
    }

    /// The newest saved review, if one was left open.
    static func latest(files: FileStore) -> ReviewSession? {
        let base = files.url(for: root)
        guard let folders = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil) else {
            return nil
        }
        var open: [ReviewSession] = []
        for folder in folders {
            guard let data = try? Data(contentsOf: folder.appending(path: "manifest.json")),
                  var session = try? JSONDecoder().decode(ReviewSession.self, from: data) else {
                // Pages saved but no manifest yet: the app closed while saving. Nothing to reopen.
                try? FileManager.default.removeItem(at: folder)
                continue
            }
            session.groups.removeAll(where: \.sent)
            if session.groups.isEmpty {
                try? FileManager.default.removeItem(at: folder)
            } else {
                open.append(session)
            }
        }
        return open.max { $0.createdAt < $1.createdAt }
    }

    static func remove(_ id: UUID, files: FileStore) {
        try? FileManager.default.removeItem(at: files.url(for: folder(id)))
    }

    /// Writes a page JPEG for the session and returns the page.
    static func addImagePage(_ jpeg: Data, session: UUID, files: FileStore, sourceName: String? = nil) throws -> ReviewPage {
        let id = UUID()
        let path = "\(folder(session))/\(id.uuidString).jpg"
        try files.writeFile(jpeg, at: path)
        return ReviewPage(id: id, image: path, sourceName: sourceName)
    }

    /// Copies an imported PDF into the session, byte for byte, and returns one page per PDF page.
    static func addPDF(_ data: Data, session: UUID, files: FileStore, sourceName: String) throws -> [ReviewPage] {
        let count = PageAssembler.pageCount(ofPDF: data)
        guard count > 0 else { throw PageAssembler.Failure.unreadablePDF }
        let path = "\(folder(session))/\(UUID().uuidString).pdf"
        try files.writeFile(data, at: path)
        return (0..<count).map { ReviewPage(id: UUID(), pdf: path, pdfIndex: $0, sourceName: sourceName) }
    }
}

extension FileStore {
    /// Writes data at any relative path under the store (capture's review folder).
    nonisolated func writeFile(_ data: Data, at relativePath: String) throws {
        let url = url(for: relativePath)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
