// Search (A6, #22): matching, ranking, chips, highlighting, snippets, recents and "Also in Drive".
import Foundation
import Testing
@testable import PaperTrail

@MainActor
struct SearchTests {
    let library = SampleData.filedDocs() + SampleData.pileDocs()

    func freshDefaults() -> UserDefaults {
        let name = "search-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func everyWordMustMatchAndTitlesRankFirst() {
        let hits = SearchIndex.search(library, query: "w-2 2023", filters: [])
        #expect(hits.map(\.doc.title) == ["2023 W-2, corrected", "2023 W-2"])
        #expect(SearchIndex.search(library, query: "w-2 1999", filters: []).isEmpty)
    }

    @Test func matchesSenderTypeAmountAndFullText() {
        #expect(SearchIndex.search(library, query: "cascade", filters: []).count == 2)
        #expect(SearchIndex.search(library, query: "84.12", filters: []).map(\.doc.title) == ["Electric bill, August"])
        #expect(SearchIndex.search(library, query: "amoxicillin", filters: []).map(\.doc.title) == ["Pharmacy receipt"])
        #expect(SearchIndex.search(library, query: "taxes", filters: []).count == 5)
    }

    @Test func filtersNarrowTheResults() {
        let keep = SearchIndex.search(library, query: "", filters: [.keepOriginals])
        #expect(keep.allSatisfy { $0.doc.verdict == .keepOriginal })
        #expect(!keep.isEmpty)
        let sensitiveTaxes = SearchIndex.search(library, query: "", filters: [.docType("Tax form"), .sensitive])
        #expect(Set(sensitiveTaxes.map(\.doc.title)) == ["2024 1099-INT", "2025 W-2", "2023 W-2", "2023 W-2, corrected"])
        // A 2023 W-2 is dated 2024 but the year chip still finds it by the year on the form.
        let year = SearchIndex.search(library, query: "", filters: [.year(2023)])
        #expect(year.contains { $0.doc.title == "2023 W-2" })
    }

    @Test func snippetIsAroundTheFirstMatch() {
        let text = "Copy B. Form W-2 Wage and Tax Statement 2023. Employer Northwind Logistics. Box 1 wages, tips, other compensation $54,880.00 and a lot more text after it that should be cut off here"
        let snippet = SearchIndex.snippet(text, words: ["w-2"])
        #expect(snippet?.contains("Form W-2 Wage and Tax Statement 2023") == true)
        #expect(snippet?.hasSuffix("…") == true)
        #expect(SearchIndex.snippet(text, words: ["nothing"]) == nil)
    }

    @Test func highlightRangesAreCaseInsensitive() {
        let ranges = SearchIndex.ranges(of: ["w-2", "2023"], in: "2023 W-2, corrected")
        #expect(ranges.map { String("2023 W-2, corrected"[$0]) } == ["2023", "W-2"])
    }

    @Test func searchTermsAreLowercasedTokens() {
        var doc = SampleData.filedDocs()[0]
        doc.amount = "142.17"
        let terms = SearchIndex.terms(for: doc)
        #expect(terms.contains("duke"))
        #expect(terms.contains("2024"))
        #expect(terms.contains("142.17"))
        #expect(terms.allSatisfy { $0 == $0.lowercased() })
    }

    @Test func typingAYearOrTypeTurnsItsChipOn() async {
        let model = SearchViewModel(docs: FakeDocStore(seed: library, paperless: []), drive: FakeDriveService(), defaults: freshDefaults())
        let task = Task { await model.watch() }
        await pilesWaitUntil { model.loaded }
        task.cancel()
        model.query = "tax form 2023"
        #expect(model.isOn(.year(2023)))
        #expect(model.isOn(.docType("Tax form")))
        #expect(model.chips.contains(.year(2023)))
        // Tapping a typed chip takes its words out of the query.
        model.toggle(.year(2023))
        #expect(model.query == "tax form")
        model.toggle(.sensitive)
        #expect(model.isOn(.sensitive))
    }

    @Test func resultsAndDriveHitsSkipFilesTheAppAlreadyHas() async {
        let drive = FakeDriveService()
        drive.searchResults = [
            DriveFileMetadata(id: "drive-pile-w2-2023", name: "2023 W-2.pdf", md5Checksum: nil, size: nil, webViewLink: "https://drive.google.com/a"),
            DriveFileMetadata(id: "old-1", name: "2023 W-2 scan.pdf", md5Checksum: nil, size: nil, webViewLink: "https://drive.google.com/b"),
        ]
        let model = SearchViewModel(docs: FakeDocStore(seed: library, paperless: []), drive: drive, defaults: freshDefaults())
        let task = Task { await model.watch() }
        await pilesWaitUntil { model.loaded }
        task.cancel()
        model.query = "w-2 2023"
        await model.runSearch()
        #expect(model.resultsTitle == "2 results")
        #expect(model.driveHits.map(\.id) == ["old-1"])
        #expect(model.highlightWords == ["w-2", "2023"])
        #expect(!model.showsNoResults)

        drive.searchResults = []
        model.query = "zzzz"
        await model.runSearch()
        #expect(model.showsNoResults)
    }

    @Test func recentsKeepTheLastEightNewestFirst() {
        let defaults = freshDefaults()
        let model = SearchViewModel(docs: FakeDocStore(seed: [], paperless: []), drive: FakeDriveService(), defaults: defaults)
        for i in 1...10 { model.remember("query \(i)") }
        model.remember("QUERY 9")
        #expect(model.recents.count == 8)
        #expect(model.recents.first == "QUERY 9")
        #expect(!model.recents.contains("query 9"))
        model.removeRecent("query 10")
        #expect(!model.recents.contains("query 10"))
        // They survive a new model (kept on this phone).
        let again = SearchViewModel(docs: FakeDocStore(seed: [], paperless: []), drive: FakeDriveService(), defaults: defaults)
        #expect(again.recents == model.recents)
    }

    @Test func suggestedSendersAreTheMostCommon() async {
        let model = SearchViewModel(docs: FakeDocStore(seed: library, paperless: []), drive: FakeDriveService(), defaults: freshDefaults())
        let task = Task { await model.watch() }
        await pilesWaitUntil { model.loaded }
        task.cancel()
        #expect(model.suggestedSenders.first == "Northwind Logistics")
        #expect(model.suggestedSenders.count == 3)
    }

    @Test func olderWebRecordsStillDecode() {
        // An early web doc: no pages, no physical, no paperless hint, an unknown folder.
        let doc = FirestoreRecords.filedDoc(id: "abc", data: [
            "title": "Water bill", "issuer": "City Utilities", "verdict": "shred", "folder": "Utilities",
            "driveId": "", "filedAt": "2025-03-01T10:00:00.000Z",
        ])
        #expect(doc?.id == "abc")
        #expect(doc?.folder == "11 Other")
        #expect(doc?.pages == 1)
        #expect(doc?.filed == false)
        #expect(doc?.physical == .toShred)
        #expect(doc?.paperless.issuer == "City Utilities")
        let keep = FirestoreRecords.filedDoc(id: "k", data: ["verdict": "keep_original", "driveId": "d1"])
        #expect(keep?.physical == .keep)
        #expect(keep?.filed == true)
        #expect(keep?.title == "Untitled document")
        let sender = FirestoreRecords.paperlessSender(id: "duke-energy", data: ["status": "weird"])
        #expect(sender?.issuer == "duke-energy")
        #expect(sender?.status == .toDo)
        #expect(FirestoreRecords.settings(from: ["shredHoldDays": NSNumber(value: 7)]).shredHoldDays == 7)
        #expect(FirestoreRecords.settings(from: [:]).shredHoldDays == 0)
    }

    @Test func aRealRecordRoundTrips() throws {
        var original = library[0]
        original.id = "x1"
        original.fullText = "Some text"
        original.searchTerms = ["some"]
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as! [String: Any]
        #expect(FirestoreRecords.filedDoc(id: "x1", data: json) == original)
    }
}
