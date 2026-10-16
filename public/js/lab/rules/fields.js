// lab/rules/fields.js: dates, tax years, amounts and last-4 numbers out of document text (#92).
// Pure, no DOM. Every finder reads ctx.fixed (the text with digit-looking letters fixed) and
// returns what it found with where it found it, so the engine can weigh one candidate against another.
// Owner: lab (rules engine).

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Month words as OCR leaves them: "Septernber", "Novernber", "Decernber", "0ct".
const MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember|ernber)?)?|[o0]ct(?:ober)?|nov(?:ember|ernber)?|dec(?:ember|ernber)?)";
const monthIndex = (w) => {
  const m = w.toLowerCase().replace(/^0/, "o").replace("rn", "m").slice(0, 3);
  return MONTHS.findIndex((x) => x.startsWith(m));
};

// The month a misspelled word most likely is: one letter off a month's name (two for long ones).
function fuzzyMonth(word) {
  const w = word.toLowerCase();
  for (let i = 0; i < 12; i++) {
    const m = MONTHS[i];
    if (w[0] !== m[0]) continue;
    if (editDistance(w, m) <= (m.length >= 7 ? 2 : 1)) return i;
    if (w.length <= 4 && editDistance(w, m.slice(0, 3)) <= 1 && w.length >= 3 && editDistance(w, m.slice(0, w.length)) <= 1) return i;
  }
  return -1;
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const pad = (n) => String(n).padStart(2, "0");
function valid(y, m, d, today) {
  if (!(y >= 1900 && y <= today.getFullYear() + 2 && m >= 1 && m <= 12 && d >= 1)) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}
const fullYear = (yy, today) => {
  const n = Number(yy);
  if (yy.length === 4) return n;
  const cut = (today.getFullYear() % 100) + 1;
  return n <= cut ? 2000 + n : 1900 + n;
};

// Labels that name the document's own date, strongest first, and labels for dates that are not it.
export const DATE_LABELS = [
  ["statement closing date", 10], ["closing date", 9], ["statement date", 10], ["date of statement", 10], ["bill date", 10], ["billing date", 10],
  ["invoice date", 10], ["notice date", 10], ["date of this notice", 10], ["date of notice", 10], ["date issued", 9], ["issue date", 9], ["date of issue", 9],
  ["date lssued", 9], ["issued", 7], ["pay date", 10], ["check date", 10], ["date mailed", 9], ["policy date", 9], ["agreement date", 9],
  ["registration date", 8], ["date of purchase", 8], ["purchase date", 8], ["reported", 6], ["period ending", 8], ["statement period ending", 9],
  ["effective", 5], ["dated", 7], ["recorded", 2], ["sale", 4], ["date", 3], ["signed", 6], ["entered into as of", 8],
  ["subscribed and sworn to before me on", 8], ["sworn to and subscribed before me", 6], ["made on", 7],
];
export const NOT_DOC_DATE = [
  "due date", "payment due", "due by", "pay by", "please pay by", "due", "respond by", "apply by", "expires", "expiration", "date of expiration",
  "date of birth", "dob", "origination date", "customer since", "commission expires", "claim deadline", "offer expires", "coupon expires",
  "next closing date", "service date", "date of service", "expiration date", "collected", "return and exchange period ends", "valid",
  "payment due date", "period beginning", "beginning", "begins", "ends",
];

// Every date in the text: { iso, index, end, label, labelScore, negative, rangeStart, rangeEnd }.
export function findDates(ctx, today = new Date()) {
  const text = ctx.fixed;
  const found = [];
  const add = (y, m, d, index, end) => {
    if (!valid(y, m, d, today)) return;
    if (found.some((f) => index < f.end && end > f.index)) return;
    found.push({ iso: `${y}-${pad(m)}-${pad(d)}`, y, m, d, index, end });
  };
  let r;
  // "the 22nd day of June, 2019", "this 3rd day of October, 2022"
  const dayOf = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+day\\s+of\\s+${MONTH_RX}\\.?,?\\s+(\\d{4})`, "gi");
  while ((r = dayOf.exec(text))) add(Number(r[3]), monthIndex(r[2]) + 1, Number(r[1]), r.index, r.index + r[0].length);
  // "March 12, 2024", "Mar 12 2024", "Sep 20, 2026"
  const mdy = new RegExp(`\\b${MONTH_RX}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, "gi");
  while ((r = mdy.exec(text))) add(Number(r[3]), monthIndex(r[1]) + 1, Number(r[2]), r.index, r.index + r[0].length);
  // A month OCR misspelled by a letter: "Januay 2, 2026", "Apil 2, 2026", "Jue 30, 2026".
  const loose = /\b([A-Za-z]{3,10})\.?\s*(\d{1,2}),?\s*(\d{4})\b/g;
  while ((r = loose.exec(text))) { const m = fuzzyMonth(r[1]); if (m >= 0) add(Number(r[3]), m + 1, Number(r[2]), r.index, r.index + r[0].length); }
  // "05 Apr 2021", "12 March 2024"
  const dmy = new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RX}\\.?,?\\s+(\\d{4})\\b`, "gi");
  while ((r = dmy.exec(text))) add(Number(r[3]), monthIndex(r[2]) + 1, Number(r[1]), r.index, r.index + r[0].length);
  // "2024-03-12"
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((r = iso.exec(text))) add(Number(r[1]), Number(r[2]), Number(r[3]), r.index, r.index + r[0].length);
  // "03/12/2024", "3/12/24", "06/24/26"
  const num = /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/])/g;
  while ((r = num.exec(text))) add(fullYear(r[3], today), Number(r[1]), Number(r[2]), r.index, r.index + r[0].length);
  found.sort((a, b) => a.index - b.index);
  // Ranges: "Jul 29 - Aug 28, 2026" has only its end parsed; "07/01/2026 - 07/31/2026", "April 1,
  // 2025 - June 30, 2025", "05/01/2026 through 05/31/2026" mark both ends.
  for (let i = 0; i + 1 < found.length; i++) {
    const between = text.slice(found[i].end, found[i + 1].index);
    if (/^\s*(-|–|to|through|thru)\s*$/i.test(between)) { found[i].rangeStart = true; found[i + 1].rangeEnd = true; }
  }
  // A range whose start had no year ("Jul 29 - Aug 28, 2026", "Feb 9 - Mar 10, 2024").
  for (const f of found) {
    const before = text.slice(Math.max(0, f.index - 16), f.index);
    if (new RegExp(`${MONTH_RX}\\.?\\s+\\d{1,2}\\s*(-|–|to|through)\\s*$`, "i").test(before)) f.rangeEnd = true;
  }
  for (const f of found) labelDate(text, f);
  return found;
}

// Labels and the text before a date are compared with the usual OCR slips folded the same way
// ("Staternent Date", "Date lssued", "0ct").
const foldLabel = (s) => s.toLowerCase().replace(/\s+/g, " ").replace(/rn/g, "m").replace(/(?<=[a-z])0|0(?=[a-z])/g, "o").replace(/(?<=[a-z])1|1(?=[a-z])/g, "l").replace(/[l|]/g, "i").replace(/[aeoc]/g, "a");

function labelDate(text, f) {
  const lineStart = text.lastIndexOf("\n", f.index - 1) + 1;
  let before = text.slice(lineStart, f.index).toLowerCase();
  // A date on its own line takes the label from the end of the line above.
  // Not when that line ends in a value of its own ("Offer expires 09/15/2026").
  if (!before.trim() && lineStart > 0) {
    const prevStart = text.lastIndexOf("\n", lineStart - 2) + 1;
    const prev = text.slice(prevStart, lineStart - 1).toLowerCase();
    if (/[a-z:]\s*$/.test(prev)) before = prev;
  }
  // Only the words just before the date count: "Billing Cycle Jul 29 - Aug 28, 2026" is a cycle, and
  // a label three columns back on the same line belongs to another value.
  // Labels are read with the usual OCR slips folded ("Staternent Date", "Date lssued", "0ct").
  const near = foldLabel(before.slice(-42));
  const rangeLead = f.rangeEnd ? text.slice(Math.max(lineStart, f.index - 40), f.index).toLowerCase() : "";
  f.label = ""; f.labelScore = 0; f.negative = false;
  let bestPos = -1;
  for (const [raw, score] of DATE_LABELS) {
    const label = foldLabel(raw);
    const at = near.lastIndexOf(label);
    if (at < 0) continue;
    // The label nearest the date wins; at the same spot the longer label wins.
    if (at + label.length > bestPos || (at + label.length === bestPos && score > f.labelScore)) { bestPos = at + label.length; f.label = raw; f.labelScore = score; }
  }
  for (const raw of NOT_DOC_DATE) {
    const label = foldLabel(raw);
    const at = near.lastIndexOf(label);
    if (at >= 0 && at + label.length >= bestPos) { f.negative = true; f.negativeLabel = raw; bestPos = at + label.length; f.labelScore = 0; f.label = ""; }
  }
  if (rangeLead && /(service|billing|pay|cycle|from)/.test(rangeLead) && !/statement/.test(rangeLead)) f.serviceRange = true;
  if (/period/.test(near) && f.rangeEnd) f.periodEnd = true;
}

// The tax year a form is for: a four-digit year near the form's name, not part of a date, an amount
// or a number. Returns { year, near } or null.
export function findTaxYear(ctx, anchors = [], today = new Date()) {
  const text = ctx.fixed;
  const dates = findDates(ctx, today);
  const max = today.getFullYear() + 1;
  const years = [];
  const rx = /(?<![\d,.$/\-#*])(19\d{2}|20\d{2})(?![\d,%/]|\.\d)/g;
  let r;
  while ((r = rx.exec(text))) {
    const y = Number(r[1]);
    if (y < 1990 || y > max) continue;
    if (dates.some((d) => r.index >= d.index && r.index < d.end)) continue;
    const before = text.slice(Math.max(0, r.index - 24), r.index).toLowerCase();
    if (/(no\.?|number|#|box|suite|ste|po box|p\.o\. box|account|claim|case|license|loan)\s*$/.test(before)) continue;
    const after = text.slice(r.index + 4, r.index + 12);
    if (/^\s*\d{3,}/.test(after) || /^-\d/.test(after)) continue;
    years.push({ year: y, index: r.index });
  }
  if (!years.length) return null;
  const lowText = text.toLowerCase();
  const anchorAt = anchors.map((a) => lowText.indexOf(a.toLowerCase())).filter((i) => i >= 0);
  const scored = years.map((y) => {
    const dist = anchorAt.length ? Math.min(...anchorAt.map((a) => Math.abs(a - y.index))) : 500;
    const near = /tax year|for calendar year|benefits paid in|tax return|year/i.test(text.slice(Math.max(0, y.index - 30), y.index));
    return { ...y, score: (near ? 3 : 0) + (dist < 40 ? 3 : dist < 120 ? 2 : dist < 300 ? 1 : 0) + years.filter((o) => o.year === y.year).length * 0.5 };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return { year: scored[0].year, near: scored[0].score >= 3 };
}

const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})(?!\d)/g;
const toNumber = (s) => Number(String(s).replace(/[$,\s]/g, ""));
// The first money amount after one of the labels, within a short reach. Returns { value, text } or null.
export function findAmount(ctx, labels, reach = 140) {
  const text = ctx.fixed;
  const low = text.toLowerCase();
  for (const label of labels) {
    let from = 0, at;
    while ((at = low.indexOf(label, from)) >= 0) {
      from = at + label.length;
      const tail = text.slice(from, from + reach);
      MONEY.lastIndex = 0;
      const m = MONEY.exec(tail);
      if (m) {
        const pre = tail.slice(Math.max(0, m.index - 3), m.index);
        if (/[\d/-]$/.test(pre)) continue;
        const value = toNumber(m[1]);
        if (value > 0) return { value, text: money(value) };
      }
    }
  }
  return null;
}
export const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The largest amount labeled as a total on a receipt or invoice.
export function findTotal(ctx) {
  return findAmount(ctx, ["total amount due", "amount due", "total due", "balance due", "new balance", "total", "amount:"]);
}

// Last four digits of the account, card, loan or policy number: "ending in 7713", "****8830",
// "XXXXXX5521", or the tail of a full number. Never returns a full number.
export function findLast4(ctx) {
  const text = ctx.fixed;
  const rxs = [
    /(?:account|acct|card|loan|policy)[^\n]{0,24}?ending(?:\s+in)?:?\s*(?:\d-)?(\d{4,5})\b/i,
    /ending(?:\s+in)?:?\s*(\d{4})\b/i,
    /(?:account|acct|card|loan|member|policy)[^\n]{0,24}?[*xX•]{2,}[\s-]*(\d{4})\b/i,
    /(?:account|acct|loan)\s*(?:number|no\.?|#)?:?\s*([\d][\d -]{6,}\d)\b/i,
    /[*xX•]{4,}[\s-]*(\d{4})\b/,
  ];
  for (const rx of rxs) {
    const m = rx.exec(text);
    if (m) { const d = m[1].replace(/\D/g, ""); if (d.length >= 4) return d.slice(-4); }
  }
  return "";
}

export const monthYear = (iso) => (iso ? `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");
export const longDate = (iso) => (iso ? `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}` : "");
export function ageDays(iso, today = new Date()) {
  if (!iso) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((t - Date.parse(`${iso}T00:00:00Z`)) / 86400000);
}
