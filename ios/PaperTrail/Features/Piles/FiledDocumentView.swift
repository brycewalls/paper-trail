// Owner: piles. The read-only document view pushed from Piles and Search (spec 4.5, 4.6 and the
// read-only mode of 4.13). The phone deletes its copy once Drive verifies it, so the pages open
// in Drive; an in-app PDF viewer needs a Drive download call that DriveService doesn't have yet
// (outbox adds `download(fileID:)`). Until then, a search shows the matching OCR text here with
// the search words highlighted, standing in for the highlighted PDF in spec 4.6.
import SwiftUI

struct FiledDocumentView: View {
    let doc: FiledDoc
    /// Search words to highlight (spec 4.6). Empty when opened from Piles.
    var highlight: [String] = []
    @Environment(\.openURL) private var openURL

    private var driveURL: URL? { doc.driveUrl.isEmpty ? nil : URL(string: doc.driveUrl) }

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    VerdictBadge(verdict: doc.verdict, size: .large)
                    if !doc.verdictReason.isEmpty {
                        Text("Why: \(doc.verdictReason)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            if let snippet = SearchIndex.snippet(doc.fullText, words: highlight, before: 80, after: 240) {
                Section(caps: "Matching text") {
                    Text(SearchHighlight.attributed("\u{201C}\(snippet)\u{201D}", words: highlight))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Section(caps: "Details") {
                LabeledContent("Title", value: doc.title)
                LabeledContent("Sender", value: doc.issuer)
                LabeledContent("Date", value: dateText)
                LabeledContent("Type", value: doc.docType)
            }
            Section(caps: "Filing") {
                LabeledContent("Folder", value: PileFormat.breadcrumb(for: doc))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Filename").foregroundStyle(.secondary).font(.footnote)
                    Text("\(doc.filename).pdf").font(.caption.monospaced()).foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .accessibilityElement(children: .combine)
                LabeledContent("Paper", value: paperText)
            }
            Section(caps: "About") {
                if !doc.summary.isEmpty { Text(doc.summary) }
                LabeledContent("Retention", value: doc.retention)
                if doc.sensitive {
                    LabeledContent("Sensitive") {
                        SensitiveChip()
                    }
                }
            }
        }
        .navigationTitle(doc.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let driveURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: driveURL) { Image(systemName: "square.and.arrow.up") }
                        .accessibilityLabel("Share")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Open in Drive") { openURL(driveURL) }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private var dateText: String {
        PileFormat.date(docDate: doc.docDate).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? "No date"
    }

    private var paperText: String {
        switch doc.physical {
        case .toShred: "In the shred pile"
        case .shredded: PileFormat.date(iso: doc.shreddedAt).map { "Shredded \(PileFormat.shortDay($0))" } ?? "Shredded"
        case .keep: "To put away"
        case .stored: "In the binder"
        }
    }
}

/// Matches in bold on AccentSoft (spec 3.10, search result), shared by the result rows and the
/// document view.
enum SearchHighlight {
    static func attributed(_ text: String, words: [String]) -> AttributedString {
        var out = AttributedString(text)
        for range in SearchIndex.ranges(of: words, in: text) {
            guard let lower = AttributedString.Index(range.lowerBound, within: out),
                  let upper = AttributedString.Index(range.upperBound, within: out) else { continue }
            out[lower..<upper].inlinePresentationIntent = .stronglyEmphasized
            out[lower..<upper].backgroundColor = Color(.accentSoft)
        }
        return out
    }
}
