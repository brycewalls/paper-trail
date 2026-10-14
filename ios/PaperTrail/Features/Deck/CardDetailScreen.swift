// Owner: deck. Card detail and edit (docs/design-spec.md 4.13), pushed from the deck by a tap,
// "Edit details" or "Fill it in yourself". "Done" saves through DeckViewModel; Shred and File in
// the bottom bar hand back to DeckScreen so they run exactly like the action row.
import SwiftUI
import PDFKit

struct CardDetailScreen: View {
    let model: DeckViewModel
    let item: PipelineItem
    /// Shred or File from the bottom bar. DeckScreen pops and decides.
    let decide: (DeckSide) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppRouter.self) private var router
    @State private var draft: DocumentCard
    @State private var original: DocumentCard?
    @State private var unsure: Set<CardField>
    @State private var remember = true
    @State private var pages: [CGImage] = []
    @State private var showPDF = false

    init(model: DeckViewModel, item: PipelineItem, decide: @escaping (DeckSide) -> Void) {
        self.model = model
        self.item = item
        self.decide = decide
        _draft = State(initialValue: model.blankCard(for: item))
        _original = State(initialValue: item.card)
        _unsure = State(initialValue: Set(model.unsureFields(item)))
    }

    var body: some View {
        Form {
            Section {
                pageViewer
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Section {
                VStack(alignment: .leading, spacing: Space.s) {
                    VerdictBadge(verdict: draft.verdict, size: .large)
                    if !draft.verdictReason.isEmpty {
                        Text("Why: \(draft.verdictReason)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: Space.xl, bottom: 0, trailing: Space.xl))
            }

            Section(caps: "Details") {
                field("Title", .title) { TextField("Title", text: edit(\.title, .title)) }
                field("Sender", .issuer) { TextField("Sender", text: edit(\.issuer, .issuer)) }
                dateRow
                LabeledContent("Type") {
                    TextField("Type", text: $draft.docType).multilineTextAlignment(.trailing)
                }
            }

            Section(caps: "Filing") {
                NavigationLink {
                    FolderPicker(selection: edit(\.folder, .folder))
                } label: {
                    HStack {
                        Text("Folder")
                        Spacer()
                        Text(DeckFormat.folderPath(draft)).foregroundStyle(.secondary)
                        notSure(.folder)
                    }
                }
                VStack(alignment: .leading, spacing: Space.xs) {
                    HStack {
                        Text("Filename")
                        Spacer()
                        notSure(.filename)
                    }
                    HStack(spacing: 0) {
                        TextField("Filename", text: edit(\.filename, .filename))
                            .font(.body.monospaced())
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Text(".pdf").font(.body.monospaced()).foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: Space.s) {
                    HStack {
                        Text("Verdict")
                        Spacer()
                        notSure(.verdict)
                    }
                    Picker("Verdict", selection: edit(\.verdict, .verdict)) {
                        ForEach(Verdict.allCases, id: \.self) { Text($0.stamp).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
            }

            Section(caps: "About") {
                TextField("Summary", text: $draft.summary, axis: .vertical)
                    .lineLimit(2...8)
                LabeledContent("Retention") {
                    TextField("Retention", text: $draft.retention).multilineTextAlignment(.trailing)
                }
                Toggle("Sensitive", isOn: $draft.sensitive)
            }

            if model.filingChanged(from: original, to: draft) {
                Section {
                    Toggle("Remember for this sender", isOn: $remember)
                } footer: {
                    if remember {
                        Text("Next time, \(draft.issuer.isEmpty ? "this sender" : draft.issuer) files this way without asking.")
                    }
                }
            }
        }
        .navigationTitle(draft.title.isEmpty ? "Details" : draft.title)
        .navigationBarTitleDisplayMode(.inline)
        // The bottom bar's Shred and File take the tab bar's place while the detail is open.
        .toolbar(.hidden, for: .tabBar)
        .onAppear { router.accessoryHiders.insert("cardDetail") }
        .onDisappear { router.accessoryHiders.remove("cardDetail") }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    Task {
                        await model.saveEdits(item, card: draft, remember: remember && model.filingChanged(from: original, to: draft))
                        dismiss()
                    }
                }
            }
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    Task { await saveIfChanged(); decide(.shred) }
                } label: {
                    // Text with an inline symbol, so the bar shows the word and not only the icon.
                    Text("\(Image(systemName: "xmark")) Shred")
                }
                .tint(Palette.danger)
                Spacer()
                Button {
                    Task { await saveIfChanged(); decide(.file) }
                } label: {
                    Text("\(Image(systemName: "checkmark")) File")
                }
                .tint(Color(.file))
                .disabled(draft.title.isEmpty && draft.filename.isEmpty)
            }
        }
        .task { pages = await model.pages(for: item) }
        .fullScreenCover(isPresented: $showPDF) {
            NavigationStack {
                PDFKitView(url: model.fileURL(for: item))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(draft.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { showPDF = false } }
                    }
            }
        }
    }

    // MARK: Pieces

    private var pageViewer: some View {
        TabView {
            if pages.isEmpty {
                Image(systemName: "doc.text").font(.largeTitle).foregroundStyle(.tertiary)
            }
            ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                Image(decorative: page, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(Space.l)
                    .accessibilityLabel("Page \(index + 1) of \(pages.count)")
                    .accessibilityAddTraits(.isButton)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .always : .never))
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .frame(height: 320)
        .background(Color(.cardWell), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { showPDF = true }
    }

    @ViewBuilder private var dateRow: some View {
        if let date = DeckFormat.parse(draft.docDate) {
            HStack {
                DatePicker("Date", selection: Binding(
                    get: { date },
                    set: { draft.docDate = DeckFormat.ymd($0); unsure.remove(.docDate) }),
                           displayedComponents: .date)
                    .datePickerStyle(.compact)
                notSure(.docDate)
            }
        } else {
            HStack {
                Text("Date")
                Spacer()
                Button("Add a date") {
                    draft.docDate = DeckFormat.ymd(.now)
                    unsure.remove(.docDate)
                }
            }
        }
    }

    private func field<Content: View>(_ label: String, _ key: CardField, @ViewBuilder content: () -> Content) -> some View {
        LabeledContent(label) {
            HStack(spacing: Space.s) {
                content().multilineTextAlignment(.trailing)
                notSure(key)
            }
        }
    }

    @ViewBuilder private func notSure(_ key: CardField) -> some View {
        if unsure.contains(key) {
            Text("Not sure")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(.unsure))
                .fixedSize()
        }
    }

    /// A binding that clears the field's "Not sure" once it's edited.
    private func edit<Value>(_ keyPath: WritableKeyPath<DocumentCard, Value>, _ key: CardField) -> Binding<Value> {
        Binding(get: { draft[keyPath: keyPath] },
                set: { draft[keyPath: keyPath] = $0; unsure.remove(key) })
    }

    /// Before Shred or File from the bottom bar. A card that failed to read and wasn't filled in
    /// stays without a card, so Shred logs it the same way the action row does.
    private func saveIfChanged() async {
        guard draft != (original ?? model.blankCard(for: item)) else { return }
        await model.saveEdits(item, card: draft, remember: remember && model.filingChanged(from: original, to: draft))
    }
}

/// Full-screen PDF with zoom (4.13).
private struct PDFKitView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}
