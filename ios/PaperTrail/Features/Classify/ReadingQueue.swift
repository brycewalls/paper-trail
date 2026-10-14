// Owner: classify. Scaffold version: one at a time, no retry, sends the PDF whole. The classify
// agent replaces the body (concurrency 2, size limits, page images, backoff, sender hints) and
// keeps the signature.
//
// Moves captured items to .ready by sending each to the classify service.
import Foundation
import SwiftData

@Observable
final class ReadingQueue {
    private let classify: any ClassifyService
    private let files: FileStore

    init(classify: any ClassifyService, files: FileStore) {
        self.classify = classify
        self.files = files
    }

    func read(_ items: [PipelineItem]) async {
        for item in items where item.stage == .captured {
            item.stage = .reading
            do {
                let pdf = try files.read(item.fileName).base64EncodedString()
                let request = ClassifyRequest(kind: .pdf, pdf: pdf, images: nil, totalPages: item.pageCount,
                                              ocrText: item.ocrText, senderHints: nil, wantConfidence: true)
                let response = try await classify.classify(request)
                item.card = response.result
                item.model = response.model
                item.stage = .ready
            } catch let failure as ClassifyFailure {
                item.fail(at: .reading, failure.message)
            } catch {
                item.fail(at: .reading, "Something interrupted the read.")
            }
        }
    }
}
