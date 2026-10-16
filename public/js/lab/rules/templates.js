// lab/rules/templates.js: the title, filename and summary a person reads (#92). Pure, no DOM.
// Same shapes as Claude's cards (functions/lib.js): a title like "Duke Energy bill, March 2024", a
// filename like 2024-03-12_duke-energy-electric-bill (lowercase, hyphens, 0000-00-00 without a
// date), and one summary sentence with amounts and only the last 4 digits of any number.
// Owner: lab (rules engine).
import { monthYear, longDate } from "./fields.js";

export const slug = (s) => String(s || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "unknown";
export const cleanName = (s) => String(s || "").trim().replace(/\.pdf$/i, "").replace(/[\/\\:*?"<>|]/g, "-");

// "Northwind Logistics Inc" -> "northwind-logistics"; keeps the filename short and stable.
// Long agency names shorten the way people write them: "Washington State Department of Licensing"
// -> "washington-dol". At most four words.
const ABBR = [[/department of licensing/i, "dol"], [/(division|department) of motor vehicles/i, "dmv"], [/department of revenue/i, "dor"],
  [/social security administration/i, "ssa"], [/u\.?\s?s\.? department of state/i, "us state department"], [/^state of /i, ""], [/\bstate (?=dol|dmv|dor)/i, ""]];
export function issuerSlug(issuer) {
  let s = String(issuer || "").replace(/[*]/g, "").replace(/\b(inc|llc|pllc|corp|corporation|co|n\.?a\.?|ltd|the)\b\.?/gi, " ");
  for (const [rx, to] of ABBR) s = s.replace(rx, to);
  return slug(s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").slice(0, 4).join(" "));
}

const YEAR_FIRST = new Set(["Federal tax return", "State tax return"]);

// "Pay stub" reads "pay stub" after a name; "W-2", "EOB" and "HOA statement" keep their capitals.
const lowerNoun = (t) => (/^[A-Z0-9]{2}|^\d/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
// A sender whose name the noun already says ("Social Security Administration" and "Social Security
// statement", "CVS Pharmacy" and "pharmacy receipt") isn't repeated.
const says = (noun, issuer) => { const w = String(issuer || "").toLowerCase().split(/\s+/); return !!issuer && noun.toLowerCase().includes(w.slice(0, 2).join(" ")) || (w.includes("pharmacy") && /pharmacy/i.test(noun)); };

export function makeTitle(type, f) {
  const { docDate, year, row } = f;
  let noun = lowerNoun(row.noun || type);
  if (/pharmacy/i.test(f.issuer || "") && type === "Pharmacy receipt") noun = "receipt";
  const issuer = says(noun, f.issuer) && type !== "Pharmacy receipt" ? "" : f.issuer;
  if (type === "Unknown") return issuer ? `Document from ${issuer}` : "Needs a look";
  if (row.date === "tax") {
    if (type === "Federal tax return") return `Federal tax return, ${year || docDate.slice(0, 4)}`;
    if (type === "State tax return") return `${f.state ? `${f.state} tax return` : "State tax return"}, ${year || docDate.slice(0, 4)}`;
    return [`${type}${issuer ? ` from ${issuer}` : ""}`, year].filter(Boolean).join(", ");
  }
  if (YEAR_FIRST.has(type)) return `${type}, ${year}`;
  switch (type) {
    case "Birth certificate": case "Marriage certificate": case "Social Security card": case "Passport":
      return f.person ? `${capital(noun)}, ${f.person}` : capital(noun);
    case "Vehicle title": case "Vehicle registration":
      return f.vehicle ? `${capital(noun)}, ${f.vehicle}` : capital(noun);
    case "Junk mail": return issuer ? `${issuer} ad` : "Advertising mail";
    case "Personal letter": case "Greeting card": return `${capital(noun)} from ${issuer || "someone"}`;
    case "Pharmacy receipt": case "Receipt": case "Invoice":
      return [`${issuer ? `${issuer} ` : ""}${noun}`, docDate ? longDate(docDate) : ""].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase());
    case "Social Security statement": return [capital(noun), monthYear(docDate)].filter(Boolean).join(", ");
    default: {
      const head = issuer ? `${issuer} ${noun}` : capital(noun);
      const when = row.statement || ["Explanation of benefits", "Medical bill", "Pay stub", "Letter", "Tax notice"].includes(type) ? monthYear(docDate) : docDate ? docDate.slice(0, 4) : "";
      return [head, when].filter(Boolean).join(", ");
    }
  }
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The descriptive part of a filename: a utility bill says what it is for (electric, gas, water).
export function shortName(type, f) {
  const row = f.row;
  if (type === "Utility bill") return f.utility ? `${f.utility}-bill` : "utility-bill";
  if (type === "Bank statement" && f.account) return `${f.account}-statement`;
  if (type === "Loan statement" && f.loanKind) return `${f.loanKind}-loan-statement`;
  return row.short || slug(type);
}

export function makeFilename(type, f) {
  const date = f.docDate || "0000-00-00";
  const who = f.issuer ? issuerSlug(f.issuer) : "";
  const what = shortName(type, f);
  const name = who && who !== "unknown" && !what.startsWith(who) ? `${who}-${what}` : what;
  if (type === "Pharmacy receipt" && who.endsWith("pharmacy")) return cleanName(`${date}_${slug(`${who}-receipt`)}`).slice(0, 120);
  return cleanName(`${date}_${slug(name)}`).slice(0, 120);
}

// One sentence: what it is, who from, the period, and the one number that matters, if any.
export function makeSummary(type, f) {
  const row = f.row;
  if (type === "Unknown") return f.unreadable ? "The scan didn't have enough readable text to sort." : "The rules couldn't tell what kind of document this is.";
  const what = f.utility && type === "Utility bill" ? `${capital(f.utility)} bill` : row.summary || type;
  const from = f.issuer && !["Personal letter", "Greeting card"].includes(type) ? ` from ${f.issuer}` : f.issuer ? ` from ${f.issuer}` : "";
  let when = "";
  if (row.date === "tax" && f.year) when = ` for ${f.year}`;
  else if (row.statement && f.docDate) when = ` for ${monthYear(f.docDate)}`;
  else if (f.docDate && row.date !== "birth") when = `, dated ${longDate(f.docDate)}`;
  const facts = [];
  if (f.amount) facts.push(`${f.amountLabel || "amount"} ${f.amount}`);
  if (f.last4) facts.push(`account ending ${f.last4}`);
  const tail = facts.length ? `, ${facts.join(", ")}` : "";
  return `${what}${from}${when}${tail}.`;
}
