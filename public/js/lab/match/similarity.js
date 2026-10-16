// lab/match/similarity.js: how alike two sender names are once OCR has had a go at one of them
// (#102, the sender part of #100). Pure, no DOM, runs in Node for the eval and its tests.
//
//   ocrDistance(a, b)        an edit distance where the slips OCR makes cost little: 0 and o, 1 l and
//                            i, e and c, rn and m, cl and d, a dropped space; any other change costs 1
//   trigramSim(a, b)         Dice similarity of character trigrams on the OCR-folded skeleton
//   nameSim(a, b)            0 to 1, the two blended, after dropping Inc, LLC, N.A. and the like. Every
//                            word of the shorter name has to have a close partner in the longer one,
//                            so "Harbor Federal Credit Union" never becomes "Navy Federal Credit Union"
//   snapSender(raw, cands, { lines, prefer })
//                            the known sender a garbled name (or, failing that, a line near the top
//                            of the page) most likely is: { name, sim, via, from, seen } or null
//   repairName(raw, vocab)   word by word, the OCR slips in a name no one has filed yet fixed against
//                            a vocabulary: "Evergreen Roofng & Gutters" -> "Evergreen Roofing &
//                            Gutters", "AlderPork" -> "Alder Park". { name, changed: [[from, to]] }
//
// cands: [{ name, aliases?, source }] where source is "sender rule", "known sender" or "filed"
// (a sender Bryce has filed or corrected in the lab). Owner: lab matcher.
import { alphaSkeleton } from "../rules/text.js";

// Single-character swaps OCR makes, both ways round.
const NEAR = [["0", "o"], ["1", "l"], ["1", "i"], ["l", "i"], ["i", "j"], ["5", "s"], ["8", "b"], ["6", "b"], ["2", "z"],
  ["e", "c"], ["a", "o"], ["g", "q"], ["n", "h"], ["u", "v"], ["c", "o"], ["t", "f"], ["r", "n"], ["9", "g"]];
const NEAR_SET = new Set(NEAR.flatMap(([x, y]) => [x + y, y + x]));
// Two characters read as one, or one as two.
const PAIRS = new Map([["rn", "m"], ["cl", "d"], ["vv", "w"], ["ri", "n"], ["li", "h"], ["in", "m"], ["ii", "u"]]);
const CHEAP = 0.25, SPACE = 0.3;

const SUFFIX = /\b(inc|llc|pllc|llp|ltd|corp|corporation|co|company|the|n ?a|fsb|pc|pa)\b/g;
// Lowercase, & as "and", punctuation and company suffixes off, single spaces.
export function plainName(s) {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

export function ocrDistance(a, b) {
  a = String(a); b = String(b);
  const n = a.length, m = b.length;
  const del = (ch) => (ch === " " ? SPACE : 1);
  const rows = [new Float64Array(m + 1)];   // names are short, so every row is kept for the pairs
  for (let j = 1; j <= m; j++) rows[0][j] = rows[0][j - 1] + del(b[j - 1]);
  for (let i = 1; i <= n; i++) {
    const cur = new Float64Array(m + 1), up = rows[i - 1], x = a[i - 1];
    cur[0] = up[0] + del(x);
    const two = i >= 2 ? a[i - 2] + x : "";
    for (let j = 1; j <= m; j++) {
      const y = b[j - 1];
      let v = up[j] + del(x);
      const left = cur[j - 1] + del(y);
      if (left < v) v = left;
      const diag = up[j - 1] + (x === y ? 0 : NEAR_SET.has(x + y) ? CHEAP : 1);
      if (diag < v) v = diag;
      // Two characters on one side for one on the other ("rn" for "m"), either way round.
      if (two && PAIRS.get(two) === y && rows[i - 2][j - 1] + CHEAP < v) v = rows[i - 2][j - 1] + CHEAP;
      if (j >= 2 && PAIRS.get(b[j - 2] + y) === x && up[j - 2] + CHEAP < v) v = up[j - 2] + CHEAP;
      cur[j] = v;
    }
    rows.push(cur);
  }
  return rows[n][m];
}

function trigrams(s) {
  const t = `  ${s} `;
  const out = new Map();
  for (let i = 0; i + 3 <= t.length; i++) { const g = t.slice(i, i + 3); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}
function dice(x, y) {
  let both = 0, nx = 0, ny = 0;
  for (const v of x.values()) nx += v;
  for (const v of y.values()) ny += v;
  for (const [g, v] of x) if (y.has(g)) both += Math.min(v, y.get(g));
  return nx + ny ? (2 * both) / (nx + ny) : 0;
}
export const trigramSim = (a, b) => dice(trigrams(alphaSkeleton(a)), trigrams(alphaSkeleton(b)));

// How far a word is from its closest partner among words (and pairs of words run together, both
// ways: "alderpork" and "alder park"), as a share of its length.
function wordGap(w, words) {
  let best = 1;
  const options = [...words, ...words.slice(1).map((x, i) => words[i] + x)];
  for (const o of options) {
    if (Math.abs(o.length - w.length) > Math.max(2, w.length / 2)) continue;
    best = Math.min(best, ocrDistance(w, o) / Math.max(w.length, o.length));
    if (!best) break;
  }
  return best;
}
// Every word of each name (the run-together forms count) is close to something in the other.
const WORD_GAP = 0.34;
function wordsAlign(x, y) {
  const wx = x.split(" "), wy = y.split(" ");
  const ok = (ws, other) => ws.every((w) => w.length < 2 || wordGap(w, other) <= WORD_GAP);
  return ok(wx, wy) && ok(wy, wx);
}

// 0 to 1. The edit distance forgives OCR slips; the trigrams keep two different short names
// ("Citi", "Cigna") apart; the word check stops one distinctive word being swapped for another.
// a and b are names, or { key, tri } from prepared() when the same name is compared many times.
export const prepared = (name) => { const key = plainName(name); return { key, tri: trigrams(alphaSkeleton(key)) }; };
export function nameSim(a, b) {
  const A = typeof a === "object" && a ? a : prepared(a), B = typeof b === "object" && b ? b : prepared(b);
  const x = A.key, y = B.key;
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.replace(/ /g, "") === y.replace(/ /g, "")) return 0.97;
  const tri = dice(A.tri, B.tri);
  if (tri < 0.3) return tri * 0.35;
  const ed = 1 - ocrDistance(x, y) / Math.max(x.length, y.length);
  const sim = Math.max(0, 0.65 * ed + 0.35 * tri);
  return sim >= 0.7 && !wordsAlign(x, y) ? Math.min(sim, 0.6) : sim;
}

// The candidate list, one entry per name or alias, with what nameSim needs worked out once.
export function candidateList(cands) {
  const out = [];
  const seen = new Set();
  for (const c of cands || []) {
    if (!c || !c.name) continue;
    for (const alias of [c.name, ...(c.aliases || [])]) {
      const key = plainName(alias);
      if (key.length < 3 || seen.has(`${key}|${c.name}`)) continue;
      seen.add(`${key}|${c.name}`);
      out.push({ key, tri: trigrams(alphaSkeleton(key)), name: c.name, source: c.source || "known sender" });
    }
  }
  return out;
}

// How sure a snap has to be. A raw name the rules read is compared whole; a line from the page is
// compared in word windows, which finds more by chance, so it needs a closer match. Short names
// need closer matches too: one slip in "Citi" is a quarter of the word.
export const SNAP = { name: 0.8, line: 0.86, short: 0.92, shortLen: 6 };
const need = (key, base) => (key.replace(/ /g, "").length <= SNAP.shortLen ? Math.max(base, SNAP.short) : base);

// raw: the sender the rules read ("" when none). lines: the first lines of page one. prefer: names
// to favor on a near tie (the senders the nearest filed documents had). Returns the best snap or null.
export function snapSender(raw, cands, { lines = [], prefer = [], maxLines = 10 } = {}) {
  const list = Array.isArray(cands) && cands.length && cands[0].tri ? cands : candidateList(cands);
  if (!list.length) return null;
  const favored = new Set(prefer);
  let best = null;
  const consider = (text, via, base) => {
    const T = prepared(text), t = T.key;
    if (t.length < 3) return;
    for (const c of list) {
      if (Math.abs(c.key.length - t.length) > Math.max(3, c.key.length * 0.4)) continue;
      const sim = nameSim(T, c) + (favored.has(c.name) ? 0.02 : 0);
      if (sim < need(c.key, base)) continue;
      if (!best || sim > best.sim) best = { name: c.name, sim: Math.min(1, sim), via, from: c.source, seen: text };
    }
  };
  if (raw) consider(raw, "name", SNAP.name);
  if (!best) {
    // Word windows of each early line, about a name's length: "Bet Buy  Store #212" holds "Bet Buy".
    for (const line of lines.slice(0, maxLines)) {
      const words = plainName(line).split(" ").filter(Boolean);
      for (let k = 1; k <= Math.min(6, words.length); k++) {
        for (let i = 0; i + k <= words.length; i++) consider(words.slice(i, i + k).join(" "), "line", SNAP.line);
      }
    }
  }
  return best;
}

// ---------- word by word, for a sender no one has filed yet ----------
// Words that make up organization names, and US state and large city names, so a slip in "Roofing"
// or "Raleigh" can be fixed before anyone has filed that sender. The known senders', your sender
// rules' and your filed senders' words are added to these (vocabulary()).
const ORG_WORDS = `academy accounting administration administrator advisors agency alliance american animal apartments
appliance assessor associates association attorneys auto automotive bakery bank behavioral benefits brewing builders
cardiology care center central church city clinic coffee college community company construction consulting cooperative
council county court credit dental dentistry department dermatology design development diagnostics district division
electric electrical emergency energy engineering enterprises estate eye family federal fiber financial fitness foundation
gas general group gutters health healthcare heating holdings home homeowners hospital imaging institute insurance internal
investment investments law lawn learning legal lending library life loan logistics management manor market marketing
medical memorial mental metro mortgage motors municipal mutual national network neurology north northwest office
orthodontics orthopedic orthopedics partners park pediatric pediatrics pharmacy physical physicians plumbing podiatry
power practice primary professional properties property public radiology realty recovery regional rehabilitation rental
repair research residential resources revenue ridge roofing savings school security services settlement sewer society
solutions south southern system southwest specialists state storage studio superior supply surgery surgical systems tax
technologies therapy title towing transit treasurer trust union united university urgent utilities valley veterinary
vision water wealth wellness west windows wireless`.split(/\s+/);
const PLACES = `alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois
indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska
nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont
virginia washington wisconsin wyoming albuquerque anaheim anchorage arlington atlanta aurora austin bakersfield baltimore
bellevue birmingham boise boston buffalo chandler charlotte chesapeake chicago cincinnati cleveland columbus dallas denver
detroit durham everett fresno greensboro henderson honolulu houston indianapolis irvine jacksonville kirkland lexington
lincoln louisville madison memphis mesa miami milwaukee minneapolis nashville newark norfolk oakland olympia omaha orlando
philadelphia phoenix pittsburgh plano portland raleigh redmond reno richmond riverside sacramento salem seattle spokane
stockton tacoma tampa tucson tulsa vancouver wichita yakima pierce king snohomish multnomah wake mecklenburg`.split(/\s+/);

export function vocabulary(names = []) {
  const v = new Set([...ORG_WORDS, ...PLACES]);
  for (const n of names) for (const w of plainName(n).split(" ")) if (w.length >= 4 && /^[a-z]+$/.test(w)) v.add(w);
  return v;
}

// The vocabulary word a slip most likely came from: one close enough (cheap OCR slips, or one real
// change in a long word) and clearly closer than any other. "" when there's no such word.
function fixWord(w, vocab) {
  if (vocab.has(w) || w.length < 4) return "";
  const max = w.length >= 6 ? 1 : w.length >= 5 ? 0.5 : 0.25;
  let best = "", bestD = Infinity, second = Infinity;
  for (const v of vocab) {
    if (v === w + "s" || w === v + "s") return "";   // a plural is a different word, not a slip
    if (Math.abs(v.length - w.length) > 2 || v[0] !== w[0] && !NEAR_SET.has(v[0] + w[0])) continue;
    const d = ocrDistance(w, v);
    if (d < bestD) { second = bestD; bestD = d; best = v; } else if (d < second) second = d;
  }
  return bestD <= max && second - bestD >= 0.5 ? best : "";
}
// Keeps the word's look: "ROOFNG" -> "ROOFING", "Roofng" -> "Roofing".
const styled = (orig, word) => (orig === orig.toUpperCase() ? word.toUpperCase() : orig[0] === orig[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);

export function repairName(raw, vocab) {
  const changed = [];
  // Two capitalized words run together: "AlderPork" -> "Alder Pork", then each is checked.
  const spaced = String(raw || "").replace(/\b([A-Z][a-z]{2,})([A-Z][a-z]{2,})\b/g, (m, a, b) => {
    // Only when a half needs fixing: "UnitedHealthcare" is two good words written as one, on purpose.
    return fixWord(a.toLowerCase(), vocab) || fixWord(b.toLowerCase(), vocab) ? `${a} ${b}` : m;
  });
  const name = spaced.replace(/[A-Za-z0-9]+/g, (tok) => {
    if (!/[a-z]/i.test(tok) || tok.length < 4) return tok;
    // Digits OCR put for letters inside a word ("R0BOTICS") read as letters first.
    const low = tok.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s");
    if (/\d/.test(low)) return tok;
    if (vocab.has(low)) return low === tok.toLowerCase() ? tok : styled(tok, low);
    const fix = fixWord(low, vocab);
    if (!fix) {
      if (low === tok.toLowerCase()) return tok;
      changed.push([tok, styled(tok, low)]);
      return styled(tok, low);
    }
    changed.push([tok, styled(tok, fix)]);
    return styled(tok, fix);
  });
  if (spaced !== String(raw || "")) changed.unshift([String(raw), spaced]);
  return { name, changed };
}
