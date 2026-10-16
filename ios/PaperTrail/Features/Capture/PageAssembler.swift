// Owner: capture.
//
// Pure image and PDF work for capture: upright, size-capped page JPEGs, page renders of PDFs,
// thumbnails, and the PDF assembler with an invisible OCR text layer (#22) so Drive search and
// any PDF reader can find the words on a scanned page. CoreGraphics only, so all of it runs off
// the main actor.
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// One line of recognized text on a page.
nonisolated struct OCRLine: Codable, Sendable, Hashable {
    var text: String
    /// Normalized to the page (0...1) with the origin at the bottom left, as Vision and PDF use.
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

nonisolated enum PageAssembler {
    /// About 200 dpi on a letter page, the same as the web scanner (1700 px on the short side).
    static let maxShortSide = 1700
    static let jpegQuality = 0.82
    /// Image pages are laid out 8.5 in wide; the height follows the page's own aspect.
    static let pageWidth: CGFloat = 612

    enum Failure: Error, Sendable, Hashable {
        case unreadableImage
        case unreadablePDF
        case encodeFailed
    }

    /// One page of a document being assembled.
    enum Page: Sendable {
        /// A scanned or photographed page, upright JPEG, with the OCR lines to lay under it.
        case image(jpeg: Data, lines: [OCRLine])
        /// A page of an imported PDF, drawn as vectors. `lines` is a text layer for pages that
        /// had no text of their own (a scanned PDF); empty when the page already has text.
        case pdf(data: Data, index: Int, quarterTurns: Int, lines: [OCRLine])
    }

    // MARK: - Images

    /// Decodes any image ImageIO reads (JPEG, HEIC, PNG...), applies its EXIF orientation and
    /// `quarterTurns` clockwise turns, caps the short side at `maxShortSide`, and returns a JPEG.
    static func normalizedJPEG(from data: Data, quarterTurns: Int = 0, maxShortSide: Int = maxShortSide) throws -> Data {
        let image = try uprightImage(from: data, maxShortSide: maxShortSide)
        return try jpeg(rotated(image, quarterTurns: quarterTurns), quality: jpegQuality)
    }

    static func uprightImage(from data: Data, maxShortSide: Int = maxShortSide) throws -> CGImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? Int,
              let height = props[kCGImagePropertyPixelHeight] as? Int, width > 0, height > 0
        else { throw Failure.unreadableImage }
        let short = min(width, height), long = max(width, height)
        let cap = short > maxShortSide ? Int((Double(long) * Double(maxShortSide) / Double(short)).rounded()) : long
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: cap,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw Failure.unreadableImage
        }
        return image
    }

    /// A small JPEG for thumbnails (the review screen and the deck card).
    static func thumbnail(ofJPEG data: Data, maxPixel: Int, quarterTurns: Int = 0) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let turned = try? rotated(image, quarterTurns: quarterTurns) else { return nil }
        return try? jpeg(turned, quality: 0.8)
    }

    static func rotated(_ image: CGImage, quarterTurns: Int) throws -> CGImage {
        let turns = ((quarterTurns % 4) + 4) % 4
        guard turns != 0 else { return image }
        let w = image.width, h = image.height
        let outW = turns % 2 == 0 ? w : h, outH = turns % 2 == 0 ? h : w
        guard let ctx = CGContext(data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw Failure.encodeFailed }
        ctx.interpolationQuality = .high
        // CoreGraphics' y axis points up, so a clockwise turn is a negative angle.
        ctx.translateBy(x: CGFloat(outW) / 2, y: CGFloat(outH) / 2)
        ctx.rotate(by: -CGFloat(turns) * .pi / 2)
        ctx.draw(image, in: CGRect(x: -CGFloat(w) / 2, y: -CGFloat(h) / 2, width: CGFloat(w), height: CGFloat(h)))
        guard let out = ctx.makeImage() else { throw Failure.encodeFailed }
        return out
    }

    static func jpeg(_ image: CGImage, quality: Double) throws -> Data {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Failure.encodeFailed }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw Failure.encodeFailed }
        return out as Data
    }

    // MARK: - PDFs

    static func pdfDocument(_ data: Data) -> CGPDFDocument? {
        guard let provider = CGDataProvider(data: data as CFData) else { return nil }
        return CGPDFDocument(provider)
    }

    static func pageCount(ofPDF data: Data) -> Int {
        pdfDocument(data)?.numberOfPages ?? 0
    }

    /// Renders one PDF page (0-based) to an upright JPEG, long side `maxPixel`. Used for OCR of
    /// scanned PDFs and for thumbnails.
    static func renderPDFPage(_ data: Data, index: Int, maxPixel: Int, quarterTurns: Int = 0) throws -> Data {
        guard let page = pdfDocument(data)?.page(at: index + 1) else { throw Failure.unreadablePDF }
        let box = pageBox(page, quarterTurns: quarterTurns)
        let scale = CGFloat(maxPixel) / max(box.width, box.height)
        let w = max(1, Int((box.width * scale).rounded())), h = max(1, Int((box.height * scale).rounded()))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw Failure.encodeFailed }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.interpolationQuality = .high
        ctx.scaleBy(x: scale, y: scale)
        draw(page, in: box, quarterTurns: quarterTurns, ctx: ctx)
        guard let image = ctx.makeImage() else { throw Failure.encodeFailed }
        return try jpeg(image, quality: 0.85)
    }

    /// The page's size once its own rotation and `quarterTurns` are applied, at the origin.
    static func pageBox(_ page: CGPDFPage, quarterTurns: Int) -> CGRect {
        let crop = page.getBoxRect(.cropBox)
        let turns = (Int(page.rotationAngle) / 90 + quarterTurns) % 4
        return turns % 2 == 0
            ? CGRect(x: 0, y: 0, width: crop.width, height: crop.height)
            : CGRect(x: 0, y: 0, width: crop.height, height: crop.width)
    }

    static func draw(_ page: CGPDFPage, in box: CGRect, quarterTurns: Int, ctx: CGContext) {
        ctx.saveGState()
        // getDrawingTransform already applies the page's own /Rotate; add ours on top.
        let transform = page.getDrawingTransform(.cropBox, rect: box, rotate: Int32((quarterTurns % 4) * 90),
                                                 preserveAspectRatio: true)
        ctx.concatenate(transform)
        ctx.clip(to: page.getBoxRect(.cropBox))
        ctx.drawPDFPage(page)
        ctx.restoreGState()
    }

    /// Builds one PDF from the pages. Image pages embed the JPEG as is (no recompression) and get
    /// an invisible text layer from their OCR lines.
    static func pdf(_ pages: [Page]) throws -> Data {
        let out = NSMutableData()
        var defaultBox = CGRect(x: 0, y: 0, width: 612, height: 792)
        let info: [CFString: Any] = [kCGPDFContextCreator: "Paper Trail for iPhone"]
        guard let consumer = CGDataConsumer(data: out as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: &defaultBox, info as CFDictionary)
        else { throw Failure.encodeFailed }

        for page in pages {
            switch page {
            case let .image(jpeg, lines):
                guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
                else { throw Failure.unreadableImage }
                let box = CGRect(x: 0, y: 0, width: pageWidth,
                                 height: (pageWidth * CGFloat(image.height) / CGFloat(image.width)).rounded())
                begin(box, ctx)
                ctx.interpolationQuality = .high
                ctx.draw(image, in: box)
                drawTextLayer(lines, in: box, ctx: ctx)
                ctx.endPDFPage()
            case let .pdf(data, index, turns, lines):
                guard let source = pdfDocument(data)?.page(at: index + 1) else { throw Failure.unreadablePDF }
                let box = pageBox(source, quarterTurns: turns)
                begin(box, ctx)
                draw(source, in: box, quarterTurns: turns, ctx: ctx)
                drawTextLayer(lines, in: box, ctx: ctx)
                ctx.endPDFPage()
            }
        }
        ctx.closePDF()
        return out as Data
    }

    private static func begin(_ box: CGRect, _ ctx: CGContext) {
        var box = box
        let boxData = Data(bytes: &box, count: MemoryLayout<CGRect>.size)
        ctx.beginPDFPage([kCGPDFContextMediaBox: boxData] as CFDictionary)
    }

    /// Draws each OCR line as invisible text stretched over the box Vision found for it, so text
    /// selection and search line up with the words in the image.
    static func drawTextLayer(_ lines: [OCRLine], in page: CGRect, ctx: CGContext) {
        guard !lines.isEmpty else { return }
        ctx.saveGState()
        ctx.setTextDrawingMode(.invisible)
        for line in lines {
            let text = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let rect = CGRect(x: page.minX + line.x * page.width, y: page.minY + line.y * page.height,
                              width: line.width * page.width, height: line.height * page.height)
            guard !text.isEmpty, rect.width > 1, rect.height > 1 else { continue }
            let font = CTFontCreateWithName("Helvetica" as CFString, rect.height * 0.85, nil)
            let attributed = NSAttributedString(string: text, attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
            ])
            let ctLine = CTLineCreateWithAttributedString(attributed)
            var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
            let width = CGFloat(CTLineGetTypographicBounds(ctLine, &ascent, &descent, &leading))
            guard width > 0 else { continue }
            ctx.saveGState()
            ctx.translateBy(x: rect.minX, y: rect.minY + descent)
            ctx.scaleBy(x: rect.width / width, y: 1)
            ctx.textMatrix = .identity
            ctx.textPosition = .zero
            CTLineDraw(ctLine, ctx)
            ctx.restoreGState()
        }
        ctx.restoreGState()
    }
}
