// Owner: scaffold. Tabs are fixed by ARCHITECTURE.md ("Navigation"); each tab's content belongs to
// its feature. Plain stand-in until docs/design-spec.md lands.
import SwiftUI

enum AppTab: Hashable {
    case sort, piles, search, settings
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var tab: AppTab = .sort
    @State private var showOutbox = false

    var body: some View {
        TabView(selection: $tab) {
            Tab("Sort", systemImage: "rectangle.stack", value: AppTab.sort) {
                DeckScreen(model: DeckViewModel(env: env))
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
        // Outbox (spec 3.7): the accessory, not a tab. Until deck's router lands it opens the
        // Outbox in a sheet; the router replaces this with a push onto the current tab.
        .tabViewBottomAccessory { OutboxAccessory { showOutbox = true } }
        .sheet(isPresented: $showOutbox) {
            NavigationStack { OutboxScreen() }
        }
        .task { if await OutboxDemo.prepare(env: env) { showOutbox = true } }  // outbox: simulator screenshots only
    }
}
