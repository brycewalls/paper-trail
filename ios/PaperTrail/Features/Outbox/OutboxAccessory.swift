// Owner: outbox. Spec 3.7: the tab bar accessory above the Liquid Glass tab bar, like the Music
// mini player. RootView (deck) hosts it in `.tabViewBottomAccessory` and passes `open`, which
// pushes OutboxScreen onto the current tab.
import SwiftData
import SwiftUI

struct OutboxAccessory: View {
    var open: () -> Void

    @Environment(AppEnvironment.self) private var env
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    @Query private var items: [PipelineItem]

    init(open: @escaping () -> Void) {
        self.open = open
        let file = PipelineDecision.file.rawValue
        let shred = PipelineDecision.shredOnly.rawValue
        _items = Query(filter: #Predicate<PipelineItem> { $0.decisionRaw == file || $0.decisionRaw == shred })
    }

    private var state: AccessoryState {
        OutboxSummary.accessory(items.map(OutboxEntry.init), status: env.outbox.status,
                                driveNeedsReconnect: env.auth.drive == .needsReconnect)
    }

    var body: some View {
        let state = state
        Button(action: open) {
            if placement == .inline {
                inline(state)
            } else {
                expanded(state)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Outbox")
        .accessibilityValue(state.title)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("outbox.accessory")
        .sensoryFeedback(.success, trigger: env.outbox.status.batchesVerified)
        .sensoryFeedback(.warning, trigger: env.outbox.status.itemsNeedingAttention)
        // Spec 2.6: Drive needing a reconnect counts as needing attention too, once.
        .sensoryFeedback(.warning, trigger: env.outbox.status.needsReconnect) { _, now in now }
    }

    private func expanded(_ state: AccessoryState) -> some View {
        HStack(spacing: 12) {
            glyph(state)
            Text(state.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .contentTransition(.numericText())
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 8)
            Text("Outbox")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .animation(.smooth, value: state)
    }

    private func inline(_ state: AccessoryState) -> some View {
        HStack(spacing: 8) {
            glyph(state)
            if let text = state.inlineText {
                Text(text)
                    .font(.subheadline.weight(.semibold))
                    .contentTransition(.numericText())
            }
        }
        .padding(.horizontal, 12)
        .contentShape(.rect)
    }

    @ViewBuilder
    private func glyph(_ state: AccessoryState) -> some View {
        Group {
            switch state {
            case .caughtUp:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(.file))
            case .empty:
                Image(systemName: "tray").foregroundStyle(.secondary)
            case .uploading(_, _, let fraction):
                ProgressRing(value: fraction)
            case .offline:
                Image(systemName: "wifi.slash").foregroundStyle(.secondary)
            case .needsRetry:
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(.unsure))
            case .reconnect:
                Image(systemName: "exclamationmark.icloud.fill").foregroundStyle(Palette.danger)
            }
        }
        .font(.title3)
        .frame(width: 30, height: 30)
    }
}
