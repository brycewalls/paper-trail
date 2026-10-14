// Owner: capture. Spec 4.11, 4.15, 3.12 (camera denied, unsupported import).
//
// Runs the capture flows behind the Scan menu: the scanner cover, the Files and Photos pickers,
// saving pages before review, and reopening a review left open when the app closed.
// Logic only, no SwiftUI.
import Foundation

@Observable
final class CaptureController {
    /// What the full-screen capture cover shows. nil: the cover is closed.
    enum Phase: Equatable {
        /// VisionKit's document camera. `appending`: Scan more from an open review.
        case scanner(appending: Bool)
        /// "Camera access is off".
        case cameraOff
        /// Writing pages to FileStore before the review appears.
        case saving
        case review
    }

    /// Where a Files or Photos picker is attached: on Sort, or inside the open review (Add more).
    enum PickerHost: Equatable { case sort, review }

    private(set) var phase: Phase?
    private(set) var review: ScanReviewViewModel?
    var filesPicker: PickerHost?
    var photosPicker: PickerHost?
    /// The unsupported-import alert's message, when showing.
    var unsupportedMessage: String?

    /// Called whenever new items reach SwiftData.
    var onAdded: () -> Void = {}

    private let env: AppEnvironment
    /// False in the simulator: Scan document then uses the SampleScanSource seam.
    private let scannerAvailable: Bool
    /// Asks for camera access if needed and returns whether it's allowed.
    private let cameraAccess: () async -> Bool
    private var resumed = false

    init(env: AppEnvironment, scannerAvailable: Bool, cameraAccess: @escaping () async -> Bool) {
        self.env = env
        self.scannerAvailable = scannerAvailable && !SampleScanSource.forced
        self.cameraAccess = cameraAccess
    }

    var usesSampleScanner: Bool { !scannerAvailable }

    // MARK: - The Scan menu

    /// "Scan document".
    func scan() async {
        await openScanner(appending: false)
    }

    /// "Import from Files".
    func importFromFiles() { filesPicker = phase == .review ? .review : .sort }

    /// "Import from Photos".
    func importFromPhotos() { photosPicker = phase == .review ? .review : .sort }

    /// "Scan more" / "Add more" in the review.
    func addMore() async {
        guard let review else { return }
        switch review.session.kind {
        case .scan: await openScanner(appending: true)
        case .files: filesPicker = .review
        case .photos: photosPicker = .review
        }
    }

    // MARK: - Results

    func scannerFinished(_ jpegs: [Data]) async {
        await finishScan(jpegs, appending: phase == .scanner(appending: true))
    }

    private func finishScan(_ jpegs: [Data], appending: Bool) async {
        guard !jpegs.isEmpty else { return scannerCanceled() }
        phase = .saving
        let session = review?.session.id ?? UUID()
        let pages = await Self.savePages(jpegs, session: session, files: env.files)
        if appending, let review {
            review.add(pages, placement: .appendToLast)
            phase = .review
        } else {
            open(ReviewSession(id: session, kind: .scan, pages: pages, groups: [ReviewGroup(pageIDs: pages.map(\.id))]))
        }
    }

    func scannerCanceled() {
        phase = review == nil ? nil : .review
    }

    /// Files: each file is one document; PDFs keep their bytes.
    func filesPicked(_ urls: [URL], host: PickerHost) async {
        filesPicker = nil
        guard !urls.isEmpty else { return }
        let session = review?.session.id ?? UUID()
        let previous = phase
        phase = .saving
        let (groups, rejected) = await Self.saveFiles(urls, session: session, files: env.files)
        if let rejected { unsupportedMessage = rejected.message }
        let pages = groups.flatMap { $0 }
        guard !pages.isEmpty else {
            phase = previous
            return
        }
        if host == .review, let review {
            review.add(pages, placement: .groups(groups.map { $0.map(\.id) }))
            phase = .review
        } else {
            open(ReviewSession(id: session, kind: .files, pages: pages,
                               groups: groups.map { ReviewGroup(pageIDs: $0.map(\.id)) }))
        }
    }

    /// Photos picked together start as one document.
    func photosPicked(_ images: [Data], host: PickerHost) async {
        photosPicker = nil
        guard !images.isEmpty else { return }
        let session = review?.session.id ?? UUID()
        let previous = phase
        phase = .saving
        let pages = await Self.savePages(images, session: session, files: env.files)
        guard !pages.isEmpty else {
            phase = previous
            return
        }
        if host == .review, let review {
            review.add(pages, placement: .oneGroup)
            phase = .review
        } else {
            open(ReviewSession(id: session, kind: .photos, pages: pages, groups: [ReviewGroup(pageIDs: pages.map(\.id))]))
        }
    }

    // MARK: - Review

    func send() {
        review?.send()
        close()
    }

    func discard() {
        review?.discard()
        close()
    }

    /// Reopens a review the app was closed in the middle of (spec 4.11). Once per launch.
    func resumeIfNeeded() {
        guard !resumed, review == nil else { return }
        resumed = true
        if let saved = ReviewStore.latest(files: env.files) { open(saved) }
    }

    private func open(_ session: ReviewSession) {
        let model = ScanReviewViewModel(session: session, env: env)
        model.onAdded = { [weak self] in self?.onAdded() }
        review = model
        phase = .review
        model.start()
    }

    private func close() {
        phase = nil
        review = nil
    }

    private func openScanner(appending: Bool) async {
        if usesSampleScanner {
            phase = .saving
            await finishScan(await SampleScanSource.pages(), appending: appending)
            return
        }
        phase = await cameraAccess() ? .scanner(appending: appending) : .cameraOff
    }

    // MARK: - Saving pages (off the main actor)

    @concurrent
    private nonisolated static func savePages(_ images: [Data], session: UUID, files: FileStore) async -> [ReviewPage] {
        images.compactMap { data in
            guard let jpeg = try? PageAssembler.normalizedJPEG(from: data) else { return nil }
            return try? ReviewStore.addImagePage(jpeg, session: session, files: files)
        }
    }

    /// One page list per supported file, plus the first unsupported file, if any.
    @concurrent
    private nonisolated static func saveFiles(_ urls: [URL], session: UUID,
                                              files: FileStore) async -> ([[ReviewPage]], UnsupportedImport?) {
        var groups: [[ReviewPage]] = []
        var rejected: UnsupportedImport?
        for url in urls {
            guard let data = try? LiveCaptureService.readImported(url) else { continue }
            let name = url.lastPathComponent
            if LiveCaptureService.isPDF(url),
               let pages = try? ReviewStore.addPDF(data, session: session, files: files, sourceName: name) {
                groups.append(pages)
            } else if LiveCaptureService.isImage(url),
                      let jpeg = try? PageAssembler.normalizedJPEG(from: data),
                      let page = try? ReviewStore.addImagePage(jpeg, session: session, files: files, sourceName: name) {
                groups.append([page])
            } else if rejected == nil {
                // Not a PDF or an image, or one that won't open.
                rejected = UnsupportedImport(url: url)
            }
        }
        return (groups, rejected)
    }
}
