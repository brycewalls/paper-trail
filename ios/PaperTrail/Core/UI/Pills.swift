// Owner: deck (shared Core/UI). docs/design-spec.md sections 3.5 and 3.6.
//
// Chips and pills. Every screen uses these; nobody re-implements a pill. Verdicts are not here:
// they are drawn only by VerdictBadge.
import SwiftUI

/// The capsule every pill shares: `.caption.weight(.semibold)`, padding 4 / 10.
private struct PillShape<Label: View>: View {
    let ink: Color
    let fill: Color
    @ViewBuilder let label: Label

    var body: some View {
        label
            .font(.caption.weight(.semibold))
            .foregroundStyle(ink)
            .lineLimit(1)
            .padding(.vertical, Space.xs)
            .padding(.horizontal, 10)
            .background(fill, in: Capsule())
    }
}

struct SensitiveChip: View {
    var body: some View {
        PillShape(ink: Color(.unsure), fill: Color(.unsureSoft)) {
            HStack(spacing: Space.xs) {
                Image(systemName: "lock.fill").imageScale(.small).accessibilityHidden(true)
                Text("Sensitive")
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sensitive")
    }
}

struct RetentionChip: View {
    let retention: String

    var body: some View {
        PillShape(ink: .secondary, fill: Color(.cardWell)) {
            Text(retention).truncationMode(.tail)
        }
        .accessibilityLabel(retention)
    }
}

struct UnsurePill: View {
    let count: Int

    var body: some View {
        PillShape(ink: Color(.unsure), fill: Color(.unsureSoft)) {
            Text("\(count) to check")
        }
    }
}

/// Search filters (3.5). 34 tall visually, padded to a 44 pt tap target.
struct FilterChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(isOn ? Color(.accent) : .primary)
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .background(isOn ? Color(.accentSoft) : Palette.surface, in: Capsule())
                .overlay {
                    if !isOn { Capsule().strokeBorder(Palette.separator) }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Single-select chip, e.g. a date choice in the check-fields sheet. Same look as FilterChip.
struct ChoiceChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        FilterChip(title: title, isOn: isSelected, action: action)
    }
}

/// One status pill for Piles and Paperless (3.6).
struct StatusPill: View {
    enum Kind: Hashable {
        case safe
        /// Hold time left, in whole days. 0 reads "Today".
        case waiting(daysLeft: Int)
        /// While the Drive check runs.
        case checking
        case paperless(PaperlessStatus)
    }

    let kind: Kind

    var body: some View {
        PillShape(ink: ink, fill: fill) {
            HStack(spacing: Space.xs) {
                if showsClock {
                    Image(systemName: "clock").imageScale(.small).accessibilityHidden(true)
                }
                Text(text)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }

    var text: String { Self.text(for: kind) }

    static func text(for kind: Kind) -> String {
        switch kind {
        case .safe: "Safe"
        case .waiting(let days): days <= 0 ? "Today" : days == 1 ? "1 day" : "\(days) days"
        case .checking: "Checking"
        case .paperless(let status): status.label
        }
    }

    private var showsClock: Bool {
        switch kind {
        case .waiting, .checking: true
        default: false
        }
    }

    private var ink: Color {
        switch kind {
        case .safe, .paperless(.confirmed): Color(.file)
        case .paperless(.requested): Color(.unsure)
        case .paperless(.waitingCycle): Color(.accent)
        default: .secondary
        }
    }

    private var fill: Color {
        switch kind {
        case .safe, .paperless(.confirmed): Color(.fileSoft)
        case .paperless(.requested): Color(.unsureSoft)
        case .paperless(.waitingCycle): Color(.accentSoft)
        default: Color(.cardWell)
        }
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 8) {
        HStack { SensitiveChip(); RetentionChip(retention: "Keep 7 years"); UnsurePill(count: 2) }
        HStack { StatusPill(kind: .safe); StatusPill(kind: .waiting(daysLeft: 2)); StatusPill(kind: .paperless(.requested)) }
        HStack { FilterChip(title: "2023", isOn: true) {}; FilterChip(title: "Sensitive", isOn: false) {} }
    }
    .padding()
}
