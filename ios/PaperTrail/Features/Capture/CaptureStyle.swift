// Owner: capture. TEMPORARY: the spec's tokens (design-spec.md 2.1) that capture's screens use,
// until deck's shared Core/UI asset catalog color sets land (spec section 7, "built first by
// deck"). Same names and hex values as the spec; once `Color(.accentFill)` and friends exist,
// replace every `CaptureStyle.x` with the asset color and delete this file.
import SwiftUI
import UIKit

enum CaptureStyle {
    /// AccentColor: tint, Scan more.
    static let accent = pair(0x2346B8, 0x8EA7FF)
    /// AccentFill: the solid primary button.
    static let accentFill = pair(0x2346B8, 0x3D5FD6)
    /// AccentSoft: the selected chip.
    static let accentSoft = pair(0xE8EDFB, 0x1B2547)
    /// File / FileSoft: the "Read" pill.
    static let file = pair(0x17773F, 0x5FD393)
    static let fileSoft = pair(0xE3F4EA, 0x15301F)
    /// Unsure / UnsureSoft: the duplicate line.
    static let unsure = pair(0xA15C00, 0xF2C05A)
    static let unsureSoft = pair(0xFFF3D6, 0x33280F)
    /// CardWell: thumbnails and gray pills.
    static let cardWell = pair(0xECEEF2, 0x2A2A2E)
    static let background = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)

    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
}
