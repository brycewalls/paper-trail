// Owner: deck (shared Core/UI, built first per docs/design-spec.md section 7).
//
// Design tokens from docs/design-spec.md section 2 (Direction A, "Glass"). Replaces the old
// placeholder Theme.swift.
//
// Colors: brand and status colors are asset catalog color sets with Any and Dark appearances
// (Resources/Assets.xcassets), used through Xcode's generated symbols, e.g. `Color(.shred)` or
// `.foregroundStyle(.file)`. Neutrals come from the system so they track Increase Contrast.
// Color sets: AccentColor, AccentFill, AccentSoft, CardWell, Shred, ShredSoft, Keep, KeepSoft,
// File, FileSoft, FileFill, Unsure, UnsureSoft. "Danger" is the Shred pair (2.1), see `Palette.danger`.
import SwiftUI

enum Palette {
    /// #F2F2F7 / #000000
    static let background = Color(uiColor: .systemGroupedBackground)
    /// Card and rows. #FFFFFF / #1C1C1E
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let separator = Color(uiColor: .separator)
    /// Shred button and overlay, failed uploads, Drive disconnected. Same pair as Shred.
    static let danger = Color(.shred)
    static let dangerSoft = Color(.shredSoft)
}

/// Spacing scale (2.3). Base 4; use these values only.
nonisolated enum Space {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let xxxl: CGFloat = 32
}

/// Corner radii (2.4). Always with `style: .continuous`.
nonisolated enum Radius {
    static let card: CGFloat = 30
    static let unsureRow: CGFloat = 10
    static let thumbnail: CGFloat = 6
}

/// Fixed sizes from the spec (2.3, 3.1, 3.3).
nonisolated enum Metrics {
    static let cardSideMargin: CGFloat = 20
    static let scanWell: CGFloat = 236
    static let scanWellUnsure: CGFloat = 96
    static let scanWellLargeType: CGFloat = 120
    static let actionHeight: CGFloat = 54
    static let undoDiameter: CGFloat = 48
    /// Height the deck keeps free for the action row under the card.
    static let actionRowRoom: CGFloat = 64
    static let peekOffsets: [CGFloat] = [0, 22, 36]
    static let peekScales: [CGFloat] = [1, 0.96, 0.92]
    static let avatar: CGFloat = 36
    static let thumbnailSize = CGSize(width: 36, height: 46)
}

/// Card and peek shadows (2.5). Neutral black only, never tinted.
struct CardShadow: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    var isPeek = false

    func body(content: Content) -> some View {
        let dark = scheme == .dark
        if isPeek {
            content.shadow(color: .black.opacity(dark ? 0.40 : 0.06), radius: 9, y: 6)
        } else {
            content.shadow(color: .black.opacity(dark ? 0.60 : 0.10), radius: 17, y: 14)
        }
    }
}

extension View {
    func cardShadow(peek: Bool = false) -> some View { modifier(CardShadow(isPeek: peek)) }
}

/// Motion tokens (2.7). Each has a Reduce Motion counterpart.
enum Motion {
    static let dragFollow = Animation.interactiveSpring(response: 0.15, dampingFraction: 0.86)
    static let overlayPop = Animation.spring(duration: 0.2, bounce: 0.4)
    static let snapBack = Animation.spring(duration: 0.4, bounce: 0.3)
    static let flyOff = Animation.spring(duration: 0.32, bounce: 0)
    static let promote = Animation.spring(duration: 0.35, bounce: 0.15)
    static let undoReturn = Animation.spring(duration: 0.45, bounce: 0.2)
    /// Reduce Motion: snap-back, fly-off (as a fade) and undo (as a fade in).
    static let reducedEase = Animation.easeOut(duration: 0.2)
    static let reducedFade = Animation.easeInOut(duration: 0.2)
}
