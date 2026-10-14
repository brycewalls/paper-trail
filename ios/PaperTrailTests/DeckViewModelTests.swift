// The Sort deck's behavior (#20, #33; docs/design-spec.md 3.1 to 3.8, 4.13, 4.14, section 5).
// Every gesture, button, menu item and VoiceOver action calls these view model methods.
import Foundation
import Testing
@testable import PaperTrail

@MainActor
struct DeckViewModelTests {
    /// Released decisions hand off to the outbox in a task that can outlive a test. Keeping each
    /// sample environment (and its in-memory SwiftData container) alive stops that task from
    /// touching a model whose container was already torn down. The app's container lives forever.
    private static var keepAlive: [AppEnvironment] = []

    /// A sample deck: Duke Energy (confident), Blue Cross (date and verdict unsure),
    /// Honda title (Keep original, confident), furniture flyer (Shred, confident).
    private func makeDeck() async -> (DeckViewModel, AppEnvironment) {
        let env = AppEnvironment.sample()
        Self.keepAlive.append(env)
        let deck = DeckViewModel(env: env)
        await deck.loadSample()
        return (deck, env)
    }

    private func card(_ deck: DeckViewModel, _ issuer: String) throws -> PipelineItem {
        try #require(deck.cards.first { $0.card?.issuer == issuer })
    }

    private func outbox(_ env: AppEnvironment) throws -> FakeOutboxService {
        try #require(env.outbox as? FakeOutboxService)
    }

    // MARK: Undo hold (Bryce's decision 4)

    @Test func latestDecisionIsHeldUntilTheNextOne() async throws {
        let (deck, env) = await makeDeck()
        let duke = try card(deck, "Duke Energy")
        #expect(deck.file(duke) == .decided)
        #expect(!deck.cards.contains { $0.id == duke.id })
        #expect(try outbox(env).enqueued.isEmpty)
        #expect(duke.stage == .ready && duke.decision == nil)
        #expect(deck.canUndo)
        #expect(deck.filedToday == 1) // the held decision already counts for "All sorted"

        let flyer = try card(deck, "Big Box Furniture")
        #expect(deck.shred(flyer) == .decided)
        await deck.flush()
        #expect(try outbox(env).enqueued == [duke.id, flyer.id])
        #expect(duke.decision == .file && flyer.decision == .shredOnly)
    }

    @Test func undoInsideTheHoldPutsTheCardBackWithNothingToReverse() async throws {
        let (deck, env) = await makeDeck()
        let duke = try card(deck, "Duke Energy")
        let count = deck.cards.count
        deck.file(duke)
        #expect(await deck.undo() == .file)
        #expect(deck.cards.count == count)
        #expect(deck.top?.id == duke.id)
        #expect(duke.stage == .ready && duke.decision == nil && duke.decidedAt == nil)
        #expect(try outbox(env).enqueued.isEmpty)
        #expect(try outbox(env).sentBack.isEmpty)
        #expect(!deck.canUndo)
    }

    @Test func theHoldEndsOnItsOwnAfterTheWindow() async throws {
        let (deck, env) = await makeDeck()
        deck.holdDuration = .milliseconds(50)
        let duke = try card(deck, "Duke Energy")
        deck.file(duke)
        try await Task.sleep(for: .milliseconds(600))
        #expect(try outbox(env).enqueued == [duke.id])
        #expect(duke.stage == .verified)
    }

    @Test func undoAfterReleaseAsksTheOutboxToSendItBack() async throws {
        let (deck, env) = await makeDeck()
        let duke = try card(deck, "Duke Energy")
        deck.file(duke)
        await deck.flush()
        #expect(duke.stage == .verified)
        #expect(await deck.undo() == .file)
        #expect(try outbox(env).sentBack == [duke.id])
        #expect(duke.stage == .ready && duke.decision == nil && duke.driveFileID == nil)
        #expect(deck.cards.contains { $0.id == duke.id })
    }

    @Test func undoIsOneStepOnly() async throws {
        let (deck, _) = await makeDeck()
        deck.file(try card(deck, "Duke Energy"))
        deck.shred(try card(deck, "Big Box Furniture"))
        #expect(await deck.undo() == .shred)
        #expect(await deck.undo() == nil)
    }

    // MARK: Keep original (4.14)

    @Test func shreddingAKeepOriginalAlwaysAsksFirst() async throws {
        let (deck, env) = await makeDeck()
        let title = try card(deck, "NC DMV")
        #expect(deck.shred(title) == .needsKeepConfirm)
        #expect(deck.keepConfirm?.id == title.id)
        #expect(deck.cards.contains { $0.id == title.id })
        #expect(!deck.canUndo)

        deck.cancelKeepOriginalShred()
        #expect(deck.keepConfirm == nil)
        #expect(deck.cards.contains { $0.id == title.id })

        #expect(deck.shred(title) == .needsKeepConfirm)
        #expect(deck.confirmKeepOriginalShred() == .decided)
        #expect(!deck.cards.contains { $0.id == title.id })
        await deck.flush()
        #expect(title.decision == .shredOnly)
        #expect(try outbox(env).enqueued == [title.id])
    }

    @Test func filingAKeepOriginalNeedsNoConfirm() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.file(try card(deck, "NC DMV")) == .decided)
    }

    // MARK: Unsure fields and the check-fields sheet (3.8)

    @Test func unsureFieldsComeFromTheClassifyDataInSpecOrder() async throws {
        let (deck, _) = await makeDeck()
        let eob = try card(deck, "Blue Cross")
        #expect(deck.unsureFields(eob) == [.docDate, .verdict])
        #expect(deck.isConfident(eob) == false)
        #expect(deck.unsureFields(try card(deck, "Duke Energy")).isEmpty)
    }

    @Test func fileOnAnUnsureCardOpensTheSheetInstead() async throws {
        let (deck, env) = await makeDeck()
        let eob = try card(deck, "Blue Cross")
        #expect(deck.file(eob) == .needsCheck)
        #expect(deck.checking?.id == eob.id)
        #expect(deck.cards.contains { $0.id == eob.id })
        #expect(!deck.canUndo)
        await deck.flush()
        #expect(try outbox(env).enqueued.isEmpty)
    }

    @Test func shredOnAnUnsureCardSkipsTheSheet() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.shred(try card(deck, "Blue Cross")) == .decided)
        #expect(deck.checking == nil)
    }

    @Test func confirmAndFileWritesTheValuesSavesTheRuleAndFiles() async throws {
        let (deck, env) = await makeDeck()
        let eob = try card(deck, "Blue Cross")
        deck.openCheck(eob, at: .verdict)
        #expect(deck.checkFocus == .verdict)
        let outcome = await deck.confirmCheck(eob, values: [.docDate: "2024-01-09", .verdict: "keep_original"], remember: true)
        #expect(outcome == .decided)
        #expect(deck.checking == nil)
        #expect(eob.card?.docDate == "2024-01-09")
        #expect(eob.card?.verdict == .keepOriginal)
        #expect(eob.card?.confidence?.fields["verdict"] == 1)
        #expect(deck.unsureFields(eob).isEmpty)
        #expect(!deck.cards.contains { $0.id == eob.id })

        let rules = try await env.docs.senderRules()
        let rule = try #require(rules.first { $0.key == "blue-cross" })
        #expect(rule.verdict == .keepOriginal)
        #expect(rule.folder == "05 Medical")
        // The filename's date prefix follows the confirmed date, so the rule keeps the token.
        #expect(eob.card?.filename == "2024-01-09_blue-cross-eob")
        #expect(rule.filenamePattern == "{date}_blue-cross-eob")
    }

    @Test func confirmWithoutRememberSavesNoRule() async throws {
        let (deck, env) = await makeDeck()
        let eob = try card(deck, "Blue Cross")
        _ = await deck.confirmCheck(eob, values: [:], remember: false)
        #expect(try await env.docs.senderRules().isEmpty)
    }

    @Test func aCardWithoutConfidenceIsNeverReadyToFile() {
        var card = SampleData.cards[0]
        card.confidence = nil
        #expect(CheckFieldsData.fromConfidence(card).fields.isEmpty)
        #expect(card.isConfident == false)
    }

    // MARK: Bulk filing (decision 5, off by default)

    @Test func bulkPromptIsOffUnlessTheSettingIsOn() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.bulkPromptTitle(enabled: false) == nil)
        #expect(UserDefaults.standard.object(forKey: DeckSettings.offerBulkFileKey) == nil
                || UserDefaults.standard.bool(forKey: DeckSettings.offerBulkFileKey) == false)
    }

    @Test func bulkPromptCountsTheOtherConfidentCards() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.top?.card?.issuer == "Duke Energy")
        #expect(deck.bulkCandidates.compactMap(\.card?.issuer) == ["NC DMV", "Big Box Furniture"])
        #expect(deck.bulkPromptTitle(enabled: true) == "File the other 2 confident cards")
    }

    @Test func bulkPromptNeedsTwoCards() async throws {
        let (deck, _) = await makeDeck()
        deck.file(try card(deck, "NC DMV"))
        #expect(deck.bulkPromptTitle(enabled: true) == nil)
    }

    @Test func bulkPromptWordingWhenTheTopCardIsUnsure() async throws {
        let (deck, _) = await makeDeck()
        deck.later(try card(deck, "Duke Energy"))
        #expect(deck.top?.card?.issuer == "Blue Cross")
        #expect(deck.bulkPromptTitle(enabled: true) == "File the 3 confident cards")
    }

    @Test func bulkFileIsOneUndoStep() async throws {
        let (deck, env) = await makeDeck()
        let chosen = deck.bulkCandidates
        #expect(deck.fileTogether(chosen) == .decided)
        #expect(deck.cards.count == 2)
        #expect(await deck.undo() == .file)
        #expect(deck.cards.count == 4)
        #expect(try outbox(env).enqueued.isEmpty)
    }

    @Test func bulkFileSkipsCardsThatAreNotConfident() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.fileTogether([try card(deck, "Blue Cross")]) == .unavailable)
    }

    // MARK: Later, subtitle, read failures

    @Test func laterMovesTheCardToTheBack() async throws {
        let (deck, _) = await makeDeck()
        let top = try #require(deck.top)
        deck.later(top)
        #expect(deck.cards.last?.id == top.id)
        #expect(deck.cards.count == 4)
    }

    @Test func subtitleCountsCardsAndConfidentOnes() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.subtitle == "4 to go · 3 ready to file")
        #expect(deck.confidentCount == 3)
    }

    @Test func subtitleOnAnEmptyDeckOnlyCountsWhatIsReading() async throws {
        let env = AppEnvironment.sample()
        Self.keepAlive.append(env)
        let deck = DeckViewModel(env: env)
        deck.refresh()
        #expect(deck.subtitle == "")
        let docs = try await env.capture.sampleDocuments()
        _ = CaptureIntake.add(docs, to: env.modelContainer.mainContext)
        deck.refresh()
        #expect(deck.cards.isEmpty)
        #expect(deck.subtitle == "\(docs.count) reading")
    }

    @Test func aCardThatFailedToReadCanOnlyBeShredded() async throws {
        let env = AppEnvironment.sample()
        Self.keepAlive.append(env)
        let classify = try #require(env.classify as? FakeClassifyService)
        classify.failure = .overloaded
        classify.delay = .zero
        let deck = DeckViewModel(env: env)
        await deck.loadSample()
        #expect(deck.cards.count == 4)
        let failed = try #require(deck.top)
        #expect(deck.isReadFailed(failed))
        #expect(deck.file(failed) == .unavailable)
        #expect(deck.accessibilityLabel(for: failed).hasPrefix("Couldn't read this one."))
        #expect(deck.shred(failed) == .decided)
        #expect(await deck.undo() == .shred)
        #expect(failed.stage == .failed && failed.failedStageRaw == PipelineStage.reading.rawValue)

        classify.failure = nil
        await deck.retryRead(failed)
        #expect(failed.stage == .ready)
        #expect(failed.card != nil)
    }

    @Test func fillItInYourselfPutsAFailedCardOnTheDeck() async throws {
        let env = AppEnvironment.sample()
        Self.keepAlive.append(env)
        (env.classify as? FakeClassifyService)?.failure = .refused
        let deck = DeckViewModel(env: env)
        await deck.loadSample()
        let failed = try #require(deck.top)
        var card = deck.blankCard(for: failed)
        #expect(card.folder == "11 Other")
        card.title = "Lease renewal"
        card.issuer = "Oak Street Properties"
        card.filename = "2026-10-01_oak-street-lease"
        await deck.saveEdits(failed, card: card, remember: false)
        #expect(failed.stage == .ready)
        #expect(deck.isReadFailed(failed) == false)
        #expect(deck.file(failed) == .decided)
    }

    // MARK: Card detail edits (4.13)

    @Test func editsCountAsConfidentAndCanRememberTheSender() async throws {
        let (deck, env) = await makeDeck()
        let eob = try card(deck, "Blue Cross")
        var edited = try #require(eob.card)
        edited.verdict = .shred
        #expect(deck.filingChanged(from: eob.card, to: edited))
        await deck.saveEdits(eob, card: edited, remember: true)
        #expect(deck.unsureFields(eob) == [.docDate])
        #expect(try await env.docs.senderRules().first?.verdict == .shred)
        #expect(deck.cards.contains { $0.id == eob.id })
    }

    @Test func editingTheDateMovesTheFilenamePrefixUnlessTheFilenameWasEdited() async throws {
        let (deck, _) = await makeDeck()
        let duke = try card(deck, "Duke Energy")
        var edited = try #require(duke.card)
        edited.docDate = "2024-03-15"
        await deck.saveEdits(duke, card: edited, remember: false)
        #expect(duke.card?.filename == "2024-03-15_duke-energy-electric-bill")

        var renamed = try #require(duke.card)
        renamed.docDate = "2024-03-20"
        renamed.filename = "duke-march"
        await deck.saveEdits(duke, card: renamed, remember: false)
        #expect(duke.card?.filename == "duke-march")
    }

    @Test func lateUndoLeavesACardTheOutboxCouldNotSendBack() async throws {
        let (deck, env) = await makeDeck()
        let outbox = try outbox(env)
        let duke = try card(deck, "Duke Energy")
        deck.file(duke)
        await deck.flush()
        outbox.refuseSendBack = true
        #expect(await deck.undo() == .file)
        #expect(!deck.cards.contains { $0.id == duke.id })
        #expect(duke.decision == .file)
    }

    // MARK: Copy

    @Test func voiceOverLabelListsTheFieldsToCheck() async throws {
        let (deck, _) = await makeDeck()
        let label = deck.accessibilityLabel(for: try card(deck, "Blue Cross"))
        #expect(label.hasPrefix("Blue Cross EOB, January 2024. Blue Cross, "))
        #expect(label.contains("Scan + shred. Folder Medical. Sensitive. Keep 3 years."))
        #expect(label.hasSuffix("2 fields to check: claim date, verdict."))
    }

    @Test func announcementsAfterADecision() async throws {
        let (deck, _) = await makeDeck()
        #expect(deck.announcement(after: .file, title: "X") == "Filed X. Next: Duke Energy bill, March 2024.")
        #expect(deck.announcement(after: .shred, title: "X") == "Shredded X.")
    }

    @Test func formatting() {
        var card = SampleData.cards[0]
        #expect(DeckFormat.folderName("02 Taxes") == "Taxes")
        #expect(DeckFormat.folderPath(card) == "Home")
        card.folder = "02 Taxes"
        card.docDate = "2025-01-30"
        #expect(DeckFormat.folderPath(card) == "Taxes › 2025")
        card.docDate = ""
        let year = Calendar(identifier: .gregorian).component(.year, from: .now)
        #expect(DeckFormat.folderPath(card) == "Taxes › \(year)")
        #expect(DeckFormat.meta(card) == "Duke Energy · No date")
        #expect(DeckFormat.pages(1) == "1 page")
        #expect(DeckFormat.pages(3) == "3 pages")
        #expect(DeckFormat.checkTitle(1) == "Check 1 field")
        #expect(DeckFormat.checkTitle(2) == "Check 2 fields")
        #expect(DeckFormat.fieldName(.docDate, docType: "Utility bill") == "Statement date")
        #expect(DeckFormat.fieldName(.issuer, docType: "") == "Sender")
        #expect(StatusPill.text(for: .waiting(daysLeft: 1)) == "1 day")
        #expect(StatusPill.text(for: .waiting(daysLeft: 0)) == "Today")
        #expect(StatusPill.text(for: .paperless(.cantStop)) == "Can't stop")
    }
}
