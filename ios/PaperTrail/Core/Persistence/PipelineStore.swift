// Owner: scaffold.
//
// The SwiftData container for PipelineItem. One container for the app; tests and the sample
// mode use an in-memory one.
import Foundation
import SwiftData

enum PipelineStore {
    static func container(inMemory: Bool) -> ModelContainer {
        let config = ModelConfiguration("Pipeline", isStoredInMemoryOnly: inMemory)
        do {
            return try ModelContainer(for: PipelineItem.self, configurations: config)
        } catch {
            fatalError("Could not open the pipeline store: \(error)")
        }
    }

    /// Items in one stage, oldest first.
    static func items(in stage: PipelineStage, context: ModelContext) -> [PipelineItem] {
        let raw = stage.rawValue
        let descriptor = FetchDescriptor<PipelineItem>(
            predicate: #Predicate { $0.stageRaw == raw },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }
}
