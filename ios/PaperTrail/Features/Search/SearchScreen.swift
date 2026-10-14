// Owner: piles (search UI, #22). Design spec 4.6 (A6): the search island tab.
//
// No NavigationStack here: RootView owns one per tab. `.searchable` attaches to that stack, so in
// the search-role tab the tab bar turns into the bottom search field (A6).
import SwiftUI

struct SearchScreen: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        SearchContent(env: env)
    }
}

private struct SearchContent: View {
    @State private var model: SearchViewModel
    @State private var opened: FiledDoc?
    @State private var attempt = 0
    @Environment(\.openURL) private var openURL

    init(env: AppEnvironment) {
        _model = State(initialValue: SearchViewModel(env: env))
    }

    var body: some View {
        List {
            if model.loadFailed { LoadFailedRow { attempt += 1 } }
            chipRow
            if model.isSearching {
                if !model.hits.isEmpty {
                    Section(model.resultsTitle) {
                        ForEach(model.hits) { hit in resultRow(hit) }
                    }
                }
                if !model.driveHits.isEmpty {
                    Section("Also in Drive") {
                        ForEach(model.driveHits, id: \.id) { file in driveRow(file) }
                    }
                }
            } else {
                if !model.recents.isEmpty {
                    Section("Recent") {
                        ForEach(model.recents, id: \.self) { text in
                            Button { model.use(text) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "clock").foregroundStyle(.secondary).accessibilityHidden(true)
                                    Text(text).foregroundStyle(.primary)
                                    Spacer(minLength: 0)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing) {
                                Button("Remove", role: .destructive) { model.removeRecent(text) }
                            }
                        }
                    }
                }
                if !model.suggestedSenders.isEmpty {
                    Section("Suggested") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(model.suggestedSenders, id: \.self) { sender in
                                    PileKit.FilterChip(title: sender, isOn: false) { model.use(sender) }
                                }
                            }
                        }
                        .scrollClipDisabled()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.showsNoResults {
                ContentUnavailableView.search(text: model.searchedQuery)
            }
        }
        .navigationTitle("Search")
        .navigationDestination(item: $opened) { FiledDocumentView(doc: $0, highlight: model.highlightWords) }
        .searchable(text: $model.query, prompt: "Documents, senders, text")
        .onSubmit(of: .search) { model.remember() }
        .task(id: attempt) { await model.watch() }
    }

    private var chipRow: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.chips, id: \.self) { filter in
                        PileKit.FilterChip(title: filter.title, isOn: model.isOn(filter)) {
                            withAnimation(.smooth(duration: 0.2)) { model.toggle(filter) }
                        }
                    }
                }
            }
            .scrollClipDisabled()
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
        .listSectionSpacing(.compact)
    }

    private func resultRow(_ hit: SearchHit) -> some View {
        let doc = hit.doc
        return Button {
            model.remember()
            opened = doc
        } label: {
            HStack(alignment: .top, spacing: 12) {
                PileKit.DocThumbnail(doc: doc)
                VStack(alignment: .leading, spacing: 2) {
                    Text(highlighted(doc.title)).font(.body).foregroundStyle(.primary)
                    Text("\(doc.issuer) · \(PileFormat.breadcrumb(for: doc))")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let snippet = hit.snippet {
                        Text(highlighted("\u{201C}\(snippet)\u{201D}"))
                            .font(.footnote).foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .contextMenu {
            if let url = model.driveURL(for: doc) {
                Link(destination: url) { Label("Open in Drive", systemImage: "arrow.up.forward.square") }
            }
        }
    }

    private func driveRow(_ file: DriveFileMetadata) -> some View {
        Button {
            model.remember()
            if let url = URL(string: file.webViewLink) { openURL(url) }
        } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(PileKit.Palette.cardWell)
                    .frame(width: 36, height: 46)
                    .overlay { Image(systemName: "doc").foregroundStyle(.secondary) }
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(highlighted(file.name)).font(.body).foregroundStyle(.primary)
                    Text("In Drive").font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.forward").font(.footnote).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens in Drive")
    }

    private func highlighted(_ text: String) -> AttributedString {
        SearchHighlight.attributed(text, words: model.highlightWords)
    }
}
