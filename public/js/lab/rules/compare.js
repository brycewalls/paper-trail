// lab/rules/compare.js: how close two cards are, field by field (#92). Pure, no DOM.
// Used by compare mode (the rules' card beside Claude's on the same document) and by the eval runner
// (tools/lab/eval-rules.mjs). Exact text rarely matches between two readers, so each field has a
// fair test:
//   docType   the same kind of document after folding names ("EOB" and "Explanation of benefits")
//   issuer    the same sender after dropping Inc, LLC, N.A. and the like; one name inside the other counts
//   docDate, folder, verdict, sensitive, paperless (possible)   exactly equal
//   filename  exactly equal, and separately the date part alone (filenameDate)
//   title     the issuer's first word and the date's year or month, when the other card has them
// Owner: lab (rules engine).

export const COMPARE_FIELDS = ["docType", "issuer", "docDate", "folder", "verdict", "sensitive", "paperless", "filename", "filenameDate", "title"];

// Canonical document kinds: the first pattern that matches a docType names its kind.
const KINDS = [
  [/consolidated|composite/, "1099-consolidated"], [/ssa-?1099/, "ssa-1099"], [/1099-?int/, "1099-int"], [/1099-?div/, "1099-div"], [/1099-?b\b/, "1099-b"], [/1099-?misc/, "1099-misc"],
  [/1099-?nec/, "1099-nec"], [/1099-?r\b/, "1099-r"], [/1098-?t/, "1098-t"], [/1098-?e/, "1098-e"], [/1098/, "1098"], [/1095-?a/, "1095-a"], [/1095-?b/, "1095-b"], [/1095-?c/, "1095-c"],
  [/\bw-?2\b|wage and tax/, "w-2"], [/1040|federal (income )?tax return|individual income tax return/, "federal-return"], [/state (income )?tax return|d-400|form 540/, "state-return"],
  [/tax notice|irs notice|cp\d|notice of tax|tax bill notice|balance due notice/, "tax-notice"], [/property tax/, "property-tax"],
  [/pay ?stub|earnings statement|pay statement|paycheck/, "pay-stub"], [/offer letter|job offer|employment offer/, "offer-letter"], [/social security (statement|benefits statement)/, "ssa-statement"],
  [/explanation of benefits|\beob\b/, "eob"], [/pharmacy|prescription receipt/, "pharmacy-receipt"], [/medical (bill|statement)|hospital (bill|statement)|patient statement|provider bill|dental bill/, "medical-bill"],
  [/lab (result|report)|medical record|test result|visit summary|patient report/, "medical-record"],
  [/id card|identification card|insurance card/, "insurance-id"], [/declaration/, "insurance-dec"], [/insurance policy|policy document|life insurance|policy booklet/, "insurance-policy"],
  [/mortgage statement/, "mortgage-statement"], [/payoff|paid in full|lien release/, "loan-payoff"], [/hoa|homeowners association|assessment/, "hoa"],
  [/(electric|gas|water|utility|energy|power|sewer)\b.*\b(bill|statement)|utility/, "utility-bill"], [/(phone|wireless|cell|mobile)\b.*\b(bill|statement)/, "phone-bill"],
  [/(internet|broadband|cable)\b.*\b(bill|statement)/, "internet-bill"], [/credit card statement|card statement/, "credit-card-statement"],
  [/401|403\(?b|retirement/, "retirement-statement"], [/brokerage|investment (statement|report)|ira statement/, "brokerage-statement"],
  [/(bank|checking|savings|credit union|account|member) statement/, "bank-statement"], [/loan (statement|bill)|loan billing|student loan/, "loan-statement"],
  [/lease|rental agreement/, "lease"], [/receipt/, "receipt"], [/invoice/, "invoice"], [/warranty/, "warranty"], [/manual|user guide|instructions/, "manual"],
  [/title/, "vehicle-title"], [/registration/, "vehicle-registration"], [/birth/, "birth-certificate"], [/marriage/, "marriage-certificate"],
  [/social security card/, "ssn-card"], [/passport/, "passport"], [/deed/, "deed"], [/\bwill\b|testament/, "will"],
  [/settlement agreement|release agreement/, "settlement-agreement"], [/settlement|class action/, "settlement-notice"],
  [/notar|affidavit|power of attorney/, "notarized"], [/agreement|contract/, "contract"],
  [/offer|pre-?approv|pre-?qualif|solicitation/, "offer"], [/junk|advert|promot|flyer|marketing|mailer|coupon/, "junk"],
  [/greeting|birthday|holiday card|\bcard\b/, "card"], [/personal letter|letter from (a )?(friend|family)/, "personal-letter"],
  [/letter|notice|correspondence|summons/, "letter"], [/unknown|unreadable|needs a look/, "unknown"],
];
export function docKind(docType) {
  const t = String(docType || "").toLowerCase().trim();
  if (!t) return "";
  for (const [rx, k] of KINDS) if (rx.test(t)) return k;
  return t;
}

const STRIP = /\b(inc|llc|pllc|llp|ltd|corp|corporation|co|company|the|n\s?a|bank|fsb|na)\b/g;
export const issuerKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/&/g, " and ").replace(STRIP, " ").replace(/\s+/g, " ").trim();
export function sameIssuer(a, b) {
  const x = issuerKey(a), y = issuerKey(b);
  if (!x && !y) return true;
  if (!x || !y) return false;
  if (x === y) return true;
  const sx = x.replace(/ /g, ""), sy = y.replace(/ /g, "");
  return sx.includes(sy) || sy.includes(sx);
}

function sameTitle(a, b) {
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const wa = new Set(words(a)), wb = words(b);
  if (!wb.length) return !wa.size;
  const shared = wb.filter((w) => wa.has(w)).length;
  return shared / Math.max(wa.size, wb.length) >= 0.5;
}

// Agreement of card a with card b (b is the reference: expected labels, or Claude's card).
// Returns { field: true | false } for every field b has a value for.
export function agreement(a, b) {
  const out = {};
  const has = (k) => b && k in b;
  if (has("docType")) out.docType = docKind(a.docType) === docKind(b.docType);
  if (has("issuer")) out.issuer = sameIssuer(a.issuer, b.issuer);
  if (has("docDate")) out.docDate = String(a.docDate || "") === String(b.docDate || "");
  if (has("folder")) out.folder = a.folder === b.folder;
  if (has("verdict")) out.verdict = a.verdict === b.verdict;
  if (has("sensitive")) out.sensitive = !!a.sensitive === !!b.sensitive;
  if (has("paperless")) out.paperless = !!(a.paperless && typeof a.paperless === "object" ? a.paperless.possible : a.paperless) === !!(b.paperless && typeof b.paperless === "object" ? b.paperless.possible : b.paperless);
  if (has("filename")) {
    out.filename = String(a.filename || "") === String(b.filename || "");
    out.filenameDate = String(a.filename || "").slice(0, 10) === String(b.filename || "").slice(0, 10);
  }
  if (has("title")) out.title = sameTitle(a.title, b.title);
  return out;
}
