// Owner: outbox. Loads a row's first page for the shared DocThumbnail (spec 3.10): the capture
// thumbnail when there is one, else page one of the PDF, rendered off the main actor.
import PDFKit
import SwiftUI
import UIKit

struct OutboxRowThumbnail: View {
    let fileURL: URL?
    let thumbnailURL: URL?
    @State private var image: CGImage?

    var body: some View {
        DocThumbnail(image: image)
            .task(id: fileURL) { image = await Self.load(thumbnail: thumbnailURL, file: fileURL) }
    }

    @concurrent nonisolated static func load(thumbnail: URL?, file: URL?) async -> CGImage? {
        if let thumbnail, let data = try? Data(contentsOf: thumbnail), let image = UIImage(data: data)?.cgImage {
            return image
        }
        guard let file, let page = PDFDocument(url: file)?.page(at: 0) else { return nil }
        return page.thumbnail(of: CGSize(width: 90, height: 116), for: .mediaBox).cgImage
    }
}
