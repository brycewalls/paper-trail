// Owner: outbox. STAND-IN added by deck with the tab shell so the Outbox stays reachable once it
// stopped being a tab (docs/design-spec.md 3.7). Covers the basic states from SwiftData; the
// outbox agent replaces the body (byte progress, offline, haptics) and keeps the name and init.
import SwiftUI
import SwiftData

struct OutboxAccessory: View {
    let open: () -> Void

    @Environment(AppEnvironment.self) private var env
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    @Query private var items: [PipelineItem]

    init(open: @escaping () -> Void) {
        self.open = open
    }

    private var decided: [PipelineItem] { items.filter { $0.decision == .file || $0.decision == .shredOnly } }
    private var inFlight: [PipelineItem] { decided.filter { $0.stage == .queued || $0.stage == .uploading } }
    private var needsRetry: Int { decided.filter { $0.stage == .failed }.count }
    private var filedToday: Int {
        decided.filter { ($0.stage == .filed || $0.stage == .verified) && Calendar.current.isDateInToday($0.decidedAt ?? .distantPast) }.count
    }

    private enum Status { case reconnect, attention(Int), uploading(done: Int, total: Int), caughtUp(Int), empty }

    private var status: Status {
        if env.auth.drive == .needsReconnect { return .reconnect }
        if needsRetry > 0 { return .attention(needsRetry) }
        if !inFlight.isEmpty {
            let batch = inFlight.count + filedToday
            return .uploading(done: min(batch, filedToday + 1), total: batch)
        }
        return filedToday > 0 ? .caughtUp(filedToday) : .empty
    }

    var body: some View {
        Button(action: open) {
            HStack(spacing: Space.m) {
                glyph.frame(width: 30, height: 30)
                if placement == .inline {
                    if let short { Text(short).font(.subheadline.weight(.semibold)).contentTransition(.numericText()) }
                } else {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .contentTransition(.numericText())
                        .lineLimit(2)
                    Spacer(minLength: Space.s)
                    Text("Outbox").font(.footnote).foregroundStyle(.secondary)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, Space.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Outbox")
        .accessibilityValue(title)
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var glyph: some View {
        switch status {
        case .reconnect: Image(systemName: "exclamationmark.icloud.fill").foregroundStyle(Palette.danger)
        case .attention: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(.unsure))
        case .uploading(let done, let total): ProgressRing(value: Double(done - 1) / Double(max(1, total)))
        case .caughtUp: Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(.file)).font(.title3)
        case .empty: Image(systemName: "tray").foregroundStyle(.secondary)
        }
    }

    private var title: String {
        switch status {
        case .reconnect: "Reconnect Drive to keep filing"
        case .attention(let n): n == 1 ? "1 needs a retry" : "\(n) need a retry"
        case .uploading(let done, let total): "Uploading \(done) of \(total)"
        case .caughtUp(let n): "All caught up · \(n) filed today"
        case .empty: "Outbox is empty"
        }
    }

    private var short: String? {
        switch status {
        case .reconnect, .empty: nil
        case .attention(let n): "\(n)"
        case .uploading(let done, let total): "\(done) of \(total)"
        case .caughtUp(let n): "\(n)"
        }
    }
}
