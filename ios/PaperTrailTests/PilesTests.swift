// Piles (A5): the safe-to-shred rule with the hold (#18), Mark as shredded, Put away, All filed.
import Foundation
import Testing
@testable import PaperTrail

@MainActor
struct PilesTests {
    let now = PileFormat.date(iso: "2026-10-13T12:00:00.000Z")!

    func doc(_ id: String, physical: PhysicalState = .toShred, verifiedDaysAgo: Double? = 5, source: String? = "ios",
             filed: Bool = true, sensitive: Bool = false, filedAt: String = "2026-10-01T12:00:00.000Z") -> FiledDoc {
        var d = SampleData.filedDocs()[0]
        d.id = id
        d.title = "Doc \(id)"
        d.physical = physical
        d.source = source
        d.filed = filed
        d.sensitive = sensitive
        d.filedAt = filedAt
        d.verifiedAt = verifiedDaysAgo.map { PileFormat.iso(now.addingTimeInterval(-$0 * 86_400)) }
        return d
    }

    func model(_ docs: [FiledDoc], hold: Int) async -> (PilesViewModel, FakeDocStore) {
        let store = FakeDocStore(seed: docs, paperless: [], settings: AppSettings(shredHoldDays: hold))
        let model = PilesViewModel(docs: store)
        model.now = { now }
        let task = Task { await model.watch() }
        await pilesWaitUntil { model.loaded && model.holdDays == hold }
        task.cancel()
        return (model, store)
    }

    @Test func safeNeedsVerificationAndTheHold() {
        let verifiedLongAgo = doc("a", verifiedDaysAgo: 5)
        let verifiedYesterday = doc("b", verifiedDaysAgo: 1)
        let unverified = doc("c", verifiedDaysAgo: nil)
        let web = doc("d", verifiedDaysAgo: nil, source: nil)
        let shredOnly = doc("e", verifiedDaysAgo: nil, filed: false)

        #expect(PileRules.shredState(verifiedLongAgo, holdDays: 3, now: now) == .safe)
        if case .holding(let until)? = PileRules.shredState(verifiedYesterday, holdDays: 3, now: now) {
            #expect(PileFormat.daysUntil(until, now: now) == 2)
        } else {
            Issue.record("expected the hold")
        }
        #expect(PileRules.shredState(unverified, holdDays: 3, now: now) == .checking)
        #expect(PileRules.shredState(web, holdDays: 3, now: now) == .safe)
        #expect(PileRules.shredState(shredOnly, holdDays: 3, now: now) == .safe)
        #expect(PileRules.shredState(verifiedYesterday, holdDays: 0, now: now) == .safe)
        #expect(PileRules.shredState(doc("f", physical: .keep), holdDays: 0, now: now) == nil)
    }

    @Test func bannerAndPillsCopy() async {
        let (model, _) = await model([doc("a"), doc("b"), doc("c", verifiedDaysAgo: 1), doc("d", verifiedDaysAgo: nil)], hold: 3)
        #expect(model.safe.map(\.id) == ["a", "b"])
        #expect(model.waiting.map(\.id) == ["c", "d"])
        #expect(model.safeBanner?.bold == "2 are safe to shred.")
        #expect(model.safeBanner?.rest == "The Drive copy is confirmed and the 3-day hold is over.")
        #expect(model.markTitle == "Mark 2 as shredded")
        #expect(model.waitingPill(model.waiting[0]) == "2 days")
        #expect(model.waitingSubtitle(model.waiting[0]).hasPrefix("Drive copy confirmed · hold ends "))
        #expect(model.waitingPill(model.waiting[1]) == "Checking")
        #expect(model.waitingSubtitle(model.waiting[1]) == "Checking the Drive copy")
        // The shared StatusPill (#49) draws the same text from the day count.
        #expect(model.waitingDaysLeft(model.waiting[0]) == 2)
        #expect(model.waitingDaysLeft(model.waiting[1]) == nil)
        #expect(StatusPill.text(for: .waiting(daysLeft: 2)) == model.waitingPill(model.waiting[0]))
        #expect(StatusPill.text(for: .checking) == model.waitingPill(model.waiting[1]))
        #expect(StatusPill.text(for: .waiting(daysLeft: 1)) == "1 day")
        #expect(StatusPill.text(for: .waiting(daysLeft: 0)) == "Today")
    }

    @Test func rowThumbnailLabels() {
        var d = doc("a")
        d.title = "2025 W-2, Northwind Logistics"
        #expect(d.thumbnailLabel == "W-2\n2025")
        d.title = "2024 1099-INT"
        #expect(d.thumbnailLabel == "1099-INT\n2024")
        d.title = "Pharmacy receipt"
        #expect(d.thumbnailLabel == "")
    }

    @Test func bannerWithoutAHold() async {
        let (model, _) = await model([doc("a")], hold: 0)
        #expect(model.safeBanner?.bold == "1 is safe to shred.")
        #expect(model.safeBanner?.rest == "The Drive copy is confirmed.")
    }

    @Test func markAsShreddedSkipsWaitingDocs() async throws {
        let (model, store) = await model([doc("a"), doc("b", verifiedDaysAgo: 1), doc("c", verifiedDaysAgo: nil)], hold: 3)
        await model.markSafeShredded()
        #expect(store.writes.map(\.path) == ["docs/a"])
        #expect(store.writes.first?.fields["physical"] as? String == "shredded")
        #expect(store.writes.first?.fields["shreddedAt"] as? String == PileFormat.iso(now))
        // The swipe on a single row does nothing for a doc that isn't safe.
        await model.markShredded(doc("b", verifiedDaysAgo: 1))
        #expect(store.writes.count == 1)
    }

    @Test func safeListShowsThreeThenMore() async {
        let (model, _) = await model((1...5).map { doc("s\($0)") }, hold: 0)
        #expect(model.visibleSafe.count == 3)
        #expect(model.hiddenSafeCount == 2)
        model.showAllSafe = true
        #expect(model.visibleSafe.count == 5)
        #expect(model.hiddenSafeCount == 0)
    }

    @Test func putAwayAndTakeOut() async {
        let (model, store) = await model([doc("k", physical: .keep), doc("s", physical: .stored)], hold: 0)
        #expect(model.toPutAway.map(\.id) == ["k"])
        #expect(model.inBinder.map(\.id) == ["s"])
        await model.putAway(model.toPutAway[0])
        await model.takeOut(doc("s", physical: .stored))
        #expect(store.writes.map(\.path) == ["docs/k", "docs/s"])
        #expect(store.writes.map { $0.fields["physical"] as? String } == ["stored", "keep"])
    }

    @Test func allFiledGroupsByMonthNewestFirst() async {
        let (model, _) = await model([
            doc("sep", physical: .shredded, filedAt: "2026-09-20T12:00:00.000Z"),
            doc("oct2", physical: .keep, sensitive: true, filedAt: "2026-10-09T12:00:00.000Z"),
            doc("oct1", filedAt: "2026-10-02T12:00:00.000Z"),
            doc("logged", filed: false, filedAt: "2026-10-10T12:00:00.000Z"),
        ], hold: 0)
        #expect(model.filedCount == 3)
        #expect(model.filedByMonth.map { $0.docs.map(\.id) } == [["oct2", "oct1"], ["sep"]])
        #expect(model.filedByMonth.first?.title == PileFormat.monthTitle(PileFormat.date(iso: "2026-10-09T12:00:00.000Z")!))
        model.allFilter = .sensitive
        #expect(model.filed.map(\.id) == ["oct2"])
    }

    @Test func holdFollowsTheSettingLive() async throws {
        let (model, store) = await model([doc("a", verifiedDaysAgo: 2)], hold: 0)
        let watching = Task { await model.watch() }
        defer { watching.cancel() }
        await pilesWaitUntil { model.loaded }
        #expect(model.safe.map(\.id) == ["a"])
        try await store.saveSettings(AppSettings(shredHoldDays: 3))
        await pilesWaitUntil { model.holdDays == 3 }
        #expect(model.safe.isEmpty)
        #expect(model.waitingPill(model.waiting[0]) == "1 day")
    }

    @Test func aFailedWriteShowsAnError() async {
        let (model, store) = await model([doc("a")], hold: 0)
        store.failWrites = true
        await model.markSafeShredded()
        #expect(model.writeError == "That didn't save. Check your connection and try again.")
    }

    @Test func aFailedListenerShowsTheErrorState() {
        let store = FakeDocStore(seed: [])
        store.syncError = .listener("permission denied")
        let model = PilesViewModel(docs: store)
        #expect(model.loadFailed)
        #expect(PaperlessViewModel(docs: store).loadFailed)
        #expect(SearchViewModel(docs: store, drive: FakeDriveService()).loadFailed)
    }

    @Test func emptyPilesStayEmpty() async {
        let (model, _) = await model([], hold: 3)
        #expect(model.shredPile.isEmpty && model.keepCount == 0 && model.filedCount == 0)
        #expect(model.safeBanner == nil)
        #expect(!model.loadFailed)
    }

    @Test func folderNamesAndBreadcrumbs() {
        var d = doc("x")
        d.folder = "02 Taxes"
        d.docDate = "2025-01-31"
        #expect(PileFormat.breadcrumb(for: d) == "Taxes › 2025")
        d.folder = "06 Home"
        #expect(PileFormat.breadcrumb(for: d) == "Home")
        d.folder = "03 Money & Banking"
        d.docDate = ""
        d.filedAt = "2024-02-03T15:20:00.000Z"
        #expect(PileFormat.breadcrumb(for: d) == "Money & Banking › 2024")
    }
}

/// Polls until the condition holds (listeners deliver on the next main-actor turn).
@MainActor
func pilesWaitUntil(timeout: Duration = .seconds(2), _ condition: () -> Bool) async {
    let deadline = ContinuousClock.now + timeout
    while !condition() && ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(10))
    }
}
