# Paper Trail for iPhone: design brief

_Written 2026-10-13. Feeds the native Swift app (#33). Sketches: `index.html` in this folder, rendered to `direction-A.png`, `direction-B.png`, `direction-C.png` and `board.png`. Builds on `replica/overhaul-shortlist.md`, `replica/native-scanner.md` and the six `replica/recon-*.md` maps. All names and amounts in the sketches are made up._

## Sources

| ID | Source | URL |
|---|---|---|
| H1 | Apple HIG: Materials (Liquid Glass is a control layer, "use Liquid Glass effects sparingly") | https://developer.apple.com/design/human-interface-guidelines/materials |
| H2 | Apple HIG: Tab bars (floats above content, search tab at the trailing end, accessory like the Music mini player, minimizes on scroll) | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| H3 | Apple HIG: Sheets (detents, swipe down to dismiss) | https://developer.apple.com/design/human-interface-guidelines/sheets |
| H4 | Apple HIG: Playing haptics (use standard patterns for their documented meaning) | https://developer.apple.com/design/human-interface-guidelines/playing-haptics |
| H5 | Apple HIG: Gestures | https://developer.apple.com/design/human-interface-guidelines/gestures |
| H6 | Apple HIG: Typography (Dynamic Type) and SF Symbols (not fetched this session; standard references) | https://developer.apple.com/design/human-interface-guidelines/typography, https://developer.apple.com/design/human-interface-guidelines/sf-symbols |
| I1 | BGR: iOS 27 adds a Liquid Glass transparency slider | https://www.bgr.com/2191219/ios-27-liquid-glass-fix-customization/ |
| I2 | Yanko Design: WWDC 2026, what shipped (refinement, not redesign) | https://www.yankodesign.com/2026/07/28/wwdc-2026-six-weeks-later-what-actually-shipped/amp/ |
| T1 | Superhuman: customizing swipes and the triage bar | https://help.superhuman.com/article/461-mobile-customizing-swipes-and-triage-bar |
| T2 | Superhuman: inbox zero in 7 steps (archive opens the next message; split inbox) | https://blog.superhuman.com/inbox-zero-in-7-steps/ |
| T3 | Spark: four swipes, short and long in each direction | https://sparkmailapp.com/help/manage-your-inbox/manage-emails-with-swipes |
| T4 | Slidebox App Store listing (swipe up to trash, undo, trash held until you empty it) | https://apps.apple.com/us/app/-/id984305203 |
| T5 | iPhone Life: Slidebox walkthrough (restore from the in-app trash) | https://iphonelife.com/node/274027 |
| T6 | Tinder help: Rewind (take back the last swipe) | https://www.help.tinder.com/hc/en-us/articles/115004493323 |
| T7 | Swipe deck design write-up: buttons must emit the same event as a drag; one-step undo | https://www.techinterview.org/post/3233474992/design-tinder-swipe-deck-mobile/ |
| T8 | LogRocket on contextual swipe (summarizes the NN/g finding that hidden swipe actions lack signifiers and are found by accident) | https://blog.logrocket.com/ux-design/accessible-swipe-contextual-action-triggers |
| R | The recon maps in `replica/` (quotes cited there with their own sources) | local |

## UX principles

**Steal**

1. **Glass for controls, never for content.** Tab bar, accessory, action buttons and sheets get Liquid Glass; the document card stays opaque so the scan is readable [H1]. iOS 27 only refined the material and added a user transparency slider, so build on the system components and let them follow the setting [I1, I2].
2. **The outbox is a tab bar accessory.** Apple's own pattern for something that keeps running while you do other things (the Music mini player) [H2]. Upload status is always one glance away, which answers Adobe's "stuck upload" and Genius Scan's "it acts like it sent" complaints [R: Adobe 14 to 15, Genius 5 to 7].
3. **Every swipe has a visible button twin, and the buttons fire the same action.** Swipes are fast but undiscoverable on their own [T7, T8]. The deck always shows Shred and File buttons.
4. **One-step undo, always on screen.** Mis-swipes are constant in decks [T6, T7]. Slidebox's trash holds deletions inside the app until you empty it [T4, T5]; Paper Trail's equivalent is the shred hold (shortlist #3).
5. **Advance automatically.** Filing a card shows the next one, the way archiving opens the next email [T2]. No confirmation screen in between.
6. **Split by confidence.** Superhuman's split inbox [T2] plus paperless-gpt's "apply what you are confident about, show me the uncertain parts" (shortlist #5): confident cards can be filed together, unsure ones get a closer look.
7. **Short and long swipes for power use.** Spark maps four actions to short and long swipes [T3]; useful in a dense list, too much for a single big card.
8. **Ask with choices, not text fields.** PaperKarma's "not this?" list and Genius Scan's suggestion chips [R: PaperKarma, Genius]. A low-confidence field offers Claude's top two guesses plus Edit.
9. **Sheets for decisions, at a medium detent, swipe to dismiss** [H3]. The card stays visible above.
10. **Haptics with their documented meanings** [H4]: a light impact when the card crosses the commit threshold, success when the Drive upload is verified, warning on a failed upload. Nothing else buzzes.
11. **Dynamic Type and SF Symbols throughout** [H6]. Cards must reflow at the largest text sizes; that argues against fixed-height card layouts with text overlaid on images.

**Avoid**

- Paywalls, review prompts and interruptions mid-scan (the top complaint for Adobe Scan and Genius Scan) [R].
- Re-sign-in on open (Neat) and anything that suggests Drive has disconnected (Paper Trail's own #14 and #15) [R].
- An empty taxonomy to set up before the app helps (Paperless-ngx) [R]. Folders come from Claude and sender rules, never from a setup screen.
- Swipe-only actions with no signifier [T8], and more than two actions behind one swipe direction.
- Glass on list rows or cards [H1]; tinted tab labels that match content colors [H2].

## Information architecture

**Tabs (four plus search).** Sort, Piles, Paperless, and a trailing search tab [H2]. Outbox is not a tab; it lives in the tab bar accessory and opens as a pushed screen (A) or becomes a tab (C, which trades the accessory for density). Settings sits behind the avatar in the nav bar, since it is visited rarely.

| Tab | Screens |
|---|---|
| Sort | Deck, card detail, low-confidence sheet, scanner, page review and split, undo |
| Piles | Shred pile (safe, on hold), Keep originals (binder numbers), All filed |
| Paperless | Tracker by status, sender detail with the steps to stop paper, "still mailing?" flags |
| Search | Field plus filters, results, document view (PDF with text layer) |
| Accessory / pushed | Outbox (needs attention, uploading, filed today with verified page counts) |
| Avatar | Settings: account, Drive status, sender rules, shred hold, shutter default, Face ID |

**Key flows**

1. **First launch and sign-in.** One screen: Sign in with Google, which also grants Drive in the same consent. The server keeps the refresh token (shortlist #1), so this happens once. Then a single empty deck with "Scan your first stack" and Import. No tour.
2. **Scan to deck.** Scan button on the Sort screen opens the scanner (VisionKit stopgap, custom later per `native-scanner.md`). Done hands the pages to a review screen where Claude has already proposed the split into documents (A3, B3, C3). One button sends them to the deck. Everything is saved on the phone first.
3. **Swipe.** Right files the original to Drive (Scan + shred or Keep original); left shreds without filing. A light haptic at the commit threshold, the next card slides up, the undo button arms for one step. Shredding a Keep original card asks first.
4. **A low-confidence card.** The card shows "2 to check" and highlights the unsure fields. File opens a sheet (A), a choice strip under the card (B), or inline chips in the field table (C) with Claude's top guesses. "Remember for this sender" is on by default, which creates a sender rule.
5. **The outbox.** Each filed card becomes an upload. The accessory shows progress; failures retry on their own and surface under "Needs attention". A document becomes safe to shred only when Drive has it and the page count matches, then after the shred hold.
6. **Finding a document.** Search tab, type "w-2 2023". Results match the text layer and the fields (sender, type, year). Tap a result to open the PDF, with Open in Drive.

## Three directions

| | A. Glass | B. Desk | C. Console |
|---|---|---|---|
| Visual language | Native iOS 26/27: grouped backgrounds, Liquid Glass tab bar and accessory, SF Pro, the web app's ink blue as the tint | The web app's rubber stamps taken all the way: paper sheets, manila tags, sticky notes, envelopes, a ledger, folder tabs instead of a tab bar | Compact utility: small type, mono data, tables, a split bar at the top and a standard tab bar with five tabs including Outbox |
| Deck mechanics | One card, swipe left or right, with Shred / Undo / File glass buttons under it | Drag the paper itself into a shredder slot or a Drive tray at the bottom of the screen; stamp shows the verdict | Focused card plus a queue below. Four-button triage bar (Shred, Keep, Skip, File). Short and long swipes on rows. "File all 18" banner for the confident split |
| On the card | Medium: title, sender and date, folder, two chips, filename | Least: the scan is the card, with a tag holding title, sender, date and folder | Most: every field with a five-step confidence meter, the verdict as a segmented control |
| Low confidence | Highlighted rows on the card, sheet at medium detent with radio choices | Sticky note plus pencil circles, torn-paper choice chips | Amber rows with inline alternative chips, no extra screen |
| Build cost in SwiftUI | Lowest. Mostly system components that pick up Liquid Glass by themselves | Highest. Custom drawing, custom tab bar, custom drag targets; needs care to stay legible at large Dynamic Type | Medium. Standard lists and tables, a custom triage bar |
| Risk | Can feel generic | Charming the first hour, slow at card 200; custom tab bar fights iOS conventions | Busy on a small screen; the bulk-file button makes it easy to skip the check Bryce is supposed to be |

## Recommendation

**Build A, and take two things from the others:** C's confidence split with the "File all N confident" banner (the fastest way through a box, and it keeps the deck for the cards that need a human), and B's rubber-stamp verdict badges in place of A's plain pills, so the app still looks like Paper Trail. A is the cheapest to build on SwiftUI because the system components carry Liquid Glass, Dynamic Type and accessibility for free [H1, H2, H6], and its outbox accessory is the clearest answer to the upload trust problem that dominates the recon reviews.
