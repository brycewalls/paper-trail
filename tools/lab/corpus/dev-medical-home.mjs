// Dev corpus, medical, home and money (#92). SYNTHETIC: every name, number and address is made up.
export default [
  {
    id: "eob-bcbs",
    pages: [`Premera Blue Cross
EXPLANATION OF BENEFITS   This is not a bill
Date: March 4, 2025
Subscriber: CASEY MORGAN   Member ID: XQP900112233
Patient: CASEY MORGAN   Claim number: 2025030411872
Provider: Tacoma Family Medicine
Date of service 02/11/2025   Preventive care visit
Billed $310.00   Allowed $214.50   Plan paid $214.50   Patient responsibility $0.00
Deductible met to date $450.00 of $1,500.00`],
    expect: { docType: "Explanation of benefits", issuer: "Premera Blue Cross", docDate: "2025-03-04", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "eob-uhc-messy",
    pages: [`UnitedHealthcare
Explanation 0f Beneflts (EOB)
Staternent Date: 11/02/2025
Mernber: CASEY MORGAN  ID 900112233-01
Clairn # 8812-55   Provider: Puget Sound Dental Group
Dental cleaning, periodic oral evaluation
Arnount Billed $245.00  Plan Discount $61.00  Plan Paid $184.00
What you owe $0.00
THIS IS NOT A BILL`],
    expect: { docType: "Explanation of benefits", issuer: "UnitedHealthcare", docDate: "2025-11-02", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "medical-bill-hospital",
    pages: [`MultiCare Tacoma General Hospital
Patient Statement
Statement Date: 04/22/2025
Guarantor: Casey Morgan   Account #: 7714409
Patient: Casey Morgan
Date of Service  Description                     Charges    Insurance   Adjustments
03/30/2025       Emergency department visit      1,880.00   -1,102.50   -412.00
03/30/2025       CT scan, head without contrast    940.00     -611.00   -120.00
Amount Due: $574.50   Please pay by 05/15/2025
Pay online at multicare.org/pay or call Patient Financial Services`],
    expect: { docType: "Medical bill", issuer: "MultiCare", docDate: "2025-04-22", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "medical-bill-clinic-old",
    pages: [`Raleigh Dermatology Associates
STATEMENT
Statement date  June 9, 2022
Patient  CASEY MORGAN   Account 22019
06/01/2022  Office visit, new patient  $220.00
06/01/2022  Biopsy, skin lesion       $180.00
Insurance payments  -$310.00
Balance due  $90.00
Please detach and return this portion with your payment.`],
    expect: { docType: "Medical bill", issuer: "Raleigh Dermatology Associates", docDate: "2022-06-09", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "lab-results",
    pages: [`Quest Diagnostics
Patient Report
Patient: MORGAN, CASEY   DOB: 03/14/1991
Collected: 08/04/2025   Reported: 08/06/2025
Ordering physician: Dr. R. Shah, Tacoma Family Medicine
Test                 Result    Flag   Reference range
Cholesterol, total   212       H      <200 mg/dL
HDL cholesterol      58               >39 mg/dL
LDL cholesterol      131       H      <100 mg/dL
Glucose              92               65-99 mg/dL
Hemoglobin A1c       5.4              <5.7 %`],
    expect: { docType: "Medical record", issuer: "Quest Diagnostics", docDate: "2025-08-06", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "walgreens-rx",
    pages: [`Walgreens
#05521 2201 6th Ave Tacoma WA
RX 0418822  AMOXICILLIN 500MG CAP  QTY 21
Dr. SHAH
Insurance Plan Paid  12.88
Copay                  4.00
TOTAL                  4.00
DEBIT ****4471
10/02/2025 09:14
Pharmacist consultation offered`],
    expect: { docType: "Pharmacy receipt", issuer: "Walgreens", docDate: "2025-10-02", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "insurance-id-card",
    pages: [`Welcome to Premera Blue Cross
Your member ID cards are enclosed.
January 2, 2026
Subscriber CASEY MORGAN   Member ID XQP900112233   Group 1009921
Plan: Premera Preferred Gold   PCP copay $25   Specialist $50   ER $250
Rx BIN 610014  PCN PRE  Rx Group PRMRX
Keep your card with you. Show it every time you get care.`],
    expect: { docType: "Insurance ID card", issuer: "Premera Blue Cross", docDate: "2026-01-02", folder: "04 Insurance", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "duke-energy-old",
    pages: [`DUKE ENERGY
Your Energy Bill
Bill date Mar 12, 2024
Account number 9100 4411 (ending 4411)
Service address 410 Alder St
Billing period Feb 9 - Mar 10, 2024  30 days
Electricity used 812 kWh
Total Amount Due $84.12  Due by Apr 2, 2024
Sign up for Paperless Billing at duke-energy.com`],
    expect: { docType: "Utility bill", issuer: "Duke Energy", docDate: "2024-03-12", folder: "06 Home", verdict: "shred", sensitive: true, paperless: true },
  },
  {
    id: "pse-recent-messy",
    pages: [`PUGET SOUND ENERGY
Natura1 Gas & Electric Staternent
Statement Date: 08/30/2026
Acc0unt Number: ending 2290
Electric Service  Aug 1 - Aug 28  641 kWh   $78.44
Natural Gas Service  Aug 1 - Aug 28  9 therms  $22.17
Arnount Due  $100.61
Due Date 09/20/2026
pse.com`],
    expect: { docType: "Utility bill", issuer: "Puget Sound Energy", docDate: "2026-08-30", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "water-city",
    pages: [`City of Tacoma
Tacoma Public Utilities  Water Division
UTILITY BILL
Bill Date 07/15/2026
Account No. ****0091
Water usage  14 CCF   $61.20
Sewer                 $48.90
Stormwater            $22.04
Total Due  $132.14   Due 08/05/2026`],
    expect: { docType: "Utility bill", issuer: "Tacoma Public Utilities", docDate: "2026-07-15", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "verizon-wireless",
    pages: [`verizon
Your bill for Casey Morgan
Bill date  September 3, 2026
Account number 512440911-00001
Quick bill summary  Aug 4 - Sep 3
Previous balance  $112.40   Payment received  -$112.40
Plans  Unlimited Welcome  2 lines   $110.00
Devices  iPhone 16 payment 18 of 36  $24.99
Surcharges and taxes  $9.41
Total amount due  $144.40   by Sep 26
Wireless phone service`],
    expect: { docType: "Phone bill", issuer: "Verizon", docDate: "2026-09-03", folder: "06 Home", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "tmobile-old",
    pages: [`T-Mobile
Statement date  12/18/2023
Account  9822xxxx
Monthly charges  Magenta  3 lines  $140.00
One-time charges  $0.00
Total due  $140.00  by 01/10/2024
Customer since 2017
T-Mobile wireless, Bellevue WA`],
    expect: { docType: "Phone bill", issuer: "T-Mobile", docDate: "2023-12-18", folder: "06 Home", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "spectrum-internet",
    pages: [`Spectrum
Statement  Spectrum Internet
Statement Date  Jun 21, 2026
Account Number  8448 22 011 ****
Service period  06/24/26 - 07/23/26
Spectrum Internet Premier  $69.99
WiFi Service  $7.00
Total Due by 07/12/26  $76.99
Charter Communications`],
    expect: { docType: "Internet bill", issuer: "Spectrum", docDate: "2026-06-21", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "chase-checking",
    pages: [`CHASE
JPMorgan Chase Bank, N.A.  P O Box 182051  Columbus, OH 43218-2051
July 01, 2026 through July 31, 2026
Account Number: 000000917744021
CHECKING SUMMARY  Chase Total Checking
Beginning Balance   $3,412.80
Deposits and Additions   4,120.44
Electronic Withdrawals  -3,288.10
Ending Balance   $4,245.14
Routing number 999999992`],
    expect: { docType: "Bank statement", issuer: "Chase", docDate: "2026-07-31", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "wells-savings-old",
    pages: [`Wells Fargo Way2Save Savings
Statement period ending February 28, 2022
Account number: XXXXXX8812
Beginning balance on 2/1  $5,100.00
Interest earned  $0.43
Ending balance on 2/28  $5,100.43
Wells Fargo Bank, N.A. Member FDIC`],
    expect: { docType: "Bank statement", issuer: "Wells Fargo", docDate: "2022-02-28", folder: "03 Money & Banking", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "credit-union-messy",
    pages: [`HARB0R FEDERAL CREDIT UNI0N
Mernber Staternent
Staternent Period: 05/01/2026 - 05/31/2026
Mernber # ****2207
Share Savings   Beginning $820.11   Ending $840.11
Checking        Beginning $1,442.90 Ending $1,190.37
Dividends earned $0.12
Federally insured by NCUA`],
    expect: { docType: "Bank statement", issuer: "Harbor Federal Credit Union", docDate: "2026-05-31", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "amex-statement",
    pages: [`American Express
Blue Cash Preferred Card
Prepared for CASEY MORGAN   Account Ending 9-41005
Closing Date 09/18/26   Next Closing Date 10/18/26
New Balance $2,904.12
Minimum Payment Due $35.00
Payment Due Date 10/13/26
Previous Balance $2,110.08  Payments/Credits -$2,110.08  New Charges +$2,904.12
Cash Back earned this period  $61.20`],
    expect: { docType: "Credit card statement", issuer: "American Express", docDate: "2026-09-18", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "citi-old",
    pages: [`Citi Double Cash Card
Statement Closing Date: 01/14/2023
Account number ending in: 3318
New balance: $412.66   Minimum payment due: $25.00   Payment due date: 02/09/2023
Purchases  $412.66   Interest charged  $0.00
Citibank, N.A.`],
    expect: { docType: "Credit card statement", issuer: "Citi", docDate: "2023-01-14", folder: "03 Money & Banking", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "vanguard-quarterly",
    pages: [`Vanguard
Quarterly statement   July 1 - September 30, 2026
CASEY MORGAN   Account ending 8830   Traditional IRA Brokerage Account
Account value as of 09/30/2026  $38,114.20
Change this quarter  +$1,982.44
Holdings  VTSAX 412.08 shares   VTIAX 288.01 shares
Vanguard Brokerage Services`],
    expect: { docType: "Brokerage statement", issuer: "Vanguard", docDate: "2026-09-30", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "401k-statement-messy",
    pages: [`Empower
Retirernent Plan Staternent
Northwind Logistics 401(k) Plan
Staternent Period 04/01/2026 - 06/30/2026
Beginning Balance  $22,410.08
Contributions  Employee $1,416.96  Ernployer $708.48
Gain/Loss  $611.20
Ending Balance  $25,146.72
Vested Balance  $25,146.72`],
    expect: { docType: "Retirement account statement", issuer: "Empower", docDate: "2026-06-30", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "mortgage-statement",
    pages: [`Mr. Cooper
Mortgage Statement
Statement Date: 08/16/2026
Loan Number: ******4410
Payment Due Date: 09/01/2026   Amount Due: $1,912.40
Explanation of Amount Due  Principal $612.88  Interest $801.12  Escrow (taxes and insurance) $498.40
Outstanding Principal $239,882.10
Property Address 410 Alder St Tacoma WA 98405`],
    expect: { docType: "Mortgage statement", issuer: "Mr. Cooper", docDate: "2026-08-16", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "student-loan-statement",
    pages: [`MOHELA
Billing Statement
Statement Date  May 5, 2026
Account Number  ****7720
Current Amount Due  $288.14   Due Date  May 28, 2026
Loan  Direct Unsub  Principal Balance  $18,440.20  Interest Rate 4.53%
Total Outstanding Balance  $18,511.66
Federal student aid servicer for the U.S. Department of Education`],
    expect: { docType: "Loan statement", issuer: "MOHELA", docDate: "2026-05-05", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "auto-loan-statement",
    pages: [`Honda Financial Services
Monthly Statement
Statement date 02/09/2026
Account ending 5512   2023 Honda Civic
Payment amount $412.77   Payment due 03/01/2026
Principal balance $14,220.05
Make payments at hondafinancialservices.com`],
    expect: { docType: "Loan statement", issuer: "Honda Financial Services", docDate: "2026-02-09", folder: "07 Auto", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "payoff-student-loan",
    pages: [`Nelnet
December 2, 2024
CASEY MORGAN
410 Alder St, Tacoma WA 98405
Subject: Paid in Full Confirmation
Account number ending 1182
Congratulations! Your student loan account has been paid in full as of November 25, 2024.
Total amount paid $31,402.18. No further payments are due.
Please retain this letter for your records.`],
    expect: { docType: "Loan payoff letter", issuer: "Nelnet", docDate: "2024-12-02", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "state-farm-renters-policy",
    pages: [`State Farm
Renters Policy   Policy Booklet and Declarations
Policy number 47-BX-2219-1
Named insured CASEY MORGAN
Location of residence premises 410 Alder St, Tacoma WA
Policy period  Effective 04/01/2026 to 04/01/2027
Coverage C Personal Property  $40,000
Coverage L Personal Liability  $300,000
Deductible  $500
Annual premium  $186.00
Date issued 03/12/2026`],
    expect: { docType: "Insurance declarations page", issuer: "State Farm", docDate: "2026-03-12", folder: "04 Insurance", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "geico-id-card",
    pages: [`GEICO
Washington Automobile Insurance Identification Card
Policy number 6011-22-881-04
Effective 07/14/2026   Expiration 01/14/2027
Insured  CASEY MORGAN
2023 HONDA CIVIC   VIN 2HGFE2F5*****881
Keep this card in your vehicle.`],
    expect: { docType: "Insurance ID card", issuer: "GEICO", docDate: "2026-07-14", folder: "04 Insurance", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "life-policy",
    pages: [`Northwestern Mutual
Term Life Insurance Policy
Policy Number 22-881-410
Insured: Casey Morgan   Owner: Casey Morgan
Face Amount $500,000   Term 20 years
Policy Date: September 1, 2024
Beneficiary: Pat Morgan
This policy is a legal contract between the Owner and the Company. Please read your policy carefully.`],
    expect: { docType: "Insurance policy", issuer: "Northwestern Mutual", docDate: "2024-09-01", folder: "04 Insurance", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "lease-messy",
    pages: [`RESIDENTlAL LEASE
Landlord: CEDAR RIDGE PR0PERTIES LLC
Tenant(s): Casey Morgan
Prernises: 410 Alder St Apt 3, Tacoma WA 98405
Term: 12 rnonths beginning 09/01/2024 and ending 08/31/2025
Monthly Rent $1,625.00 due on the 1st
Security Deposit $1,625.00
Signed this 20th day of August, 2024`],
    expect: { docType: "Lease", issuer: "Cedar Ridge Properties", docDate: "2024-08-20", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "rent-receipt",
    pages: [`Cedar Ridge Properties LLC
RENT RECEIPT
Date: 10/01/2024
Received from: Casey Morgan
Amount: $1,625.00   For: October 2024 rent, 410 Alder St Apt 3
Payment method: check #1182
Received by: M. Ortiz, Property Manager`],
    expect: { docType: "Receipt", issuer: "Cedar Ridge Properties", docDate: "2024-10-01", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "home-depot-receipt",
    pages: [`The Home Depot
How doers get more done.
4720 Tacoma Mall Blvd  Tacoma WA
SALE  05/22/2026 11:08 AM
LG FRONT LOAD WASHER WM4000HWA   $898.00
DELIVERY                          $0.00
SUBTOTAL   898.00
SALES TAX   92.05
TOTAL     $990.05
VISA XXXXXXXXXXXX2231
RETURN POLICY DEFINITIONS  Keep receipt for manufacturer warranty.`],
    expect: { docType: "Receipt", issuer: "The Home Depot", docDate: "2026-05-22", folder: "09 Warranties & Manuals", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "grocery-receipt",
    pages: [`SAFEWAY
Store 1512  Tacoma
08/09/2026 5:41 PM
ORGANIC BANANAS  1.92
MILK 2% GAL      4.29
BREAD WHL WHT    3.49
CHICKEN BREAST  11.84
BALANCE DUE     21.54
VISA            21.54
Thank you for shopping Safeway`],
    expect: { docType: "Receipt", issuer: "Safeway", docDate: "2026-08-09", folder: "03 Money & Banking", verdict: "shred", sensitive: false, paperless: false },
  },
  {
    id: "contractor-invoice",
    pages: [`Evergreen Roofing & Gutters
INVOICE #2207
Invoice Date: April 3, 2026
Bill To: Casey Morgan, 410 Alder St, Tacoma WA
Description                                   Amount
Replace 18 ft of gutter and two downspouts    $1,240.00
Roof inspection                               $  150.00
Total  $1,390.00
Payment due upon receipt.  Workmanship warranted for 2 years.`],
    expect: { docType: "Invoice", issuer: "Evergreen Roofing & Gutters", docDate: "2026-04-03", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "auto-repair-invoice",
    pages: [`Jiffy Lube
Service Invoice  Invoice No. 55120
Date 01/19/2026
Vehicle  2023 HONDA CIVIC  Mileage 31,882
Signature Service Oil Change  $89.99
Cabin air filter              $39.99
Total                        $129.98
Paid  VISA ****2231`],
    expect: { docType: "Invoice", issuer: "Jiffy Lube", docDate: "2026-01-19", folder: "07 Auto", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  // From the 5-document stack pass: an EOB whose only date is the date of service.
  {
    id: "eob-service-date-only",
    pages: [`Summit Health Plan
Explanation of Benefits
This is not a bill
Date of service January 9, 2026
Provider Lakeside Family Clinic
Amount billed $240.00
Plan paid $180.00
You may owe $60.00`],
    expect: { docType: "Explanation of benefits", issuer: "Summit Health Plan", docDate: "2026-01-09", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
];
