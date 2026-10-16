// Owner: deck. The Skipped set (#77; docs/design-spec.md 3.13), opened from the "3 skipped" chip
// at the top of Sort. Layout only: "Sort now" and "Sort skipped" are DeckViewModel methods, run
// through DeckScreen so they animate and announce like every other deck action.
import SwiftUI

struct SkippedSheet: View {
    let model: DeckViewModel
    /// "Sort now" on one row: that card goes on top of the deck.
    let sortNow: (PipelineItem) -> Void
    /// "Sort skipped": every skipped card goes back to the front of the deck.
    let sortAll: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var thumbnails: [UUID: CGImage] = [:]

    private var items: [PipelineItem] { model.skipped }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(items, id: \.id) { item in
                        row(item)
                    }
                } footer: {
                    Text("Saved on your phone until you sort them. Nothing uploads while they wait.")
                }
            }
            .listStyle(.insetGrouped)
            // Same title block as the bulk file sheet: above the list, 24 pt under the grabber.
            .safeAreaInset(edge: .top, spacing: 0) {
                Text(items.count == 1 ? "1 skipped" : "\(items.count) skipped")
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Space.xl)
                    .padding(.top, Space.xxl)
            }
            .safeAreaInset(edge: .bottom) {
                PrimaryButton("Sort skipped", action: sortAll)
                    .disabled(items.isEmpty)
                    .accessibilityIdentifier("skipped.sortAll")
                    .padding(.horizontal, Space.xl)
                    .padding(.bottom, Space.s)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onChange(of: items.isEmpty) { _, empty in if empty { dismiss() } }
        .task(id: items.map(\.id)) {
            for item in items where thumbnails[item.id] == nil {
                if let image = await model.thumbnail(for: item) { thumbnails[item.id] = image }
            }
        }
    }

    private func row(_ item: PipelineItem) -> some View {
        let title = title(item)
        return HStack(spacing: Space.m) {
            DocThumbnail(image: thumbnails[item.id])
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(.primary)
                if let subtitle = subtitle(item) {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Sort now") { sortNow(item) }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(subtitle(item).map { "\(title). \($0)" } ?? title)
        .accessibilityAction(named: "Sort now") { sortNow(item) }
        .accessibilityAction { sortNow(item) }
        .accessibilityHint("Puts it on top of the deck.")
        .accessibilityIdentifier("skipped.row")
    }

    private func title(_ item: PipelineItem) -> String {
        if model.isReadFailed(item) { return "Couldn't read this one" }
        return item.card?.title ?? "Document"
    }

    /// "{issuer} · {date}", as on the card (3.1).
    private func subtitle(_ item: PipelineItem) -> String? {
        guard let card = item.card, !model.isReadFailed(item), !card.issuer.isEmpty else { return nil }
        return DeckFormat.meta(card)
    }
}
