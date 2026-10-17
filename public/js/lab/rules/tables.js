// lab/rules/tables.js: what each document type means for filing (#92). Pure, no DOM.
// One row per type: its folder, verdict, retention, whether the sender usually offers paperless,
// the filename's short description, the title's noun, and how its date and sender are read. The
// verdicts follow the classify prompt's rules (functions/lib.js SYSTEM_PROMPT): keep the original
// when the paper has legal value, shred what has nothing worth keeping, scan and shred the rest.
// Owner: lab (rules engine).

export const FOLDER_NAMES = [
  "01 Identity & Legal", "02 Taxes", "03 Money & Banking", "04 Insurance", "05 Medical", "06 Home",
  "07 Auto", "08 Work & Income", "09 Warranties & Manuals", "10 Personal & Sentimental", "11 Other",
];
export const VERDICTS = ["shred", "scan_shred", "keep_original"];
const [LEGAL, TAX, MONEY, INS, MED, HOME, AUTO, WORK, WARR, PERSONAL, OTHER] = FOLDER_NAMES;
const KEEP7 = "Keep 7 years (tax backup)";

const TAX_REASON = "Tax backup is worth a digital copy, but the paper itself has no legal value.";
const MED_REASON = "Medical records are worth a digital copy, and the paper adds nothing to it.";
const STATEMENT_REASON = "Worth a digital copy for a year in case something on it needs checking.";
const PAPER_REASON = "The paper itself has legal value and is hard to replace, so keep the original.";

// date: "tax" (the tax year's last day), "doc" (the labeled document date), "birth", "event", "none"
// issuer: "known" (known senders, then letterhead), "employer", "payer", "landlord", "party",
// "preparer", "vital", "agency", "signature", or a fixed name.
const row = (folder, verdict, retention, o = {}) => ({ folder, verdict, retention, date: "doc", issuer: "known", recurring: false, sensitive: false, reason: "", ...o });

export const TYPES = {
  "W-2": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "employer", recurring: true, sensitive: true, short: "w2", reason: TAX_REASON, summary: "Wage and tax statement" }),
  "1099-INT": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1099-int", reason: TAX_REASON, summary: "Interest income form" }),
  "1099-DIV": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1099-div", reason: TAX_REASON, summary: "Dividend income form" }),
  "1099-B": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1099-b", reason: TAX_REASON, summary: "Broker proceeds form" }),
  "1099-MISC": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", short: "1099-misc", reason: TAX_REASON, summary: "Miscellaneous income form" }),
  "1099-NEC": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", short: "1099-nec", reason: TAX_REASON, summary: "Nonemployee compensation form" }),
  "1099-R": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1099-r", reason: TAX_REASON, summary: "Retirement distribution form" }),
  "Consolidated 1099": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1099-consolidated", reason: TAX_REASON, summary: "Consolidated 1099 tax statement" }),
  "SSA-1099": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "Social Security Administration", short: "ssa-1099", sensitive: true, reason: TAX_REASON, summary: "Social Security benefit statement" }),
  "1098": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1098-mortgage-interest", reason: TAX_REASON, summary: "Mortgage interest statement" }),
  "1098-T": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1098-t", reason: TAX_REASON, summary: "Tuition statement" }),
  "1098-E": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1098-e", reason: TAX_REASON, summary: "Student loan interest statement" }),
  "1095-A": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "marketplace", short: "1095-a", reason: TAX_REASON, summary: "Marketplace health coverage statement" }),
  "1095-B": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "payer", recurring: true, short: "1095-b", reason: TAX_REASON, summary: "Health coverage form" }),
  "1095-C": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "employer", recurring: true, short: "1095-c", reason: TAX_REASON, summary: "Employer health coverage form" }),
  "Federal tax return": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "IRS", short: "federal-tax-return", sensitive: true, reason: "A copy of the filed return is worth keeping digitally; the IRS has the original.", summary: "Federal income tax return" }),
  "State tax return": row(TAX, "scan_shred", KEEP7, { date: "tax", issuer: "agency", short: "state-tax-return", sensitive: true, reason: "A copy of the filed return is worth keeping digitally; the state has the original.", summary: "State income tax return" }),
  "Tax notice": row(TAX, "scan_shred", KEEP7, { issuer: "known", short: "tax-notice", noun: "tax notice", reason: "Keep a digital copy of tax notices until the matter is closed, plus the tax record window.", summary: "Tax notice" }),
  "Property tax bill": row(TAX, "scan_shred", KEEP7, { issuer: "known", short: "property-tax-bill", reason: "Property tax paid is tax backup, and a scan works as well as the paper.", summary: "Property tax bill" }),

  "Pay stub": row(WORK, "scan_shred", "Keep 1 year (until it matches your W-2)", { issuer: "employer", recurring: true, short: "pay-stub", reason: "Worth a digital copy until you check it against your W-2.", summary: "Pay stub" }),
  "Employment offer letter": row(WORK, "scan_shred", "Keep while you work there", { issuer: "known", short: "offer-letter", noun: "offer letter", reason: "Your offer terms are worth keeping digitally while you work there.", summary: "Job offer letter" }),
  "Social Security statement": row(WORK, "scan_shred", "Until the next statement", { issuer: "Social Security Administration", short: "social-security-statement", reason: "A record of your earnings and estimated benefits; the scan is enough.", summary: "Social Security earnings and benefits statement" }),

  "Explanation of benefits": row(MED, "scan_shred", "Keep 3 years", { recurring: true, short: "eob", noun: "EOB", sensitive: true, reason: MED_REASON, summary: "Explanation of benefits" }),
  "Medical bill": row(MED, "scan_shred", "Keep 3 years", { recurring: true, short: "medical-bill", noun: "bill", sensitive: true, reason: "Medical bills are worth a digital copy in case a charge or claim is questioned.", summary: "Medical bill" }),
  "Medical record": row(MED, "scan_shred", "Permanently", { short: "medical-record", noun: "medical record", sensitive: true, reason: MED_REASON, summary: "Medical record" }),
  "Pharmacy receipt": row(MED, "scan_shred", "Keep 3 years (HSA or FSA backup)", { short: "pharmacy-receipt", noun: "pharmacy receipt", sensitive: true, reason: "Prescription receipts back up HSA, FSA and medical deductions, and a scan works.", summary: "Pharmacy receipt" }),

  "Insurance ID card": row(INS, "scan_shred", "Until the policy is replaced", { recurring: true, short: "insurance-id-card", noun: "insurance ID card", reason: "A scan of the card is handy; carry the card itself.", summary: "Insurance ID card" }),
  "Insurance declarations page": row(INS, "scan_shred", "Until the policy is replaced", { recurring: true, short: "insurance-declarations", noun: "declarations page", reason: "Your coverage details are worth keeping digitally until the policy is replaced.", summary: "Insurance declarations page" }),
  "Insurance policy": row(INS, "scan_shred", "Until the policy ends", { recurring: true, short: "insurance-policy", noun: "insurance policy", reason: "The policy terms are worth keeping digitally; the insurer keeps the original.", summary: "Insurance policy" }),

  "Utility bill": row(HOME, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "utility-bill", noun: "bill", reason: STATEMENT_REASON, summary: "Utility bill" }),
  "Phone bill": row(HOME, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "phone-bill", noun: "phone bill", reason: STATEMENT_REASON, summary: "Phone bill" }),
  "Internet bill": row(HOME, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "internet-bill", noun: "internet bill", reason: STATEMENT_REASON, summary: "Internet bill" }),
  "Bank statement": row(MONEY, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "bank-statement", noun: "statement", reason: STATEMENT_REASON, summary: "Bank statement" }),
  "Credit card statement": row(MONEY, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "credit-card-statement", noun: "credit card statement", reason: STATEMENT_REASON, summary: "Credit card statement" }),
  "Brokerage statement": row(MONEY, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "brokerage-statement", noun: "brokerage statement", reason: STATEMENT_REASON, summary: "Brokerage statement" }),
  "Retirement account statement": row(MONEY, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "retirement-statement", noun: "retirement statement", reason: STATEMENT_REASON, summary: "Retirement account statement" }),
  "Loan statement": row(MONEY, "scan_shred", "Until the loan is paid off", { statement: true, recurring: true, short: "loan-statement", noun: "loan statement", reason: STATEMENT_REASON, summary: "Loan statement" }),
  "Mortgage statement": row(HOME, "scan_shred", "Until the loan is paid off", { statement: true, recurring: true, short: "mortgage-statement", noun: "mortgage statement", reason: STATEMENT_REASON, summary: "Mortgage statement" }),
  "HOA statement": row(HOME, "scan_shred", "Keep 1 year", { statement: true, recurring: true, short: "hoa-statement", noun: "HOA statement", reason: STATEMENT_REASON, summary: "HOA assessment statement" }),
  "Loan payoff letter": row(MONEY, "scan_shred", "Permanently", { short: "loan-payoff-letter", noun: "payoff letter", reason: "Proof the loan is paid off is worth keeping for good, and a scan works.", summary: "Loan payoff letter" }),
  "Lease": row(HOME, "scan_shred", "Until the lease ends, plus 3 years", { issuer: "landlord", short: "lease", noun: "lease", reason: "A signed lease is worth keeping digitally; a scan works for almost everything.", summary: "Lease" }),

  "Receipt": row(MONEY, "scan_shred", "Until the return or warranty period ends", { short: "receipt", noun: "receipt", reason: "Proof of purchase is worth a digital copy, and a scan works as well as the paper.", summary: "Receipt" }),
  "Invoice": row(MONEY, "scan_shred", "Keep 3 years", { short: "invoice", noun: "invoice", reason: "Worth a digital record of the work and what you paid.", summary: "Invoice" }),
  "Warranty": row(WARR, "scan_shred", "Until the warranty ends", { short: "warranty", noun: "warranty", reason: "Keep the warranty terms digitally with the proof of purchase.", summary: "Warranty" }),
  "Manual": row(WARR, "scan_shred", "Until you no longer own it", { issuer: "brand", short: "manual", noun: "manual", reason: "Manuals are easy to keep as a scan, and most are online too.", summary: "Owner's manual" }),

  "Vehicle title": row(AUTO, "keep_original", "Until you sell the car", { issuer: "agency", short: "vehicle-title", noun: "vehicle title", reason: "The paper title proves ownership and is needed to sell the car.", summary: "Vehicle certificate of title" }),
  "Vehicle registration": row(AUTO, "scan_shred", "Until it is renewed", { issuer: "agency", short: "vehicle-registration", noun: "vehicle registration", reason: "Keep the current card in the car; a scan covers the record.", summary: "Vehicle registration" }),

  "Birth certificate": row(LEGAL, "keep_original", "Permanently", { date: "birth", issuer: "vital", short: "birth-certificate", noun: "birth certificate", sensitive: true, reason: "A certified birth certificate has to stay on paper.", summary: "Certified birth certificate" }),
  "Marriage certificate": row(LEGAL, "keep_original", "Permanently", { date: "event", issuer: "vital", short: "marriage-certificate", noun: "marriage certificate", sensitive: true, reason: "A certified marriage certificate has to stay on paper.", summary: "Certified marriage certificate" }),
  "Social Security card": row(LEGAL, "keep_original", "Permanently", { date: "none", issuer: "Social Security Administration", short: "social-security-card", noun: "Social Security card", sensitive: true, reason: "A Social Security card is hard to replace, so keep the original somewhere safe.", summary: "Social Security card" }),
  "Passport": row(LEGAL, "keep_original", "Permanently", { issuer: "U.S. Department of State", short: "passport", noun: "passport", sensitive: true, reason: "A passport is an original government document, so keep it.", summary: "U.S. passport" }),
  "Property deed": row(LEGAL, "keep_original", "Permanently", { issuer: "known", short: "deed", noun: "deed", reason: PAPER_REASON, summary: "Property deed" }),
  "Will": row(LEGAL, "keep_original", "Permanently", { issuer: "preparer", short: "will", noun: "will", reason: "A signed will has to stay on paper.", summary: "Last will and testament" }),
  "Notarized document": row(LEGAL, "keep_original", "Permanently", { issuer: "preparer", short: "notarized-document", noun: "notarized document", reason: "A notarized original carries legal weight that a scan doesn't.", summary: "Notarized document" }),
  "Settlement agreement": row(LEGAL, "scan_shred", "Permanently", { issuer: "party", short: "settlement-agreement", noun: "settlement agreement", reason: "A signed agreement is worth keeping digitally for good; the scan holds up for most needs.", summary: "Settlement agreement" }),
  "Settlement notice": row(LEGAL, "scan_shred", "Until the settlement pays out", { issuer: "administrator", short: "settlement-notice", noun: "settlement notice", reason: "Keep the claim details digitally until the settlement pays out.", summary: "Class action settlement notice" }),
  "Contract": row(LEGAL, "scan_shred", "Until it ends, plus 3 years", { short: "agreement", noun: "agreement", reason: "A signed agreement is worth keeping digitally until it ends.", summary: "Signed agreement" }),

  "Junk mail": row(OTHER, "shred", "Not needed", { date: "none", short: "junk-mail", noun: "ad", reason: "This is advertising mail with nothing worth keeping.", summary: "Advertising mail" }),
  "Credit card offer": row(OTHER, "shred", "Not needed", { recurring: true, short: "credit-card-offer", noun: "credit card offer", reason: "A prescreened offer has nothing worth keeping.", summary: "Credit card offer" }),
  "Preapproval": row(OTHER, "shred", "Not needed", { recurring: true, short: "preapproval-offer", noun: "preapproval offer", reason: "A prescreened offer has nothing worth keeping.", summary: "Preapproval offer" }),
  "Letter": row(OTHER, "scan_shred", "Keep 1 year", { short: "letter", noun: "letter", reason: "Worth a digital copy in case you need to refer back to it.", summary: "Letter" }),
  "Personal letter": row(PERSONAL, "keep_original", "Permanently", { issuer: "signature", short: "letter", noun: "letter", reason: "Personal letters are worth keeping as they are.", summary: "Personal letter" }),
  "Greeting card": row(PERSONAL, "keep_original", "Permanently", { date: "none", issuer: "signature", short: "card", noun: "card", reason: "Cards from people you care about are worth keeping as they are.", summary: "Greeting card" }),

  "Unknown": row(OTHER, "scan_shred", "Needs a look", { short: "document", noun: "document", reason: "Needs a look: the rules couldn't tell what this is, so it waits as scan and shred until you check it.", summary: "Document" }),
};

// Which folder a letter, receipt, invoice or loan goes to depends on who sent it or what it was for.
export const KIND_FOLDER = { bank: MONEY, card: MONEY, brokerage: MONEY, retirement: MONEY, loan: MONEY, auto_lender: AUTO, mortgage: HOME, utility: HOME, mobile: HOME, isp: HOME, insurer: INS, health_insurer: MED, pharmacy: MED, medical: MED, lab: MED, gov_tax: TAX, payroll: WORK, gov: LEGAL, marketplace: TAX };
export const GOVERNMENT = new Set(["gov", "gov_tax", "marketplace"]);

// Paperless how-to by kind of sender, when the known-sender list has nothing specific.
export const PAPERLESS_HOW = {
  bank: (i) => `Sign in to your ${i} account and turn on paperless statements in the statement or document settings.`,
  card: (i) => `Sign in to your ${i} account and turn on paperless statements in the statement settings.`,
  brokerage: (i) => `Sign in to your ${i} account and choose electronic delivery for statements and tax forms.`,
  retirement: (i) => `Sign in to your ${i} account and choose electronic delivery in the communication preferences.`,
  utility: (i) => `Sign in to your ${i} account and turn on paperless billing in the billing settings.`,
  mobile: (i) => `Sign in to your ${i} account and turn on paperless billing in the billing settings.`,
  isp: (i) => `Sign in to your ${i} account and turn on paperless billing in the billing settings.`,
  insurer: (i) => `Sign in to your ${i} account and choose paperless documents in the policy or profile settings.`,
  health_insurer: (i) => `Sign in to your ${i} member account and choose paperless EOBs and plan documents in the communication preferences.`,
  medical: (i) => `Sign in to the ${i} patient portal and choose paperless statements in the billing settings.`,
  loan: (i) => `Sign in to your ${i} account and turn on paperless statements and notices.`,
  auto_lender: (i) => `Sign in to your ${i} account and turn on paperless statements.`,
  mortgage: (i) => `Sign in to your ${i} account and turn on paperless statements and tax forms.`,
  employer: (i, payroll, what = "W-2s") => `Turn on electronic ${what} in ${payroll ? `the ${payroll} portal` : `${i}${/s$/.test(i) ? "'" : "'s"} payroll or benefits portal`}.`,
  school: (i) => `Choose electronic 1098-T delivery in the ${i} student account.`,
  offer: () => "Opt out of prescreened credit offers at optoutprescreen.com or by calling 1-888-567-8688.",
  default: (i) => `Sign in to your ${i} account and look for paperless or e-delivery in the account settings.`,
};
