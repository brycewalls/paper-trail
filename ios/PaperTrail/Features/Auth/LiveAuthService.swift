// Owner: auth. The live AuthService (ARCHITECTURE.md, "Auth"): Google's OAuth web flow in a browser
// sheet, the code exchanged by oauthCallback, Firebase signed in with the redeemed tokens, and Drive
// access tokens minted by the driveToken callable from a refresh token that never leaves the server.
//
// #14: launch reads Firebase's persisted user synchronously, so a signed-in person never sees a
// sign-in check. #15: Drive only shows as disconnected when the server says the refresh token is
// gone, never because one request failed.
import Foundation
import Observation

/// What the app remembers about Drive between launches, so the first frame is already right.
struct AuthDefaults {
    let defaults: UserDefaults
    private static let driveKey = "auth.drive"
    private static let consentKey = "auth.driveConsentPending"

    var drive: DriveLink {
        get {
            switch defaults.string(forKey: Self.driveKey) {
            case "connected": .connected
            case "needsReconnect": .needsReconnect
            default: .unknown
            }
        }
        nonmutating set {
            switch newValue {
            case .connected: defaults.set("connected", forKey: Self.driveKey)
            case .needsReconnect: defaults.set("needsReconnect", forKey: Self.driveKey)
            case .unknown: defaults.removeObject(forKey: Self.driveKey)
            }
        }
    }

    var driveConsentPending: Bool {
        get { defaults.bool(forKey: Self.consentKey) }
        nonmutating set { defaults.set(newValue, forKey: Self.consentKey) }
    }
}

@Observable
final class LiveAuthService: AuthService {
    private(set) var state: AuthState
    private(set) var drive: DriveLink
    private(set) var driveConsentPending: Bool

    @ObservationIgnored private let backend: any AuthBackend
    @ObservationIgnored private let web: any WebAuthenticator
    @ObservationIgnored private let stored: AuthDefaults
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var cachedToken: (value: String, expires: Date)?
    @ObservationIgnored private var tokenTask: Task<String, any Error>?

    init(backend: any AuthBackend, web: any WebAuthenticator, defaults: UserDefaults = .standard,
         now: @escaping () -> Date = Date.init) {
        self.backend = backend
        self.web = web
        self.stored = AuthDefaults(defaults: defaults)
        self.now = now
        if let account = backend.currentAccount {
            state = .signedIn(account)
            drive = stored.drive == .unknown ? .connected : stored.drive
            driveConsentPending = stored.driveConsentPending
        } else {
            state = .signedOut
            drive = .unknown
            driveConsentPending = false
        }
        backend.observe { [weak self] account in self?.firebaseChanged(account) }
    }

    /// The real app's service.
    static func live() -> LiveAuthService {
        let service = LiveAuthService(backend: FirebaseAuthBackend(), web: SystemWebAuthenticator())
        // Confirm Drive in the background after launch. Nothing waits on it (#14); it only flips
        // to Reconnect Drive if the server says the refresh token is gone (#15).
        Task { await service.refreshDriveStatus() }
        return service
    }

    // MARK: AuthService

    func signIn() async throws {
        let attempt = OAuthAttempt.make()
        let handoff: OAuthHandoff
        do {
            handoff = try await runConsent(attempt, purpose: .signIn)
        } catch AuthFailure.notAllowed(let email) {
            state = .notAllowed(Account(uid: "", email: email, displayName: Account.fallbackName(for: email)))
            throw AuthFailure.notAllowed(email: email)
        }
        let account: Account
        do {
            account = try await backend.signInToFirebase(idToken: handoff.idToken, accessToken: handoff.accessToken)
        } catch {
            throw AuthFailure.failed("Firebase sign-in: \(error.localizedDescription)")
        }
        cachedToken = nil
        if handoff.driveConnected { cache(handoff) }
        setDrive(handoff.driveConnected ? .connected : .needsReconnect, consentPending: !handoff.driveConnected)
        state = .signedIn(account)
    }

    func reconnectDrive() async throws {
        guard case .signedIn(let account) = state else { throw AuthFailure.failed("Not signed in") }
        let attempt = OAuthAttempt.make()
        let handoff = try await runConsent(attempt, purpose: .reconnectDrive(email: account.email))
        guard handoff.email.lowercased() == account.email.lowercased() else { throw AuthFailure.wrongAccount }
        guard handoff.driveConnected else { throw AuthFailure.driveNotGranted }
        cache(handoff)
        setDrive(.connected, consentPending: false)
    }

    func signOut() throws {
        tokenTask?.cancel()
        tokenTask = nil
        cachedToken = nil
        if case .signedIn = state { try backend.signOut() }
        state = .signedOut
        setDrive(.unknown, consentPending: false)
    }

    func driveAccessToken() async throws -> String {
        if let cachedToken, cachedToken.expires.timeIntervalSince(now()) > 60 { return cachedToken.value }
        if let tokenTask { return try await tokenTask.value }
        let task = Task { try await self.mintToken() }
        tokenTask = task
        defer { tokenTask = nil }
        return try await task.value
    }

    // MARK: Internals

    /// Calls driveToken once to learn whether Drive still works. Errors are swallowed: only a
    /// revoke changes anything, and that already happened inside mintToken.
    func refreshDriveStatus() async {
        guard case .signedIn = state, !driveConsentPending else { return }
        _ = try? await driveAccessToken()
    }

    private func mintToken() async throws -> String {
        guard case .signedIn = state else { throw DriveError.unauthorized }
        do {
            let grant = try await backend.fetchDriveToken()
            // Signed out while the token was on its way: drop it, change nothing.
            guard case .signedIn = state else { throw DriveError.unauthorized }
            cachedToken = (grant.accessToken, now().addingTimeInterval(TimeInterval(grant.expiresIn)))
            if drive != .connected { setDrive(.connected, consentPending: false) }
            return grant.accessToken
        } catch DriveTokenFailure.revoked {
            cachedToken = nil
            guard case .signedIn = state else { throw DriveError.unauthorized }
            setDrive(.needsReconnect, consentPending: driveConsentPending)
            throw DriveError.unauthorized
        } catch DriveTokenFailure.signedOut {
            throw DriveError.unauthorized
        } catch DriveTokenFailure.unavailable(let message) {
            throw DriveError.network(message)
        }
    }

    private func runConsent(_ attempt: OAuthAttempt, purpose: OAuthPurpose) async throws -> OAuthHandoff {
        let callbackURL = try await web.authenticate(url: OAuthURL.authorization(for: attempt, purpose: purpose),
                                                     callbackScheme: AuthConfig.callbackScheme)
        switch OAuthCallback.parse(callbackURL, expecting: attempt) {
        case .handoff(let id):
            do {
                return try await backend.redeem(handoff: id, attempt: attempt)
            } catch let failure as AuthFailure {
                throw failure
            } catch {
                throw AuthFailure.failed("Redeem: \(error.localizedDescription)")
            }
        case .canceled: throw AuthFailure.canceled
        case .notAllowed(let email): throw AuthFailure.notAllowed(email: email)
        case .failed: throw AuthFailure.failed("The callback had no handoff")
        }
    }

    private func cache(_ handoff: OAuthHandoff) {
        guard !handoff.accessToken.isEmpty, handoff.expiresIn > 0 else { return }
        cachedToken = (handoff.accessToken, now().addingTimeInterval(TimeInterval(handoff.expiresIn)))
    }

    private func setDrive(_ link: DriveLink, consentPending: Bool) {
        drive = link
        driveConsentPending = consentPending
        stored.drive = link
        stored.driveConsentPending = consentPending
    }

    private func firebaseChanged(_ account: Account?) {
        switch (account, state) {
        case (nil, .signedIn):
            // Firebase dropped the session on its own (revoked, deleted). Back to sign-in.
            cachedToken = nil
            state = .signedOut
            setDrive(.unknown, consentPending: false)
        case (let account?, .signedIn(let current)) where account != current:
            state = .signedIn(account)
        default:
            break
        }
    }
}
