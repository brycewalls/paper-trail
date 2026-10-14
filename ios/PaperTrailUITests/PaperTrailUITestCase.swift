// Owner: qa. Shared helpers for the UI walk-through. Every test launches the app in sample mode
// (-PTSample: fake services, the four-card sample deck, the sample library), so nothing here
// touches Google, Drive or Claude.
import XCTest

@MainActor
class PaperTrailUITestCase: XCTestCase {
    var app: XCUIApplication!

    /// "light" or "dark". Set from the host with `TEST_RUNNER_PT_APPEARANCE=dark` after switching
    /// the simulator with `xcrun simctl ui <device> appearance dark`; it only names the screenshots.
    static var appearance: String { ProcessInfo.processInfo.environment["PT_APPEARANCE"] ?? "light" }

    /// Optional folder on the Mac to write each screenshot to as a PNG, as well as attaching it.
    /// Set with `TEST_RUNNER_PT_SHOTS_DIR=/path`.
    static var shotsDirectory: URL? {
        ProcessInfo.processInfo.environment["PT_SHOTS_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    override func setUp() async throws {
        continueAfterFailure = false
    }

    func launch(_ extra: [String] = []) {
        app = XCUIApplication()
        app.launchArguments = ["-PTSample"] + extra
        app.launch()
    }

    // MARK: Screenshots

    /// Attaches a screenshot named "<name>-<appearance>" and, when PT_SHOTS_DIR is set, writes it there.
    func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let full = "\(name)-\(Self.appearance)"
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = full
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = Self.shotsDirectory {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: dir.appendingPathComponent("\(full).png"))
        }
    }

    // MARK: Elements

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    var card: XCUIElement { element("deck.card") }

    /// The top card's VoiceOver label starts with its title (spec 6).
    var topCardLabel: String { card.exists ? card.label : "" }

    func tab(_ name: String) -> XCUIElement { app.tabBars.buttons[name].firstMatch }

    @discardableResult
    func waitFor(_ element: XCUIElement, _ timeout: TimeInterval = 10, _ message: String = "",
                 file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.waitForExistence(timeout: timeout),
                      message.isEmpty ? "Never appeared: \(element)" : message, file: file, line: line)
        return element
    }

    /// Polls until the condition holds or the timeout passes.
    func eventually(_ timeout: TimeInterval = 10, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return condition()
    }

    func pause(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    /// A real drag across the card, from its center, the way a thumb swipes it.
    func swipeCard(right: Bool) {
        let start = card.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: right ? 300 : -300, dy: 0))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
    }

    /// The button in a confirmation dialog, which on iOS 26 may be a popover or an action sheet.
    func dialogButton(_ label: String) -> XCUIElement {
        let inSheet = app.sheets.buttons[label].firstMatch
        if inSheet.exists { return inSheet }
        return app.buttons.matching(NSPredicate(format: "label == %@ AND identifier == ''", label)).firstMatch
    }

    func goBack() {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }
}
