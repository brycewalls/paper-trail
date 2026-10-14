// Auth (#14, #15): the OAuth URL and callback, LiveAuthService against a stand-in browser sheet and
// backend, the Drive token cache and revoke path, and the sign-in and settings view models.
import Foundation
import Testing
@testable import PaperTrail

// MARK: - Stand-ins

private final class StubWeb: WebAuthenticator {
    /// What the "browser" sends back, given the state the app put in the URL.
    var reply: (String) -> String = { "papertrail://auth?handoff=HANDOFF&state=\($0)" }
    var error: (any Error)?
    private(set) var urls: [URL] = []

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        urls.append(url)
        if let error { throw error }
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
        return URL(string: reply(state.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!))!
    }
}

private final class StubBackend: AuthBackend {
    var currentAccount: Account?
    var handoff = OAuthHandoff(idToken: "id.token.sig", accessToken: "ya29.first", expiresIn: 3600,
                               email: "bryce.evan.walls@gmail.com", name: "Bryce Walls", driveConnected: true)
    var grant: Result<DriveTokenGrant, DriveTokenFailure> = .success(DriveTokenGrant(accessToken: "ya29.minted", expiresIn: 3600))
    var tokenDelay: Duration = .zero
    private(set) var redeemed: [(String, OAuthAttempt)] = []
    private(set) var firebaseSignIns: [(String, String)] = []
    private(set) var tokenFetches = 0
    private(set) var signOuts = 0
    private var onChange: (@MainActor (Account?) -> Void)?

    func observe(_ onChange: @escaping @MainActor (Account?) -> Void) { self.onChange = onChange }
    func fire(_ account: Account?) { onChange?(account) }

    func redeem(handoff: String, attempt: OAuthAttempt) async throws -> OAuthHandoff {
        redeemed.append((handoff, attempt))
        return self.handoff
    }

    func signInToFirebase(idToken: String, accessToken: String) async throws -> Account {
        firebaseSignIns.append((idToken, accessToken))
        let account = Account(uid: "web-uid", email: handoff.email, displayName: handoff.name)
        currentAccount = account
        return account
    }

    func fetchDriveToken() async throws -> DriveTokenGrant {
        tokenFetches += 1
        if tokenDelay > .zero { try await Task.sleep(for: tokenDelay) }
        return try grant.get()
    }

    func signOut() throws {
        signOuts += 1
        currentAccount = nil
    }
}

private let bryce = Account(uid: "web-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls")

private func freshDefaults() -> UserDefaults {
    let name = "auth-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

private func query(_ url: URL) -> [String: String] {
    Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
}

// MARK: - OAuth pieces

struct OAuthFlowTests {
    @Test func challengeMatchesTheServerAndRFC7636() {
        // RFC 7636 appendix B; functions/test/oauth.test.mjs checks the same pair.
        #expect(OAuthAttempt.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func attemptsAreRandomAndShapedForTheServer() {
        let a = OAuthAttempt.make(), b = OAuthAttempt.make()
        #expect(a != b)
        #expect(a.verifier.count == 43)
        #expect(a.state.range(of: #"^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil)
    }

    @Test func signInURLAsksForDriveOfflineWithTheWebClient() throws {
        let attempt = OAuthAttempt.make()
        let url = OAuthURL.authorization(for: attempt, purpose: .signIn)
        #expect(url.host() == "accounts.google.com")
        let q = query(url)
        #expect(q["client_id"] == AuthConfig.webClientID)
        #expect(q["redirect_uri"] == "https://paper-trail-bw.web.app/oauth/callback")
        #expect(q["response_type"] == "code")
        #expect(q["access_type"] == "offline")
        #expect(q["prompt"] == "select_account consent")
        #expect(q["state"] == attempt.state)
        #expect(q["scope"] == "openid email profile https://www.googleapis.com/auth/drive.file")
        #expect(q["login_hint"] == nil)
        #expect(!url.absoluteString.contains("+"))
    }

    @Test func reconnectURLIsDriveOnlyForTheSameAccount() {
        let url = OAuthURL.authorization(for: .make(), purpose: .reconnectDrive(email: "a+b@example.com"))
        let q = query(url)
        #expect(q["scope"] == "openid email https://www.googleapis.com/auth/drive.file")
        #expect(q["login_hint"] == "a+b@example.com")
        #expect(q["include_granted_scopes"] == "true")
        #expect(q["prompt"] == "consent")
    }

    @Test func callbackParsing() {
        let attempt = OAuthAttempt.make()
        let s = attempt.state
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?handoff=abc&state=\(s)")!, expecting: attempt) == .handoff("abc"))
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?error=canceled&state=\(s)")!, expecting: attempt) == .canceled)
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?error=not_allowed&email=x%40y.com&state=\(s)")!, expecting: attempt) == .notAllowed(email: "x@y.com"))
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?error=failed&state=\(s)")!, expecting: attempt) == .failed)
        // Someone else's state, no state, the wrong scheme or host: never a handoff.
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?handoff=abc&state=\(OAuthAttempt.make().state)")!, expecting: attempt) == .failed)
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?handoff=abc")!, expecting: attempt) == .failed)
        #expect(OAuthCallback.parse(URL(string: "evil://auth?handoff=abc&state=\(s)")!, expecting: attempt) == .failed)
        #expect(OAuthCallback.parse(URL(string: "papertrail://other?handoff=abc&state=\(s)")!, expecting: attempt) == .failed)
        #expect(OAuthCallback.parse(URL(string: "papertrail://auth?handoff=&state=\(s)")!, expecting: attempt) == .failed)
    }

    @Test func accountNamesAndInitials() {
        #expect(Account.fallbackName(for: "bryce.evan.walls@gmail.com") == "Bryce Evan Walls")
        #expect(bryce.initials == "BW")
        #expect(Account(uid: "", email: "x@y.com", displayName: "Cher").initials == "CH")
        #expect(Account(uid: "", email: "x@y.com", displayName: "").initials == "X")
    }
}

// MARK: - LiveAuthService

@MainActor
struct LiveAuthServiceTests {
    @Test func launchReadsThePersistedUserWithoutWaiting() {
        let backend = StubBackend()
        backend.currentAccount = bryce
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: freshDefaults())
        #expect(auth.state == .signedIn(bryce))
        #expect(auth.drive == .connected)
        #expect(backend.tokenFetches == 0, "nothing on the network before the first frame")
    }

    @Test func launchRemembersAReconnectFromLastTime() {
        let defaults = freshDefaults()
        AuthDefaults(defaults: defaults).drive = .needsReconnect
        let backend = StubBackend()
        backend.currentAccount = bryce
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: defaults)
        #expect(auth.drive == .needsReconnect)
    }

    @Test func launchSignedOut() {
        let auth = LiveAuthService(backend: StubBackend(), web: StubWeb(), defaults: freshDefaults())
        #expect(auth.state == .signedOut)
        #expect(auth.drive == .unknown)
    }

    @Test func signInRedeemsTheHandoffAndSignsInToFirebase() async throws {
        let backend = StubBackend(), web = StubWeb()
        let auth = LiveAuthService(backend: backend, web: web, defaults: freshDefaults())
        try await auth.signIn()
        #expect(auth.state == .signedIn(bryce))
        #expect(auth.drive == .connected)
        #expect(!auth.driveConsentPending)
        #expect(backend.redeemed.count == 1)
        #expect(backend.redeemed[0].0 == "HANDOFF")
        #expect(query(web.urls[0])["state"] == backend.redeemed[0].1.state, "redeemed with the same attempt it started")
        #expect(backend.firebaseSignIns.first?.0 == "id.token.sig")
        // The sign-in's own access token serves Drive until it nears expiry.
        #expect(try await auth.driveAccessToken() == "ya29.first")
        #expect(backend.tokenFetches == 0)
    }

    @Test func signInWithoutDriveKeepsTheSignInScreenUp() async throws {
        let backend = StubBackend()
        backend.handoff.driveConnected = false
        backend.handoff.accessToken = "ya29.noDrive"
        let defaults = freshDefaults()
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: defaults)
        try await auth.signIn()
        #expect(auth.driveConsentPending)
        #expect(auth.drive == .needsReconnect)
        #expect(SignInViewModel(auth: auth).step == .connectDrive(email: bryce.email))
        #expect(AuthDefaults(defaults: defaults).driveConsentPending, "survives a relaunch")

        backend.handoff.driveConnected = true
        try await auth.reconnectDrive()
        #expect(!auth.driveConsentPending)
        #expect(auth.drive == .connected)
    }

    @Test func notAllowedShowsTheAccount() async {
        let web = StubWeb()
        web.reply = { "papertrail://auth?error=not_allowed&email=someone%40example.com&state=\($0)" }
        let backend = StubBackend()
        let auth = LiveAuthService(backend: backend, web: web, defaults: freshDefaults())
        await #expect(throws: AuthFailure.notAllowed(email: "someone@example.com")) { try await auth.signIn() }
        guard case .notAllowed(let account) = auth.state else { Issue.record("expected notAllowed"); return }
        #expect(account.email == "someone@example.com")
        #expect(backend.firebaseSignIns.isEmpty)
    }

    @Test func aForgedCallbackNeverSignsIn() async {
        let web = StubWeb()
        web.reply = { _ in "papertrail://auth?handoff=HANDOFF&state=\(OAuthAttempt.make().state)" }
        let backend = StubBackend()
        let auth = LiveAuthService(backend: backend, web: web, defaults: freshDefaults())
        await #expect(throws: AuthFailure.self) { try await auth.signIn() }
        #expect(auth.state == .signedOut)
        #expect(backend.redeemed.isEmpty)
    }

    @Test func closingTheSheetIsCanceled() async {
        let web = StubWeb()
        web.error = AuthFailure.canceled
        let auth = LiveAuthService(backend: StubBackend(), web: web, defaults: freshDefaults())
        await #expect(throws: AuthFailure.canceled) { try await auth.signIn() }
        #expect(auth.state == .signedOut)
    }

    @Test func reconnectMustBeTheSameAccountAndGrantDrive() async throws {
        let backend = StubBackend()
        backend.currentAccount = bryce
        let defaults = freshDefaults()
        AuthDefaults(defaults: defaults).drive = .needsReconnect
        let web = StubWeb()
        let auth = LiveAuthService(backend: backend, web: web, defaults: defaults)

        backend.handoff.email = "other@example.com"
        await #expect(throws: AuthFailure.wrongAccount) { try await auth.reconnectDrive() }
        #expect(auth.drive == .needsReconnect)
        #expect(query(web.urls[0])["login_hint"] == bryce.email)

        backend.handoff.email = "Bryce.Evan.Walls@gmail.com"
        backend.handoff.driveConnected = false
        await #expect(throws: AuthFailure.driveNotGranted) { try await auth.reconnectDrive() }

        backend.handoff.driveConnected = true
        backend.handoff.accessToken = "ya29.reconnected"
        try await auth.reconnectDrive()
        #expect(auth.drive == .connected)
        #expect(try await auth.driveAccessToken() == "ya29.reconnected")
        #expect(backend.firebaseSignIns.isEmpty, "reconnecting doesn't sign in again")
    }

    @Test func driveTokenIsMintedOnceAndCached() async throws {
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let backend = StubBackend()
        backend.currentAccount = bryce
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: freshDefaults(), now: { clock })
        #expect(try await auth.driveAccessToken() == "ya29.minted")
        #expect(try await auth.driveAccessToken() == "ya29.minted")
        #expect(backend.tokenFetches == 1)
        // Within a minute of expiry it mints a new one.
        clock = clock.addingTimeInterval(3600 - 30)
        backend.grant = .success(DriveTokenGrant(accessToken: "ya29.next", expiresIn: 3600))
        #expect(try await auth.driveAccessToken() == "ya29.next")
        #expect(backend.tokenFetches == 2)
    }

    @Test func concurrentCallsShareOneMint() async throws {
        let backend = StubBackend()
        backend.currentAccount = bryce
        backend.tokenDelay = .milliseconds(50)
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: freshDefaults())
        async let a = auth.driveAccessToken()
        async let b = auth.driveAccessToken()
        async let c = auth.driveAccessToken()
        let tokens = try await [a, b, c]
        #expect(tokens == ["ya29.minted", "ya29.minted", "ya29.minted"])
        #expect(backend.tokenFetches == 1)
    }

    @Test func aRevokedRefreshTokenShowsReconnect() async {
        let backend = StubBackend()
        backend.currentAccount = bryce
        backend.grant = .failure(.revoked)
        let defaults = freshDefaults()
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: defaults)
        await #expect(throws: DriveError.unauthorized) { try await auth.driveAccessToken() }
        #expect(auth.drive == .needsReconnect)
        #expect(AuthDefaults(defaults: defaults).drive == .needsReconnect)
        #expect(auth.state == .signedIn(bryce), "the app stays usable")
        #expect(!auth.driveConsentPending)
    }

    @Test func aNetworkBlipDoesNotDisconnectDrive() async {
        let backend = StubBackend()
        backend.currentAccount = bryce
        backend.grant = .failure(.unavailable("offline"))
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: freshDefaults())
        await #expect(throws: DriveError.network("offline")) { try await auth.driveAccessToken() }
        #expect(auth.drive == .connected)
        await auth.refreshDriveStatus()
        #expect(auth.drive == .connected)
    }

    @Test func aWorkingTokenClearsAnOldReconnect() async throws {
        let defaults = freshDefaults()
        AuthDefaults(defaults: defaults).drive = .needsReconnect
        let backend = StubBackend()
        backend.currentAccount = bryce
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: defaults)
        await auth.refreshDriveStatus()
        #expect(auth.drive == .connected)
    }

    @Test func signOutForgetsEverything() async throws {
        let backend = StubBackend()
        backend.currentAccount = bryce
        let defaults = freshDefaults()
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: defaults)
        _ = try await auth.driveAccessToken()
        try auth.signOut()
        #expect(auth.state == .signedOut)
        #expect(backend.signOuts == 1)
        #expect(AuthDefaults(defaults: defaults).drive == .unknown)
        await #expect(throws: DriveError.unauthorized) { try await auth.driveAccessToken() }
    }

    @Test func signingOutMidMintLeavesDriveAlone() async throws {
        let backend = StubBackend()
        backend.currentAccount = bryce
        backend.tokenDelay = .milliseconds(80)
        let defaults = freshDefaults()
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: defaults)
        let pending = Task { try await auth.driveAccessToken() }
        try await Task.sleep(for: .milliseconds(10))
        try auth.signOut()
        await #expect(throws: (any Error).self) { try await pending.value }
        #expect(auth.state == .signedOut)
        #expect(auth.drive == .unknown)
        #expect(AuthDefaults(defaults: defaults).drive == .unknown)
    }

    @Test func firebaseDroppingTheUserSignsOut() {
        let backend = StubBackend()
        backend.currentAccount = bryce
        let auth = LiveAuthService(backend: backend, web: StubWeb(), defaults: freshDefaults())
        backend.fire(bryce)
        #expect(auth.state == .signedIn(bryce))
        backend.fire(nil)
        #expect(auth.state == .signedOut)
    }
}

// MARK: - View models

@MainActor
struct SignInViewModelTests {
    @Test func stepsFollowTheAuthState() {
        let fake = FakeAuthService(signedIn: false)
        let model = SignInViewModel(auth: fake)
        #expect(model.step == .signIn)
        fake.state = .notAllowed(Account(uid: "", email: "x@y.com", displayName: "X"))
        #expect(model.step == .notAllowed(email: "x@y.com"))
        fake.state = .signedIn(bryce)
        fake.driveConsentPending = true
        #expect(model.step == .connectDrive(email: bryce.email))
    }

    @Test func aFailedSignInSaysSoAndKeepsTheButton() async {
        let fake = FakeAuthService(signedIn: false)
        fake.failure = .failed("boom")
        let model = SignInViewModel(auth: fake)
        await model.signIn()
        #expect(model.message == "Sign-in didn't finish. Try again when you're ready.")
        #expect(!model.isWorking)
        #expect(model.step == .signIn)

        fake.failure = nil
        await model.signIn()
        #expect(model.message == nil)
        #expect(fake.state == .signedIn(Account(uid: "fake-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls")))
    }

    @Test func useAnotherAccountStartsOver() async {
        let fake = FakeAuthService(signedIn: false)
        fake.state = .notAllowed(Account(uid: "", email: "x@y.com", displayName: "X"))
        let model = SignInViewModel(auth: fake)
        await model.useAnotherAccount()
        guard case .signedIn = fake.state else { Issue.record("expected signedIn"); return }
    }

    @Test func reconnectModel() async {
        let fake = FakeAuthService()
        fake.drive = .needsReconnect
        let model = ReconnectDriveModel(auth: fake)
        #expect(model.needsReconnect)

        fake.failure = .canceled
        await model.reconnect()
        #expect(!model.failed, "closing the sheet isn't a failure")

        fake.failure = .failed("nope")
        await model.reconnect()
        #expect(model.failed)
        #expect(ReconnectDriveModel.failure == "Drive didn't reconnect. Try again in a minute.")

        fake.failure = nil
        await model.reconnect()
        #expect(!model.failed)
        #expect(!model.needsReconnect)
    }

    @Test func settingsModelReadsTheAccountAndFolder() async throws {
        let env = AppEnvironment.sample()
        let model = AccountSettingsModel(env: env)
        #expect(model.account?.email == "bryce.evan.walls@gmail.com")
        #expect(model.isDriveConnected)
        #expect(model.folderLink.absoluteString.contains("drive.google.com"))
        try await env.docs.saveDriveFolders(DriveFolderCache(root: "ROOT123", folders: [:], updatedAt: ""))
        await model.load()
        #expect(model.folderURL == URL(string: "https://drive.google.com/drive/folders/ROOT123"))
        model.signOut()
        #expect(model.account == nil)
        #expect(AccountSettingsModel.versionLine.hasPrefix("Paper Trail "))
    }
}
