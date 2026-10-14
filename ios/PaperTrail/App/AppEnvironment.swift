// Owner: scaffold. Each feature agent swaps its own live service in `live()` and touches nothing
// else here. Keep the edit to one line per service so parallel PRs merge cleanly.
//
// Dependency injection: one object holding every service behind its protocol, passed down with
// `.environment(env)`. Views never create services; view models get them from here.
import Foundation
import SwiftData

@Observable
final class AppEnvironment {
    let auth: any AuthService
    let classify: any ClassifyService
    let drive: any DriveService
    let docs: any DocStore
    let capture: any CaptureService
    let outbox: any OutboxService
    let files: FileStore
    let modelContainer: ModelContainer
    /// True when every service is a fake (simulator sample mode, tests, previews).
    let isSample: Bool

    init(auth: any AuthService, classify: any ClassifyService, drive: any DriveService, docs: any DocStore,
         capture: any CaptureService, outbox: any OutboxService, files: FileStore,
         modelContainer: ModelContainer, isSample: Bool) {
        self.auth = auth
        self.classify = classify
        self.drive = drive
        self.docs = docs
        self.capture = capture
        self.outbox = outbox
        self.files = files
        self.modelContainer = modelContainer
        self.isSample = isSample
    }

    /// All fakes, in memory. Launch with `-PTSample` to get this in the simulator.
    static func sample() -> AppEnvironment {
        let files = FileStore.temporary()
        return AppEnvironment(
            auth: FakeAuthService(), classify: FakeClassifyService(), drive: FakeDriveService(),
            docs: FakeDocStore(), capture: FakeCaptureService(files: files), outbox: FakeOutboxService(),
            files: files, modelContainer: PipelineStore.container(inMemory: true), isSample: true)
    }

    /// The real app. Until each feature lands, its slot below still holds the fake.
    static func live() -> AppEnvironment {
        FirebaseBootstrap.configure()
        let files = FileStore.appDefault()
        // outbox: the live outbox needs auth, docs and the container, so they're named first.
        let auth: any AuthService = LiveAuthService.live()  // auth
        let docs: any DocStore = FakeDocStore()        // piles: replace with the Firestore DocStore
        let container = PipelineStore.container(inMemory: false)  // outbox: on disk, survives a relaunch
        let drive = LiveDriveService(auth: auth, docs: docs)      // outbox
        return AppEnvironment(
            auth: auth,
            classify: LiveClassifyService(),         // classify: the classify callable (#20, #21)
            drive: drive,
            docs: docs,
            capture: LiveCaptureService(files: files), // capture: live (Vision OCR, PDF text layer, SHA-256)
            outbox: LiveOutboxService(auth: auth, drive: drive, docs: docs, files: files, container: container), // outbox
            files: files, modelContainer: container,
            isSample: true)                          // set to false once no fakes remain above
    }

    static func forLaunch() -> AppEnvironment {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-PTSample") || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
            return sample()
        }
        return live()
    }
}
