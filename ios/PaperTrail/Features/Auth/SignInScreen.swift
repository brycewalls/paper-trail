// Owner: auth. First launch and sign-in, design spec 4.1 (#14, #15). Shown only when the person is
// signed out, not on the allowlist, or signed in without Drive. A signed-in person goes straight to
// the app: AuthGate decides from Firebase's persisted user, with no check and no spinner (#14).
import SwiftUI

struct SignInScreen: View {
    @State private var model: SignInViewModel

    init(model: SignInViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    header
                        .padding(.top, 32)
                    Spacer(minLength: 32)
                    actions
                        .padding(.bottom, 24)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Palette.background.ignoresSafeArea())
    }

    private var header: some View {
        VStack(spacing: 16) {
            AppIconImage(size: 96)
            Text("Paper Trail")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Scan the pile. Claude reads each document, files it to your Google Drive, and tells you what to shred.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            if case .notAllowed = model.step {
                Text("This account isn't on the list.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var actions: some View {
        VStack(spacing: 16) {
            switch model.step {
            case .signIn:
                GoogleSignInButton(isWorking: model.isWorking) { Task { await model.signIn() } }
                    .disabled(model.isWorking)
                failure
                footnote("Paper Trail asks for Drive access so it can file your scans. It only sees the files it creates.")
            case .connectDrive(let email):
                Text("Signed in as \(email)")
                    .font(.subheadline)
                PrimaryButton("Connect Google Drive", isWorking: model.isWorking) { Task { await model.connectDrive() } }
                failure
                footnote("Paper Trail needs Drive to file your scans. Nothing uploads until it's connected.")
            case .notAllowed:
                Button { Task { await model.useAnotherAccount() } } label: {
                    Group {
                        if model.isWorking { ProgressView() } else { Text("Use another account").font(.headline) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(Capsule().fill(Palette.surface))
                    .overlay(Capsule().strokeBorder(Palette.separator, lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color(.accent))
                .disabled(model.isWorking)
                failure
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var failure: some View {
        if let message = model.message {
            Text(message)
                .font(.footnote)
                .foregroundStyle(Palette.danger)
                .multilineTextAlignment(.center)
        }
    }

    private func footnote(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 320)
    }
}

/// Decides between the sign-in screen and the app from the auth state alone, synchronously, so a
/// signed-in launch draws the app on its first frame (#14). Cross-fades on sign-in (spec 4.1).
struct AuthGate<Content: View>: View {
    @Environment(AppEnvironment.self) private var env
    @ViewBuilder let content: () -> Content
    @State private var showsSettings = false

    var body: some View {
        ZStack {
            if isIn {
                content()
                    .transition(.opacity)
            } else {
                SignInScreen(model: SignInViewModel(auth: env.auth))
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: isIn)
        #if DEBUG
        .onAppear { showsSettings = AuthLaunchPreset.apply(to: env) }
        .sheet(isPresented: $showsSettings) { SettingsScreen() }
        #endif
    }

    private var isIn: Bool {
        if case .signedIn = env.auth.state { return !env.auth.driveConsentPending }
        return false
    }
}

#if DEBUG
/// Simulator checks of the auth screens on sample data, no Google needed:
///   -PTSample -PTAuth signedOut | notAllowed | driveConsent | needsReconnect   [-PTSettings]
enum AuthLaunchPreset {
    /// Returns true when Settings should open as a sheet.
    static func apply(to env: AppEnvironment) -> Bool {
        let args = ProcessInfo.processInfo.arguments
        guard env.isSample, let fake = env.auth as? FakeAuthService else { return false }
        if let index = args.firstIndex(of: "-PTAuth"), index + 1 < args.count {
            let bryce = Account(uid: "fake-uid", email: "bryce.evan.walls@gmail.com", displayName: "Bryce Walls")
            switch args[index + 1] {
            case "signedOut": fake.state = .signedOut
            case "notAllowed": fake.state = .notAllowed(Account(uid: "", email: "someone@example.com", displayName: "Someone"))
            case "driveConsent": fake.driveConsentPending = true; fake.drive = .needsReconnect; fake.state = .signedIn(bryce)
            case "needsReconnect": fake.drive = .needsReconnect
            default: break
            }
        }
        return args.contains("-PTSettings")
    }
}
#endif
