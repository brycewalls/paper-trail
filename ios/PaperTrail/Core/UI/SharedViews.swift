// Owner: deck (shared Core/UI). docs/design-spec.md sections 3.1, 3.7, 3.9, 3.10.
//
// Small building blocks: FlowLayout (wrapping chip rows), ProgressRing, DocThumbnail, Banner and
// the avatar button that opens Settings.
import SwiftUI

/// Lays children out in rows, wrapping to the next line when a row is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = Space.s

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.init(width: bounds.width, height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: .init(width: min(size.width, bounds.width), height: size.height))
                x += min(size.width, bounds.width) + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.init(width: width, height: nil))
            let itemWidth = min(size.width, width)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + itemWidth > width {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width += (row.indices.isEmpty ? 0 : spacing) + itemWidth
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}

/// Determinate ring for the outbox accessory (3.7): 30 pt, 3 pt stroke, accent over a separator track.
/// The stroke sits inside the frame, and a started upload always shows a sliver of progress.
struct ProgressRing: View {
    var value: Double
    var diameter: CGFloat = 30
    var lineWidth: CGFloat = 3
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(Palette.separator, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.02, min(1, value)))
                .stroke(Color(.accent), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .smooth, value: value)
        }
        .padding(lineWidth / 2)
        .frame(width: diameter, height: diameter)
        .accessibilityElement()
        .accessibilityValue("\(Int((value * 100).rounded())) percent")
    }
}

/// A document's first page, 36 x 46 on CardWell with radius 6 (3.10). Pass the rendered image.
/// Without one it draws a printed form: `label` (a form name like "W-2" over its year) when there
/// is one, then a few lines.
struct DocThumbnail: View {
    var image: CGImage?
    var label: String?
    var size: CGSize = Metrics.thumbnailSize

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Radius.thumbnail, style: .continuous).fill(Color(.cardWell))
            if let image {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(3)
            } else if let label {
                formLines(label: label)
            } else {
                Image(systemName: "doc.text").foregroundStyle(.secondary).imageScale(.small)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }

    private func formLines(label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if !label.isEmpty {
                Text(label)
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
            } else {
                Capsule().fill(Color(.tertiaryLabel)).frame(width: 14, height: 3)
            }
            ForEach(0..<3, id: \.self) { _ in
                Capsule().fill(Color(.tertiaryLabel).opacity(0.5)).frame(height: 2)
            }
        }
        .padding(5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Inset grouped banner (3.9): use inside a List as its own Section. Never glass.
struct Banner<Trailing: View>: View {
    let symbol: String
    let tint: Color
    let fill: Color
    /// The first sentence, set bold.
    let lead: String
    let detail: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.m) {
            Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.s) {
                Text("\(Text(lead).bold())\(detail.isEmpty ? "" : " " + detail)")
                    .font(.subheadline)
                trailing
            }
        }
        .bannerBackground(fill)
        .accessibilityElement(children: .combine)
    }
}

/// A banner row with its own layout (3.9): put it in its own Section. Soft fill, never glass.
struct BannerContent<Content: View>: View {
    let fill: Color
    @ViewBuilder let content: Content

    var body: some View { content.bannerBackground(fill) }
}

extension View {
    /// The inset grouped row look every banner shares (3.9).
    func bannerBackground(_ fill: Color) -> some View {
        padding(.vertical, Space.xs).listRowBackground(fill)
    }
}

extension Banner where Trailing == EmptyView {
    init(symbol: String, tint: Color, fill: Color, lead: String, detail: String) {
        self.init(symbol: symbol, tint: tint, fill: fill, lead: lead, detail: detail) { EmptyView() }
    }
}

/// The avatar in each tab's toolbar (36 pt, initials on AccentSoft). Opens Settings.
struct AvatarButton: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(AppRouter.self) private var router

    var body: some View {
        Button { router.showSettings = true } label: {
            Text(initials)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color(.accent))
                .frame(width: Metrics.avatar, height: Metrics.avatar)
                .background(Color(.accentSoft), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .accessibilityInputLabels(["Settings", "Account"])
        .accessibilityIdentifier("avatar")
    }

    private var initials: String {
        let name: String
        switch env.auth.state {
        case .signedIn(let account), .notAllowed(let account): name = account.displayName
        case .signedOut: name = ""
        }
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "PT" : letters.uppercased()
    }
}

// MARK: - Section headers

/// A section header in capitals, as Direction A draws every section label (spec 2.2, "uppercase
/// by Section"). iOS 26 no longer capitalizes list headers on its own.
struct CapsHeader: View {
    let title: String
    var body: some View { Text(title).textCase(.uppercase) }
}

extension Section where Parent == CapsHeader, Footer == EmptyView, Content: View {
    init(caps title: String, @ViewBuilder content: () -> Content) {
        self.init(content: content, header: { CapsHeader(title: title) })
    }
}

// MARK: - Reconnect Drive banner (3.9, 4.16)

/// "Drive needs reconnecting." on screens that aren't lists (Sort). Lists use auth's
/// ReconnectDriveBanner so it lines up with the rows. The caller owns the state and the action.
struct ReconnectDriveCard: View {
    let isWorking: Bool
    let failed: Bool
    let reconnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                Image(systemName: "exclamationmark.icloud.fill")
                    .foregroundStyle(Palette.danger)
                    .accessibilityHidden(true)
                Text("\(Text("Drive needs reconnecting.").bold()) Your scans are safe on this phone and upload once it's back.")
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: reconnect) {
                if isWorking { ProgressView() } else { Text("Reconnect Drive") }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .disabled(isWorking)
            if failed {
                Text("Drive didn't reconnect. Try again in a minute.")
                    .font(.footnote)
                    .foregroundStyle(Palette.danger)
            }
        }
        .padding(Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.dangerSoft, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}
