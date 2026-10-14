// Owner: auth (the scaffold only configures the SDK).
//
// Configures Firebase from GoogleService-Info.plist. Nothing in the app reads the bundle ID: the
// plist's BUNDLE_ID may not match after SideStore re-signs the app, and Firebase only logs a
// warning about that. See ARCHITECTURE.md, "Auth".
import FirebaseCore

enum FirebaseBootstrap {
    static func configure() {
        guard FirebaseApp.app() == nil else { return }
        FirebaseApp.configure()
    }
}
