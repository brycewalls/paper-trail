// Held-out documents for the rules engine (#92). SYNTHETIC: every name, number and address here is
// made up (SSNs use the never-issued 900 range, account numbers are invented). These were written
// before the rules existed and are never used to tune them, so their score is the honest one.
// Each entry: { id, pages: [text per page], filename?, expect: { docType, issuer, docDate, folder,
// verdict, sensitive, paperless } }. paperless is paperless.possible.
export default [
  {
    id: "h-w2-brightline-messy",
    pages: [`a Employee's social security number   0MB No. 1545-0008
900-55-1234
b Employer identification number (EIN)      1 Wages, tips, other compensation    2 Federal income tax withheld
84-1234567                                   98,450.12                            14,201.88
c Employer's name, address, and ZIP code     3 Social security wages              4 Social security tax withheld
BRIGHTLINE R0BOTICS INC                      98,450.12                            6,103.91
2200 Foundry Way                             5 Medicare wages and tips            6 Medicare tax withheld
Durham NC 27701                              98,450.12                            1,427.53
d Control number  A1-0042
e Employee's first name and initial   Last name
JORDAN M REYES
88 Pine Hollow Rd  Durham NC 27705
15 State  Employer's state ID number   16 State wages, tips, etc.   17 State income tax
NC        600123456                    98,450.12                    4,310.00
Form W-2 Wage and Tax Staternent    2024    Department of the Treasury-Internal Revenue Service
Copy B-To Be Filed With Employee's FEDERAL Tax Return.
This information is being furnished to the Internal Revenue Service.
Prepared by ADP`],
    expect: { docType: "W-2", issuer: "Brightline Robotics", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-1099div-vanguard",
    pages: [`VANGUARD
P.O. Box 982901  El Paso, TX 79998-2901
2023 Form 1099-DIV  Dividends and Distributions
OMB No. 1545-0110   Copy B For Recipient
PAYER'S name: The Vanguard Group, Inc.
RECIPIENT'S TIN: ***-**-4417
RECIPIENT: JORDAN REYES
Account number: ****8830
1a Total ordinary dividends        $1,284.66
1b Qualified dividends             $1,102.40
2a Total capital gain distr.       $   311.09
7 Foreign tax paid                 $    18.22
This is important tax information and is being furnished to the IRS.`],
    expect: { docType: "1099-DIV", issuer: "Vanguard", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "h-1098-rocket",
    pages: [`Rocket Mortgage
1050 Woodward Ave, Detroit, MI 48226
Form 1098 Mortgage Interest Statement    2024
OMB No. 1545-1380    Copy B For Payer/Borrower
RECIPIENT'S/LENDER'S name: Rocket Mortgage, LLC
PAYER'S/BORROWER'S name: JORDAN REYES
Account number (see instructions): XXXXXX5521
1 Mortgage interest received from payer(s)/borrower(s)   $11,842.17
2 Outstanding mortgage principal                         $298,415.60
3 Mortgage origination date                              06/14/2021
5 Mortgage insurance premiums                            $0.00
10 Property tax paid from escrow                         $3,912.44
The information in boxes 1 through 9 and 11 is important tax information and is being furnished to the IRS.`],
    expect: { docType: "1098", issuer: "Rocket Mortgage", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "h-1095c-harborview",
    pages: [`Form 1095-C   Employer-Provided Health Insurance Offer and Coverage   2023
OMB No. 1545-2251   Department of the Treasury Internal Revenue Service
Part I Employee                         Applicable Large Employer Member (Employer)
1 Name of employee JORDAN REYES         7 Name of employer HARBORVIEW HEALTH SYSTEM
2 Social security number 900-55-1234    8 Employer identification number 91-7654321
3 Street address 88 Pine Hollow Rd      9 Street address 400 Harbor Blvd
4 City Durham  5 NC  6 27705            10 Contact telephone number (919) 555-0144
Part II Employee Offer of Coverage
14 Offer of Coverage  All 12 Months  1E
15 Employee Required Contribution  $112.50
16 Section 4980H Safe Harbor  2C`],
    expect: { docType: "1095-C", issuer: "Harborview Health System", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-eob-aetna-messy",
    pages: [`aetna
Explanati0n of Benefits    THIS IS NOT A BILL
Statement date: August 14, 2025
Member: JORDAN REYES     Member ID: W2xxxxx881
Group: HARBORVIEW HEALTH SYSTEM
Claim ID: E7731-0098    Provider: Triangle Orthopedic Assoc
Service date 07/22/2025   Office visit, established patient
X-ray knee, 3 views
Amount billed      $482.00
Plan discount      $201.15
Plan paid          $224.68
Your share         $56.17  (copay/coinsurance)
You may owe the provider $56.17.  Questions? Call the number on your ID card.`],
    expect: { docType: "Explanation of benefits", issuer: "Aetna", docDate: "2025-08-14", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-cvs-receipt",
    pages: [`CVS pharmacy
Store 4418  1420 Hillsborough St  Raleigh NC
09/02/2026  14:31
RX# 6612093  ATORVASTATIN 20MG TAB  QTY 30
  Insurance paid  $31.40
  Your copay       $5.00
FSA/HSA ELIGIBLE ITEMS  $5.00
SUBTOTAL   $5.00
VISA ****2231   $5.00
ExtraCare card ****9912
Thank you for shopping at CVS`],
    expect: { docType: "Pharmacy receipt", issuer: "CVS Pharmacy", docDate: "2026-09-02", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "h-xfinity-internet",
    pages: [`xfinity
Comcast  P.O. Box 70219 Philadelphia, PA 19176
Account Number 8773 10 221 0045912
Billing Date Sep 20, 2026
Service period Sep 25 - Oct 24, 2026
Previous balance          $90.00
Payment Sep 10 - thank you  -$90.00
Xfinity Internet 400 Mbps   $80.00
xFi Gateway rental          $15.00
Taxes, surcharges & fees     $1.82
Amount due  $96.82   Please pay by Oct 13, 2026
Go paperless and manage your account at xfinity.com/myaccount`],
    expect: { docType: "Internet bill", issuer: "Xfinity", docDate: "2026-09-20", folder: "06 Home", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-georgia-power-old",
    pages: [`Georgia Power
A SOUTHERN COMPANY
Your Electric Bill
Bill Date: February 10, 2023
Account number ending in 6620
Service from Jan 05 to Feb 06 (32 days)
Kilowatt-hours used  1,184 kWh
Basic service charge       $14.00
Energy charge              $132.77
Fuel cost recovery          $41.10
Total amount due  $187.87   Due date Mar 03, 2023
Pay online at georgiapower.com`],
    expect: { docType: "Utility bill", issuer: "Georgia Power", docDate: "2023-02-10", folder: "06 Home", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "h-capone-cc-messy",
    pages: [`Capital0ne
Venture Rewards Card ending in 7713
Payrnent Information
New Balance $1,942.18   Minimum Payment Due $40.00
Payment Due Date Sep 23, 2026
Statement Closing Date  Aug 28, 2026    Billing Cycle Jul 29 - Aug 28, 2026
Account Summary
Previous Balance  $1,201.40   Payments  -$1,201.40
Transactions  +$1,942.18   Interest Charged  $0.00
Rewards: 3,884 miles earned this period
Purchase APR 21.99% (v)`],
    expect: { docType: "Credit card statement", issuer: "Capital One", docDate: "2026-08-28", folder: "03 Money & Banking", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "h-fidelity-brokerage",
    pages: [`Fidelity
INVESTMENT REPORT  April 1, 2025 - June 30, 2025
Brokerage Account  Z18-552019  JORDAN REYES - INDIVIDUAL
Account Summary
Beginning account value     $41,206.33
Additions                    $1,500.00
Change in investment value   $2,118.92
Ending account value        $44,825.25
Holdings  Stocks 62%  Mutual funds 31%  Core account 7%
Dividends this period  $211.40
Fidelity Brokerage Services LLC, Member NYSE, SIPC`],
    expect: { docType: "Brokerage statement", issuer: "Fidelity", docDate: "2025-06-30", folder: "03 Money & Banking", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "h-toyota-payoff",
    pages: [`Toyota Financial Services
P.O. Box 9013, Addison, TX 75001
November 3, 2025
JORDAN REYES
88 Pine Hollow Rd
Durham NC 27705
Re: Account ending 3390   2021 Toyota RAV4  VIN ending 41827
Congratulations! Your vehicle loan has been paid in full.
This letter confirms that the account referenced above has a zero balance as of 10/28/2025.
The lien release and certificate of title will be sent to you or your state's motor vehicle agency within 10 business days.
Please keep this letter for your records.
Sincerely, Customer Service`],
    expect: { docType: "Loan payoff letter", issuer: "Toyota Financial Services", docDate: "2025-11-03", folder: "07 Auto", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-progressive-dec",
    pages: [`PROGRESSIVE
Auto Insurance Coverage Summary  (Declarations Page)
Policy number: 9X44-201-77    Policy period: Mar 1, 2026 - Sep 1, 2026
Named insured: Jordan Reyes
Date issued: February 20, 2026
Vehicles: 2021 TOYOTA RAV4
Coverages            Limits                 Premium
Bodily injury        $100,000/$300,000      $212
Property damage      $100,000               $148
Comprehensive        $500 deductible        $96
Collision            $500 deductible        $241
Total 6 month policy premium  $697.00`],
    expect: { docType: "Insurance declarations page", issuer: "Progressive", docDate: "2026-02-20", folder: "04 Insurance", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "h-lease-maple-court",
    pages: [`RESIDENTIAL LEASE AGREEMENT
This Lease Agreement is made on July 15, 2025 between Maple Court Apartments LLC ("Landlord")
and Jordan Reyes ("Tenant").
1. PREMISES. Landlord leases to Tenant the apartment at 12 Maple Court, Unit 4B, Raleigh NC 27606.
2. TERM. The term begins August 1, 2025 and ends July 31, 2026.
3. RENT. Tenant shall pay monthly rent of $1,450.00 due on the first day of each month.
4. SECURITY DEPOSIT. Tenant has paid a security deposit of $1,450.00.`, `5. UTILITIES. Tenant is responsible for electricity and internet.
6. PETS. No pets without written consent of Landlord.
IN WITNESS WHEREOF the parties have signed this Lease.
Landlord: ____________  Maple Court Apartments LLC   Date 7/15/2025
Tenant: ______________  Jordan Reyes                Date 7/15/2025`],
    expect: { docType: "Lease", issuer: "Maple Court Apartments", docDate: "2025-07-15", folder: "06 Home", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-paystub-lumen",
    pages: [`LUMEN COFFEE ROASTERS LLC
318 W Main St, Durham NC 27701
EARNINGS STATEMENT
Employee: Jordan Reyes     Employee ID 00417   SSN XXX-XX-1234
Pay period: 09/16/2026 - 09/30/2026     Pay date: 09/30/2026
Earnings      Rate     Hours    Current     YTD
Regular       24.00    80.00    1,920.00    34,560.00
Deductions
Federal Income Tax              188.40      3,391.20
Social Security                 119.04      2,142.72
Medicare                         27.84        501.12
NC State Income Tax              81.60      1,468.80
Net Pay  1,503.12
Direct deposit to checking ****6604
Paychex`],
    expect: { docType: "Pay stub", issuer: "Lumen Coffee Roasters", docDate: "2026-09-30", folder: "08 Work & Income", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "h-bestbuy-tv",
    pages: [`BEST BUY
Store 1104  Crabtree Valley  Raleigh NC
01/12/2026 6:42 PM
SAMSUNG 65" QLED 4K SMART TV   QN65Q80D     $1,099.99
GEEK SQUAD PROTECTION 4 YR                   $  249.99
SUBTOTAL    $1,349.98
TAX 7.25%   $   97.87
TOTAL       $1,447.85
MASTERCARD ****5512  APPROVED
Return and exchange period ends 02/11/2026
Keep this receipt for warranty service.`],
    expect: { docType: "Receipt", issuer: "Best Buy", docDate: "2026-01-12", folder: "09 Warranties & Manuals", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-wa-registration",
    pages: [`WASHINGTON STATE DEPARTMENT OF LICENSING
VEHICLE REGISTRATION CERTIFICATE
Registered owner: JORDAN REYES
Plate: CKL4419    Expires: 05/10/2027
Year 2021  Make TOYT  Model RAV4  VIN 2T3P1RFV*****1827
Issued: 05/10/2026     Fees paid $184.75
Keep this registration in your vehicle.`],
    expect: { docType: "Vehicle registration", issuer: "Washington State Department of Licensing", docDate: "2026-05-10", folder: "07 Auto", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-marriage-cert",
    pages: [`STATE OF WASHINGTON
KING COUNTY
CERTIFICATE OF MARRIAGE
This certifies that Jordan Marie Reyes and Alex Daniel Chen
were united in marriage on the 22nd day of June, 2019 at Seattle, Washington.
License No. 2019-118842
Officiant: Rev. Lena Ortiz
Witnesses: Sam Patel, Maria Gomez
Filed with the King County Recorder June 28, 2019
CERTIFIED COPY  (raised seal)`],
    expect: { docType: "Marriage certificate", issuer: "King County", docDate: "2019-06-22", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "h-passport",
    pages: [`PASSPORT   PASSEPORT   PASAPORTE
UNITED STATES OF AMERICA
Type P   Code USA   Passport No. 900112233
Surname REYES
Given names JORDAN MARIE
Nationality UNITED STATES OF AMERICA
Date of birth 03 Apr 1994
Place of birth NORTH CAROLINA, U.S.A.
Date of issue 05 Apr 2021
Date of expiration 04 Apr 2031
Authority United States Department of State
P<USAREYES<<JORDAN<MARIE<<<<<<<<<<<<<<<<<<<`],
    expect: { docType: "Passport", issuer: "U.S. Department of State", docDate: "2021-04-05", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: true, paperless: false },
  },
  {
    id: "h-discover-preapproval-messy",
    pages: [`DISCOVER
Jordan, you're Pre-Appr0ved*
for a Discover it Cash Back card
0% intro APR for 15 months  Earn 5% cash back on everyday purchases
Respond by October 30, 2026   Your reservation code: K7Q2-M9
Sep 11, 2026
*PRESCREEN & OPT-OUT NOTICE: This "prescreened" offer of credit is based on information
in your credit report. If you do not want to receive prescreened offers, call
1-888-5-OPT-OUT or visit www.optoutprescreen.com.`],
    expect: { docType: "Preapproval", issuer: "Discover", docDate: "2026-09-11", folder: "11 Other", verdict: "shred", sensitive: false, paperless: true },
  },
  {
    id: "h-junk-windows",
    pages: [`SUNRISE WINDOWS & SIDING
LIMITED TIME ONLY!
SAVE 40% on replacement windows
PLUS no payments, no interest for 12 months
Call today for your FREE in-home estimate  (919) 555-0187
Offer valid with coupon. Not valid with other offers. Restrictions apply.
Current Resident or`],
    expect: { docType: "Junk mail", issuer: "Sunrise Windows & Siding", docDate: "", folder: "11 Other", verdict: "shred", sensitive: false, paperless: false },
  },
  {
    id: "h-irs-cp14",
    pages: [`Department of the Treasury
Internal Revenue Service
Kansas City, MO 64999-0025
Notice CP14
Tax year 2024
Notice date May 19, 2025
Social Security number nnn-nn-1234
To contact us 800-829-0922
JORDAN REYES
Amount due: $412.55
Payment due: June 9, 2025
Our records show you have unpaid taxes for the tax year ending December 31, 2024.
If you already paid your balance in full within the past 21 days, please disregard this notice.`],
    expect: { docType: "Tax notice", issuer: "IRS", docDate: "2025-05-19", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-poa-notarized",
    pages: [`DURABLE POWER OF ATTORNEY
I, Jordan Marie Reyes, of Durham County, North Carolina, appoint Alex Daniel Chen as my attorney-in-fact
to act for me in any lawful way with respect to the following matters: real property, banking, tax matters.
This power of attorney shall not be affected by my subsequent incapacity.
Signed this 3rd day of October, 2022.
______________________ Jordan Marie Reyes`, `STATE OF NORTH CAROLINA, COUNTY OF DURHAM
Sworn to and subscribed before me this 3rd day of October, 2022.
______________________ Notary Public
My commission expires: 08/01/2025     (SEAL)
Prepared by Whitaker & Lowe PLLC, Attorneys at Law`],
    expect: { docType: "Notarized document", issuer: "Whitaker & Lowe PLLC", docDate: "2022-10-03", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: false, paperless: false },
  },
  {
    id: "h-bosch-warranty",
    pages: [`BOSCH
Limited Warranty
Bosch Dishwasher  Model SHX78CM5N
This limited warranty is valid for one (1) year from the date of purchase and covers parts and labor.
Registration date: 04/18/2024
Serial number FD 0412 00881
To request service, call 1-800-944-2904 or visit bosch-home.com/us/service.
Keep proof of purchase with this warranty.
BSH Home Appliances Corporation`],
    expect: { docType: "Warranty", issuer: "Bosch", docDate: "2024-04-18", folder: "09 Warranties & Manuals", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-1040-2023",
    pages: [`Form 1040  Department of the Treasury-Internal Revenue Service
U.S. Individual Income Tax Return   2023   OMB No. 1545-0074
Filing Status  [X] Married filing jointly
Your first name and middle initial  JORDAN M   Last name REYES   Your social security number 900-55-1234
If joint return, spouse's first name  ALEX D  Last name CHEN   Spouse's social security number 900-66-4321
Home address 88 Pine Hollow Rd, Durham NC 27705
1a Total amount from Form(s) W-2, box 1   161,204
11 Adjusted gross income                    158,990
15 Taxable income                           129,790`, `24 Total tax                     19,233
33 Total payments                26,880
35a Amount of line 34 you want refunded to you   7,647
Sign Here  Under penalties of perjury, I declare that I have examined this return
Your signature   Date 04/02/2024   Occupation  Engineer
Paid Preparer Use Only   Firm's name  Triangle Tax Partners`],
    expect: { docType: "Federal tax return", issuer: "IRS", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "h-unknown-scrap",
    pages: [`see reverse
item 4  .... 2
thank y u
-- 3 --`],
    expect: { docType: "Unknown", issuer: "", docDate: "", folder: "11 Other", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "h-settlement-deposit",
    pages: [`SETTLEMENT AGREEMENT AND MUTUAL RELEASE
This Settlement Agreement is entered into as of February 14, 2024 by and between Northgate Property Management, Inc.
("Northgate") and Jordan Reyes ("Tenant").
WHEREAS, a dispute arose regarding the return of Tenant's security deposit for 77 Elm St, Apt 2;
NOW, THEREFORE, the parties agree as follows:
1. Northgate shall pay Tenant the sum of $1,100.00 within 14 days.
2. Each party releases the other from all claims arising from the tenancy.
3. This Agreement is the entire agreement of the parties.
Northgate Property Management, Inc.  By: ________   Date: 2/14/2024
Jordan Reyes ________   Date: 2/14/2024`],
    expect: { docType: "Settlement agreement", issuer: "Northgate Property Management", docDate: "2024-02-14", folder: "01 Identity & Legal", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  // Held out (2026-10-16), written before the W-2, EOB and notary fixes and never tuned against.
  {
    id: "h-w2-employer-name-colon",
    pages: [`Department of the Treasury - Internal Revenue Service
Form W-2  Wage and Tax Statement  2024
Employer name: Pacific Crest Builders LLC
Employer ID 91-2204417
Employee name: Jordan Reyes
Wages, tips, other compensation  72,015.40
Federal income tax withheld  9,880.12
Copy 2 To Be Filed With Employee's State, City, or Local Income Tax Return`],
    expect: { docType: "W-2", issuer: "Pacific Crest Builders", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-w2-rippling-printed",
    pages: [`Rippling
Your 2025 W-2 is ready
Form W-2 Wage and Tax Statement 2025
c Employer's name, address and ZIP code
Quillfeather Media Inc
88 Commerce St, Raleigh NC 27601
1 Wages, tips, other compensation 66,300.00
2 Federal income tax withheld 7,402.10
Internal Revenue Service`],
    expect: { docType: "W-2", issuer: "Quillfeather Media", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-w2-adp-employee",
    pages: [`Form W-2 Wage and Tax Statement 2024    OMB No. 1545-0008
c Employer's name, address, and ZIP code
ADP, Inc.
1 ADP Blvd, Roseland NJ 07068
e Employee's name   Alex Chen
1 Wages, tips, other compensation 81,250.00
Copy C For EMPLOYEE'S RECORDS
Department of the Treasury Internal Revenue Service`],
    expect: { docType: "W-2", issuer: "ADP", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-eob-dates-of-service",
    pages: [`Blue Ridge Health Alliance
EXPLANATION OF BENEFITS - THIS IS NOT A BILL
Member: Jordan Reyes   Member ID 900-55-1182
Claim 77120-3   Provider: Oak City Physical Therapy
Dates of service: 05/02/2025
Billed $165.00   Allowed $98.00   Plan paid $78.40
Your share $19.60`],
    expect: { docType: "Explanation of benefits", issuer: "Blue Ridge Health Alliance", docDate: "2025-05-02", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "h-affidavit-identity",
    pages: [`AFFIDAVIT OF IDENTITY
State of North Carolina, County of Wake
I, Jordan Reyes, swear that I am the person named in the attached documents.
Signature of Affiant
Sworn to and subscribed before me this 12th day of March, 2025.
Signature of Notary Public
NOTARY PUBLIC, WAKE COUNTY, NORTH CAROLINA
My commission expires 11/30/2027`],
    expect: { docType: "Notarized document", issuer: "", docDate: "2025-03-12", folder: "01 Identity & Legal", verdict: "keep_original", sensitive: false, paperless: false },
  },
];
