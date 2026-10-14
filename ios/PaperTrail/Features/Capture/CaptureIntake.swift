// Owner: capture.
//
// Turns captured documents into pipeline items. Every capture path (scan, Files, Photos, the
// simulator seam) ends here, so the deck and the outbox never care where a document came from.
//
// The review screen reads each document while the person is still splitting and joining, so it
// makes items first (`makeItem`, not yet in SwiftData) and adds them on "Send to the deck"
// (`add(items:)`). Everything else calls `add(_:to:)`, which does both.
import Foundation
import SwiftData

enum CaptureIntake {
    @discardableResult
    static func add(_ documents: [CapturedDocument], to context: ModelContext) -> [PipelineItem] {
        add(items: documents.map(makeItem), to: context)
    }

    /// A pipeline item for a document, stage `.captured`, not yet inserted.
    static func makeItem(_ doc: CapturedDocument) -> PipelineItem {
        let item = PipelineItem(id: doc.id, fileName: doc.fileName, pageCount: doc.pageCount,
                                sizeBytes: doc.sizeBytes, origin: doc.origin, stage: .captured)
        item.contentHash = doc.contentHash
        item.ocrText = doc.ocrText
        item.thumbnailName = doc.thumbnailName
        return item
    }

    @discardableResult
    static func add(items: [PipelineItem], to context: ModelContext) -> [PipelineItem] {
        items.forEach(context.insert)
        try? context.save()
        return items
    }
}
