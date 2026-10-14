// Owner: scaffold. Tab shell rebuilt by deck to docs/design-spec.md (Direction A): Sort, Piles,
// Paperless and the search island; the outbox is a tab bar accessory that pushes the Outbox onto
// the current tab; Settings is a sheet from the avatar. Each tab's content belongs to its feature.
//
// RootView owns one NavigationStack per tab (bound to AppRouter.paths). Tab screens must not wrap
// themselves in another NavigationStack.
import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var router = AppRouter()

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Sort", systemImage: "rectangle.stack", value: AppTab.sort) {
                stack(.sort) { DeckScreen(model: DeckViewModel(env: env)) }
            }
            Tab("Piles", systemImage: "square.stack.3d.up", value: AppTab.piles) {
                stack(.piles) { PilesScreen(model: PilesViewModel(docs: env.docs)) }
            }
            Tab("Paperless", systemImage: "leaf", value: AppTab.paperless) {
                // piles: replace this stand-in with PaperlessScreen() (#23).
                stack(.paperless) {
                    ContentUnavailableView("No senders yet", systemImage: "leaf",
                                           description: Text("When a scan comes from someone who offers paperless, they show up here."))
                        .navigationTitle("Paperless")
                        .toolbar { ToolbarItem(placement: .topBarTrailing) { AvatarButton() } }
                }
            }
            Tab(value: AppTab.search, role: .search) {
                stack(.search) { SearchScreen() }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .modifier(OutboxAccessoryHost(isEnabled: isSignedIn && router.showsAccessory) {
            OutboxAccessory { router.openOutbox() }
        })
        .sheet(isPresented: $router.showSettings) {
            SettingsScreen()
                .presentationDetents([.large])
        }
        .environment(router)
    }

    private var isSignedIn: Bool {
        if case .signedIn = env.auth.state { return true }
        return false
    }

    private func stack<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: router.path(for: tab)) {
            content()
                .navigationDestination(for: AppRoute.self) { route in
                    switch route {
                    case .outbox: OutboxScreen()
                    }
                }
        }
    }
}

/// Hosts the outbox accessory (spec 3.7). iOS 26.1 and later can hide it while a screen that owns
/// the bottom edge is showing; iOS 26.0 hides it only when signed out.
private struct OutboxAccessoryHost<Accessory: View>: ViewModifier {
    let isEnabled: Bool
    @ViewBuilder let accessory: Accessory

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: isEnabled) { accessory }
        } else {
            content.tabViewBottomAccessory { if isEnabled { accessory } }
        }
    }
}
