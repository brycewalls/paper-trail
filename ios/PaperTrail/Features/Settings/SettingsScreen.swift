// Owner: settings is shared. auth owns the Account and Drive sections, classify owns Senders,
// outbox owns the shred hold. FUNCTIONAL STAND-IN, not the design.
import SwiftUI

struct SettingsScreen: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    switch env.auth.state {
                    case .signedIn(let account): LabeledContent("Signed in", value: account.email)
                    case .notAllowed(let account): LabeledContent("Not allowed", value: account.email)
                    case .signedOut: Text("Signed out")
                    }
                    LabeledContent("Google Drive", value: env.auth.drive == .connected ? "Connected" : "Needs reconnecting")
                }
                if env.isSample {
                    Section {
                        Text("This build runs on sample data. Nothing is sent to Claude, Drive or Firestore.")
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    DeckSettingsRows() // deck
                } header: { Text("Sorting") } footer: { Text(DeckSettings.footer) }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
