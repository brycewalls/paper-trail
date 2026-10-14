// Owner: capture.
//
// Turns pages into a CapturedDocument: the PDF (assembled with a text layer, or an imported PDF's
// original bytes), its SHA-256 (#2), a first-page thumbnail, and the OCR text, all written to
// FileStore. The review screen and LiveCaptureService both build documents through here.
import Foundation

/// One page as capture holds it before it becomes part of a PDF.
nonisolated struct SourcePage: Sendable, Hashable {
    enum Content: Sendable, Hashable {
        /// An upright JPEG from the scanner, Photos or an image file.
        case jpeg(Data)
        /// Page `index` (0-based) of an imported PDF.
        case pdf(Data, index: Int)
    }

    var content: Content
    /// Clockwise quarter turns the person asked for in review.
    var quarterTurns: Int = 0
}

nonisolated enum DocumentBuilder {
    /// The deck card's thumbnail, long side in pixels.
    static let itemThumbnailPixels = 600

    /// OCR (or the PDF's own text) for one page.
    @concurrent
    static func text(for page: SourcePage) async -> PageText {
        switch page.content {
        case let .jpeg(data):
            if page.quarterTurns % 4 == 0 { return await TextRecognizer.recognize(jpeg: data) }
            guard let turned = try? PageAssembler.normalizedJPEG(from: data, quarterTurns: page.quarterTurns) else {
                return .empty
            }
            return await TextRecognizer.recognize(jpeg: turned)
        case let .pdf(data, index):
            return await TextRecognizer.recognize(pdf: data, index: index, quarterTurns: page.quarterTurns)
        }
    }

    /// Builds and stores one document.
    /// - Parameter original: an imported PDF's bytes when the document is exactly that file,
    ///   untouched. They are filed byte for byte and no text layer is added.
    static func build(pages: [SourcePage], texts: [PageText], original: Data?, origin: String,
                      files: FileStore, id: UUID = UUID()) throws -> CapturedDocument {
        precondition(pages.count == texts.count, "one PageText per page")
        let pdf: Data
        let pageCount: Int
        if let original {
            pdf = original
            pageCount = max(1, PageAssembler.pageCount(ofPDF: original))
        } else {
            let assembled = try zip(pages, texts).map { page, text -> PageAssembler.Page in
                switch page.content {
                case let .jpeg(data):
                    let upright = page.quarterTurns % 4 == 0
                        ? data
                        : try PageAssembler.normalizedJPEG(from: data, quarterTurns: page.quarterTurns)
                    return .image(jpeg: upright, lines: text.lines)
                case let .pdf(data, index):
                    return .pdf(data: data, index: index, quarterTurns: page.quarterTurns, lines: text.lines)
                }
            }
            pdf = try PageAssembler.pdf(assembled)
            pageCount = pages.count
        }

        let fileName = try files.write(pdf, id: id, ext: "pdf")
        var thumbnailName: String?
        if let first = pages.first, let thumb = thumbnail(of: first) {
            thumbnailName = try? files.write(thumb, id: id, ext: "thumb.jpg")
        }
        return CapturedDocument(id: id, fileName: fileName, pageCount: pageCount, sizeBytes: pdf.count,
                                contentHash: ContentHash.sha256Hex(pdf), origin: origin,
                                ocrText: TextRecognizer.documentText(texts), thumbnailName: thumbnailName)
    }

    static func thumbnail(of page: SourcePage, maxPixel: Int = itemThumbnailPixels) -> Data? {
        switch page.content {
        case let .jpeg(data):
            PageAssembler.thumbnail(ofJPEG: data, maxPixel: maxPixel, quarterTurns: page.quarterTurns)
        case let .pdf(data, index):
            try? PageAssembler.renderPDFPage(data, index: index, maxPixel: maxPixel, quarterTurns: page.quarterTurns)
        }
    }

    /// Removes a document's files, for a group that was split, joined, skipped or discarded.
    static func remove(_ doc: CapturedDocument, from files: FileStore) {
        files.remove(doc.fileName)
        if let thumb = doc.thumbnailName { files.remove(thumb) }
    }
}
