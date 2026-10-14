// Owner: deck. INTERIM host for the check-fields sheet (docs/design-spec.md 3.8, A2), so the deck
// works against origin/ios before classify's branch lands. The unsure fields and Claude's guesses
// come from `ClassifyService.checkFields(for:)` through DeckViewModel; this view only lays them out
// and hands the chosen values back to `DeckViewModel.confirmCheck`.
//
// Classify owns the sheet's content (spec section 7) and builds `CheckFieldsSheet` +
// `CheckFieldsModel` in Features/Classify. When that merges, DeckScreen's one `.sheet(item:)` call
// switches to it (its onConfirm hands the item back; call `model.file(item)`) and this file goes.
// Named DeckCheckFieldsSheet so the two branches don't collide on the type name.
import SwiftUI

struct DeckCheckFieldsSheet: View {
    let card: DocumentCard
    let checks: [FieldCheck]
    var focus: CardField?
    /// Chosen values (card encoding) and the "Remember for this sender" toggle.
    let confirm: ([CardField: String], Bool) -> Void

    @State private var selection: [CardField: String] = [:]
    @State private var custom: [CardField: String] = [:]
    @State private var usingCustom: Set<CardField> = []
    @State private var remember = true
    @State private var detent: PresentationDetent = .medium
    @State private var pickingDate = false
    @State private var pickedDate = Date.now
    @State private var path = NavigationPath()
    @AccessibilityFocusState private var titleFocused: Bool
    @FocusState private var typing: CardField?

    private enum Route: Hashable { case folders }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.xl) {
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text(DeckFormat.checkTitle(checks.count))
                                .font(.title3.bold())
                                .accessibilityAddTraits(.isHeader)
                                .accessibilityFocused($titleFocused)
                            Text("Everything else looks right.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        ForEach(checks, id: \.field) { check in
                            section(check).id(check.field)
                        }
                        rememberRow
                    }
                    .padding(.horizontal, Space.xl)
                    .padding(.top, Space.xxl)
                    .padding(.bottom, Space.l)
                }
                .onAppear {
                    if let focus { proxy.scrollTo(focus, anchor: .top) }
                    titleFocused = true
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    confirm(chosenValues, remember)
                } label: {
                    Text("Confirm and file")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Color(.accentFill), in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, Space.xl)
                .padding(.bottom, Space.s)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { _ in
                FolderPicker(selection: Binding(
                    get: { selection[.folder] ?? card.folder },
                    set: { selection[.folder] = $0; usingCustom.remove(.folder) }))
            }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onAppear {
            for check in checks where selection[check.field] == nil { selection[check.field] = check.best }
        }
        .onChange(of: path.count) { _, count in if count > 0 { detent = .large } }
    }

    /// What "Confirm and file" sends: the chosen value per unsure field, card encoding.
    private var chosenValues: [CardField: String] {
        var values: [CardField: String] = [:]
        for check in checks {
            if usingCustom.contains(check.field) {
                let text = (custom[check.field] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                values[check.field] = text.isEmpty ? check.best : text
            } else {
                values[check.field] = selection[check.field] ?? check.best
            }
        }
        return values
    }

    // MARK: Sections

    @ViewBuilder private func section(_ check: FieldCheck) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(DeckFormat.fieldName(check.field, docType: card.docType).uppercased())
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            switch check.field {
            case .docDate: dateChoices(check)
            case .verdict: verdictPicker(check)
            case .folder: folderChoices(check)
            case .issuer, .title, .filename: textChoices(check)
            }
        }
    }

    private func options(_ check: FieldCheck) -> [(value: String, note: String)] {
        var seen = Set<String>()
        return ([(check.best, "likely")] + check.alternatives.prefix(2).map { ($0, "possible") })
            .filter { seen.insert($0.0).inserted }
    }

    private func textChoices(_ check: FieldCheck) -> some View {
        VStack(spacing: Space.s) {
            ForEach(options(check), id: \.value) { option in
                RadioRow(title: DeckFormat.display(check.field, option.value), note: option.note,
                         isSelected: !usingCustom.contains(check.field) && selection[check.field] == option.value,
                         monospaced: check.field == .filename) {
                    selection[check.field] = option.value
                    usingCustom.remove(check.field)
                }
            }
            if usingCustom.contains(check.field) {
                TextField("Something else", text: Binding(get: { custom[check.field] ?? "" },
                                                          set: { custom[check.field] = $0 }))
                    .font(check.field == .filename ? .body.monospaced() : .body)
                    .focused($typing, equals: check.field)
                    .textInputAutocapitalization(check.field == .filename ? .never : .words)
                    .padding(.vertical, Space.m)
                    .padding(.horizontal, 14)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color(.accent), lineWidth: 2))
            } else {
                RadioRow(title: "Something else", note: nil, isSelected: false) {
                    usingCustom.insert(check.field)
                    if custom[check.field] == nil { custom[check.field] = "" }
                    typing = check.field
                }
            }
        }
    }

    private func dateChoices(_ check: FieldCheck) -> some View {
        let values = options(check).map(\.value).filter { !$0.isEmpty }
        let picked = selection[.docDate] ?? check.best
        return FlowLayout(spacing: Space.s) {
            ForEach(values, id: \.self) { value in
                ChoiceChip(title: DeckFormat.display(.docDate, value), isSelected: picked == value) {
                    selection[.docDate] = value
                }
            }
            if !values.contains(picked), !picked.isEmpty {
                ChoiceChip(title: DeckFormat.display(.docDate, picked), isSelected: true) {}
            }
            ChoiceChip(title: "Pick a date", isSelected: false) {
                pickedDate = DeckFormat.parse(picked) ?? .now
                pickingDate = true
            }
            .popover(isPresented: $pickingDate) {
                DatePicker("Date", selection: $pickedDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    .padding()
                    .frame(minWidth: 320)
                    .presentationCompactAdaptation(.popover)
                    .onChange(of: pickedDate) { _, date in selection[.docDate] = DeckFormat.ymd(date) }
            }
        }
    }

    private func folderChoices(_ check: FieldCheck) -> some View {
        let chosen = selection[.folder] ?? check.best
        let listed = options(check).map(\.value)
        return VStack(spacing: Space.s) {
            ForEach(options(check), id: \.value) { option in
                RadioRow(title: DeckFormat.folderName(option.value), note: option.note,
                         isSelected: chosen == option.value) {
                    selection[.folder] = option.value
                }
            }
            if !listed.contains(chosen) {
                RadioRow(title: DeckFormat.folderName(chosen), note: nil, isSelected: true) {}
            }
            RadioRow(title: "Choose another folder", note: nil, isSelected: false, chevron: true) {
                path.append(Route.folders)
            }
        }
    }

    private func verdictPicker(_ check: FieldCheck) -> some View {
        Picker("Verdict", selection: Binding(get: { selection[.verdict] ?? check.best },
                                             set: { selection[.verdict] = $0 })) {
            ForEach(Verdict.allCases, id: \.self) { verdict in
                Text(verdict.stamp).tag(verdict.rawValue)
            }
        }
        .pickerStyle(.segmented)
    }

    private var rememberRow: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Toggle("Remember for this sender", isOn: $remember)
                .padding(.vertical, Space.m)
                .padding(.horizontal, 14)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if remember {
                Text("Next time, \(issuerForFooter) files this way without asking.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
            }
        }
    }

    private var issuerForFooter: String {
        let value = chosenValues[.issuer] ?? card.issuer
        return value.isEmpty ? "this sender" : value
    }
}

/// One choice in the sheet: radio, value, and "likely" / "possible" trailing (3.8).
private struct RadioRow: View {
    let title: String
    let note: String?
    let isSelected: Bool
    var monospaced = false
    var chevron = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.m) {
                if !chevron {
                    Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                        .foregroundStyle(isSelected ? Color(.accent) : Color.secondary)
                        .imageScale(.large)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(monospaced ? .body.monospaced() : .body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: Space.s)
                if let note {
                    Text(note).font(.caption).foregroundStyle(.secondary)
                }
                if chevron {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, Space.m)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(isSelected ? Color(.accent) : Palette.separator, lineWidth: isSelected ? 2 : 0.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(note ?? "")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
