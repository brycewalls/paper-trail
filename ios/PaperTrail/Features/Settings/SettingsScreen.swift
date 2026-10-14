// Owner: settings is shared; auth owns the shell (design spec 4.9). Each owner adds its own section
// view from its own folder and one line here: classify "Sender rules", piles "Shred hold", deck
// "Offer to file confident cards together", capture "Shutter", auth "Lock with Face ID".
// Presented as a sheet from the avatar (deck's RootView), with its own NavigationStack.
import SwiftUI

struct SettingsScreen: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isPresented) private var isPresented
    @State private var account: AccountSettingsModel?

    var body: some View {
        NavigationStack {
            Form {
                if let account {
                    Section { AccountRow(model: account) }           // auth
                    DriveSettingsSection(model: account)             // auth
                }
                Section {
                    SenderRulesSettingsRow(docs: env.docs)   // classify (#21)
                    ShredHoldRow()                           // outbox
                    DeckSettingsRows()                       // deck
                } header: { Text("Sorting").textCase(.uppercase) } footer: { Text(DeckSettings.footer) }
                // Section "Scanning and privacy": capture and auth add their rows here.
                Section {
                } footer: {
                    Text(AccountSettingsModel.versionLine)
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                if isPresented {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                            .accessibilityIdentifier("settings.done")
                    }
                }
            }
        }
        .tint(Color(.accent))
        .onAppear { if account == nil { account = AccountSettingsModel(env: env) } }
    }
}
