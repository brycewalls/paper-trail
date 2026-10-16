// Dev corpus, identity, legal, auto, warranties, mail and letters (#92). SYNTHETIC: every name,
// number and address is made up.
export default [
  {
    id: "birth-cert-nc",
    pages: [`STATE OF NORTH CAROLINA
DEPARTMENT OF HEALTH AND HUMAN SERVICES  VITAL RECORDS
CERTIFICATE OF LIVE BIRTH
Child's name  CASEY LYNN MORGAN
Date of birth  March 14, 1991   Sex F
Place of birth  Wake County, Raleigh
Mother's maiden name  PATRICIA ANN LEE
Father's name  ROBERT MORGAN
Date filed  March 21, 1991
This is a true and correct copy of the record on file.  CERTIFIED COPY
State Registrar  (raised seal)`],
    expect: { docType: "Birth certificate", issuer: "State of North Carolina", docDate: "1991-03-14", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "birth-cert-messy",
    pages: [`CERTIFlCATE 0F BIRTH
C0UNTY 0F L0S ANGELES  REGISTRAR-RECORDER
Narne  PAT M0RGAN
Date of Birth  July 2, 1962
Place  Los Angeles, California
CERTIFIED C0PY OF VITAL REC0RD`],
    expect: { docType: "Birth certificate", issuer: "County of Los Angeles", docDate: "1962-07-02", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "ss-card",
    pages: [`SOCIAL SECURITY
THIS NUMBER HAS BEEN ESTABLISHED FOR
CASEY LYNN MORGAN
900-12-3456
SIGNATURE ___________`],
    expect: { docType: "Social Security card", issuer: "Social Security Administration", docDate: "", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "marriage-license-messy",
    pages: [`MARRIAGE CERTIFlCATE
State of Oregon  Multnomah County
This is to certify that Casey Morgan and Riley Park were joined in marriage
on Septernber 9, 2023 in Portland, Oregon
Officiant  J. Avery
Recorded Septernber 15, 2023   Certified copy`],
    expect: { docType: "Marriage certificate", issuer: "Multnomah County", docDate: "2023-09-09", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "passport-card-letter",
    pages: [`U.S. Department of State
Passport Services
Your passport is enclosed.
Date of issue  June 30, 2025
Passport book number 900554412
Please sign your passport book in ink right away. Your passport is valid for 10 years.
Keep your passport in a safe place.`],
    expect: { docType: "Passport", issuer: "U.S. Department of State", docDate: "2025-06-30", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "vehicle-title",
    pages: [`STATE OF WASHINGTON
CERTIFICATE OF TITLE  FOR A VEHICLE
Department of Licensing
Title number 9901122   Issue date 06/14/2021
VIN 2HGFE2F59PH*****   Year 2023  Make HOND  Model CIVIC
Registered owner CASEY MORGAN
Legal owner HONDA FINANCIAL SERVICES
Odometer 12 miles  Actual
Any alteration or erasure voids this title.`],
    expect: { docType: "Vehicle title", issuer: "Washington State Department of Licensing", docDate: "2021-06-14", folder: "07 Auto", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "vehicle-title-messy",
    pages: [`CERTIFICATE 0F TITLE
North Carolina Division of Motor Vehicles
Title No 77120034   Date lssued 02/03/2019
Year 2015  Make SUBA  Body WG  VIN JF2SJ*****551
Owner  ROBERT MORGAN
Lienholder  NONE
Odorneter  44,120`],
    expect: { docType: "Vehicle title", issuer: "North Carolina Division of Motor Vehicles", docDate: "2019-02-03", folder: "07 Auto", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "registration-nc",
    pages: [`NORTH CAROLINA DIVISION OF MOTOR VEHICLES
REGISTRATION CARD
Plate  HKT-4410   Expires 11/30/2026
2015 SUBARU FORESTER
Owner ROBERT MORGAN
Issue date 10/28/2025   Fees $98.75
Keep in vehicle.`],
    expect: { docType: "Vehicle registration", issuer: "North Carolina Division of Motor Vehicles", docDate: "2025-10-28", folder: "07 Auto", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "deed",
    pages: [`WARRANTY DEED
Pierce County Auditor   Recording No. 202203150441   Recorded 03/15/2022
THE GRANTOR, Summit Ridge Homes LLC, for and in consideration of ten dollars and other valuable consideration,
conveys and warrants to Casey Morgan, the GRANTEE, the following described real estate:
Lot 14, Alder Park Addition, Tacoma, Pierce County, Washington.
Dated March 10, 2022
STATE OF WASHINGTON, County of Pierce  Acknowledged before me, Notary Public`],
    expect: { docType: "Property deed", issuer: "Pierce County Auditor", docDate: "2022-03-10", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "will",
    pages: [`LAST WILL AND TESTAMENT OF CASEY LYNN MORGAN
I, Casey Lynn Morgan, of Tacoma, Washington, being of sound mind, declare this to be my Last Will and Testament.
ARTICLE I. I revoke all prior wills and codicils.
ARTICLE II. I give my entire estate to Riley Park.
ARTICLE III. I appoint Pat Morgan as Personal Representative.
Signed on May 18, 2024.
Witnesses: ____________  ____________
Prepared by Sound Estate Law Group PLLC`],
    expect: { docType: "Will", issuer: "Sound Estate Law Group PLLC", docDate: "2024-05-18", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "affidavit-notarized",
    pages: [`AFFIDAVIT OF RESIDENCE
I, Casey Morgan, being first duly sworn, state that I have resided at 410 Alder St, Tacoma WA since September 1, 2024.
_____________________ Affiant
Subscribed and sworn to before me on January 9, 2026.
_____________________ Notary Public, State of Washington
My commission expires 03/2028   NOTARY SEAL`],
    expect: { docType: "Notarized document", issuer: "", docDate: "2026-01-09", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "class-action-settlement",
    pages: [`NOTICE OF CLASS ACTION SETTLEMENT
In re Ridgeline Data Breach Litigation, Case No. 3:24-cv-01182
Settlement Administrator: Kroll Settlement Administration
If you received a notice that your information was involved in the 2023 Ridgeline data incident,
you may be eligible for a payment from a class action settlement.
Claim deadline: December 15, 2025
Date of this notice: September 2, 2025
Your Claim ID: RDB-4412-889`],
    expect: { docType: "Settlement notice", issuer: "Kroll Settlement Administration", docDate: "2025-09-02", folder: "01 Identity & Legal", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "contract-gym",
    pages: [`IRON PEAK FITNESS
MEMBERSHIP AGREEMENT
Member: Casey Morgan   Agreement date: 01/04/2026
Membership type: Month-to-month   Dues $39.99 per month
Cancellation: Member may cancel with 30 days written notice.
By signing below, Member agrees to the terms and conditions of this Agreement.
Member signature ________   Club representative ________`],
    expect: { docType: "Contract", issuer: "Iron Peak Fitness", docDate: "2026-01-04", folder: "01 Identity & Legal", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "warranty-registration",
    pages: [`Dyson
Your 2 year warranty
Thank you for registering your Dyson V15 Detect.
Serial number SG8-US-NHA1234
Date of purchase 11/29/2025
Your machine is guaranteed for parts and labor for 2 years from the date of purchase.
Visit dyson.com/support or call 1-866-693-9766`],
    expect: { docType: "Warranty", issuer: "Dyson", docDate: "2025-11-29", folder: "09 Warranties & Manuals", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "manual-messy",
    pages: [`OWNER'S MANUAL
lnstallation and 0perating lnstructions
Whirlpool  Refrigerator  Models WRF555SDF*
Read all safety instructions before using this product.
Table of Contents
Refrigerator Safety ..... 2
Installation Instructions ..... 4
Using Your Refrigerator ..... 9
Troubleshooting ..... 18
Warranty ..... 24`],
    expect: { docType: "Manual", issuer: "Whirlpool", docDate: "", folder: "09 Warranties & Manuals", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "junk-pizza",
    pages: [`Tony's Pizzeria
NOW DELIVERING TO YOUR NEIGHBORHOOD!
2 LARGE 1-TOPPING PIZZAS $19.99
Coupon expires 11/30/26
Order online at tonyspizzatacoma.com
PRSRT STD US POSTAGE PAID
Current Resident`],
    expect: { docType: "Junk mail", issuer: "Tony's Pizzeria", docDate: "", folder: "11 Other", verdict: "shred", sensitive: false, paperless: false },
  },
  {
    id: "junk-car-warranty-messy",
    pages: [`FINAL N0TICE
VEHICLE SERVICE C0NTRACT
Our records indicate your factory warranty may have expired.
Call now to activate extended coverage  1-855-555-0133
This is not a bill. Not affiliated with your vehicle manufacturer.
Auto Protection Services Center`],
    expect: { docType: "Junk mail", issuer: "Auto Protection Services Center", docDate: "", folder: "11 Other", verdict: "shred", sensitive: false, paperless: false },
  },
  {
    id: "offer-chase-card",
    pages: [`Chase Sapphire Preferred
Casey, earn 60,000 bonus points
after you spend $4,000 on purchases in the first 3 months.
Apply by 07/31/2026   Acceptance code: 5541-22-910
June 30, 2026
PRESCREEN & OPT-OUT NOTICE: You can choose to stop receiving "prescreened" offers of credit
from this and other companies by calling toll-free 1-888-567-8688.`],
    expect: { docType: "Credit card offer", issuer: "Chase", docDate: "2026-06-30", folder: "11 Other", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "preapproval-mortgage",
    pages: [`SoFi
You're pre-approved for a personal loan up to $35,000
Rates as low as 8.99% APR with autopay
Check your rate in 1 minute  sofi.com/offer  Code 7HQ-221
Offer expires 09/15/2026
August 12, 2026
PRESCREEN & OPT-OUT NOTICE  optoutprescreen.com`],
    expect: { docType: "Preapproval", issuer: "SoFi", docDate: "2026-08-12", folder: "11 Other", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "letter-bank-terms",
    pages: [`Wells Fargo
P.O. Box 6995, Portland OR 97228
April 2, 2026
Casey Morgan
410 Alder St, Tacoma WA 98405
Important information about your account ending in 8812
Dear Casey Morgan,
We're writing to let you know about upcoming changes to your Deposit Account Agreement, effective June 1, 2026.
No action is needed on your part. If you have questions, please call us.
Sincerely,
Wells Fargo Customer Service`],
    expect: { docType: "Letter", issuer: "Wells Fargo", docDate: "2026-04-02", folder: "03 Money & Banking", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "letter-jury",
    pages: [`Pierce County Superior Court
930 Tacoma Ave S, Tacoma WA 98402
JURY SUMMONS
Date mailed: February 17, 2026
CASEY MORGAN
You are summoned to appear for jury service on March 23, 2026 at 8:00 a.m.
Juror ID 2260419
Complete your questionnaire online at piercecountywa.gov/jury`],
    expect: { docType: "Letter", issuer: "Pierce County Superior Court", docDate: "2026-02-17", folder: "01 Identity & Legal", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "personal-letter",
    pages: [`March 3, 2024
Dear Casey,
It was so good to see you at Thanksgiving. Grandpa and I loved the photos you sent of the new house.
The garden is starting to come back and the tulips are up early this year.
Come visit when the weather is nice. We miss you.
Love always,
Grandma June`],
    expect: { docType: "Personal letter", issuer: "Grandma June", docDate: "2024-03-03", folder: "10 Personal & Sentimental", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "greeting-card",
    pages: [`Happy Birthday!
Wishing you the happiest of birthdays and a wonderful year ahead.
Casey, we're so proud of you.
Love, Mom and Dad
xoxo`],
    expect: { docType: "Greeting card", issuer: "Mom and Dad", docDate: "", folder: "10 Personal & Sentimental", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "unreadable",
    pages: [`~ ,, ' .`],
    expect: { docType: "Unknown", issuer: "", docDate: "", folder: "11 Other", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "unknown-form",
    pages: [`Form 7 rev. 3
Section A ______  Section B ______
Initial here ____
Return to office by the 15th.
Page 1 of 1`],
    expect: { docType: "Unknown", issuer: "", docDate: "", folder: "11 Other", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "hoa-statement",
    pages: [`Alder Park Homeowners Association
Assessment Statement
Statement Date: 10/01/2026
Owner: Casey Morgan   Lot 14
Quarterly assessment  $285.00
Previous balance  $0.00
Amount due  $285.00   Due 10/31/2026
Managed by Summit Community Management`],
    expect: { docType: "HOA statement", issuer: "Alder Park Homeowners Association", docDate: "2026-10-01", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "property-tax-bill",
    pages: [`Pierce County Assessor-Treasurer
2026 REAL PROPERTY TAX STATEMENT
Parcel number 0320114022
Taxpayer: CASEY MORGAN   Site address: 410 Alder St
Assessed value $412,000
First half due April 30, 2026  $2,140.12
Second half due October 31, 2026  $2,140.12
Total 2026 tax  $4,280.24
Statement date 02/14/2026`],
    expect: { docType: "Property tax bill", issuer: "Pierce County Assessor-Treasurer", docDate: "2026-02-14", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: false },
  },
];
