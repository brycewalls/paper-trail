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
        // outbox: the system relaunches the app to report background uploads (#17).
        .backgroundTask(.urlSession(BackgroundUploader.identifier)) { [env] in
            await LiveOutboxService.handleBackgroundEvents(env)
        }
    }
}
