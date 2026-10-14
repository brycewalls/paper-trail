// Owner: auth. The pieces of the Google sign-in flow that are plain logic (ARCHITECTURE.md, "Auth"):
// the authorization URL, the state and verifier, and reading the papertrail:// callback. No network,
// no UI, so all of it is unit tested.
import CryptoKit
import Foundation

/// Fixed configuration. Nothing here is secret and nothing depends on the bundle ID.
nonisolated enum AuthConfig {
    /// The web OAuth client, the same one Firebase Auth's Google provider uses, so the ID token
    /// signs in to the same Firebase user (same uid) as the web app.
    static let webClientID = "814219266285-pe2scelka1o9m98bt0v0f5fohumfs8f6.apps.googleusercontent.com"
    /// Google's redirect URI: the oauthCallback function through a Hosting rewrite.
    static let redirectURI = URL(string: "https://paper-trail-bw.web.app/oauth/callback")!
    /// Where the app trades a handoff for the tokens (oauthRedeem through a Hosting rewrite).
    static let redeemURL = URL(string: "https://paper-trail-bw.web.app/oauth/redeem")!
    /// ASWebAuthenticationSession captures this scheme itself, so it needs no Info.plist entry.
    static let callbackScheme = "papertrail"
    static let authorizationEndpoint = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    static let driveScope = "https://www.googleapis.com/auth/drive.file"
    static let signInScopes = ["openid", "email", "profile", driveScope]
    static let reconnectScopes = ["openid", "email", driveScope]
    static let functionsRegion = "us-central1"
}

/// One sign-in attempt's secrets. The verifier stays on the phone; Google and the server only ever
/// see the state, which carries the verifier's SHA-256.
nonisolated struct OAuthAttempt: Sendable, Hashable {
    let nonce: String
    let verifier: String

    var challenge: String { OAuthAttempt.challenge(for: verifier) }
    var state: String { "\(nonce).\(challenge)" }

    static func make() -> OAuthAttempt {
        OAuthAttempt(nonce: randomToken(bytes: 16), verifier: randomToken(bytes: 32))
    }

    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func randomToken(bytes: Int) -> String {
        var generator = SystemRandomNumberGenerator()
        return base64URL(Data((0..<bytes).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

nonisolated enum OAuthPurpose: Sendable, Hashable {
    /// First sign-in, or "Use another account": pick the account, consent to everything.
    case signIn
    /// Drive only, for the account already signed in.
    case reconnectDrive(email: String)
}

nonisolated enum OAuthURL {
    static func authorization(for attempt: OAuthAttempt, purpose: OAuthPurpose) -> URL {
        var items = [
            URLQueryItem(name: "client_id", value: AuthConfig.webClientID),
            URLQueryItem(name: "redirect_uri", value: AuthConfig.redirectURI.absoluteString),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "state", value: attempt.state),
        ]
        switch purpose {
        case .signIn:
            items.append(URLQueryItem(name: "scope", value: AuthConfig.signInScopes.joined(separator: " ")))
            items.append(URLQueryItem(name: "prompt", value: "select_account consent"))
        case .reconnectDrive(let email):
            items.append(URLQueryItem(name: "scope", value: AuthConfig.reconnectScopes.joined(separator: " ")))
            items.append(URLQueryItem(name: "prompt", value: "consent"))
            items.append(URLQueryItem(name: "include_granted_scopes", value: "true"))
            items.append(URLQueryItem(name: "login_hint", value: email))
        }
        var components = URLComponents(url: AuthConfig.authorizationEndpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = items
        // URLComponents leaves "+" alone in query values; Google would read it as a space.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return components.url!
    }
}

/// What oauthCallback sent back through papertrail://auth.
nonisolated enum OAuthCallback: Sendable, Hashable {
    case handoff(String)
    case canceled
    case notAllowed(email: String)
    case failed

    /// Reads the callback URL. A missing or different state is a failure, never a handoff.
    static func parse(_ url: URL, expecting attempt: OAuthAttempt) -> OAuthCallback {
        guard url.scheme == AuthConfig.callbackScheme, url.host() == "auth",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return .failed }
        let value = { (name: String) in items.first { $0.name == name }?.value }
        guard value("state") == attempt.state else { return .failed }
        switch value("error") {
        case nil:
            guard let handoff = value("handoff"), !handoff.isEmpty else { return .failed }
            return .handoff(handoff)
        case "canceled": return .canceled
        case "not_allowed": return .notAllowed(email: value("email") ?? "")
        default: return .failed
        }
    }
}

/// oauthRedeem's answer.
nonisolated struct OAuthHandoff: Codable, Sendable, Hashable {
    var idToken: String
    var accessToken: String
    var expiresIn: Int
    var email: String
    var name: String
    var driveConnected: Bool
}

/// Why sign-in or reconnecting stopped. The screens pick their own copy from these.
nonisolated enum AuthFailure: Error, Sendable, Hashable {
    case canceled
    case notAllowed(email: String)
    /// The consent screen came back without Drive.
    case driveNotGranted
    /// Reconnect Drive picked a different Google account than the one signed in.
    case wrongAccount
    case failed(String)
}
