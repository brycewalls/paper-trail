// Owner: piles. FUNCTIONAL STAND-IN, not the design. Rebuild to docs/design-spec.md once it exists.
import SwiftUI

struct PilesScreen: View {
    @State private var model: PilesViewModel

    init(model: PilesViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Shred pile (\(model.toShred.count))") {
                    ForEach(model.toShred) { doc in
                        HStack {
                            Text(doc.title)
                            Spacer()
                            Button("Mark shredded") { Task { await model.markShredded(doc) } }
                                .buttonStyle(.bordered)
                                .disabled(!doc.isSafeToShred)
                        }
                    }
                }
                Section("Keep originals (\(model.keepOriginals.count))") {
                    ForEach(model.keepOriginals) { Text($0.title) }
                }
                Section {
                    Text("\(model.shreddedCount) shredded so far")
                        .foregroundStyle(Theme.muted)
                }
            }
            .navigationTitle("Piles")
        }
        .task { await model.watch() }
    }
}
