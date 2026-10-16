// Unit tests for the no-AI rules engine (#92): node --test tools/lab/*.test.mjs
// Everything here is synthetic text; the engine runs in plain Node, no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readByRules, cleanRules, FIELDS } from "../../public/js/lab/rules/engine.js";
import { FOLDER_NAMES, VERDICTS, TYPES } from "../../public/js/lab/rules/tables.js";
import { makeContext } from "../../public/js/lab/rules/text.js";
import { findDates, findTaxYear, findLast4 } from "../../public/js/lab/rules/fields.js";
import { sensitiveSignals } from "../../public/js/lab/rules/sensitive.js";
import { agreement, docKind, sameIssuer } from "../../public/js/lab/rules/compare.js";
import { loadCorpus, evaluate, summarize, addNoise, TODAY } from "./eval-rules.mjs";

const today = TODAY;
const read = (text, o = {}) => readByRules({ pages: [text], today, ...o });
const W2 = `a Employee's social security number 900-12-3456  OMB No. 1545-0008
c Employer's name, address, and ZIP code
Northwind Logistics Inc
1 Wages, tips, other compensation 61,400.00
Form W-2 Wage and Tax Statement 2023
Copy B-To Be Filed With Employee's FEDERAL Tax Return`;

test("every corpus document gets a complete, well-formed card", async () => {
  const corpus = await loadCorpus();
  assert.ok(corpus.length >= 60, `the corpus has at least 60 documents (${corpus.length})`);
  for (const doc of corpus) {
    for (const noisy of [false, true]) {
      const pages = noisy ? doc.pages.map((p, i) => addNoise(p, i + 1)) : doc.pages;
      const c = readByRules({ pages, today });
      for (const f of FIELDS) assert.ok(f in c, `${doc.id} has ${f}`);
      assert.ok(FOLDER_NAMES.includes(c.folder), `${doc.id} folder`);
      assert.ok(VERDICTS.includes(c.verdict), `${doc.id} verdict`);
      assert.match(c.filename, /^(\d{4}-\d{2}-\d{2})_[a-z0-9-]+$/, `${doc.id} filename ${c.filename}`);
      assert.ok(c.docDate === "" || /^\d{4}-\d{2}-\d{2}$/.test(c.docDate), `${doc.id} docDate`);
      assert.equal(typeof c.sensitive, "boolean");
      assert.equal(typeof c.paperless.possible, "boolean");
      assert.ok(c.title && c.summary && c.verdictReason && c.retention, `${doc.id} has copy`);
      const shown = [c.title, c.summary, c.filename, c.verdictReason, c.paperless.how].join(" ");
      assert.doesNotMatch(shown, /\b\d{3}-\d{2}-\d{4}\b/, `${doc.id} never repeats a full SSN`);
      assert.ok(!shown.includes("—"), `${doc.id} copy has no em dash`);
      for (const [k, v] of Object.entries(c.confidence.fields)) assert.ok(v >= 0 && v <= 1, `${doc.id} confidence ${k}`);
    }
  }
});

test("every type in the tables has a folder, verdict, retention and reason", () => {
  for (const [t, row] of Object.entries(TYPES)) {
    assert.ok(FOLDER_NAMES.includes(row.folder), t);
    assert.ok(VERDICTS.includes(row.verdict), t);
    assert.ok(row.retention && row.reason, t);
  }
});

test("a W-2 files under its tax year's last day, from the employer, as sensitive", () => {
  const c = read(W2);
  assert.equal(c.docType, "W-2");
  assert.equal(c.issuer, "Northwind Logistics");
  assert.equal(c.docDate, "2023-12-31");
  assert.equal(c.folder, "02 Taxes");
  assert.equal(c.verdict, "scan_shred");
  assert.equal(c.sensitive, true);
  assert.equal(c.filename, "2023-12-31_northwind-logistics-w2");
  assert.equal(c.title, "W-2 from Northwind Logistics, 2023");
  assert.match(c.summary, /\$61,400\.00/);
  assert.ok(c.confidence.fields.docType >= 0.75, "a clear W-2 is sure of its type");
});

test("below the threshold the document is Unknown and needs a look", () => {
  const c = read("Form 7 rev. 3\nSection A ______  Section B ______\nInitial here ____\nPage 1 of 1");
  assert.equal(c.docType, "Unknown");
  assert.equal(c.folder, "11 Other");
  assert.equal(c.verdict, "scan_shred");
  assert.match(c.verdictReason, /^Needs a look/);
  assert.ok(c.confidence.overall < 0.75);
});

test("a scan with almost no text reads as unreadable", () => {
  const c = read(" ~ ,, ' . ");
  assert.equal(c.title, "Unreadable scan");
  assert.equal(c.verdict, "scan_shred");
});

test("sender rules come first and set their fields with full confidence", () => {
  const rules = [{ key: "northwind-logistics", issuer: "Northwind Logistics", folder: "08 Work & Income", filenamePattern: "{yyyy}_northwind-w2" }];
  const c = read(W2, { senderRules: rules });
  assert.equal(c.appliedRule, "northwind-logistics");
  assert.equal(c.folder, "08 Work & Income");
  assert.equal(c.filename, "2023_northwind-w2");
  assert.equal(c.confidence.fields.folder, 1);
  // A rule whose sender heads the page wins the sender over the known-sender list.
  const bill = "Cascade Power & Light\nYour Energy Bill\nBill date Mar 12, 2026\n812 kWh\nAmount due $84.12";
  const r = read(bill, { senderRules: [{ issuer: "Cascade Power & Light", verdict: "shred" }] });
  assert.equal(r.issuer, "Cascade Power & Light");
  assert.equal(r.verdict, "shred");
  assert.equal(cleanRules([{ issuer: "" }, null, { issuer: "X", folder: "nope" }]).length, 1);
});

test("routine statements more than a year old are shred, recent ones scan and shred", () => {
  const old = read("DUKE ENERGY\nYour Energy Bill\nBill date Mar 12, 2024\n812 kWh\nTotal Amount Due $84.12");
  const recent = read("DUKE ENERGY\nYour Energy Bill\nBill date Sep 12, 2026\n812 kWh\nTotal Amount Due $84.12");
  assert.equal(old.docType, "Utility bill");
  assert.equal(old.verdict, "shred");
  assert.equal(old.retention, "Not needed");
  assert.equal(recent.verdict, "scan_shred");
  assert.equal(recent.filename, "2026-09-12_duke-energy-electric-bill");
  assert.equal(recent.paperless.possible, true);
  assert.match(recent.paperless.how, /duke-energy\.com/);
});

test("dates: labels win, due dates lose, OCR slips are read", () => {
  const ctx = makeContext(["Payment Due Date Sep 23, 2026\nStaternent Closing Date  Aug 28, 2026\nApil 2, 2026\nPolicy Date: September 1,2024"]);
  const d = findDates(ctx, today);
  const by = Object.fromEntries(d.map((x) => [x.iso, x]));
  assert.equal(by["2026-09-23"].negative, true);
  assert.equal(by["2026-08-28"].label, "statement closing date");
  assert.ok(by["2026-04-02"], "a month missing a letter still parses");
  assert.ok(by["2024-09-01"], "no space after the comma still parses");
  assert.equal(findTaxYear(makeContext(["2024 Form 1099-INT Interest Income\nP.O. Box 1999"]), ["1099"], today).year, 2024);
});

test("last 4 digits, never the full number", () => {
  assert.equal(findLast4(makeContext(["Account number ending in 6620"])), "6620");
  assert.equal(findLast4(makeContext(["Account Number: 000000917744021"])), "4021");
  assert.equal(findLast4(makeContext(["Card ****9912"])), "9912");
});

test("sensitive: full SSN and account numbers count, masked ones don't", () => {
  assert.deepEqual(sensitiveSignals(makeContext(["SSN 900-12-3456"])), ["ssn"]);
  assert.deepEqual(sensitiveSignals(makeContext(["SSN XXX-XX-3456  Account ****8830  Call 800-829-0922"])), []);
  assert.ok(sensitiveSignals(makeContext(["Account Number 8773 10 221 0045912"])).includes("account"));
  assert.ok(sensitiveSignals(makeContext(["Routing number 999999992"])).includes("routing"));
});

test("compare: document kinds and senders fold before they are compared", () => {
  assert.equal(docKind("EOB"), docKind("Explanation of Benefits"));
  assert.equal(docKind("Form W-2"), "w-2");
  assert.equal(docKind("Electric bill"), docKind("Utility bill"));
  assert.notEqual(docKind("1099-INT"), docKind("1099-DIV"));
  assert.ok(sameIssuer("JPMorgan Chase Bank, N.A.", "Chase"));
  assert.ok(!sameIssuer("Chase", "Wells Fargo"));
  const a = agreement({ docType: "EOB", issuer: "Aetna Inc", docDate: "2025-08-14", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: { possible: true } },
    { docType: "Explanation of benefits", issuer: "Aetna", docDate: "2025-08-14", folder: "05 Medical", verdict: "scan_shred", sensitive: true, paperless: true });
  assert.ok(Object.values(a).every(Boolean));
});

test("the eval holds its floors on clean and noisy text", async () => {
  const corpus = await loadCorpus();
  const dev = summarize(evaluate(corpus.filter((d) => d.split === "dev")).rows);
  const hold = summarize(evaluate(corpus.filter((d) => d.split === "holdout")).rows);
  const noisy = summarize(evaluate(corpus, { noise: true }).rows);
  assert.ok(dev.mean >= 0.9, `dev ${dev.mean}`);
  assert.ok(hold.mean >= 0.8, `holdout ${hold.mean}`);
  assert.ok(noisy.mean >= 0.75, `noisy ${noisy.mean}`);
});
