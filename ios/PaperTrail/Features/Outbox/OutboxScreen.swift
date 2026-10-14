// Owner: outbox. Spec 4.4 (A4): pushed onto the current tab's NavigationStack from the accessory,
// so this view has no NavigationStack of its own. Reads the pipeline straight from SwiftData;
// every action goes through OutboxViewModel.
import SwiftData
import SwiftUI

struct OutboxScreen: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(AppRouter.self) private var router: AppRouter?
    private let injected: OutboxViewModel?

    /// How RootView's router pushes it (`case .outbox: OutboxScreen()`).
    init() { injected = nil }
    init(model: OutboxViewModel) { injected = model }

    var body: some View {
        OutboxList(model: injected ?? OutboxViewModel(env: env))
            // Spec 4.4: the accessory hides while the Outbox itself is on screen.
            .onAppear { router?.accessoryHiders.insert("outbox") }
            .onDisappear { router?.accessoryHiders.remove("outbox") }
    }
}

private struct OutboxList: View {
    @State private var model: OutboxViewModel
    @Query private var items: [PipelineItem]
    @State private var now = Date.now

    init(model: OutboxViewModel) {
        _model = State(initialValue: model)
        let file = PipelineDecision.file.rawValue
        let shred = PipelineDecision.shredOnly.rawValue
        _items = Query(filter: #Predicate<PipelineItem> { $0.decisionRaw == file || $0.decisionRaw == shred },
                       sort: \PipelineItem.decidedAt)
    }

    private var byID: [UUID: PipelineItem] { Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) }) }

    var body: some View {
        // The List is the screen's root (not wrapped in a TimelineView) so the large title
        // collapses with the scroll like every other screen.
        content(model: model, now: now)
        .task {
            // Refresh the "Trying again in 2 min." countdown every half minute.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = .now
            }
        }
        .navigationTitle("Outbox")
        .navigationBarTitleDisplayMode(.large)
        .navigationSubtitle(OutboxSummary.subtitle(items.map(OutboxEntry.init)))
        .toolbar {
            if items.contains(where: { $0.stage == .failed }) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Retry all") { Task { await model.retryAll(items) } }
                }
            }
        }
    }

    @ViewBuilder
    private func content(model: OutboxViewModel, now: Date) -> some View {
        let entries = items.map(OutboxEntry.init)
        let attention = OutboxSummary.needsAttention(entries)
        let uploading = OutboxSummary.uploadingSection(entries)
        let today = OutboxSummary.filedToday(entries, now: now)
        let earlier = OutboxSummary.earlier(entries, now: now)
        List {
            if model.needsReconnect {
                ReconnectBanner(model: model)
            }
            if !attention.isEmpty {
                Section(caps: "Needs attention") {
                    ForEach(attention) { entry in
                        if let item = byID[entry.id] { attentionRow(item, entry: entry, model: model, now: now) }
                    }
                }
            }
            if !uploading.isEmpty {
                Section(caps: "Uploading") {
                    ForEach(uploading) { entry in
                        if let item = byID[entry.id] { uploadingRow(item, entry: entry, model: model) }
                    }
                }
            }
            if !today.isEmpty {
                Section(caps: "Filed today") {
                    ForEach(Array(today.enumerated()), id: \.element.id) { index, entry in
                        FiledRow(entry: entry, isFirst: index == 0)
                    }
                }
            }
            if !earlier.isEmpty {
                Section {
                    NavigationLink("Earlier") { OutboxEarlierScreen(groups: earlier) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if entries.isEmpty && !model.needsReconnect {
                ContentUnavailableView("Nothing in the outbox", systemImage: "tray",
                                       description: Text("Filed documents upload from here."))
            }
        }
    }

    private func attentionRow(_ item: PipelineItem, entry: OutboxEntry, model: OutboxViewModel, now: Date) -> some View {
        HStack(spacing: 12) {
            OutboxThumbnail(fileURL: model.fileURL(item), thumbnailURL: model.thumbnailURL(item))
            VStack(alignment: .leading, spacing: 2) {
                Text(OutboxSummary.rowTitle(title: entry.title, issuer: entry.issuer)).font(.body)
                Text(OutboxSummary.failedSubtitle(entry, now: now))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button("Retry") { Task { await model.retry(item) } }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(OutboxPalette.accent)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Retry") { Task { await model.retry(item) } }
        .swipeActions(edge: .trailing) {
            Button("Retry") { Task { await model.retry(item) } }.tint(OutboxPalette.accent)
        }
        .contextMenu {
            Button("Retry", systemImage: "arrow.clockwise") { Task { await model.retry(item) } }
            Button("Send back to the deck", systemImage: "arrow.uturn.backward") { Task { await model.sendBack(item) } }
        }
    }

    private func uploadingRow(_ item: PipelineItem, entry: OutboxEntry, model: OutboxViewModel) -> some View {
        HStack(spacing: 12) {
            OutboxThumbnail(fileURL: model.fileURL(item), thumbnailURL: model.thumbnailURL(item))
            VStack(alignment: .leading, spacing: 6) {
                Text(OutboxSummary.rowTitle(title: entry.title, issuer: entry.issuer)).font(.body)
                if entry.stage == .uploading {
                    ProgressView(value: entry.progress)
                        .progressViewStyle(.linear)
                        .tint(OutboxPalette.accent)
                        .scaleEffect(x: 1, y: 1.25, anchor: .center)
                } else {
                    Text(OutboxSummary.waitingSubtitle(entry, isOnline: model.status.isOnline))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if entry.stage == .uploading {
                Spacer(minLength: 8)
                Text(entry.progress.formatted(.percent.precision(.fractionLength(0))))
                    .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
        .contextMenu {
            Button("Send back to the deck", systemImage: "arrow.uturn.backward") { Task { await model.sendBack(item) } }
        }
    }
}

/// "Filed today" and "Earlier" rows.
private struct FiledRow: View {
    let entry: OutboxEntry
    let isFirst: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.decision == .shredOnly ? "xmark" : "checkmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(entry.decision == .shredOnly ? AnyShapeStyle(.secondary) : AnyShapeStyle(OutboxPalette.file))
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(OutboxSummary.rowTitle(title: entry.title, issuer: entry.issuer)).font(.body)
                Text(OutboxSummary.filedSubtitle(entry, isFirst: isFirst))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .contextMenu {
            if let link = entry.driveURL, let url = URL(string: link) {
                Button("Open in Drive", systemImage: "arrow.up.forward.app") { openURL(url) }
            }
        }
    }
}

/// Spec 3.9: inset grouped section on ShredSoft, never glass.
private struct ReconnectBanner: View {
    let model: OutboxViewModel

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "exclamationmark.icloud.fill").foregroundStyle(OutboxPalette.danger)
                    Text("\(Text("Drive needs reconnecting.").bold()) Your scans are safe on this phone and upload once it's back.")
                        .font(.subheadline)
                }
                Button {
                    Task { await model.reconnect() }
                } label: {
                    if model.isReconnecting { ProgressView() } else { Text("Reconnect Drive") }
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(OutboxPalette.danger)
                .disabled(model.isReconnecting)
                if let error = model.reconnectError {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
            .listRowBackground(OutboxPalette.dangerSoft)
        }
    }
}

/// Spec 4.4, item 6: the last 30 days, grouped by day.
struct OutboxEarlierScreen: View {
    let groups: [(day: Date, entries: [OutboxEntry])]

    var body: some View {
        List {
            ForEach(groups, id: \.day) { group in
                Section(caps: group.day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())) {
                    ForEach(group.entries) { entry in FiledRow(entry: entry, isFirst: false) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Earlier")
    }
}
