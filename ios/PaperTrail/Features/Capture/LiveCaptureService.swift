// Owner: capture.
//
// The live CaptureService: Vision OCR, PDFs with a text layer, imported PDFs kept byte for byte,
// SHA-256 for the duplicate check. The review screen uses the same pieces page by page; this is
// the one-shot version for callers that already know how the pages group.
import Foundation
import UniformTypeIdentifiers

final class LiveCaptureService: CaptureService {
    let files: FileStore

    init(files: FileStore) { self.files = files }

    func makeDocument(fromScans pages: [Data]) async throws -> CapturedDocument {
        try await Self.document(fromImages: pages, origin: "scan", files: files)
    }

    func importFiles(_ urls: [URL]) async throws -> [CapturedDocument] {
        var documents: [CapturedDocument] = []
        for url in urls {
            let data = try Self.readImported(url)
            if Self.isPDF(url) {
                documents.append(try await Self.document(fromPDF: data, files: files))
            } else if Self.isImage(url) {
                documents.append(try await Self.document(fromImages: [data], origin: "files", files: files))
            } else {
                throw UnsupportedImport(url: url)
            }
        }
        return documents
    }

    func importPhotos(_ images: [Data]) async throws -> CapturedDocument {
        try await Self.document(fromImages: images, origin: "photos", files: files)
    }

    func sampleDocuments() async throws -> [CapturedDocument] {
        var documents: [CapturedDocument] = []
        for page in await SampleScanSource.pages() {
            documents.append(try await Self.document(fromImages: [page], origin: "scan", files: files))
        }
        return documents
    }

    // MARK: - Shared steps

    @concurrent
    static func document(fromImages images: [Data], origin: String, files: FileStore) async throws -> CapturedDocument {
        var pages: [SourcePage] = []
        var texts: [PageText] = []
        for image in images {
            let page = SourcePage(content: .jpeg(try PageAssembler.normalizedJPEG(from: image)))
            pages.append(page)
            texts.append(await DocumentBuilder.text(for: page))
        }
        return try DocumentBuilder.build(pages: pages, texts: texts, original: nil, origin: origin, files: files)
    }

    @concurrent
    static func document(fromPDF data: Data, files: FileStore) async throws -> CapturedDocument {
        let count = PageAssembler.pageCount(ofPDF: data)
        guard count > 0 else { throw PageAssembler.Failure.unreadablePDF }
        let pages = (0..<count).map { SourcePage(content: .pdf(data, index: $0)) }
        var texts: [PageText] = []
        for page in pages { texts.append(await DocumentBuilder.text(for: page)) }
        return try DocumentBuilder.build(pages: pages, texts: texts, original: data, origin: "files", files: files)
    }

    /// Reads a file from the Files picker, inside its security scope.
    nonisolated static func readImported(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try Data(contentsOf: url)
    }

    nonisolated static func type(of url: URL) -> UTType? {
        (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType) ?? UTType(filenameExtension: url.pathExtension)
    }

    nonisolated static func isPDF(_ url: URL) -> Bool { type(of: url)?.conforms(to: .pdf) == true }
    nonisolated static func isImage(_ url: URL) -> Bool { type(of: url)?.conforms(to: .image) == true }
}

/// A file that is neither a PDF nor an image (spec 3.12, "Unsupported import").
nonisolated struct UnsupportedImport: Error, Sendable, Hashable {
    var url: URL

    var fileName: String { url.lastPathComponent }

    /// "PDFs and photos work. notes.docx is a Word document."
    var message: String {
        let kind = LiveCaptureService.type(of: url)?.localizedDescription
            ?? (url.pathExtension.isEmpty ? "file" : "\(url.pathExtension.uppercased()) file")
        let article = kind.first.map { "aeiouAEIOU".contains($0) } == true ? "an" : "a"
        return "PDFs and photos work. \(fileName) is \(article) \(kind)."
    }
}
