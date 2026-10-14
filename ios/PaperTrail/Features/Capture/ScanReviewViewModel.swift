// Owner: capture. Spec 4.11 and 4.15; issues #19, #2, #22, #17.
//
// The scan review: pages grouped into documents, split and join, rotate and delete, and each
// group read as it forms (OCR, PDF with a text layer, hash and duplicate check, then Claude
// through the classify ReadingQueue). "Send to the deck" adds the groups' items to SwiftData;
// groups still reading join the deck as soon as they're done.
//
// Logic only, no SwiftUI: ScanReviewScreen draws this.
import Foundation
import SwiftData

@Observable
final class ScanReviewViewModel {
    enum GroupStatus: Equatable {
        /// OCR or Claude still working. `page` is the page OCR is on (the last page while Claude reads).
        case reading(page: Int)
        /// Claude's card is back: "{docType} · {issuer}".
        case read(header: String)
        /// The read failed. The card still goes to the deck, where it offers Try again.
        case failed
    }

    struct GroupState {
        var status: GroupStatus = .reading(page: 1)
        var duplicate: DuplicateMatch?
        var document: CapturedDocument?
        var item: PipelineItem?
    }

    /// Where pages added later go.
    enum Placement {
        /// Scan more: onto the end of the last document.
        case appendToLast
        /// Photos picked together: one new document.
        case oneGroup
        /// Files: each inner list is one new document.
        case groups([[UUID]])
    }

    /// Optional split proposal (#19): page texts in, page index groups out. The classify agent's
    /// `ClassifyService.proposeSplit(pageTexts:)` plugs in here once it exists; until then a scan
    /// starts as one document and the person splits it by hand (spec 4.11 fallback).
    typealias SplitProposer = ([String]) async -> [[Int]]

    private(set) var session: ReviewSession
    private(set) var states: [UUID: GroupState] = [:]
    /// Small page JPEGs for the review strip, by page ID.
    private(set) var thumbnails: [UUID: Data] = [:]
    private(set) var isSent = false
    /// Called whenever items join SwiftData (so Sort can refresh the deck).
    var onAdded: () -> Void = {}

    private let files: FileStore
    private let context: ModelContext
    private let reader: ReadingQueue
    private let docs: any DocStore
    private let proposeSplit: SplitProposer?
    private var texts: [String: PageText] = [:]
    private var pdfCache: [String: Data] = [:]
    private var tasks: [UUID: Task<Void, Never>] = [:]
    /// The split proposal in flight, if any (#19).
    private var proposalTask: Task<Void, Never>?
    private var inserted: Set<UUID> = []
    private var filedKnown: [KnownDocument]?

    init(session: ReviewSession, env: AppEnvironment, proposeSplit: SplitProposer? = nil) {
        self.session = session
        self.files = env.files
        self.context = env.modelContainer.mainContext
        self.reader = ReadingQueue(classify: env.classify, files: env.files)
        self.docs = env.docs
        self.proposeSplit = proposeSplit
    }

    // MARK: - What the screen shows

    var groups: [ReviewGroup] { session.groups }
    var pageCount: Int { session.groups.reduce(0) { $0 + $1.pageIDs.count } }
    var documentCount: Int { session.groups.count }
    var sendCount: Int { session.groups.filter { !$0.skipped }.count }
    var canSend: Bool { sendCount > 0 && !isSent }

    /// "4 pages, 3 documents", "2 files, 2 documents", "3 photos, 1 document".
    var title: String {
        let documents = Self.count(documentCount, "document", "documents")
        switch session.kind {
        case .scan: return "\(Self.count(pageCount, "page", "pages")), \(documents)"
        case .files: return "\(Self.count(fileCount, "file", "files")), \(documents)"
        case .photos: return "\(Self.count(pageCount, "photo", "photos")), \(documents)"
        }
    }

    let subtitle = "Tap between pages to split or join"
    var sendTitle: String { "Send \(sendCount) to the deck" }
    /// "Scan more" for a scan, "Add more" for imports (spec 4.15).
    var moreTitle: String { session.kind == .scan ? "Scan more" : "Add more" }
    var discardTitle: String { "Discard \(Self.count(pageCount, "page", "pages"))?" }

    func pages(in group: ReviewGroup) -> [ReviewPage] { group.pageIDs.compactMap(session.page) }
    func state(_ group: ReviewGroup) -> GroupState { states[group.id] ?? GroupState() }

    /// Header row text and whether it's read (spec 4.11): "Electric bill · Cascade Power & Light"
    /// or "Reading page 2".
    func header(_ group: ReviewGroup) -> (text: String, isRead: Bool) {
        switch state(group).status {
        case let .reading(page): ("Reading page \(page)", false)
        case let .read(header): (header, true)
        case .failed: ("Couldn't read this one", false)
        }
    }

    private var fileCount: Int {
        Set(session.groups.flatMap(pages(in:)).map { $0.pdf ?? $0.id.uuidString }).count
    }

    static func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

    static func header(for card: DocumentCard) -> String {
        [card.docType, card.issuer].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: - Lifecycle

    /// Starts reading every group. Call once after the review appears.
    func start() {
        persist()
        Task { await loadThumbnails(session.pages) }
        if let proposeSplit, session.kind == .scan, session.groups.count == 1, pageCount > 1 {
            proposalTask = Task { [weak self] in
                await self?.applyProposal(proposeSplit)
                self?.proposalTask = nil
            }
        } else {
            session.groups.forEach(process)
        }
    }

    /// Waits until every group is read. For tests.
    func waitUntilIdle() async {
        if let proposalTask { await proposalTask.value }
        while let task = tasks.values.first { await task.value }
    }

    // MARK: - Editing

    /// Splits a document after page `index` (0-based) into two documents.
    func split(_ groupID: UUID, after index: Int) {
        guard !isSent, let at = session.groups.firstIndex(where: { $0.id == groupID }) else { return }
        let ids = session.groups[at].pageIDs
        guard ids.indices.contains(index), index < ids.count - 1 else { return }
        replace(at: at, with: [ReviewGroup(pageIDs: Array(ids[...index])), ReviewGroup(pageIDs: Array(ids[(index + 1)...]))])
    }

    /// Joins a document into the one above it.
    func join(_ groupID: UUID) {
        guard !isSent, let at = session.groups.firstIndex(where: { $0.id == groupID }), at > 0 else { return }
        let merged = ReviewGroup(pageIDs: session.groups[at - 1].pageIDs + session.groups[at].pageIDs)
        drop(session.groups[at])
        session.groups.remove(at: at)
        replace(at: at - 1, with: [merged])
    }

    /// Turns a page a quarter turn clockwise.
    func rotate(_ pageID: UUID) {
        guard !isSent, let p = session.pages.firstIndex(where: { $0.id == pageID }) else { return }
        session.pages[p].quarterTurns = (session.pages[p].quarterTurns + 1) % 4
        thumbnails[pageID] = nil
        Task { await loadThumbnails([session.pages[p]]) }
        refreshGroup(containing: pageID)
    }

    func deletePage(_ pageID: UUID) {
        guard !isSent, let at = session.groups.firstIndex(where: { $0.pageIDs.contains(pageID) }) else { return }
        let rest = session.groups[at].pageIDs.filter { $0 != pageID }
        session.pages.removeAll { $0.id == pageID }
        if rest.isEmpty {
            drop(session.groups[at])
            session.groups.remove(at: at)
            persist()
        } else {
            replace(at: at, with: [ReviewGroup(pageIDs: rest)])
        }
    }

    /// The duplicate line's "Skip" (true) and "File again" (false).
    func setSkipped(_ groupID: UUID, _ skipped: Bool) {
        guard !isSent, let at = session.groups.firstIndex(where: { $0.id == groupID }) else { return }
        session.groups[at].skipped = skipped
        persist()
    }

    /// Adds pages already written to the session folder (Scan more, Add more).
    func add(_ pages: [ReviewPage], placement: Placement) {
        guard !isSent, !pages.isEmpty else { return }
        session.pages += pages
        Task { await loadThumbnails(pages) }
        let ids = pages.map(\.id)
        switch placement {
        case .appendToLast:
            if let last = session.groups.indices.last {
                replace(at: last, with: [ReviewGroup(pageIDs: session.groups[last].pageIDs + ids)])
            } else {
                appendGroups([ReviewGroup(pageIDs: ids)])
            }
        case .oneGroup:
            appendGroups([ReviewGroup(pageIDs: ids)])
        case let .groups(lists):
            appendGroups(lists.map { ReviewGroup(pageIDs: $0) })
        }
    }

    // MARK: - Send and discard

    /// "Send {d} to the deck". Read groups go in now; the rest go in as they finish.
    func send() {
        guard canSend else { return }
        isSent = true
        for group in session.groups {
            if group.skipped {
                tasks[group.id]?.cancel()
                drop(group)
            } else {
                insert(group.id)
            }
        }
        session.groups.removeAll(where: \.skipped)
        persist()
        onAdded()
        finishIfDone()
    }

    /// Cancel, then "Discard": nothing reaches the deck and every page is deleted.
    func discard() {
        proposalTask?.cancel()
        for group in session.groups {
            tasks[group.id]?.cancel()
            drop(group)
        }
        session.groups = []
        ReviewStore.remove(session.id, files: files)
    }

    // MARK: - Reading a group

    private func appendGroups(_ new: [ReviewGroup]) {
        session.groups += new
        persist()
        new.forEach(process)
    }

    private func replace(at index: Int, with new: [ReviewGroup]) {
        drop(session.groups[index])
        session.groups.replaceSubrange(index...index, with: new)
        persist()
        new.forEach(process)
    }

    private func refreshGroup(containing pageID: UUID) {
        guard let at = session.groups.firstIndex(where: { $0.pageIDs.contains(pageID) }) else { return }
        replace(at: at, with: [ReviewGroup(pageIDs: session.groups[at].pageIDs)])
    }

    /// Forgets a group's read and deletes its built PDF, unless it already went to the deck.
    private func drop(_ group: ReviewGroup) {
        tasks[group.id]?.cancel()
        tasks[group.id] = nil
        if !inserted.contains(group.id), let doc = states[group.id]?.document {
            DocumentBuilder.remove(doc, from: files)
        }
        states[group.id] = nil
    }

    private func isCurrent(_ id: UUID) -> Bool { session.groups.contains { $0.id == id } }

    private func process(_ group: ReviewGroup) {
        states[group.id] = GroupState()
        let id = group.id
        tasks[id] = Task { [weak self] in
            await self?.read(group)
            self?.tasks[id] = nil
        }
    }

    private func read(_ group: ReviewGroup) async {
        let pages = pages(in: group)
        var sources: [SourcePage] = []
        var pageTexts: [PageText] = []
        for (index, page) in pages.enumerated() {
            guard isCurrent(group.id), !Task.isCancelled else { return }
            states[group.id]?.status = .reading(page: index + 1)
            guard let source = source(for: page) else { continue }
            sources.append(source)
            pageTexts.append(await text(for: page, source: source))
        }
        guard isCurrent(group.id), !Task.isCancelled else { return }
        guard !sources.isEmpty,
              let doc = await Self.build(sources, pageTexts, original: originalPDF(for: pages),
                                         origin: session.kind.origin, files: files)
        else {
            states[group.id]?.status = .failed
            return
        }
        guard isCurrent(group.id) else { return DocumentBuilder.remove(doc, from: files) }
        states[group.id]?.document = doc
        let duplicate = await duplicateMatch(for: doc)
        guard isCurrent(group.id) else { return }
        let item = CaptureIntake.makeItem(doc)
        states[group.id]?.duplicate = duplicate
        states[group.id]?.item = item
        if isSent { insert(group.id) }

        await reader.read([item])
        guard isCurrent(group.id) || inserted.contains(group.id) else { return }
        states[group.id]?.status = item.card.map { .read(header: Self.header(for: $0)) } ?? .failed
        if inserted.contains(group.id) {
            try? context.save()
            onAdded()
            finishIfDone()
        }
    }

    @concurrent
    private nonisolated static func build(_ pages: [SourcePage], _ texts: [PageText], original: Data?,
                                          origin: String, files: FileStore) async -> CapturedDocument? {
        try? DocumentBuilder.build(pages: pages, texts: texts, original: original, origin: origin, files: files)
    }

    private func insert(_ groupID: UUID) {
        guard !inserted.contains(groupID), let item = states[groupID]?.item else { return }
        inserted.insert(groupID)
        CaptureIntake.add(items: [item], to: context)
        if let at = session.groups.firstIndex(where: { $0.id == groupID }) { session.groups[at].sent = true }
        persist()
    }

    /// Once every sent group is in SwiftData, the review's page files aren't needed: each item's
    /// PDF lives in FileStore's items folder.
    private func finishIfDone() {
        guard isSent, session.groups.allSatisfy({ inserted.contains($0.id) }) else { return }
        ReviewStore.remove(session.id, files: files)
    }

    private func persist() {
        guard !session.groups.isEmpty || !session.pages.isEmpty else { return }
        try? ReviewStore.save(session, files: files)
    }

    // MARK: - Pages

    private func source(for page: ReviewPage) -> SourcePage? {
        if let image = page.image, let data = try? files.read(image) {
            return SourcePage(content: .jpeg(data), quarterTurns: page.quarterTurns)
        }
        if let path = page.pdf, let index = page.pdfIndex, let data = pdfData(path) {
            return SourcePage(content: .pdf(data, index: index), quarterTurns: page.quarterTurns)
        }
        return nil
    }

    private func pdfData(_ path: String) -> Data? {
        if let cached = pdfCache[path] { return cached }
        let data = try? files.read(path)
        pdfCache[path] = data
        return data
    }

    /// An imported PDF's original bytes, when the group is exactly that file: every page, in
    /// order, none turned. Anything else is assembled fresh.
    private func originalPDF(for pages: [ReviewPage]) -> Data? {
        guard let path = pages.first?.pdf, pages.allSatisfy({ $0.pdf == path && $0.quarterTurns == 0 }),
              let data = pdfData(path),
              pages.map({ $0.pdfIndex ?? -1 }) == Array(0..<PageAssembler.pageCount(ofPDF: data))
        else { return nil }
        return data
    }

    private func text(for page: ReviewPage, source: SourcePage) async -> PageText {
        let key = "\(page.id.uuidString)-\(page.quarterTurns)"
        if let cached = texts[key] { return cached }
        let text = await DocumentBuilder.text(for: source)
        texts[key] = text
        return text
    }

    private func loadThumbnails(_ pages: [ReviewPage]) async {
        for page in pages {
            guard let source = source(for: page) else { continue }
            thumbnails[page.id] = await Self.thumbnail(source)
        }
    }

    @concurrent
    private nonisolated static func thumbnail(_ source: SourcePage) async -> Data? {
        // 66 x 86 pt at 3x.
        DocumentBuilder.thumbnail(of: source, maxPixel: 260)
    }

    private func applyProposal(_ propose: SplitProposer) async {
        guard let group = session.groups.first else { return }
        states[group.id] = GroupState()
        var pageTexts: [String] = []
        for (index, page) in pages(in: group).enumerated() {
            states[group.id]?.status = .reading(page: index + 1)
            guard let source = source(for: page) else { pageTexts.append(""); continue }
            pageTexts.append(await text(for: page, source: source).text)
        }
        let proposal = await propose(pageTexts)
        // The person split, joined or edited while Claude was proposing: their edit wins.
        guard isCurrent(group.id) else { return }
        // Already sent, or a proposal that doesn't fit: keep it as one document.
        guard !isSent, Self.isValid(proposal, pageCount: group.pageIDs.count) else { return process(group) }
        let ids = group.pageIDs
        states[group.id] = nil
        session.groups = proposal.map { ReviewGroup(pageIDs: $0.map { ids[$0] }) }
        persist()
        session.groups.forEach(process)
    }

    /// A proposal must cover every page once, in order.
    static func isValid(_ proposal: [[Int]], pageCount: Int) -> Bool {
        !proposal.contains(where: \.isEmpty) && proposal.flatMap { $0 } == Array(0..<pageCount)
    }

    // MARK: - Duplicates (#2)

    private func duplicateMatch(for doc: CapturedDocument) async -> DuplicateMatch? {
        let hash = doc.contentHash
        let id = doc.id
        let descriptor = FetchDescriptor<PipelineItem>(predicate: #Predicate { $0.contentHash == hash && $0.id != id })
        let onPhone = ((try? context.fetch(descriptor)) ?? []).map {
            KnownDocument(contentHash: hash, title: $0.card?.title ?? "", date: $0.createdAt, kind: .onPhone)
        }
        return DuplicateCheck.match(hash, in: await knownFiled() + onPhone)
    }

    /// The filed docs' hashes, read once per review. Gives up after 3 seconds offline: a missed
    /// warning is better than a stuck review.
    private func knownFiled() async -> [KnownDocument] {
        if let filedKnown { return filedKnown }
        let stream = docs.docs()
        let first: [FiledDoc]? = await withTaskGroup(of: [FiledDoc]?.self) { group in
            group.addTask {
                for await list in stream { return list }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(3))
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
        let known = DuplicateCheck.known(from: first ?? [])
        if first != nil { filedKnown = known }
        return known
    }
}
