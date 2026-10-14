// Owner: auth. What LiveAuthService reaches outside itself for, behind two small protocols so its
// logic runs in unit tests: the browser sheet (WebAuthenticator) and Firebase plus the two auth
// functions (AuthBackend). The live versions are the only code here that touches the network.
import AuthenticationServices
import FirebaseAuth
import FirebaseFunctions
import Foundation
import UIKit

/// A Drive access token from the driveToken callable.
nonisolated struct DriveTokenGrant: Codable, Sendable, Hashable {
    var accessToken: String
    var expiresIn: Int
}

nonisolated enum DriveTokenFailure: Error, Sendable, Hashable {
    /// The server has no working refresh token: show Reconnect Drive.
    case revoked
    case signedOut
    /// Network trouble or a Google hiccup. Try again later; Drive stays as it was.
    case unavailable(String)
}

protocol WebAuthenticator: AnyObject {
    /// Opens the browser sheet at `url` and returns the papertrail:// URL it ended on.
    /// Throws AuthFailure.canceled when the person closes the sheet.
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

protocol AuthBackend: AnyObject {
    /// Firebase Auth's persisted user, read synchronously from the keychain (#14).
    var currentAccount: Account? { get }
    /// Called whenever Firebase signs the user in or out on its own (token revoked, account deleted).
    func observe(_ onChange: @escaping @MainActor (Account?) -> Void)
    func redeem(handoff: String, attempt: OAuthAttempt) async throws -> OAuthHandoff
    func signInToFirebase(idToken: String, accessToken: String) async throws -> Account
    func fetchDriveToken() async throws -> DriveTokenGrant
    func signOut() throws
}

// MARK: - Live

final class SystemWebAuthenticator: NSObject, WebAuthenticator, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, any Error>) in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(callbackScheme)) { callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: AuthFailure.canceled)
                } else {
                    continuation.resume(throwing: AuthFailure.failed(error?.localizedDescription ?? "No callback"))
                }
            }
            session.presentationContextProvider = self
            // Keep Google's cookies so a returning account is one tap.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                continuation.resume(throwing: AuthFailure.failed("The sign-in sheet didn't open"))
            }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return window }
            return UIWindow(windowScene: scenes.first!)
        }
    }
}

final class FirebaseAuthBackend: AuthBackend {
    private let session: URLSession
    private var listener: AuthStateDidChangeListenerHandle?

    init(session: URLSession = .shared) {
        self.session = session
    }

    var currentAccount: Account? { Auth.auth().currentUser.map(Self.account) }

    func observe(_ onChange: @escaping @MainActor (Account?) -> Void) {
        listener = Auth.auth().addStateDidChangeListener { _, user in
            let account = user.map(Self.account)
            MainActor.assumeIsolated { onChange(account) }
        }
    }

    func redeem(handoff: String, attempt: OAuthAttempt) async throws -> OAuthHandoff {
        var request = URLRequest(url: AuthConfig.redeemURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["handoff": handoff, "state": attempt.state, "verifier": attempt.verifier])
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw AuthFailure.failed("Redeem answered \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }
        return try JSONDecoder().decode(OAuthHandoff.self, from: data)
    }

    func signInToFirebase(idToken: String, accessToken: String) async throws -> Account {
        let credential = GoogleAuthProvider.credential(withIDToken: idToken, accessToken: accessToken)
        let result = try await Auth.auth().signIn(with: credential)
        return Self.account(result.user)
    }

    func fetchDriveToken() async throws -> DriveTokenGrant {
        let callable = Functions.functions(region: AuthConfig.functionsRegion)
            .httpsCallable("driveToken", requestAs: [String: String].self, responseAs: DriveTokenGrant.self)
        do {
            return try await callable.call([:])
        } catch let error as NSError where error.domain == FunctionsErrorDomain {
            let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            switch details?["code"] as? String {
            case "drive_revoked": throw DriveTokenFailure.revoked
            case "signed_out", "not_allowed": throw DriveTokenFailure.signedOut
            default: throw DriveTokenFailure.unavailable(error.localizedDescription)
            }
        } catch {
            throw DriveTokenFailure.unavailable(error.localizedDescription)
        }
    }

    func signOut() throws {
        try Auth.auth().signOut()
    }

    private nonisolated static func account(_ user: User) -> Account {
        let email = user.email ?? ""
        let name = user.displayName?.trimmingCharacters(in: .whitespaces) ?? ""
        return Account(uid: user.uid, email: email, displayName: name.isEmpty ? Account.fallbackName(for: email) : name)
    }
}

extension Account {
    /// "bryce.evan.walls@gmail.com" becomes "Bryce Evan Walls" when Google has no name.
    nonisolated static func fallbackName(for email: String) -> String {
        let local = email.split(separator: "@").first.map(String.init) ?? email
        return local.split(whereSeparator: { ".-_".contains($0) }).map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    /// Up to two initials for the avatar.
    nonisolated var initials: String {
        let parts = displayName.split(separator: " ").filter { !$0.isEmpty }
        let letters = parts.count >= 2 ? [parts.first!, parts.last!].compactMap(\.first) : Array(parts.first?.prefix(2) ?? Substring(email.prefix(1)))
        return String(letters).uppercased()
    }
}
