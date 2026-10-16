// Owner: deck. The deck card (docs/design-spec.md 3.1) and its swipe overlays (3.2). Layout only:
// DeckScreen owns the gestures and calls DeckViewModel.
import SwiftUI

struct DeckCardView: View {
    let card: DocumentCard?
    let pageCount: Int
    /// Unsure fields with Claude's guesses, in the spec's order. Empty on a confident card.
    let checks: [FieldCheck]
    let readFailed: Bool
    let thumbnail: CGImage?
    /// Live horizontal drag, for the overlays. Positive is toward File.
    var dragX: CGFloat = 0
    /// Live vertical drag while skipping (#77). Negative is up, toward Skip.
    var dragY: CGFloat = 0
    var threshold: CGFloat = 110
    var onCheck: (CardField) -> Void = { _ in }
    var onTryAgain: () -> Void = {}
    var onFillIn: () -> Void = {}

    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var largeType: Bool { typeSize >= .accessibility1 }
    private var unsure: Set<CardField> { Set(checks.map(\.field)) }

    private var wellHeight: CGFloat {
        if largeType { return Metrics.scanWellLargeType }
        if !checks.isEmpty && !readFailed { return Metrics.scanWellUnsure }
        return Metrics.scanWell
    }

    var body: some View {
        VStack(spacing: 0) {
            scanWell
            if largeType {
                ScrollView { cardBody }.scrollBounceBehavior(.basedOnSize)
            } else {
                // The body always shows in full; the well gives up height instead (#52).
                cardBody
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
            }
        }
        // minHeight 0: a peek takes the top card's size even when its own content is taller,
        // and the clip below trims the rest.
        .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    // MARK: Scan well

    private var showsUnsurePill: Bool { !checks.isEmpty && !readFailed }

    /// The "2 to check" pill and the verdict, as separate views so FlowLayout can wrap them.
    @ViewBuilder private var badgeItems: some View {
        if showsUnsurePill { UnsurePill(count: checks.count) }
        if let card, !readFailed { VerdictBadge(verdict: card.verdict) }
    }

    private var badges: some View {
        HStack(spacing: Space.s) { badgeItems }
    }

    private var scanWell: some View {
        ZStack {
            Color(.cardWell)
            if showsUnsurePill && !largeType {
                // The short well (A2) has no room above the page for the pills, so the page
                // centers in the space they leave instead of sitting under them.
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    page
                    Spacer(minLength: 0)
                    badges.hidden().padding(.trailing, Space.m)
                }
            } else {
                page
            }
        }
        // The spec height (236, or 96 with unsure fields) when the deck has room. When something
        // sits above the deck, such as the Reconnect Drive banner (4.16), the well shrinks toward
        // the unsure height so the body below never gets cut off (#52).
        .frame(minHeight: largeType ? wellHeight : min(wellHeight, Metrics.scanWellUnsure),
               idealHeight: wellHeight, maxHeight: wellHeight)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topTrailing) {
            // At accessibility sizes the pills and page count move into the scrolling body:
            // the 120 pt well can't hold them next to the page without overlapping.
            if !largeType { badges.padding(Space.m) }
        }
        .overlay(alignment: .bottomLeading) {
            if !largeType {
                Text(DeckFormat.pages(pageCount))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(Space.m)
            }
        }
        .overlay(alignment: .topLeading) {
            SwipeOverlay(side: .file, isKeepOriginal: false, progress: dragX / threshold)
                .padding(Space.m)
        }
        .overlay(alignment: .topTrailing) {
            SwipeOverlay(side: .shred, isKeepOriginal: card?.verdict == .keepOriginal, progress: -dragX / threshold)
                .padding(Space.m)
        }
        .overlay(alignment: .top) {
            SwipeOverlay(side: .skip, isKeepOriginal: false, progress: -dragY / threshold)
                .padding(Space.m)
        }
    }

    @ViewBuilder private var page: some View {
        let maxHeight = wellHeight - 40
        if let thumbnail {
            Image(decorative: thumbnail, scale: 1)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxHeight: min(196, maxHeight))
                .overlay(Rectangle().strokeBorder(Palette.separator, lineWidth: 0.5))
                .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                // 20 above and below, so a well that shrinks (#52) still frames the page.
                .padding(.vertical, 20)
        } else {
            Image(systemName: "doc.text")
                .font(.system(size: min(48, maxHeight * 0.5)))
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: Body

    @ViewBuilder private var cardBody: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            if largeType {
                FlowLayout(spacing: Space.s) { badgeItems }
                Text(DeckFormat.pages(pageCount)).font(.caption).foregroundStyle(.secondary)
            }
            if readFailed || card == nil {
                failedBody
            } else if let card {
                details(card)
            }
        }
        .padding(.vertical, Space.l)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var failedBody: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text("Couldn't read this one").font(.title2.bold())
            Text("Claude didn't answer. Your scan is saved.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(spacing: Space.m) {
                Button("Try again", action: onTryAgain).buttonStyle(.bordered)
                Button("Fill it in yourself", action: onFillIn).buttonStyle(.bordered)
            }
            .padding(.top, Space.s)
        }
    }

    @ViewBuilder private func details(_ card: DocumentCard) -> some View {
        if unsure.contains(.title) {
            unsureRow(.title, card)
        } else {
            Text(card.title).font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
        }

        // Meta line, or Not sure rows for the sender and date (drawn in that order).
        if unsure.contains(.issuer) || unsure.contains(.docDate) {
            ForEach([CardField.issuer, .docDate], id: \.self) { field in
                if unsure.contains(field) {
                    unsureRow(field, card)
                } else {
                    Text(field == .issuer ? card.issuer : DeckFormat.display(.docDate, card.docDate))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Text(DeckFormat.meta(card)).font(.subheadline).foregroundStyle(.secondary)
        }

        if unsure.contains(.folder) {
            unsureRow(.folder, card)
        } else {
            Label {
                Text(DeckFormat.folderPath(card))
            } icon: {
                Image(systemName: "folder").foregroundStyle(.secondary)
            }
            .font(.subheadline)
        }

        if card.sensitive || !card.retention.isEmpty {
            FlowLayout(spacing: Space.s) {
                if card.sensitive { SensitiveChip() }
                if !card.retention.isEmpty { RetentionChip(retention: card.retention) }
            }
        }

        if unsure.contains(.filename) {
            unsureRow(.filename, card)
        } else {
            Text(card.filename + ".pdf")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }

        if unsure.contains(.verdict) { unsureRow(.verdict, card) }
    }

    private func unsureRow(_ field: CardField, _ card: DocumentCard) -> some View {
        Button { onCheck(field) } label: {
            HStack(spacing: Space.s) {
                Text(DeckFormat.display(field, card.value(of: field)))
                    .font(field == .title ? .title3.bold() : field == .filename ? .caption.monospaced() : .subheadline)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: Space.s)
                Text("Not sure")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(.unsure))
            }
            .padding(.vertical, Space.s)
            .padding(.horizontal, Space.m)
            .background(Color(.unsureSoft), in: RoundedRectangle(cornerRadius: Radius.unsureRow, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The glass "File" / "Shred" / "Skip" label that fades in while dragging (3.2). Hidden from VoiceOver.
struct SwipeOverlay: View {
    let side: DeckSide
    let isKeepOriginal: Bool
    /// Drag distance over the commit threshold, signed toward this side.
    let progress: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var crossed: Bool { progress >= 1 }

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.headline.bold())
            .foregroundStyle(color)
            .padding(.horizontal, Space.m)
            .padding(.vertical, 6)
            .glassEffect(.regular, in: .capsule)
            .opacity(Double(min(1, max(0, progress))))
            .scaleEffect(reduceMotion ? 1 : (crossed ? 1 : 0.9))
            .animation(reduceMotion ? nil : Motion.overlayPop, value: crossed)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    private var title: String {
        switch side {
        case .file: "File"
        case .shred: isKeepOriginal ? "Shred? Asks first" : "Shred"
        case .skip: "Skip"
        }
    }

    private var symbol: String {
        switch side {
        case .file: "checkmark"
        case .shred: "xmark"
        case .skip: "arrow.up.forward"
        }
    }

    private var color: Color {
        switch side {
        case .file: Color(.file)
        case .shred: Palette.danger
        case .skip: Color(.accent)
        }
    }
}
