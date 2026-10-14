// Owner: capture.
//
// Turns captured documents into pipeline items. Every capture path (scan, Files, Photos, the
// simulator seam) ends here, so the deck and the outbox never care where a document came from.
import Foundation
import SwiftData

enum CaptureIntake {
    @discardableResult
    static func add(_ documents: [CapturedDocument], to context: ModelContext) -> [PipelineItem] {
        let items = documents.map { doc in
            let item = PipelineItem(id: doc.id, fileName: doc.fileName, pageCount: doc.pageCount,
                                    sizeBytes: doc.sizeBytes, origin: doc.origin, stage: .captured)
            item.contentHash = doc.contentHash
            item.ocrText = doc.ocrText
            item.thumbnailName = doc.thumbnailName
            return item
        }
        items.forEach(context.insert)
        try? context.save()
        return items
    }
}
