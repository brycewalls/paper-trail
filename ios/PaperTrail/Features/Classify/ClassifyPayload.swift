// Owner: classify. Logic only.
//
// Builds the classify request for one document, off the main actor. Drive always gets the original
// file; this is only what Claude sees.
//
// Since #75, when the on-device OCR text is there (at least `minOCRChars`), Claude gets that text
// plus ONE picture of the first page at 1000 px on the long side (`ocrPrimary`). A PDF costs Claude
// a page picture and a text layer for every page (about 3,300 input tokens a page in Bryce's logs);
// this costs about 1,000 for the picture plus the text, whatever the page count.
//
// Without usable text (a photo of handwriting, a blank OCR), it falls back to the web app's rule
// (readPayload()): a PDF of up to 10 pages and about 9 MB goes whole; anything bigger goes as the
// first 10 pages rendered at 1568 px on the long side, JPEG 0.85.
import Foundation
import PDFKit
import UIKit

nonisolated enum ClassifyPayload {
    static let maxWholePages = 10
    static let maxWholeBytes = 9 * 1024 * 1024
    static let maxImages = 10
    static let longEdge: CGFloat = 1568
    static let jpegQuality: CGFloat = 0.85
    /// The function takes up to 24 MB of base64; stay well under it.
    static let maxBase64Chars = 22 * 1024 * 1024
    static let maxOCRChars = 20_000
    /// Less OCR text than this (trimmed) can't carry a read, so the pages go instead (#75).
    static let minOCRChars = 120
    /// The first-page picture that goes with the OCR text (#75).
    static let previewLongEdge: CGFloat = 1000
    static let previewQuality: CGFloat = 0.8

    /// The request for a PDF on disk. Throws ClassifyFailure(.tooLarge) when even the page images
    /// are too big, and (.badRequest) when the file can't be opened.
    @concurrent
    static func request(pdfAt url: URL, pageCount: Int, ocrText: String?, senderHints: [SenderRule]) async throws -> ClassifyRequest {
        let data: Data
        do { data = try Data(contentsOf: url) } catch {
            throw ClassifyFailure(code: .badRequest, message: "The scan file is missing.")
        }
        let ocr = ocrText.map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxOCRChars)) }
            .flatMap { $0.isEmpty ? nil : $0 }
        let hints = senderHints.isEmpty ? nil : senderHints
        let pages = max(1, pageCount)

        if let ocr, hasEnoughText(ocr), let document = PDFDocument(data: data), document.pageCount > 0,
           let page = document.page(at: 0), let jpeg = render(page, longEdge: previewLongEdge, quality: previewQuality) {
            return ClassifyRequest(kind: .images, pdf: nil, images: [ClassifyImage(type: "image/jpeg", data: jpeg.base64EncodedString())],
                                   totalPages: max(pages, document.pageCount), ocrText: ocr, senderHints: hints,
                                   wantConfidence: true, ocrPrimary: true)
        }
        if pages <= maxWholePages && data.count <= maxWholeBytes {
            return ClassifyRequest(kind: .pdf, pdf: data.base64EncodedString(), images: nil, totalPages: pages,
                                   ocrText: ocr, senderHints: hints, wantConfidence: true)
        }
        guard let document = PDFDocument(data: data), document.pageCount > 0 else {
            throw ClassifyFailure(code: .badRequest, message: "The PDF couldn't be opened.")
        }
        var images: [ClassifyImage] = []
        var total = 0
        for index in 0..<min(document.pageCount, maxImages) {
            guard let page = document.page(at: index), let jpeg = render(page) else { continue }
            let b64 = jpeg.base64EncodedString()
            total += b64.count
            images.append(ClassifyImage(type: "image/jpeg", data: b64))
        }
        if images.isEmpty { throw ClassifyFailure(code: .badRequest, message: "No pages could be rendered.") }
        if total > maxBase64Chars { throw ClassifyFailure(code: .tooLarge, message: "The pages are too large to send.") }
        return ClassifyRequest(kind: .images, pdf: nil, images: images, totalPages: max(pages, document.pageCount),
                               ocrText: ocr, senderHints: hints, wantConfidence: true)
    }

    /// Enough OCR text to read from: `minOCRChars` once whitespace is squeezed out.
    static func hasEnoughText(_ text: String) -> Bool {
        text.unicodeScalars.lazy.filter { !CharacterSet.whitespacesAndNewlines.contains($0) }.count >= minOCRChars
    }

    /// One page as a JPEG, `longEdge` px on the long side, on white (scans have no transparency, but
    /// imported PDFs can).
    static func render(_ page: PDFPage, longEdge: CGFloat = longEdge, quality: CGFloat = jpegQuality) -> Data? {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = longEdge / max(bounds.width, bounds.height)
        let size = CGSize(width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            page.draw(with: .mediaBox, to: context.cgContext.scaledForPDF(height: size.height, scale: scale))
        }
        return image.jpegData(compressionQuality: quality)
    }
}

private extension CGContext {
    /// PDF space is bottom-up; flip and scale so a page draws upright into the image.
    nonisolated func scaledForPDF(height: CGFloat, scale: CGFloat) -> CGContext {
        translateBy(x: 0, y: height)
        scaleBy(x: scale, y: -scale)
        return self
    }
}
