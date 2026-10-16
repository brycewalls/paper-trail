// lab/rules/types.js: the document-type detectors (#92). Pure, no DOM.
// Each detector adds up weighted signals: a string is a phrase (OCR-folded, see text.js), a RegExp
// runs on the lowercased text, a function gets (ctx, env) and returns 0 to 1. "minus" signals take
// points away. The highest score wins; below MIN_SCORE the document is Unknown. Form markers (the
// form's name, its OMB number, "Copy B") carry the most weight because nothing else prints them.
// Owner: lab (rules engine).

export const MIN_SCORE = 4;

const kind = (...kinds) => (ctx, env) => (kinds.some((k) => env.kinds.has(k)) ? 1 : 0);
const headKind = (...kinds) => (ctx, env) => (env.senders.some((s) => kinds.includes(s.kind) && s.top) ? 1 : 0);
const PRESCREEN = /prescreen|opt-?out notice|optoutprescreen|1-888-5-?opt-?out|1-888-567-8688/;
const SSN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/;
// A 1099 variant named on the page, for the consolidated statement.
const variants = (ctx) => ["1099-int", "1099-div", "1099-b", "1099-misc", "1099-oid", "1099-r"].filter((v) => ctx.has(v)).length;

export const DETECTORS = [
  // ---------- taxes ----------
  { type: "W-2", signals: [["wage and tax statement", 7], ["1545-0008", 6], ["form w-2", 5], [/\bw ?-? ?2\b/, 2], ["employer identification number", 1], ["wages, tips, other compensation", 3], ["employer's name, address", 2], ["social security wages", 2]],
    minus: [["1099", 3], ["individual income tax return", 6], ["earnings statement", 4]] },
  { type: "1099-INT", signals: [["1099-int", 7], ["1545-0112", 6], ["interest income", 2]], minus: [[(c) => (variants(c) > 1 ? 1 : 0), 8], ["1098", 3]] },
  { type: "1099-DIV", signals: [["1099-div", 7], ["1545-0110", 6], ["dividends and distributions", 3], ["total ordinary dividends", 2]], minus: [[(c) => (variants(c) > 1 ? 1 : 0), 8]] },
  { type: "1099-B", signals: [["1099-b", 7], ["1545-0715", 6], ["proceeds from broker", 4], ["cost basis", 1]], minus: [[(c) => (variants(c) > 1 ? 1 : 0), 8]] },
  { type: "1099-MISC", signals: [["1099-misc", 7], ["1545-0115", 6], ["miscellaneous information", 3]] },
  { type: "1099-NEC", signals: [["1099-nec", 7], ["1545-0116", 6], ["nonemployee compensation", 4]] },
  { type: "1099-R", signals: [["1099-r", 7], ["1545-0119", 6], ["distributions from pensions", 4], ["gross distribution", 2]] },
  { type: "Consolidated 1099", signals: [["consolidated form 1099", 10], ["composite form 1099", 10], ["consolidated 1099", 9], [(c) => (variants(c) > 1 ? 1 : 0), 9]] },
  { type: "SSA-1099", signals: [["ssa-1099", 10], ["social security benefit statement", 6], ["benefits paid in", 2]] },
  { type: "1098", signals: [["mortgage interest statement", 6], ["1545-1380", 6], ["mortgage interest received", 3], [/form 1098(?![-\w])/, 3]], minus: [["1098-t", 6], ["1098-e", 6]] },
  { type: "1098-T", signals: [["1098-t", 8], ["tuition statement", 5], ["1545-1574", 6], ["qualified tuition", 2]] },
  { type: "1098-E", signals: [["1098-e", 8], ["student loan interest statement", 6], ["1545-1576", 6]] },
  { type: "1095-A", signals: [["1095-a", 8], ["health insurance marketplace statement", 6], ["1545-2232", 6]] },
  { type: "1095-B", signals: [["1095-b", 8], ["1545-2252", 6], ["health coverage", 1]] },
  { type: "1095-C", signals: [["1095-c", 8], ["1545-2251", 6], ["employer-provided health insurance offer", 6]] },
  { type: "Federal tax return", signals: [["u.s. individual income tax return", 8], ["1545-0074", 6], ["form 1040", 5], ["adjusted gross income", 1], ["under penalties of perjury", 2], ["filing status", 2]],
    minus: [["department of revenue", 4]] },
  { type: "State tax return", signals: [["individual income tax return", 3], ["resident income tax return", 4], [/\b(d-400|form 540|it-201|it-40|form 1 |nj-1040|pa-40)\b/, 5], ["department of revenue", 3], ["franchise tax board", 2], ["filing status", 1], ["refund", 1]],
    minus: [["u.s. individual income tax return", 8], [/notice/, 3]] },
  { type: "Tax notice", signals: [[/\bnotice cp ?\d{2,4}\b|\bcp ?\d{2,4}\b/, 5], ["notice of tax return change", 6], [/\b(notice|letter) (date|number)\b/, 2], ["we changed your", 3], ["unpaid taxes", 3],
    [(c, e) => (e.kinds.has("gov_tax") && /notice/.test(c.low) ? 1 : 0), 4], [/you owe|amount due|balance due/, 1]],
    minus: [["1099", 4], ["wage and tax statement", 6], ["u.s. individual income tax return", 6]] },
  { type: "Property tax bill", signals: [["property tax statement", 7], ["real property tax", 6], ["parcel number", 2], ["assessed value", 2], ["property tax", 2]] },

  // ---------- work and income ----------
  { type: "Pay stub", signals: [["earnings statement", 5], ["pay stub", 5], ["pay statement", 4], ["pay date", 2], ["pay period", 2], ["period ending", 1], ["net pay", 3], ["gross pay", 2], [/\bytd\b|year to date/, 1], ["deductions", 1]],
    minus: [["wage and tax statement", 6], ["form w-2", 4]] },
  { type: "Employment offer letter", signals: [["pleased to offer you the position", 8], ["offer letter", 3], ["starting salary", 3], ["offer of employment", 6]] },
  { type: "Social Security statement", signals: [["your social security statement", 8], ["estimated benefits", 3], ["earnings record", 2]] },

  // ---------- medical ----------
  { type: "Explanation of benefits", signals: [["explanation of benefits", 8], ["this is not a bill", 3], [/\beob\b/, 3], ["plan paid", 2], ["claim", 1], [/patient responsibility|your share|what you owe|you may owe/, 1], ["member id", 1], [headKind("health_insurer"), 2]] },
  { type: "Medical bill", signals: [["patient statement", 5], ["guarantor", 3], ["patient", 1], ["date of service", 2], [/office visit|emergency|biopsy|x-ray|ct scan|procedure|lab work|anesthesia|radiology|surgery|dental|physical therapy/, 2], [/amount due|balance due|please pay/, 2],
    [/hospital|clinic|medical|dermatology|physicians|health system|pediatrics|orthopedic|family medicine|urgent care/, 1], ["statement", 1]],
    minus: [["explanation of benefits", 7], ["this is not a bill", 4], ["reference range", 4]] },
  { type: "Medical record", signals: [["patient report", 5], ["reference range", 5], ["lab results", 4], ["test results", 3], ["ordering physician", 3], ["diagnosis", 2], ["visit summary", 5], ["after visit summary", 6], ["immunization record", 6]] },
  { type: "Pharmacy receipt", signals: [[/\brx ?#?\s?\d{5,}/, 4], [/pharmacy|pharmacist/, 2], [kind("pharmacy"), 3], [/\b\d+ ?mg\b/, 2], ["copay", 1], [/\btotal\b|subtotal/, 1], ["insurance paid", 1], [/fsa|hsa/, 1]],
    minus: [["explanation of benefits", 6], ["patient report", 4]] },

  // ---------- insurance ----------
  { type: "Insurance ID card", signals: [["identification card", 5], ["id card", 4], ["id cards are enclosed", 5], ["keep this card", 3], ["keep your card", 3], ["rx bin", 3], [kind("insurer", "health_insurer"), 2], ["insurance", 1]],
    minus: [["explanation of benefits", 6], ["declarations", 4]] },
  { type: "Insurance declarations page", signals: [["declarations", 7], ["coverage summary", 3], ["named insured", 3], ["policy period", 2], ["premium", 2], ["deductible", 1], ["coverages", 1], [kind("insurer"), 2]] },
  { type: "Insurance policy", signals: [["insurance policy", 4], ["face amount", 4], ["beneficiary", 3], ["this policy is a legal contract", 5], ["term life", 4], ["policy date", 2], ["policy number", 1], [kind("insurer"), 2]],
    minus: [["declarations", 4]] },

  // ---------- home and money ----------
  { type: "Utility bill", signals: [[/\bkwh\b|kilowatt/, 5], ["therms", 3], ["energy bill", 4], ["electric bill", 4], ["electricity used", 3], [/natural gas|gas service/, 2], [/water usage|sewer|stormwater|water division/, 4], ["utility bill", 4], [kind("utility"), 4], [/amount due|total due/, 1], ["service address", 1]] },
  { type: "Phone bill", signals: [["wireless", 3], [/\b\d lines?\b/, 2], ["unlimited", 1], [/iphone|galaxy|pixel|device payment|devices/, 1], [headKind("mobile"), 5], ["phone", 1]],
    minus: [["mbps", 3], ["kwh", 4]] },
  { type: "Internet bill", signals: [["internet", 3], ["mbps", 3], [/wifi|gateway|modem|router/, 2], [headKind("isp"), 5]], minus: [["kwh", 4], ["wireless phone", 3]] },
  { type: "Bank statement", signals: [[/\bchecking\b/, 2], [/\bsavings\b/, 2], ["beginning balance", 2], ["ending balance", 2], ["deposits", 1], ["withdrawals", 1], ["routing number", 1], ["member fdic", 2], ["ncua", 2], ["share savings", 2], ["dividends earned", 1], ["interest earned", 1], ["statement period", 1], [headKind("bank"), 2], ["credit union", 2]],
    minus: [["minimum payment due", 5], ["1099", 5], [/\bdear\b/, 3], ["prescreen", 4]] },
  { type: "Credit card statement", signals: [["minimum payment due", 6], ["minimum payment", 2], ["new balance", 2], ["payment due date", 2], ["purchase apr", 2], ["credit limit", 2], ["closing date", 2], [/rewards|cash back|miles earned|points earned/, 1], [headKind("card"), 2]],
    minus: [[PRESCREEN, 6], ["pre-approved", 4]] },
  { type: "Brokerage statement", signals: [["investment report", 5], ["brokerage account", 3], ["holdings", 2], ["account value", 2], ["sipc", 3], ["quarterly statement", 2], [/\bshares\b/, 1], [headKind("brokerage"), 2]],
    minus: [["1099", 6], ["401(k)", 3], ["vested balance", 3]] },
  { type: "Retirement account statement", signals: [[/401\s?\(?k\)?|403\s?\(?b\)?/, 4], ["retirement plan statement", 6], ["vested balance", 4], ["employer contributions", 1], [kind("retirement"), 2]],
    minus: [["1099", 6], ["offer", 3]] },
  { type: "Loan statement", signals: [[/\bloan\b/, 2], ["principal balance", 3], ["interest rate", 1], [/payment due|amount due|payment amount/, 1], ["billing statement", 2], ["monthly statement", 2], [/student aid|student loan/, 2], [kind("loan", "auto_lender"), 3]],
    minus: [["paid in full", 6], ["1098", 5], ["pre-approved", 5], ["escrow", 3]] },
  { type: "Mortgage statement", signals: [["mortgage statement", 7], ["escrow", 3], ["property address", 2], ["outstanding principal", 2], [kind("mortgage"), 2]],
    minus: [["1098", 6], ["mortgage interest statement", 6]] },
  { type: "Loan payoff letter", signals: [["paid in full", 7], ["zero balance", 3], ["lien release", 4], ["payoff", 4], ["no further payments", 3], ["paid off", 4]] },
  { type: "HOA statement", signals: [["homeowners association", 6], [/\bhoa\b/, 3], ["assessment", 3]] },
  { type: "Lease", signals: [["lease agreement", 7], ["residential lease", 7], ["rental agreement", 6], ["landlord", 3], ["tenant", 3], ["security deposit", 2], ["monthly rent", 2], ["premises", 2]],
    minus: [["settlement agreement", 8], ["rent receipt", 6]] },

  // ---------- purchases ----------
  { type: "Receipt", signals: [["receipt", 3], ["rent receipt", 6], ["subtotal", 2], [/\btotal\b/, 1], [/sales tax|\btax\b/, 1], [/(visa|mastercard|debit|amex|discover|credit)\s*[*x•]{2,}\s?\d{4}/, 3], ["thank you for shopping", 3], [/return policy|return and exchange/, 2], [/\b\d{1,2}:\d{2}\s?(am|pm)?\b/, 1], [/\bstore\s?#?\d/, 1], ["approved", 1], ["balance due", 1], [kind("retailer"), 2]],
    minus: [["invoice", 3], ["statement", 2], ["explanation of benefits", 5], [/\brx ?#?\s?\d{5,}/, 4]] },
  { type: "Invoice", signals: [["invoice", 5], ["bill to", 3], ["invoice date", 2], ["payment due upon receipt", 2], ["service invoice", 2]] },
  { type: "Warranty", signals: [["limited warranty", 7], [/\b\d+ year warranty|warranty\b/, 3], [/(covers|guaranteed for) parts and labor/, 3], ["serial number", 2], [/register(ing|ed)?|registration/, 1], ["proof of purchase", 2]],
    minus: [["vehicle service contract", 6], ["receipt", 2], [/\btotal\b/, 2], ["not affiliated", 5]] },
  { type: "Manual", signals: [["owner's manual", 8], ["user guide", 6], ["operating instructions", 5], ["installation instructions", 3], ["table of contents", 2], ["safety instructions", 2], ["troubleshooting", 2]] },

  // ---------- auto ----------
  { type: "Vehicle title", signals: [["certificate of title", 8], [/title (no|number)/, 3], [/lienholder|legal owner/, 2], [/odometer/, 2], [/\bvin\b/, 1]] },
  { type: "Vehicle registration", signals: [["registration certificate", 6], ["registration card", 6], ["vehicle registration", 5], [/\bplate\b/, 2], [/keep (this registration |this )?in (your )?vehicle/, 3], [/\bvin\b/, 1], [/\bfees\b/, 1]],
    minus: [["certificate of title", 6], ["insurance", 4]] },

  // ---------- identity and legal ----------
  { type: "Birth certificate", signals: [["certificate of live birth", 9], ["certificate of birth", 9], ["birth certificate", 9], [/vital record/, 2], ["registrar", 2], ["mother's maiden name", 3], ["place of birth", 1]],
    minus: [["passport", 5]] },
  { type: "Marriage certificate", signals: [["certificate of marriage", 9], ["marriage certificate", 9], ["united in marriage", 6], ["joined in marriage", 6], ["marriage license", 6], ["officiant", 3]] },
  { type: "Social Security card", signals: [["this number has been established for", 10], [(c) => (c.chars < 160 && /social security/.test(c.low) && SSN.test(c.low) ? 1 : 0), 4]] },
  { type: "Passport", signals: [[/passport (no|number|book number)/, 6], ["passport", 3], ["date of expiration", 1], ["nationality", 2], [/p<usa/, 6], ["passport services", 4], ["department of state", 2]] },
  { type: "Property deed", signals: [["warranty deed", 9], ["quitclaim deed", 9], ["grant deed", 9], ["deed of trust", 7], ["grantor", 3], ["grantee", 3], ["conveys", 2]] },
  { type: "Will", signals: [["last will and testament", 10], ["codicil", 2], ["personal representative", 2], ["executor", 2]] },
  { type: "Notarized document", signals: [["notary public", 5], [/sworn to and subscribed|subscribed and sworn/, 4], ["affidavit", 3], ["power of attorney", 4], [/notary seal|\(seal\)/, 1], ["commission expires", 2], ["attorney-in-fact", 2]] },
  { type: "Settlement agreement", signals: [["settlement agreement", 9], ["mutual release", 4], [/releases? the other|release of (all )?claims/, 2]], minus: [["class action", 6]] },
  { type: "Settlement notice", signals: [["notice of class action settlement", 10], ["class action", 4], ["settlement administrator", 3], ["claim deadline", 2]] },
  { type: "Contract", signals: [["membership agreement", 6], ["service agreement", 6], [/\bagreement\b/, 2], ["by signing below", 3], [/\bcontract\b/, 2], ["terms and conditions", 1], ["cancellation", 1]],
    minus: [["settlement agreement", 6], ["lease", 4], [/\bdear\b/, 3], ["not affiliated", 5], ["vehicle service contract", 5]] },

  // ---------- mail ----------
  { type: "Junk mail", signals: [[/current resident|or resident\b/, 5], [/prsrt std|presorted|us postage paid/, 4], ["limited time", 3], [/\bfree\b/, 1], ["coupon", 2], [/call (today|now)/, 2], [/save \d+%/, 2], ["offer valid", 2], ["not affiliated", 3], ["restrictions apply", 2], ["order online", 1], [/now delivering|grand opening|special offer|act now/, 2]],
    minus: [[PRESCREEN, 3]] },
  { type: "Credit card offer", signals: [[PRESCREEN, 5], [/bonus (points|miles)|cash back bonus/, 3], ["apply by", 2], ["acceptance code", 2], [/\bcard\b/, 1], ["intro apr", 2]] },
  { type: "Preapproval", signals: [[/pre-?approved|pre-?appr[o0]ved|pre-?qualified/, 9], [PRESCREEN, 2], ["reservation code", 2], ["check your rate", 2]] },
  { type: "Letter", signals: [[/\bdear\b/, 3], ["sincerely", 3], [/we('| a)re writing/, 3], ["summons", 4], [/\bre: /, 1], ["important information about your account", 2], ["no action is needed", 2]] },
  { type: "Personal letter", signals: [[/\blove,|love always|with love/, 5], ["miss you", 3], [/dear (grandma|grandpa|mom|dad|aunt|uncle)/, 3], [/\bdear\b/, 1]],
    minus: [[/account|payment|policy|statement|invoice/, 4], ["happy birthday", 3]] },
  { type: "Greeting card", signals: [[/happy birthday|merry christmas|happy holidays|happy anniversary|with sympathy|thinking of you|congratulations on/, 7], ["xoxo", 2], ["wishing you", 2]],
    minus: [[/account|payment|policy|statement/, 4]] },
];

// Filenames like "W2_2023.pdf" or "chase-statement-march.pdf" nudge a type when the text is thin.
const FILENAME_HINTS = [
  [/\bw-?2\b/, "W-2"], [/1099-?int/, "1099-INT"], [/1099-?div/, "1099-DIV"], [/1099-?b\b/, "1099-B"], [/1099-?nec/, "1099-NEC"], [/1099-?misc/, "1099-MISC"], [/1099-?r\b/, "1099-R"],
  [/1098-?t/, "1098-T"], [/1098-?e/, "1098-E"], [/\b1098\b/, "1098"], [/1095-?a/, "1095-A"], [/1095-?b/, "1095-B"], [/1095-?c/, "1095-C"], [/\b1040\b/, "Federal tax return"],
  [/\beob\b/, "Explanation of benefits"], [/lease/, "Lease"], [/receipt/, "Receipt"], [/invoice/, "Invoice"], [/pay ?stub|paystub/, "Pay stub"], [/passport/, "Passport"],
  [/birth/, "Birth certificate"], [/marriage/, "Marriage certificate"], [/title/, "Vehicle title"], [/registration/, "Vehicle registration"], [/warranty/, "Warranty"], [/manual/, "Manual"],
];

// Scores every detector. Returns [{ type, score, evidence }] best first.
export function scoreTypes(ctx, env) {
  const fname = ctx.filename.toLowerCase().replace(/[_.]+/g, " ");
  const out = DETECTORS.map((d) => {
    let score = 0;
    const evidence = [];
    for (const [sig, w] of d.signals) {
      const v = hit(ctx, env, sig);
      if (v) { score += w * v; evidence.push(label(sig)); }
    }
    for (const [sig, w] of d.minus || []) {
      const v = hit(ctx, env, sig);
      if (v) score -= w * v;
    }
    if (fname) for (const [rx, t] of FILENAME_HINTS) if (t === d.type && rx.test(fname)) { score += 3; evidence.push(`filename ${ctx.filename}`); }
    return { type: d.type, score: Math.round(score * 10) / 10, evidence };
  });
  return out.sort((a, b) => b.score - a.score);
}
function hit(ctx, env, sig) {
  if (typeof sig === "string") return ctx.has(sig);
  if (sig instanceof RegExp) return ctx.re(sig) ? 1 : 0;
  return Number(sig(ctx, env)) || 0;
}
const label = (sig) => (typeof sig === "string" ? sig : sig instanceof RegExp ? String(sig) : "known sender");
