// Owner: piles. The live DocStore: Firestore under users/{uid}/, the same documents the web app
// reads and writes (ARCHITECTURE.md, "Firestore data model"). No SwiftUI.
//
// Listeners follow the signed-in user: each stream watches Firebase Auth and re-attaches its
// snapshot listener when the user changes, so a screen that starts before sign-in still fills in.
// Firestore's offline cache serves the last snapshot when the phone has no connection.
import Foundation
import FirebaseAuth
import FirebaseFirestore

@Observable
final class FirestoreDocStore: DocStore {
    private(set) var syncError: DocStoreError?

    private var db: Firestore { Firestore.firestore() }

    private func user() throws -> DocumentReference {
        guard let uid = Auth.auth().currentUser?.uid else { throw DocStoreError.signedOut }
        return db.collection("users").document(uid)
    }

    // MARK: Streams

    /// Owns one auth listener and the snapshot listener for the current user.
    private final class Watch {
        var authHandle: AuthStateDidChangeListenerHandle?
        var registration: (any ListenerRegistration)?
        var uid: String?

        func stop() {
            registration?.remove()
            registration = nil
            if let authHandle { Auth.auth().removeStateDidChangeListener(authHandle) }
            authHandle = nil
        }
    }

    /// Calls `attach` with the signed-in user's document whenever the user changes, and yields
    /// `empty` when nobody is signed in. `attach` reports each snapshot (or error) through `report`.
    private func stream<T: Sendable>(
        empty: T,
        attach: @escaping (DocumentReference, @escaping @MainActor (Result<T, any Error>) -> Void) -> any ListenerRegistration
    ) -> AsyncStream<T> {
        let (stream, continuation) = AsyncStream<T>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let watch = Watch()
        let db = self.db
        let report: @MainActor (Result<T, any Error>) -> Void = { [weak self] result in
            switch result {
            case .success(let value):
                self?.syncError = nil
                continuation.yield(value)
            case .failure(let error):
                self?.syncError = .listener(error.localizedDescription)
            }
        }
        // Firebase calls auth and snapshot listeners on the main queue.
        watch.authHandle = Auth.auth().addStateDidChangeListener { _, user in
            MainActor.assumeIsolated {
                guard user?.uid != watch.uid || watch.registration == nil else { return }
                watch.registration?.remove()
                watch.registration = nil
                watch.uid = user?.uid
                guard let uid = user?.uid else { continuation.yield(empty); return }
                watch.registration = attach(db.collection("users").document(uid), report)
            }
        }
        continuation.onTermination = { _ in Task { @MainActor in watch.stop() } }
        return stream
    }

    func docs() -> AsyncStream<[FiledDoc]> {
        stream(empty: []) { user, report in
            user.collection("docs").order(by: "filedAt", descending: true).limit(to: 2000)
                .addSnapshotListener { snapshot, error in
                    MainActor.assumeIsolated {
                        guard let snapshot else { return report(.failure(error ?? DocStoreError.listener("no snapshot"))) }
                        report(.success(snapshot.documents.compactMap {
                            FirestoreRecords.filedDoc(id: $0.documentID, data: $0.data())
                        }))
                    }
                }
        }
    }

    func paperless() -> AsyncStream<[PaperlessSender]> {
        stream(empty: []) { user, report in
            user.collection("paperless").addSnapshotListener { snapshot, error in
                MainActor.assumeIsolated {
                    guard let snapshot else { return report(.failure(error ?? DocStoreError.listener("no snapshot"))) }
                    report(.success(snapshot.documents.compactMap {
                        FirestoreRecords.paperlessSender(id: $0.documentID, data: $0.data())
                    }))
                }
            }
        }
    }

    func watchSettings() -> AsyncStream<AppSettings> {
        stream(empty: AppSettings()) { user, report in
            user.collection("config").document("settings").addSnapshotListener { snapshot, error in
                MainActor.assumeIsolated {
                    guard let snapshot else { return report(.failure(error ?? DocStoreError.listener("no snapshot"))) }
                    report(.success(FirestoreRecords.settings(from: snapshot.data() ?? [:])))
                }
            }
        }
    }

    // MARK: Writes

    func addDoc(_ doc: FiledDoc) async throws -> String {
        let ref = try user().collection("docs").document()
        try ref.setData(from: doc)
        return ref.documentID
    }

    func updateDoc(id: String, fields: [String: any Sendable]) async throws {
        try await user().collection("docs").document(id).updateData(FirestoreRecords.plain(fields))
    }

    func deleteDoc(id: String) async throws {
        try await user().collection("docs").document(id).delete()
    }

    func setPaperless(_ sender: PaperlessSender) async throws {
        try user().collection("paperless").document(sender.id).setData(from: sender, merge: true)
    }

    func updatePaperless(id: String, fields: [String: any Sendable]) async throws {
        try await user().collection("paperless").document(id).updateData(FirestoreRecords.plain(fields))
    }

    func senderRules() async throws -> [SenderRule] {
        let snapshot = try await user().collection("senders").getDocuments()
        return snapshot.documents.compactMap { try? $0.data(as: SenderRule.self) }
    }

    func saveSenderRule(_ rule: SenderRule) async throws {
        try user().collection("senders").document(rule.key).setData(from: rule)
    }

    func deleteSenderRule(key: String) async throws {
        try await user().collection("senders").document(key).delete()
    }

    func driveFolders() async throws -> DriveFolderCache? {
        let snapshot = try await user().collection("config").document("drive").getDocument()
        guard snapshot.exists else { return nil }
        return try? snapshot.data(as: DriveFolderCache.self)
    }

    func saveDriveFolders(_ cache: DriveFolderCache) async throws {
        try user().collection("config").document("drive").setData(from: cache)
    }

    func settings() async throws -> AppSettings {
        let snapshot = try await user().collection("config").document("settings").getDocument()
        return FirestoreRecords.settings(from: snapshot.data() ?? [:])
    }

    /// Merges, so fields other features keep in the same doc survive.
    func saveSettings(_ settings: AppSettings) async throws {
        try user().collection("config").document("settings").setData(from: settings, merge: true)
    }
}

/// Turns raw Firestore data into the shared models. Older web records can miss fields the Swift
/// types require (an early doc without `pages`, say), so missing fields get the web app's own
/// defaults instead of the whole record being dropped from Piles and Search. No Firebase types,
/// so it's unit tested with plain dictionaries.
nonisolated enum FirestoreRecords {
    static func filedDoc(id: String, data: [String: Any]) -> FiledDoc? {
        var d = data
        func fill(_ key: String, _ value: Any) { if d[key] == nil || d[key] is NSNull { d[key] = value } }
        for key in ["title", "docType", "issuer", "docDate", "summary", "filename", "verdictReason", "retention",
                    "driveId", "driveUrl", "filedAt"] {
            fill(key, "")
        }
        if (d["title"] as? String)?.isEmpty != false { d["title"] = "Untitled document" }
        if !ArchiveFolder.all.contains(d["folder"] as? String ?? "") { d["folder"] = ArchiveFolder.fallback }
        if Verdict(rawValue: d["verdict"] as? String ?? "") == nil { d["verdict"] = Verdict.scanShred.rawValue }
        fill("sensitive", false)
        fill("pages", 1)
        fill("filed", !((d["driveId"] as? String) ?? "").isEmpty)
        if PhysicalState(rawValue: d["physical"] as? String ?? "") == nil {
            d["physical"] = (d["verdict"] as? String) == Verdict.keepOriginal.rawValue
                ? PhysicalState.keep.rawValue : PhysicalState.toShred.rawValue
        }
        var hint = d["paperless"] as? [String: Any] ?? [:]
        if hint["possible"] == nil { hint["possible"] = false }
        if hint["issuer"] == nil { hint["issuer"] = d["issuer"] ?? "" }
        if hint["how"] == nil { hint["how"] = "" }
        d["paperless"] = hint
        guard var doc = decode(FiledDoc.self, d) else { return nil }
        doc.id = id
        return doc
    }

    static func paperlessSender(id: String, data: [String: Any]) -> PaperlessSender? {
        var d = data
        if (d["issuer"] as? String)?.isEmpty != false { d["issuer"] = id }
        if d["how"] == nil || d["how"] is NSNull { d["how"] = "" }
        if d["firstSeen"] == nil || d["firstSeen"] is NSNull { d["firstSeen"] = "" }
        if PaperlessStatus(rawValue: d["status"] as? String ?? "") == nil { d["status"] = PaperlessStatus.toDo.rawValue }
        guard var sender = decode(PaperlessSender.self, d) else { return nil }
        sender.id = id
        return sender
    }

    static func settings(from data: [String: Any]) -> AppSettings {
        var settings = AppSettings()
        if let days = data["shredHoldDays"] as? Int { settings.shredHoldDays = days }
        else if let days = data["shredHoldDays"] as? NSNumber { settings.shredHoldDays = days.intValue }
        return settings
    }

    static func plain(_ fields: [String: any Sendable]) -> [String: Any] {
        fields.mapValues { $0 as Any }
    }

    /// Plain JSON round trip. Every field the app stores is a string, number, bool, array or map,
    /// so JSON carries all of them; anything JSON can't hold (a Firestore Timestamp written by
    /// hand) is dropped first rather than failing the record.
    private static func decode<T: Decodable>(_ type: T.Type, _ data: [String: Any]) -> T? {
        let clean = data.filter { JSONSerialization.isValidJSONObject([$0.value]) }
        guard let json = try? JSONSerialization.data(withJSONObject: clean) else { return nil }
        return try? JSONDecoder().decode(T.self, from: json)
    }
}
