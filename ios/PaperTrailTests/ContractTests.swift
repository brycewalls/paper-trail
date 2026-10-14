// Contract tests: the Swift models must read and write exactly what the function and the web app do.
import Foundation
import Testing
@testable import PaperTrail

struct ContractTests {
    /// A reply shaped like functions/lib.js classify() returns today (no new fields).
    let liveReply = """
    {"result":{"title":"Duke Energy bill, March 2024","docType":"Utility bill","issuer":"Duke Energy",
    "docDate":"2024-03-12","summary":"Bill.","folder":"06 Home","filename":"2024-03-12_duke-energy-electric-bill",
    "verdict":"scan_shred","verdictReason":"Routine.","retention":"Keep 1 year","sensitive":false,
    "paperless":{"possible":true,"issuer":"Duke Energy","how":"Billing preferences."}},"model":"claude-opus-5-5"}
    """

    @Test func decodesTheLiveFunctionReply() throws {
        let reply = try JSONDecoder().decode(ClassifyResponse.self, from: Data(liveReply.utf8))
        #expect(reply.result.verdict == .scanShred)
        #expect(reply.result.confidence == nil)
        #expect(reply.result.isConfident == false)
        #expect(ArchiveFolder.all.contains(reply.result.folder))
    }

    @Test func requestOmitsUnsetOptionalFields() throws {
        let request = ClassifyRequest(kind: .pdf, pdf: "JVBERi0=", images: nil, totalPages: 2)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        #expect(json?["kind"] as? String == "pdf")
        #expect(json?["totalPages"] as? Int == 2)
        #expect(json?["ocrText"] == nil)
        #expect(json?["images"] == nil)
    }

    @Test func decodesAWebAppDocRecord() throws {
        let record = """
        {"title":"T","docType":"","issuer":"","docDate":"","summary":"","folder":"11 Other","filename":"x",
        "verdict":"keep_original","verdictReason":"","retention":"","sensitive":false,
        "paperless":{"possible":false,"issuer":"","how":""},"pages":1,"filed":true,"driveId":"d",
        "driveUrl":"https://drive.google.com/file/d/d/view","physical":"keep","filedAt":"2026-10-13T00:00:00.000Z"}
        """
        let doc = try JSONDecoder().decode(FiledDoc.self, from: Data(record.utf8))
        #expect(doc.physical == .keep)
        #expect(doc.verifiedAt == nil)
    }

    @Test func iosDocsNeedVerificationBeforeShredding() {
        var doc = SampleData.filedDocs()[0]
        doc.physical = .toShred
        doc.filed = true
        doc.source = "ios"
        #expect(doc.isSafeToShred == false)
        doc.verifiedAt = "2026-10-13T00:00:00.000Z"
        #expect(doc.isSafeToShred)
    }

    @Test func paperlessStatusKeepsTheWebValues() {
        #expect(PaperlessStatus(rawValue: "todo") == .toDo)
        #expect(PaperlessStatus(rawValue: "done") == .confirmed)
        #expect(PaperlessStatus(rawValue: "skip") == .cantStop)
    }

    @Test(arguments: [
        ("Duke Energy", "duke-energy"),
        ("  AT&T Wireless!! ", "at-t-wireless"),
        ("", "unknown"),
    ])
    func slugMatchesTheWebApp(input: String, expected: String) {
        #expect(slug(input) == expected)
    }
}
