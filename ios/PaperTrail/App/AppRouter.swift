// Owner: scaffold (added by deck with the Direction A tab shell; see docs/design-spec.md 3.7 and
// section 7, "RootView").
//
// Which tab is showing, each tab's navigation path, and the Settings sheet. RootView owns one
// NavigationStack per tab bound to `paths`, so the outbox accessory can push the Outbox onto
// whichever tab is current. Tab screens therefore never create their own NavigationStack.
import SwiftUI

enum AppTab: Hashable {
    case sort, piles, paperless, search
}

/// Destinations any tab can push. Features with their own pushed screens declare their own
/// Hashable route type and a `.navigationDestination(for:)` inside their screen.
enum AppRoute: Hashable {
    case outbox
}

@Observable
final class AppRouter {
    var tab: AppTab = .sort
    var paths: [AppTab: NavigationPath] = [:]
    var showSettings = false
    /// The search island's field (spec 4.6). RootView owns the field (it wraps the search tab's stack), so
    /// its text lives here and SearchScreen mirrors it into its view model.
    var searchText = ""
    /// Bumped when the keyboard's Search key is pressed in that field.
    var searchSubmits = 0
    /// Screens that take the bottom edge (card detail's Shred / File bar, the Outbox itself) hide
    /// the outbox accessory while they're on screen. Keyed by screen so two can't race.
    var accessoryHiders: Set<String> = []
    var showsAccessory: Bool { accessoryHiders.isEmpty }

    func path(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(get: { self.paths[tab] ?? NavigationPath() },
                set: { self.paths[tab] = $0 })
    }

    /// The outbox accessory: push the Outbox on the current tab (4.4).
    func openOutbox() { push(AppRoute.outbox) }

    /// Pushes a route onto the current tab's stack. The screen that owns the route type declares
    /// its `.navigationDestination(for:)`.
    func push<Route: Hashable>(_ route: Route) {
        var path = paths[tab] ?? NavigationPath()
        path.append(route)
        paths[tab] = path
    }

    func pop() {
        guard var path = paths[tab], !path.isEmpty else { return }
        path.removeLast()
        paths[tab] = path
    }
}
