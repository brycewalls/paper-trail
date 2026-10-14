# Recon map: Shoeboxed and Neat (iOS, Android, web)

Scope: receipt and document capture (phone, email, Gmail sync, scanner, mail-in Magic Envelope), extraction fields, human verification, categories and rules, search, expense and tax reports, exports and integrations, retention and shred or return of paper originals, pricing.
For: Paper Trail, Bryce's phone-first Firebase web app for clearing a box of paper. Claude reads each document (title, type, issuer, date, folder, filename, verdict shred / scan_shred / keep_original, retention, sensitive flag, paperless tip), he swipes right to file the PDF into Google Drive "Paperwork Archive" (11 numbered folders) or left to shred, and the app tracks a shred pile, originals to keep, and senders to switch to paperless. The goal is to find features worth stealing for the overhaul, not to copy either app.
Date: 2026-10-13
Method: public sources only (marketing sites, pricing pages, help centers, App Store listings and reviews, Trustpilot, third-party reviews). No account, no login, no JS bundles. Capterra, G2, Software Advice and TechRepublic returned 403 to WebFetch; Google Play listing URLs returned 404; the Reddit archive (Arctic Shift) timed out on every query. Those gaps are marked unknown below.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Shoeboxed home | https://www.shoeboxed.com/ | capture methods, human verification claim, 15 tax categories, exports, Durham NC paper facility, shred or return |
| 2 | Shoeboxed pricing | https://www.shoeboxed.com/pricing/ | Starter $9, Pro $29, Plus $79, Paper Plus $179 per month; scan caps; storage 3 years on Starter, forever on Pro and up; overage prices; shred checkbox |
| 3 | Shoeboxed help: will my documents be returned | https://www.shoeboxed.com/support/will-my-documents-be-returned-to-me | return is default on older plans; "Shred and recycle my documents" checkbox under My mail-in settings; no proof of shred described |
| 4 | Shoeboxed help: processing time | https://www.shoeboxed.com/support/how-long-will-it-take-for-my-documents-to-be-processed-can-i-expedite-the | digital within 24 hours, mail within 3 business days, envelope tracking codes |
| 5 | Shoeboxed help: other documents | https://register.shoeboxed.com/blog/does-shoeboxed-process-other-documents | non-receipts get scan, OCR and archive "by date and title" in an Other Documents folder; size limits |
| 6 | Shoeboxed help: categories | https://www.shoeboxed.com/support/does-shoeboxed-categorize-my-receipts-can-i-customize-the-categories | 15 default categories by vendor; vendor rules; receipts only |
| 7 | Shoeboxed help: search | https://www.shoeboxed.com/support/what-are-some-tips-for-finding-receipts-when-using-shoeboxed-s-search-function | "Search everything" covers OCR text plus hand-entered fields; filters by vendor, date, price, category, envelope |
| 8 | Shoeboxed help: Gmail Receipt Sync | https://www.shoeboxed.com/support/how-do-i-set-up-gmail-receipt-sync | auto-picks receipts from new mail, labels them "Sent to Shoeboxed", not retroactive |
| 9 | Shoeboxed help: Magic Envelope size | https://new.shoeboxed.com/support/how-big-are-magic-envelopes-and-how-much-can-i-send-in-them | 9 x 12 Tyvek, prepaid both ways, unique account code, US only |
| 10 | Shoeboxed help: export | https://support.shoeboxed.com/expense-reports/how-do-i-export-to-pdf-csv-and-quickbooks-online | CSV, PDF, QuickBooks Online from Receipts page; report emailed |
| 11 | Shoeboxed App Store listing | https://apps.apple.com/us/app/shoeboxed-receipt-scanner-app/id322143854 | 4.5 stars, about 1.8K ratings, v7.2.2; Magic Envelopes tab with envelope code and status; "Data Not Collected" label |
| 12 | Shoeboxed App Store reviews | https://apps.apple.com/us/app/shoeboxed-receipt-scanner-app/id322143854?see-all=reviews | 10 unique reviews, mostly 2017 to 2023 |
| 13 | Shoeboxed Trustpilot | https://www.trustpilot.com/review/shoeboxed.com | 2.8, 3 reviews, unclaimed profile |
| 14 | Capterra Shoeboxed (search snippet only) | https://www.capterra.com/p/143767/Shoeboxed-Receipt-and-Mileage-Tracker/ | 4.4 from 227 reviews; summary pros and cons; page itself 403 |
| 15 | Neat home | https://www.neat.com/ | phone, email forward, drag and drop, scanner; auto tax-category matching; $200/yr; no mail-in |
| 16 | Neat pricing | https://www.neat.com/pricing/ | $200/yr, VIP Service +$50/yr, Automated Insights +$150/yr |
| 17 | Neat digital filing cabinet | https://www.neat.com/digital-filing-cabinet/ | "Data capture with human verification", guided workflows suggest matches, search by keyword/date/category, sharing with comments, QuickBooks mapping memory |
| 18 | Neat App Store reviews | https://apps.apple.com/us/app/neat-business-receipts/id1490480504?see-all=reviews | 4.4, 148 ratings |
| 19 | Neat Trustpilot | https://www.trustpilot.com/review/neat.com | 4.6, 2,363 reviews but none in last 12 months; mostly support-call praise |
| 20 | Neat third-party review summary (search snippet) | https://www.techrepublic.com/article/neat-review/ | exports PDF, CSV, TXF, QIF, QFX; "99% accuracy" vendor claim; annual only; page itself 403 |
| 21 | Neat vendor reply on Software Advice (search snippet) | https://www.softwareadvice.com/productivity/neat-profile/reviews/ | 2020 reply: no access after payment stops, bulk download not available; page itself 403 |

Checked and came up empty or blocked: Reddit (Arctic Shift timed out, web search found no Shoeboxed threads), Google Play listings (404), G2 (403), TechRadar (paywall shell only).

## Core loop

Shoeboxed: get paper or e-receipts into the account (photo, email forward, Gmail sync, or mail a prepaid Magic Envelope), AI extracts vendor, total, date, tax and payment type, a human checks it, it lands in one of 15 tax categories, then you search, run an expense report with images attached, or export to CSV or accounting software at tax time. Paper sent in is shredded or returned. (1, 2, 3)

Neat: same shape minus mail-in. Capture, AI plus human data capture, guided filing into categories and folders, search, then reports and exports to tax and accounting tools. Neat leans more toward a "digital filing cabinet" for all paper; Shoeboxed leans toward receipts. (15, 17)

## Capture

| question | Shoeboxed | Neat | source |
| --- | --- | --- | --- |
| Phone camera | yes; App Store review complains app "only allows for 1 page receipts" (2018); v7.1.9 notes multi-page receipts now appear fully in reports | yes; batch of multiple single-page receipts in one flow | 11, 12, 18 |
| Email forward | yes, a dedicated Shoeboxed address | yes | 1, 15 |
| Inbox sync | Gmail Receipt Sync (Pro and up), new mail only, applies a Gmail label | not found (unknown) | 2, 8 |
| Desktop upload | drag and drop, multiple at once | drag and drop | 1, 15 |
| Scanner | unknown | any TWAIN scanner via Neat Scan Utility; old Neat-branded scanners discontinued about 2017 | 19, 20 |
| Mail-in | Magic Envelope: 9 x 12 Tyvek, prepaid both ways, holds hundreds of receipts, unique code ties it to the account, US only; envelope count per plan | no | 2, 9 |
| Prep rules for mail-in | loose items, no sorting needed, nothing attached to larger sheets, multi-page docs clipped together become one doc | n/a | 1, 9 |

## Reading and extraction

| field or behavior | Shoeboxed | Neat | source |
| --- | --- | --- | --- |
| Receipt fields | vendor, total, date, sales tax, payment type, line items | merchant, date, amount, tax, payment type; line items with add-on | 1, 8, 20 |
| Non-receipt documents | scanned, OCR'd, archived "by date and title" in Other Documents; no category | invoices parsed; business cards become contacts; general documents filed | 5, 6, 17 |
| Human verification | yes, "data entry professionals will inspect and verify" (pricing page itself does not mention it) | yes, "Data capture with human verification" | 1, 2, 17 |
| Turnaround | digital within 24 hours, mail within 3 business days | unknown | 4 |
| Accuracy claim | none published | "99% accuracy" (vendor claim) | 20 |
| Currency conversion | yes, account setting | unknown | 1 |

## Organizing and filing

- Shoeboxed: 15 default receipt categories: Auto / Fuel, Bank / ATM, Computer / Internet, General Retail, Groceries, Insurance, Meals / Entertainment, Medical / Health, Office Supplies, Postage / Shipping, Professional Fees, Promotion / Advertising, Telecommunications, Travel / Transport, Utilities. Assigned by vendor name. (6)
- Shoeboxed vendor rules: when you recategorize a receipt it asks whether to create a rule so future receipts from that vendor file the same way; rules managed next to the Categories filter. (6)
- Shoeboxed folders: Receipts, Business Cards, Other Documents; category sets can be hidden. (5, 6)
- Neat: sort by type, category and other criteria; "guided workflows suggest matches"; custom folders (App Store review mentions filing into custom folders); QuickBooks expense mappings remembered for next time. (17, 18)

## Search

- Shoeboxed "Search everything" covers OCR full text plus the human-entered fields. Filters: vendor, date range, price range, category, envelope; mobile filters by category and reimbursement status. (7)
- Neat: keyword, date and category; whether search covers full OCR text is unknown. (17)

## Retention and shredding

- Shoeboxed paper: per account checkbox "Shred and recycle my documents (do not return)" under My mail-in settings; unchecked means returned with a fresh envelope. Pricing FAQ says new plans default to shredding; an older help page says return is the default. No shred timing, holding period, or certificate is published. (2, 3)
- Shoeboxed digital: 3 years on Starter, "forever, while account is active" on Pro and up (an older FAQ snippet says 2 and 3 years; conflicting). (1, 2)
- Shoeboxed pitches scans as "IRS-accepted" (marketing framing). (search snippet of 1)
- Neat: no published retention policy; 2020 vendor reply says access ends when payment stops and bulk download was not available. (21)
- Neither app tracks a per-document retention period ("keep 7 years, then shred") or a "keep the original" verdict. Gap for both.

## Going paperless

Neither app helps you stop paper at the source (no "switch this sender to e-statements" list). Their answer is "send us the paper" (Shoeboxed) or "scan everything" (Neat). Gmail Receipt Sync is the closest thing: it captures what already arrives digitally. (8)

## Sync and integrations

- Shoeboxed: QuickBooks Online and Xero (Pro and up), Wave, Evernote, Dropbox, Zoho Expense, Neat; CSV and PDF export from the Receipts page, report emailed to you. (1, 2, 10)
- Neat: QuickBooks (images plus data, mapping memory), TurboTax, H&R Block, Quicken, Outlook, Google Contacts, mail tools; export PDF, CSV, TXF, QIF, QFX. (17, 20)
- Neither lists Google Drive as a filing target. Dropbox (Shoeboxed) is the closest. (1)

## Security and privacy

- Shoeboxed: SSL, paper held at a Durham NC facility with 24/7 monitored entry; App Store label "Data Not Collected"; background location for mileage. (1, 11)
- Neat: "bank-level encryption", monitored and audited data centers, "won't be shared or sold"; App Store lists contact info, user content and identifiers as linked data. (17, 18)
- Sign-in: Neat App Store review "Have to re login EVERY TIME YOU USE THIS APP" (2023), the same pain Bryce has. Shoeboxed session behavior unknown. (18)

## Pricing

| plan | price | digital scans | paper scans | envelopes | storage |
| --- | --- | --- | --- | --- | --- |
| Shoeboxed Starter | $9/mo or $97/yr | 50/mo | 20/yr | 1/yr | 3 years |
| Shoeboxed Pro | $29/mo or $297/yr | 250/mo | 50/mo | 1/quarter | while active |
| Shoeboxed Plus | $79/mo or $797/yr | 1,000/mo | 150/mo | 1/mo | while active |
| Shoeboxed Paper Plus | $179/mo or $1,997/yr | 5,000/mo | 300/mo | 2/mo | while active |
| Neat | $200/yr, annual only | unlimited storage | n/a | n/a | while paid |

Overage: Shoeboxed paper scan $0.77 to $2.00 each, extra envelope $9. No refund once an envelope ships. Neat add-ons VIP Service $50/yr, Automated Insights $150/yr. (2, 16, 20)

## Screens

Inferred from listings and help pages (no account): Receipts list with Filters pane, receipt detail with image and editable fields, Business Cards, Other Documents, Expense Report builder, Reports and export, Integrations, Account settings with My mail-in settings, mobile capture, mobile Magic Envelopes tab with envelope code and status (v7.2.0 to 7.2.1), mileage. Neat: dashboard, filing cabinet with folders, capture, review queue with suggested matches, reconcile, reports. (1, 6, 7, 10, 11, 17)

## Flows

1. Mail-in: request envelope, stuff loose paper, mail it, envelope status updates in app, notified when scans are ready, paper shredded or returned per setting. (2, 4, 9, 11)
2. Recategorize: change one receipt's category, prompt "create a rule for this vendor?", future receipts auto-file. (6)
3. Tax time: filter by date range and category, build report with images attached, export CSV or PDF or push to QuickBooks. (7, 10)
4. Gmail sync: connect once, new receipts pulled automatically and labeled in Gmail. (8)

## Components

Filter pane (vendor, date, price, category, envelope), category chip with rule prompt, envelope status card with code, report with attached images, settings checkbox for shred vs return, "Search everything" bar. (3, 6, 7, 11)

## Inferred data model

- Document: id, type (receipt, business card, other), image(s), OCR text, vendor, total, tax, date, payment type, category, line items, verified flag, envelope id, reimbursement status.
- Envelope: code, status, received date, item count.
- Category and VendorRule: vendor name to category.
- Report: date range, filters, documents, export format.
- Account mail-in settings: shred or return.
(1, 6, 7, 11; field names inferred, not seen in an API.)

## Feature matrix

See features-shoeboxed.csv.

## What users say

Quotes are short excerpts as returned by WebFetch; App Store quotes came from the public reviews page. Star ratings were not shown for most App Store reviews.

**Praise**

1. PRAISE, App Store (Shoeboxed), RipSht, 2018-05-23, 4 stars (12): "you get first hand service with actual people looking at your documents"
2. PRAISE, App Store (Shoeboxed), Alldsny, 2018-04-05 (12): "It spared me of the checking for all receipts, cataloguing, archiving..."
3. PRAISE, App Store (Shoeboxed), shayronbbb, 2017-04-07 (12): "Really love the Gmail Receipt Sync function."
4. PRAISE, App Store (Shoeboxed), Jgrobelny01, 2018-02-08, 3 stars (12): "they pick up the phone unlike many other expense apps"
5. PRAISE, App Store (Neat), prb1, 2023-07-23, 5 stars (18): "I simply photograph the receipt and rapidly file it away."
6. PRAISE, App Store (Neat), InWyo, 2023-03-20, 5 stars (18): "lost receipts are a thing of the past."
7. PRAISE, App Store (Neat), CarolB0208, 2025-04-24, 5 stars (18): "It could not be easier." (filing into custom folders on iPad)

**Complaints**

8. COMPLAINT, App Store (Neat), CS135111, 2023-10-16 (18): "Have to re login EVERY TIME YOU USE THIS APP" and "is such a waste of time and a barrier."
9. COMPLAINT, App Store (Neat), I shopper, 2025-01-06 (18): "It doesn't always get the right vendor or the right amount but it does pretty well."
10. COMPLAINT, App Store (Shoeboxed), Earthgrrl, 2018-03-11 (12): "It loses receipts and is kind of confusing to use."
11. COMPLAINT, App Store (Shoeboxed), Jgrobelny01, 2018-02-08, 3 stars (12): "the mobile app only allows for 1 page receipts"
12. COMPLAINT, Trustpilot (Shoeboxed), Nicoletta, 2024-06-04, 2 stars (13): "Slow interface and billing system that still charges you after you cancel"
13. COMPLAINT, Trustpilot (Neat), Robert, 2025-03-19, 1 star (19): "they locked me out of my data for a ransom!"
14. COMPLAINT, App Store (Neat), TXGregg, 2024-03-06 (18): "I would like to be able to default payment types for receipts."
15. COMPLAINT, Capterra summary (14): "Recurring software errors and inaccuracies" (Capterra's own pros and cons summary, from search snippet).

**Patterns**

- Most praised: a human checks the data. People trust Shoeboxed because "actual people" look at the documents, and Neat sells the same thing.
- Most complained about: losing access or friction getting in. Re-login on every open (Neat), locked out of data after canceling (Neat), billing after cancel (Shoeboxed).
- OCR misses on vendor and amount are expected and tolerated when correction is easy.
- Multi-page documents were a long-running gap on the Shoeboxed app.
- Review volume is thin and old for Shoeboxed (App Store reviews mostly 2017 to 2018; Trustpilot 3 reviews). Treat sentiment as directional.

## Out of scope (cannot or should not be cloned)

- Physical mail-in, the Durham facility and human data-entry staff. Paper Trail's equivalent is Bryce himself with the original in hand; the review step is the human check.
- Accounting integrations (QuickBooks, Xero, TXF/QIF). Paper Trail is personal records, not bookkeeping.
- Mileage tracking and business card contacts. Not part of the box-of-paper job.
- Scan quotas, overage fees, annual lock-in. Personal app.
- Expense reimbursement status and multi-user sub-accounts.

## Size

Screens about 12 (about 6 relevant), flows 4 (3 relevant), entities 6 (4 relevant). Size for the stolen pieces: **S to M**. The biggest lift is Drive auth that does not expire (a server-side refresh token), which is a fix rather than a feature.

## Steal for Paper Trail

1. **"Remember this sender" rules** (from Shoeboxed vendor rules). When Bryce changes the folder or verdict for a document, ask "always file [issuer] this way?" and feed saved rules to Claude as hints next time. Fits the swipe flow: fewer corrections as the box empties. Effort S.
2. **Human-verified badge, done by Bryce** (from the most-praised feature). Mark each field Claude was unsure about and show a quick confirm chip on the card before the swipe, so the verified flag means something. Turns review into the trust step users pay Shoeboxed for. Effort S.
3. **Stay signed in, Drive never drops** (from the top complaint, Neat's re-login review). Persist Firebase auth locally and store a Google refresh token server side (Cloud Function exchanges it for short-lived access tokens), so there is no sign-in check on open and no Drive disconnects. Directly fixes both of Bryce's pain points. Effort M.
4. **Batch tracking like the Magic Envelope** (envelope code, status, count). Group a session's documents as a "batch" (for example "Box 1, drawer A") with counts of filed, shredded and kept, and a done state. Gives progress through the box and an audit of what went where. Effort S.
5. **Shred pile with a setting and a log** (from shred vs return). Shoeboxed publishes no shred proof; Paper Trail can do better: a shred pile list with a "shredded on" date stamp per batch, so Bryce knows the original is gone and the Drive copy is the record. Effort S.
6. **Search everything, including OCR text** (from Shoeboxed search). Store Claude's extracted text and fields, then search across them with filters for folder, issuer, date range, verdict and sensitive. Finding a document later is the payoff for filing it. Effort M.
7. **Multi-page documents as one file** (from the clip-together rule and the 1-page complaint). Let Bryce add pages to the current capture before Claude reads it, and merge into one PDF in Drive. Effort M.
8. **Retention clock** (gap in both apps). Use Claude's retention value to compute a "safe to shred after" date for kept originals and Drive copies, and surface what has expired. Neither competitor does this. Effort S.
9. **Export a CSV index** (from Shoeboxed CSV export and Neat's data lock-in complaint). One button writes an index (title, issuer, date, folder, Drive link, verdict, retention) to a sheet or CSV in the Paperwork Archive, so the data is never trapped in the app. Effort S.
10. **Inbox capture later** (from Gmail Receipt Sync and email forward). A Gmail label like "Paper Trail" that pulls attachments into the same review queue, and labels them when filed. Pairs with the go-paperless list once senders switch. Effort L, park for later.
