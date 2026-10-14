// Owner: auth. State and actions for the first-launch screen (design spec 4.1) and the reconnect
// flow (4.16). No SwiftUI here; the screens only read this and call its methods.
import Foundation
import Observation

@Observable
final class SignInViewModel {
    enum Step: Equatable {
        /// "Sign in with Google".
        case signIn
        /// Signed in, Drive unchecked on the consent screen: "Connect Google Drive".
        case connectDrive(email: String)
        /// The account isn't on the allowlist: "Use another account".
        case notAllowed(email: String)
    }

    private let auth: any AuthService
    private(set) var isWorking = false
    /// Shown under the button after a sign-in that didn't finish.
    private(set) var message: String?

    init(auth: any AuthService) {
        self.auth = auth
    }

    var step: Step {
        switch auth.state {
        case .signedOut: .signIn
        case .notAllowed(let account): .notAllowed(email: account.email)
        case .signedIn(let account): auth.driveConsentPending ? .connectDrive(email: account.email) : .signIn
        }
    }

    func signIn() async {
        await run { try await self.auth.signIn() }
    }

    /// From the not-allowed state: drop that account and pick another.
    func useAnotherAccount() async {
        try? auth.signOut()
        await signIn()
    }

    func connectDrive() async {
        await run { try await self.auth.reconnectDrive() }
    }

    private func run(_ work: @escaping () async throws -> Void) async {
        guard !isWorking else { return }
        isWorking = true
        message = nil
        defer { isWorking = false }
        do {
            try await work()
        } catch AuthFailure.notAllowed {
            message = nil   // the screen shows the not-allowed state instead
        } catch {
            message = Self.signInDidntFinish
        }
    }

    static let signInDidntFinish = "Sign-in didn't finish. Try again when you're ready."
}

/// The Reconnect Drive button wherever it appears (Settings, the banner). Spec 4.16.
@Observable
final class ReconnectDriveModel {
    private let auth: any AuthService
    private(set) var isWorking = false
    private(set) var failed = false

    init(auth: any AuthService) {
        self.auth = auth
    }

    var needsReconnect: Bool { auth.drive == .needsReconnect }

    func reconnect() async {
        guard !isWorking else { return }
        isWorking = true
        failed = false
        defer { isWorking = false }
        do {
            try await auth.reconnectDrive()
        } catch AuthFailure.canceled {
            // Closing the sheet isn't a failure; the button stays.
        } catch {
            failed = true
        }
    }

    static let failure = "Drive didn't reconnect. Try again in a minute."
}
