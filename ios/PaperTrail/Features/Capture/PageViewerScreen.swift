// Owner: capture. Spec 4.11.1 (the full-screen page viewer); issue #78.
//
// Tapping a page in the scan review opens every page of the review full screen: swipe between
// pages, pinch or double-tap to zoom, and cut or join right where the page is big enough to read.
// Done or a swipe down closes it back onto the same page's thumbnail (the zoom transition).
//
// Layout and gestures only; every action is a PageViewerModel method.
import SwiftUI
import UIKit

struct PageViewerScreen: View {
    let model: PageViewerModel
    let close: () -> Void
    /// True while the page showing is zoomed in: its own pan wins over paging.
    @State private var zoomed = false
    /// How far a swipe down has pulled the page (0 at rest).
    @State private var dragY: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A swipe down this far, or flicked past twice this, closes the viewer.
    private static let closeDistance: CGFloat = 120

    var body: some View {
        NavigationStack {
            pager
                .background(Palette.background)
                .navigationTitle(model.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: close)
                            .accessibilityIdentifier("pager.done")
                    }
                }
                .safeAreaInset(edge: .bottom) { cutBar }
        }
        .accessibilityIdentifier("pager")
    }

    private var pager: some View {
        ScrollView(.horizontal) {
            // Lazy: a page's view (and its zoom) is only made near the screen.
            LazyHStack(spacing: 0) {
                ForEach(model.pageIDs, id: \.self) { id in
                    page(id)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: Binding<UUID?>(get: { model.current }, set: { model.show($0) }))
        .scrollIndicators(.hidden)
        .scrollDisabled(zoomed)
        .offset(y: dragY)
        .scaleEffect(reduceMotion ? 1 : 1 - min(dragY, 400) / 2000)
        .simultaneousGesture(swipeDown)
    }

    /// Swipe down to close (when the page isn't zoomed in): the page follows the finger, then
    /// closes past `closeDistance` or snaps back with the spec's snap-back spring (2.7).
    private var swipeDown: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                guard !zoomed, value.translation.height > 0,
                      value.translation.height > abs(value.translation.width) * 1.5 || dragY > 0 else { return }
                dragY = value.translation.height
            }
            .onEnded { value in
                guard dragY > 0 else { return }
                if dragY > Self.closeDistance || value.predictedEndTranslation.height > Self.closeDistance * 2 {
                    close()
                } else {
                    withAnimation(reduceMotion ? Motion.reducedEase : Motion.snapBack) { dragY = 0 }
                }
            }
    }

    private func page(_ id: UUID) -> some View {
        let isCurrent = id == model.current
        return ZoomablePage(data: model.picture(id), isCurrent: isCurrent) { isZoomed in
            if isCurrent { zoomed = isZoomed }
        }
        .overlay {
            if !model.isLoaded(id) && model.picture(id) == nil { ProgressView() }
        }
        .accessibilityElement()
        .accessibilityLabel(model.accessibilityLabel(for: id))
        .accessibilityAddTraits(.isImage)
        .accessibilityIdentifier("pager.page")
        .accessibilityActions {
            if isCurrent { pageActions }
        }
    }

    /// The same actions as the bottom bar, plus page turns, for VoiceOver.
    @ViewBuilder private var pageActions: some View {
        if model.hasCutBefore { Button(model.joinBeforeTitle) { announce(model.joinBefore()) } }
        if model.hasCutAfter {
            Button(model.joinAfterTitle) { announce(model.joinAfter()) }
        } else if model.canCut {
            Button(model.cutTitle) { announce(model.cut()) }
        }
        if model.hasNext { Button("Next page", action: model.showNext) }
        if model.hasPrevious { Button("Previous page", action: model.showPrevious) }
    }

    /// Leading: join with the page before, when a document starts here. Trailing: the scissors,
    /// or join with the page after when a document starts after this one. Glass capsules with their
    /// words showing (a system bottom bar drops the words), like the deck's action row.
    private var cutBar: some View {
        GlassEffectContainer {
            HStack(spacing: Space.m) {
                if model.hasCutBefore {
                    barButton(model.joinBeforeTitle, symbol: "link", id: "pager.joinBefore",
                              hint: "Removes the cut before this page.") { announce(model.joinBefore()) }
                }
                Spacer(minLength: 0)
                if model.hasCutAfter {
                    barButton(model.joinAfterTitle, symbol: "link", id: "pager.joinAfter",
                              hint: "Removes the cut after this page.") { announce(model.joinAfter()) }
                } else if model.canCut {
                    barButton(model.cutTitle, symbol: "scissors", id: "pager.cut",
                              hint: "Makes a new document starting with the next page.") { announce(model.cut()) }
                }
            }
        }
        .padding(.horizontal, Space.xl)
        .padding(.bottom, Space.s)
        .opacity(dragY == 0 ? 1 : 0)
    }

    private func barButton(_ title: String, symbol: String, id: String, hint: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color(.accent))
                .padding(.horizontal, Space.xs)
                .frame(minHeight: 44)
        }
        .buttonStyle(.glass)
        .accessibilityHint(hint)
        .accessibilityIdentifier(id)
    }

    private func announce(_ message: String) {
        guard !message.isEmpty else { return }
        AccessibilityNotification.Announcement(message).post()
    }
}

/// One page in a zooming scroll view: pinch to zoom up to 4x, double-tap to zoom in on the spot
/// tapped (or back out), pan while zoomed. UIScrollView, because SwiftUI's magnify gesture can't
/// pan a zoomed page inside a paging scroll view without fighting it.
private struct ZoomablePage: UIViewRepresentable {
    let data: Data?
    let isCurrent: Bool
    let onZoom: (Bool) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeUIView(context: Context) -> PageScrollView {
        let view = PageScrollView()
        view.onZoom = onZoom
        return view
    }

    func updateUIView(_ view: PageScrollView, context: Context) {
        view.onZoom = onZoom
        view.reduceMotion = reduceMotion
        view.show(data)
        // A page swiped away goes back to fit, so it isn't still zoomed when it comes back.
        if !isCurrent, view.zoomScale != view.minimumZoomScale { view.setZoomScale(view.minimumZoomScale, animated: false) }
    }
}

private final class PageScrollView: UIScrollView, UIScrollViewDelegate {
    var onZoom: (Bool) -> Void = { _ in }
    var reduceMotion = false
    private let imageView = UIImageView()
    private var shown: Data?
    private var decode: Task<Void, Never>?

    /// Spec 2.7: the double-tap zoom uses the "next card promotion" spring.
    private static let zoomSpring = (duration: 0.35, bounce: 0.15)
    private static let doubleTapScale: CGFloat = 2.5

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 4
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        imageView.layer.shadowColor = UIColor.black.cgColor
        imageView.layer.shadowOpacity = 0.12
        imageView.layer.shadowRadius = 2
        imageView.layer.shadowOffset = CGSize(width: 0, height: 1)
        addSubview(imageView)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Decodes a new picture off the main thread (the thumbnail first, then full resolution).
    func show(_ data: Data?) {
        guard data != shown else { return }
        shown = data
        decode?.cancel()
        guard let data else {
            imageView.image = nil
            return
        }
        decode = Task { [weak self] in
            let image = await Self.decoded(data)
            guard let self, !Task.isCancelled, self.shown == data else { return }
            self.imageView.image = image
            self.fit()
        }
    }

    @concurrent
    private nonisolated static func decoded(_ data: Data) async -> UIImage? {
        await UIImage(data: data)?.byPreparingForDisplay()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        fit()
        center()
    }

    /// The page aspect fit inside the screen, with a 16 pt margin. Only at the fit zoom: a zoomed
    /// page keeps its frame when the full-resolution picture replaces the thumbnail (same shape).
    private func fit() {
        guard zoomScale == minimumZoomScale, let size = imageView.image?.size, size.width > 0, size.height > 0,
              bounds.width > 0 else { return }
        let room = bounds.insetBy(dx: Space.l, dy: Space.l).size
        let scale = min(room.width / size.width, room.height / size.height)
        let fitted = CGSize(width: size.width * scale, height: size.height * scale)
        imageView.frame = CGRect(origin: .zero, size: fitted)
        contentSize = fitted
        center()
    }

    /// Keeps a page smaller than the screen in the middle.
    private func center() {
        let frame = imageView.frame
        let x = max(0, (bounds.width - frame.width) / 2)
        let y = max(0, (bounds.height - frame.height) / 2)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    @objc private func doubleTapped(_ tap: UITapGestureRecognizer) {
        let zoomIn = zoomScale <= minimumZoomScale + 0.01
        let change = {
            if zoomIn {
                let point = tap.location(in: self.imageView)
                let scale = Self.doubleTapScale
                let size = CGSize(width: self.bounds.width / scale, height: self.bounds.height / scale)
                self.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2,
                                     width: size.width, height: size.height), animated: false)
            } else {
                self.setZoomScale(self.minimumZoomScale, animated: false)
            }
        }
        if reduceMotion {
            change()
        } else {
            UIView.animate(springDuration: Self.zoomSpring.duration, bounce: Self.zoomSpring.bounce,
                           animations: change)
        }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        center()
        onZoom(zoomScale > minimumZoomScale + 0.01)
    }
}
