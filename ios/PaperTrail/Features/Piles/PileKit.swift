// Owner: piles. TEMPORARY stand-ins for the shared Core/UI components in design spec section 3
// (VerdictBadge, StatusPill, FilterChip, Banner, DocThumbnail, the avatar button) and the color
// sets in section 2.1. The deck agent builds the real ones in Core/UI in parallel; they are
// namespaced here so the two can't collide when both PRs merge. Once Core/UI lands, delete this
// file and drop the `PileKit.` prefix at the call sites. Values follow the spec exactly.
import SwiftUI
import UIKit

enum PileKit {
    // MARK: Colors (spec 2.1)

    enum Palette {
        static let accent = dynamic(0x2346B8, 0x8EA7FF)
        static let accentSoft = dynamic(0xE8EDFB, 0x1B2547)
        static let accentFill = dynamic(0x2346B8, 0x3D5FD6)
        static let cardWell = dynamic(0xECEEF2, 0x2A2A2E)
        static let shred = dynamic(0xC4271B, 0xFF8A7F)
        static let shredSoft = dynamic(0xFDECEA, 0x3A1A18)
        static let keep = dynamic(0x8A5A00, 0xF2C05A)
        static let keepSoft = dynamic(0xFBF1DC, 0x33280F)
        static let file = dynamic(0x17773F, 0x5FD393)
        static let fileSoft = dynamic(0xE3F4EA, 0x15301F)
        /// Solid fill behind a white label (swipe actions). Not a spec token: `File` in dark
        /// (#5FD393) is too light for white text, so dark uses A's original #1A7F4B (5:1).
        static let fileFill = dynamic(0x17773F, 0x1A7F4B)
        static let unsure = dynamic(0xA15C00, 0xF2C05A)
        static let unsureSoft = dynamic(0xFFF3D6, 0x33280F)
        static let danger = shred
        static let background = Color(.systemGroupedBackground)
        static let surface = Color(.secondarySystemGroupedBackground)

        /// Nonisolated on purpose: SwiftUI resolves dynamic colors off the main thread while it
        /// renders a glass material, and a MainActor-isolated provider closure traps there.
        nonisolated private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
            Color(UIColor { @Sendable traits in
                let hex = traits.userInterfaceStyle == .dark ? dark : light
                return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                               blue: CGFloat(hex & 0xff) / 255, alpha: 1)
            })
        }
    }

    // MARK: Pill (spec 3.5: capsule, caption semibold, padding 4 / 10)

    struct Pill: View {
        let text: String
        var symbol: String?
        let foreground: Color
        let background: Color
        var font: Font = .caption.weight(.semibold)

        var body: some View {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol).imageScale(.small).accessibilityHidden(true) }
                Text(text).lineLimit(1)
            }
            .font(font)
            .foregroundStyle(foreground)
            .padding(.vertical, 4)
            .padding(.horizontal, 10)
            .background(background, in: Capsule())
        }
    }

    /// Spec 3.4. Stand-in for Core/UI `VerdictBadge`; same look and VoiceOver label.
    struct VerdictBadge: View {
        let verdict: Verdict
        var large = false

        var body: some View {
            let colors: (Color, Color) = switch verdict {
            case .shred: (Palette.shred, Palette.shredSoft)
            case .scanShred: (Palette.accent, Palette.accentSoft)
            case .keepOriginal: (Palette.keep, Palette.keepSoft)
            }
            Pill(text: verdict.stamp, foreground: colors.0, background: colors.1,
                 font: large ? .subheadline.weight(.semibold) : .caption.weight(.semibold))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Verdict: \(verdict.stamp)")
        }
    }

    /// Spec 3.6.
    enum StatusKind: Hashable {
        case safe
        case waiting(String)
        case paperless(PaperlessStatus)
    }

    struct StatusPill: View {
        let kind: StatusKind

        var body: some View {
            switch kind {
            case .safe:
                Pill(text: "Safe", foreground: Palette.file, background: Palette.fileSoft)
            case .waiting(let text):
                Pill(text: text, symbol: "clock", foreground: .secondary, background: Palette.cardWell)
            case .paperless(let status):
                let colors: (Color, Color) = switch status {
                case .toDo, .cantStop: (.secondary, Palette.cardWell)
                case .requested: (Palette.unsure, Palette.unsureSoft)
                case .waitingCycle: (Palette.accent, Palette.accentSoft)
                case .confirmed: (Palette.file, Palette.fileSoft)
                }
                Pill(text: status.label, foreground: colors.0, background: colors.1)
            }
        }
    }

    /// Spec 3.5 FilterChip: 34 tall, subheadline medium; off is surface with a separator stroke,
    /// on is accent on accent soft. Padded to a 44 pt tap target.
    struct FilterChip: View {
        let title: String
        let isOn: Bool
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(isOn ? Palette.accent : Color.primary)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 34)
                    .background(isOn ? Palette.accentSoft : Palette.surface, in: Capsule())
                    .overlay { if !isOn { Capsule().strokeBorder(Color(.separator), lineWidth: 0.5) } }
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isOn ? .isSelected : [])
        }
    }

    /// A small bordered capsule chip used inside banners ("Open their steps", "Wait a cycle").
    struct BannerChip: View {
        let title: String
        let action: () -> Void

        var body: some View {
            // A7: solid surface capsules with a hairline, so they read on the UnsureSoft banner.
            Button(action: action) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 32)
                    .background(Palette.surface, in: Capsule())
                    .overlay { Capsule().strokeBorder(Color(.separator), lineWidth: 0.5) }
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// Spec 3.10: 36 x 46 on CardWell, radius 6. Filed docs have no local page image, so it shows
    /// the document type's first word over a few lines, like a printed form.
    struct DocThumbnail: View {
        let doc: FiledDoc

        var body: some View {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Palette.cardWell)
                .frame(width: 36, height: 46)
                .overlay {
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
                .accessibilityHidden(true)
        }

        /// A form name like A5's thumbnails ("1099-INT", "W-2 2025"): a token with both digits and
        /// letters, plus a year when the title has one. Plain titles get no label, just the lines,
        /// so nothing is cut off mid-word.
        private var label: String {
            let words = doc.title.split(whereSeparator: { $0 == " " || $0 == "," }).map(String.init)
            guard let form = words.first(where: { w in w.contains(where: \.isLetter) && w.contains(where: \.isNumber) }),
                  form.count <= 8 else { return "" }
            let year = words.first { $0.count == 4 && Int($0) != nil }
            return [form, year].compactMap { $0 }.joined(separator: "\n")
        }
    }

    /// Spec 4.2: initials on accent soft, accent text, 36 pt. Opens Settings.
    struct AvatarButton: View {
        @Environment(AppEnvironment.self) private var env
        @State private var showSettings = false

        var body: some View {
            Button { showSettings = true } label: {
                Text(initials)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(width: 36, height: 36)
                    .background(Palette.accentSoft, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Settings")
            .sheet(isPresented: $showSettings) { SettingsScreen() }
        }

        private var initials: String {
            guard case .signedIn(let account) = env.auth.state else { return "" }
            return account.displayName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        }
    }

    /// Spec 3.9 banners: an inset grouped section row with a soft background, never glass.
    struct BannerRow<Content: View>: View {
        let background: Color
        @ViewBuilder let content: Content

        var body: some View {
            content
                .padding(.vertical, 4)
                .listRowBackground(background)
        }
    }
}

extension View {
    /// Spec 3.10 row: HStack spacing 12, one accessibility element.
    func pileRow() -> some View {
        self.accessibilityElement(children: .combine)
    }
}
