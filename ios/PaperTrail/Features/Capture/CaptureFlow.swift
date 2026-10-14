// Owner: capture. Spec 4.2 (ScanMenuButton), 4.11, 4.15.
//
// How Sort hosts capture, in two lines (Bryce's decision 1: a Scan button at the top of Sort):
//
//     .toolbar { ToolbarItem(placement: .topBarTrailing) { ScanMenuButton() } }
//     .captureFlow { model.refresh() }
//
// `captureFlow` owns the CaptureController and attaches the scanner and review cover, the Files
// and Photos pickers and the unsupported-file alert. `ScanMenuButton` finds the controller in the
// environment, so any screen inside the flow (the Sort empty state too) can start a capture.
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

extension View {
    /// Hosts the capture flows. `onAdded` runs whenever captured items reach the pipeline.
    func captureFlow(onAdded: @escaping () -> Void) -> some View {
        modifier(CaptureFlowModifier(onAdded: onAdded))
    }
}

/// The Scan button: tap scans (spec 4.2, `primaryAction`); long press offers all three sources.
struct ScanMenuButton: View {
    @Environment(CaptureController.self) private var capture: CaptureController?

    var body: some View {
        Menu {
            Button("Scan document", systemImage: "doc.viewfinder") { Task { await capture?.scan() } }
            Button("Import from Files", systemImage: "folder") { capture?.importFromFiles() }
            Button("Import from Photos", systemImage: "photo.on.rectangle") { capture?.importFromPhotos() }
        } label: {
            Label("Scan", systemImage: "doc.viewfinder")
        } primaryAction: {
            Task { await capture?.scan() }
        }
        .disabled(capture == nil)
        .accessibilityLabel("Scan")
        .accessibilityHint("Double tap to scan. Long press to import from Files or Photos.")
        .accessibilityInputLabels(["Scan", "Scan document"])
    }
}

/// The "Import" menu for the Sort empty state (spec 3.11): Files and Photos.
struct ImportMenuButton: View {
    @Environment(CaptureController.self) private var capture: CaptureController?

    var body: some View {
        Menu("Import") {
            Button("Import from Files", systemImage: "folder") { capture?.importFromFiles() }
            Button("Import from Photos", systemImage: "photo.on.rectangle") { capture?.importFromPhotos() }
        }
        .disabled(capture == nil)
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
