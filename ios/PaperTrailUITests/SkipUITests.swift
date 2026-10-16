// Owner: deck. Skip on Sort (#77; docs/design-spec.md 3.1, 3.3, 3.13): the Skip button and swipe
// up, Undo, the long-press "Skip", the "N skipped" chip and its sheet ("Sort now", "Sort skipped"),
// the empty deck's "N skipped. Sort them now?", and the action row at the largest text size.
import XCTest

final class SkipUITests: PaperTrailUITestCase {

    private var skipButton: XCUIElement { element("deck.skip") }
    private var chip: XCUIElement { element("deck.skipped") }

    /// A real drag up from the card's center, the way a thumb skips it.
    private func swipeCardUp() {
        let start = card.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: 0, dy: -320))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
    }

    private func chipReads(_ text: String) -> Bool {
        eventually(5) { self.chip.exists && self.chip.label.contains(text) }
    }

    func testSkipSwipeUndoChipSheetAndEmptyDeck() {
        launch()
        waitFor(card, 20, "The sample deck never showed a card")
        XCTAssertTrue(eventually { !self.topCardLabel.isEmpty })
        XCTAssertFalse(chip.exists, "No skipped chip before anything is skipped")
        XCTAssertTrue(skipButton.exists && skipButton.isEnabled, "No Skip button in the action row")
        XCTAssertEqual(skipButton.label, "Skip")
        shot("70-sort-skip-row")

        // The Skip button.
        let first = topCardLabel
        skipButton.tap()
        XCTAssertTrue(eventually { self.topCardLabel != first }, "Skip didn't take the card off the deck")
        XCTAssertTrue(chipReads("1 skipped"), "The chip should read 1 skipped, got \(chip.exists ? chip.label : "none")")

        // Swipe up.
        let second = topCardLabel
        swipeCardUp()
        XCTAssertTrue(eventually { self.topCardLabel != second }, "Swipe up didn't skip the card")
        XCTAssertTrue(chipReads("2 skipped"), "The chip should read 2 skipped")
        pause(0.6)
        shot("71-sort-after-skip")

        // Undo brings the swiped-up card back on top, like the other swipes.
        element("deck.undo").tap()
        XCTAssertTrue(eventually { self.topCardLabel == second }, "Undo didn't bring the skipped card back")
        XCTAssertTrue(chipReads("1 skipped"), "Undo should leave 1 skipped")

        // The long-press menu's "Skip" (was "Move to the back").
        card.press(forDuration: 1.2)
        let menuSkip = app.buttons.matching(NSPredicate(format: "label == 'Skip' AND identifier != 'deck.skip'")).firstMatch
        waitFor(menuSkip, 5, "The card's long-press menu has no Skip")
        XCTAssertFalse(app.buttons["Move to the back"].exists, "\"Move to the back\" should be renamed Skip")
        menuSkip.tap()
        XCTAssertTrue(chipReads("2 skipped"), "Skip from the menu didn't skip the card")

        // The sheet: "Sort now" on one row puts that card on top.
        chip.tap()
        let sortAll = waitFor(element("skipped.sortAll"), 5, "The chip didn't open the skipped sheet")
        pause(0.8)
        shot("72-skipped-sheet")
        let rows = app.descendants(matching: .any).matching(identifier: "skipped.row")
        XCTAssertEqual(rows.count, 2, "The sheet should list both skipped cards")
        let row = rows.element(boundBy: 1)
        let rowTitle = row.label.components(separatedBy: ". ").first ?? row.label
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertTrue(eventually { rows.count == 1 }, "Sort now didn't take the card out of the sheet")
        XCTAssertTrue(sortAll.exists, "The sheet should stay open while a card is still skipped")
        sortAll.tap()
        XCTAssertTrue(eventually { !self.element("skipped.sortAll").exists }, "Sort skipped didn't close the sheet")
        XCTAssertTrue(eventually { !self.chip.exists }, "The chip should go once nothing is skipped")
        // Sort now dealt its card on top; Sort skipped then dealt the other one in front of it.
        XCTAssertTrue(eventually { self.topCardLabel == first }, "Sort skipped should put the first skipped card on top, got \(topCardLabel)")
        XCTAssertFalse(rowTitle.isEmpty)

        // Skip everything: the empty deck asks to sort them.
        for _ in 0..<6 where card.exists {
            let label = topCardLabel
            skipButton.tap()
            _ = eventually { !self.card.exists || self.topCardLabel != label }
        }
        let prompt = waitFor(app.staticTexts["4 skipped. Sort them now?"], 5, "The empty deck should ask to sort the skipped cards")
        XCTAssertTrue(prompt.exists)
        XCTAssertFalse(app.staticTexts["All sorted"].exists, "Not all sorted while cards are skipped")
        pause(0.6)
        shot("73-sort-only-skipped")
        element("deck.sortSkipped").tap()
        waitFor(card, 5, "Sort skipped didn't deal the cards back")
        XCTAssertTrue(eventually { !self.chip.exists })
    }

    /// The row reads Shred, Undo, Skip, File without crowding at the largest text size.
    func testActionRowAtTheLargestTextSize() {
        launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        waitFor(card, 20, "The sample deck never showed a card")
        skipButton.tap()
        XCTAssertTrue(chipReads("1 skipped"))
        pause(0.8)
        shot("74-sort-skip-largest-type")

        let buttons = ["deck.shred", "deck.undo", "deck.skip", "deck.file"].map(element)
        let width = app.windows.firstMatch.frame.width
        for (index, button) in buttons.enumerated() {
            XCTAssertTrue(button.isHittable, "\(button.identifier) isn't tappable at the largest text size")
            XCTAssertGreaterThanOrEqual(button.frame.minX, 0)
            XCTAssertLessThanOrEqual(button.frame.maxX, width)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, "\(button.identifier) is under 44 pt wide")
            if index > 0 {
                XCTAssertLessThanOrEqual(buttons[index - 1].frame.maxX, button.frame.minX,
                                         "\(buttons[index - 1].identifier) overlaps \(button.identifier)")
            }
        }
        // Shred, Undo, Skip, File, left to right, on one line.
        let centers = buttons.map(\.frame.midY)
        XCTAssertLessThan((centers.max() ?? 0) - (centers.min() ?? 0), 4, "The action row wrapped")
    }
}
