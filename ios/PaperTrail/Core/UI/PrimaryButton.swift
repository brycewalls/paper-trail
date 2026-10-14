// Owner: deck (shared Core/UI). docs/design-spec.md section 3.8, item 5 (#65).
//
// The one primary button: full width, AccentFill, white `.headline`, capsule, 52 tall. Sign-in's
// Connect Google Drive, the review's Send to the deck, Confirm and file, File the confident cards,
// and the sender detail's I requested it / It's confirmed all draw this. Nobody re-implements it.
import SwiftUI

struct PrimaryButton: View {
    let title: String
    /// Shows a white spinner in place of the title and ignores taps, at full color.
    var isWorking = false
    let action: () -> Void

    /// `.disabled(true)` from the caller draws the fill at 40 percent.
    @Environment(\.isEnabled) private var isEnabled

    init(_ title: String, isWorking: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isWorking = isWorking
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                if isWorking { ProgressView().tint(.white) } else { Text(title).font(.headline) }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: Self.height)
            .background(Color(.accentFill).opacity(isEnabled || isWorking ? 1 : Self.disabledOpacity), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .disabled(isWorking)
        .accessibilityLabel(Text(title))
    }

    static let height: CGFloat = 52
    static let disabledOpacity = 0.4
}

#Preview {
    VStack(spacing: Space.l) {
        PrimaryButton("Send 3 to the deck") {}
        PrimaryButton("File 0") {}.disabled(true)
        PrimaryButton("Connect Google Drive", isWorking: true) {}
    }
    .padding(Space.xl)
}
