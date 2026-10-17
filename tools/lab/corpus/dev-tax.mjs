// Dev corpus, taxes and income (#92). SYNTHETIC: every name, number and address is made up; SSNs
// use the never-issued 900 range. The rules are tuned against the dev files only.
export default [
  {
    id: "w2-northwind-clean",
    pages: [`a Employee's social security number 900-12-3456     OMB No. 1545-0008
b Employer identification number (EIN) 47-1122334
c Employer's name, address, and ZIP code
Northwind Logistics Inc
500 Harbor Point Dr
Tacoma WA 98402
e Employee's first name and initial  Last name   Casey L Morgan
1 Wages, tips, other compensation 61,400.00
2 Federal income tax withheld 7,120.55
3 Social security wages 61,400.00   4 Social security tax withheld 3,806.80
5 Medicare wages and tips 61,400.00   6 Medicare tax withheld 890.30
Form W-2 Wage and Tax Statement 2023
Department of the Treasury - Internal Revenue Service
Copy B-To Be Filed With Employee's FEDERAL Tax Return`],
    expect: { docType: "W-2", issuer: "Northwind Logistics", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "w2-gusto-messy",
    pages: [`Form W -2  Wage and Tax Statemcnt   2025
Copy C-For EMPLOYEE'S RECORDS
OMB No. 1545-0OO8
c Ernployer's name, address and ZIP code
TIDEWATER DESIGN STUDIO LLC
71 Canal St
Norfolk VA 23510
b EIN 52-9988776
a Employee's SSN 900-44-7788
1 Wages, tips, other cornpensation    2 Federal incorne tax withheld
  52,118.40                             5,601.12
16 State wages 52,118.40   17 State incorne tax 2,410.77
Payroll by Gusto`],
    expect: { docType: "W-2", issuer: "Tidewater Design Studio", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  {
    id: "1099int-chase",
    pages: [`JPMorgan Chase Bank, N.A.
P.O. Box 659754 San Antonio TX 78265
2024 Form 1099-INT  Interest Income
OMB No. 1545-0112  Copy B For Recipient
PAYER'S name  JPMORGAN CHASE BANK NA
RECIPIENT'S TIN  XXX-XX-3456
RECIPIENT'S name  CASEY MORGAN
Account number  XXXXXXXX9021
1 Interest income  $  842.19
4 Federal income tax withheld  $0.00
This is important tax information and is being furnished to the IRS.`],
    expect: { docType: "1099-INT", issuer: "Chase", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1099int-ally-messy",
    pages: [`ALLY BANK
2025 F0rm 1099-INT
Interest lncome
0MB No. 1545-O112
PAYER'S narne Ally Bank, P.O. Box 951, Horsham PA 19044
RECIPIENT'S TIN ***-**-3456
1 lnterest income   $2,311.48
Copy B For Recipient`],
    expect: { docType: "1099-INT", issuer: "Ally Bank", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1099div-schwab",
    pages: [`Charles Schwab & Co., Inc.
Form 1099-DIV 2024   Dividends and Distributions   OMB No. 1545-0110
PAYER: Charles Schwab & Co., Inc.  211 Main St, San Francisco CA 94105
RECIPIENT: CASEY MORGAN   TIN ***-**-3456
1a Total ordinary dividends 412.18
1b Qualified dividends 380.02
Copy B For Recipient`],
    expect: { docType: "1099-DIV", issuer: "Charles Schwab", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1099b-robinhood",
    pages: [`Robinhood Securities LLC
85 Willow Rd, Menlo Park, CA 94025
Form 1099-B  Proceeds From Broker and Barter Exchange Transactions   2023
OMB No. 1545-0715
Recipient: CASEY MORGAN   Account 5RH***221
Short-term transactions for which basis is reported to the IRS
1a Description  1d Proceeds  1e Cost basis  Gain/loss
AAPL 10 sh      1,912.40     1,744.10       168.30
VTI  4 sh         998.12     1,020.55       -22.43
Totals            2,910.52   2,764.65       145.87`],
    expect: { docType: "1099-B", issuer: "Robinhood", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1099misc-rent",
    pages: [`PAYER'S name, street address, city
Evergreen Market Research Group
19 Commerce Ave, Boise ID 83702
Form 1099-MISC  Miscellaneous Information  2024   OMB No. 1545-0115
RECIPIENT'S TIN 900-12-3456
RECIPIENT'S name Casey Morgan
3 Other income  $650.00   (survey panel participation)
Copy B For Recipient`],
    expect: { docType: "1099-MISC", issuer: "Evergreen Market Research Group", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "1099nec-freelance",
    pages: [`Form 1099-NEC  Nonemployee Compensation   2025
OMB No. 1545-0116
PAYER'S name, street address, city or town
Bluefin Media Partners LLC
2100 Ocean Ave, Santa Monica CA 90405
PAYER'S TIN 33-4455667     RECIPIENT'S TIN ***-**-3456
RECIPIENT'S name  CASEY MORGAN
1 Nonemployee compensation  $8,400.00
4 Federal income tax withheld  $0.00
Copy B For Recipient  This is important tax information and is being furnished to the IRS.`],
    expect: { docType: "1099-NEC", issuer: "Bluefin Media Partners", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "1099r-fidelity",
    pages: [`Fidelity Investments
Form 1099-R 2024  Distributions From Pensions, Annuities, Retirement or Profit-Sharing Plans, IRAs, Insurance Contracts, etc.
OMB No. 1545-0119
PAYER'S name: Fidelity Management Trust Company
RECIPIENT'S TIN: ***-**-3456   Account number: 641-22****
1 Gross distribution $12,000.00
2a Taxable amount $0.00
7 Distribution code G   IRA/SEP/SIMPLE [ ]
Direct rollover to an IRA.`],
    expect: { docType: "1099-R", issuer: "Fidelity", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "consolidated-1099-etrade",
    pages: [`E*TRADE from Morgan Stanley
2024 CONSOLIDATED FORM 1099
Form 1099-DIV  Form 1099-INT  Form 1099-B
Account 4417-****  CASEY MORGAN
Summary of Form 1099-DIV  Total ordinary dividends 1,022.18
Summary of Form 1099-INT  Interest income 88.40
Summary of Form 1099-B  Proceeds 14,550.20  Cost basis 13,010.77
This is important tax information and is being furnished to the Internal Revenue Service.`],
    expect: { docType: "Consolidated 1099", issuer: "E*TRADE", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "ssa1099",
    pages: [`FORM SSA-1099 - SOCIAL SECURITY BENEFIT STATEMENT
2024
PART OF YOUR SOCIAL SECURITY BENEFITS SHOWN IN BOX 5 MAY BE TAXABLE INCOME.
Box 1. Name  PAT MORGAN    Box 2. Beneficiary's Social Security Number  900-31-7788
Box 3. Benefits Paid in 2024  $21,480.00
Box 5. Net Benefits for 2024  $21,480.00
DO NOT RETURN THIS FORM TO SSA OR IRS
Social Security Administration`],
    expect: { docType: "SSA-1099", issuer: "Social Security Administration", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "1098-mrcooper",
    pages: [`Mr. Cooper
8950 Cypress Waters Blvd, Coppell TX 75019
2025 Form 1098 Mortgage Interest Statement   OMB No. 1545-1380
RECIPIENT'S/LENDER'S name  Nationstar Mortgage LLC d/b/a Mr. Cooper
PAYER'S/BORROWER'S name  CASEY MORGAN
Loan number  ******4410
1 Mortgage interest received  $9,104.22
2 Outstanding mortgage principal  $244,190.00
10 Real estate taxes paid  $2,880.10`],
    expect: { docType: "1098", issuer: "Mr. Cooper", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1098t-university",
    pages: [`Form 1098-T  Tuition Statement   2024
OMB No. 1545-1574
FILER'S name, street address: University of Washington, Student Fiscal Services
Box 355850, Seattle WA 98195
FILER'S employer identification no. 91-6001537
STUDENT'S TIN ***-**-3456   STUDENT'S name  CASEY MORGAN
1 Payments received for qualified tuition and related expenses  $11,745.00
5 Scholarships or grants  $2,000.00
8 Check if at least half-time student  [X]`],
    expect: { docType: "1098-T", issuer: "University of Washington", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1098e-nelnet",
    pages: [`Nelnet
Form 1098-E  Student Loan Interest Statement  2023
OMB No. 1545-1576
RECIPIENT'S/LENDER'S name: Nelnet, Inc.
BORROWER'S TIN ***-**-3456   BORROWER'S name CASEY MORGAN
Account number 99****1182
1 Student loan interest received by lender  $1,288.31`],
    expect: { docType: "1098-E", issuer: "Nelnet", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1095a-marketplace",
    pages: [`Form 1095-A  Health Insurance Marketplace Statement  2024
OMB No. 1545-2232
Department of the Treasury Internal Revenue Service
Part I Recipient Information
1 Marketplace identifier  WA   2 Marketplace-assigned policy number 77182-001
3 Policy issuer's name  Premera Blue Cross
4 Recipient's name  CASEY MORGAN   5 Recipient's SSN  900-12-3456
Part III Household Information  monthly enrollment premiums, SLCSP, advance payment of premium tax credit
Washington Healthplanfinder`],
    expect: { docType: "1095-A", issuer: "Washington Healthplanfinder", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "1095b-bcbs-messy",
    pages: [`F0rm 1095-B  Health Coverage   2023
OMB No. 1545-2252
Part I Responsible Individual  CASEY MORGAN
Part III Issuer or Other Coverage Provider
16 Name  BLUE CROSS BLUE SHIELD OF ILLIN0IS
17 Employer identification number 36-1236610
Part IV Covered Individuals  CASEY MORGAN   Covered all 12 months [X]`],
    expect: { docType: "1095-B", issuer: "Blue Cross Blue Shield", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "1040-2024",
    pages: [`Form 1040   U.S. Individual Income Tax Return   2024
Department of the Treasury - Internal Revenue Service   OMB No. 1545-0074   IRS Use Only
Filing Status  [X] Single
Your first name and middle initial CASEY L   Last name MORGAN   Your social security number 900 12 3456
Home address 410 Alder St, Tacoma WA 98405
1a Total amount from Form(s) W-2, box 1  61,400
9 This is your total income  62,242
11 Adjusted gross income  62,242
34 Amount you overpaid  1,019`, `Under penalties of perjury, I declare that I have examined this return and accompanying schedules
Your signature   Date 03/11/2025
Preparer's name  self-prepared`],
    expect: { docType: "Federal tax return", issuer: "IRS", docDate: "2024-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "state-return-nc",
    pages: [`North Carolina Department of Revenue
D-400 Individual Income Tax Return  2023
Your Social Security Number 900-12-3456
Your first name CASEY  Last name MORGAN
Filing status: 1 Single
6 Federal adjusted gross income 58,800
12b North Carolina taxable income 46,050
15 North Carolina income tax 2,187
Refund 312
Signature _______  Date 04/10/2024`],
    expect: { docType: "State tax return", issuer: "North Carolina Department of Revenue", docDate: "2023-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: false },
  },
  {
    id: "ca-ftb-notice",
    pages: [`FRANCHISE TAX BOARD
PO BOX 942840  SACRAMENTO CA 94240-0040
Notice of Tax Return Change
Notice Date: 07/08/2024
Tax Year: 2022
Account: XXX-XX-3456
We changed your 2022 tax return. You owe $88.12.
Pay online at ftb.ca.gov/pay`],
    expect: { docType: "Tax notice", issuer: "Franchise Tax Board", docDate: "2024-07-08", folder: "02 Taxes", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "paystub-adp",
    pages: [`ADP
Earnings Statement
NORTHWIND LOGISTICS INC
500 Harbor Point Dr, Tacoma WA 98402
Period Beginning: 03/01/2025   Period Ending: 03/15/2025
Pay Date: 03/20/2025
CASEY MORGAN   Social Security Number: XXX-XX-3456
Earnings      rate    hours   this period   year to date
Regular       29.52   80.00   2,361.60      11,808.00
Gross Pay                      $2,361.60    $11,808.00
Deductions  Federal Income Tax  -244.10   Social Security Tax  -146.42   Medicare Tax  -34.24
401K  -118.08
Net Pay  $1,818.76
Checking  xxxx4471  $1,818.76`],
    expect: { docType: "Pay stub", issuer: "Northwind Logistics", docDate: "2025-03-20", folder: "08 Work & Income", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "paystub-messy",
    pages: [`Tidewater Design Studio LLC
EARNINGS STATEMENT     Pay Date 06/30/2026
Pay Period 06/16/2026 to 06/30/2026
Ernployee  CASEY MORGAN
Gross Pay  2,170.60    YTD Gross  26,047.20
Fed lncome Tax 201.33   FICA 166.05
NET PAY  1,803.22
Direct Dep0sit  ****4471`],
    expect: { docType: "Pay stub", issuer: "Tidewater Design Studio", docDate: "2026-06-30", folder: "08 Work & Income", verdict: "scan_shred", sensitive: false, paperless: true },
  },
  {
    id: "ssa-statement",
    pages: [`Social Security Administration
Your Social Security Statement
Prepared especially for Casey Morgan
September 12, 2025
Your estimated benefits
At full retirement age (67), your payment would be about $2,284 a month.
Your earnings record  Years you worked   Your taxed Social Security earnings
2022  58,800   2023  61,400   2024  61,400
Review your earnings record carefully. Visit ssa.gov/myaccount`],
    expect: { docType: "Social Security statement", issuer: "Social Security Administration", docDate: "2025-09-12", folder: "08 Work & Income", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  {
    id: "offer-letter",
    pages: [`Northwind Logistics Inc
500 Harbor Point Dr, Tacoma WA 98402
January 6, 2023
Dear Casey,
We are pleased to offer you the position of Operations Analyst at Northwind Logistics.
Your starting salary will be $60,000 per year, paid biweekly, beginning February 1, 2023.
You will be eligible for medical, dental and 401(k) benefits.
Please sign and return this offer letter by January 13, 2023.
Sincerely,
Dana Whitfield, Director of People Operations`],
    expect: { docType: "Employment offer letter", issuer: "Northwind Logistics", docDate: "2023-01-06", folder: "08 Work & Income", verdict: "scan_shred", sensitive: false, paperless: false },
  },
  // Rule misses from the lab's 5-document stack pass (2026-10-16): a plain "Employer:" line, and the
  // IRS line every W-2 carries, which is never its sender.
  {
    id: "w2-employer-colon",
    pages: [`Form W-2 Wage and Tax Statement 2025
Employer: Harbor Lane Outfitters
Employee: Sam Rivera
1 Wages, tips, other compensation 48,210.00
2 Federal income tax withheld 5,102.33
Copy B To Be Filed With Employee's Federal Tax Return
Department of the Treasury Internal Revenue Service`],
    expect: { docType: "W-2", issuer: "Harbor Lane Outfitters", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
  // A payroll provider's own employee: the payroll company is the employer, so it is the sender.
  {
    id: "w2-payroll-is-employer",
    pages: [`a Employee's social security number 900-44-1209   OMB No. 1545-0008
b Employer identification number (EIN) 16-1124166
c Employer's name, address, and ZIP code
Paychex, Inc.
911 Panorama Trail South
Rochester NY 14625
e Employee's first name and initial  Last name   Riley Park
1 Wages, tips, other compensation 58,900.00
Form W-2 Wage and Tax Statement 2025
Department of the Treasury - Internal Revenue Service`],
    expect: { docType: "W-2", issuer: "Paychex", docDate: "2025-12-31", folder: "02 Taxes", verdict: "scan_shred", sensitive: true, paperless: true },
  },
];
