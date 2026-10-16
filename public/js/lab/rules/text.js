// lab/rules/text.js: text matching for the no-AI rules engine (#92). Pure, no DOM, runs in Node.
// OCR text is messy ("Staternent", "0MB No.", "W -2", words split across lines), so phrases are
// matched against a skeleton of the text where the usual OCR confusions fold together:
//   alpha skeleton  lowercase, 0 -> o, 1 -> i, 5 -> s inside words, l | ! -> i, rn -> m, vv -> w,
//                   every run of punctuation and whitespace -> one space
//   digit skeleton  for codes like "1545-0008": o -> 0, l i | -> 1, and the same space folding
//   squashed        the alpha skeleton with no spaces, for words OCR ran together
// A phrase is folded the same way before it is looked for, so "wage and tax statement" finds
// "Wage and Tax Staternent". When the exact fold misses, a small edit-distance search over word
// windows catches what's left ("Statemcnt"), for phrases long enough to make that safe.
// Owner: lab (rules engine).

const WORD = /[a-z0-9]+/g;

// Letters that OCR swaps with digits, fixed only inside tokens that are mostly letters.
function fixWordDigits(tok) {
  let letters = 0, digits = 0;
  for (const ch of tok) { if (ch >= "0" && ch <= "9") digits++; else letters++; }
  if (!letters || digits > letters) return tok;
  return tok.replace(/0/g, "o").replace(/1/g, "i").replace(/5/g, "s");
}

export function alphaSkeleton(s) {
  const low = String(s || "").toLowerCase().replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/[|!]/g, "l");
  return low.replace(WORD, fixWordDigits)
    .replace(/l/g, "i").replace(/rn/g, "m").replace(/vv/g, "w")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function digitSkeleton(s) {
  return String(s || "").toLowerCase().replace(/[o]/g, "0").replace(/[li|!]/g, "1").replace(/[^a-z0-9]+/g, " ").trim();
}

// Edit distance with an early exit once every cell in a row is over max.
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

// Title case for names that arrive in capitals ("NORTHWIND LOGISTICS INC" -> "Northwind Logistics
// Inc"). Short all-capital words that read as acronyms (LLC, PLLC, CU, NA) stay as they are.
const KEEP_UPPER = new Set(["LLC", "PLLC", "LLP", "PC", "PA", "CU", "FCU", "NA", "USA", "US", "IRS", "DMV", "HOA", "II", "III", "IV", "ADP", "TD", "PNC", "USAA", "BMW", "AT&T", "GEICO", "CVS", "UPS", "MOHELA", "PG&E", "PSE", "NV", "NY", "NC", "SC", "WA", "OR", "CA", "TX", "FL", "GA", "VA"]);
const SMALL = new Set(["of", "and", "the", "for", "at", "in", "on", "by", "de", "&"]);
export function titleCase(s) {
  const str = String(s || "").replace(/\s+/g, " ").trim();
  if (!str) return "";
  const letters = str.replace(/[^A-Za-z]/g, "");
  const upper = letters && letters === letters.toUpperCase();
  if (!upper) return str;
  return str.split(" ").map((w, i) => {
    const bare = w.replace(/[^A-Za-z&.']/g, "");
    if (KEEP_UPPER.has(bare.replace(/\./g, ""))) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.replace(/(^|[-'(/])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join(" ");
}

// Fixes letters OCR put in place of digits inside a number ("1545-0OO8", "Septernber" is not a
// number and is left alone).
export const fixNumberish = (s) => String(s).replace(/(?<=\d)[oO](?=[\d,.])|(?<=[\d,.])[oO](?=\d)/g, "0").replace(/(?<=\d)[lI|](?=\d)/g, "1");

// The context every detector reads. pages: text per page.
export function makeContext(pages, { filename = "" } = {}) {
  const list = (Array.isArray(pages) ? pages : [pages]).map((p) => String(p || ""));
  const raw = list.join("\n\n");
  const fixed = fixNumberish(raw);
  const lines = fixed.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const alpha = ` ${alphaSkeleton(fixed)} `;
  const digit = ` ${digitSkeleton(fixed)} `;
  const squashed = alpha.replace(/ /g, "");
  const tokens = alpha.trim().split(" ").filter(Boolean);
  const head = ` ${alphaSkeleton(lines.slice(0, 6).join("\n"))} `;
  const cache = new Map();
  const low = ` ${fixed.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const ctx = {
    pages: list, raw, fixed, lines, alpha, digit, squashed, tokens, head, low,
    filename: String(filename || ""),
    chars: raw.replace(/\s+/g, "").length,
    // 1 for an exact (folded) match, 0.8 for a near one, 0 for none.
    has(phrase) {
      if (cache.has(phrase)) return cache.get(phrase);
      const v = match(ctx, phrase);
      cache.set(phrase, v);
      return v;
    },
    // A regular expression against the lowercased text (punctuation kept, single spaces).
    re(rx) { return rx.test(ctx.low); },
    // Where a phrase first appears in the alpha skeleton, or -1.
    indexOf(phrase) { return ctx.alpha.indexOf(` ${alphaSkeleton(phrase)} `); },
    inHead(phrase) { return ctx.head.includes(` ${alphaSkeleton(phrase)} `); },
  };
  return ctx;
}

function match(ctx, phrase) {
  const p = String(phrase);
  if (/^[\d\s.\-()/#]+$/.test(p)) {
    const d = ` ${digitSkeleton(p)} `;
    return ctx.digit.includes(d) ? 1 : 0;
  }
  const a = alphaSkeleton(p);
  if (!a) return 0;
  if (ctx.alpha.includes(` ${a} `)) return 1;
  const sq = a.replace(/ /g, "");
  if (sq.length >= 8 && ctx.squashed.includes(sq)) return 1;
  if (sq.length < 9) return 0;
  return fuzzy(ctx.tokens, a) >= 0 ? 0.8 : 0;
}

// Looks for the phrase in windows of words a word shorter to a word longer than it, allowing about
// one wrong letter in nine. Returns the index of the first token of the match, or -1.
function fuzzy(tokens, phrase) {
  const words = phrase.split(" ");
  const max = Math.max(1, Math.floor(phrase.length / 9));
  const first = words[0][0];
  for (let k = Math.max(1, words.length - 1); k <= words.length + 1; k++) {
    for (let i = 0; i + k <= tokens.length; i++) {
      const t = tokens[i];
      if (t[0] !== first && words[0].length > 3 && t.length > 1 && t[1] !== words[0][1]) continue;
      if (within(tokens.slice(i, i + k).join(" "), phrase, max)) return i;
    }
  }
  return -1;
}

// Word-bounded search for a name in folded text: "chase" finds "Chase" but not "purchase".
export function findName(ctx, name) {
  const a = alphaSkeleton(name);
  if (!a) return -1;
  return ctx.alpha.indexOf(` ${a} `);
}
// The same, allowing OCR slips in names of 9 letters or more ("Honda Financiol Servics"). Returns
// the approximate position in the alpha skeleton, or -1.
export function findNameFuzzy(ctx, name) {
  const exact = findName(ctx, name);
  if (exact >= 0) return exact;
  const a = alphaSkeleton(name);
  if (a.replace(/ /g, "").length < 9) return -1;
  const i = fuzzy(ctx.tokens, a);
  if (i < 0) return -1;
  return ctx.tokens.slice(0, i).reduce((n, t) => n + t.length + 1, 0);
}
