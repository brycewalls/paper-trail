// Owner: auth. Settings' Account row and Google Drive section (design spec 4.9), the Account screen
// with Sign out, and the Reconnect Drive banner (3.9, 4.16) other screens drop in. All behavior is
// in AccountSettingsModel and ReconnectDriveModel.
import SwiftData
import SwiftUI

@Observable
final class AccountSettingsModel {
    private let env: AppEnvironment
    let reconnect: ReconnectDriveModel
    /// The "Paperwork Archive" folder in Drive, once the folder cache is known.
    private(set) var folderURL: URL?

    init(env: AppEnvironment) {
        self.env = env
        self.reconnect = ReconnectDriveModel(auth: env.auth)
    }

    var account: Account? {
        switch env.auth.state {
        case .signedIn(let account), .notAllowed(let account): account
        case .signedOut: nil
        }
    }

    var isDriveConnected: Bool { env.auth.drive != .needsReconnect }

    /// Fallback when the folder cache hasn't been written yet: Drive's search for the folder.
    var folderLink: URL {
        folderURL ?? URL(string: "https://drive.google.com/drive/search?q=%22Paperwork%20Archive%22")!
    }

    func load() async {
        if let root = try? await env.docs.driveFolders()?.root, !root.isEmpty {
            folderURL = URL(string: "https://drive.google.com/drive/folders/\(root)")
        }
    }

    func signOut() {
        try? env.auth.signOut()
    }

    static let signOutQuestion = "Sign out of Paper Trail? Your scans stay on this phone until they upload."

    static var versionLine: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Paper Trail \(version) (\(build))"
    }
}

/// Settings, top row: avatar, name, email. Pushes the Account screen.
struct AccountRow: View {
    let model: AccountSettingsModel

    var body: some View {
        if let account = model.account {
            NavigationLink {
                AccountScreen(model: model)
            } label: {
                HStack(spacing: 12) {
                    AccountAvatar(initials: account.initials, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName)
                            .font(.title3.weight(.medium))
                        Text(account.email)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Settings › Account: the email and Sign out.
struct AccountScreen: View {
    let model: AccountSettingsModel
    @State private var confirmingSignOut = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Email", value: model.account?.email ?? "")
            }
            Section {
                Button("Sign out", role: .destructive) { confirmingSignOut = true }
                    .frame(maxWidth: .infinity)
                    .confirmationDialog(AccountSettingsModel.signOutQuestion, isPresented: $confirmingSignOut, titleVisibility: .visible) {
                        Button("Sign out", role: .destructive) { model.signOut() }
                        Button("Cancel", role: .cancel) {}
                    }
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Settings' "Google Drive" section.
struct DriveSettingsSection: View {
    let model: AccountSettingsModel
    @Query(filter: #Predicate<PipelineItem> { $0.verifiedAt != nil }, sort: \PipelineItem.verifiedAt, order: .reverse)
    private var verified: [PipelineItem]

    var body: some View {
        Section {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Circle()
                    .fill(model.isDriveConnected ? AuthPalette.file : AuthPalette.danger)
                    .frame(width: 10, height: 10)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.isDriveConnected ? "Connected" : "Not connected")
                        .font(.body)
                    Text(model.isDriveConnected
                         ? "Stays connected on the server. No sign-in prompts."
                         : "Reconnect to keep filing. Your scans are safe on this phone.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)

            if !model.isDriveConnected {
                ReconnectDriveButton(model: model.reconnect)
            }

            Link(destination: model.folderLink) {
                HStack {
                    Text("Folder").foregroundStyle(Color.primary)
                    Spacer()
                    Text("Paperwork Archive").foregroundStyle(Color.secondary)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color(.tertiaryLabel))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .tint(Color.primary)
            .accessibilityHint("Opens the folder in Drive")

            LabeledContent("Last upload") {
                if let last = verified.first?.verifiedAt {
                    Text(last, format: .relative(presentation: .named))
                } else {
                    Text("None yet")
                }
            }
        } header: {
            // A8 shows the headers in caps; iOS 26 Form headers default to sentence case.
            Text("Google Drive").textCase(.uppercase)
        }
        .task { await model.load() }
    }
}

/// "Reconnect Drive" as a list row button, with progress and the failure line (spec 4.16).
struct ReconnectDriveButton: View {
    let model: ReconnectDriveModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                Task { await model.reconnect() }
            } label: {
                HStack(spacing: 8) {
                    Text("Reconnect Drive")
                    if model.isWorking { ProgressView() }
                }
            }
            .disabled(model.isWorking)
            if model.failed {
                Text(ReconnectDriveModel.failure)
                    .font(.footnote)
                    .foregroundStyle(AuthPalette.danger)
            }
        }
    }
}

/// The Reconnect Drive banner (spec 3.9) for the top of Sort, Outbox and Piles. Drop it in a List:
/// `ReconnectDriveBanner()`. It draws nothing unless the server said Drive needs reconnecting, and
/// removes itself once reconnecting works.
struct ReconnectDriveBanner: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        if env.auth.drive == .needsReconnect {
            BannerContent(model: ReconnectDriveModel(auth: env.auth))
        }
    }

    private struct BannerContent: View {
        @State var model: ReconnectDriveModel

        var body: some View {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Image(systemName: "exclamationmark.icloud.fill")
                            .foregroundStyle(AuthPalette.danger)
                            .accessibilityHidden(true)
                        Text("\(Text("Drive needs reconnecting.").bold()) Your scans are safe on this phone and upload once it's back.")
                            .font(.subheadline)
                    }
                    ReconnectDriveButton(model: model)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(AuthPalette.danger)
                }
                .padding(.vertical, 4)
            }
            .listRowBackground(AuthPalette.dangerSoft)
        }
    }
}
