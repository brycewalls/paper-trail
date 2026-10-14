# Paper Trail for iPhone: Direction A build spec

_Written 2026-10-13. Bryce picked Direction A (Glass: native and calm). This spec turns frames A1 to A9 in `index.html` (rendered in `direction-A.png`) into what the six SwiftUI feature agents build. Read with `brief.md` (the why), `replica/overhaul-shortlist.md` (the feature list) and the open issues in `brycewalls/paper-trail`. Where this spec and a sketch disagree, this spec wins. Where this spec and the scaffold disagree, see section 0._


## Decisions from Bryce (2026-10-13)

These override anything below that disagrees.

1. **Scan entry point:** a Scan button at the top of Sort, next to the avatar. Its menu offers Scan document, Import from Files, and Import from Photos.
2. **Year subfolders:** only in 02 Taxes, 03 Money & Banking and 05 Medical (for example `02 Taxes/2025`), created on demand. The year comes from docDate, falling back to the filing date. All other folders stay flat. Breadcrumbs show "Taxes › 2025" only for those three folders.
3. **Drive folder name:** keep "Paperwork Archive". Settings shows "Paperwork Archive", not "Paper Trail".
4. **Undo window:** the latest swipe is held for up to 10 seconds before its upload starts, so Undo never has to reverse an upload.
5. **"Offer to file confident cards together":** defaults to off.
6. **Verdict style:** A's pills for now. Rubber stamps may come later through `VerdictBadge` only.

## 0. Before you build

**Locked decisions** (Bryce, 2026-10-13, taken from A's own answers):

| Topic | Decision |
|---|---|
| Card | One big card with A1's medium level of detail. |
| Confident cards | Filed one at a time in the deck. Settings toggle "Offer to file confident cards together" (A8). When it's on, a quiet prompt offers to file the rest of the confident cards. |
| Unsure fields | Half-height sheet at the medium detent with Claude's best guesses and "Remember for this sender" (A2). |
| Outbox | A tab bar accessory above the Liquid Glass tab bar, like the Music mini player (A1, A4). Not a tab. |
| Verdict | A's pills for now, built as one component (`VerdictBadge`) so a later swap to rubber stamps touches that file only. |
| Keep original | Shredding a Keep original card always asks first. |
| Tabs | Sort, Piles, Paperless, plus the search island. Settings opens from the avatar. |

**Scaffold overrides.** The untracked scaffold in `.claude/worktrees/ios-scaffold/ios/` was written before this spec and must change to match it:

- `RootView` / `AppTab` has five tabs (Sort, Outbox, Piles, Search, Settings). It becomes `sort, piles, paperless, search`. Outbox moves to the accessory and a pushed screen; Settings moves to a sheet from the avatar.
- `Core/UI/Theme.swift` is placeholder tokens. Replace it with section 2.
- Stand-in screens point at `docs/design-spec.md`. This file is that spec; repoint the comments to `design/ios-directions/spec.md`.
- `ios/ARCHITECTURE.md` is not on `origin/ios` yet. Screen and view model names below follow the scaffold's files (`DeckScreen`, `DeckViewModel`, `OutboxScreen`, `PilesScreen`, `PilesViewModel`, `SearchScreen`, `SettingsScreen`, `ReadingQueue`, `CaptureIntake`, `AuthFeature`, `PaperlessFeature`). New names introduced here are listed in section 7.

**Contract additions this spec needs** (each owner adds the optional field with a default, records it in ARCHITECTURE.md, and updates the fakes):

| Addition | Owner | Why |
|---|---|---|
| `DocumentCard.alternatives: [String: [String]]?` (field name to up to two other guesses, best first) | classify | The check-fields sheet shows Claude's top guesses (#20). |
| `CardConfidence.fieldUnsureBelow = 0.75` | classify | A field below this is "Not sure". |
| `ClassifyService.proposeSplit(pageTexts:) -> [[Int]]` | classify | The scan review screen's proposed documents (#19). Fallback until it exists: all pages in one document. |
| `AppSettings.offerBulkFile: Bool = true` | deck | The A8 toggle. Follows the account. |
| `PipelineItem.unsureFields: [String]` (default `[]`) and `PipelineItem.session: String?` | classify, capture | Deck highlights; named sessions (#26). |
| Face ID lock as `@AppStorage("lockWithFaceID")` | auth | Device setting, not an account setting (#30). |

## 1. Principles

1. **Native first.** Build from system components and let them carry Liquid Glass, Dynamic Type, accessibility and the iOS 27 transparency slider. Deployment target is iOS 26.0 (scaffold `project.yml`).
   - Tabs: `TabView` with `Tab(...)` and `Tab(role: .search)` for the trailing search island. `.tabBarMinimizeBehavior(.onScrollDown)` on list tabs (Piles, Paperless). The Sort tab never minimizes, because the deck doesn't scroll.
   - Outbox: `.tabViewBottomAccessory { OutboxAccessory() }` on the `TabView`. Read `@Environment(\.tabViewBottomAccessoryPlacement)` for the compact inline layout when the tab bar is minimized.
   - Decisions: `.sheet` with `.presentationDetents([.medium, .large])` and the system grabber. Destructive confirmations: `.confirmationDialog`.
   - Lists: `List` with `.listStyle(.insetGrouped)`, `Section` headers, `.swipeActions`, `.contextMenu`. Forms: `Form`.
   - Empty and error screens: `ContentUnavailableView`.
   - Navigation: one `NavigationStack` per tab, large titles.
2. **Glass only where A uses it.** System glass: tab bar, search island, accessory, toolbar buttons, sheets. Custom `.glassEffect` / `.buttonStyle(.glass)`: the deck's action row (Shred, Undo, File) inside one `GlassEffectContainer`, the swipe overlay labels, and the floating "Mark 6 as shredded" button. Never on the card, list rows, banners, or chips.
3. **SF Symbols only.** No custom icons except the app icon. Symbols listed per component.
4. **Dynamic Type everywhere.** Every text uses a text style from section 2. No fixed heights on anything holding text. Test at `.xSmall`, `.large` (default) and `.accessibility3`.
5. **Both themes.** Every color is a light/dark pair (section 2). A9 is the dark reference.
6. **Reduce Motion and Reduce Transparency respected.** Section 2.7 for motion. Transparency is handled by the system for every glass element above; don't add a custom fallback unless a test with Reduce Transparency on shows a custom glass element losing legibility, then use `.background(.regularMaterial)`.
7. **Every swipe has a button twin that fires the same action** (brief, principle 3). The view model has one `file(_:)`, `shred(_:)`, `later(_:)`, `undo()`; gestures, buttons, context menus and accessibility actions all call those.
8. **Nothing buzzes without a reason** (section 2.6).

## 2. Tokens

### 2.1 Colors

Neutrals come from the system so they track Increase Contrast and future iOS changes. Brand and status colors are asset catalog color sets (Any / Dark appearances, plus a High Contrast variant later), accessed as generated symbols (`Color(.shred)`). Hex values are from A's `.A` and `.A.dark` tokens; two are adjusted for contrast (noted).

**Neutrals (system)**

| Token | SwiftUI | Light | Dark |
|---|---|---|---|
| background | `Color(.systemGroupedBackground)` | #F2F2F7 | #000000 |
| surface (card, rows) | `Color(.secondarySystemGroupedBackground)` | #FFFFFF | #1C1C1E |
| ink | `.primary` | #000000 (system) | #FFFFFF (system) |
| muted | `.secondary` | system secondary label | system secondary label |
| separator | system list separators | | |

**Brand and custom (asset catalog)**

| Color set | Use | Light | Dark |
|---|---|---|---|
| `AccentColor` | Tint, links, selected tab, progress ring, Scan + shred text | #2346B8 | #8EA7FF |
| `AccentFill` | Solid primary button background (white label) | #2346B8 | #3D5FD6 (adjusted: white on #8EA7FF is 2.3:1) |
| `AccentSoft` | Selected chip, Scan + shred pill background, selected tab capsule | #E8EDFB | #1B2547 |
| `CardWell` | The scan area of the card, thumbnails, gray pills | #ECEEF2 | #2A2A2E |

**Verdicts** (used only inside `VerdictBadge`, section 3.4)

| Verdict | Text | Background |
|---|---|---|
| Shred | `Shred` #C4271B / #FF8A7F | `ShredSoft` #FDECEA / #3A1A18 |
| Scan + shred | `AccentColor` #2346B8 / #8EA7FF | `AccentSoft` #E8EDFB / #1B2547 |
| Keep original | `Keep` #8A5A00 / #F2C05A | `KeepSoft` #FBF1DC / #33280F |

**Actions and status**

| Color set | Use | Light | Dark |
|---|---|---|---|
| `File` | File button and overlay, Safe, Confirmed, verified checkmarks, Drive connected dot | #17773F (adjusted from #1A7F4B for 4.5:1 on its soft fill) | #5FD393 |
| `FileSoft` | Safe pill, "safe to shred" banner | #E3F4EA | #15301F |
| `Danger` | Shred button and overlay, failed uploads, Drive disconnected | same as `Shred` | same as `Shred` |
| `Unsure` | "Not sure" text, "2 to check" pill, Sensitive chip, Requested pill, "Still mailing?" | #A15C00 | #F2C05A |
| `UnsureSoft` | Unsure row highlight, the pills above, the "Still mailing?" banner | #FFF3D6 | #33280F |
| `FileFill` | Solid fill behind a white label: the "Shredded" and "Confirmed" swipe actions | #17773F | #1A7F4B (white on `File` dark #5FD393 is too light) |

Contrast (checked): every text/background pair above is 4.5:1 or better in both themes. `.secondary` on `CardWell` is the weakest pair, so gray pills use `.secondary` with `.semibold` weight.

Tab bar labels stay system colored; only the selected tab takes the tint (brief, Avoid list). Glass elements take no tint except the File and Shred labels on the action row.

### 2.2 Type

All system SF Pro via text styles, so Dynamic Type works. A's pixel sizes in brackets.

| Role | SwiftUI | Notes |
|---|---|---|
| Screen title | `.navigationTitle` large | "Sort", "Piles". [34] |
| Screen subtitle | `.subheadline`, `.secondary` | Under the large title, via `.navigationSubtitle` (iOS 26). [15] |
| Card title | `.title2.bold()` | [22] |
| Card meta ("Issuer · Date") | `.subheadline`, `.secondary` | [15] |
| Card folder row | `.subheadline` | Symbol in `.secondary` |
| Filename | `.caption.monospaced()`, `.secondary` | SF Mono replaces the sketch's IBM Plex Mono. Wraps, never truncates. [12] |
| Pills and chips | `.caption.weight(.semibold)` | [12] |
| Filter chips | `.subheadline.weight(.medium)` | [14] |
| Sheet title | `.title3.bold()` | [20] |
| Sheet field label | List section header style (`.footnote`, uppercase by `Section`) | [13] |
| Row title | `.body` | [16 to 17] |
| Row subtitle | `.footnote`, `.secondary` | [13] |
| Action row labels | `.headline` | [17] |
| Accessory title | `.subheadline.weight(.semibold)` | [14] |
| Accessory trailing | `.footnote`, `.secondary` | [13] |
| Banner text | `.subheadline` with the first sentence `.bold()` | [14] |

### 2.3 Spacing

Base 4. Use these values only: 4, 8, 12, 16, 20, 24, 32.

| Use | Value |
|---|---|
| Screen side margin for lists | system inset grouped |
| Card side margin | 20 |
| Card body padding | 16 vertical, 18 horizontal (round to 16 / 20 if you prefer the scale) |
| Gap between card body lines | 8 |
| Card to action row | 20 |
| Action row height | 54 (Shred, File); Undo is a 48 circle |
| Chip/pill inner padding | 4 vertical, 10 horizontal (pills); 0 / 14 at 34 height (chips) |
| Thumbnail in rows | 36 x 46 |
| Peek offsets behind the card | 22 and 36 down |

### 2.4 Corner radii

All `RoundedRectangle(cornerRadius:, style: .continuous)`.

| Element | Radius |
|---|---|
| Deck card | 30 |
| Card scan well | 0 at the top (clipped by the card), none inside |
| Unsure row highlight | 10 |
| Banner (safe to shred, still mailing) | match the inset grouped section (use a `Section` with `.listRowBackground`) |
| Thumbnails | 6 |
| Pills, chips, big buttons, accessory | `Capsule()` |
| Sheets, tab bar, list sections | system |

### 2.5 Card shadow

Neutral black only, never tinted. Light: `.shadow(color: .black.opacity(0.10), radius: 17, y: 14)`. Dark: `.shadow(color: .black.opacity(0.60), radius: 17, y: 14)`. Peek cards: `.black.opacity(0.06)` light / `0.40` dark, radius 9, y 6. No shadow on list rows or banners.

### 2.6 Haptics

SwiftUI `.sensoryFeedback` where a value changes; UIKit generators where the trigger is a gesture. Call `prepare()` when the drag begins. Nothing else in the app produces haptics; system controls (toggles, pickers, sheets) keep their own built-in behavior.

| Event | Generator | Fires when |
|---|---|---|
| Card crosses the commit threshold outward | `UIImpactFeedbackGenerator(style: .light)` / `.impact(weight: .light)` | Once per outward crossing during a drag, in either direction. Not on crossing back in. |
| File or Shred button tapped | `UIImpactFeedbackGenerator(style: .light)` | On tap, the same as a committed swipe (button twin). |
| Bulk file confirmed | `UIImpactFeedbackGenerator(style: .light)` | Once, on "File 7". |
| Uploads verified | `UINotificationFeedbackGenerator` `.success` | Once when the last in-flight upload of a batch verifies (Drive checksum and page count match). App in the foreground only. Never once per document. |
| Upload needs attention | `UINotificationFeedbackGenerator` `.warning` | Once per item when it moves into Needs attention (automatic retries used up, or Drive needs reconnecting). Foreground only. |
| Undo, sheet open, Keep original confirm, Mark as shredded, tab switches | none | |

### 2.7 Animation

SwiftUI springs (`.spring(duration:bounce:)`). Read `@Environment(\.accessibilityReduceMotion)`.

| Motion | Default | Reduce Motion |
|---|---|---|
| Drag follow | Card follows the finger 1:1 horizontally; vertical movement is damped to 15%. Rotation `clamp(tx / cardWidth * 10, -10, 10)` degrees, anchor at `UnitPoint(x: 0.5, y: 1.2)` (A1's 50% 120%). `.interactiveSpring(response: 0.15, dampingFraction: 0.86)` | Translation only, no rotation |
| Commit threshold | `max(110 pt, 30% of card width)`, or a flick where `predictedEndTranslation.width` passes 2x the threshold | same |
| Overlay label | Opacity `min(1, abs(tx) / threshold)`; scales 0.9 to 1.0 when the threshold is crossed with `.spring(duration: 0.2, bounce: 0.4)` | Opacity only |
| Snap-back (released short, or Keep original confirm) | `.spring(duration: 0.4, bounce: 0.3)` | `.easeOut(duration: 0.2)` |
| Fly-off | To `x = ±1.5 * cardWidth` with the gesture's velocity, `.spring(duration: 0.32, bounce: 0)` | Opacity to 0, `.easeOut(duration: 0.2)`, no movement |
| Button-triggered fly-off | Same as fly-off with a starting velocity of 1200 pt/s | Same as Reduce Motion fly-off |
| Next card promotion | Scale 0.96 to 1, offset 22 to 0, `.spring(duration: 0.35, bounce: 0.15)` | Cross-fade 0.2 s |
| Undo return | Card enters from the side it left, `.spring(duration: 0.45, bounce: 0.2)` | Fade in 0.2 s |
| Accessory state change | `.contentTransition(.numericText())` for counts, `.smooth` for the ring | Counts change without transition |

## 3. Components

Shared components live in `Core/UI/` (owned by deck, built first, see section 7). Every screen uses them; nobody re-implements a pill.

### 3.1 DeckCard

**Anatomy (A1, top to bottom)**

1. Scan well: `CardWell` background, 236 pt tall at default sizes. First-page thumbnail centered, aspect fit, max 196 tall, thin `.separator` border and a 2 pt neutral shadow so white paper reads on light mode.
   - Top trailing: `VerdictBadge`. On a card with unsure fields, an `UnsurePill` ("2 to check") sits to its left.
   - Bottom leading: page count, `.caption`, `.secondary`: "1 page" / "3 pages".
   - Top leading: the swipe overlay (3.2), hidden at rest.
2. Body (padding 16 / 18, spacing 8):
   - Title: `card.title`.
   - Meta: "{issuer} · {date}", date formatted `.abbreviated` ("Jan 30, 2026"). Missing date: "{issuer} · No date".
   - Folder row: `folder` symbol + folder display name (the folder string with its "NN " prefix removed: "02 Taxes" shows as "Taxes").
   - Chip row (`FlowLayout`, wraps): `SensitiveChip` if `card.sensitive`, then `RetentionChip` with `card.retention`.
   - Filename: "{filename}.pdf".
3. Card background `surface`, radius 30, shadow 2.5. Two peek cards behind it (2.3, 2.5).

The free-text `summary` and `verdictReason` are not on the card; they are on the card detail (4.13). That is A1's "medium" level.

**States**

| State | Difference |
|---|---|
| Ready, confident | As above. |
| Ready, unsure fields (A2) | Scan well shrinks to 96 pt. Each unsure field becomes an `UnsureRow`: `UnsureSoft` background, radius 10, value on the leading side, "Not sure" in `Unsure` `.caption.weight(.semibold)` trailing. Unsure fields are drawn in this order: sender, date, folder, title, filename, verdict. A non-unsure folder row still shows. |
| Dragging right | Rotates and translates; File overlay fades in. |
| Dragging left | Shred overlay fades in. |
| No confidence data (`card.confidence == nil`) | Looks like a confident card but is never counted as "ready to file" and never offered for bulk filing. |
| Read failed | Scan well at full height, title "Couldn't read this one", meta "Claude didn't answer. Your scan is saved." Two buttons in the body: "Try again" (`.bordered`) and "Fill it in yourself" (opens 4.13). Swipes are disabled; the action row Shred and File are disabled except Shred, which logs it as shred without a card. |
| Large Dynamic Type (`.accessibility1` and up) | Scan well 120 pt, peeks hidden, title and meta wrap, filename wraps. The body scrolls inside the card (`ScrollView` with `.scrollBounceBehavior(.basedOnSize)`); the drag gesture uses `minimumDistance: 12` and only claims horizontal-dominant drags so vertical scrolling still works. |

**Gestures**

- Horizontal drag: swipe right = File, swipe left = Shred (2.7).
- Tap: push the card detail (4.13).
- Long press: `.contextMenu` with File, Shred, Later ("Move to the back"), Edit details, and a preview of the full first page.
- Tap an `UnsureRow`: open the check-fields sheet scrolled to that field.

**SwiftUI building blocks:** `ZStack` of peeks and the top card; `DragGesture` with `.updating` for the live offset; `.rotationEffect(anchor:)`; `.offset`; `.overlay(alignment: .topLeading)` for the swipe label; `.accessibilityElement(children: .combine)` plus `.accessibilityActions` (section 6).

### 3.2 Swipe overlays (File / Shred)

Glass capsule label on the card's scan well. File: top leading, `checkmark` + "File" in `File`, `.headline.bold()`. Shred: top trailing, `xmark` + "Shred" in `Danger`. When the top card is a Keep original, the Shred overlay reads "Shred? Asks first" so the confirm isn't a surprise. Built with `Label` + `.padding(.horizontal, 12).padding(.vertical, 6)` + `.glassEffect(.regular, in: .capsule)`. Opacity and scale per 2.7. `accessibilityHidden(true)` (the action is announced by the action itself).

### 3.3 ActionRow (Shred, Undo, File)

`GlassEffectContainer` holding three buttons, `HStack` with `Spacer`s, 20 pt side margins, 20 below the card.

| Button | Look | Action | States |
|---|---|---|---|
| Shred | Capsule, 54 tall, `xmark` + "Shred" in `Danger`, `.buttonStyle(.glass)` | `model.shred(top)` | Disabled when the deck is empty. On a Keep original card, opens the confirm (4.14) first. |
| Undo | 48 circle, `arrow.uturn.backward` in `.secondary`, `.buttonStyle(.glass)`, `.buttonBorderShape(.circle)` | `model.undo()` | Disabled (and dimmed by the system) when there's nothing to undo. One step only: it undoes the last decision, including a bulk file as one step. |
| File | Capsule, 54 tall, `checkmark` + "File" in `File` | `model.file(top)` | On a card with unsure fields, opens the check-fields sheet instead of filing. Disabled when the deck is empty or the card failed to read. |

At accessibility text sizes the labels stay and the row stays one line; if it doesn't fit, Shred and File drop to icon-only with their labels kept for VoiceOver (`ViewThatFits`).

**Undo window.** The latest decision is held back from the outbox until the next decision, 10 seconds pass, or the user leaves the Sort tab. Undo inside that window puts the card back with nothing to reverse. After it, Undo still works: a File that has already uploaded is sent back to the deck and the outbox trashes the Drive copy it made (Drive `files.update` with `trashed: true`), and a Shred removes its Firestore log entry.

### 3.4 VerdictBadge (the swap point)

```swift
struct VerdictBadge: View {
    let verdict: Verdict
    var size: Size = .regular   // .regular on cards and lists, .large in card detail
    var body: some View { ... }  // A's pill today
}
```

- Today: capsule, `.caption.weight(.semibold)`, padding 4 / 10, text `verdict.stamp` ("Shred", "Scan + shred", "Keep original"), colors from 2.1's Verdicts table.
- Accessibility: `.accessibilityLabel("Verdict: \(verdict.stamp)")`.
- **Rule for every agent:** never draw a verdict any other way. No `Theme.color(for:)` in screens, no hand-built verdict pills, no verdict text in other labels except where copy says so. A rubber-stamp version later replaces this file's `body` (and adds the stamp assets) and nothing else changes. Keep the frame flexible: callers must not set a fixed width or height on it.

### 3.5 Chips and pills

All are capsules with `.caption.weight(.semibold)`, padding 4 / 10, and a symbol at `.imageScale(.small)`.

| Component | Look | Copy |
|---|---|---|
| `SensitiveChip` | `Unsure` on `UnsureSoft`, `lock.fill` | "Sensitive" |
| `RetentionChip` | `.secondary` on `CardWell`, no symbol | `card.retention` as Claude wrote it ("Keep 7 years", "Keep for HSA, 3 years"). One line, truncates at the tail; full text in VoiceOver and the detail. Once #25 ships it can also show "Delete after Mar 2033". |
| `UnsurePill` | `Unsure` on `UnsureSoft` | "1 to check" / "2 to check" |
| `FilterChip` (search) | 34 tall, `.subheadline.weight(.medium)`; off: `surface` with a `.separator` stroke; on: `AccentColor` on `AccentSoft` | Filter names |
| `ChoiceChip` (sheet, dates) | Same as `FilterChip`, single select | "Sep 28, 2026", "Oct 3 (due date)" |

### 3.6 StatusPill

One component, `StatusPill(kind:)`, used by Piles and Paperless.

| Kind | Text | Colors | Symbol |
|---|---|---|---|
| Safe | "Safe" | `File` on `FileSoft` | none |
| Waiting | "{n} days" / "1 day" / "Today" (hold time left), or "Checking" while the Drive check runs | `.secondary` on `CardWell` | `clock` |
| To do | "To do" | `.secondary` on `CardWell` | none |
| Requested | "Requested" | `Unsure` on `UnsureSoft` | none |
| Waiting a cycle | "Waiting a cycle" (from `PaperlessStatus.label`) | `AccentColor` on `AccentSoft` | none |
| Confirmed | "Confirmed" | `File` on `FileSoft` | none |
| Can't stop | "Can't stop" | `.secondary` on `CardWell` | none |

Paperless pill text always comes from `PaperlessStatus.label`.

### 3.7 OutboxAccessory

Lives in `.tabViewBottomAccessory`. Whole accessory is one button that pushes the Outbox (4.4) onto the current tab's stack. Layout: leading status glyph (30 pt), title, `Spacer`, "Outbox" in `.footnote` `.secondary`, `chevron.right`.

| State | Glyph | Title | Inline (minimized tab bar) |
|---|---|---|---|
| Idle, filed today | `checkmark.circle.fill` in `File` | "All caught up · 14 filed today" | `checkmark.circle.fill` + "14" |
| Idle, nothing today | `tray` in `.secondary` | "Outbox is empty" | `tray` |
| Uploading | `ProgressRing` (30 pt, 3 pt stroke, `AccentColor` over `.separator` track, value = bytes sent / bytes in the batch) | "Uploading 2 of 5" | ring + "2 of 5" |
| Waiting for a connection | `wifi.slash` in `.secondary` | "Waiting for a connection · 3 saved on your phone" | `wifi.slash` + "3" |
| Needs attention | `exclamationmark.triangle.fill` in `Unsure` | "1 needs a retry" (plural "3 need a retry") | triangle + "1" |
| Drive needs reconnecting | `exclamationmark.icloud.fill` in `Danger` | "Reconnect Drive to keep filing" | icon only |

Needs attention outranks uploading; reconnect outranks everything. Counts use `.contentTransition(.numericText())`. Built from `HStack`, `ProgressRing` (a small `Circle().trim(from:to:)` view in `Core/UI`; `ProgressView` with `.circular` style isn't determinate everywhere), and `@Environment(\.tabViewBottomAccessoryPlacement)` to switch to the inline layout. The accessory shows on every tab whenever the user is signed in.

### 3.8 CheckFieldsSheet

Presented with `.sheet`, `.presentationDetents([.medium, .large])`, `.presentationDragIndicator(.visible)`, opening at `.medium`. The system sheet is glass at the medium detent and dims the deck. The card stays visible above it.

**Anatomy (A2)**

1. Title: "Check 2 fields" ("Check 1 field").
2. Subtitle: "Everything else looks right."
3. One section per unsure field, label in caps by `Section` ("Sender", "Date", "Folder", "Title", "Filename", "Verdict"). The date section's label uses the document type when Claude knows it ("Statement date").
   - Text fields (sender, title, filename): radio rows. Claude's best value first with "likely" trailing, then each alternative with "possible". Selected row: `AccentColor` 2 pt stroke and a filled radio. Last row: "Something else", which turns into a `TextField` in place.
   - Date: `ChoiceChip`s for the best value and alternatives, plus "Pick a date" (opens a graphical `DatePicker` in a popover).
   - Folder: radio rows for the guesses, then "Choose another folder", which pushes the folder picker inside the sheet (sheet goes to `.large`).
   - Verdict: a segmented `Picker` with the three verdict names.
4. Toggle row: "Remember for this sender", on by default. Footer under it when on: "Next time, {issuer} files this way without asking."
5. Primary button, full width, `AccentFill`, white `.headline`, capsule, 52 tall: "Confirm and file".

**Behavior.** Confirm writes the chosen values into the card, marks those fields confident, saves a `SenderRule` if the toggle is on (keyed by the confirmed issuer), dismisses, and files the card as if swiped right (light haptic, fly-off right). Swiping the sheet down cancels: the card stays on the deck unchanged.

### 3.9 Banners

Built as an inset grouped `Section` with a custom `.listRowBackground`, so it lines up with the lists around it. Never glass.

| Banner | Colors | Copy |
|---|---|---|
| Safe to shred (A5) | `FileSoft`, `checkmark` in `File` | "**6 are safe to shred.** The Drive copy is confirmed and the 3-day hold is over." With no hold: "**6 are safe to shred.** The Drive copy is confirmed." |
| Still mailing? (A7) | `UnsureSoft`, `exclamationmark.triangle.fill` + "Still mailing?" in `Unsure`, bold | "{issuer} sent a paper {docType} on {date}, after you requested paperless." Chips: "Open their steps", "Wait a cycle". One banner per flagged sender, newest first, max two then "{n} more senders are still mailing" row. |
| Reconnect Drive | `ShredSoft`, `exclamationmark.icloud.fill` in `Danger` | "**Drive needs reconnecting.** Your scans are safe on this phone and upload once it's back." Button: "Reconnect Drive". |
| Bulk file prompt (Sort) | none (a small `.bordered` capsule button, `.controlSize(.small)`) | "File the other 7 confident cards" |

### 3.10 List rows

All rows: `HStack(spacing: 12)`, min height 52 (system), thumbnail 36 x 46 on `CardWell` radius 6 where a document is involved, title `.body`, subtitle `.footnote` `.secondary`, trailing accessory as listed. Every row is one accessibility element with its trailing pill read last.

| Row | Leading | Title | Subtitle | Trailing | Swipe / menu |
|---|---|---|---|---|---|
| Outbox, needs attention | thumbnail | "{title} · {issuer short}" | The error line (section 3.12) | "Retry" (`.bordered`, `.controlSize(.small)`) | Trailing swipe "Retry"; menu: Retry, Send back to the deck |
| Outbox, uploading | thumbnail | same | `ProgressView(value:)` linear, 5 pt, `AccentColor` | "62%" `.footnote` `.secondary` | menu: Send back to the deck |
| Outbox, waiting | thumbnail | same | "Next in line" / "Waiting for a connection" | none | menu: Send back to the deck |
| Outbox, filed | `checkmark` in `File` | same | "1 of 1 pages confirmed in Drive · 10:12 AM" | none | menu: Open in Drive |
| Piles, shred | thumbnail | `title` | "{issuer} · Cross-cut" when sensitive, else "{issuer}" | `StatusPill` Safe or Waiting | Safe rows: trailing swipe "Shredded" |
| Piles, keep | thumbnail | `title` | "Write #12 on it, then put it in the binder" (#24) or "{issuer} · {folder}" | none or `archivebox` when stored | trailing swipe "Put away" / "Take out" |
| Piles, all filed | thumbnail | `title` | "{issuer} · {folder}" | `VerdictBadge` | menu: Open in Drive |
| Search result | thumbnail | `title` with matches highlighted (bold, `AccentSoft` background via `AttributedString`) | "{issuer} · {folder} › {year}"; second line, the matching snippet in quotes, 2 lines max | none | menu: Open in Drive |
| Paperless sender | none | issuer | "Check back Oct 28" / the first step, e.g. "Account settings, then Billing, then Paper bill off" | `StatusPill` | trailing swipe to change status |
| Sender rule | none | issuer | "{folder} · {verdict stamp} · {pattern}" | `chevron` (NavigationLink) | trailing swipe "Forget" (destructive) |
| Recent search | `clock` `.secondary` | the query | none | none | trailing swipe "Remove" |

### 3.11 Empty states

All `ContentUnavailableView`.

| Where | Symbol | Title | Description | Actions |
|---|---|---|---|---|
| Sort, first time | `doc.viewfinder` | "Scan your first stack" | "Claude reads each document and gets it ready to file." | "Scan" (`.borderedProminent`), "Import" (`.bordered`, a menu: Files, Photos) |
| Sort, all done | `checkmark.circle` | "All sorted" | "14 filed today. The outbox is handling the uploads." | "Scan more" |
| Sort, reading | `ProgressView` | "Reading 3 documents" | "They show up here as soon as Claude is done." | none |
| Outbox, empty | `tray` | "Nothing in the outbox" | "Filed documents upload from here." | none |
| Piles, Shred | `checkmark.circle` | "Nothing to shred" | "Documents you file show up here once their Drive copy is confirmed." | none |
| Piles, Keep | `archivebox` | "No originals to keep" | "Cards marked Keep original show up here." | none |
| Piles, All filed | `folder` | "Nothing filed yet" | "Everything you file to Drive shows up here." | none |
| Search, no results | `ContentUnavailableView.search(text:)` | system | system | none |
| Paperless | `leaf` | "No senders yet" | "When a scan comes from someone who offers paperless, they show up here." | none |
| Sender rules | `person.crop.rectangle.stack` | "No sender rules yet" | "When you fix a card with Remember for this sender on, the rule shows up here." | none |

### 3.12 Error states

| Error | Where | Copy | Recovery |
|---|---|---|---|
| Upload failed, retrying | Outbox row | "Drive didn't answer. Trying again in 2 min." | Automatic backoff (1, 2, 5, 15 min), "Retry" button anytime |
| Upload failed, retries used up | Needs attention | "Drive didn't take this one. Tap Retry to try again." | Retry |
| Page count mismatch | Needs attention | "Drive has 1 of 2 pages. Uploading it again." | Automatic re-upload once, then Retry |
| Drive unauthorized | Accessory, Outbox header, Settings, Sort banner | Reconnect banner (3.9) | Reconnect Drive (4.16) |
| Drive folder missing | Outbox row | "The Drive folder moved. Rebuilding it." | Automatic `ensureFolders(forceRebuild: true)` |
| Offline | Accessory | "Waiting for a connection · 3 saved on your phone" | Automatic |
| Classify failed | Deck card (3.1) | "Couldn't read this one" / "Claude didn't answer. Your scan is saved." | Try again, Fill it in yourself |
| Duplicate (#2) | Scan review group | "Already filed on Oct 2 as 2025 W-2." | "Skip" / "File again" chips |
| Camera denied | Scanner launch | Title "Camera access is off", description "Turn it on in Settings, then Paper Trail, to scan." | "Open Settings" (`UIApplication.openSettingsURLString`) |
| Unsupported import | Import | Alert "That file can't be filed", message "PDFs and photos work. {filename} is a {type}." | OK |
| Not on the allowlist | Sign-in | "This account isn't on the list. Sign in with a different Google account." | "Use another account" |
| Sign-in canceled or failed | Sign-in | "Sign-in didn't finish. Try again when you're ready." | Button stays |

## 4. Screens

Copy in quotes is exact. Example names and amounts are the sketch's made-up data.

### 4.1 First launch and sign-in (`SignInScreen`, auth), serves #14, #15, #4

Shown only when `AuthState` is `.signedOut` or `.notAllowed`. Read from the persisted Firebase user synchronously at launch, so a signed-in user never sees this screen or a spinner (#14).

Layout, top to bottom, centered on `background`, `ScrollView` so it works at large text:

1. App icon image, 96 pt, radius 22.
2. "Paper Trail", `.largeTitle.bold()`.
3. "Scan the pile. Claude reads each document, files it to your Google Drive, and tells you what to shred.", `.body` `.secondary`, centered, max width 320.
4. `Spacer`.
5. Google's standard "Sign in with Google" button (Google's branding: white/dark variants, Google "G" mark), full width minus 32, 52 tall.
6. Footnote, `.footnote` `.secondary`: "Paper Trail asks for Drive access so it can file your scans. It only sees the files it creates."

States:

- **Drive consent skipped.** If the Google consent comes back without the Drive scope, the button area becomes step 2 on the same screen: "Signed in as {email}" (`.subheadline`), then a primary button "Connect Google Drive", and the footnote "Paper Trail needs Drive to file your scans. Nothing uploads until it's connected." The rest of the app stays locked until Drive connects.
- **Not allowed:** below the title, an inline message in `Danger`: "This account isn't on the list." Button: "Use another account".
- **In progress:** button shows a `ProgressView` and is disabled.

Navigation: on success, cross-fade to `RootView` on the Sort tab, which shows the first-time empty state (3.11). No tour, no permissions prompt until the first scan.

### 4.2 A1: Sort deck (`DeckScreen`, deck), serves #20, #26, #33

`NavigationStack`, large title "Sort".

1. Nav bar: large title "Sort". Subtitle (`.navigationSubtitle`): "{n} to go · {m} ready to file" (`n` = cards on the deck, `m` = confident cards). With cards still being read: "{n} to go · {m} ready to file · 3 reading". Trailing toolbar: `ScanMenuButton` (`doc.viewfinder`, `Menu` with `primaryAction` = scan; long press shows "Scan pages", "Choose from Files", "Choose from Photos"), then the avatar button (initials on `AccentSoft`, `AccentColor` text, 36 pt) which opens Settings (4.9).
2. Bulk file prompt (3.9), only when the setting is on and at least two confident cards remain: "File the other 7 confident cards" (counts every confident card except the one on top when the top is confident; otherwise all of them, "File the 7 confident cards").
3. Deck: `DeckCard` with two peeks.
4. `ActionRow`.
5. (System) `OutboxAccessory`, then the tab bar with the search island.

Interactions: section 3.1 and 3.3. Filing advances to the next card with no confirmation screen. A Shred-verdict card can be filed (uploaded) like any other; Shred on the action row means "log it as shredded, no Drive copy".

Navigation: tap card, push card detail (4.13). Scan, full-screen scanner (4.11). Accessory, push Outbox (4.4). Avatar, Settings sheet (4.9). Empty and reading states from 3.11.

### 4.3 A2: Low-confidence card (`DeckScreen` + `CheckFieldsSheet`, deck + classify), serves #20, #21

Same screen as 4.2, with the unsure card state (3.1) and the sheet (3.8). Swiping right or tapping File on that card snaps it back and opens the sheet. Shred on an unsure card works without the sheet (nothing gets filed, so there's nothing to check). Copy for the A2 example: title "Check 2 fields", subtitle "Everything else looks right.", sections "Sender" ("Cascade Power & Light" likely, "Cascade Natural Gas" possible, "Something else") and "Statement date" (chips "Sep 28, 2026", "Oct 3 (due date)", "Pick a date"), toggle "Remember for this sender", button "Confirm and file".

### 4.4 A4: Outbox (`OutboxScreen`, outbox), serves #17, #18, #1, #15

Pushed onto the current tab's `NavigationStack` from the accessory. Back button shows the tab name ("Sort"). Large title "Outbox".

1. Subtitle: "{a} uploading · {b} needs a retry · {c} filed today" (omit zero parts; all zero: "Nothing waiting").
2. Reconnect banner (3.9) when Drive needs it.
3. Section "Needs attention" (only if any).
4. Section "Uploading": the uploading row first, then waiting rows ("Next in line").
5. Section "Filed today": verified rows, newest first. Each shows "{verified} of {pages} pages confirmed in Drive · {time}" for the first row, and the shorter "{verified} of {pages} pages confirmed · {time}" after it. Shred decisions show "Logged as shredded · {time}" with `xmark` in `.secondary`.
6. Last row: "Earlier" (NavigationLink to a list of the last 30 days grouped by day).

Toolbar trailing, when anything failed: "Retry all".
Interactions: rows per 3.10. "Send back to the deck" cancels the upload (or trashes the Drive copy if it finished) and returns the card to the top of the deck. The tab bar stays visible; the accessory hides while the Outbox itself is on screen.

### 4.5 A5: Piles (`PilesScreen`, piles), serves #18, #24, #25, #26

Large title "Piles", avatar trailing. `.tabBarMinimizeBehavior(.onScrollDown)`.

1. Segmented `Picker` (`.segmented`): "Shred 9", "Keep 3", "All filed 64". The counts use the segment's normal label style. The system segmented control flattens per-run styling, so `.secondary` counts aren't possible without a custom control, and that isn't worth it (Bryce, 2026-10-14, #58).
2. **Shred segment:**
   - Safe-to-shred banner (3.9) when any are safe.
   - Section "Safe to shred": rows with `StatusPill` Safe. More than three: the first three, then a "{n} more" row that expands in place.
   - Section "Waiting": rows with the Waiting pill; subtitle says why: "Checking the Drive copy" or "Drive copy confirmed · hold ends Oct 15".
   - Floating glass button above the accessory, centered, 54 tall: "Mark 6 as shredded" in `AccentColor`. Tap shows a `.confirmationDialog`: title "Mark 6 as shredded?", message "Do this once the paper has gone through the shredder.", buttons "Mark 6 as shredded", "Cancel". Sets `physical = .shredded` and `shreddedAt`. Waiting rows are never included.
   - A document is Safe only when `isSafeToShred` and the hold (`AppSettings.shredHoldDays`) has passed since `verifiedAt` (#18).
3. **Keep segment:** sections "To put away" (`physical == .keep`) and "In the binder" (`.stored`). Row subtitles per 3.10. Swipe "Put away" moves a row down.
4. **All filed segment:** every filed doc grouped by month ("October 2026"), newest first. Toolbar filter `Menu` (`line.3.horizontal.decrease`): "All", "Sensitive", "Expired" (#25, documents past their retention date), and sessions (#26) when named sessions ship. Footer row under the Shred segment once #26 ships: "Shred log" (pushes a dated list).

Tap any row: push the document view (4.7's document view, read-only card detail with the PDF).

### 4.6 A6: Search (`SearchScreen`, search), serves #22

The search island tab (`Tab(role: .search)`). Selecting it turns the tab bar into a bottom search field (system behavior with `.searchable` on this tab's `NavigationStack`); A6's leading round button closes Search and returns to the tab you came from, which is the system behavior (Bryce, 2026-10-14, #61). Large title "Search". Field prompt: "Documents, senders, text".

1. Filter chips (`FilterChip`, horizontal `ScrollView`): document types present in the library (e.g. "Tax forms"), years found in the query or recent docs ("2023"), "Sensitive", "Keep originals". Typing a year or a known type turns its chip on.
2. Before typing: section "Recent" with the last 8 queries (rows per 3.10) and, under it, "Suggested" chips for the three most common senders.
3. While typing (debounced 250 ms): section "{n} results" (one: "1 result"). Matches on `searchTerms`, title, issuer, docType, year and `fullText`. Highlight matches. Snippet from `fullText` around the first match.
4. Section "Also in Drive": results from `DriveService.search` that aren't already in the app's list (#22, the hidden text layer). Row subtitle "In Drive · {folder}". Tap opens in Drive.
5. No results: `ContentUnavailableView.search(text:)`.

Tap a result: push the document view: the PDF (`PDFKit` `PDFView` in a `UIViewRepresentable`, with the search term highlighted) above an inset grouped summary of the fields, `VerdictBadge`, and the retention line. Toolbar: "Open in Drive" (primary), `ShareLink` for the PDF.

### 4.7 A7: Paperless (`PaperlessScreen`, piles/search/paperless), serves #23, #29

Large title "Paperless", avatar trailing. Subtitle: "{x} of {y} senders confirmed".

1. Still mailing banners (3.9). "Open their steps" pushes the sender detail. "Wait a cycle" sets status to Waiting a cycle and `checkBackAt` to 35 days out.
2. Section "Check back soon": Requested and Waiting a cycle senders, sorted by `checkBackAt`. Subtitle "Check back Oct 28".
3. Section "To do": subtitle is the first step, or `how` if there are no steps.
4. Section "Done": Confirmed and Can't stop. Senders can be grouped in one row when they share a status ("Harbor Federal, Northwind", subtitle "1 more can't stop (DMV)").
5. Footer row (v2.2, #29): "Junk mail" (NavigationLink to the opt-out helper).

**Sender detail** (pushed): large title = issuer. Section "Status": a menu `Picker` with the five statuses. Section "How to stop paper": numbered steps (or `how`). Section "Check back": `DatePicker` (compact). Section "Seen": "First scan Aug 3 · Last scan Oct 9". Primary button for To do: "I requested it", which sets Requested and a check-back date 35 days out. For Requested or Waiting: "It's confirmed".

### 4.8 A9: Dark mode

A9 is the Sort deck in dark mode (4.2 with the dark tokens): black background, `#1C1C1E` card, the Shred pill in #FF8A7F on #3A1A18. Nothing about dark mode is a separate screen; every screen must be checked in both themes (section 1).

### 4.9 A8: Settings (`SettingsScreen`, auth owns the shell), serves #15, #18, #20, #21, #30, #31, #32

Sheet from the avatar, `.large` detent, `NavigationStack` inside, large title "Settings", toolbar trailing "Done". `Form` / inset grouped.

1. Account row: avatar (48 pt), name (`.title3.weight(.medium)`), email. NavigationLink to Account: email, "Sign out" (destructive, confirmation "Sign out of Paper Trail? Your scans stay on this phone until they upload.").
2. Section "Google Drive":
   - Status row: green dot (`File`), "Connected", subtitle "Stays connected on the server. No sign-in prompts." Disconnected: red dot (`Danger`), "Not connected", subtitle "Reconnect to keep filing. Your scans are safe on this phone.", and a "Reconnect Drive" button row below.
   - "Folder" · "Paperwork Archive" ›, opens the folder in Drive (`Link`).
   - "Last upload" · "2 min ago" (`RelativeDateTimeFormatter`).
3. Section "Sorting" (rows owned by their features):
   - "Sender rules" · "14" › (classify, 4.12).
   - "Shred hold" · "3 days" › (piles): picker "None", "1 day", "3 days", "7 days".
   - Toggle "Offer to file confident cards together" (deck). Footer: "When it's on, Sort offers to file the cards Claude is sure about in one go. You still see each one in the list first."
4. Section "Scanning and privacy":
   - "Shutter" · "Manual" › (capture). Hidden while the VisionKit stopgap is the scanner, since it can't set a default; shown when the custom scanner (#32) ships.
   - Toggle "Lock with Face ID" (auth, #30).
5. Section "Data" (v2.2, #31): "Import from the old Paper Trail".
6. Footer: "Paper Trail {version} ({build})".

### 4.10 Face ID lock (`LockScreen`, auth), serves #30

When on: on launch and after 5 minutes in the background, the app content is covered by `background` with the app icon and a button "Unlock Paper Trail" (`faceid`). Runs `LAContext` automatically once; the button retries. Never a Google sign-in on open.

### 4.11 A3: Scanner handoff and splitting (`ScanReviewScreen`, capture), serves #19, #28, #26, #2, #17, #32

**Scanner.** `ScanMenuButton` presents the scanner as a `.fullScreenCover`: `VNDocumentCameraViewController` (stopgap) in a `UIViewControllerRepresentable`; the custom scanner later (#32) behind the same `CaptureService` call. Save in the scanner hands the pages to the review screen. Every page is written to `FileStore` before the review screen appears.

**Review screen** (full-screen cover, `NavigationStack`):

1. Toolbar: leading "Cancel" (glass, system), trailing "Scan more" (`AccentColor`, semibold), which reopens the scanner and appends pages.
2. Title block (not a nav title, so it can be two lines): "{p} pages, {d} documents" (`.title.bold()`), subtitle "Tap between pages to split or join" (`.subheadline` `.secondary`).
3. Optional session row (#26, v2.2): "Session" · "Box 1, drawer A" (text field with recent sessions as suggestions).
4. One group per proposed document (inset grouped style, `surface`, radius from the system):
   - Header row: "{docType} · {issuer}" in `.headline` when read, with a `StatusPill`-style "Read" pill (`File` on `FileSoft`); while reading: "Reading page {n}" in `.secondary` with a gray "Reading" pill.
   - Duplicate line when #2 matches (3.12).
   - Page thumbnails, 66 x 86, horizontal `ScrollView`. Between two pages of the same document: a 44 pt tap target with `scissors` ("Split here"). Between two groups: a "Join" capsule (`link`), which merges the group into the one above.
   - For a two-page group from the ID card mode (#28): toggle "Front and back on one page".
   - Long press a page: "Rotate", "Delete page".
5. Bottom, pinned (`safeAreaInset(edge: .bottom)`): primary button "Send {d} to the deck" (`AccentFill`), then the footnote "Saved on your phone. Nothing is lost if you close the app."

Behavior: the split comes from `ClassifyService.proposeSplit` (fallback: one document). Groups are classified as they form; "Send" is enabled as soon as pages are saved (documents still reading go to the deck when ready). Cancel asks: `.confirmationDialog` title "Discard {p} pages?", buttons "Discard" (destructive), "Keep editing". Closing the app mid-review keeps the pages; on next launch the review screen reopens.

### 4.12 Senders list (`SenderRulesScreen`, classify), serves #21, #27

Pushed from Settings › Sender rules. Large title "Sender rules". Search field (`.searchable`, prompt "Senders"). Rows per 3.10, sorted A to Z. Empty state 3.11.

Rule detail (pushed, `Form`), title = issuer:
- "Folder" picker (the 11 folders, display names).
- "Verdict" segmented picker (three verdicts, labels from `Verdict.stamp`).
- "Document type" text field.
- "Filename" text field, `.monospaced()`, with suggestion chips under it (#27): "{date}", "{yyyy}", "{mm}", "{issuer}", "{type}". Live preview below: "2026-09-28_cascade-electric-bill.pdf".
- Footer: "Updated Oct 9".
- Destructive button: "Forget this sender". Confirmation "Forget {issuer}? Their cards go back to Claude's best guess."

### 4.13 Card detail and edit (`CardDetailScreen`, deck), serves #20, #21, #27, #24, #25

Pushed from the deck (and reused read-only as the document view from Piles and Search).

1. Page viewer: `TabView` with `.tabViewStyle(.page)`, 320 pt tall at default size, each page aspect fit on `CardWell`. Tap opens a full-screen `PDFView` with zoom.
2. Header: `VerdictBadge(size: .large)`, then `verdictReason` in `.subheadline` `.secondary` ("Why: Box 1 wages matter for taxes. The IRS has its own copy.").
3. `Form` sections:
   - "Details": Title (`TextField`), Sender (`TextField`), Date (`DatePicker`, `.compact`), Type (`TextField`). Unsure fields carry a trailing "Not sure" in `Unsure` until edited.
   - "Filing": Folder (NavigationLink to the folder picker: a `List` of the 11 folders by display name, checkmark on the current one, in order "Identity & Legal" to "Other"); Filename (`TextField`, `.monospaced()`, ".pdf" shown as a trailing suffix, suggestion chips under it per #27); Verdict (segmented).
   - "About": Summary (multi-line text), Retention text, and once #25 ships "Delete the Drive copy after Mar 2033"; Sensitive (Toggle).
   - "Remember for this sender" toggle, shown once Folder, Verdict or Filename changes. Same footer as 3.8.
   - Keep original cards, once #24 ships: "Binder number" row, "#12 (assigned when filed)".
4. Toolbar trailing: "Done" saves edits to the card and pops back to the deck (the card stays on top, edited fields count as confident). Bottom bar (`.toolbar(placement: .bottomBar)`): "Shred" and "File" buttons, same actions as the action row.

Read-only mode (filed docs): the same layout without text fields, plus "Open in Drive" and Share.

### 4.14 Keep original confirm (`DeckScreen`, deck), serves #33

Triggered by any Shred (swipe, button, context menu, VoiceOver action) on a card whose verdict is Keep original. The card snaps back to center first, then a `.confirmationDialog`:

- Title: "Shred a Keep original?"
- Message: "Claude marked this one to keep the paper. {verdictReason}"
- Buttons: "Shred anyway" (`.destructive`), "Cancel" (`.cancel`).

"Shred anyway" runs the normal shred. It always asks; there's no "don't ask again".

### 4.15 Import from Files and Photos (`ImportFlow`, capture), serves #17, #2

From the Scan menu or the empty state's Import menu.

- "Choose from Files": `.fileImporter(allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true)`. Each file is one document; PDFs keep their bytes.
- "Choose from Photos": `PhotosPicker(selection:, matching: .images)`, multiple. Photos picked together start as one document.
- Both land on the review screen (4.11) with the title "{n} files, {d} documents" or "{n} photos, 1 document", so the split and join controls work the same way. "Scan more" is replaced by "Add more" for imports.
- Unsupported types: alert in 3.12.

### 4.16 Reconnect Drive (auth + outbox), serves #15

Shown only when the server reports the refresh token is gone (`DriveLink.needsReconnect`), never on a single failed request.

- Accessory: reconnect state (3.7).
- Sort, Outbox and Piles: reconnect banner (3.9) at the top.
- Settings: Drive section in its disconnected state.
- "Reconnect Drive" runs `AuthService.reconnectDrive()` (Google consent for the Drive scope only). While running: the button shows a `ProgressView`. Success: banner removes itself, outbox resumes, no other message. Failure: "Drive didn't reconnect. Try again in a minute." under the button.
- Swiping and scanning keep working; decisions queue in the outbox.

## 5. Flows

**First launch.** Open app, sign-in screen (4.1), "Sign in with Google" with Drive consent in the same step, server stores the refresh token, Sort shows "Scan your first stack". Later launches go straight to the last tab with no check on open.

**Scan to deck.** Sort, Scan, scanner, Save, review screen shows "4 pages, 3 documents" while Claude reads, fix any split with the scissors or Join, "Send 3 to the deck", the cards appear on the deck as each one finishes reading. The accessory doesn't change yet (nothing is decided).

**Swipe and undo.** Drag the top card right, light tap at the threshold, release, it flies off and the next card rises; the decision waits in the undo window. Tap Undo, the card returns from the right. Swipe again, then the next swipe (or 10 seconds) releases it to the outbox, and the accessory shows "Uploading 1 of 1".

**The low-confidence card.** Top card shows "2 to check" and two Not sure rows. Swipe right, it snaps back and the sheet opens at medium. Pick "Cascade Power & Light", keep the date chip, leave "Remember for this sender" on, "Confirm and file". The card flies off right; a sender rule is saved, and the next card from that sender comes in confident.

**Bulk filing confident cards.** Setting on. Sort shows "File the other 7 confident cards". Tap, a sheet at medium: title "File 7 confident cards", subtitle "Claude is sure about every field on these. Each one goes to the outbox like a swipe right.", a list of the 7 rows (thumbnail, title, `VerdictBadge`) each with a checkmark toggle (all on), primary "File 7" (count follows the toggles), footnote "Keep original cards still keep their paper." Confirm, one light haptic, the cards leave the deck, Undo now undoes all 7 in one step.

**A failed upload and retry.** An upload fails, the outbox retries on its own (1, 2, 5, 15 minutes) and the row says "Drive didn't answer. Trying again in 2 min." After the last retry it moves to Needs attention, the accessory switches to "1 needs a retry" and a warning haptic fires once. Tap the accessory, Outbox, Retry. It uploads, verifies, and moves to Filed today.

**Safe to shred.** A Scan + shred document uploads, Drive's checksum and page count match, it's verified, and it enters Piles › Shred as Waiting ("hold ends Oct 15"). After the hold it moves to Safe and the banner counts it. Shred the paper, then "Mark 6 as shredded" and confirm.

**Finding a document.** Tap the search island, type "w-2 2023", the 2023 chip turns on, results show the W-2 with the matching text highlighted, tap it, the PDF opens with "Open in Drive" in the toolbar.

## 6. Accessibility

**VoiceOver on the deck card.** One element (`.accessibilityElement(children: .combine)` with an explicit label):

- Label: "{title}. {issuer}, {date}. {verdict stamp}. Folder {folder}. {Sensitive.} {retention}." For an unsure card, add "2 fields to check: sender, date."
- Hint: "Swipe up or down for actions."
- Custom actions (`.accessibilityAction(named:)`), in this order: "File" (on an unsure card: "Check 2 fields and file"), "Shred", "Move to the back", "Edit details", "Undo" (only when available).
- Each action calls the same view model methods as the swipes and buttons. After an action, post an announcement: "Filed {title}. Next: {next title}." / "Shredded {title}." / "All sorted." The deck card then takes focus (`@AccessibilityFocusState`).
- The drag gesture stays on but isn't announced; the swipe overlays are hidden from VoiceOver.

**Action row.** Labels "Shred", "Undo last swipe" (value: the title it would bring back), "File". Undo when disabled: "Undo, nothing to undo". Voice Control names via `.accessibilityInputLabels`: ["Shred"], ["Undo"], ["File"].

**Focus order on Sort.** Title, subtitle, bulk file prompt, Scan, avatar, card, Shred, Undo, File, outbox accessory, tab bar, search. Set with `.accessibilitySortPriority` where the visual order differs (the toolbar buttons come after the subtitle).

**Sheets.** The check-fields sheet gets focus on its title when it opens. Radio rows are `Button`s with `.accessibilityAddTraits(.isSelected)` on the chosen one and a value of "likely" or "possible".

**Accessory.** One button: label "Outbox", value is the state title ("Uploading 2 of 5"). `ProgressRing` has `.accessibilityValue("62 percent")`.

**Lists.** Every row combines into one element. Swipe actions also appear as custom actions automatically; confirm that "Shredded", "Retry", "Put away" and "Forget" show up in the rotor.

**Pills.** `VerdictBadge` reads "Verdict: Scan + shred"; `StatusPill` reads its text; `SensitiveChip` reads "Sensitive"; the symbol is decorative.

**Tap targets.** Everything tappable is at least 44 x 44 pt, including the split/join controls, chips (34 tall visually, padded to 44 with `.contentShape`), and the Undo circle (48).

**Dynamic Type.** Covered per component. Test at `.accessibility3`: no clipped text, the action row stays usable, the accessory wraps to two lines.

**Motion and color.** Reduce Motion per 2.7. Nothing relies on color alone: every verdict and status has text; unsure rows say "Not sure"; the progress ring has a count beside it.

## 7. Per-feature checklist

The six build agents. "Owns" means builds it and keeps it matching this spec. Shared `Core/UI` components are built first, by deck, in one small PR, so every other agent can build on the real names; until it merges, agents code against the names in section 3.

### Shared, built first by deck (`Core/UI/`)

- [ ] Asset catalog color sets (2.1) and delete the placeholder `Theme.swift`
- [ ] `VerdictBadge` (3.4), `SensitiveChip`, `RetentionChip`, `UnsurePill`, `FilterChip`, `ChoiceChip` (3.5)
- [ ] `StatusPill` (3.6), `ProgressRing`, `DocThumbnail`
- [ ] `Banner` (3.9) and the row layouts in 3.10 as small views (`DocRow`, `SenderRow`)
- [ ] `RootView`: four tabs (Sort `rectangle.stack`, Piles `square.stack.3d.up`, Paperless `leaf`, search role), `.tabViewBottomAccessory` hosting outbox's `OutboxAccessory`, avatar button opening Settings, a router that lets the accessory push `OutboxScreen` onto the current tab

### auth

- Screens: 4.1 Sign-in, 4.9 Settings shell (account row, Google Drive section, Account detail, footer), 4.10 Face ID lock, 4.16 Reconnect Drive (the auth half: `reconnectDrive()`, Settings state, banner trigger)
- Components: Reconnect banner usage, avatar
- Issues: #14, #15, #30, #4

### capture

- Screens: scanner cover, 4.11 Scan review and splitting, 4.15 Import from Files and Photos, camera-denied state
- Components: `ScanMenuButton`, page thumbnails with split and join controls, duplicate line (#2), ID card toggle (#28, later), session row (#26, later), Settings "Shutter" row (#32, later)
- Issues: #19, #32, #28, #2, #26 (session capture), #17 (local save)

### classify

- Screens: 3.8 `CheckFieldsSheet` content and the sender-rule write, 4.12 Senders list and rule detail, Settings "Sender rules" row
- Components: unsure field detection (`fieldUnsureBelow`), `alternatives`, `proposeSplit`, the "Read" / "Reading" states feeding 4.11, the classify-failed card data
- Issues: #20 (confidence and alternatives), #21, #27 (filename pattern chips in the rule detail), #19 (split proposal)

### deck

- Screens: 4.2 Sort deck, 4.3 low-confidence presentation, 4.13 Card detail and edit, 4.14 Keep original confirm, bulk file sheet (flow in section 5), Sort empty and reading states
- Components: `DeckCard`, swipe overlays, `ActionRow`, undo window, haptics for swipes and buttons, bulk file prompt, Settings "Offer to file confident cards together" row, VoiceOver actions (section 6)
- Issues: #20 (bulk filing, deck side), #33, #27 (filename chips in detail), #24 and #25 (detail rows, later)

### outbox

- Screens: 4.4 Outbox, Earlier list, 4.16 Reconnect Drive (the outbox half: pause and resume, banner on Outbox)
- Components: `OutboxAccessory` (all states in 3.7), outbox rows, retry and backoff, the undo-window release and "Send back to the deck", success and warning haptics, page count and checksum verification
- Issues: #17, #18 (verification), #1, #15 (resume after reconnect), #31 (import old log, later)

### piles / search / paperless

- Screens: 4.5 Piles (Shred, Keep, All filed), 4.6 Search and the document view, 4.7 Paperless and sender detail, Junk mail entry (#29, later), Settings "Shred hold" row
- Components: safe-to-shred banner, Mark as shredded flow, still mailing banners, search highlighting and snippets, "Also in Drive"
- Issues: #18 (safe rule and hold), #22, #23, #24, #25, #26 (shred log), #29

### Not on iPhone

#3 (web redirect sign-in), #9 (retire the artifact) and #34 (web modules) are web app issues with no screen here.
