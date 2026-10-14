// Paperless ledger (A7, #23): still mailing flags, sections, status changes and dates.
import Foundation
import Testing
@testable import PaperTrail

@MainActor
struct PaperlessTests {
    let now = PileFormat.date(iso: "2026-10-13T12:00:00.000Z")!

    func iso(daysAgo: Double) -> String { PileFormat.iso(now.addingTimeInterval(-daysAgo * 86_400)) }

    func doc(issuer: String, type: String = "Bill", docDate: String = "2026-10-09", filedDaysAgo: Double, possible: Bool = true) -> FiledDoc {
        var d = SampleData.filedDocs()[0]
        d.id = "\(issuer)-\(filedDaysAgo)"
        d.issuer = issuer
        d.docType = type
        d.docDate = docDate
        d.filedAt = iso(daysAgo: filedDaysAgo)
        d.paperless = PaperlessHint(possible: possible, issuer: issuer, how: "Billing settings.")
        return d
    }

    func sender(_ issuer: String, _ status: PaperlessStatus, requestedDaysAgo: Double? = nil, handledDaysAgo: Double? = nil,
                checkBackInDays: Double? = nil) -> PaperlessSender {
        PaperlessSender(id: slug(issuer), issuer: issuer, how: "How.", status: status, firstSeen: iso(daysAgo: 90),
                        requestedAt: requestedDaysAgo.map { iso(daysAgo: $0) },
                        checkBackAt: checkBackInDays.map { PileFormat.iso(now.addingTimeInterval($0 * 86_400)) },
                        mailHandledAt: handledDaysAgo.map { iso(daysAgo: $0) })
    }

    func model(senders: [PaperlessSender], docs: [FiledDoc]) async -> (PaperlessViewModel, FakeDocStore) {
        let store = FakeDocStore(seed: docs, paperless: senders)
        let model = PaperlessViewModel(docs: store)
        model.now = { now }
        let task = Task { await model.watch() }
        await pilesWaitUntil { model.loaded }
        task.cancel()
        return (model, store)
    }

    @Test func paperAfterARequestRaisesTheFlag() {
        let requested = sender("Cascade Power & Light", .requested, requestedDaysAgo: 20)
        let newBill = doc(issuer: "Cascade Power & Light", filedDaysAgo: 4)
        let oldBill = doc(issuer: "Cascade Power & Light", filedDaysAgo: 30)
        let flag = PaperlessRules.flag(requested, docs: [oldBill, newBill])
        #expect(flag?.doc?.id == newBill.id)
        #expect(PaperlessRules.bannerText(flag!, now: now) == "Cascade Power & Light sent a paper bill on Oct 9, after you requested paperless.")
        // Only old paper: no flag. To do senders are never flagged.
        #expect(PaperlessRules.flag(requested, docs: [oldBill]) == nil)
        #expect(PaperlessRules.flag(sender("Cascade Power & Light", .toDo), docs: [newBill]) == nil)
    }

    @Test func waitACycleHandlesTheFlag() async {
        let store = FakeDocStore(seed: [doc(issuer: "Cascade Power & Light", filedDaysAgo: 4)],
                                 paperless: [sender("Cascade Power & Light", .requested, requestedDaysAgo: 20)])
        let model = PaperlessViewModel(docs: store)
        model.now = { now }
        let watching = Task { await model.watch() }
        defer { watching.cancel() }
        await pilesWaitUntil { model.loaded }
        #expect(model.flags.count == 1)
        await model.waitACycle(model.flags[0].sender)
        await pilesWaitUntil { model.senders.first?.status == .waitingCycle }
        #expect(model.flags.isEmpty)
        let fields = store.writes.last!.fields
        #expect(fields["status"] as? String == "waiting_cycle")
        #expect(fields["checkBackAt"] as? String == PileFormat.iso(now.addingTimeInterval(35 * 86_400)))
        #expect(fields["mailHandledAt"] as? String == PileFormat.iso(now))
    }

    @Test func acronymsKeepTheirCase() {
        #expect(PaperlessRules.lowercasedType("Utility bill") == "utility bill")
        #expect(PaperlessRules.lowercasedType("EOB") == "EOB")
    }

    @Test func atMostTwoBannersThenAMoreRow() async {
        let names = ["A Co", "B Co", "C Co", "D Co"]
        let (model, _) = await model(
            senders: names.map { sender($0, .confirmed, requestedDaysAgo: 30) },
            docs: names.enumerated().map { doc(issuer: $1, filedDaysAgo: Double($0 + 1)) })
        #expect(model.flags.map(\.sender.issuer) == ["A Co", "B Co", "C Co", "D Co"])
        #expect(model.visibleFlags.count == 2)
        #expect(model.moreFlagsText == "2 more senders are still mailing")
    }

    @Test func sectionsAndSubtitle() async {
        let (model, _) = await model(senders: [
            sender("Summit Health Plan", .waitingCycle, checkBackInDays: 15),
            sender("Cascade Power & Light", .requested, requestedDaysAgo: 2, checkBackInDays: 33),
            sender("Brightline Wireless", .toDo),
            sender("Harbor Federal", .confirmed),
            sender("Northwind", .confirmed),
            sender("DMV", .cantStop),
        ], docs: [])
        #expect(model.subtitle == "2 of 5 senders confirmed")
        #expect(model.checkBackSoon.map(\.issuer) == ["Summit Health Plan", "Cascade Power & Light"])
        #expect(model.checkBackText(model.checkBackSoon[0]) == "Check back Oct 28")
        #expect(model.toDo.map(\.issuer) == ["Brightline Wireless"])
        #expect(model.doneGroup?.title == "Harbor Federal, Northwind")
        #expect(model.doneGroup?.subtitle == "1 more can't stop (DMV)")
    }

    @Test func iRequestedItSetsACheckBackDate() async {
        let (model, store) = await model(senders: [sender("Brightline Wireless", .toDo)], docs: [])
        await model.markRequested(model.toDo[0])
        let fields = store.writes.last!.fields
        #expect(fields["status"] as? String == "requested")
        #expect(fields["requestedAt"] as? String == PileFormat.iso(now))
        #expect(fields["checkBackAt"] as? String == PileFormat.iso(now.addingTimeInterval(35 * 86_400)))
        await model.confirm(model.senders[0])
        #expect(store.writes.last!.fields["status"] as? String == "done")
        await model.setStatus(model.senders[0], to: .cantStop)
        #expect(store.writes.last!.fields["status"] as? String == "skip")
    }

    @Test func firstStepFallsBackToHow() {
        var s = sender("X", .toDo)
        let model = PaperlessViewModel(docs: FakeDocStore(seed: [], paperless: []))
        #expect(model.firstStep(s) == "How.")
        s.steps = ["Account settings, then Billing, then Paper bill off", "Confirm"]
        #expect(model.firstStep(s) == "Account settings, then Billing, then Paper bill off")
        #expect(model.steps(s).count == 2)
    }

    @Test func stillMailingAtAloneRaisesTheFlag() {
        // The outbox sets stillMailingAt when a doc arrives from a watched sender; the doc itself
        // may not be in the listener yet.
        var s = sender("Harbor Federal", .confirmed)
        s.doneAt = iso(daysAgo: 40)
        s.stillMailingAt = iso(daysAgo: 1)
        let flag = PaperlessRules.flag(s, docs: [])
        #expect(flag != nil)
        #expect(PaperlessRules.bannerText(flag!, now: now) == "Harbor Federal sent paper mail on Oct 12, after you requested paperless.")
    }

    @Test func theLedgerNeverCreatesSenders() async {
        let (model, store) = await model(senders: [], docs: [doc(issuer: "Duke Energy", filedDaysAgo: 3)])
        #expect(model.senders.isEmpty)
        #expect(store.writes.isEmpty)
    }

    @Test func seenTextUsesFirstAndLastScan() async {
        let (model, _) = await model(senders: [sender("Duke Energy", .toDo)], docs: [
            doc(issuer: "Duke Energy", filedDaysAgo: 4),
        ])
        let text = model.seenText(model.senders[0])
        #expect(text.hasPrefix("First scan "))
        #expect(text.contains(" · Last scan Oct 9"))
    }
}
