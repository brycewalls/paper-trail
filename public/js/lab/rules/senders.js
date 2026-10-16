// lab/rules/senders.js: who sent the document (#92). Pure, no DOM.
// In order: the person's own sender rules (#21) when their sender's name is on the page, then what
// the document type says to read (a W-2's employer box, a 1099's payer, a lease's landlord), then
// the known-sender list (known-senders.json, extensible), then the letterhead: the first lines of
// page one that read like an organization's name. Each answer carries how sure it is.
// Owner: lab (rules engine).
import KNOWN from "./known-senders.json" with { type: "json" };
import { alphaSkeleton, titleCase, findNameFuzzy } from "./text.js";

export const KNOWN_SENDERS = KNOWN.senders;
const BY_NAME = new Map(KNOWN_SENDERS.map((s) => [alphaSkeleton(s.name), s]));

// Every known sender on the page, with where it first shows up. top: in the first six lines.
export function knownSendersIn(ctx, list = KNOWN_SENDERS) {
  const found = [];
  for (const s of list) {
    let at = -1, hits = 0;
    for (const alias of [s.name, ...(s.aliases || [])]) {
      const i = findNameFuzzy(ctx, alias);
      if (i >= 0) { hits++; if (at < 0 || i < at) at = i; }
    }
    // The first six lines' skeleton is the start of the whole text's skeleton, so a position inside
    // its length is in the letterhead.
    if (at >= 0) found.push({ ...s, at, hits, top: at < ctx.head.length - 1 });
  }
  return found.sort((a, b) => a.at - b.at);
}

// A name pulled from the page, matched to a known sender when it is one ("JPMORGAN CHASE BANK NA"
// is Chase). Otherwise it is tidied: capitals to title case, trailing address and punctuation off.
// Fixes OCR digits inside a name: "R0BOTICS" -> "ROBOTICS", "Uni0n" -> "Union".
export const fixNameDigits = (s) => String(s).replace(/\b[A-Za-z0-9]+\b/g, (t) => {
  if (/^\d+(st|nd|rd|th)$/i.test(t)) return t;
  const letters = t.replace(/[^A-Za-z]/g, "").length;
  if (!letters || letters <= t.length - letters) return t;
  const up = t === t.toUpperCase();
  return t.replace(/0/g, up ? "O" : "o").replace(/1/g, up ? "I" : "l");
}).replace(/(?<=[A-Z])l(?=[A-Z])|(?<=[A-Z]{2})l\b/g, "I");

export function canonicalName(raw) {
  let s = fixNameDigits(String(raw || "").replace(/\s+/g, " ").trim());
  s = s.replace(/\s*(,|\bp\.?\s?o\.?\s?box\b|\b\d{2,6}\s+[A-Za-z].*$).*$/i, (m) => (/^,\s*(inc|llc|n\.?a\.?|pllc|ltd)\b/i.test(m) ? m : "")).trim();
  s = s.replace(/[\s,;:.-]+$/, "").replace(/^[\s,;:.-]+/, "");
  if (!s) return "";
  const folded = ` ${alphaSkeleton(s)} `;
  for (const k of KNOWN_SENDERS) {
    for (const alias of [k.name, ...(k.aliases || [])]) {
      const a = alphaSkeleton(alias);
      if (a.length >= 3 && folded.includes(` ${a} `)) return k.name;
    }
  }
  return titleCase(s).replace(/,?\s+(Inc|LLC|L\.L\.C\.|Corp|Corporation|Co|N\.A\.|NA|Ltd)\.?$/i, "").trim();
}
export const knownByName = (name) => BY_NAME.get(alphaSkeleton(name)) || null;

const ORG_WORDS = /\b(inc|llc|pllc|llp|ltd|corp|corporation|company|co\.|bank|credit union|insurance|hospital|clinic|medical|health|associates|group|partners|university|college|energy|power|electric|water|utilities|services|properties|apartments|management|department|division|county|city of|state of|court|association|pharmacy|pizzeria|restaurant|roofing|gutters|fitness|law|attorneys|realty|homes|dental|dermatology|financial|mortgage|motors|auto|center|studio|design|logistics|market|research|media|robotics|roasters|coffee|siding|windows|plumbing|hvac|landscaping|foundation|church|school|labs?|systems|solutions|technologies|telecom|wireless|communications)\b/i;
const NOT_NAME = /^(statement|your |form |page |copy |account|date|total|amount|invoice|receipt|earnings|sale|limited|now |save |call |this |the following|dear|re:|subject|important|welcome|notice|certificate|residential|settlement|membership|owner's|installation|table of|happy|patient|explanation|monthly|quarterly|billing|mortgage statement|retirement|assessment|rent receipt|member|congratulations|final|vehicle|registration|investment|power of attorney|durable|last will|affidavit|warranty deed|passport|jury|notice of|in re|pay |prepared|thank)/i;

// The letterhead: the first lines of page one that read like an organization's name.
export function letterhead(ctx, skip = () => false) {
  const lines = ctx.pages[0] ? ctx.pages[0].split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 7) : [];
  let best = null;
  lines.forEach((line, i) => {
    const part = fixNameDigits(line.split(/\s{2,}|\s\|\s/)[0].replace(/\s+/g, " "));
    const name = part.replace(/^(from|payer'?s? ?(name)?|employer'?s? name.*?code)\s*:?\s*/i, "").trim();
    if (name.length < 3 || name.length > 60) return;
    if (/\d{3,}/.test(name) || NOT_NAME.test(name) || /[:$]/.test(name)) return;
    const letters = name.replace(/[^A-Za-z]/g, "").length;
    if (letters < 3 || letters / name.length < 0.6) return;
    const canon = canonicalName(name);
    if (!canon || skip(canon)) return;
    const score = (ORG_WORDS.test(name) ? 3 : 0) + (i === 0 ? 2 : i < 3 ? 1 : 0) + (name === name.toUpperCase() ? 0.5 : 0) - (name.split(" ").length > 7 ? 2 : 0);
    if (!best || score > best.score) best = { name: canon, score, line: i };
  });
  return best && best.score >= 1.5 ? best : null;
}

// Words that start a form's label, never a name: "address", "street", "employer identification no.".
const LABEL_WORD = /^(,\s*)?(address|street|city|name|zip|employer identi|identi|tin\b|number|telephone|phone|recipient|payer|filer|student|borrower)/i;

// The value after a label on the same line, or on the next line when the label ends its line.
export function afterLabel(ctx, labelRx, { nextLines = 2 } = {}) {
  const lines = ctx.fixed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = labelRx.exec(lines[i]);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length).split(/\s{3,}/)[0].replace(/^[\s:.-]+/, "").trim();
    if (rest && /[A-Za-z]{3}/.test(rest) && !/^\d/.test(rest) && !LABEL_WORD.test(rest)) return rest;
    for (let j = 1; j <= nextLines && i + j < lines.length; j++) {
      const next = lines[i + j].split(/\s{3,}/)[0].trim();
      if (next && /[A-Za-z]{3}/.test(next) && !/^\d+\s/.test(next) && !/^[a-z]\s/i.test(next) && !LABEL_WORD.test(next)) return next;
    }
  }
  return "";
}

const US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
// The state a government document names: "STATE OF WASHINGTON", "WASHINGTON STATE ...", "North
// Carolina Division of ...". Longest names first so "West Virginia" doesn't read as "Virginia".
export function stateIn(text) {
  const t = String(text);
  for (const st of [...US_STATES].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${st.replace(/ /g, "\\s+")}\\b`, "i").test(t)) return st;
  }
  return "";
}
// A government agency named on the page, composed with its state.
const AGENCIES = [
  ["department of licensing", (st) => `${st} State Department of Licensing`],
  ["division of motor vehicles", (st) => `${st} Division of Motor Vehicles`],
  ["department of motor vehicles", (st) => `${st} Department of Motor Vehicles`],
  ["department of revenue", (st) => `${st} Department of Revenue`],
  ["department of taxation and finance", (st) => `${st} Department of Taxation and Finance`],
  ["department of taxation", (st) => `${st} Department of Taxation`],
];
export function agencyIn(ctx) {
  const head = ctx.lines.slice(0, 8).join("\n");
  for (const [phrase, make] of AGENCIES) {
    if (!ctx.has(phrase)) continue;
    const st = stateIn(head) || stateIn(ctx.fixed) || US_STATES.find((x) => x.length >= 8 && ctx.has(x)) || "";
    if (st) return make(st);
  }
  return "";
}
// A county or state that heads a vital record: "KING COUNTY", "County of Los Angeles", "STATE OF
// NORTH CAROLINA". The county wins when it is in the first three lines.
export function vitalIssuer(ctx) {
  const top = ctx.lines.slice(0, 3).join("\n").replace(/0/g, "O");
  let m = /\b(county of [a-z]+(?: [a-z]+)?)\b/i.exec(top) || /\b([a-z]+(?: [a-z]+)?) county\b/i.exec(top);
  // "State of Oregon  Multnomah County": a state name in front isn't part of the county's.
  if (m && !/^county of/i.test(m[0]) && stateIn(m[1].split(" ")[0])) m = /\b([a-z]+) county\b/i.exec(top);
  if (m) {
    const raw = m[0].replace(/\s+(registrar|recorder|clerk).*$/i, "");
    const name = titleCase(raw.toUpperCase()).replace(/^State Of /, "");
    return name.replace(/\bOf\b/g, "of").replace(/^(.*?)\s+(Registrar.*)$/, "$1");
  }
  const st = /state of ([a-z]+(?: [a-z]+)?)/i.exec(ctx.lines.slice(0, 4).join("\n"));
  if (st) {
    const name = stateIn(st[0]);
    if (name) return `State of ${name}`;
  }
  const any = stateIn(ctx.lines.slice(0, 4).join(" "));
  return any ? `State of ${any}` : "";
}
