// Owner: capture.
//
// On-device OCR with Vision (accurate level, language correction on). The lines feed the PDF's
// invisible text layer and the item's ocrText (#22), which also goes to Claude.
import CoreGraphics
import Foundation
import PDFKit
import Vision

/// What capture knows about the text on one page.
nonisolated struct PageText: Sendable, Hashable {
    /// Lines with their boxes, for the text layer. Empty for PDF pages that already had text.
    var lines: [OCRLine]
    var text: String

    static let empty = PageText(lines: [], text: "")
}

nonisolated enum TextRecognizer {
    /// The cap on text kept with an item, the same as Firestore's fullText (ARCHITECTURE.md).
    static let maxStoredCharacters = 100_000

    /// Recognizes the text in an upright page image. Returns no lines if Vision can't run (an
    /// OCR failure never blocks capture; the PDF is still filed, just without a text layer).
    @concurrent
    static func recognize(jpeg: Data) async -> PageText {
        var request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        guard let observations = try? await request.perform(on: jpeg) else { return .empty }
        let lines = observations.compactMap { observation -> OCRLine? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox.cgRect
            return OCRLine(text: candidate.string, x: box.minX, y: box.minY, width: box.width, height: box.height)
        }
        return PageText(lines: lines, text: lines.map(\.text).joined(separator: "\n"))
    }

    /// Text for one page of an imported PDF: the page's own text when it has some, otherwise OCR
    /// of a render (a PDF made by another scanner app with no text layer).
    @concurrent
    static func recognize(pdf data: Data, index: Int, quarterTurns: Int) async -> PageText {
        if let own = PDFDocument(data: data)?.page(at: index)?.string?.trimmingCharacters(in: .whitespacesAndNewlines),
           !own.isEmpty {
            return PageText(lines: [], text: own)
        }
        guard let render = try? PageAssembler.renderPDFPage(data, index: index, maxPixel: 2200,
                                                             quarterTurns: quarterTurns) else { return .empty }
        return await recognize(jpeg: render)
    }

    /// All pages' text, a blank line between pages, capped for storage.
    static func documentText(_ pages: [PageText]) -> String? {
        let text = pages.map(\.text).joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return String(text.prefix(maxStoredCharacters))
    }
}
