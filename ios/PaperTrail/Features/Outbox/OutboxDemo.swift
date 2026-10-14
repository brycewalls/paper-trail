// Owner: outbox. Simulator test seam, sample mode only: `-PTSample -PTOutboxDemo <state>` fills
// the pipeline with made-up outbox items so every accessory state and the A4 screen can be
// screenshotted without Drive. States: uploading, attention, offline, reconnect, caughtup, empty.
import Foundation
import SwiftData

enum OutboxDemo {
    static var requested: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-PTOutboxDemo"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// `-PTOutboxOpen` opens the Outbox screen at launch, so it can be screenshotted without a tap.
    static var opensScreen: Bool {
        let args = ProcessInfo.processInfo.arguments
        return args.contains("-PTSample") && args.contains("-PTOutboxOpen")
    }

    private static var seeded = false

    /// Seeds the requested state, then says whether to open the Outbox screen. The short pause
    /// lets the window finish its first layout so the sheet isn't dropped.
    static func prepare(env: AppEnvironment) async -> Bool {
        guard env.isSample, requested != nil || opensScreen else { return false }
        await seedIfRequested(env: env)
        guard opensScreen else { return false }
        try? await Task.sleep(for: .seconds(1))
        return true
    }

    static func seedIfRequested(env: AppEnvironment) async {
        guard env.isSample, !seeded, let state = requested else { return }
        seeded = true
        let context = env.modelContainer.mainContext
        let now = Date.now
        let cards = SampleData.cards
        func add(_ title: String, _ issuer: String, stage: PipelineStage, decision: PipelineDecision = .file,
                 minutesAgo: Double, pages: Int = 1, sent: Double = 0, retryIn: Double? = nil, error: String? = nil) {
            let pdf = FakeCaptureService.pdf(fromTexts: [title + "\n" + issuer])
            let id = UUID()
            let name = (try? env.files.write(pdf, id: id, ext: "pdf")) ?? "items/\(id.uuidString).pdf"
            let item = PipelineItem(id: id, fileName: name, pageCount: pages, sizeBytes: 2_400_000, origin: "scan", stage: stage)
            var card = cards[0]
            card.title = title
            card.issuer = issuer
            item.card = card
            item.decision = decision
            item.decidedAt = now.addingTimeInterval(-minutesAgo * 60)
            item.bytesSent = Int(2_400_000 * sent)
            if stage == .verified || (stage == .filed && decision == .shredOnly) {
                item.filedAt = item.decidedAt?.addingTimeInterval(20)
                item.verifiedAt = decision == .file ? item.filedAt : nil
                item.driveURL = "https://drive.google.com/"
            }
            if stage == .failed {
                item.failedStageRaw = PipelineStage.uploading.rawValue
                item.errorMessage = error ?? OutboxCopy.retriesUsedUp
                item.nextRetryAt = retryIn.map { now.addingTimeInterval($0 * 60) }
                item.attempts = retryIn == nil ? 5 : 2
            }
            context.insert(item)
        }

        switch state {
        case "uploading", "attention", "offline", "reconnect":
            if state == "attention" {
                add("1099-INT", "Harbor Federal CU", stage: .failed, minutesAgo: 9, retryIn: 1.6)
            }
            add("Electric bill", "Cascade Power & Light", stage: .uploading, minutesAgo: 6, sent: 0.62)
            add("2025 W-2", "Northwind Logistics", stage: .queued, minutesAgo: 5)
            add("Car insurance card", "Summit Mutual", stage: .queued, minutesAgo: 4)
            add("Pharmacy receipt", "Elm Street Pharmacy", stage: .verified, minutesAgo: 8)
            add("Vehicle title", "NC DMV", stage: .verified, minutesAgo: 9, pages: 2)
            if state == "attention" {
                add("Brightline Wireless bill", "Brightline Wireless", stage: .verified, minutesAgo: 10, pages: 3)
            }
            if state == "offline", let fake = env.outbox as? FakeOutboxService { fake.status.isOnline = false }
            if state == "reconnect", let fake = env.outbox as? FakeOutboxService { fake.status.needsReconnect = true }
        case "retryused":
            add("1099-INT", "Harbor Federal CU", stage: .failed, minutesAgo: 30)
            add("Pharmacy receipt", "Elm Street Pharmacy", stage: .verified, minutesAgo: 40)
        case "caughtup":
            for (i, title) in ["Pharmacy receipt", "Vehicle title", "Brightline Wireless bill"].enumerated() {
                add(title, ["Elm Street Pharmacy", "NC DMV", "Brightline Wireless"][i], stage: .verified, minutesAgo: Double(10 + i * 3), pages: i + 1)
            }
            add("Furniture sale flyer", "Big Box Furniture", stage: .filed, decision: .shredOnly, minutesAgo: 20)
            add("Gym flyer", "Peak Fitness", stage: .verified, minutesAgo: 60 * 30)
        default:
            break
        }
        try? context.save()
    }
}
