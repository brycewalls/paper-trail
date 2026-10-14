// Owner: classify. Logic only.
//
// Builds the classify request for one document, off the main actor. Same sizing rule as the web
// app's readPayload(): a PDF of up to 10 pages and about 9 MB goes whole (Claude reads its text and
// page images); anything bigger goes as the first 10 pages rendered at 1568 px on the long side,
// JPEG 0.85. Drive always gets the original file either way; this is only what Claude sees.
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

    /// The request for a PDF on disk. Throws ClassifyFailure(.tooLarge) when even the page images
    /// are too big, and (.badRequest) when the file can't be opened.
    @concurrent
    static func request(pdfAt url: URL, pageCount: Int, ocrText: String?, senderHints: [SenderRule]) async throws -> ClassifyRequest {
        let data: Data
        do { data = try Data(contentsOf: url) } catch {
            throw ClassifyFailure(code: .badRequest, message: "The scan file is missing.")
        }
        let ocr = ocrText.map { String($0.prefix(maxOCRChars)) }.flatMap { $0.isEmpty ? nil : $0 }
        let hints = senderHints.isEmpty ? nil : senderHints
        let pages = max(1, pageCount)

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

    /// One page as a JPEG, 1568 px on the long side, on white (scans have no transparency, but
    /// imported PDFs can).
    static func render(_ page: PDFPage) -> Data? {
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
        return image.jpegData(compressionQuality: jpegQuality)
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
