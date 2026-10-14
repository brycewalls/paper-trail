// Owner: outbox. TEMPORARY local copies of the spec's tokens (2.1) and the ProgressRing (3.7)
// and row thumbnail (3.10), so the outbox builds before deck's shared Core/UI PR lands. Once it
// does, replace OutboxPalette with the asset catalog colors (Color(.file) and friends),
// OutboxRing with ProgressRing and OutboxThumbnail with DocThumbnail, and delete this file.
import PDFKit
import SwiftUI
import UIKit

enum OutboxPalette {
    static let accent = dynamic(0x2346B8, 0x8EA7FF)
    static let accentSoft = dynamic(0xE8EDFB, 0x1B2547)
    static let cardWell = dynamic(0xECEEF2, 0x2A2A2E)
    static let file = dynamic(0x17773F, 0x5FD393)
    static let danger = dynamic(0xC4271B, 0xFF8A7F)
    static let dangerSoft = dynamic(0xFDECEA, 0x3A1A18)
    static let unsure = dynamic(0xA15C00, 0xF2C05A)

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                           blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        })
    }
}

/// Spec 3.7: 30 pt, 3 pt stroke, AccentColor over a separator track.
struct OutboxRing: View {
    var value: Double
    var size: CGFloat = 30
    var lineWidth: CGFloat = 3
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(Color(.separator), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.02, min(1, value)))
                .stroke(OutboxPalette.accent, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .smooth, value: value)
        }
        .padding(lineWidth / 2)
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityValue("\(Int((value * 100).rounded())) percent")
    }
}

/// Spec 3.10: 36 x 46 on CardWell, radius 6. Uses the capture thumbnail, else draws page one.
struct OutboxThumbnail: View {
    let fileURL: URL?
    let thumbnailURL: URL?
    @State private var image: UIImage?

    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(OutboxPalette.cardWell)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit().padding(3)
                } else {
                    Image(systemName: "doc.text").foregroundStyle(.secondary).imageScale(.small)
                }
            }
            .frame(width: 36, height: 46)
            .accessibilityHidden(true)
            .task(id: fileURL) { image = await Self.load(thumbnail: thumbnailURL, file: fileURL) }
    }

    @concurrent nonisolated static func load(thumbnail: URL?, file: URL?) async -> UIImage? {
        if let thumbnail, let data = try? Data(contentsOf: thumbnail), let image = UIImage(data: data) { return image }
        guard let file, let page = PDFDocument(url: file)?.page(at: 0) else { return nil }
        return page.thumbnail(of: CGSize(width: 90, height: 116), for: .mediaBox)
    }
}
