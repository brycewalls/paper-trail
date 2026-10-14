// Owner: classify. Logic only. Issue #19 (stack mode).
//
// Builds the classify callable's split request for a scanned pile and turns its answer back into
// page groups. The request carries every page's OCR text (capped per page) and, for piles of up to
// 100 pages, a small JPEG thumbnail of each page so Claude can see letterheads and layout. Past 100
// pages it goes as text only (the API's image limit). The answer must cover every page once, in
// order, or it's ignored.
import Foundation

nonisolated enum SplitPayload {
    /// Long side of each page thumbnail Claude sees. Enough for a letterhead and the page's shape.
    static let thumbnailPixels = 512
    /// Matches functions/lib.js MAX_SPLIT_IMAGES and MAX_SPLIT_PAGES.
    static let maxImages = 100
    static let maxPages = 300
    static let maxPageChars = 2000

    /// One proposed document as page indexes into the pile, plus Claude's label.
    struct Group: Sendable, Hashable {
        var pages: [Int]
        var label: String
    }

    /// The split request. `thumbnails` lines up with `texts`; a nil (or every one, past
    /// `maxImages` pages) sends that page as text only.
    static func request(texts: [String], thumbnails: [Data?]) -> SplitRequest {
        let withImages = texts.count <= maxImages
        let pages = texts.enumerated().map { index, text in
            let thumb = withImages && thumbnails.indices.contains(index) ? thumbnails[index] : nil
            return SplitPage(text: String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxPageChars)),
                             image: thumb.map { ClassifyImage(type: "image/jpeg", data: $0.base64EncodedString()) })
        }
        return SplitRequest(pages: pages)
    }

    /// The answer as groups, or nil when it doesn't cover pages 0..<pageCount once, in order.
    static func groups(from documents: [SplitDocument], pageCount: Int) -> [Group]? {
        guard pageCount > 0, !documents.isEmpty else { return nil }
        var next = 0
        var out: [Group] = []
        for doc in documents {
            guard doc.start == next, doc.end >= doc.start, doc.end < pageCount else { return nil }
            out.append(Group(pages: Array(doc.start...doc.end), label: doc.label.trimmingCharacters(in: .whitespaces)))
            next = doc.end + 1
        }
        return next == pageCount ? out : nil
    }
}
