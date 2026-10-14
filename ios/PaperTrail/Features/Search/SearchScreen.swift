// Owner: piles (search UI, #22). FUNCTIONAL STAND-IN, not the design.
import SwiftUI

struct SearchScreen: View {
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ContentUnavailableView("Search is coming", systemImage: "magnifyingglass",
                                   description: Text("Search across every filed document lands with issue #22."))
                .navigationTitle("Search")
                .searchable(text: $query)
        }
    }
}
