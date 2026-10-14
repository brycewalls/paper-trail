// Owner: piles (paperless ledger, #23). Design spec 4.7, sender detail.
import SwiftUI

struct SenderDetailScreen: View {
    let model: PaperlessViewModel
    let senderID: String

    var body: some View {
        // The ledger's own .task stops while this screen covers it, so the detail keeps the
        // listener running itself; otherwise its own writes never show here (#57).
        content.task { await model.watch() }
    }

    @ViewBuilder private var content: some View {
        if let sender = model.sender(id: senderID) {
            Form {
                Section(caps: "Status") {
                    Picker("Status", selection: Binding(
                        get: { sender.status },
                        set: { status in Task { await model.setStatus(sender, to: status) } })) {
                        ForEach(PaperlessStatus.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("paperless.status")
                }
                Section(caps: "How to stop paper") {
                    let steps = model.steps(sender)
                    if steps.isEmpty {
                        Text("No steps yet. Look for paperless or e-delivery in their account settings.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text("\(index + 1).").monospacedDigit().foregroundStyle(.secondary)
                                Text(step)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                Section(caps: "Check back") {
                    DatePicker("Check back", selection: Binding(
                        get: { PileFormat.date(iso: sender.checkBackAt) ?? model.now().addingTimeInterval(35 * 86_400) },
                        set: { date in Task { await model.setCheckBack(sender, to: date) } }),
                               displayedComponents: .date)
                        .datePickerStyle(.compact)
                }
                Section(caps: "Seen") {
                    Text(model.seenText(sender))
                }
                if let action = primaryAction(sender) {
                    Section {
                        Button {
                            Task { await action.run() }
                        } label: {
                            Text(action.title)
                                .font(.headline)
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: 52)
                                .background(Color(.accentFill), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .navigationTitle(sender.issuer)
        } else {
            ContentUnavailableView("Sender not found", systemImage: "leaf")
        }
    }

    private func primaryAction(_ sender: PaperlessSender) -> (title: String, run: () async -> Void)? {
        switch sender.status {
        case .toDo: ("I requested it", { await model.markRequested(sender) })
        case .requested, .waitingCycle: ("It's confirmed", { await model.confirm(sender) })
        case .confirmed, .cantStop: nil
        }
    }
}
