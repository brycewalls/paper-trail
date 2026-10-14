// Owner: piles (paperless ledger, #23). Design spec 4.7 (A7).
//
// No NavigationStack here: RootView owns one per tab. Pushes use navigationDestination(item:).
import SwiftUI

struct PaperlessScreen: View {
    @Environment(AppEnvironment.self) private var env
    private let model: PaperlessViewModel?

    init(model: PaperlessViewModel) { self.model = model }
    /// Builds its view model from the environment, for a tab shell that doesn't make one.
    init() { model = nil }

    var body: some View {
        PaperlessContent(model: model ?? PaperlessViewModel(env: env))
    }
}

private struct PaperlessContent: View {
    @State private var model: PaperlessViewModel
    @State private var route: PaperlessRoute?
    @State private var attempt = 0

    init(model: PaperlessViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        List {
            if model.loadFailed { LoadFailedRow { attempt += 1 } }
            if model.loaded && model.senders.isEmpty {
                Section {
                    ContentUnavailableView("No senders yet", systemImage: "leaf",
                                           description: Text("When a scan comes from someone who offers paperless, they show up here."))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 32)
                        .listRowBackground(Color.clear)
                }
            }
            ForEach(model.visibleFlags) { flag in
                StillMailingBanner(text: model.bannerText(flag),
                                   openSteps: { route = .sender(flag.sender.id) },
                                   waitACycle: { Task { await model.waitACycle(flag.sender) } })
            }
            if model.hiddenFlagCount > 0 {
                Section {
                    Button {
                        withAnimation(.smooth) { model.showAllFlags = true }
                    } label: {
                        HStack {
                            Text(model.moreFlagsText).foregroundStyle(PileKit.Palette.unsure)
                            Spacer()
                            Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            if !model.checkBackSoon.isEmpty {
                Section("Check back soon") {
                    ForEach(model.checkBackSoon) { sender in
                        senderRow(sender, title: sender.issuer, subtitle: model.checkBackText(sender), status: sender.status)
                    }
                }
            }
            if !model.toDo.isEmpty {
                Section("To do") {
                    ForEach(model.toDo) { sender in
                        senderRow(sender, title: sender.issuer, subtitle: model.firstStep(sender), status: .toDo)
                    }
                }
            }
            if let group = model.doneGroup {
                Section("Done") {
                    if model.doneSenders.count == 1, let only = model.doneSenders.first {
                        senderRow(only, title: only.issuer, subtitle: nil, status: only.status)
                    } else {
                        Button { route = .done } label: {
                            paperlessRowContent(title: group.title, subtitle: group.subtitle, status: group.status)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Paperless")
        .navigationSubtitle(model.subtitle ?? "")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { AvatarButton() }
        }
        .navigationDestination(item: $route) { route in
            switch route {
            case .sender(let id): SenderDetailScreen(model: model, senderID: id)
            case .done: DoneSendersScreen(model: model)
            }
        }
        .alert("Couldn't save", isPresented: Binding(get: { model.writeError != nil }, set: { if !$0 { model.writeError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.writeError ?? "")
        }
        .task(id: attempt) { await model.watch() }
    }

    private func senderRow(_ sender: PaperlessSender, title: String, subtitle: String?, status: PaperlessStatus) -> some View {
        Button { route = .sender(sender.id) } label: {
            paperlessRowContent(title: title, subtitle: subtitle, status: status)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .swipeActions(edge: .trailing) {
            ForEach(model.swipeChoices(sender), id: \.self) { choice in
                Button(choice.label) { Task { await model.setStatus(sender, to: choice) } }
                    .tint(choice == .confirmed ? PileKit.Palette.fileFill : choice == .requested ? PileKit.Palette.accentFill : .gray)
            }
        }
    }
}

enum PaperlessRoute: Hashable {
    case sender(String)
    case done
}

/// Spec 3.10 Paperless sender row: issuer, the check-back date or first step, and the status pill.
fileprivate func paperlessRowContent(title: String, subtitle: String?, status: PaperlessStatus) -> some View {
    HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.body).foregroundStyle(.primary)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.footnote).foregroundStyle(.secondary)
            }
        }
        Spacer(minLength: 8)
        PileKit.StatusPill(kind: .paperless(status))
    }
    .frame(minHeight: 44)
    .contentShape(Rectangle())
}

/// Spec 3.9: the "Still mailing?" banner. UnsureSoft, never glass.
private struct StillMailingBanner: View {
    let text: String
    let openSteps: () -> Void
    let waitACycle: () -> Void

    var body: some View {
        Section {
            PileKit.BannerRow(background: PileKit.Palette.unsureSoft) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
                        Text("Still mailing?")
                    }
                    .font(.subheadline.bold())
                    .foregroundStyle(PileKit.Palette.unsure)
                    Text(text).font(.subheadline)
                    HStack(spacing: 8) {
                        PileKit.BannerChip(title: "Open their steps", action: openSteps)
                        PileKit.BannerChip(title: "Wait a cycle", action: waitACycle)
                    }
                    .padding(.top, 4)
                }
            }
        }
    }
}

/// Every Confirmed and Can't stop sender, pushed from the grouped Done row.
private struct DoneSendersScreen: View {
    let model: PaperlessViewModel
    @State private var opened: String?

    var body: some View {
        List {
            ForEach(model.doneSenders) { sender in
                Button { opened = sender.id } label: {
                    HStack(spacing: 12) {
                        paperlessRowContent(title: sender.issuer, subtitle: nil, status: sender.status)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .swipeActions(edge: .trailing) {
                    Button("To do") { Task { await model.setStatus(sender, to: .toDo) } }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Done")
        .navigationDestination(item: $opened) { SenderDetailScreen(model: model, senderID: $0) }
    }
}
