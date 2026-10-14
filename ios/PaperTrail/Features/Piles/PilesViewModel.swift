// Owner: piles. Logic only, no SwiftUI.
import Foundation

@Observable
final class PilesViewModel {
    private let docs: any DocStore
    private(set) var all: [FiledDoc] = []

    init(docs: any DocStore) { self.docs = docs }

    var toShred: [FiledDoc] { all.filter { $0.physical == .toShred } }
    var keepOriginals: [FiledDoc] { all.filter { $0.physical == .keep || $0.physical == .stored } }
    var shreddedCount: Int { all.filter { $0.physical == .shredded }.count }

    /// Runs for as long as the screen is on screen (call from .task).
    func watch() async {
        for await list in docs.docs() { all = list }
    }

    func markShredded(_ doc: FiledDoc) async {
        try? await docs.updateDoc(id: doc.id, fields: [
            "physical": PhysicalState.shredded.rawValue,
            "shreddedAt": ISO8601DateFormatter().string(from: .now),
        ])
    }
}
