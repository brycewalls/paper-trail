// Owner: deck. FUNCTIONAL STAND-IN, not the design. Rebuild to docs/design-spec.md once it exists;
// all behavior lives in DeckViewModel.
import SwiftUI

struct DeckScreen: View {
    @State private var model: DeckViewModel

    init(model: DeckViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let item = model.cards.first, let card = item.card {
                    VStack(spacing: 16) {
                        CardStandIn(card: card, pages: item.pageCount)
                        HStack {
                            Button("Shred", role: .destructive) { Task { await model.shred(item) } }
                            Spacer()
                            Button("Later") { model.later(item) }
                            Spacer()
                            Button("File") { Task { await model.file(item) } }
                                .buttonStyle(.borderedProminent)
                        }
                        Text("\(model.cards.count) to sort")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                    }
                    .padding()
                } else if model.isLoading {
                    ProgressView(model.readingCount > 0 ? "Reading \(model.readingCount) documents" : "Loading")
                } else {
                    ContentUnavailableView("Nothing to sort", systemImage: "tray",
                                           description: Text("Scanned documents show up here once Claude has read them."))
                }
            }
            .navigationTitle("Sort")
            .toolbar {
                if model.isSample {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add samples") { Task { await model.loadSample() } }
                    }
                }
            }
        }
        .task { await model.load() }
    }
}

private struct CardStandIn: View {
    let card: DocumentCard
    let pages: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(card.verdict.stamp.uppercased())
                .font(.headline)
                .foregroundStyle(Theme.color(for: card.verdict))
            Text(card.title).font(.title2.bold())
            Text("\(card.docType), \(card.docDate.isEmpty ? "no date" : card.docDate), \(pages) page\(pages == 1 ? "" : "s")")
                .foregroundStyle(Theme.muted)
            Text(card.summary)
            Text(card.verdictReason).foregroundStyle(Theme.muted)
            LabeledContent("Folder", value: card.folder)
            LabeledContent("Filename", value: card.filename + ".pdf")
            if let confidence = card.confidence {
                LabeledContent("Confidence", value: confidence.overall.formatted(.percent.precision(.fractionLength(0))))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Theme.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
    }
}
