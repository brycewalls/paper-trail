// Owner: deck (shared Core/UI). docs/design-spec.md section 3.4.
//
// THE ONLY PLACE A VERDICT IS DRAWN. Never build a verdict pill, color or label anywhere else.
// A rubber-stamp version later replaces this file's `body` (plus its assets) and nothing else
// changes, so callers must never set a fixed width or height on it.
import SwiftUI

struct VerdictBadge: View {
    enum Size { case regular, large }

    let verdict: Verdict
    var size: Size = .regular

    var body: some View {
        Text(verdict.stamp)
            .font(size == .large ? .subheadline.weight(.semibold) : .caption.weight(.semibold))
            .foregroundStyle(ink)
            .lineLimit(1)
            .padding(.vertical, size == .large ? 6 : 4)
            .padding(.horizontal, size == .large ? 12 : 10)
            .background(fill, in: Capsule())
            .fixedSize()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Verdict: \(verdict.stamp)")
    }

    private var ink: Color {
        switch verdict {
        case .shred: Color(.shred)
        case .scanShred: Color(.accent)
        case .keepOriginal: Color(.keep)
        }
    }

    private var fill: Color {
        switch verdict {
        case .shred: Color(.shredSoft)
        case .scanShred: Color(.accentSoft)
        case .keepOriginal: Color(.keepSoft)
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        ForEach(Verdict.allCases, id: \.self) { VerdictBadge(verdict: $0) }
        VerdictBadge(verdict: .keepOriginal, size: .large)
    }
    .padding()
}
