// PLACEHOLDER TOKENS. The UI design is not decided yet: Bryce is choosing a direction and a design
// spec (docs/design-spec.md) will follow. These are the web app's colors (public/index.html,
// :root and the dark theme) so the stand-in screens are readable. Do not build on them; once the
// spec lands this file is replaced wholesale and every view is rebuilt to the spec.
// Owner: scaffold until the design spec, then whoever implements it.
import SwiftUI
import UIKit

enum Theme {
    static let background = dynamic(0xeef1f4, 0x0f141a)
    static let surface = dynamic(0xffffff, 0x172029)
    static let ink = dynamic(0x16202b, 0xe6ebf0)
    static let muted = dynamic(0x5a6673, 0x98a4b1)
    static let line = dynamic(0xd8dee5, 0x2a3541)
    static let accent = dynamic(0x2346b8, 0x7d9bff)
    static let shred = dynamic(0xb42318, 0xff8a7f)
    static let scan = dynamic(0x2346b8, 0x8fa8ff)
    static let keep = dynamic(0x8a5a00, 0xf2c05a)
    static let green = dynamic(0x1a7f4b, 0x5fd393)

    static func color(for verdict: Verdict) -> Color {
        switch verdict {
        case .shred: shred
        case .scanShred: scan
        case .keepOriginal: keep
        }
    }

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255,
                           green: CGFloat((hex >> 8) & 0xff) / 255,
                           blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        })
    }
}
