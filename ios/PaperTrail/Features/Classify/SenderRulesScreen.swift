// Owner: classify. The Senders list, rule detail and the Settings row (design spec 4.12, 4.9, 3.10,
// 3.11, #21, #27). Behavior is in SenderRulesViewModel.
import SwiftUI

/// Settings › Sorting › "Sender rules · 14 ›".
struct SenderRulesSettingsRow: View {
    @State private var model: SenderRulesViewModel

    init(docs: any DocStore) {
        _model = State(initialValue: SenderRulesViewModel(docs: docs))
    }

    var body: some View {
        NavigationLink {
            SenderRulesScreen(model: model)
        } label: {
            LabeledContent("Sender rules") {
                Text(model.hasLoaded ? "\(model.count)" : "")
                    .contentTransition(.numericText())
            }
        }
        .accessibilityIdentifier("settings.senderRules")
        .task { await model.load() }
    }
}

struct SenderRulesScreen: View {
    @State private var model: SenderRulesViewModel

    init(model: SenderRulesViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        List {
            ForEach(model.visible) { rule in
                NavigationLink {
                    SenderRuleDetailScreen(rule: rule, model: model)
                } label: {
                    SenderRuleRow(rule: rule)
                }
                .swipeActions(edge: .trailing) {
                    Button("Forget", role: .destructive) {
                        Task { await model.forget(rule) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.hasLoaded && model.rules.isEmpty {
                ContentUnavailableView(
                    "No sender rules yet", systemImage: "person.crop.rectangle.stack",
                    description: Text("When you fix a card with Remember for this sender on, the rule shows up here."))
            } else if !model.query.isEmpty && model.visible.isEmpty {
                ContentUnavailableView.search(text: model.query)
            }
        }
        .navigationTitle("Sender rules")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $model.query, prompt: "Senders")
        .task { await model.load() }
    }
}

/// Spec 3.10 "Sender rule" row: issuer, then "{folder} · {verdict stamp} · {pattern}".
private struct SenderRuleRow: View {
    let rule: SenderRule

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(rule.issuer).font(.body)
            let subtitle = SenderRulesViewModel.subtitle(for: rule)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct SenderRuleDetailScreen: View {
    let original: SenderRule
    let model: SenderRulesViewModel

    @Environment(\.dismiss) private var dismiss
    @State private var rule: SenderRule
    @State private var confirmForget = false
    @State private var forgotten = false

    init(rule: SenderRule, model: SenderRulesViewModel) {
        original = rule
        self.model = model
        _rule = State(initialValue: rule)
    }

    var body: some View {
        Form {
            // Spec 4.12 order: Folder, Verdict, Document type, then Filename.
            Section {
                Picker("Folder", selection: $rule.folder) {
                    ForEach(ArchiveFolder.all, id: \.self) { folder in
                        Text(SenderRuleEngine.folderName(folder)).tag(Optional(folder))
                    }
                }
            }

            Section(caps: "Verdict") {
                Picker("Verdict", selection: Binding(
                    get: { rule.verdict ?? .scanShred }, set: { rule.verdict = $0 })) {
                    ForEach(Verdict.allCases, id: \.self) { Text($0.stamp).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            Section {
                LabeledContent("Document type") {
                    TextField("Document type", text: Binding(
                        get: { rule.docType ?? "" },
                        set: { rule.docType = $0.isEmpty ? nil : $0 }))
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                TextField("{date}_sender-name", text: Binding(
                    get: { rule.filenamePattern ?? "" },
                    set: { rule.filenamePattern = $0.isEmpty ? nil : $0 }))
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                ClassifyFlowLayout(spacing: 8) {
                    ForEach(SenderRuleEngine.tokens, id: \.self) { token in
                        ClassifyChoiceChip(title: token, isOn: (rule.filenamePattern ?? "").contains(token)) {
                            rule.filenamePattern = (rule.filenamePattern ?? "") + token
                        }
                        .accessibilityLabel("Add \(token)")
                    }
                }
                let preview = SenderRulesViewModel.preview(pattern: rule.filenamePattern ?? "", rule: rule,
                                                           docType: rule.docType ?? "")
                if !preview.isEmpty {
                    Text(preview)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Preview: \(preview)")
                }
            } header: {
                Text("Filename")
            } footer: {
                if let updated = SenderRulesViewModel.updatedFooter(for: original) { Text(updated) }
            }

            Section {
                Button("Forget this sender", role: .destructive) { confirmForget = true }
                    .confirmationDialog(SenderRulesViewModel.forgetTitle(for: rule), isPresented: $confirmForget,
                                        titleVisibility: .visible) {
                        Button("Forget", role: .destructive) {
                            forgotten = true
                            Task { await model.forget(rule) }
                            dismiss()
                        }
                        Button("Cancel", role: .cancel) {}
                    }
            }
        }
        .navigationTitle(rule.issuer)
        .navigationBarTitleDisplayMode(.large)
        .onDisappear {
            guard !forgotten, rule != original else { return }
            let edited = rule
            Task { await model.save(edited) }
        }
    }
}

#Preview("Sender rules") {
    let env = AppEnvironment.sample()
    return NavigationStack { SenderRulesScreen(model: SenderRulesViewModel(docs: env.docs)) }
        .environment(env)
}
