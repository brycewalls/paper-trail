// Owner: capture. Spec 4.11.1 (the full-screen page viewer); issue #78.
//
// The page viewer over the scan review: every page of the review in order, the one showing, and
// the cut and join actions for the page showing. Cuts and joins go straight to the review's own
// split and join, so the review behind updates as they happen.
//
// Full-resolution pages are loaded lazily: only the page showing and its neighbors are held, so a
// 20-plus page pile never holds every page at full size. Logic only, no SwiftUI.
import Foundation

@Observable
final class PageViewerModel: Identifiable {
    let id = UUID()
    let review: ScanReviewViewModel
    /// The page showing.
    private(set) var current: UUID
    /// Full-resolution page JPEGs for the pages near `current`, by page ID.
    private(set) var images: [UUID: Data] = [:]

    /// Pages either side of the current one kept at full resolution.
    nonisolated static let neighbors = 1

    private var loads: [UUID: Task<Void, Never>] = [:]

    init(review: ScanReviewViewModel, start: UUID) {
        self.review = review
        self.current = start
        loadWindow()
    }

    // MARK: - What the viewer shows

    var pageIDs: [UUID] { review.orderedPageIDs }
    var position: ScanReviewViewModel.PagePosition? { review.position(of: current) }

    /// "Page 3 of 8 · Document 2".
    var title: String {
        guard let spot = position else { return "" }
        return "Page \(spot.page) of \(spot.pages) · Document \(spot.document)"
    }

    /// VoiceOver's version of the title for one page: "Page 3 of 8, document 2".
    func accessibilityLabel(for pageID: UUID) -> String {
        guard let spot = review.position(of: pageID) else { return "Page" }
        return "Page \(spot.page) of \(spot.pages), document \(spot.document)"
    }

    /// The best picture of a page right now: full resolution if it's loaded, else the strip's thumbnail.
    func picture(_ pageID: UUID) -> Data? { images[pageID] ?? review.thumbnails[pageID] }

    func isLoaded(_ pageID: UUID) -> Bool { images[pageID] != nil }

    // MARK: - Cut and join (the bottom bar and VoiceOver actions)

    var canCut: Bool { review.canCut(after: current) }
    var hasCutBefore: Bool { review.hasCut(before: current) }
    var hasCutAfter: Bool { review.hasCut(after: current) }

    /// "Cut after page 3".
    var cutTitle: String { "Cut after page \(position?.page ?? 0)" }
    /// "Join with page 2": removes the cut before this page.
    var joinBeforeTitle: String { "Join with page \((position?.page ?? 1) - 1)" }
    /// "Join with page 4": removes the cut after this page.
    var joinAfterTitle: String { "Join with page \((position?.page ?? 0) + 1)" }

    /// Cuts after the page showing. Returns what VoiceOver announces.
    @discardableResult
    func cut() -> String {
        guard canCut else { return "" }
        review.cut(after: current)
        return "Cut after page \(position?.page ?? 0). The next page starts document \((position?.document ?? 0) + 1)."
    }

    /// Joins the page showing with the page before it. Returns what VoiceOver announces.
    @discardableResult
    func joinBefore() -> String {
        guard hasCutBefore else { return "" }
        review.join(before: current)
        return "Joined. This page is in document \(position?.document ?? 0) now."
    }

    /// Joins the page showing with the page after it. Returns what VoiceOver announces.
    @discardableResult
    func joinAfter() -> String {
        guard hasCutAfter else { return "" }
        review.join(after: current)
        return "Joined. The next page is in document \(position?.document ?? 0) now."
    }

    // MARK: - Paging and loading

    /// The pager settled on a page (a swipe, or VoiceOver's next and previous page).
    func show(_ pageID: UUID?) {
        guard let pageID, pageID != current, pageIDs.contains(pageID) else { return }
        current = pageID
        loadWindow()
    }

    func showNext() { step(1) }
    func showPrevious() { step(-1) }

    var hasNext: Bool { (pageIDs.firstIndex(of: current) ?? .max) < pageIDs.count - 1 }
    var hasPrevious: Bool { (pageIDs.firstIndex(of: current) ?? 0) > 0 }

    private func step(_ by: Int) {
        let ids = pageIDs
        guard let at = ids.firstIndex(of: current), ids.indices.contains(at + by) else { return }
        show(ids[at + by])
    }

    /// The pages kept at full resolution: the current one and `neighbors` either side.
    var window: [UUID] {
        let ids = pageIDs
        guard let at = ids.firstIndex(of: current) else { return [] }
        let low = max(0, at - Self.neighbors), high = min(ids.count - 1, at + Self.neighbors)
        // The current page loads first.
        return [ids[at]] + ids[low...high].filter { $0 != ids[at] }
    }

    /// Drops full-resolution pages outside the window and loads the ones inside it.
    func loadWindow() {
        let keep = Set(window)
        for id in images.keys where !keep.contains(id) { images[id] = nil }
        for (id, task) in loads where !keep.contains(id) {
            task.cancel()
            loads[id] = nil
        }
        for id in window where images[id] == nil && loads[id] == nil {
            loads[id] = Task { [weak self] in
                let data = await self?.review.fullImage(id)
                guard let self, !Task.isCancelled else { return }
                self.loads[id] = nil
                if Set(self.window).contains(id) { self.images[id] = data }
            }
        }
    }

    /// Waits for the window's loads to finish. For tests.
    func waitForImages() async {
        while let task = loads.values.first { await task.value }
    }

    /// The viewer closed: let go of every full-resolution page.
    func releaseImages() {
        loads.values.forEach { $0.cancel() }
        loads = [:]
        images = [:]
    }
}
