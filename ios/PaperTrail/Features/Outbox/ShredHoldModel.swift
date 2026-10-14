// Owner: outbox. View model behind the Settings "Shred hold" row (ShredHoldSetting.swift): the
// days a verified doc waits before Piles counts it as safe to shred (#18). Stored in
// users/{uid}/config/settings as shredHoldDays, so it follows the account.
import Foundation

@Observable
final class ShredHoldModel {
    static let choices = [0, 1, 3, 7]

    private let docs: any DocStore
    private(set) var days = 0
    private(set) var loaded = false
    private(set) var saveFailed = false

    init(docs: any DocStore) { self.docs = docs }

    static func label(_ days: Int) -> String {
        switch days {
        case 0: "None"
        case 1: "1 day"
        default: "\(days) days"
        }
    }

    func load() async {
        if let settings = try? await docs.settings() { days = settings.shredHoldDays }
        loaded = true
    }

    func choose(_ value: Int) async {
        let previous = days
        days = value
        saveFailed = false
        do {
            var settings = (try? await docs.settings()) ?? AppSettings()
            settings.shredHoldDays = value
            try await docs.saveSettings(settings)
        } catch {
            days = previous
            saveFailed = true
        }
    }
}
