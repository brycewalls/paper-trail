// Owner: capture. The simulator test seam (ARCHITECTURE.md, "Capture").
//
// The simulator has no camera, so Scan document feeds pages from here as if the scanner had
// returned them, and they go through the same review, OCR, PDF and hashing as a real scan.
//
// Launch arguments:
//   -PTScanSource <path>   a folder of images (sorted by name) or a PDF; each image or PDF page
//                          is one scanned page. Without it, the four SampleData pages are drawn.
//   -PTScanSeam            use the seam even where the camera works.
//   -PTOpenScan            start a scan as soon as Sort appears (for screenshots and UI checks).
//   -PTScanStack           draw SampleData's six-page pile instead of the four single pages (#19).
//   -PTAutoSplit           sample mode only: tap "Split into documents" as the review opens.
import CoreGraphics
import CoreText
import Foundation
import UniformTypeIdentifiers

nonisolated enum SampleScanSource {
    static var arguments: [String] { ProcessInfo.processInfo.arguments }

    static var forced: Bool { arguments.contains("-PTScanSeam") }
    static var opensScanAtLaunch: Bool { arguments.contains("-PTOpenScan") }
    static var drawsStack: Bool { arguments.contains("-PTScanStack") }

    static var sourcePath: String? {
        guard let i = arguments.firstIndex(of: "-PTScanSource"), arguments.indices.contains(i + 1) else { return nil }
        return arguments[i + 1]
    }

    /// Page JPEGs, as the scanner would hand them over.
    @MainActor
    static func pages() async -> [Data] {
        await render(texts: drawsStack ? SampleData.stackPageTexts : SampleData.pageTexts, path: sourcePath)
    }

    @concurrent
    private static func render(texts: [String], path: String?) async -> [Data] {
        if let path, let pages = try? pages(at: URL(filePath: path)), !pages.isEmpty {
            return pages
        }
        return texts.compactMap { try? drawPage($0) }
    }

    static func pages(at url: URL) throws -> [Data] {
        var isFolder: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isFolder) else { return [] }
        if isFolder.boolValue {
            let entries = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
                .filter { UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image) == true }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            return try entries.map { try PageAssembler.normalizedJPEG(from: Data(contentsOf: $0)) }
        }
        let data = try Data(contentsOf: url)
        if UTType(filenameExtension: url.pathExtension)?.conforms(to: .pdf) == true {
            return try (0..<PageAssembler.pageCount(ofPDF: data)).map {
                try PageAssembler.renderPDFPage(data, index: $0, maxPixel: 2200)
            }
        }
        return [try PageAssembler.normalizedJPEG(from: data)]
    }

    /// A letter page at 150 dpi: the sample's first line as a letterhead, the rest as body text,
    /// and a few ruled rows so it reads as a bill or a form.
    static func drawPage(_ text: String) throws -> Data {
        let width = 1275, height = 1650
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw PageAssembler.Failure.encodeFailed }
        // Paper, slightly warm so it reads as a photo of paper rather than a screen.
        ctx.setFillColor(CGColor(red: 0.985, green: 0.98, blue: 0.965, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

        let lines = text.split(separator: "\n").map(String.init)
        var y = CGFloat(height) - 170
        for (index, line) in lines.enumerated() {
            let size: CGFloat = index == 0 ? 64 : 40
            let font = CTFontCreateWithName((index == 0 ? "Helvetica-Bold" : "Helvetica") as CFString, size, nil)
            let attributed = NSAttributedString(string: line, attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String):
                    CGColor(red: 0.1, green: 0.1, blue: 0.12, alpha: 1),
            ])
            ctx.textPosition = CGPoint(x: 110, y: y)
            CTLineDraw(CTLineCreateWithAttributedString(attributed), ctx)
            y -= index == 0 ? 110 : 70
        }

        // Ruled rows and a total box, like a statement.
        ctx.setStrokeColor(CGColor(red: 0.75, green: 0.76, blue: 0.78, alpha: 1))
        ctx.setLineWidth(3)
        var rowY = y - 40
        for _ in 0..<6 {
            ctx.stroke(CGRect(x: 110, y: rowY, width: CGFloat(width) - 220, height: 0.5))
            ctx.setFillColor(CGColor(red: 0.85, green: 0.86, blue: 0.88, alpha: 1))
            ctx.fill(CGRect(x: 130, y: rowY + 22, width: 420, height: 22))
            ctx.fill(CGRect(x: CGFloat(width) - 330, y: rowY + 22, width: 200, height: 22))
            rowY -= 90
        }
        ctx.stroke(CGRect(x: CGFloat(width) - 470, y: rowY - 60, width: 360, height: 110))
        guard let image = ctx.makeImage() else { throw PageAssembler.Failure.encodeFailed }
        return try PageAssembler.jpeg(image, quality: 0.9)
    }
}
