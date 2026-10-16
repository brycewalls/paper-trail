// Unit tests for the lab's on-device matcher (#102): sender autocorrect, the kNN vote, the order of
// precedence, and the bundled corpus vectors. No model needed (the vectors here are made up or
// come from the bundle), so this runs in CI.
//   node --test tools/lab/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ocrDistance, nameSim, snapSender, repairName, vocabulary, plainName } from "../../public/js/lab/match/similarity.js";
import { packVector, unpackVector, nearest, vote, cosine } from "../../public/js/lab/match/knn.js";
import { combine, HIGH } from "../../public/js/lab/match/combine.js";
import { MODEL, docText } from "../../public/js/lab/match/model.js";
import { KNOWN_SENDERS } from "../../public/js/lab/rules/senders.js";
import { runRules } from "../../public/js/lab/engine.js";
import { loadCorpus } from "./eval-rules.mjs";
import bundle from "../../public/js/lab/match/corpus-examples.json" with { type: "json" };

const KNOWN = KNOWN_SENDERS.map((k) => ({ name: k.name, aliases: k.aliases, source: "known sender" }));
const unit = (arr) => { const v = Float32Array.from(arr); const n = Math.hypot(...v); return v.map((x) => x / n); };

test("OCR slips cost little, real changes cost one", () => {
  assert.equal(ocrDistance("cooper", "coopcr"), 0.25);
  assert.equal(ocrDistance("modern", "rnodern"), 0.25);
  assert.equal(ocrDistance("xyz", "pkw"), 3);
  assert.ok(ocrDistance("best buy", "bestbuy") < 0.5, "a dropped space is cheap");
});

test("nameSim forgives OCR but never swaps a distinctive word", () => {
  assert.ok(nameSim("Bet Buy", "Best Buy") >= 0.8);
  assert.ok(nameSim("Mr. Coopcr", "Mr. Cooper") >= 0.85);
  assert.ok(nameSim("Harbor Federal Credit Union", "Navy Federal Credit Union") < 0.8, "Harbor is not Navy");
  assert.ok(nameSim("Citi", "Cigna") < 0.8);
  assert.equal(nameSim("WELLS FARGO BANK, N.A.", "Wells Fargo Bank"), 1);
});

test("snapSender: a garbled name, a garbled line, and a sender no one knows", () => {
  assert.equal(snapSender("Mr. Coopcr", KNOWN)?.name, "Mr. Cooper");
  const line = snapSender("", KNOWN, { lines: ["CAPlTAL 0NE  P.O. Box 30285", "Statement period Sept 2 to Oct 1"] });
  assert.equal(line?.name, "Capital One");
  assert.equal(line?.via, "line");
  assert.equal(snapSender("Harbor Federal Credit Union", KNOWN), null);
  assert.equal(snapSender("Northwind Logistics", KNOWN), null);
});

test("repairName fixes slips in words and leaves good names alone", async () => {
  const V = vocabulary(KNOWN_SENDERS.map((k) => k.name));
  assert.equal(repairName("Evergreen Roofng & Gutters", V).name, "Evergreen Roofing & Gutters");
  assert.equal(repairName("Pierce County Assessor-Treasurcr", V).name, "Pierce County Assessor-Treasurer");
  assert.equal(repairName("AlderPork Homeowners Association", V).name, "Alder Park Homeowners Association");
  assert.equal(repairName("BRIGHTLINE R0BOTICS", V).name, "BRIGHTLINE ROBOTICS");
  for (const doc of await loadCorpus()) {
    const r = repairName(doc.expect.issuer, V);
    assert.deepEqual(r.changed, [], `${doc.expect.issuer} is left as it is`);
  }
});

test("vectors pack to int8 and back", () => {
  const v = unit(Array.from({ length: 384 }, (_, i) => Math.sin(i * 1.7) + (i % 7) / 10));
  const back = unpackVector(packVector(v));
  assert.equal(back.length, 384);
  assert.ok(cosine(v, back) > 0.999);
  assert.ok(packVector(v).v.length < 600, "about 512 characters of base64");
});

test("the vote: nearest examples, thresholds, and made-up senders never vote", () => {
  const a = unit([1, 0, 0, 0]), b = unit([0.95, 0.3, 0, 0]), c = unit([0, 0, 1, 0]);
  const ex = [
    { vec: a, docType: "Utility bill", issuer: "Seattle City Light", source: "filed" },
    { vec: b, docType: "Utility bill", issuer: "Seattle City Light", source: "filed" },
    { vec: c, docType: "Receipt", issuer: "Target", source: "filed" },
    { vec: a, docType: "Utility bill", issuer: "Northwind Power", synthetic: true },
  ];
  const nb = nearest(unit([1, 0.05, 0, 0]), ex, 3);
  assert.equal(nb[0].ex.docType, "Utility bill");
  const t = vote(nb, "docType");
  assert.equal(t.value, "Utility bill");
  assert.ok(t.sure);
  const s = vote(nb, "issuer");
  assert.equal(s.value, "Seattle City Light", "the synthetic example's sender is left out");
  assert.equal(vote(nearest(unit([0, 1, 0, 0]), ex, 3), "docType")?.sure ?? false, false, "far examples aren't sure");
});

const LETTER = ["Maple Covrt Apartrnents\n12 Elm Street, Tacoma WA 98402\nResidential Lease Agreement\nLandlord: Maple Covrt Apartrnents\nSigned June 1, 2025\nTerm twelve months. Rent 1,450.00 per month."];
test("precedence: a garbled name that snaps to your sender rule wins it, and the rule applies", async () => {
  const senderRules = [{ key: "maple-court-apartments", issuer: "Maple Court Apartments", folder: "06 Home", verdict: "keep_original" }];
  const meta = { senderRules, today: "2026-10-16" };
  const card = await runRules(LETTER, meta);
  assert.notEqual(card.appliedRule, "maple-court-apartments", "the rules alone miss it");
  const out = await combine({ card, textPages: LETTER, meta, candidates: [{ name: "Maple Court Apartments", source: "sender rule" }, ...KNOWN] });
  assert.equal(out.decidedBy.issuer, "sender rule");
  assert.equal(out.card.issuer, "Maple Court Apartments");
  assert.equal(out.card.appliedRule, "maple-court-apartments");
  assert.equal(out.card.verdict, "keep_original");
});

test("precedence: sure rules keep the type; unsure rules give way to a sure vote", async () => {
  const meta = { today: "2026-10-16" };
  const card = await runRules(LETTER, meta);
  assert.ok(card.confidence.fields.docType >= HIGH.docType);
  const vote1 = { value: "Receipt", conf: 0.9, sim: 0.95, share: 1, sure: true };
  const kept = await combine({ card, textPages: LETTER, meta, typeVote: vote1, candidates: KNOWN });
  assert.equal(kept.decidedBy.docType, "rules");
  assert.equal(kept.card.docType, card.docType);
  assert.ok(kept.notes.some((n) => n.startsWith("type:")));
  const unsure = { ...card, confidence: { ...card.confidence, fields: { ...card.confidence.fields, docType: 0.4 } } };
  const moved = await combine({ card: unsure, textPages: LETTER, meta, typeVote: vote1, candidates: KNOWN });
  assert.equal(moved.decidedBy.docType, "matcher");
  assert.equal(moved.card.docType, "Receipt");
  assert.equal(moved.card.rules.typeFrom, "matcher", "the rules reran from the matcher's type");
  assert.deepEqual(moved.card.match.decidedBy, moved.decidedBy);
});

test("the bundled corpus vectors match the model and the corpus", async () => {
  assert.equal(bundle.model, MODEL.id);
  assert.equal(bundle.revision, MODEL.revision);
  assert.equal(bundle.dims, MODEL.dims);
  const corpus = await loadCorpus();
  assert.deepEqual(bundle.examples.map((e) => e.id).sort(), corpus.map((d) => d.id).sort(), "rebuild with node tools/lab/build-examples.mjs");
  for (const e of bundle.examples) assert.equal(unpackVector(e).length, MODEL.dims);
  // Clean text finds itself: a sanity check that the vectors aren't scrambled.
  const vecs = bundle.examples.map((e) => unpackVector(e));
  assert.ok(vecs.every((v, i) => nearest(v, vecs.map((x) => ({ vec: x })), 1)[0].ex.vec === vecs[i]));
});

test("docText keeps the words and drops every token with a digit", () => {
  const t = docText(["Statement date 03/12/2024\nAccount ending 4411\nAmount due $84.12", "Page 2"]);
  assert.equal(t, "statement date account ending amount due page");
  assert.ok(!/\d/.test(docText(["SSN 900-12-3456 Wages 61,400.00"])));
  assert.equal(plainName("The Home Depot, Inc."), "home depot");
});
