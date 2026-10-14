// Owner: deck. The Sort tab (docs/design-spec.md 4.2, 4.3, 4.14, A1, A2, A9). Layout and
// gestures only; every decision is a DeckViewModel method. RootView provides the NavigationStack.
import SwiftUI
import UIKit

/// Routes the deck pushes onto the Sort stack.
enum DeckRoute: Hashable {
    case card(UUID)
}

struct DeckScreen: View {
    @State private var model: DeckViewModel
    @Environment(AppEnvironment.self) private var env
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage(DeckSettings.offerBulkFileKey) private var offerBulkFile = false

    // Drag and fly-off state.
    @State private var offset: CGSize = .zero
    @State private var crossed = false
    @State private var dragging = false
    @State private var ghost: Ghost?
    @State private var enterOpacity: Double = 1
    @State private var cardWidth: CGFloat = 350
    @State private var thumbnails: [UUID: CGImage] = [:]
    @State private var showBulkSheet = false
    @AccessibilityFocusState private var cardFocused: Bool

    private let haptic = UIImpactFeedbackGenerator(style: .light)

    init(model: DeckViewModel) {
        _model = State(initialValue: model)
    }

    /// The card that just left, drawn flying off while the next card rises.
    private struct Ghost {
        let item: PipelineItem
        let side: DeckSide
        var offset: CGSize
        var opacity: Double = 1
    }

    private var threshold: CGFloat { max(110, cardWidth * 0.3) }

    var body: some View {
        content
            .background(Palette.background)
            .navigationTitle("Sort")
            .navigationSubtitle(model.subtitle)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    ScanMenuButton()   // capture
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    AvatarButton()
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .navigationDestination(for: DeckRoute.self) { route in
                switch route {
                case .card(let id):
                    if let item = model.cards.first(where: { $0.id == id }) {
                        CardDetailScreen(model: model, item: item) { side in
                            router.pop()
                            Task {
                                try? await Task.sleep(for: .milliseconds(450))
                                decide(side, item, fromButton: true)
                            }
                        }
                    } else {
                        ContentUnavailableView("This card moved", systemImage: "rectangle.stack",
                                               description: Text("It was filed or shredded."))
                    }
                }
            }
            .sheet(item: Binding(get: { model.checking.map(CheckTarget.init) },
                                 set: { if $0 == nil { model.cancelCheck() } })) { target in
                // classify owns the sheet's content (spec 3.8); the deck files the card it returns.
                CheckFieldsSheet(model: CheckFieldsModel(item: target.item, docs: env.docs),
                                 startAt: model.checkFocus?.rawValue) { item in
                    Task { await confirmCheck(item) }
                }
            }
            .sheet(isPresented: $showBulkSheet) {
                BulkFileSheet(model: model, items: model.bulkCandidates) { chosen in
                    showBulkSheet = false
                    haptic.impactOccurred()
                    withAnimation(reduceMotion ? Motion.reducedFade : Motion.promote) {
                        _ = model.fileTogether(chosen)
                    }
                    announce(model.top == nil ? "All sorted." : "Filed \(chosen.count) cards.")
                }
            }
            .captureFlow { model.refresh() }  // capture: scanner, imports, review
            .task { await model.load() }
            .task { await autoDecideForChecks() }  // sample mode only: -PTAutoFile
            .task(id: model.cards.prefix(3).map(\.id)) { await loadThumbnails() }
            .onChange(of: router.tab) { _, tab in
                if tab != .sort { model.releaseHeld() }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { model.releaseHeld() }
            }
    }

    // MARK: - Layout

    @ViewBuilder private var content: some View {
        if model.cards.isEmpty && ghost == nil {
            VStack(spacing: 0) {
                reconnectBanner
                emptyState
            }
        } else {
            VStack(spacing: Space.xl) {
                reconnectBanner
                if let title = model.bulkPromptTitle(enabled: offerBulkFile) {
                    Button(title) { showBulkSheet = true }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                }
                deck
            }
            .padding(.top, Space.s)
            .padding(.bottom, Space.l)
        }
    }

    /// Spec 4.16: Sort shows the Reconnect Drive banner at the top. Swiping keeps working.
    @ViewBuilder private var reconnectBanner: some View {
        if model.driveNeedsReconnect {
            ReconnectDriveCard(isWorking: model.reconnecting, failed: model.reconnectFailed) {
                Task { await model.reconnectDrive() }
            }
            .padding(.horizontal, Space.xl)
        }
    }

    private var actionRow: some View {
        ActionRow(
            canDecide: model.top != nil,
            canFile: model.top.map { $0.card != nil && !model.isReadFailed($0) } ?? false,
            canUndo: model.canUndo,
            undoTitle: model.last?.items.first?.card?.title,
            shred: { if let top = model.top { decide(.shred, top, fromButton: true) } },
            undo: { Task { await undo() } },
            file: { if let top = model.top { decide(.file, top, fromButton: true) } })
    }

    /// The card hugs its content (A1) up to the room left above the action row, which sits 20 pt
    /// under the lowest peek (2.3). DeckStackLayout sizes every card in the stack to the top one.
    private var deck: some View {
        GeometryReader { geo in
            let peeks = typeSize >= .accessibility1 ? 1 : 3
            let peekDrop = peeks > 1 ? Metrics.peekOffsets[2] : 0
            let maxHeight = max(200, geo.size.height - peekDrop - Space.xl - Metrics.actionRowRoom)
            VStack(spacing: Space.xl) {
                DeckStackLayout(maxHeight: maxHeight) {
                    ForEach(Array(model.cards.prefix(peeks).enumerated()), id: \.element.id) { index, item in
                        cardView(item, index: index)
                            .scaleEffect(Metrics.peekScales[index], anchor: .bottom)
                            .offset(y: Metrics.peekOffsets[index])
                            .zIndex(Double(10 - index))
                            .transition(.identity)
                    }
                    if let ghost {
                        card(for: ghost.item, dragX: ghost.side == .file ? threshold : -threshold)
                            .modifier(CardMotion(offset: ghost.offset, width: cardWidth, reduceMotion: reduceMotion))
                            .opacity(ghost.opacity)
                            .zIndex(20)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, Metrics.cardSideMargin)
                .padding(.bottom, peekDrop)
                // On iOS 26 the dialog is a popover: anchor it to the card it asks about (4.14).
                .confirmationDialog("Shred a Keep original?",
                                    isPresented: Binding(get: { model.keepConfirm != nil },
                                                         set: { if !$0 { model.cancelKeepOriginalShred() } }),
                                    titleVisibility: .visible,
                                    presenting: model.keepConfirm) { item in
                    Button("Shred anyway", role: .destructive) { confirmKeepShred(item) }
                    Button("Cancel", role: .cancel) { model.cancelKeepOriginalShred() }
                } message: { item in
                    Text("Claude marked this one to keep the paper. \(item.card?.verdictReason ?? "")")
                }
                actionRow
                Spacer(minLength: 0)
            }
            .onAppear { cardWidth = geo.size.width - 2 * Metrics.cardSideMargin }
            .onChange(of: geo.size.width) { _, width in cardWidth = width - 2 * Metrics.cardSideMargin }
        }
    }

    @ViewBuilder private func cardView(_ item: PipelineItem, index: Int) -> some View {
        if index == 0 {
            card(for: item, dragX: offset.width)
                .cardShadow()
                .modifier(CardMotion(offset: offset, width: cardWidth, reduceMotion: reduceMotion))
                .opacity(enterOpacity)
                .gesture(dragGesture(item), isEnabled: !model.isReadFailed(item))
                .onTapGesture { router.push(DeckRoute.card(item.id)) }
                .contextMenu {
                    Button("File", systemImage: "checkmark") { decide(.file, item, fromButton: true) }
                        .disabled(item.card == nil || model.isReadFailed(item))
                    Button("Shred", systemImage: "xmark") { decide(.shred, item, fromButton: true) }
                    Button("Move to the back", systemImage: "arrow.down.to.line") { later(item) }
                    Button("Edit details", systemImage: "pencil") { router.push(DeckRoute.card(item.id)) }
                } preview: {
                    previewPage(item)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(model.accessibilityLabel(for: item))
                .accessibilityHint("Swipe up or down for actions.")
                .accessibilityAddTraits(.isButton)
                .accessibilityActions { accessibilityActions(item) }
                .accessibilityFocused($cardFocused)
                .accessibilityIdentifier("deck.card")
        } else {
            // Peeks are blank card edges (A1): only their bottom 22 and 36 pt show, and drawing
            // the next card's content there leaks its folder row and chips under the top card.
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .fill(Palette.surface)
                .cardShadow(peek: true)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func card(for item: PipelineItem, dragX: CGFloat) -> some View {
        DeckCardView(
            card: item.card,
            pageCount: item.pageCount,
            checks: model.checks(for: item),
            readFailed: model.isReadFailed(item),
            thumbnail: thumbnails[item.id],
            dragX: dragX,
            threshold: threshold,
            onCheck: { field in model.openCheck(item, at: field) },
            onTryAgain: { Task { await model.retryRead(item) } },
            onFillIn: { router.push(DeckRoute.card(item.id)) })
    }

    @ViewBuilder private func previewPage(_ item: PipelineItem) -> some View {
        if let image = thumbnails[item.id] {
            Image(decorative: image, scale: 1)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 320)
        } else {
            Text(item.card?.title ?? "Document").padding()
        }
    }

    @ViewBuilder private var emptyState: some View {
        if model.isLoading || model.readingCount > 0 {
            ContentUnavailableView {
                ProgressView()
                Text(model.readingCount == 1 ? "Reading 1 document" : "Reading \(max(model.readingCount, 1)) documents")
            } description: {
                Text("They show up here as soon as Claude is done.")
            }
        } else if !model.hasHistory {
            ContentUnavailableView {
                Label("Scan your first stack", systemImage: "doc.viewfinder")
            } description: {
                Text("Claude reads each document and gets it ready to file.")
            } actions: {
                // capture's shared Scan menu: Scan document, Import from Files, Import from Photos (#79).
                ScanMenu("Scan")
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("sort.scanFirst")
            }
        } else {
            ContentUnavailableView {
                Label("All sorted", systemImage: "checkmark.circle")
            } description: {
                Text(model.filedToday == 1 ? "1 filed today. The outbox is handling the uploads."
                     : model.filedToday > 1 ? "\(model.filedToday) filed today. The outbox is handling the uploads."
                     : "The outbox is handling the uploads.")
            } actions: {
                ScanMenu("Scan more")   // capture, #79: the same three choices as the toolbar's Scan
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("sort.scanMore")
            }
        }
    }

    // MARK: - Gestures and decisions

    private func dragGesture(_ item: PipelineItem) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if !dragging {
                    // At large text sizes the body scrolls: only claim horizontal-dominant drags.
                    guard abs(value.translation.width) > abs(value.translation.height) || typeSize < .accessibility1 else { return }
                    dragging = true
                    haptic.prepare()
                }
                withAnimation(Motion.dragFollow) {
                    offset = CGSize(width: value.translation.width, height: value.translation.height * 0.15)
                }
                let nowCrossed = abs(value.translation.width) >= threshold
                if nowCrossed && !crossed { haptic.impactOccurred() }
                crossed = nowCrossed
            }
            .onEnded { value in
                guard dragging else { return }
                dragging = false
                crossed = false
                let tx = value.translation.width
                let flick = value.predictedEndTranslation.width
                if tx >= threshold || flick >= 2 * threshold {
                    decide(.file, item, fromButton: false)
                } else if tx <= -threshold || flick <= -2 * threshold {
                    decide(.shred, item, fromButton: false)
                } else {
                    snapBack()
                }
            }
    }

    /// Every way to decide (swipe, buttons, menu, VoiceOver, card detail) ends here, and here only
    /// calls the view model.
    private func decide(_ side: DeckSide, _ item: PipelineItem, fromButton: Bool) {
        if fromButton { haptic.impactOccurred() }
        let start = offset
        let title = item.card?.title ?? "Document"
        var outcome = DeckOutcome.unavailable
        withAnimation(reduceMotion ? Motion.reducedFade : Motion.promote) {
            outcome = side == .file ? model.file(item) : model.shred(item)
        }
        guard outcome == .decided else {
            snapBack()
            return
        }
        flyOff(item, side: side, from: start)
        announce(model.announcement(after: side, title: title))
    }

    /// Simulator seam, sample mode only: `-PTSample -PTAutoFile` taps File, Shred and File again
    /// through the same path as the action row, then lets the undo hold release to the outbox, so
    /// a crash on File (#44) shows up without a tap.
    private func autoDecideForChecks() async {
        guard model.isSample, ProcessInfo.processInfo.arguments.contains("-PTAutoFile") else { return }
        try? await Task.sleep(for: .seconds(2))
        for side in [DeckSide.file, .shred, .file] {
            guard let top = model.top else { return }
            decide(side, top, fromButton: true)
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func flyOff(_ item: PipelineItem, side: DeckSide, from start: CGSize) {
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) {
            ghost = Ghost(item: item, side: side, offset: start)
            offset = .zero
            enterOpacity = 1
        }
        let target = CGSize(width: (side == .file ? 1.5 : -1.5) * cardWidth, height: start.height)
        if reduceMotion {
            withAnimation(Motion.reducedEase) { ghost?.opacity = 0 } completion: { ghost = nil }
        } else {
            withAnimation(Motion.flyOff) { ghost?.offset = target } completion: { ghost = nil }
        }
    }

    private func snapBack() {
        crossed = false
        withAnimation(reduceMotion ? Motion.reducedEase : Motion.snapBack) { offset = .zero }
    }

    private func later(_ item: PipelineItem) {
        withAnimation(reduceMotion ? Motion.reducedFade : Motion.promote) { model.later(item) }
        announce("Moved to the back. Next: \(model.top?.card?.title ?? "")")
    }

    private func undo() async {
        guard let side = await model.undo() else { return }
        var instant = Transaction()
        instant.disablesAnimations = true
        if reduceMotion {
            withTransaction(instant) { offset = .zero; enterOpacity = 0 }
            withAnimation(Motion.reducedFade) { enterOpacity = 1 }
        } else {
            withTransaction(instant) {
                offset = CGSize(width: (side == .file ? 1.5 : -1.5) * cardWidth, height: 0)
                enterOpacity = 1
            }
            withAnimation(Motion.undoReturn) { offset = .zero }
        }
        cardFocused = true
    }

    private func confirmKeepShred(_ item: PipelineItem) {
        let title = item.card?.title ?? "Document"
        var outcome = DeckOutcome.unavailable
        withAnimation(reduceMotion ? Motion.reducedFade : Motion.promote) {
            outcome = model.confirmKeepOriginalShred()
        }
        guard outcome == .decided else { return }
        flyOff(item, side: .shred, from: .zero)
        announce(model.announcement(after: .shred, title: title))
    }

    private func confirmCheck(_ item: PipelineItem) async {
        let title = item.card?.title ?? "Document"
        haptic.impactOccurred()
        let outcome = model.fileChecked(item)
        guard outcome == .decided else { return }
        flyOff(item, side: .file, from: .zero)
        announce(model.announcement(after: .file, title: title))
    }

    // MARK: - Accessibility (section 6)

    @ViewBuilder private func accessibilityActions(_ item: PipelineItem) -> some View {
        let unsureCount = model.unsureFields(item).count
        Button(unsureCount > 0 ? "Check \(unsureCount) \(unsureCount == 1 ? "field" : "fields") and file" : "File") {
            decide(.file, item, fromButton: true)
        }
        Button("Shred") { decide(.shred, item, fromButton: true) }
        Button("Move to the back") { later(item) }
        Button("Edit details") { router.push(DeckRoute.card(item.id)) }
        if model.canUndo {
            Button("Undo") { Task { await undo() } }
        }
    }

    private func announce(_ text: String) {
        guard UIAccessibility.isVoiceOverRunning else { return }
        AccessibilityNotification.Announcement(text).post()
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            cardFocused = true
        }
    }

    private func loadThumbnails() async {
        for item in model.cards.prefix(3) where thumbnails[item.id] == nil {
            if let image = await model.thumbnail(for: item) { thumbnails[item.id] = image }
        }
    }
}

/// Identifiable wrapper so the check-fields sheet can use `.sheet(item:)`.
private struct CheckTarget: Identifiable {
    let item: PipelineItem
    var id: UUID { item.id }
}

/// Stacks the deck's cards on top of each other, all the size of the first one (the top card):
/// its natural height for the width, capped at `maxHeight`. Peeks and the flying card match it.
private struct DeckStackLayout: Layout {
    var maxHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 350
        guard let first = subviews.first else { return CGSize(width: width, height: 0) }
        let ideal = first.sizeThatFits(ProposedViewSize(width: width, height: nil)).height
        return CGSize(width: width, height: min(ideal, maxHeight))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
        }
    }
}

/// Drag follow: translation, plus rotation clamped to 10 degrees around a point below the card
/// (A1's 50% 120%). Reduce Motion drops the rotation (2.7).
private struct CardMotion: ViewModifier {
    let offset: CGSize
    let width: CGFloat
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        let degrees = reduceMotion ? 0 : min(10, max(-10, offset.width / max(width, 1) * 10))
        content
            .rotationEffect(.degrees(degrees), anchor: UnitPoint(x: 0.5, y: 1.2))
            .offset(offset)
    }
}

// MARK: - Action row (3.3)

private struct ActionRow: View {
    let canDecide: Bool
    let canFile: Bool
    let canUndo: Bool
    let undoTitle: String?
    let shred: () -> Void
    let undo: () -> Void
    let file: () -> Void

    var body: some View {
        GlassEffectContainer {
            ViewThatFits(in: .horizontal) {
                row(labels: true)
                row(labels: false)
            }
        }
        .padding(.horizontal, Metrics.cardSideMargin)
    }

    private func row(labels: Bool) -> some View {
        HStack {
            Button(action: shred) {
                actionLabel("Shred", symbol: "xmark", color: Palette.danger, showsTitle: labels)
            }
            .buttonStyle(.glass)
            .disabled(!canDecide)
            .accessibilityLabel("Shred")
            .accessibilityInputLabels(["Shred"])
            .accessibilityIdentifier("deck.shred")

            Spacer(minLength: Space.m)

            Button(action: undo) {
                Image(systemName: "arrow.uturn.backward")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .frame(width: Metrics.undoDiameter - 16, height: Metrics.undoDiameter - 16)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .disabled(!canUndo)
            .accessibilityLabel(canUndo ? "Undo last swipe" : "Undo, nothing to undo")
            .accessibilityValue(canUndo ? (undoTitle ?? "") : "")
            .accessibilityInputLabels(["Undo"])
            .accessibilityIdentifier("deck.undo")

            Spacer(minLength: Space.m)

            Button(action: file) {
                actionLabel("File", symbol: "checkmark", color: Color(.file), showsTitle: labels)
            }
            .buttonStyle(.glass)
            .disabled(!canFile)
            .accessibilityLabel("File")
            .accessibilityInputLabels(["File"])
            .accessibilityIdentifier("deck.file")
        }
    }

    private func actionLabel(_ title: String, symbol: String, color: Color, showsTitle: Bool) -> some View {
        Group {
            if showsTitle {
                Label(title, systemImage: symbol)
            } else {
                Image(systemName: symbol)
            }
        }
        .font(.headline)
        .foregroundStyle(color)
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, Space.m)
        .frame(minHeight: Metrics.actionHeight - 16)
    }
}
