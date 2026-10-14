// Owner: auth. Small views the auth screens share: the spec's colors this feature needs, the Google
// button, the avatar and the status dot.
//
// AuthPalette holds design spec 2.1's values for the colors auth uses. The shared asset catalog
// color sets (Core/UI, built first by deck) aren't on `ios` yet; once they land, each of these
// becomes `Color(.danger)` and so on, and this enum goes away.
import SwiftUI
import UIKit

enum AuthPalette {
    static let accent = pair(0x2346B8, 0x8EA7FF)       // AccentColor
    static let accentFill = pair(0x2346B8, 0x3D5FD6)   // AccentFill
    static let accentSoft = pair(0xE8EDFB, 0x1B2547)   // AccentSoft
    static let file = pair(0x17773F, 0x5FD393)         // File
    static let danger = pair(0xC4271B, 0xFF8A7F)       // Danger (same as Shred)
    static let dangerSoft = pair(0xFDECEA, 0x3A1A18)   // ShredSoft
    static let background = Color(.systemGroupedBackground)

    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                           blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        })
    }
}

/// Google's standard "Sign in with Google" button: white with a gray stroke in light mode, near
/// black in dark mode, the four-color G, pill shaped (Google's branding guidelines).
struct GoogleSignInButton: View {
    var title: LocalizedStringKey = "Sign in with Google"
    var isWorking = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if isWorking {
                    ProgressView()
                } else {
                    Image("GoogleG")
                        .resizable()
                        .frame(width: 20, height: 20)
                        .accessibilityHidden(true)
                    Text(title)
                        .font(.body.weight(.medium))
                }
            }
            .foregroundStyle(scheme == .dark ? Color(white: 0.89) : Color(white: 0.12))
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Capsule().fill(scheme == .dark ? Color(red: 0.075, green: 0.075, blue: 0.078) : .white))
            .overlay(Capsule().strokeBorder(scheme == .dark ? Color(red: 0.557, green: 0.569, blue: 0.561) : Color(red: 0.455, green: 0.467, blue: 0.459), lineWidth: 1))
            .contentShape(Capsule())
            .opacity(isEnabled || isWorking ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isWorking ? Text("Signing in") : Text(title))
    }
}

/// The spec's primary button (3.8): full width, AccentFill, white headline, capsule, 52 tall.
struct AuthPrimaryButton: View {
    let title: LocalizedStringKey
    var isWorking = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isWorking { ProgressView().tint(.white) } else { Text(title).font(.headline) }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Capsule().fill(AuthPalette.accentFill))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Initials on AccentSoft in AccentColor (spec 4.2 and 4.9).
struct AccountAvatar: View {
    let initials: String
    var size: CGFloat = 48

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(AuthPalette.accent)
            .frame(width: size, height: size)
            .background(Circle().fill(AuthPalette.accentSoft))
            .accessibilityHidden(true)
    }
}

/// The app icon as an image, for the sign-in screen.
struct AppIconImage: View {
    var size: CGFloat = 96

    var body: some View {
        Group {
            if let icon = Self.icon {
                Image(uiImage: icon).resizable().interpolation(.high)
            } else {
                RoundedRectangle(cornerRadius: 22, style: .continuous).fill(AuthPalette.accentSoft)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityHidden(true)
    }

    private static let icon: UIImage? = {
        if let image = UIImage(named: "AppIcon") { return image }
        let icons = Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any]
        let primary = icons?["CFBundlePrimaryIcon"] as? [String: Any]
        let files = primary?["CFBundleIconFiles"] as? [String]
        return files?.last.flatMap { UIImage(named: $0) }
    }()
}
