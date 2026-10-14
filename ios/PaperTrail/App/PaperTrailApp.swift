// Owner: scaffold.
import SwiftUI
import SwiftData

@main
struct PaperTrailApp: App {
    @State private var env = AppEnvironment.forLaunch()

    var body: some Scene {
        WindowGroup {
            AuthGate { RootView() }
                .environment(env)
                .modelContainer(env.modelContainer)
                .task { await env.outbox.resumePending() }
        }
    }
}
