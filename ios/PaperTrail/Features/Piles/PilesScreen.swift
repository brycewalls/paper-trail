// Owner: piles. Design spec 4.5 (A5): the Shred, Keep and All filed piles.
//
// No NavigationStack here: RootView owns one per tab (deck's tab shell), so the outbox accessory
// can push onto whichever tab is showing. Pushes use navigationDestination(item:).
import SwiftUI

struct PilesScreen: View {
    @State private var model: PilesViewModel
    @State private var opened: FiledDoc?
    @State private var confirmMark = false
    /// Bumped by "Try again" to restart the listeners.
    @State private var attempt = 0

    init(model: PilesViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        List {
            if model.driveNeedsReconnect { ReconnectBanner(model: model) }
            if model.loadFailed { LoadFailedRow { attempt += 1 } }
            segmentPicker
            switch model.segment {
            case .shred: shredSections
            case .keep: keepSections
            case .all: allSections
            }
        }
        .listStyle(.insetGrouped)
        .contentMargins(.bottom, showsMarkButton ? 84 : 0, for: .scrollContent)
        .navigationTitle("Piles")
        .toolbar {
            if model.segment == .all {
                ToolbarItem(placement: .topBarTrailing) { filterMenu }
            }
            ToolbarItem(placement: .topBarTrailing) { AvatarButton() }
        }
        .overlay(alignment: .bottom) { if showsMarkButton { markButton } }
        .navigationDestination(item: $opened) { FiledDocumentView(doc: $0) }
        .alert("Couldn't save", isPresented: Binding(get: { model.writeError != nil }, set: { if !$0 { model.writeError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.writeError ?? "")
        }
        .task(id: attempt) { await model.watch() }
    }

    private var showsMarkButton: Bool { model.segment == .shred && !model.safe.isEmpty }

    // MARK: Segments

    private var segmentPicker: some View {
        Section {
            Picker("Pile", selection: $model.segment) {
                Text("Shred \(model.shredPile.count)").tag(PilesViewModel.Segment.shred)
                Text("Keep \(model.keepCount)").tag(PilesViewModel.Segment.keep)
                Text("All filed \(model.filedCount)").tag(PilesViewModel.Segment.all)
            }
            .pickerStyle(.segmented)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
        .listSectionSpacing(.compact)
    }

    @ViewBuilder private var shredSections: some View {
        if model.loaded && model.shredPile.isEmpty {
            emptyRow(ContentUnavailableView("Nothing to shred", systemImage: "checkmark.circle",
                                            description: Text("Documents you file show up here once their Drive copy is confirmed.")))
        }
        if let banner = model.safeBanner {
            Section {
                PileKit.BannerRow(background: PileKit.Palette.fileSoft) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(PileKit.Palette.file)
                            .accessibilityHidden(true)
                        Text("\(Text(banner.bold).bold()) \(banner.rest)")
                            .font(.subheadline)
                    }
                }
            }
        }
        if !model.safe.isEmpty {
            Section(caps: "Safe to shred") {
                ForEach(model.visibleSafe) { doc in
                    row(doc, subtitle: model.shredSubtitle(doc)) { PileKit.StatusPill(kind: .safe) }
                        .swipeActions(edge: .trailing) {
                            Button("Shredded") { Task { await model.markShredded(doc) } }
                                .tint(PileKit.Palette.fileFill)
                        }
                }
                if model.hiddenSafeCount > 0 {
                    Button {
                        withAnimation(.smooth) { model.showAllSafe = true }
                    } label: {
                        HStack {
                            Text("\(model.hiddenSafeCount) more").foregroundStyle(.secondary)
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(model.hiddenSafeCount) more safe to shred")
                }
            }
        }
        if !model.waiting.isEmpty {
            Section(caps: "Waiting") {
                ForEach(model.waiting) { doc in
                    row(doc, subtitle: model.waitingSubtitle(doc)) {
                        PileKit.StatusPill(kind: .waiting(model.waitingPill(doc)))
                    }
                }
            }
        }
    }

    @ViewBuilder private var keepSections: some View {
        if model.loaded && model.keepCount == 0 {
            emptyRow(ContentUnavailableView("No originals to keep", systemImage: "archivebox",
                                            description: Text("Cards marked Keep original show up here.")))
        }
        if !model.toPutAway.isEmpty {
            Section(caps: "To put away") {
                ForEach(model.toPutAway) { doc in
                    row(doc, subtitle: model.keepSubtitle(doc)) { EmptyView() }
                        .swipeActions(edge: .trailing) {
                            Button("Put away") { Task { await model.putAway(doc) } }
                                .tint(PileKit.Palette.accentFill)
                        }
                }
            }
        }
        if !model.inBinder.isEmpty {
            Section(caps: "In the binder") {
                ForEach(model.inBinder) { doc in
                    row(doc, subtitle: model.keepSubtitle(doc)) {
                        Image(systemName: "archivebox").foregroundStyle(.secondary).accessibilityLabel("Put away")
                    }
                    .swipeActions(edge: .trailing) {
                        Button("Take out") { Task { await model.takeOut(doc) } }
                    }
                }
            }
        }
    }

    @ViewBuilder private var allSections: some View {
        if model.loaded && model.filed.isEmpty {
            if model.allFilter == .sensitive && model.filedCount > 0 {
                emptyRow(ContentUnavailableView("Nothing sensitive", systemImage: "lock",
                                                description: Text("No filed documents are marked Sensitive.")))
            } else {
                emptyRow(ContentUnavailableView("Nothing filed yet", systemImage: "folder",
                                                description: Text("Everything you file to Drive shows up here.")))
            }
        }
        ForEach(model.filedByMonth, id: \.title) { group in
            Section(caps: group.title) {
                ForEach(group.docs) { doc in
                    row(doc, subtitle: model.filedSubtitle(doc)) { PileKit.VerdictBadge(verdict: doc.verdict) }
                        .contextMenu {
                            if let url = model.driveURL(doc) {
                                Link(destination: url) { Label("Open in Drive", systemImage: "arrow.up.forward.square") }
                            }
                        }
                }
            }
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("Show", selection: $model.allFilter) {
                Text("All").tag(PilesViewModel.AllFilter.all)
                Text("Sensitive").tag(PilesViewModel.AllFilter.sensitive)
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .accessibilityLabel("Filter")
        }
    }

    // MARK: Pieces

    private func row<Trailing: View>(_ doc: FiledDoc, subtitle: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        Button {
            opened = doc
        } label: {
            HStack(spacing: 12) {
                PileKit.DocThumbnail(doc: doc)
                VStack(alignment: .leading, spacing: 2) {
                    Text(doc.title).font(.body).foregroundStyle(.primary)
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                trailing()
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    private func emptyRow(_ content: some View) -> some View {
        Section {
            content
                .frame(maxWidth: .infinity)
                .padding(.top, 32)
                .listRowBackground(Color.clear)
        }
    }

    private var markButton: some View {
        Button {
            confirmMark = true
        } label: {
            Text(model.markTitle)
                .font(.headline)
                .foregroundStyle(PileKit.Palette.accent)
                .padding(.horizontal, 24)
                .frame(minHeight: 54)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .padding(.bottom, 12)
        .confirmationDialog(model.markConfirmTitle, isPresented: $confirmMark, titleVisibility: .visible) {
            Button(model.markTitle) { Task { await model.markSafeShredded() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Do this once the paper has gone through the shredder.")
        }
    }
}

/// Spec 3.9 Reconnect Drive banner, shown on Piles while the server has no Drive token (4.16).
private struct ReconnectBanner: View {
    let model: PilesViewModel

    var body: some View {
        Section {
            PileKit.BannerRow(background: PileKit.Palette.shredSoft) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Image(systemName: "exclamationmark.icloud.fill")
                            .foregroundStyle(PileKit.Palette.danger)
                            .accessibilityHidden(true)
                        Text("\(Text("Drive needs reconnecting.").bold()) Your scans are safe on this phone and upload once it's back.")
                            .font(.subheadline)
                    }
                    Button {
                        Task { await model.reconnectDrive() }
                    } label: {
                        if model.reconnecting { ProgressView() } else { Text("Reconnect Drive") }
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .disabled(model.reconnecting)
                    if model.reconnectFailed {
                        Text("Drive didn't reconnect. Try again in a minute.")
                            .font(.footnote)
                            .foregroundStyle(PileKit.Palette.danger)
                    }
                }
            }
        }
    }
}

/// Shown when the Firestore listener fails before anything loaded (signed out mid-stream, or the
/// account lost access). Not in spec 3.11; worded like its other states.
struct LoadFailedRow: View {
    let retry: () -> Void

    var body: some View {
        Section {
            ContentUnavailableView {
                Label("Couldn't load your documents", systemImage: "exclamationmark.icloud")
            } description: {
                Text("Paper Trail couldn't reach your library. Check your connection, then try again.")
            } actions: {
                Button("Try again", action: retry).buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }
}
