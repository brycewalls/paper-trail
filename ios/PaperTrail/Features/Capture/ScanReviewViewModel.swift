// Owner: capture. Spec 4.11 and 4.15; issues #19, #2, #22, #17.
//
// The scan review: pages grouped into documents, split and join, rotate and delete, and each
// group read as it forms (OCR, PDF with a text layer, hash and duplicate check, then Claude
// through the classify ReadingQueue). "Send to the deck" adds the groups' items to SwiftData;
// groups still reading join the deck as soon as they're done.
//
// A scanned pile (#54): a multi-page scan group is OCR'd and built at once, but Claude's read
// waits until the split is decided, so a pile that gets split never spends a read on the whole
// stack. "Split into documents" finishing (split, one document, or failed), the person cutting
// or joining it, and Send each decide it; the resulting documents are read then.
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
        /// A scanned pile, OCR'd and built, waiting for the split decision before Claude reads it (#54).
        case held
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

    /// Stack mode (#19): a pile's pages in, where each document starts out. Defaults to
    /// `ClassifyService.proposeSplit`; tests pass their own.
    typealias SplitProposer = (SplitRequest) async throws -> [SplitDocument]

    /// "Split into documents" (#19): offered after a multi-page scan or import.
    enum SplitState: Equatable {
        /// Not asked yet (or pages were added since).
        case idle
        /// Claude is finding where each document starts.
        case splitting
        /// Applied. `documents` is how many documents the review holds now.
        case done(documents: Int)
        /// Claude couldn't split it; the pages stay as they were.
        case failed
    }

    private(set) var session: ReviewSession
    private(set) var states: [UUID: GroupState] = [:]
    /// Small page JPEGs for the review strip, by page ID.
    private(set) var thumbnails: [UUID: Data] = [:]
    private(set) var isSent = false
    private(set) var splitState: SplitState = .idle
    /// Called whenever items join SwiftData (so Sort can refresh the deck).
    var onAdded: () -> Void = {}

    private let files: FileStore
    private let context: ModelContext
    /// Held so the context's container outlives any read still running (a mainContext doesn't
    /// keep its container alive, and fetching after it's gone traps).
    private let container: ModelContainer
    private let reader: ReadingQueue
    private let docs: any DocStore
    private let proposeSplit: SplitProposer
    private var texts: [String: PageText] = [:]
    private var pdfCache: [String: Data] = [:]
    private var tasks: [UUID: Task<Void, Never>] = [:]
    /// Which run owns `tasks[id]`, so a replaced run never clears its successor's entry (#66).
    private var taskTokens: [UUID: UUID] = [:]
    /// Scanned piles whose split isn't decided yet: Claude's read waits for it (#54).
    private var undecided: Set<UUID> = []
    /// "Split into documents" in flight, if any (#19).
    private var proposalTask: Task<Void, Never>?
    private var inserted: Set<UUID> = []
    private var filedKnown: [KnownDocument]?

    init(session: ReviewSession, env: AppEnvironment, proposeSplit: SplitProposer? = nil) {
        self.session = session
        self.files = env.files
        self.container = env.modelContainer
        self.context = env.modelContainer.mainContext
        self.reader = ReadingQueue(env: env)   // classify: sends and applies sender rules (#21)
        self.docs = env.docs
        let classify = env.classify
        self.proposeSplit = proposeSplit ?? { try await classify.proposeSplit($0) }
        if session.kind == .scan {
            undecided = Set(session.groups.filter { $0.pageIDs.count > 1 && $0.label == nil && !$0.sent }.map(\.id))
        }
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

    // Stack mode (#19).
    /// A document with more than one page that Claude could split.
    var hasStack: Bool { session.groups.contains { $0.pageIDs.count > 1 } }
    /// Show the "Split into documents" row: before the first split, or to try again.
    var offersSplit: Bool { !isSent && hasStack && (splitState == .idle || splitState == .failed) }
    let splitTitle = "Split into documents"
    var splitDetail: String {
        switch splitState {
        case .idle: "Claude finds where each document starts. You can change any split after."
        case .splitting: "Finding where each document starts"
        case let .done(documents) where documents == 1:
            "Claude thinks this is one document. Split it with the scissors if not."
        case let .done(documents): "Claude found \(documents) documents. Fix any split with the scissors or Join."
        case .failed: "Claude couldn't split this stack. Split it with the scissors, or try again."
        }
    }

    func pages(in group: ReviewGroup) -> [ReviewPage] { group.pageIDs.compactMap(session.page) }
    func state(_ group: ReviewGroup) -> GroupState { states[group.id] ?? GroupState() }

    /// Header row text and whether it's read (spec 4.11): "Electric bill · Cascade Power & Light"
    /// or "Reading page 2".
    func header(_ group: ReviewGroup) -> (text: String, isRead: Bool) {
        switch state(group).status {
        case let .reading(page): (group.label ?? "Reading page \(page)", false)
        case let .read(header): (header, true)
        case .failed: ("Couldn't read this one", false)
        case .held: (group.label ?? Self.heldHeader, false)
        }
    }

    private var fileCount: Int {
        Set(session.groups.flatMap(pages(in:)).map { $0.pdf ?? $0.id.uuidString }).count
    }

    /// A scanned pile's header until the split is decided (#54).
    static let heldHeader = "Reads when you split or send"

    static func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

    static func header(for card: DocumentCard) -> String {
        [card.docType, card.issuer].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: - Lifecycle

    /// Starts reading every group not already being read. Call once after the review appears.
    func start() {
        persist()
        Task { await loadThumbnails(session.pages) }
        session.groups.filter { tasks[$0.id] == nil && states[$0.id] == nil }.forEach(process)
    }

    /// "Split into documents" (#19): asks Claude where each document in every multi-page group
    /// starts and splits them to match, each new group labeled until its card is read. The person
    /// adjusts with the scissors and Join as usual. An edit to a group while Claude works wins over
    /// the proposal for that group; a failure leaves the pages as they were.
    func splitIntoDocuments() {
        guard offersSplit else { return }
        splitState = .splitting
        let targets = session.groups.filter { $0.pageIDs.count > 1 }
        proposalTask = Task { [weak self] in
            var ok = true
            for group in targets {
                guard let self, !Task.isCancelled else { return }
                if await !self.propose(group) { ok = false }
            }
            guard let self, !Task.isCancelled else { return }
            self.proposalTask = nil
            if self.splitState == .splitting {
                self.splitState = ok ? .done(documents: self.documentCount) : .failed
            }
            // Split, one document or failed (kept as it was): the split is decided, so read what's left.
            self.releaseHeld()
        }
    }

    /// Waits until nothing is running: the split proposal and every group's read. A scanned pile
    /// held for its split (#54) counts as idle. For tests.
    func waitUntilIdle() async {
        while true {
            if let proposal = proposalTask {
                await proposal.value
                if proposalTask == proposal { proposalTask = nil }
            } else if let (id, task) = tasks.first {
                await task.value
                if tasks[id] == task { tasks[id] = nil }
            } else {
                return
            }
        }
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
            replace(at: at, with: [ReviewGroup(pageIDs: rest)], keepsHold: true)
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
        // New pages may be a new stack: offer the split again.
        if splitState != .splitting { splitState = .idle }
        Task { await loadThumbnails(pages) }
        let ids = pages.map(\.id)
        switch placement {
        case .appendToLast:
            if let last = session.groups.indices.last {
                // Scan more onto a pile makes it a pile again: hold its read for the split (#54).
                replace(at: last, with: [ReviewGroup(pageIDs: session.groups[last].pageIDs + ids)],
                        holds: session.kind == .scan)
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
        proposalTask?.cancel()
        proposalTask = nil
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
        // Send keeps each pile as one document: read it now (#54).
        releaseHeld()
        onAdded()
        finishIfDone()
    }

    /// Cancel, then "Discard": nothing reaches the deck and every page is deleted.
    func discard() {
        proposalTask?.cancel()
        proposalTask = nil
        undecided.removeAll()
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

    /// `keepsHold`: the new group is still the same undecided pile (a page turned or deleted).
    /// `holds`: the new groups are undecided piles (pages scanned onto the end). Otherwise the
    /// person (or Claude's split) decided, and the new groups are read as soon as they're built.
    private func replace(at index: Int, with new: [ReviewGroup], keepsHold: Bool = false, holds: Bool = false) {
        let old = session.groups[index].id
        let pile = holds || (keepsHold && undecided.contains(old))
        undecided.remove(old)
        drop(session.groups[index])
        session.groups.replaceSubrange(index...index, with: new)
        if pile { new.filter { $0.pageIDs.count > 1 }.forEach { undecided.insert($0.id) } }
        persist()
        new.forEach(process)
    }

    private func refreshGroup(containing pageID: UUID) {
        guard let at = session.groups.firstIndex(where: { $0.pageIDs.contains(pageID) }) else { return }
        replace(at: at, with: [ReviewGroup(pageIDs: session.groups[at].pageIDs)], keepsHold: true)
    }

    /// The split is decided for every held pile: read them.
    private func releaseHeld() {
        let ids = undecided
        undecided.removeAll()
        ids.forEach(readHeld)
    }

    /// One pile's split is decided (#54): read it if it was waiting.
    private func decide(_ id: UUID) {
        guard undecided.remove(id) != nil else { return }
        readHeld(id)
    }

    /// Starts Claude's read for a group parked at `.held`. A group still in OCR reads on its own
    /// once it's built, since it's no longer undecided.
    private func readHeld(_ id: UUID) {
        guard states[id]?.status == .held, let item = states[id]?.item else { return }
        states[id]?.status = .reading(page: session.groups.first { $0.id == id }?.pageIDs.count ?? 1)
        run(id) { [weak self] in await self?.classify(id, item) }
    }

    /// Forgets a group's read and deletes its built PDF, unless it already went to the deck.
    private func drop(_ group: ReviewGroup) {
        tasks[group.id]?.cancel()
        tasks[group.id] = nil
        taskTokens[group.id] = nil
        if !inserted.contains(group.id), let doc = states[group.id]?.document {
            DocumentBuilder.remove(doc, from: files)
        }
        states[group.id] = nil
    }

    private func isCurrent(_ id: UUID) -> Bool { session.groups.contains { $0.id == id } }

    private func process(_ group: ReviewGroup) {
        tasks[group.id]?.cancel()
        states[group.id] = GroupState()
        run(group.id) { [weak self] in await self?.read(group) }
    }

    /// Runs one group's work as its task. A newer run for the same group cancels this one, and
    /// only the run that owns `tasks[id]` clears it, so `waitUntilIdle` never misses a read (#66).
    private func run(_ id: UUID, _ work: @escaping @MainActor () async -> Void) {
        tasks[id]?.cancel()
        let token = UUID()
        taskTokens[id] = token
        tasks[id] = Task { [weak self] in
            await work()
            guard let self, self.taskTokens[id] == token else { return }
            self.tasks[id] = nil
            self.taskTokens[id] = nil
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
        guard isCurrent(group.id), !Task.isCancelled else { return DocumentBuilder.remove(doc, from: files) }
        states[group.id]?.document = doc
        let duplicate = await duplicateMatch(for: doc)
        guard isCurrent(group.id), !Task.isCancelled else { return }
        let item = CaptureIntake.makeItem(doc)
        states[group.id]?.duplicate = duplicate
        states[group.id]?.item = item
        if isSent { insert(group.id) }

        // A scanned pile waits here, OCR'd and built, until its split is decided (#54).
        if undecided.contains(group.id), !isSent {
            states[group.id]?.status = .held
            return
        }
        await classify(group.id, item)
    }

    /// Claude's read of a built group, then the deck if it was already sent.
    private func classify(_ id: UUID, _ item: PipelineItem) async {
        await reader.read([item])
        guard !Task.isCancelled, isCurrent(id) || inserted.contains(id) else { return }
        states[id]?.status = item.card.map { .read(header: Self.header(for: $0)) } ?? .failed
        if inserted.contains(id) {
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

    /// Asks for one group's split and applies it. False when the split failed (the pages stay as
    /// they were); true when it was applied, or when an edit or Send made it moot.
    private func propose(_ group: ReviewGroup) async -> Bool {
        let pages = pages(in: group)
        guard pages.count <= SplitPayload.maxPages else { return false }
        var texts: [String] = []
        var thumbs: [Data?] = []
        let withImages = pages.count <= SplitPayload.maxImages
        for page in pages {
            guard isCurrent(group.id), !isSent, !Task.isCancelled else { return true }
            guard let source = source(for: page) else {
                texts.append("")
                thumbs.append(nil)
                continue
            }
            texts.append(await text(for: page, source: source).text)
            thumbs.append(withImages ? await Self.splitThumbnail(source) : nil)
        }
        let documents: [SplitDocument]
        do {
            documents = try await proposeSplit(SplitPayload.request(texts: texts, thumbnails: thumbs))
        } catch {
            return !isCurrent(group.id) || isSent
        }
        // The person split, joined or edited while Claude was proposing, or sent: their call wins.
        guard isCurrent(group.id), !isSent, let at = session.groups.firstIndex(where: { $0.id == group.id }) else {
            return true
        }
        guard let proposal = SplitPayload.groups(from: documents, pageCount: pages.count) else { return false }
        if proposal.count == 1 {
            // One document: add the label and read it as it is (#54).
            session.groups[at].label = proposal[0].label.isEmpty ? nil : proposal[0].label
            persist()
            decide(group.id)
            return true
        }
        let ids = pages.map(\.id)
        replace(at: at, with: proposal.map {
            ReviewGroup(pageIDs: $0.pages.map { ids[$0] }, label: $0.label.isEmpty ? nil : $0.label)
        })
        return true
    }

    @concurrent
    private nonisolated static func splitThumbnail(_ source: SourcePage) async -> Data? {
        DocumentBuilder.thumbnail(of: source, maxPixel: SplitPayload.thumbnailPixels)
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
