// Owner: capture. Spec 4.11, "Scanner".
//
// VisionKit's VNDocumentCameraViewController (the stopgap scanner, #33; the custom scanner #32 is
// parked). Save hands every page to the controller as a JPEG; pages are written to FileStore
// before the review screen appears.
import AVFoundation
import SwiftUI
import UIKit
import VisionKit

struct DocumentScannerView: UIViewControllerRepresentable {
    let onFinish: ([Data]) -> Void
    let onCancel: () -> Void

    /// False in the simulator even where VisionKit says yes (the iOS 27 simulator does, with no
    /// camera behind it), so Scan document uses the SampleScanSource seam there.
    static var isSupported: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        VNDocumentCameraViewController.isSupported
        #endif
    }

    /// Camera permission for the scanner, asked the first time someone scans.
    static func cameraAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .video)
        default: false
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish, onCancel: onCancel) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: ([Data]) -> Void
        let onCancel: () -> Void

        init(onFinish: @escaping ([Data]) -> Void, onCancel: @escaping () -> Void) {
            self.onFinish = onFinish
            self.onCancel = onCancel
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                          didFinishWith scan: VNDocumentCameraScan) {
            let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
            let onFinish = onFinish
            Task {
                // High quality here; PageAssembler caps the size and sets the final quality.
                let pages = await Self.encode(images)
                onFinish(pages)
            }
        }

        @concurrent
        private nonisolated static func encode(_ images: [UIImage]) async -> [Data] {
            images.compactMap { $0.jpegData(compressionQuality: 0.95) }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onCancel()
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            onCancel()
        }
    }
}

/// Spec 3.12, "Camera denied".
struct CameraOffView: View {
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Camera access is off", systemImage: "camera")
            } description: {
                Text("Turn it on in Settings, then Paper Trail, to scan.")
            } actions: {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .buttonStyle(.borderedProminent)
            }
            .background(CaptureStyle.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onClose)
                }
            }
        }
    }
}
