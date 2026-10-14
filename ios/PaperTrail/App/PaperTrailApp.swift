// Owner: scaffold.
import SwiftUI
import SwiftData

@main
struct PaperTrailApp: App {
    @State private var env = AppEnvironment.forLaunch()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .modelContainer(env.modelContainer)
                .task { await env.outbox.resumePending() }
        }
    }
}
