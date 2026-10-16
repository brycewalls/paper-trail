// Owner: piles (search, #22). Logic only, no SwiftUI.
import Foundation

@Observable
final class SearchViewModel {
    private let store: any DocStore
    private let drive: any DriveService
    private let defaults: UserDefaults
    static let recentsKey = "recentSearches"
    static let recentsLimit = 8

    private(set) var docs: [FiledDoc] = []
    private(set) var loaded = false
    /// The text in the search field. Results follow it after a 250 ms pause.
    var query = "" {
        didSet { if query != oldValue { scheduleSearch() } }
    }
    /// Chips tapped on by hand. Years and types typed in the query turn their chips on as well.
    private(set) var pickedFilters: Set<SearchFilter> = []
    private(set) var hits: [SearchHit] = []
    private(set) var driveHits: [DriveFileMetadata] = []
    /// The query the current results are for (lags `query` by the debounce).
    private(set) var searchedQuery = ""
    private(set) var recents: [String] = []
    var debounce: Duration = .milliseconds(250)
    private var pending: Task<Void, Never>?

    init(docs: any DocStore, drive: any DriveService, defaults: UserDefaults = .standard) {
        store = docs
        self.drive = drive
        self.defaults = defaults
        recents = defaults.stringArray(forKey: Self.recentsKey) ?? []
    }

    convenience init(env: AppEnvironment) {
        self.init(docs: env.docs, drive: env.drive)
    }

    var loadFailed: Bool { store.syncError != nil && !loaded }

    func watch() async {
        for await list in store.docs() {
            docs = list
            loaded = true
            refreshLocal()
        }
    }

    // MARK: Filters

    /// Types present in the library, most common first (at most three chips).
    var knownTypes: [String] {
        let counts = Dictionary(docs.map { ($0.docType, 1) }, uniquingKeysWith: +)
        return counts.filter { !$0.key.isEmpty }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .map(\.key)
    }

    /// Filters switched on by what's typed.
    var typedFilters: Set<SearchFilter> {
        var out = Set(SearchIndex.years(in: query).map(SearchFilter.year))
        for type in SearchIndex.docTypes(in: query, known: knownTypes) { out.insert(.docType(type)) }
        return out
    }

    var activeFilters: Set<SearchFilter> { pickedFilters.union(typedFilters) }

    /// The chip row: the two most common types, years typed or picked plus the two newest in the
    /// library, then Sensitive and Keep originals. Chips that are on never drop out of the row.
    var chips: [SearchFilter] {
        var out: [SearchFilter] = []
        func add(_ f: SearchFilter) { if !out.contains(f) { out.append(f) } }
        for type in knownTypes.prefix(2) { add(.docType(type)) }
        for f in activeFilters.sorted(by: { $0.title < $1.title }) { if case .docType = f { add(f) } }
        let years = Set(docs.compactMap(PileFormat.year(of:))).sorted(by: >)
        for f in activeFilters.sorted(by: { $0.title < $1.title }) { if case .year = f { add(f) } }
        for year in years.prefix(2) { add(.year(year)) }
        add(.sensitive)
        add(.keepOriginals)
        return out
    }

    func isOn(_ filter: SearchFilter) -> Bool { activeFilters.contains(filter) }

    /// Tapping a chip that the query turned on takes its word out of the query.
    func toggle(_ filter: SearchFilter) {
        if pickedFilters.contains(filter) {
            pickedFilters.remove(filter)
        } else if typedFilters.contains(filter) {
            let drop = Set(SearchIndex.words(filter.title))
            query = SearchIndex.words(query).filter { !drop.contains($0) }.joined(separator: " ")
        } else {
            pickedFilters.insert(filter)
        }
        refreshLocal()
    }

    // MARK: Results

    var isSearching: Bool {
        !SearchIndex.words(searchedQuery).isEmpty || !activeFilters.isEmpty
    }

    var resultsTitle: String { hits.count == 1 ? "1 result" : "\(hits.count) results" }

    /// Words to highlight in titles and snippets.
    var highlightWords: [String] { SearchIndex.words(searchedQuery) }

    var showsNoResults: Bool { isSearching && hits.isEmpty && driveHits.isEmpty && pending == nil }

    /// The three most common senders, for the Suggested chips before typing.
    var suggestedSenders: [String] {
        let counts = Dictionary(docs.map { ($0.issuer, 1) }, uniquingKeysWith: +)
        return counts.filter { !$0.key.isEmpty }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(3).map(\.key)
    }

    private func scheduleSearch() {
        pending?.cancel()
        pending = Task { [debounce] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }
            await runSearch()
        }
    }

    /// Runs the search for the current query now (the debounce calls this; tests call it directly).
    func runSearch() async {
        searchedQuery = query
        refreshLocal()
        pending = nil
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { driveHits = []; return }
        let found = (try? await drive.search(text)) ?? []
        guard query.trimmingCharacters(in: .whitespaces) == text else { return }
        let known = Set(docs.map(\.driveId).filter { !$0.isEmpty })
        driveHits = found.filter { !known.contains($0.id) }
    }

    private func refreshLocal() {
        hits = SearchIndex.search(docs, query: searchedQuery, filters: activeFilters)
    }

    // MARK: Recent searches (kept on this phone)

    func remember(_ text: String? = nil) {
        let q = (text ?? query).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        recents.removeAll { $0.caseInsensitiveCompare(q) == .orderedSame }
        recents.insert(q, at: 0)
        recents = Array(recents.prefix(Self.recentsLimit))
        defaults.set(recents, forKey: Self.recentsKey)
    }

    func removeRecent(_ text: String) {
        recents.removeAll { $0 == text }
        defaults.set(recents, forKey: Self.recentsKey)
    }

    /// Tapping a recent search or a suggested sender runs it straight away.
    func use(_ text: String) {
        query = text
        pending?.cancel()
        pending = nil
        Task { await runSearch() }
    }

    func driveURL(for doc: FiledDoc) -> URL? {
        doc.driveUrl.isEmpty ? nil : URL(string: doc.driveUrl)
    }
}
