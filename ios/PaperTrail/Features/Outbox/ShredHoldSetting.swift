// Owner: outbox (ARCHITECTURE.md owners: "shred hold setting"; spec 4.9 lists the row under
// Sorting). The days a verified doc waits before Piles counts it as safe to shred (#18). Stored
// in users/{uid}/config/settings as shredHoldDays, so it follows the account.
import SwiftUI

/// "Shred hold · 3 days ›" in Settings, Sorting.
struct ShredHoldRow: View {
    @Environment(AppEnvironment.self) private var env
    @State private var model: ShredHoldModel?

    var body: some View {
        let model = model ?? ShredHoldModel(docs: env.docs)
        NavigationLink {
            ShredHoldPicker(model: model)
        } label: {
            LabeledContent("Shred hold", value: ShredHoldModel.label(model.days))
        }
        .accessibilityIdentifier("settings.shredHold")
        .task {
            if self.model == nil { self.model = model }
            await model.load()
        }
    }
}

struct ShredHoldPicker: View {
    let model: ShredHoldModel

    var body: some View {
        Form {
            Section {
                ForEach(ShredHoldModel.choices, id: \.self) { days in
                    Button {
                        Task { await model.choose(days) }
                    } label: {
                        HStack {
                            Text(ShredHoldModel.label(days)).foregroundStyle(.primary)
                            Spacer()
                            if model.days == days {
                                Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold)
                            }
                        }
                    }
                    .accessibilityAddTraits(model.days == days ? .isSelected : [])
                }
            } footer: {
                Text(model.saveFailed
                     ? "That didn't save. Check your connection and try again."
                     : "A document counts as safe to shred once its Drive copy is confirmed and this many days have passed.")
            }
        }
        .navigationTitle("Shred hold")
        .navigationBarTitleDisplayMode(.inline)
    }
}
