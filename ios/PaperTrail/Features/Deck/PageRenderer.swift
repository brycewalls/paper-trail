// Owner: deck. Renders PDF pages for the card's scan well and the card detail's page viewer,
// off the main actor.
import Foundation
import PDFKit
import UIKit

nonisolated enum PageRenderer {
    /// The capture thumbnail when there is one, else the PDF's first page.
    @concurrent
    static func firstPage(thumbnail: URL?, pdf: URL, maxPixels: CGFloat) async -> CGImage? {
        if let thumbnail, let image = UIImage(contentsOfFile: thumbnail.path)?.cgImage { return image }
        guard let document = PDFDocument(url: pdf), let page = document.page(at: 0) else { return nil }
        return render(page, maxPixels: maxPixels)
    }

    @concurrent
    static func pages(pdf: URL, maxPixels: CGFloat) async -> [CGImage] {
        guard let document = PDFDocument(url: pdf) else { return [] }
        return (0..<document.pageCount).compactMap { index in
            document.page(at: index).flatMap { render($0, maxPixels: maxPixels) }
        }
    }

    private static func render(_ page: PDFPage, maxPixels: CGFloat) -> CGImage? {
        let bounds = page.bounds(for: .mediaBox)
        let scale = maxPixels / max(bounds.width, bounds.height, 1)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        return page.thumbnail(of: size, for: .mediaBox).cgImage
    }
}
