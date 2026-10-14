// Owner: outbox. Actions for the Outbox screen. Logic only: no SwiftUI.
import Foundation
import SwiftData

@Observable
final class OutboxViewModel {
    private let env: AppEnvironment
    private(set) var isReconnecting = false
    private(set) var reconnectError: String?

    init(env: AppEnvironment) { self.env = env }

    var status: OutboxStatus { env.outbox.status }
    var needsReconnect: Bool { env.outbox.status.needsReconnect || env.auth.drive == .needsReconnect }

    func retry(_ item: PipelineItem) async {
        await env.outbox.retry(item)
    }

    func retryAll(_ items: [PipelineItem]) async {
        for item in items where item.stage == .failed { await env.outbox.retry(item) }
    }

    /// "Send back to the deck": cancels or undoes the upload and puts the card on top of the deck.
    @discardableResult
    func sendBack(_ item: PipelineItem) async -> Bool {
        await env.outbox.sendBack(item)
    }

    /// Spec 4.16, the outbox half: reconnect through auth, then resume the queue.
    func reconnect() async {
        isReconnecting = true
        reconnectError = nil
        defer { isReconnecting = false }
        do {
            try await env.auth.reconnectDrive()
            await env.outbox.resumePending()
        } catch {
            reconnectError = OutboxCopy.reconnectFailed
        }
    }

    func fileURL(_ item: PipelineItem) -> URL? {
        let url = env.files.url(for: item.fileName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func thumbnailURL(_ item: PipelineItem) -> URL? {
        item.thumbnailName.map { env.files.url(for: $0) }
    }
}
