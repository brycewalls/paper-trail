// lab/rules/engine.js: the no-AI reader's rules engine (#92). Pure ES module, no DOM, runs in the
// browser and in Node (tools/lab/eval-rules.mjs and its tests).
//
//   readByRules({ pages, pageCount, filename, senderRules, today })
//     pages        the text of each page (PDF text layer or on-device OCR)
//     pageCount    pages in the document (may be more than were read)
//     filename     the original file's name, a weak hint when the text is thin
//     senderRules  the person's sender rules (users/{uid}/senders, #21): { key, issuer, folder?,
//                  verdict?, docType?, filenamePattern? }. A rule whose sender heads the page wins
//                  the sender, and the matching rule then sets its fields exactly like Claude's
//                  reads do (applySenderRule in functions/lib.js)
//     today        Date, for "older than a year" (defaults to now)
//     hints        { docType?, docTypeConf?, issuer?, issuerConf?, issuerFrom? } from the on-device
//                  matcher (lab/match/combine.js, #102): a docType that names a row of tables.js
//                  replaces the detectors' pick, an issuer replaces the sender the rules read, and
//                  everything that depends on them (date, folder, verdict, paperless, title,
//                  filename) is worked out again from there. Sender rules still apply last
//   returns the classify card (title, docType, issuer, docDate, summary, folder, filename, verdict,
//   verdictReason, retention, sensitive, paperless {possible, issuer, how}) plus:
//     confidence   { overall, fields: {every field: 0 to 1}, sparse: false }: honest scores, so the
//                  app's "Not sure" chips (UNSURE_BELOW 0.75) light up where the rules guessed
//     alternatives { issuer, docDate, folder }: up to two other candidates each
//     appliedRule  the sender rule's key, when one applied
//     rules        how it decided: { version, detector, score, runnerUp, evidence, issuerFrom, dateFrom }
//
// The pipeline: fold the text (text.js), find known senders (senders.js), score every type detector
// (types.js), read the date, sender, amount and last 4 (fields.js), look the type up in the tables
// (tables.js), check for sensitive numbers (sensitive.js), and write the title, filename and summary
// (templates.js). Below MIN_SCORE the type is "Unknown": folder 11 Other, scan and shred, "Needs a look".
// Owner: lab (rules engine).
import { makeContext, titleCase } from "./text.js";
import { findDates, findTaxYear, findAmount, findLast4, ageDays, money } from "./fields.js";
import { knownSendersIn, canonicalName, letterhead, afterLabel, agencyIn, vitalIssuer, stateIn, knownByName } from "./senders.js";
import { scoreTypes, MIN_SCORE } from "./types.js";
import { TYPES, FOLDER_NAMES, VERDICTS, KIND_FOLDER, GOVERNMENT, PAPERLESS_HOW } from "./tables.js";
import { sensitiveSignals } from "./sensitive.js";
import { makeTitle, makeFilename, makeSummary, slug, cleanName } from "./templates.js";

export const RULES_VERSION = "lab-rules 0.1";
export const FIELDS = ["title", "docType", "issuer", "docDate", "summary", "folder", "filename", "verdict", "verdictReason", "retention", "sensitive", "paperless"];
// The fields the app's check-fields sheet scores (functions/lib.js CONFIDENCE_FIELDS).
export const CONFIDENCE_FIELDS = ["issuer", "docDate", "folder", "title", "filename", "verdict"];
const MIN_CHARS = 25;
const r2 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;

export function readByRules({ pages = [], pageCount, filename = "", senderRules = [], today = new Date(), hints = {} } = {}) {
  const ctx = makeContext(pages, { filename });
  const rules = cleanRules(senderRules);
  if (ctx.chars < MIN_CHARS) return unreadable(ctx, rules);

  const senders = knownSendersIn(ctx);
  const env = { senders, kinds: new Set(senders.map((s) => s.kind)) };
  const ranked = scoreTypes(ctx, env);
  const best = ranked[0], second = ranked[1];
  const known = best.score >= MIN_SCORE;
  const hinted = hints && typeof hints.docType === "string" && TYPES[hints.docType] ? hints.docType : "";
  const type = hinted || (known ? best.type : "Unknown");
  const row = TYPES[type];
  const typeConf = hinted ? r2(hints.docTypeConf ?? 0.8) : known ? r2((1 - Math.exp(-best.score / 6)) * Math.min(1, 0.55 + (best.score - second.score) / 10)) : 0.2;

  const date = pickDate(type, row, ctx, today);
  let who = pickIssuer(type, row, ctx, senders, rules);
  if (hints && typeof hints.issuer === "string" && hints.issuer.trim() && who.from !== "your sender rule") {
    const name = hints.issuer.trim().slice(0, 100);
    who = { name, conf: r2(hints.issuerConf ?? 0.85), from: hints.issuerFrom || "matcher", others: [who.name, ...(who.others || [])].filter((n) => n && n !== name).slice(0, 2) };
  }
  const facts = readFacts(type, row, ctx, who, date);
  const folder = pickFolder(type, row, ctx, who, facts);
  const verdict = pickVerdict(type, row, ctx, who, date, folder, facts, today);
  const signals = sensitiveSignals(ctx);
  const sensitive = signals.some((s) => s !== "medical") || row.sensitive || (signals.includes("medical") && folder.value === "05 Medical");
  const paperless = pickPaperless(type, row, ctx, who, senders);

  const f = { issuer: who.name, docDate: date.iso, year: date.year, row, ...facts };
  let card = {
    title: makeTitle(type, f).slice(0, 140),
    docType: type,
    issuer: who.name.slice(0, 100),
    docDate: date.iso,
    summary: makeSummary(type, f).slice(0, 400),
    folder: folder.value,
    filename: makeFilename(type, f),
    verdict: verdict.value,
    verdictReason: verdict.reason.slice(0, 300),
    retention: verdict.retention.slice(0, 120),
    sensitive: !!sensitive,
    paperless,
  };
  const textConf = Math.min(typeConf, who.conf, date.conf);
  const fields = {
    title: r2(Math.min(typeConf, Math.max(who.conf, 0.5), Math.max(date.conf, 0.5))),
    docType: typeConf,
    issuer: who.conf,
    docDate: date.conf,
    summary: r2(Math.min(typeConf, 0.9)),
    folder: r2(typeConf * folder.conf),
    filename: r2(textConf),
    verdict: r2(typeConf * verdict.conf),
    verdictReason: r2(typeConf * verdict.conf),
    retention: r2(typeConf * verdict.conf),
    sensitive: signals.some((s) => s !== "medical") ? 0.95 : row.sensitive ? 0.9 : r2(0.6 + 0.3 * typeConf),
    paperless: r2(Math.min(typeConf, paperless.possible ? who.conf : 0.9)),
  };
  card.confidence = { overall: overallOf(fields), fields, sparse: false };
  card.alternatives = alternativesFor(card, ranked, who, date);
  card.rules = {
    version: RULES_VERSION, detector: type, score: best.score, runnerUp: second ? `${second.type} (${second.score})` : "",
    evidence: best.evidence.slice(0, 8), issuerFrom: who.from, dateFrom: date.from, pages: ctx.pages.length, pageCount: pageCount || ctx.pages.length,
  };
  if (hinted) card.rules.typeFrom = "matcher";
  card = applySenderRule(card, rules);
  return card;
}

const overallOf = (fields) => r2(Math.min(...CONFIDENCE_FIELDS.map((k) => (k in fields ? fields[k] : 1))));

function unreadable(ctx, rules) {
  const row = TYPES.Unknown;
  const fields = Object.fromEntries(FIELDS.map((k) => [k, 0.2]));
  return {
    title: "Unreadable scan", docType: "Unknown", issuer: "", docDate: "",
    summary: "The scan didn't have enough readable text to sort.",
    folder: row.folder, filename: "0000-00-00_unreadable-scan", verdict: "scan_shred",
    verdictReason: "Needs a look: the text couldn't be read. Try a clearer scan, with the page flat and well lit.",
    retention: row.retention, sensitive: false, paperless: { possible: false, issuer: "", how: "" },
    confidence: { overall: 0.2, fields, sparse: false }, alternatives: {},
    rules: { version: RULES_VERSION, detector: "Unreadable", score: 0, runnerUp: "", evidence: [], issuerFrom: "none", dateFrom: "none", pages: ctx.pages.length, pageCount: ctx.pages.length },
  };
}

// ---------- the date ----------
const LETTERS = new Set(["Letter", "Personal letter", "Loan payoff letter", "Employment offer letter", "Credit card offer", "Preapproval"]);
const TAX_ANCHORS = ["w-2", "1099", "1098", "1095", "1040", "tax return", "tax year", "d-400", "ssa-1099", "benefits paid in", "wage and tax"];
function pickDate(type, row, ctx, today) {
  const dates = findDates(ctx, today);
  const iso = (d) => d.iso;
  if (row.date === "none") return { iso: "", conf: 0.8, from: "none for this type", others: [] };
  if (row.date === "tax") {
    const ty = findTaxYear(ctx, TAX_ANCHORS, today);
    if (ty) return { iso: `${ty.year}-12-31`, year: String(ty.year), conf: ty.near ? 0.9 : 0.75, from: "tax year", others: [] };
  }
  if (row.date === "birth") {
    const b = dates.find((d) => /birth/.test(d.negativeLabel || "")) || dates.find((d) => /born/i.test(ctx.fixed.slice(Math.max(0, d.index - 20), d.index)));
    if (b) return { iso: b.iso, conf: 0.85, from: "date of birth", others: dates.filter((d) => d !== b).map(iso) };
    const early = [...dates].sort((x, y) => x.iso.localeCompare(y.iso))[0];
    if (early) return { iso: early.iso, conf: 0.6, from: "earliest date", others: dates.filter((d) => d !== early).map(iso) };
  }
  if (row.date === "event" && dates.length) {
    const sorted = [...dates].sort((a, b) => a.iso.localeCompare(b.iso));
    return { iso: sorted[0].iso, conf: 0.8, from: "earliest date", others: sorted.slice(1).map(iso) };
  }
  const usable = dates.filter((d) => !d.negative);
  if (!usable.length) return { iso: "", conf: dates.length ? 0.4 : 0.5, from: "no document date", others: dates.map(iso) };
  const first = usable[0];
  const scored = usable.map((d) => {
    let s = d.labelScore;
    if (d.rangeEnd) s += row.statement ? (d.periodEnd ? 5 : 3) : 1;
    if (d.serviceRange) s -= 4;
    if (d.rangeStart) s -= 4;
    if (d === first && !d.labelScore) s += LETTERS.has(type) ? 6 : 3;
    if (row.statement && d.labelScore === 0 && !d.rangeEnd) s -= 1;
    return { d, s };
  }).sort((a, b) => b.s - a.s || a.d.index - b.d.index);
  const top = scored[0].d;
  const conf = top.labelScore >= 8 ? 0.92 : top.labelScore >= 5 ? 0.82 : top.rangeEnd ? 0.8 : usable.length === 1 ? 0.75 : LETTERS.has(type) && top === first ? 0.75 : 0.6;
  const from = top.label ? `labeled "${top.label}"` : top.rangeEnd ? "end of the statement period" : top === first ? "first date on the page" : "best unlabeled date";
  const others = [...new Set(scored.slice(1).map((x) => x.d.iso))].filter((x) => x !== top.iso);
  return { iso: top.iso, conf, from, others };
}

// ---------- the sender ----------
const STRATEGY = new Set(["known", "employer", "payer", "landlord", "party", "preparer", "vital", "agency", "signature", "marketplace", "administrator", "brand"]);
const NEVER_ISSUER = new Set(["payroll"]);
const tidy = (raw) => canonicalName(raw);

function pickIssuer(type, row, ctx, senders, rules) {
  // The person's sender rules come first when their sender heads the page.
  for (const r of rules) {
    if (ctx.inHead(r.issuer)) return { name: r.issuer, conf: 1, from: "your sender rule", others: [] };
  }
  const allowed = senders.filter((s) => !NEVER_ISSUER.has(s.kind) && !(s.kind === "gov_tax" && !/^(Tax notice|Federal tax return)$/.test(type)) && s.kind !== "marketplace");
  const knownPick = () => {
    const top = allowed.find((s) => s.top);
    if (top) return { name: top.name, conf: 0.92, from: "known sender, letterhead" };
    const head = letterhead(ctx, (n) => !!knownByName(n) && NEVER_ISSUER.has(knownByName(n).kind));
    if (head && head.score >= 3) return { name: head.name, conf: 0.75, from: "letterhead" };
    if (allowed.length) return { name: allowed[0].name, conf: 0.72, from: "known sender, in the text" };
    if (head) return { name: head.name, conf: 0.6, from: "letterhead" };
    return null;
  };
  const strategy = STRATEGY.has(row.issuer) ? row.issuer : "fixed";
  let pick = null;
  const field = (rx, conf, from) => { const v = afterLabel(ctx, rx); const name = v ? tidy(v) : ""; return name && !isPayroll(name) ? { name, conf: knownByName(name) ? 0.95 : conf, from } : null; };
  switch (strategy) {
    case "fixed": pick = { name: row.issuer, conf: 0.95, from: "the document type" }; break;
    case "employer":
      pick = field(/(e(m|rn)ployer'?s name(,? address,? and zip code)?|name of e(m|rn)ployer)\s*:?/i, 0.85, "employer box")
        || letterheadPick(ctx) || knownPick();
      break;
    case "payer":
      pick = knownPick();
      if (!pick || !pick.from.startsWith("known")) pick = field(/(payer'?s?|filer'?s|(recipient'?s\/)?lender'?s|issuer or other coverage provider)\s*:?\s*(na(me|rne))?(,?\s*street address)?(,?\s*city( or town)?)?(,?\s*state.*?)?\s*:?/i, 0.85, "payer box") || pick;
      break;
    case "landlord": {
      const m = /between\s+(.+?)\s*\(\s*["“]?landlord/i.exec(ctx.fixed) || /landlord\s*:\s*([^\n]+)/i.exec(ctx.fixed);
      pick = m ? { name: tidy(m[1]), conf: 0.85, from: "landlord" } : knownPick();
      break;
    }
    case "party": {
      const m = /by and between\s+(.+?)\s*(\(|,?\s+and\s)/i.exec(ctx.fixed.replace(/\s+/g, " "));
      pick = m ? { name: tidy(m[1]), conf: 0.8, from: "first party" } : knownPick();
      break;
    }
    case "preparer": {
      const m = /prepared by:?\s*([^\n]+)/i.exec(ctx.fixed);
      pick = m ? { name: tidy(m[1]), conf: 0.75, from: "prepared by" } : knownPick() || { name: "", conf: 0.6, from: "none" };
      break;
    }
    case "vital": { const v = vitalIssuer(ctx); pick = v ? { name: v, conf: 0.8, from: "county or state" } : null; break; }
    case "agency": { const a = agencyIn(ctx); pick = a ? { name: a, conf: 0.85, from: "agency" } : knownPick(); break; }
    case "marketplace": {
      const m = senders.find((s) => s.kind === "marketplace");
      pick = m ? { name: m.name, conf: 0.9, from: "known marketplace" } : { name: "Health Insurance Marketplace", conf: 0.7, from: "the document type" };
      break;
    }
    case "administrator":
      pick = field(/settlement administrator\s*:?/i, 0.85, "settlement administrator") || knownPick();
      break;
    case "brand": {
      // Manuals and warranties name the brand right before the product: "Whirlpool Refrigerator".
      const m = new RegExp(`\\b([A-Z][A-Za-z&]+(?: [A-Z][A-Za-z&]+)?)\\s+(?:${PRODUCTS})\\b`, "i").exec(ctx.fixed);
      const name = m && !/^(the|your|this|our|owner|using|limited)$/i.test(m[1]) ? tidy(m[1]) : "";
      pick = name ? { name, conf: 0.7, from: "brand before the product" } : knownPick();
      break;
    }
    case "signature": {
      const m = /(?:^|\n)\s*(?:love(?: always)?|with love|hugs|warmly|xoxo),?\s*\n\s*([^\n]{2,40})/i.exec(ctx.fixed) || /\b[Ll]ove,\s+([A-Z][^\n]{1,40})/.exec(ctx.fixed);
      pick = m ? { name: m[1].trim().replace(/[.,!]+$/, ""), conf: 0.7, from: "signature" } : { name: "", conf: 0.5, from: "none" };
      break;
    }
    default: pick = knownPick();
  }
  // An unknown document's letterhead is only trusted when it reads like an organization.
  if (type === "Unknown" && pick && pick.from === "letterhead" && pick.conf < 0.75) pick = null;
  if (!pick) pick = { name: "", conf: type === "Unknown" ? 0.5 : 0.3, from: "none" };
  const others = [...new Set([...allowed.map((s) => s.name), letterhead(ctx)?.name].filter((n) => n && n !== pick.name))].slice(0, 2);
  return { ...pick, conf: r2(pick.conf), others };
}
const PRODUCTS = "refrigerator|dishwasher|washer|dryer|oven|range|microwave|vacuum|television|tv|router|printer|camera|laptop|blender|air purifier|thermostat|water heater|furnace|lawn mower|grill|stand mixer|coffee maker";
const isPayroll = (name) => { const k = knownByName(name); return !!k && NEVER_ISSUER.has(k.kind); };
const letterheadPick = (ctx) => { const h = letterhead(ctx, isPayroll); return h && h.score >= 3 ? { name: h.name, conf: 0.75, from: "letterhead" } : null; };

// ---------- amounts, last 4 and the little facts the templates use ----------
const AMOUNTS = {
  "W-2": [["wages, tips, other compensation", "wages, tips, other cornpensation", "1 wages"], "wages"],
  "1099-INT": [["interest income", "lnterest income"], "interest"],
  "1099-DIV": [["total ordinary dividends"], "dividends"],
  "1099-NEC": [["nonemployee compensation"], "compensation"],
  "1099-MISC": [["other income", "rents", "royalties"], "income"],
  "1099-R": [["gross distribution"], "gross distribution"],
  "1098": [["mortgage interest received"], "mortgage interest"],
  "1098-T": [["payments received for qualified tuition"], "tuition paid"],
  "1098-E": [["student loan interest received"], "interest"],
  "Pay stub": [["net pay"], "net pay"],
  "Explanation of benefits": [["your share", "what you owe", "you may owe", "patient responsibility"], "your share"],
  "Bank statement": [["ending balance"], "ending balance"],
  "Brokerage statement": [["ending account value", "account value"], "account value"],
  "Retirement account statement": [["ending balance"], "ending balance"],
  "Receipt": [["total", "amount"], "total"],
  "Pharmacy receipt": [["copay", "total"], "you paid"],
  "Invoice": [["total", "amount due"], "total"],
};
const DUE = [["total amount due", "amount due", "arnount due", "total due", "new balance", "balance due", "current amount due", "amount due:"], "due"];
function readFacts(type, row, ctx, who, date) {
  const out = {};
  const spec = AMOUNTS[type] || (row.statement || ["Medical bill", "Tax notice", "Property tax bill", "Credit card statement"].includes(type) ? DUE : null);
  if (spec) {
    const a = findAmount(ctx, spec[0]);
    if (a) { out.amount = a.text; out.amountValue = a.value; out.amountLabel = spec[1]; }
  }
  if (row.statement || ["Medical bill", "Loan payoff letter"].includes(type)) out.last4 = findLast4(ctx);
  if (type === "Utility bill") {
    const water = /water|sewer|stormwater/.test(ctx.low), kwh = /\bkwh\b|kilowatt|electric/.test(ctx.low), gas = /therm|natural gas|gas service/.test(ctx.low.replace(/natura1/g, "natural"));
    out.utility = water && !kwh ? "water" : kwh && gas ? "gas-and-electric" : kwh ? "electric" : gas ? "gas" : "";
  }
  if (type === "Bank statement") out.account = /\bchecking\b/.test(ctx.low) ? "checking" : /\bsavings\b/.test(ctx.low) ? "savings" : "";
  if (type === "Loan statement") out.loanKind = /student/.test(ctx.low) ? "student" : AUTO_RX.test(ctx.low) ? "auto" : "";
  if (type === "State tax return") out.state = stateIn(who.name);
  if (type === "Utility bill" && out.utility === "gas-and-electric") out.utility = "energy";
  return out;
}
const AUTO_RX = /\b(vehicle|vin|honda|toyota|ford|subaru|nissan|chevrolet|hyundai|kia|mazda|tesla|civic|rav4|camry|corolla|accord|f-150|mileage|odometer|oil change|tire|brake)\b/;
const DURABLE_RX = /\b(tv|television|qled|oled|washer|dryer|refrigerator|fridge|dishwasher|laptop|macbook|iphone|ipad|computer|monitor|appliance|sofa|couch|mattress|furniture|vacuum|camera|protection plan|warranty|geek squad)\b/;
const HOME_SERVICE_RX = /\b(roof|roofing|gutter|plumb|hvac|furnace|electrician|landscap|lawn|pest|contractor|remodel|siding|window install|carpet|paint)/;
const MEDICAL_RX = /\b(patient|medical|clinic|dental|pharmacy|rx)\b/;

// ---------- folder ----------
function pickFolder(type, row, ctx, who, facts) {
  const kind = knownByName(who.name)?.kind;
  const low = ctx.low;
  const guess = (value) => ({ value, conf: 0.85 });
  switch (type) {
    case "Letter":
      if (kind && KIND_FOLDER[kind]) return { value: KIND_FOLDER[kind], conf: 0.85 };
      if (/court|county|city of|state of|department|attorney|law/i.test(who.name) || /summons|court/.test(low)) return guess("01 Identity & Legal");
      if (/employ|human resources|payroll/.test(low)) return guess("08 Work & Income");
      return { value: row.folder, conf: 0.7 };
    case "Receipt":
      if (/\brent\b/.test(low)) return guess("06 Home");
      if (MEDICAL_RX.test(low)) return guess("05 Medical");
      if (DURABLE_RX.test(low) || (facts.amountValue || 0) >= 500) return guess("09 Warranties & Manuals");
      return { value: row.folder, conf: 0.8 };
    case "Invoice":
      if (HOME_SERVICE_RX.test(low)) return guess("06 Home");
      if (AUTO_RX.test(low)) return guess("07 Auto");
      if (MEDICAL_RX.test(low)) return guess("05 Medical");
      return { value: row.folder, conf: 0.7 };
    case "Loan statement": case "Loan payoff letter":
      if (kind === "auto_lender" || AUTO_RX.test(low)) return { value: "07 Auto", conf: 0.9 };
      if (kind === "mortgage" || /mortgage/.test(low)) return { value: "06 Home", conf: 0.9 };
      return { value: row.folder, conf: 0.85 };
    default:
      return { value: row.folder, conf: 1 };
  }
}

// ---------- verdict and retention ----------
function pickVerdict(type, row, ctx, who, date, folder, facts, today) {
  if (row.statement && date.iso) {
    const age = ageDays(date.iso, today);
    if (age > 365) return { value: "shred", retention: "Not needed", reason: `${who.name || "The sender"} keeps past statements online, and this one is more than a year old.`, conf: date.conf >= 0.75 ? 0.9 : 0.7 };
    return { value: row.verdict, retention: row.retention, reason: row.reason, conf: date.conf >= 0.75 ? 0.9 : 0.7 };
  }
  if (type === "Letter" && (ctx.has("no action is needed") || ctx.has("no action is required") || ctx.has("no action needed"))) return { value: "shred", retention: "Not needed", reason: "An account notice with no action needed, so nothing on it is worth keeping.", conf: 0.75 };
  if (type === "Receipt" && folder.value === "03 Money & Banking" && (facts.amountValue || 0) < 75) return { value: "shred", retention: "Not needed", reason: "A small everyday receipt with nothing worth keeping.", conf: 0.75 };
  return { value: row.verdict, retention: row.retention, reason: row.reason, conf: type === "Unknown" ? 0.5 : 0.95 };
}

// ---------- paperless ----------
const RECURRING_KINDS = new Set(["bank", "card", "brokerage", "retirement", "utility", "mobile", "isp", "insurer", "health_insurer", "loan", "auto_lender", "mortgage", "medical"]);
function pickPaperless(type, row, ctx, who, senders) {
  const none = { possible: false, issuer: "", how: "" };
  if (!who.name) return none;
  const known = knownByName(who.name);
  const kind = known?.kind;
  if (kind && GOVERNMENT.has(kind)) return none;
  if (/department|county|state of|court|division of|city of/i.test(who.name) && !/utilities|light|water/i.test(who.name)) return none;
  const recurring = row.recurring || (type === "Letter" && RECURRING_KINDS.has(kind));
  if (!recurring) return none;
  const payroll = senders.find((s) => s.kind === "payroll");
  let how;
  if (type === "Credit card offer" || type === "Preapproval") how = PAPERLESS_HOW.offer();
  else if (["W-2", "1095-C", "Pay stub"].includes(type)) how = PAPERLESS_HOW.employer(who.name, payroll && payroll.name, { "W-2": "W-2s", "1095-C": "tax forms", "Pay stub": "pay stubs" }[type]);
  else if (type === "1098-T") how = PAPERLESS_HOW.school(who.name);
  else if (known && known.paperless) how = known.paperless;
  else if (kind && PAPERLESS_HOW[kind]) how = PAPERLESS_HOW[kind](who.name);
  else if (type === "Medical bill") how = PAPERLESS_HOW.medical(who.name);
  else how = PAPERLESS_HOW.default(who.name);
  return { possible: true, issuer: who.name.slice(0, 100), how: how.slice(0, 300) };
}

// ---------- alternatives ----------
function alternativesFor(card, ranked, who, date) {
  const out = {};
  if (who.others && who.others.length) out.issuer = who.others.slice(0, 2);
  const d = (date.others || []).filter((x) => x && x !== card.docDate).slice(0, 2);
  if (d.length) out.docDate = d;
  const folders = [];
  for (const r of ranked.slice(1, 4)) {
    if (r.score < MIN_SCORE) break;
    const f = TYPES[r.type]?.folder;
    if (f && f !== card.folder && !folders.includes(f)) folders.push(f);
  }
  if (folders.length) out.folder = folders.slice(0, 2);
  return out;
}

// ---------- sender rules (#21), the same semantics as functions/lib.js ----------
export function cleanRules(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const h of list.slice(0, 200)) {
    if (!h || typeof h !== "object") continue;
    const issuer = String(h.issuer || "").trim().slice(0, 100);
    const key = slug(h.key || issuer);
    if (!issuer || key === "unknown") continue;
    const rule = { key, issuer };
    if (FOLDER_NAMES.includes(h.folder)) rule.folder = h.folder;
    if (VERDICTS.includes(h.verdict)) rule.verdict = h.verdict;
    if (typeof h.docType === "string" && h.docType.trim()) rule.docType = h.docType.trim().slice(0, 80);
    if (typeof h.filenamePattern === "string" && h.filenamePattern.trim()) rule.filenamePattern = h.filenamePattern.trim().slice(0, 120);
    out.push(rule);
  }
  return out;
}
export function renderFilename(pattern, card) {
  const date = card.docDate || "0000-00-00";
  const out = String(pattern)
    .replace(/\{date\}/g, date).replace(/\{yyyy\}/g, date.slice(0, 4)).replace(/\{mm\}/g, date.slice(5, 7))
    .replace(/\{issuer\}/g, slug(card.issuer)).replace(/\{type\}/g, slug(card.docType));
  return cleanName(out).slice(0, 120);
}
export function applySenderRule(card, rules) {
  const key = slug(card.issuer);
  const rule = key === "unknown" ? null : (rules || []).find((r) => r.key === key);
  if (!rule) return card;
  const out = { ...card, issuer: rule.issuer, appliedRule: rule.key };
  const set = ["issuer"];
  if (rule.folder) { out.folder = rule.folder; set.push("folder"); }
  if (rule.verdict) { out.verdict = rule.verdict; set.push("verdict"); }
  if (rule.docType) out.docType = rule.docType;
  if (rule.filenamePattern) { const name = renderFilename(rule.filenamePattern, out); if (name) { out.filename = name; set.push("filename"); } }
  if (out.paperless && slug(out.paperless.issuer) === rule.key) out.paperless = { ...out.paperless, issuer: rule.issuer };
  if (out.confidence) {
    const fields = { ...out.confidence.fields };
    for (const f of set) fields[f] = 1;
    out.confidence = { ...out.confidence, fields, overall: overallOf(fields) };
  }
  if (out.alternatives) { out.alternatives = { ...out.alternatives }; for (const f of set) delete out.alternatives[f]; }
  return out;
}

export { money, titleCase };
