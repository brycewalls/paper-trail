# Recon map: PaperKarma plus the US opt-out services (DMAchoice, OptOutPrescreen, Catalog Choice)

Scope: how a photo of a mailer becomes an opt-out request, sender recognition, request status and follow-up, what users report about results, the free opt-out registries PaperKarma sits on top of, and how bank and utility "go paperless" enrollment actually works (which PaperKarma explicitly does not do).
For: Paper Trail, Bryce's phone-first Firebase app for clearing a box of paper (Claude reads each document, swipe right files the original into Drive's Paperwork Archive, swipe left shreds, plus a shred pile, originals to keep, and a Go paperless list). Current pain: sign-in check on every open and Drive disconnects from short-lived tokens. The goal is features worth stealing, not a clone.
Date: 2026-10-13
Method: public sources only (marketing site, FAQ, App Store listing and reviews page, JustUseApp review mirror, press and blog reviews, FTC guidance, bank and utility help pages). No account, no login, no in-app capture. Each page was read once through WebFetch. Google Play listing returned 404 for the guessed package id, optoutprescreen.com returned 403, and the Arctic Shift Reddit archive rate-limited every request ("Too many requests"), so Reddit quotes are missing.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | PaperKarma home | https://www.paperkarma.com/ | "100,000+ mailers" database, about 100 added daily; "10M+ opt-out requests"; 90-day money-back guarantee; proxy email to mailers; results in 2 to 3 months |
| 2 | PaperKarma FAQ | https://www.paperkarma.com/faq | full capture flow, status states (Success, Processing, Failed, Pending), top-10 match picker, "Is this mailer listening?", what can't be stopped (bills, statements), plan prices |
| 3 | App Store listing | https://apps.apple.com/us/app/paperkarma-stop-junk-mail/id1231098843 | 4.4 stars, 1.1K ratings; JET Internet LLC; v5.2.5 (May 6, 2025); IAP $3.99 / $15.99 / $24.99, Lifetime $59.99; 4 free requests; privacy labels |
| 4 | App Store reviews | https://apps.apple.com/us/app/paperkarma-stop-junk-mail/id1231098843?see-all=reviews | 10 reviews with dates and developer replies; star values not in fetched text |
| 5 | JustUseApp review mirror | https://justuseapp.com/en/app/1231098843/paperkarma-stop-junk-mail/reviews | App Store reviews mirrored; dates and stars not shown; its "safety score" is NLP-derived, ignored |
| 6 | PaperKarma subscription page | https://www.paperkarma.com/product/paperkarma-subscription/ | web purchase route (from search result; not read in full) |
| 7 | PaperKarma junk mail guide | https://paperkarma.com/stop-junk-mail/ | 4-step checklist: OptOutPrescreen, DMAchoice, PaperKarma, Catalog Choice; "8 to 12 weeks"; vendor-authored |
| 8 | PaperKarma perspective post | https://www.paperkarma.com/perspectives/how-i-get-no-junk-mail/ | capture description; mentions USPS Informed Delivery daily mail scans |
| 9 | CIO.com | https://www.cio.com/article/3003417/junk-mail-and-spam-got-you-down-get-these-2-apps.html | flow ("Unsubscribe me!" button), app said success but catalogs kept coming; still-sending report button |
| 10 | Footprint Hero review | https://footprinthero.com/paperkarma-review | 13 mailers over a month, all but one stopped; "about 30 seconds" per piece |
| 11 | AOL (Reddit-sourced) | https://www.aol.com/5-minute-fix-finally-canceled-175757394.html | Redditors recommend PaperKarma as "insurance" on top of DMAchoice; author paid $25/yr; no thread URLs given |
| 12 | BuzzFeed News (2013) | https://www.buzzfeednews.com/article/sapna/paperkarma-app-provides-salvation-from-junk-snail-mail | acquired by Reputation.com in 2013; "typically within 72 hours" then |
| 13 | FTC: How to stop junk mail | https://consumer.ftc.gov/articles/how-stop-junk-mail | OptOutPrescreen 5-year online or permanent via signed mailed form; SSN and DOB optional; DMAchoice $6 online / $7 by mail, 10 years |
| 14 | DMAchoice home | https://www.dmachoice.org/ | ANA mail preference service; deceased and caretaker opt-outs; email opt-out; login required for registration (not used) |
| 15 | Catalog Choice home | https://www.catalogchoice.org/ | nonprofit, "nearly 10,000 titles", search a sender and submit; previous occupant and deceased; free, donation-supported |
| 16 | Huntington paperless | https://huntington.com/Personal/online-banking/paperless | "paperless preferred" for all eligible accounts or toggle per account |
| 17 | First Bank eStatements | https://www.firstbank.com/estatements/ | first eStatement next cycle; each joint holder enrolls separately; 18 months of history |
| 18 | Navy Federal paperless | https://navyfederal.org/services/mobile-online-banking/paperless-statements.html | up to 36 months saved |
| 19 | BofA Private Bank going paperless | https://www.privatebank.bankofamerica.com/articles/going-paperless.html | each statement recipient enrolls; accept e-delivery terms |
| 20 | Hawaiian Electric paperless | https://www.Hawaiianelectric.com/billing-and-payment/how-to-pay-your-bill/paperless-billing | online account first (account number plus ZIP, identity check), then paperless box |
| 21 | Muskegon e-billing | https://muskegon-mi.gov/city-services/finance-administrative/city-treasurer/utility-fees-charges/e-billing-signup/ | $0.75 monthly credit for paperless |
| 22 | Langley FCU eStatements | https://langleyfcu.org/resources-e-statement-enrollment | toggling on and off repeatedly can delay a statement |

Checked and came up empty or blocked: Google Play listing (404 at the guessed id), optoutprescreen.com (403), DMAchoice FAQ (404), Reddit through Arctic Shift (rate-limited on every try). PaperKarma screenshots were not readable through fetch, so screen layouts below come from the FAQ and reviews, not images.

## Core loop

Photograph a piece of junk mail (logo or return address), confirm the matched sender, pick which saved name and address it was sent to, tap Unsubscribe. PaperKarma sends the opt-out through that mailer's channel, tracks the request, and asks later whether the mailer stopped (2, 3, 9).

## Capture

| question | answer | source |
| --- | --- | --- |
| Input | Camera button, or pick a photo from the gallery | 2 |
| What to shoot | "clear, close-up photo of the mailer's" name, logo, or return address; not the whole piece | 2 |
| Batch | One mailer per request; no batch capture described | 2, 10 (unknown whether multi-photo exists) |
| Photo kept? | Yes, it doubles as "proof" you received the mail | 1, 2 |
| Time per piece | "about 30 seconds" | 10 |
| Camera UX | v5.2.0 "Improved camera experience"; specifics unknown | 3 |

## Reading and sender recognition

- Matches the photo against a database of 100,000+ mailers, about 100 added daily (1, 3). Method (OCR, image match, human review) is not disclosed: unknown.
- If the top match is wrong you pick from the **top 10 matches** or search by name (2).
- No name, logo or address on the piece means no request (2).
- Yearly subscribers can request a new mailer be added; users can suggest local mailers, which staff verify (1, 2).
- Some mailers are flagged as non-stoppable (EDDM, "Current Resident", ballot and political postcards, scam mail) and reviewers report being told "its a bulk mailer without an option to appeal" (2, 5, 7).
- Accuracy per users: one reviewer says "only right about a quarter of the time"; another says recognition "could be improved" (4, 5).

## Organizing and filing

- **Names and addresses book**: unlimited name and address combinations (spouse, previous occupant, deceased relative, name variants, multiple homes). Each request is tied to the exact name and address on the piece (2, 3, 7). v5.2.2 fixed addresses not saving (3).
- Request history list with status per mailer (2, 9). Archive and delete of requests is mentioned with a "Pending" state (2).
- No folders, tags or document storage: PaperKarma throws away the content and keeps only sender plus request.

## Request status and follow-up (the "review" loop)

| state | meaning | source |
| --- | --- | --- |
| Success | request sent through the mailer's channel | 2 |
| Processing | waiting on a monthly batch, a contact change, or a small mailer without a verified method; continues even if you cancel | 2 |
| Failed | usually sender not identified; about 1% are mailers that refuse | 2 |
| Pending | named only in the archive/delete section; undefined | 2 |

- Expectation-setting is built in: requests mostly go out within 24 hours, but mail stops after **8 to 12 weeks** because mailers print waves in advance; seasonal senders up to a year (1, 2).
- **"Is this mailer listening?"**: after the window, tap a request and answer NO instead of resubmitting; support escalates or reprocesses (2, 4, 9).
- Reviewers see requests sit in Processing "for several weeks" (4).
- Some requests (financial offers) ask for extra confirmation (10).

## Screens (from FAQ and reviews; screenshots not readable)

| # | screen | evidence |
| --- | --- | --- |
| S01 | Sign up (full name, password, confirm) | 4, clareakaoz review |
| S02 | Home / request list with statuses | 2, 9 |
| S03 | Camera with gallery picker | 2 |
| S04 | Match confirm with top-10 alternatives and name search | 2 |
| S05 | Pick name and address | 2, 9 |
| S06 | Unsubscribe confirm ("Unsubscribe me!") and done screen | 9, 10 |
| S07 | Request detail with "Is this mailer listening?" | 2 |
| S08 | Profile, Addresses and names | 2 |
| S09 | Paywall at 5th request (monthly, 6-month, yearly, lifetime) | 2, 3 |
| S10 | Suggest a new mailer (yearly plan) | 1, 2 |

## Flows

1. **Unsubscribe a mailer**: camera, auto-match, confirm or pick from top 10, pick name and address, Unsubscribe, done (2, 9, 10).
2. **Unknown sender**: no match, search by name, or suggest a new mailer, otherwise Failed (2).
3. **Still getting mail**: wait 8 to 12 weeks, open request, "Is this mailer listening?" NO, PaperKarma reprocesses (2, 4).
4. **Previous occupant / family**: add their name to the address book, then select it on capture (2, 7).
5. **Paywall**: 4 free requests, prompt on the 5th (3, 11).
6. **Account deletion**: email human@paperkarma.com; permanent; processing requests cancelled (2).
7. **Registry stack** (outside the app): OptOutPrescreen online (5 years) or mailed form (permanent); DMAchoice ($6 online per FTC, $8 per PaperKarma's guide, 10 years); Catalog Choice per catalog (7, 13, 15).

## Going paperless (what banks and utilities actually require)

PaperKarma does not stop bills, statements, tax forms or account mail (2). That gap is exactly Paper Trail's Go paperless list. The real flows are consistent enough to template:

- Log in, find Statements / Documents / Settings / Paperless / Communication Preferences, toggle per account or "paperless preferred" for all, accept e-delivery terms, confirm (16, 19).
- Utilities often need an online account first (account number plus ZIP, identity check) before the toggle (20).
- **Joint accounts: each holder enrolls separately**, or the other still gets paper (17, 19).
- First eStatement arrives next cycle, so paper keeps coming for about one more month (17).
- Online history is limited (18 months at First Bank, 36 at Navy Federal), so archiving to Drive still matters (17, 18).
- Some utilities pay a credit for paperless ($0.75/month, Muskegon) (21).
- Toggling on and off repeatedly can delay a statement (22).

## Components

Camera sheet; sender match card with confidence and "not this?" list; name-and-address chooser; status chips (Success, Processing, Failed, Pending); request detail with yes/no follow-up prompt; addresses book; paywall; impact counters (marketing site shows opt-outs sent and trees, in-app counters unknown).

## Inferred data model

| entity | fields (inferred) |
| --- | --- |
| User | email, phone (optional, shared only when a mailer needs it), plan, free requests left |
| Identity | full name, address; many per user |
| Mailer | id, name, aliases, logo, channel (email, form, phone, batch), verified flag, stoppable flag |
| Request | user, identity, mailer, photo, created, status, sent_at, follow-up answer, reprocess count |
| MailerSuggestion | user, photo, name, verified |

## Security and privacy

- Says it never sells, shares or rents data; no ads; email to mailers goes through a proxy address; AWS encryption at rest, TLS (1, 2).
- But the App Store privacy label lists Contact Info and Usage Data as **"Used to track you"** and precise Location as linked (3). Worth noting as a mismatch.
- OptOutPrescreen asks for SSN and DOB but both are optional (13).

## Pricing

4 free requests, then $3.99/month, $15.99/6 months, $24.99/year, $59.99 lifetime; 90-day money-back guarantee; store subscriptions must be canceled in the store (1, 2, 3). DMAchoice $6 to $8 one time for 10 years; OptOutPrescreen and Catalog Choice free (7, 13, 15).

## Feature matrix

See `features-paperkarma.csv`.

## What users say

Quotes are verbatim excerpts as returned by WebFetch from the App Store reviews page (source 4) and the JustUseApp mirror of App Store reviews (source 5). Star values were not in the fetched text; sentiment is labeled from content.

**Complaints**

1. COMPLAINT, App Store, VirtualPanther, 2025-10-18 (4): "But almost always, the submissions via the app result in absolutely zero impact."
2. COMPLAINT, App Store, VirtualPanther, 2025-10-18 (4): "Even repeat submissions for the same company do not result in any improvement."
3. COMPLAINT, App Store via JustUseApp, Ken94305, date unknown (5): "still getting mail from at least 90 senders I reported 3 months ago."
4. COMPLAINT, App Store, LaurenW - in SV, 2020-04-11 (4): "now I'm constantly getting NEW catalogues from companies I've never heard of."
5. COMPLAINT, App Store via JustUseApp, JEShakespeare, date unknown (5): "it is only right about a quarter of the time, if that." (sender recognition)
6. COMPLAINT, App Store via JustUseApp, JustOneAndDone, date unknown (5): "it just tells me that its a bulk mailer without an option to appeal this."
7. COMPLAINT, App Store, PacRya, 2022-11-19 (4): "some requests seem to be in a "processing" queue for several weeks"
8. COMPLAINT, App Store, clareakaoz, 2019-11-27 (4): "the Oops message was completely useless" (sign-up form)
9. COMPLAINT, App Store via JustUseApp, Monkeyattack, date unknown (5): "I fail to understand how you can possibly justify charging $20 a year"
10. COMPLAINT, press, CIO.com (9): the app reported success for Hello Direct but catalogs kept coming.

**Praise**

11. PRAISE, App Store, Trevolie, Jan 31 (year unknown) (4): "Keep taking photos of the mailers you don't want, and over time the junk pile really does shrink."
12. PRAISE, App Store, jrlin, Mar 14 (year unknown) (4): "The companies I request to stop sending mail, do actually stop."
13. PRAISE, App Store, Cathy GK, 2025-07-13 (4): "It's the best $25 I ever spent."
14. PRAISE, App Store, Craftygirl79, 2019-10-21 (4): "I hardly get any junk mail anymore."
15. PRAISE, App Store via JustUseApp, CaliRya, date unknown (5): "PaperKarma is a huge time saver."
16. PRAISE, blog, Footprint Hero (10): the whole process "takes about 30 seconds."
17. MIXED, AOL citing Redditors (11): opt-outs "doesn't guarantee all of it will go away," so PaperKarma works as "insurance."

**Patterns**

- Most praised: the snap-and-forget capture that slowly shrinks the pile; patience pays off after 2 to 3 months.
- Most complained about: requests that "succeed" but mail keeps coming, with no visible proof of what happened (quotes 1 to 3, 10).
- Recognition misses and non-appealable "bulk mailer" refusals.
- Long Processing states with no explanation in the moment.
- Price resentment for a service that feels like it should be free (registries are free or $6).
- Onboarding friction (passwords, opaque errors), which is also Paper Trail's own pain point.

## Out of scope (cannot or should not be cloned)

- **The 100,000-mailer database and mailer contact channels.** Years of curation; Paper Trail should use Claude reading the document plus Bryce's own sender history instead.
- **Sending opt-outs on Bryce's behalf.** Requires mailer relationships and a proxy email system. Paper Trail can instead hand him the exact link, phone number or steps and track that he did it.
- **Subscription and paywall.** Personal app.
- **Tracking SDKs** (their privacy label). Keep Paper Trail tracker-free.

## Size

Screens 10 (about 6 relevant), flows 7 (about 4 relevant), entities 5 (about 3 relevant, mapped onto Paper Trail's existing docs and paperless collections).

Hard parts for Paper Trail:
1. A sender entity that merges across documents (same bank, different statement titles) so status follow-ups attach to the sender, not the page.
2. Reliable follow-up timing (the next-cycle check) without push infrastructure; an in-app "due" list on open is enough.
3. Good go-paperless steps per sender without a database: Claude can draft them from the document, but they must be marked as unverified until Bryce confirms.

Size: **S to M** for the steals below layered onto the existing deck and Go paperless list.

## Steal for Paper Trail

1. **Sender ledger with status chips.** Turn the Go paperless list into per-sender rows with states (To do, Requested, Waiting one cycle, Confirmed stopped, Can't stop). Fits because Bryce's box repeats senders and he needs to see which ones are done. Effort: M.
2. **"Is this sender still mailing?" follow-up.** When a new document from a sender already marked paperless gets scanned, flag it automatically ("You switched Chase to paperless on Sep 2, but this statement is paper"). PaperKarma asks; Paper Trail can detect it from the scan itself. Effort: S.
3. **Expectation timer.** Show "next statement likely still paper, check after {date}" when he marks a sender paperless, borrowing PaperKarma's 8 to 12 week framing and the bank "next cycle" rule. Removes the "did it work?" anxiety reviewers complain about. Effort: S.
4. **Names and addresses book.** Let Claude tag which person and address a document is addressed to (Bryce, previous occupant, family). Previous-occupant mail goes straight to shred plus a "return to sender" tip; family mail gets routed. Effort: S.
5. **Top matches when the sender is wrong.** On the filing card, a "not this?" list of his existing senders and folders to correct Claude in one tap, and remember the correction for that sender. Effort: S.
6. **Junk mail lane.** A third verdict next to the paperwork ones: "junk, opt out" with the right registry or link (OptOutPrescreen for credit offers, DMAchoice for catalogs, Catalog Choice by name) and a once-only checklist card for the free registries. Effort: M.
7. **Go-paperless step template.** For each paperless sender, Claude drafts the click path (Settings, then Statements, then Paperless) plus the caveats that bite: joint holders enroll separately, accept the terms, utilities may need an account number and ZIP. Effort: S.
8. **Impact counter.** Simple running totals on the home screen (pieces shredded, senders switched, pages filed) like PaperKarma's opt-outs and trees counters. Motivation for clearing a box. Effort: S.
9. **Frictionless return visits.** PaperKarma's worst onboarding reviews are about login friction; Paper Trail should keep the session (persistent Firebase auth, Drive refresh through a server-side token) so opening the app goes straight to the deck. Directly answers Bryce's two pain points. Effort: M.
