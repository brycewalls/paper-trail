// Owner: scaffold. Tabs are fixed by ARCHITECTURE.md ("Navigation"); each tab's content belongs to
// its feature. Plain stand-in until docs/design-spec.md lands.
import SwiftUI

enum AppTab: Hashable {
    case sort, outbox, piles, search, settings
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var tab: AppTab = .sort

    var body: some View {
        TabView(selection: $tab) {
            Tab("Sort", systemImage: "rectangle.stack", value: AppTab.sort) {
                DeckScreen(model: DeckViewModel(env: env))
            }
            Tab("Outbox", systemImage: "tray.and.arrow.up", value: AppTab.outbox) {
                OutboxScreen()
            }
            Tab("Piles", systemImage: "square.stack.3d.up", value: AppTab.piles) {
                PilesScreen(model: PilesViewModel(docs: env.docs))
            }
            Tab("Search", systemImage: "magnifyingglass", value: AppTab.search, role: .search) {
                SearchScreen()
            }
            Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
                SettingsScreen()
            }
        }
        .tint(Theme.accent)
    }
}
