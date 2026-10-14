// Owner: deck. The deck's row in Settings > Sorting (docs/design-spec.md 4.9, A8).
//
// "Offer to file confident cards together" defaults to off (Bryce's decision 5). It is kept on
// this device for now; it moves to users/{uid}/config/settings once AppSettings has a
// read and write path in DocStore.
import SwiftUI

enum DeckSettings {
    static let offerBulkFileKey = "offerBulkFile"
    static let footer = "When it's on, Sort offers to file the cards Claude is sure about in one go. You still see each one in the list first."
}

struct DeckSettingsRows: View {
    @AppStorage(DeckSettings.offerBulkFileKey) private var offerBulkFile = false

    var body: some View {
        Toggle("Offer to file confident cards together", isOn: $offerBulkFile)
    }
}
