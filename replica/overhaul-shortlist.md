# Paper Trail overhaul: shortlist

_Merged 2026-10-13 from the six recon reports in this folder (Paperless-ngx, Adobe Scan, Genius Scan, Microsoft Lens + Apple's scanner, Shoeboxed + Neat, PaperKarma). Each per-app `recon-*.md` cites its sources; `features-*.csv` has the full rows. This is the workshop list, not a decision. Tiers are Claude's recommendation; Bryce decides._

## Tier 1: foundation (fixes what's broken today)

| # | Feature | Stolen from | Effort | Why |
|---|---|---|---|---|
| 1 | Stay signed in, and keep the Drive connection on the server (refresh token held by a Cloud Function) | Paperless-ngx, Genius Scan; Neat's "re-login every time" reviews show the opposite | M | Fixes #14 and #15 outright |
| 2 | Local-first outbox: scans and swipes save on the phone first, upload in the background, with a status per document, retry and a history | Adobe Scan, Genius Scan, Microsoft Lens | M | A dropped connection never loses work or blocks scanning |
| 3 | Shred only when it's safe: a document counts as shreddable only after the Drive copy is confirmed (same page count), with an optional hold of a few days | Paperless-ngx (double-feed story), Genius Scan "delete on success" | S | The shred pile becomes trustworthy |

## Tier 2: the big wins

| # | Feature | Stolen from | Effort | Why |
|---|---|---|---|---|
| 4 | Stack mode: scan page after page without tapping, and Claude splits the stack into separate documents | Adobe Scan (paid High-Speed Scan) | M | Clearing a box is exactly this |
| 5 | Confident or unsure: Claude flags the fields it's unsure of. Confident cards can be filed in bulk, and only the unsure ones get a closer look | paperless-gpt, Shoeboxed/Neat human verification | S–M | "Apply what you are confident about. Show me the uncertain parts." |
| 6 | Remember per sender: correct a folder, name or verdict once, and the app applies it to that sender next time ("Not this?" one-tap picker) | Paperless-ngx, Shoeboxed vendor rules, PaperKarma | S | The app gets smarter the more you use it |
| 7 | Search everything: full text plus fields, searchable in the app, and a hidden text layer in the Drive PDF so Drive search finds it too | Paperless-ngx (most praised), Microsoft Lens, Shoeboxed | M | "Where's my 2023 W-2" in two seconds |
| 8 | Paperless ledger: each sender gets a status (To do, Requested, Waiting a cycle, Confirmed, Can't stop), a check-back date, and an automatic "still mailing?" flag when a new scan arrives from a sender marked paperless | PaperKarma | S–M | Turns the Go paperless list into something that actually ends the mail |

## Tier 3: nice to have

| # | Feature | Stolen from | Effort |
|---|---|---|---|
| 9 | Numbered originals: every keep-original paper gets a running number written on it and goes in one binder in number order; the number is in its Drive filename | Paperless-ngx recommended workflow | S |
| 10 | Retention clock: the retention text becomes a "safe to delete after" date, with a quarterly list of what's expired | Shoeboxed (neither app has the date) | S |
| 11 | Named sessions ("Box 1, drawer A") with counts and a dated shred log | Shoeboxed Magic Envelopes | S |
| 12 | Filename template with live preview and tappable suggestion chips | Genius Scan, Adobe Scan | S |
| 13 | ID cards: front and back combined on one page | Adobe Scan | S |
| 14 | Junk mail opt-out helper: photograph junk and get the DMAchoice / OptOutPrescreen / CatalogChoice steps | PaperKarma | M |
| 15 | Optional Face ID lock instead of any check on open | Genius Scan | S (native) |
| 16 | Import the old artifact's 14 documents and copy their files from the bwcreative.org Drive into the new archive | (Paper Trail's own history, #9) | S |

## Not stealing

- Paywalls, trials and review prompts: the top complaint for Adobe Scan, Genius Scan and Neat.
- Human data verification as a paid service (Shoeboxed): Bryce is the human check, via item 5.
- Forced vendor cloud with no local copy (Adobe): Drive stays the archive.
