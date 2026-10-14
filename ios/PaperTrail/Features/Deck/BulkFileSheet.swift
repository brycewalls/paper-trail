// Owner: deck. "File {n} confident cards" (docs/design-spec.md section 5, "Bulk filing confident
// cards"). Only offered when Settings > "Offer to file confident cards together" is on (off by
// default, Bryce's decision 5).
import SwiftUI

struct BulkFileSheet: View {
    let model: DeckViewModel
    let items: [PipelineItem]
    let confirm: ([PipelineItem]) -> Void

    @State private var excluded: Set<UUID> = []
    @State private var thumbnails: [UUID: CGImage] = [:]

    private var chosen: [PipelineItem] { items.filter { !excluded.contains($0.id) } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(items, id: \.id) { item in
                        row(item)
                    }
                } footer: {
                    Text("Keep original cards still keep their paper.")
                }
            }
            .listStyle(.insetGrouped)
            // The title block sits above the list, not in its section header, so the list's
            // scroll edge doesn't wash it out and it gets the same 24 pt under the grabber as the
            // check-fields sheet.
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("File \(items.count) confident cards")
                        .font(.title3.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text("Claude is sure about every field on these. Each one goes to the outbox like a swipe right.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Space.xl)
                .padding(.top, Space.xxl)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    confirm(chosen)
                } label: {
                    Text("File \(chosen.count)")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Color(.accentFill).opacity(chosen.isEmpty ? 0.4 : 1), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(chosen.isEmpty)
                .padding(.horizontal, Space.xl)
                .padding(.bottom, Space.s)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            for item in items {
                if let image = await model.thumbnail(for: item) { thumbnails[item.id] = image }
            }
        }
    }

    private func row(_ item: PipelineItem) -> some View {
        let isOn = !excluded.contains(item.id)
        return Button {
            if isOn { excluded.insert(item.id) } else { excluded.remove(item.id) }
        } label: {
            HStack(spacing: Space.m) {
                DocThumbnail(image: thumbnails[item.id])
                Text(item.card?.title ?? "Document")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let verdict = item.card?.verdict { VerdictBadge(verdict: verdict) }
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isOn ? Color(.accent) : Color.secondary)
                    .imageScale(.large)
            }
        }
        // Plain style: inside a List a bordered-less Button tints its label with the accent.
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
