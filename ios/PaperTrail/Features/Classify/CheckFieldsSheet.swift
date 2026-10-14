// Owner: classify (content and the sender-rule write); deck presents it (design spec 3.8, 4.3, A2).
//
// How the deck uses it:
//   .sheet(item: $checking) { item in
//       CheckFieldsSheet(model: CheckFieldsModel(item: item, docs: env.docs), startAt: tappedField) { item in
//           model.file(item)   // light haptic and fly-off right, as a swipe
//       }
//   }
// Opens at the medium detent; swiping it down cancels and leaves the card unchanged.
// All behavior is in CheckFieldsModel.
import SwiftUI

struct CheckFieldsSheet: View {
    @State private var model: CheckFieldsModel
    private let startAt: String?
    private let onConfirm: (PipelineItem) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var detent: PresentationDetent = .medium
    @State private var path: [String] = []
    @State private var showDatePicker = false
    @State private var pickerDate = Date.now
    @State private var isConfirming = false
    @FocusState private var typing: String?
    @AccessibilityFocusState private var titleFocused: Bool

    init(model: CheckFieldsModel, startAt: String? = nil, onConfirm: @escaping (PipelineItem) -> Void) {
        _model = State(initialValue: model)
        self.startAt = startAt
        self.onConfirm = onConfirm
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        header
                        ForEach(model.fields, id: \.self) { field in
                            section(for: field).id(field)
                        }
                        rememberRow
                        confirmButton
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 24)
                    .padding(.bottom, 16)
                }
                .scrollBounceBehavior(.basedOnSize)
                .onAppear {
                    if let startAt, model.fields.contains(startAt) { proxy.scrollTo(startAt, anchor: .top) }
                    titleFocused = true
                }
            }
            .toolbarVisibility(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { _ in
                FolderPickerList(selected: model.currentValue("folder")) { folder in
                    model.pickFolder(folder)
                    path.removeAll()
                }
            }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onChange(of: path) { _, newValue in if !newValue.isEmpty { detent = .large } }
    }

    // MARK: Parts

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.title)
                .font(.title3.bold())
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($titleFocused)
            Text(model.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private func section(for field: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.label(for: field))
                .font(.footnote.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
                .accessibilityAddTraits(.isHeader)
            switch field {
            case "docDate": dateChips
            case "verdict": verdictPicker
            case "folder": folderRows
            default: textRows(for: field)
            }
        }
        .padding(.top, 16)
    }

    private func textRows(for field: String) -> some View {
        VStack(spacing: 8) {
            ForEach(model.options(for: field)) { option in
                RadioRow(text: option.value, trailing: option.likelihood.rawValue,
                         monospaced: field == "filename",
                         isSelected: model.isSelected(option, for: field)) {
                    model.select(option.value, for: field)
                    typing = nil
                }
            }
            if model.isCustom(field) {
                TextField("Type the \(model.label(for: field).lowercased())", text: Binding(
                    get: { model.customText[field] ?? "" }, set: { model.customText[field] = $0 }))
                    .font(field == "filename" ? .body.monospaced() : .body)
                    .textInputAutocapitalization(field == "filename" ? .never : .words)
                    .autocorrectionDisabled(field == "filename")
                    .focused($typing, equals: field)
                    .submitLabel(.done)
                    .radioRowChrome(isSelected: true)
                    .onAppear { typing = field }
            } else {
                RadioRow(text: "Something else", trailing: nil, monospaced: false, isSelected: false) {
                    model.chooseCustom(field)
                }
            }
        }
    }

    private var dateChips: some View {
        FlowLayout(spacing: Space.s) {
            ForEach(model.options(for: "docDate")) { option in
                ChoiceChip(title: CheckFieldsModel.displayDate(option.value),
                                   isSelected: model.isSelected(option, for: "docDate")) {
                    model.select(option.value, for: "docDate")
                }
                .accessibilityValue(option.likelihood.rawValue)
            }
            ChoiceChip(title: "Pick a date", systemImage: "calendar", isSelected: false) {
                pickerDate = CheckFieldsModel.dateFromISODay(model.currentValue("docDate")) ?? .now
                showDatePicker = true
            }
            .popover(isPresented: $showDatePicker) {
                DatePicker("Date", selection: $pickerDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    .padding(16)
                    .frame(minWidth: 320)
                    .presentationCompactAdaptation(.popover)
                    .onChange(of: pickerDate) { _, date in
                        model.pickDate(date)
                        showDatePicker = false
                    }
            }
        }
        .padding(.horizontal, 4)
    }

    private var folderRows: some View {
        VStack(spacing: 8) {
            ForEach(model.options(for: "folder")) { option in
                RadioRow(text: SenderRuleEngine.folderName(option.value), trailing: option.likelihood.rawValue,
                         monospaced: false, isSelected: model.isSelected(option, for: "folder")) {
                    model.select(option.value, for: "folder")
                }
            }
            Button {
                path.append("folders")
            } label: {
                HStack {
                    Text("Choose another folder")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .radioRowChrome(isSelected: false)
            }
            .buttonStyle(.plain)
        }
    }

    private var verdictPicker: some View {
        Picker("Verdict", selection: Binding(get: { model.verdict }, set: { model.verdict = $0 })) {
            ForEach(Verdict.allCases, id: \.self) { verdict in
                Text(verdict.stamp).tag(verdict)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }

    private var rememberRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle("Remember for this sender", isOn: $model.remember)
                .font(.body)
            if model.remember {
                Text(model.rememberFooter)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 20)
    }

    private var confirmButton: some View {
        Button {
            guard !isConfirming else { return }
            isConfirming = true
            Task {
                let item = await model.confirm()
                onConfirm(item)
                dismiss()
            }
        } label: {
            Text(model.confirmTitle)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Color(.accentFill), in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .disabled(isConfirming)
        .padding(.top, 20)
    }
}

// MARK: - Radio rows

/// One choice: Claude's value with "likely", a guess with "possible", or "Something else".
/// Selected: AccentColor 2 pt stroke and a filled radio.
private struct RadioRow: View {
    let text: String
    let trailing: String?
    let monospaced: Bool
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(text)
                    .font(monospaced ? .body.monospaced() : .body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let trailing {
                    Text(trailing)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .radioRowChrome(isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityValue(trailing ?? "")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

private struct RadioRowChrome: ViewModifier {
    let isSelected: Bool

    func body(content: Content) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .strokeBorder(isSelected ? Color(.accent) : Color(.tertiaryLabel), lineWidth: isSelected ? 6 : 1.5)
                    .frame(width: 20, height: 20)
            }
            .accessibilityHidden(true)
            content
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 48)
        .background(Palette.surface, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(isSelected ? Color(.accent) : Palette.separator, lineWidth: isSelected ? 2 : 0.5)
        }
        .contentShape(.rect(cornerRadius: 12, style: .continuous))
    }
}

private extension View {
    func radioRowChrome(isSelected: Bool) -> some View { modifier(RadioRowChrome(isSelected: isSelected)) }
}

// MARK: - Folder picker

/// The 11 folders by display name, in order, checkmark on the current one (spec 4.13's picker).
struct FolderPickerList: View {
    let selected: String
    let onPick: (String) -> Void

    var body: some View {
        List(ArchiveFolder.all, id: \.self) { folder in
            Button {
                onPick(folder)
            } label: {
                HStack {
                    Text(SenderRuleEngine.folderName(folder)).foregroundStyle(.primary)
                    Spacer()
                    if folder == selected {
                        Image(systemName: "checkmark").foregroundStyle(Color(.accent))
                    }
                }
            }
            .accessibilityAddTraits(folder == selected ? .isSelected : [])
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Folder")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.visible, for: .navigationBar)
    }
}

#Preview("A2 check fields") {
    let env = AppEnvironment.sample()
    let item = PipelineItem(fileName: "items/x.pdf", pageCount: 1, sizeBytes: 1, origin: "scan", stage: .ready)
    item.card = SampleData.cascadeBill
    item.unsureFields = ["issuer", "docDate"]
    return Color(.systemGroupedBackground)
        .sheet(isPresented: .constant(true)) {
            CheckFieldsSheet(model: CheckFieldsModel(item: item, docs: env.docs)) { _ in }
        }
        .environment(env)
}
