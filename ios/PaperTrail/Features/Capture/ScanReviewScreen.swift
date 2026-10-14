// Owner: capture. Spec 4.11 (A3, scan handoff and splitting) and 4.15 (imports land here too).
//
// Layout and gestures only; every action is a ScanReviewViewModel or CaptureController method.
import SwiftUI
import UIKit

struct ScanReviewScreen: View {
    let model: ScanReviewViewModel
    let controller: CaptureController
    @State private var confirmingDiscard = false

    var body: some View {
        NavigationStack {
            List {
                titleBlock
                if showsSplitRow {
                    Section { SplitRow(model: model) }
                }
                ForEach(Array(model.groups.enumerated()), id: \.element.id) { index, group in
                    Section {
                        GroupCard(model: model, group: group)
                    } header: {
                        if index > 0 { JoinButton { model.join(group.id) } }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(12)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .safeAreaInset(edge: .bottom) { sendBar }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { confirmingDiscard = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(model.moreTitle) { Task { await controller.addMore() } }
                        .fontWeight(.semibold)
                        .tint(Color(.accent))
                }
            }
            .confirmationDialog(model.discardTitle, isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { controller.discard() }
                Button("Keep editing", role: .cancel) {}
            }
        }
    }

    /// Stack mode (#19): the offer, its progress, then what Claude found.
    private var showsSplitRow: Bool {
        switch model.splitState {
        case .idle, .failed: model.offersSplit
        case .splitting, .done: !model.isSent
        }
    }

    /// Not a nav title, so it can wrap to two lines (spec 4.11, item 2).
    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.title)
                .font(.title.bold())
                .contentTransition(.numericText())
                .accessibilityAddTraits(.isHeader)
            Text(model.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 4, trailing: 4))
    }

    private var sendBar: some View {
        VStack(spacing: 8) {
            Button {
                controller.send()
            } label: {
                Text(model.sendTitle)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(Color(.accentFill).opacity(model.canSend ? 1 : 0.4), in: .capsule)
            }
            .buttonStyle(.plain)
            .disabled(!model.canSend)
            Text("Saved on your phone. Nothing is lost if you close the app.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .background(Palette.background)
    }
}

/// One proposed document: header, the duplicate line (#2), and the page strip.
private struct GroupCard: View {
    let model: ScanReviewViewModel
    let group: ReviewGroup

    var body: some View {
        let state = model.state(group)
        let header = model.header(group)
        let pages = model.pages(in: group)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(header.text)
                    .font(header.isRead ? .headline : .subheadline)
                    .foregroundStyle(header.isRead ? .primary : .secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if state.status != .failed { ReviewPill(isRead: header.isRead) }
            }
            .accessibilityElement(children: .combine)

            if let duplicate = state.duplicate {
                DuplicateLine(message: duplicate.message(), skipped: group.skipped) { skip in
                    model.setSkipped(group.id, skip)
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                        PageThumbnail(data: model.thumbnails[page.id], number: index + 1,
                                      rotate: { model.rotate(page.id) }, delete: { model.deletePage(page.id) })
                        if index < pages.count - 1 {
                            SplitButton(afterPage: index + 1) { model.split(group.id, after: index) }
                        }
                    }
                }
            }
            .scrollClipDisabled()
            .opacity(group.skipped ? 0.4 : 1)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}

/// "Read" or "Reading" on each proposed document (A3): the shared StatusPill.
private struct ReviewPill: View {
    let isRead: Bool

    var body: some View {
        StatusPill(kind: isRead ? .read : .reading).fixedSize()
    }
}

/// "Already filed on Oct 2 as 2025 W-2." with "Skip" and "File again" (spec 3.12).
private struct DuplicateLine: View {
    let message: String
    let skipped: Bool
    let choose: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(message).font(.subheadline)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(.unsure))
            }
            HStack(spacing: 8) {
                ChoiceChip(title: "Skip", isSelected: skipped) { choose(true) }
                ChoiceChip(title: "File again", isSelected: !skipped) { choose(false) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.unsureSoft), in: .rect(cornerRadius: 10, style: .continuous))
    }
}

/// A 66 x 86 page thumbnail. Long press: Rotate, Delete page.
private struct PageThumbnail: View {
    let data: Data?
    let number: Int
    let rotate: () -> Void
    let delete: () -> Void

    var body: some View {
        ZStack {
            Color(.cardWell)
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
                    .padding(4)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .frame(width: 66, height: 86)
        .clipShape(.rect(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Palette.separator, lineWidth: 0.5))
        .contextMenu {
            Button("Rotate", systemImage: "rotate.right", action: rotate)
            Button("Delete page", systemImage: "trash", role: .destructive, action: delete)
        }
        .accessibilityElement()
        .accessibilityLabel("Page \(number)")
        .accessibilityAddTraits(.isImage)
        .accessibilityAction(named: "Rotate", rotate)
        .accessibilityAction(named: "Delete page", delete)
    }
}

/// The 44 pt "Split here" target between two pages of one document.
private struct SplitButton: View {
    let afterPage: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "scissors")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 86)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Split here")
        .accessibilityHint("Makes a new document starting after page \(afterPage).")
    }
}

/// "Join" between two documents: merges the lower one into the one above.
private struct JoinButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Join", systemImage: "link")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color(.accent))
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .background(Palette.surface, in: .capsule)
                .overlay(Capsule().strokeBorder(Palette.separator))
                .padding(.vertical, 5)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .textCase(nil)
        .accessibilityHint("Joins this document with the one above.")
    }
}

/// "Split into documents" (#19), under the title: the offer, "Finding where each document starts"
/// while Claude works, then what it found (or a way to try again).
private struct SplitRow: View {
    let model: ScanReviewViewModel

    var body: some View {
        switch model.splitState {
        case .idle:
            Button(action: model.splitIntoDocuments) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Image(systemName: "rectangle.split.3x1")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color(.accent))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.splitTitle)
                            .font(.headline)
                            .foregroundStyle(Color(.accent))
                        Text(model.splitDetail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 4)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
        case .splitting:
            HStack(spacing: 12) {
                ProgressView().controlSize(.small)
                Text(model.splitDetail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        case .done:
            Label {
                Text(model.splitDetail).font(.subheadline)
            } icon: {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(.file))
            }
            .padding(.vertical, 4)
        case .failed:
            VStack(alignment: .leading, spacing: 8) {
                Label {
                    Text(model.splitDetail).font(.subheadline)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(.unsure))
                }
                Button("Try again", action: model.splitIntoDocuments)
                    .font(.subheadline.weight(.semibold))
                    .tint(Color(.accent))
                    .frame(minHeight: 44)
            }
            .padding(.top, 4)
        }
    }
}
