// Owner: capture. Spec 4.2 (ScanMenuButton), 4.11, 4.15.
//
// How Sort hosts capture, in two lines (Bryce's decision 1: a Scan button at the top of Sort):
//
//     .toolbar { ToolbarItem(placement: .topBarTrailing) { ScanMenuButton() } }
//     .captureFlow { model.refresh() }
//
// `captureFlow` owns the CaptureController and attaches the scanner and review cover, the Files
// and Photos pickers and the unsupported-file alert. `ScanMenu` (and `ScanMenuButton`, its toolbar
// form) finds the controller in the environment, so any screen inside the flow (the Sort empty
// states too) opens the same three-choice menu (#79).
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

extension View {
    /// Hosts the capture flows. `onAdded` runs whenever captured items reach the pipeline.
    func captureFlow(onAdded: @escaping () -> Void) -> some View {
        modifier(CaptureFlowModifier(onAdded: onAdded))
    }
}

/// The one Scan menu (#74, #79). Every scan entry point is this menu: the Scan button on Sort, the
/// Sort empty states, and the review's "Scan more" / "Add more". A tap opens all three sources; there
/// is no `primaryAction`, because that made a tap scan at once and hid both imports. Only the label
/// differs between entry points, so the choices can't drift apart again.
///
/// It finds the CaptureController in the environment: `.captureFlow` provides it to Sort, and the
/// capture cover provides it to the review. From an open review, each choice adds to that review.
struct ScanMenu<MenuLabel: View>: View {
    @Environment(CaptureController.self) private var capture: CaptureController?
    private let label: MenuLabel

    init(@ViewBuilder label: () -> MenuLabel) {
        self.label = label()
    }

    var body: some View {
        Menu {
            ForEach(ScanSource.allCases) { source in
                Button(source.title, systemImage: source.symbol) { start(source) }
            }
        } label: {
            label
        }
        .disabled(capture == nil)
        .accessibilityHint("Scan a document, or import from Files or Photos.")
    }

    private func start(_ source: ScanSource) {
        switch source {
        case .scan: Task { await capture?.scan() }
        case .files: capture?.importFromFiles()
        case .photos: capture?.importFromPhotos()
        }
    }
}

extension ScanMenu where MenuLabel == Text {
    /// A text label: "Scan", "Scan more", "Add more".
    init(_ title: String) {
        self.init { Text(title) }
    }
}

/// The three choices on the Scan menu, in order (decision 1).
enum ScanSource: CaseIterable, Identifiable {
    case scan, files, photos

    var id: Self { self }

    var title: String {
        switch self {
        case .scan: "Scan document"
        case .files: "Import from Files"
        case .photos: "Import from Photos"
        }
    }

    var symbol: String {
        switch self {
        case .scan: "doc.viewfinder"
        case .files: "folder"
        case .photos: "photo.on.rectangle"
        }
    }
}

/// The Scan button in Sort's toolbar (decision 1): the shared ScanMenu with the `doc.viewfinder` label.
struct ScanMenuButton: View {
    var body: some View {
        ScanMenu {
            Label("Scan", systemImage: "doc.viewfinder")
        }
        .accessibilityLabel("Scan")
        .accessibilityInputLabels(["Scan", "Scan document"])
        .accessibilityIdentifier("sort.scan")
    }
}

private struct CaptureFlowModifier: ViewModifier {
    @Environment(AppEnvironment.self) private var env
    @State private var controller: CaptureController?
    let onAdded: () -> Void

    func body(content: Content) -> some View {
        content
            .environment(controller)
            .task {
                guard controller == nil else { return }
                let made = CaptureController(env: env, scannerAvailable: DocumentScannerView.isSupported,
                                             cameraAccess: DocumentScannerView.cameraAccess)
                made.onAdded = onAdded
                controller = made
                made.resumeIfNeeded()
                if SampleScanSource.opensScanAtLaunch, made.review == nil { await made.scan() }
            }
            .fullScreenCover(isPresented: coverShown) {
                if let controller { CaptureCover(controller: controller) }
            }
            .modifier(CapturePickers(controller: controller, host: .sort))
    }

    private var coverShown: Binding<Bool> {
        Binding(get: { controller?.phase != nil },
                set: { shown in if !shown { controller?.scannerCanceled() } })
    }
}

/// What the full-screen cover shows: the scanner, the camera-off screen, saving, or the review.
private struct CaptureCover: View {
    let controller: CaptureController

    var body: some View {
        Group {
            switch controller.phase {
            case .scanner:
                DocumentScannerView(onFinish: { pages in Task { await controller.scannerFinished(pages) } },
                                    onCancel: controller.scannerCanceled)
                    .ignoresSafeArea()
            case .cameraOff:
                CameraOffView(onClose: controller.scannerCanceled)
            case .saving, .none:
                ProgressView("Saving pages")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.background)
            case .review:
                if let review = controller.review {
                    ScanReviewScreen(model: review, controller: controller)
                }
            }
        }
        .modifier(CapturePickers(controller: controller, host: .review))
        // The review's "Scan more" / "Add more" is the shared ScanMenu, which reads this (#79).
        .environment(controller)
    }
}

/// The Files and Photos pickers and the unsupported-file alert. Attached twice, on Sort and
/// inside the cover, because a sheet can't present from under a full-screen cover.
private struct CapturePickers: ViewModifier {
    let controller: CaptureController?
    let host: CaptureController.PickerHost
    @State private var photoSelection: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .fileImporter(isPresented: filesShown, allowedContentTypes: [.pdf, .image],
                          allowsMultipleSelection: true) { result in
                let urls = (try? result.get()) ?? []
                Task { await controller?.filesPicked(urls, host: host) }
            }
            .photosPicker(isPresented: photosShown, selection: $photoSelection, matching: .images,
                          preferredItemEncoding: .current)
            .onChange(of: photoSelection) { _, items in
                guard !items.isEmpty else { return }
                photoSelection = []
                let host = host
                Task {
                    var images: [Data] = []
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self) { images.append(data) }
                    }
                    await controller?.photosPicked(images, host: host)
                }
            }
            .alert("That file can't be filed", isPresented: alertShown) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(controller?.unsupportedMessage ?? "")
            }
    }

    private var filesShown: Binding<Bool> {
        Binding(get: { controller?.filesPicker == host },
                set: { if !$0, controller?.filesPicker == host { controller?.filesPicker = nil } })
    }

    private var photosShown: Binding<Bool> {
        Binding(get: { controller?.photosPicker == host },
                set: { if !$0, controller?.photosPicker == host { controller?.photosPicker = nil } })
    }

    /// The alert shows on whichever layer is on top.
    private var alertShown: Binding<Bool> {
        Binding(get: { controller?.unsupportedMessage != nil && ((controller?.phase == nil) == (host == .sort)) },
                set: { if !$0 { controller?.unsupportedMessage = nil } })
    }
}
