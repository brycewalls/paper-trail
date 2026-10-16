// lab/rules/sensitive.js: does the page show something that makes it sensitive (#92). Pure, no DOM.
// The classify prompt's rule: true when it shows a full SSN, a full account number, or medical
// details. Masked numbers ("XXX-XX-1234", "****8830", "ending in 4411") don't count.
// Owner: lab (rules engine).

const SSN = /(?<![\d-])(\d{3})[- ](\d{2})[- ](\d{4})(?![\d-])/;
const SSN_LABELED = /(ssn|social security (number|no\.?)|taxpayer identification|tin)\D{0,24}(?<![\d])\d{9}(?!\d)/i;
// A labeled account, card, loan or member number printed in full: 8 or more digits, no mask.
// Policy and claim numbers are left out: they identify a policy, not money that can be moved.
const ACCOUNT = /\b(account|acct|card|loan|member)\s*(number|no\.?|#|num)?\s*:?\s*([\d][\d -]{6,}[\d*xX•]+)/gi;
const ROUTING = /routing\s*(number|no\.?|#)?\s*:?\s*\d{9}\b|⑆\d{9}⑆/i;
const MEDICAL = /\b(diagnosis|diagnoses|icd-?10|cpt|prescription|rx ?#|patient|procedure|treatment|lab results?|reference range|medication)\b/i;

export function sensitiveSignals(ctx) {
  const t = ctx.fixed;
  const out = [];
  if (SSN.test(t) || SSN_LABELED.test(t)) out.push("ssn");
  ACCOUNT.lastIndex = 0;
  let m;
  while ((m = ACCOUNT.exec(t))) {
    const num = m[3].trim();
    if (/[*xX•]/.test(num)) continue;
    if (num.replace(/\D/g, "").length >= 8) { out.push("account"); break; }
  }
  if (ROUTING.test(t)) out.push("routing");
  if (MEDICAL.test(t)) out.push("medical");
  return out;
}
