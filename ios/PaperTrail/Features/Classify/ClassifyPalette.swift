// Owner: classify. INTERIM: the design spec's tokens (section 2.1) for the classify screens until
// deck's shared Core/UI lands (asset catalog color sets and ChoiceChip). Then this file goes and the
// screens switch to Color(.accentColor), Color(.unsure) and the shared ChoiceChip. Hex values are
// the spec's light / dark pairs. Kept private to the classify feature so nothing else builds on it.
import SwiftUI
import UIKit

enum ClassifyPalette {
    static let accent = pair(0x2346B8, 0x8EA7FF)       // AccentColor
    static let accentFill = pair(0x2346B8, 0x3D5FD6)   // AccentFill, white label
    static let accentSoft = pair(0xE8EDFB, 0x1B2547)   // AccentSoft
    static let unsure = pair(0xA15C00, 0xF2C05A)       // Unsure
    static let unsureSoft = pair(0xFFF3D6, 0x33280F)   // UnsureSoft
    static let surface = Color(.secondarySystemGroupedBackground)
    static let background = Color(.systemGroupedBackground)

    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                           blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        })
    }
}

/// Design spec 3.5 ChoiceChip, until the shared one exists: 34 tall, `.subheadline.weight(.medium)`,
/// off is surface with a separator stroke, on is AccentColor on AccentSoft. Padded to a 44 pt target.
struct ClassifyChoiceChip: View {
    let title: String
    var systemImage: String? = nil
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let systemImage { Image(systemName: systemImage).imageScale(.small) }
                Text(title)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(isOn ? ClassifyPalette.accent : Color.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 34)
            .background(isOn ? ClassifyPalette.accentSoft : ClassifyPalette.surface, in: .capsule)
            .overlay { if !isOn { Capsule().strokeBorder(Color(.separator)) } }
            .padding(.vertical, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Wraps chips onto as many lines as they need.
struct ClassifyFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].indices.isEmpty && rows[rows.count - 1].width + spacing + size.width > width {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
