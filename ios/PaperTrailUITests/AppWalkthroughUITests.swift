// Owner: qa. Taps through the whole app in sample mode the way Bryce would, and saves a screenshot
// at every stop (docs/design-spec.md sections 4.2 to 4.15). Each test launches fresh, so one
// broken screen doesn't hide the rest.
//
// The sample deck (SampleData.cards): Duke Energy bill (confident), Blue Cross EOB (date and
// verdict unsure), Honda Civic title (Keep original) and a furniture flyer (Shred). Tests read the
// top card's title instead of assuming the order.
import XCTest

final class AppWalkthroughUITests: PaperTrailUITestCase {

    // MARK: Sort: swipes, Undo, File (#44), Keep original, check fields, Outbox

    func testSortDeckOutboxAndRememberedSender() {
        launch()
        waitFor(card, 20, "The sample deck never showed a card")
        XCTAssertTrue(eventually { !self.topCardLabel.isEmpty })
        shot("01-sort-deck")

        var swipedRight = false, swipedLeft = false, undone = false
        var filedWithButton = false, keepConfirmed = false, checked = false

        for _ in 0..<8 {
            guard card.exists else { break }
            let label = topCardLabel
            if label.hasPrefix("Duke Energy") {
                if !swipedRight {
                    swipeCard(right: true)
                    XCTAssertTrue(eventually { !self.topCardLabel.hasPrefix("Duke Energy") }, "Swipe right didn't file the card")
                    swipedRight = true
                    shot("02-sort-after-swipe-right")
                    let undo = element("deck.undo")
                    XCTAssertTrue(undo.isEnabled, "Undo should be on after a swipe")
                    undo.tap()
                    XCTAssertTrue(eventually { self.topCardLabel.hasPrefix("Duke Energy") }, "Undo didn't bring the card back")
                    undone = true
                    pause(0.8)
                    shot("03-sort-after-undo")
                } else {
                    // #44: the File button under the card crashed in preview 0.
                    element("deck.file").tap()
                    XCTAssertTrue(eventually { !self.topCardLabel.hasPrefix("Duke Energy") }, "File button didn't file the card")
                    XCTAssertEqual(app.state, .runningForeground, "App went away after File (#44)")
                    filedWithButton = true
                    shot("04-sort-after-file-button")
                }
            } else if label.hasPrefix("Blue Cross") {
                // An unsure card: File opens the check-fields sheet instead (3.8, 4.3).
                element("deck.file").tap()
                let confirm = waitFor(element("checkFields.confirm"), 5, "File on an unsure card didn't open the check-fields sheet")
                pause(0.8)
                shot("05-check-fields-sheet")
                let remember = element("checkFields.remember")
                XCTAssertTrue(remember.exists, "No Remember for this sender toggle")
                XCTAssertEqual(remember.value as? String, "1", "Remember for this sender should start on")
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Next time, Blue Cross'")).firstMatch.exists,
                              "Missing the footer under Remember for this sender")
                if !confirm.isHittable { app.swipeUp() }
                confirm.tap()
                XCTAssertTrue(eventually { !self.element("checkFields.confirm").exists }, "Sheet didn't close after Confirm and file")
                XCTAssertTrue(eventually { !self.topCardLabel.hasPrefix("Blue Cross") }, "Confirm and file didn't file the card")
                checked = true
                shot("06-sort-after-check-fields")
            } else if label.hasPrefix("Honda Civic") {
                // A Keep original card: Shred always asks first (4.14).
                element("deck.shred").tap()
                let anyway = dialogButton("Shred anyway")
                waitFor(anyway, 5, "Shred on a Keep original didn't ask first")
                XCTAssertTrue(app.staticTexts["Shred a Keep original?"].exists, "Dialog title should read 'Shred a Keep original?'")
                shot("07-keep-original-confirm")
                anyway.tap()
                XCTAssertTrue(eventually { !self.topCardLabel.hasPrefix("Honda Civic") }, "Shred anyway didn't shred the card")
                keepConfirmed = true
            } else if label.hasPrefix("Furniture") {
                swipeCard(right: false)
                XCTAssertTrue(eventually { !self.topCardLabel.hasPrefix("Furniture") }, "Swipe left didn't shred the card")
                swipedLeft = true
                shot("08-sort-after-swipe-left")
            } else {
                XCTFail("Unexpected top card: \(label)")
                break
            }
            pause(0.6)
        }

        XCTAssertTrue(swipedRight && undone && filedWithButton && checked && keepConfirmed && swipedLeft,
                      "Didn't reach every deck action: right \(swipedRight) undo \(undone) file \(filedWithButton) check \(checked) keep \(keepConfirmed) left \(swipedLeft)")
        waitFor(app.staticTexts["All sorted"], 5, "The empty deck should read All sorted")
        shot("09-sort-all-sorted")

        // Outbox bar and screen (3.7, 4.4). Wait out the 10 second undo hold so every card is released.
        let accessory = waitFor(element("outbox.accessory"), 5, "No outbox bar above the tab bar")
        pause(11)
        shot("10-outbox-bar")
        XCTAssertTrue(eventually(5) { (accessory.value as? String)?.contains("filed today") == true },
                      "Outbox bar should say how many were filed today, got \(accessory.value ?? "nil")")
        accessory.tap()
        waitFor(app.navigationBars["Outbox"], 5, "Outbox screen didn't open")
        pause(1)
        shot("11-outbox-screen")
        XCTAssertTrue(app.staticTexts["FILED TODAY"].exists || app.staticTexts["Filed today"].exists, "Outbox should list Filed today")
        goBack()
        waitFor(app.navigationBars["Sort"], 5)

        // "Remember for this sender" saved a rule: it shows in Settings › Sender rules (4.12).
        element("avatar").tap()
        waitFor(element("settings.senderRules"), 5).tap()
        waitFor(app.navigationBars["Sender rules"], 5)
        XCTAssertTrue(eventually(5) { self.app.staticTexts["Blue Cross"].exists }, "Remember for this sender didn't save a Blue Cross rule")
        shot("12-sender-rules-after-remember")
    }

    // MARK: Piles: Mark shredded, Put away (4.5)

    func testPilesMarkShreddedAndPutAway() {
        launch()
        waitFor(tab("Piles")).tap()
        waitFor(app.navigationBars["Piles"])
        let mark = waitFor(element("piles.markShredded"), 10, "No Mark as shredded button on the Shred pile")
        pause(0.8)
        shot("20-piles-shred")
        let markTitle = mark.label
        XCTAssertTrue(markTitle.hasPrefix("Mark ") && markTitle.hasSuffix(" as shredded"), "Button reads \(markTitle)")
        mark.tap()
        let confirm = dialogButton(markTitle)
        waitFor(confirm, 5, "Mark as shredded didn't ask to confirm")
        shot("21-piles-mark-confirm")
        confirm.tap()
        XCTAssertTrue(eventually { !self.element("piles.markShredded").exists }, "Mark button should go once nothing is safe")
        shot("22-piles-after-mark")

        let segment = element("piles.segment")
        segment.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Keep'")).firstMatch.tap()
        let passport = waitFor(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Passport renewal receipt'")).firstMatch, 5)
        shot("23-piles-keep")
        passport.swipeLeft()
        waitFor(app.buttons["Put away"], 5, "No Put away swipe action").tap()
        // A row in the binder carries the archivebox, read as "Put away" (spec 3.10).
        XCTAssertTrue(eventually { passport.label.contains("Put away") }, "Passport should move to In the binder, got \(passport.label)")
        shot("24-piles-after-put-away")

        segment.buttons.matching(NSPredicate(format: "label BEGINSWITH 'All filed'")).firstMatch.tap()
        pause(0.8)
        shot("25-piles-all-filed")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '2025 W-2'")).firstMatch.tap()
        waitFor(app.buttons["Open in Drive"], 5, "Document view should offer Open in Drive")
        shot("26-piles-document")
    }

    // MARK: Search (4.6)

    func testSearchTypeAndOpenResult() {
        launch()
        waitFor(tab("Search")).tap()
        pause(1.5)
        shot("30-search-start")
        let field = app.searchFields.firstMatch
        // #51 is fixed (#63): the island opens a bottom field, so a missing field is a real failure.
        waitFor(field, 5, "No search field after tapping Search (#51)")
        field.tap()
        field.typeText("w-2 2023")
        let result = element("search.result")
        waitFor(result, 5, "Typing 'w-2 2023' found nothing")
        pause(0.6)
        shot("31-search-results")
        let chip = app.buttons["2023"].firstMatch
        XCTAssertTrue(chip.exists, "No 2023 chip")
        XCTAssertTrue(chip.isSelected, "Typing a year should turn its chip on (4.6)")
        XCTAssertTrue(result.label.contains("2023 W-2"), "First result should be the 2023 W-2, got \(result.label)")
        result.tap()
        waitFor(app.buttons["Open in Drive"], 5, "Result didn't open the document view")
        shot("32-search-document")
    }

    // MARK: Paperless (4.7)

    func testPaperlessChangeStatus() {
        launch()
        waitFor(tab("Paperless")).tap()
        waitFor(app.navigationBars["Paperless"])
        let brightline = waitFor(element("paperless.sender.brightline-wireless"), 5)
        pause(0.6)
        shot("40-paperless")
        brightline.tap()
        let picker = waitFor(element("paperless.status"), 5, "Sender detail has no Status picker")
        shot("41-paperless-sender")
        picker.tap()
        waitFor(app.buttons["Requested"], 5, "Status menu didn't open").tap()
        if !eventually(5, { self.app.buttons["It's confirmed"].exists }) {
            // Known: #57, the detail doesn't hear its own write. The ledger check below still runs.
            continueAfterFailure = true
            XCTExpectFailure("#57: sender detail doesn't update when the status changes") {
                XCTFail("Requested should switch the button to It's confirmed")
            }
            continueAfterFailure = false
        }
        shot("42-paperless-sender-requested")
        goBack()
        XCTAssertTrue(eventually {
            let row = self.element("paperless.sender.brightline-wireless")
            return row.exists && row.label.contains("Requested")
        }, "Brightline should now read Requested in the ledger")
        shot("43-paperless-after-status")
    }

    // MARK: Settings: sender rules, shred hold (4.9, 4.12)

    func testSettingsSenderRulesAndShredHold() {
        launch()
        waitFor(card, 20)
        element("avatar").tap()
        waitFor(app.navigationBars["Settings"], 5, "Avatar didn't open Settings")
        pause(0.8)
        shot("50-settings")
        element("settings.senderRules").tap()
        waitFor(app.navigationBars["Sender rules"], 5)
        let duke = waitFor(app.staticTexts["Duke Energy"], 5, "Sample rule Duke Energy missing")
        shot("51-sender-rules")
        duke.tap()
        waitFor(app.navigationBars["Duke Energy"], 5, "Rule detail didn't open")
        shot("52-sender-rule-detail")
        goBack()
        goBack()
        let hold = waitFor(element("settings.shredHold"), 5)
        hold.tap()
        waitFor(app.navigationBars["Shred hold"], 5)
        shot("53-shred-hold")
        app.buttons["7 days"].tap()
        XCTAssertTrue(eventually { self.app.buttons["7 days"].isSelected }, "7 days didn't take")
        goBack()
        XCTAssertTrue(eventually { self.element("settings.shredHold").label.contains("7 days") },
                      "Shred hold row should read 7 days, got \(element("settings.shredHold").label)")
        shot("54-settings-after-hold")
        element("settings.done").tap()
        XCTAssertTrue(eventually { !self.app.navigationBars["Settings"].exists }, "Done didn't close Settings")
    }

    // MARK: Scan menu (4.2, 4.11) through the simulator seam

    func testScanMenuAndReview() {
        launch()
        waitFor(card, 20)
        let before = topCardLabel
        let scan = element("sort.scan")
        scan.press(forDuration: 1.0)
        waitFor(app.buttons["Scan document"], 5, "Long press on Scan should show the menu")
        XCTAssertTrue(app.buttons["Import from Files"].exists)
        XCTAssertTrue(app.buttons["Import from Photos"].exists)
        shot("60-scan-menu")
        // In the simulator, Scan document feeds the sample pages (SampleScanSource) instead of the camera.
        app.buttons["Scan document"].tap()
        let send = waitFor(element("review.send"), 15, "Scan didn't open the review screen")
        XCTAssertTrue(eventually(15) { send.isEnabled })
        pause(1)
        shot("61-scan-review")
        // #56: the app used to trap in CaptureStyle's dynamic color as the review closed. #67 moved
        // capture onto the asset catalog colors; a crash here stays a hard failure.
        send.tap()
        XCTAssertTrue(eventually { !self.element("review.send").exists }, "Send didn't close the review")
        XCTAssertTrue(card.waitForExistence(timeout: 10) && app.state == .runningForeground,
                      "The deck didn't come back after Send to the deck (#56)")
        pause(1.5)
        shot("62-sort-after-scan")
        XCTAssertFalse(before.isEmpty)
        let subtitle = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'to go'")).firstMatch
        XCTAssertTrue(eventually(15) { subtitle.exists && !subtitle.label.hasPrefix("4 to go") },
                      "Deck count should grow after sending scans, got \(subtitle.exists ? subtitle.label : "no subtitle")")
    }
}
