// Owner: outbox. FUNCTIONAL STAND-IN, not the design. Rebuild to docs/design-spec.md once it
// exists. Reads the pipeline straight from SwiftData. Pushed from the outbox accessory onto the
// current tab's NavigationStack (RootView owns the stack).
import SwiftUI
import SwiftData

struct OutboxScreen: View {
    @Query(sort: \PipelineItem.decidedAt, order: .reverse) private var items: [PipelineItem]

    private var outbox: [PipelineItem] {
        items.filter { $0.decision != nil && $0.decision != .later }
    }

    var body: some View {
        List(outbox) { item in
                VStack(alignment: .leading) {
                    Text(item.card?.title ?? item.fileName)
                    Text(item.stage.rawValue.capitalized)
                        .font(.footnote)
                        .foregroundStyle(item.stage == .failed ? Palette.danger : .secondary)
                }
            }
            .overlay {
                if outbox.isEmpty {
                    ContentUnavailableView("Outbox is empty", systemImage: "tray.and.arrow.up",
                                           description: Text("Filed documents upload from here."))
                }
            }
            .navigationTitle("Outbox")
    }
}
