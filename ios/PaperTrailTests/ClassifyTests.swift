// Classify: the reading queue (two at a time, retries, hints, unsure fields), the request payload,
// sender rules (the same cases as functions/test/confidence-and-senders.test.mjs), the error
// mapping and copy, the check-fields sheet's model and the Sender rules list.
import Foundation
import Testing
@testable import PaperTrail

/// A classify service that answers from a script and records what it was sent.
final class ScriptedClassifyService: ClassifyService {
    var answers: [Result<DocumentCard, ClassifyFailure>]
    var fallback: DocumentCard
    var delay: Duration = .zero
    private(set) var requests: [ClassifyRequest] = []
    private(set) var running = 0
    private(set) var maxRunning = 0

    init(_ answers: [Result<DocumentCard, ClassifyFailure>] = [], fallback: DocumentCard = SampleData.cascadeBill) {
        self.answers = answers
        self.fallback = fallback
    }

    func classify(_ request: ClassifyRequest) async throws -> ClassifyResponse {
        requests.append(request)
        running += 1
        maxRunning = max(maxRunning, running)
        defer { running -= 1 }
        if delay > .zero { try? await Task.sleep(for: delay) }
        let answer = answers.isEmpty ? .success(fallback) : answers.removeFirst()
        return ClassifyResponse(result: try answer.get(), model: "scripted")
    }
}

@MainActor
struct ClassifyTests {
    static let rule = SenderRule(key: "cascade-power-light", issuer: "Cascade Power & Light", folder: "06 Home",
                                 filenamePattern: "{date}_cascade-electric-bill", verdict: .shred,
                                 docType: "Electric bill", updatedAt: "2026-10-09T12:00:00.000Z")

    /// The JS tests' card with Claude's scores: issuer 0.6, date 0.55.
    static var scored: DocumentCard {
        var card = SampleData.cascadeBill
        card.confidence = CardConfidence(overall: 0.55, fields: ["issuer": 0.6, "docDate": 0.55, "folder": 0.9, "title": 0.97, "filename": 0.92, "verdict": 0.95])
        card.alternatives = ["issuer": ["Cascade Natural Gas"], "docDate": ["2026-10-03"], "folder": [], "title": [], "filename": []]
        return card
    }

    func makeItems(_ env: AppEnvironment, count: Int) throws -> [PipelineItem] {
        let docs = (0..<count).map { index in
            let id = UUID()
            let pdf = FakeCaptureService.pdf(fromTexts: ["Page \(index)"])
            let name = try! env.files.write(pdf, id: id, ext: "pdf")
            return CapturedDocument(id: id, fileName: name, pageCount: 1, sizeBytes: pdf.count,
                                    contentHash: "h\(index)", origin: "scan", ocrText: "Cascade Power\nPage \(index)")
        }
        return CaptureIntake.add(docs, to: env.modelContainer.mainContext)
    }

    // MARK: Sender rules, the same cases as the function

    @Test func ruleIsAppliedDeterministicallyAndItsFieldsBecomeCertain() {
        let once = SenderRuleEngine.apply([Self.rule], to: Self.scored)
        #expect(once == SenderRuleEngine.apply([Self.rule], to: Self.scored))
        #expect(once.appliedRule == "cascade-power-light")
        #expect(once.folder == "06 Home")
        #expect(once.verdict == .shred)
        #expect(once.docType == "Electric bill")
        #expect(once.filename == "2026-09-28_cascade-electric-bill")
        #expect(once.confidence?.fields["issuer"] == 1)
        #expect(once.confidence?.fields["verdict"] == 1)
        #expect(once.confidence?.fields["docDate"] == 0.55)
        #expect(once.confidence?.overall == 0.55)
        #expect(once.alternatives?["issuer"] == [])
        #expect(once.alternatives?["docDate"] == ["2026-10-03"])
    }

    @Test func rulesSpellingWinsAndNoMatchLeavesTheCardAlone() {
        var card = Self.scored
        card.issuer = "CASCADE POWER & LIGHT"
        #expect(SenderRuleEngine.apply([Self.rule], to: card).issuer == "Cascade Power & Light")
        card.issuer = "Cascade Power and Light"
        #expect(SenderRuleEngine.apply([Self.rule], to: card) == card)
        var partial = Self.rule
        partial.verdict = nil
        partial.filenamePattern = nil
        let out = SenderRuleEngine.apply([partial], to: SampleData.cascadeBill)
        #expect(out.verdict == SampleData.cascadeBill.verdict)
        #expect(out.filename == SampleData.cascadeBill.filename)
    }

    @Test func renderFilenameFillsEveryToken() {
        let card = SampleData.cascadeBill
        #expect(SenderRuleEngine.renderFilename("{date}_cascade-electric-bill", card: card) == "2026-09-28_cascade-electric-bill")
        #expect(SenderRuleEngine.renderFilename("{yyyy}-{mm}_{issuer}_{type}", card: card) == "2026-09_cascade-power-light_utility-bill")
        var undated = card
        undated.docDate = ""
        #expect(SenderRuleEngine.renderFilename("{date}_x", card: undated) == "0000-00-00_x")
        #expect(SenderRuleEngine.renderFilename("a/b:{yyyy}.pdf", card: card) == "a-b-2026")
    }

    @Test func aConfirmedFilenameBecomesADatePattern() {
        #expect(SenderRuleEngine.pattern(fromFilename: "2026-09-28_cascade-electric-bill", docDate: "2026-09-28") == "{date}_cascade-electric-bill")
        #expect(SenderRuleEngine.pattern(fromFilename: "cascade.pdf", docDate: "2026-09-28") == "cascade")
        #expect(SenderRuleEngine.folderName("02 Taxes") == "Taxes")
        #expect(SenderRuleEngine.folderName("Other") == "Other")
    }

    // MARK: Contract

    @Test func decodesTheExtendedReplyAndFindsUnsureFields() throws {
        let json = """
        {"result":{"title":"T","docType":"Utility bill","issuer":"Cascade Power & Light","docDate":"2026-09-28","summary":"",
        "folder":"06 Home","filename":"f","verdict":"scan_shred","verdictReason":"","retention":"","sensitive":false,
        "paperless":{"possible":false,"issuer":"","how":""},
        "confidence":{"overall":0.55,"fields":{"issuer":0.6,"docDate":0.55,"folder":0.9,"title":0.97,"filename":0.92,"verdict":0.95}},
        "alternatives":{"issuer":["Cascade Natural Gas"],"docDate":[],"folder":[],"title":[],"filename":[]},
        "appliedRule":"cascade-power-light"},"model":"claude-opus-5-5"}
        """
        let reply = try JSONDecoder().decode(ClassifyResponse.self, from: Data(json.utf8))
        #expect(reply.result.confidence?.unsureFields == ["issuer", "docDate"])
        #expect(reply.result.alternatives?["issuer"] == ["Cascade Natural Gas"])
        #expect(reply.result.appliedRule == "cascade-power-light")
    }

    @Test func unscoredFieldsAreNotFlagged() {
        #expect(CardConfidence(overall: 0.97, fields: [:]).unsureFields.isEmpty)
        #expect(SampleData.cards[1].confidence?.unsureFields == ["docDate", "verdict"])
    }

    @Test func confidentMeansNoUnsureFields() {
        var card = SampleData.cascadeBill
        #expect(card.isConfident == false)   // two fields to check
        card.confidence = CardConfidence(overall: 0.8, fields: ["issuer": 0.8, "docDate": 0.8, "folder": 0.9,
                                                                 "title": 0.9, "filename": 0.9, "verdict": 0.9])
        #expect(card.isConfident)            // nothing below 0.75, so nothing to check
        card.confidence = nil
        #expect(card.isConfident == false)   // no data is never confident
    }

    // MARK: Reading queue

    @Test func sendsConfidenceOCRAndHintsAndAppliesTheRuleWhenTheFunctionDidNot() async throws {
        let env = AppEnvironment.sample()
        try await env.docs.saveSenderRule(Self.rule)
        let service = ScriptedClassifyService(fallback: Self.scored)
        let items = try makeItems(env, count: 1)
        await ReadingQueue(classify: service, files: env.files, docs: env.docs, backoff: []).read(items)
        let request = try #require(service.requests.first)
        #expect(request.wantConfidence == true)
        #expect(request.kind == .pdf)
        #expect(request.ocrText?.hasPrefix("Cascade Power") == true)
        #expect(request.senderHints?.contains { $0.key == Self.rule.key } == true)
        let item = items[0]
        #expect(item.stage == .ready)
        #expect(item.card?.appliedRule == "cascade-power-light")
        #expect(item.card?.verdict == .shred)
        #expect(item.unsureFields == ["docDate"])
    }

    @Test func readsTwoAtATime() async throws {
        let env = AppEnvironment.sample()
        let service = ScriptedClassifyService()
        service.delay = .milliseconds(30)
        let items = try makeItems(env, count: 5)
        await ReadingQueue(classify: service, files: env.files, backoff: []).read(items)
        #expect(service.requests.count == 5)
        #expect(service.maxRunning == 2)
        #expect(items.allSatisfy { $0.stage == .ready })
    }

    @Test func retriesOnlyRetryableCodes() async throws {
        let env = AppEnvironment.sample()
        let flaky = ScriptedClassifyService([.failure(.init(code: .overloaded, message: "")), .failure(.init(code: .timeout, message: ""))])
        let first = try makeItems(env, count: 1)
        await ReadingQueue(classify: flaky, files: env.files, backoff: [.zero, .zero]).read(first)
        #expect(flaky.requests.count == 3)
        #expect(first[0].stage == .ready)

        let tooBig = ScriptedClassifyService([.failure(.init(code: .tooLarge, message: ""))])
        let second = try makeItems(env, count: 1)
        await ReadingQueue(classify: tooBig, files: env.files, backoff: [.zero, .zero]).read(second)
        #expect(tooBig.requests.count == 1)
        #expect(second[0].stage == .failed)
        #expect(second[0].readErrorCode == "too_large")
        #expect(second[0].errorMessage == "This one is too big to send to Claude. Your scan is saved.")
    }

    @Test func givesUpAfterThreeAttemptsAndTryAgainReadsAgain() async throws {
        let env = AppEnvironment.sample()
        let down = ScriptedClassifyService(Array(repeating: .failure(.init(code: .overloaded, message: "")), count: 3))
        let items = try makeItems(env, count: 1)
        let queue = ReadingQueue(classify: down, files: env.files, backoff: [.zero, .zero])
        await queue.read(items)
        #expect(down.requests.count == 3)
        #expect(items[0].stage == .failed)
        #expect(items[0].errorMessage == "Claude didn't answer. Your scan is saved.")
        await queue.retry(items[0])
        #expect(items[0].stage == .ready)
        #expect(items[0].errorMessage == nil)
    }

    // MARK: Payload

    @Test func bigPDFsGoAsTheFirstTenPageImages() async throws {
        let files = FileStore.temporary()
        let small = try files.write(FakeCaptureService.pdf(fromTexts: ["a", "b"]), id: UUID(), ext: "pdf")
        let whole = try await ClassifyPayload.request(pdfAt: files.url(for: small), pageCount: 2, ocrText: "", senderHints: [])
        #expect(whole.kind == .pdf)
        #expect(whole.ocrText == nil)
        #expect(whole.senderHints == nil)

        let long = try files.write(FakeCaptureService.pdf(fromTexts: (1...12).map { "Page \($0)" }), id: UUID(), ext: "pdf")
        let images = try await ClassifyPayload.request(pdfAt: files.url(for: long), pageCount: 12, ocrText: nil, senderHints: [])
        #expect(images.kind == .images)
        #expect(images.images?.count == 10)
        #expect(images.totalPages == 12)
        #expect(images.images?.first?.type == "image/jpeg")
    }

    // MARK: Errors

    @Test func detailsCodeWinsThenTheCallableCode() {
        #expect(LiveClassifyService.failure(detailsCode: "too_large", callableCode: .invalidArgument, message: "").code == .tooLarge)
        #expect(LiveClassifyService.failure(detailsCode: nil, callableCode: .unauthenticated, message: "").code == .signedOut)
        #expect(LiveClassifyService.failure(detailsCode: nil, callableCode: .resourceExhausted, message: "").code == .rateLimited)
        #expect(LiveClassifyService.failure(detailsCode: "nonsense", callableCode: .notFound, message: "").code == .unknown)
        #expect(LiveClassifyService.failure(from: URLError(.timedOut)).code == .timeout)
    }

    @Test func copyFollowsTheVoiceRules() {
        for code in ClassifyErrorCode.allCases {
            let line = ClassifyCopy.message(for: code)
            #expect(!line.contains("—") && !line.contains("!"), "\(code)")
        }
        #expect(ClassifyCopy.failedTitle == "Couldn't read this one")
        #expect(ClassifyCopy.message(for: .overloaded) == "Claude didn't answer. Your scan is saved.")
    }

    // MARK: Check-fields sheet

    func sheetItem() -> PipelineItem {
        let item = PipelineItem(fileName: "items/x.pdf", pageCount: 1, sizeBytes: 1, origin: "scan", stage: .ready)
        item.card = SampleData.cascadeBill
        item.unsureFields = SampleData.cascadeBill.confidence?.unsureFields ?? []
        return item
    }

    @Test func sheetShowsTheA2Copy() {
        let model = CheckFieldsModel(item: sheetItem(), docs: FakeDocStore(rules: []))
        #expect(model.fields == ["issuer", "docDate"])
        #expect(model.title == "Check 2 fields")
        #expect(model.label(for: "issuer") == "Sender")
        #expect(model.label(for: "docDate") == "Statement date")
        #expect(model.options(for: "issuer").map(\.value) == ["Cascade Power & Light", "Cascade Natural Gas"])
        #expect(model.options(for: "issuer").map(\.likelihood) == [.likely, .possible])
        #expect(CheckFieldsModel.displayDate("2026-09-28") == "Sep 28, 2026")
        #expect(model.rememberFooter == "Next time, Cascade Power & Light files this way without asking.")
    }

    @Test func confirmWritesTheCardAndRemembersTheSender() async throws {
        let docs = FakeDocStore(rules: [])
        let model = CheckFieldsModel(item: sheetItem(), docs: docs)
        model.select("2026-10-03", for: "docDate")
        let item = await model.confirm(now: Date(timeIntervalSince1970: 0))
        let card = try #require(item.card)
        #expect(card.docDate == "2026-10-03")
        #expect(card.filename == "2026-10-03_cascade-power-electric-bill", "the filename follows the date")
        #expect(card.confidence?.fields["docDate"] == 1)
        #expect(card.confidence?.overall == 0.88)
        #expect(item.unsureFields.isEmpty)
        let rule = try #require(try await docs.senderRules().first)
        #expect(rule.key == "cascade-power-light")
        #expect(rule.filenamePattern == "{date}_cascade-power-electric-bill")
        #expect(rule.folder == "06 Home")
        #expect(rule.updatedAt == "1970-01-01T00:00:00.000Z")
    }

    @Test func somethingElseAndRememberOff() async throws {
        let docs = FakeDocStore(rules: [])
        let model = CheckFieldsModel(item: sheetItem(), docs: docs)
        model.chooseCustom("issuer")
        model.customText["issuer"] = "  Cascade Electric Co-op "
        model.remember = false
        let card = try #require(await model.confirm().card)
        #expect(card.issuer == "Cascade Electric Co-op")
        #expect(try await docs.senderRules().isEmpty)

        let blank = CheckFieldsModel(item: sheetItem(), docs: docs)
        blank.chooseCustom("issuer")
        #expect(blank.confirmedCard().issuer == "Cascade Power & Light", "a blank Something else keeps Claude's value")
    }

    @Test func dateLabelUsesTheDocumentType() {
        #expect(CheckFieldsModel.dateLabel(docType: "Bank statement") == "Statement date")
        #expect(CheckFieldsModel.dateLabel(docType: "Invoice") == "Invoice date")
        #expect(CheckFieldsModel.dateLabel(docType: "") == "Date")
    }

    // MARK: Sender rules list

    @Test func senderRulesListSortsFiltersAndForgets() async {
        let model = SenderRulesViewModel(docs: FakeDocStore())
        await model.load()
        #expect(model.visible.map(\.issuer) == ["Big Box Furniture", "Duke Energy", "Harbor Federal CU"])
        model.query = "duke"
        #expect(model.visible.map(\.issuer) == ["Duke Energy"])
        #expect(SenderRulesViewModel.subtitle(for: model.visible[0]) == "Home · Scan + shred · {date}_duke-energy-electric-bill")
        #expect(SenderRulesViewModel.updatedFooter(for: model.visible[0]) == "Updated Oct 9")
        await model.forget(model.visible[0])
        await model.load()
        #expect(model.count == 2)
    }

    @Test func filenamePreviewFillsTheTokens() {
        let preview = SenderRulesViewModel.preview(pattern: "{date}_cascade-electric-bill", rule: Self.rule, docType: "Electric bill",
                                                   today: CheckFieldsModel.dateFromISODay("2026-09-28")!)
        #expect(preview == "2026-09-28_cascade-electric-bill.pdf")
        #expect(SenderRulesViewModel.preview(pattern: " ", rule: Self.rule, docType: "") == "")
    }
}
