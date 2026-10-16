// Owner: auth. Small views the auth screens share: the Google button and the account avatar (the
// primary button is Core/UI PrimaryButton). Colors come from Core/UI (spec 2.1).
import SwiftUI
import UIKit

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

/// Initials on AccentSoft in AccentColor (spec 4.2 and 4.9).
struct AccountAvatar: View {
    let initials: String
    var size: CGFloat = 48

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(Color(.accent))
            .frame(width: size, height: size)
            .background(Circle().fill(Color(.accentSoft)))
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
                RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color(.accentSoft))
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
