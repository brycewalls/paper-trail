// lab/match/combine.js: the rules and the on-device matcher, put together with a clear order of
// precedence (#102). Pure, no DOM; runs in the matcher's worker and in Node for the eval.
//
//   1. Your sender rules. A rule whose sender heads the page already won in the rules; a garbled
//      name that snaps to one of your rules' senders now wins it too, and the rule then sets its
//      folder, verdict and filename as usual.
//   2. The rules, when they are sure (HIGH): a confident detector or a known sender stays.
//   3. The matcher, when the rules are unsure or the two disagree: the nearest labeled examples'
//      vote on the type, and the sender autocorrected against known senders, your sender rules and
//      the senders of documents you've filed or corrected.
// When the matcher changes the type or the sender, the rules work the rest of the card out again
// from it (readByRules hints), so the folder, verdict, title and filename follow.
//
//   combine({ card, textPages, meta, typeVote, issuerVote, candidates, neighbors })
//     -> { card, decidedBy: { docType, issuer }, notes }
//   card.match = { decidedBy, type, sender, neighbors, version } rides along for compare mode.
// decidedBy values: "sender rule", "rules", "matcher". Owner: lab matcher.
import { runRules } from "../engine.js";
import { docKind } from "../rules/compare.js";
import { knownByName } from "../rules/senders.js";
import { snapSender, plainName, candidateList, repairName, vocabulary } from "./similarity.js";

export const MATCH_VERSION = "lab-match 0.1";
// The rules keep a field when they are at least this sure of it.
export const HIGH = { docType: 0.85, issuer: 0.9 };
// Below this the rules' sender is treated as a guess, and lines near the top of the page are
// searched for a known sender.
const ISSUER_GUESS = 0.75;

const allLines = (pages) => (pages || []).join("\n").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 120);
const firstLines = (pages) => String((pages || [])[0] || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);

export async function combine({ card, textPages = [], meta = {}, typeVote = null, issuerVote = null, candidates = [], neighbors = [] }) {
  const decidedBy = { docType: "rules", issuer: "rules" };
  const notes = [];
  const hints = {};
  const conf = (card.confidence && card.confidence.fields) || {};
  const ruleSender = card.appliedRule || (card.rules && card.rules.issuerFrom === "your sender rule");
  if (ruleSender) { decidedBy.issuer = "sender rule"; if ((meta.senderRules || []).some((r) => r.docType && plainName(r.issuer) === plainName(card.issuer))) decidedBy.docType = "sender rule"; }
  const list = candidateList(candidates);

  // ---------- the sender ----------
  let sender = null;
  if (!ruleSender) {
    const raw = String(card.issuer || "");
    const rc = conf.issuer ?? 0;
    const isKnown = !!knownByName(raw);
    const prefer = issuerVote && issuerVote.value ? [issuerVote.value] : [];
    // Only the read name is snapped when the rules found a sender they trust; the page's top lines
    // are searched only when the rules had nothing, or a guess.
    // Not when the rules read the page and found only a notary or a venue line (a notarized
    // document with no party named): "State of North Carolina, County of Wake" isn't its sender.
    const searchLines = (rc < ISSUER_GUESS || !raw) && !(card.rules && card.rules.issuerFrom === "no party named");
    const snap = snapSender(isKnown ? "" : raw, list, { lines: searchLines ? firstLines(textPages) : [], prefer });
    if (snap && plainName(snap.name) !== plainName(raw)) {
      const fromRule = snap.from === "sender rule";
      if (fromRule || rc < HIGH.issuer || snap.via === "name") {
        hints.issuer = snap.name;
        hints.issuerConf = Math.min(0.95, snap.sim);
        hints.issuerFrom = fromRule ? "your sender rule, autocorrected" : `autocorrected from "${snap.seen}"`;
        decidedBy.issuer = fromRule ? "sender rule" : "matcher";
        sender = { name: snap.name, sim: round(snap.sim), seen: snap.seen, from: snap.from, via: snap.via };
      } else notes.push(`sender: the rules' "${raw}" kept over "${snap.name}"`);
    } else if (!snap && issuerVote && issuerVote.sure && !isKnown && (!raw || rc < HIGH.issuer) && plainName(issuerVote.value) !== plainName(raw)) {
      // The nearest filed documents (a recurring statement, the same form again) agree on a sender:
      // use it, but only when that name is on the page. Two employers' W-2s from one payroll
      // company look alike, and the name on the page is what tells them apart.
      const near = snapSender("", candidateList([{ name: issuerVote.value, source: "filed" }]), { lines: allLines(textPages), maxLines: 120 });
      if (near) {
        hints.issuer = issuerVote.value;
        hints.issuerConf = Math.min(0.9, issuerVote.conf);
        hints.issuerFrom = "the nearest filed documents";
        decidedBy.issuer = "matcher";
        sender = { name: issuerVote.value, sim: issuerVote.sim, seen: near.seen, from: "filed", via: "neighbors" };
      }
    } else if (snap) sender = { name: snap.name, sim: round(snap.sim), seen: snap.seen, from: snap.from, via: snap.via, same: true };
    // No one has filed this sender yet: fix the slips in its words instead ("Roofng" -> "Roofing").
    if (!hints.issuer && raw && !isKnown && !(sender && sender.same)) {
      const fixed = repairName(raw, vocabulary((candidates || []).map((c) => c.name)));
      if (fixed.changed.length && fixed.name !== raw) {
        hints.issuer = fixed.name;
        hints.issuerConf = Math.min(rc || 0.7, 0.8);
        hints.issuerFrom = `words fixed: ${fixed.changed.map(([a, b]) => `${a} to ${b}`).join(", ")}`;
        decidedBy.issuer = "matcher";
        sender = { name: fixed.name, seen: raw, from: "word fixes", via: "words", fixes: fixed.changed };
      }
    }
  }

  // ---------- the type ----------
  let type = null;
  if (typeVote && decidedBy.docType !== "sender rule") {
    const rc = conf.docType ?? 0;
    const same = docKind(typeVote.value) === docKind(card.docType);
    type = { value: typeVote.value, conf: typeVote.conf, sim: typeVote.sim, share: typeVote.share, sure: !!typeVote.sure, agrees: same };
    if (!same && typeVote.sure) {
      if (rc >= HIGH.docType && card.docType !== "Unknown") notes.push(`type: the rules' "${card.docType}" (${rc}) kept over "${typeVote.value}"`);
      else { hints.docType = typeVote.value; hints.docTypeConf = Math.min(0.9, typeVote.conf); decidedBy.docType = "matcher"; }
    }
  }

  let out = card;
  if (Object.keys(hints).length) {
    out = await runRules(textPages, { ...meta, hints });
    // A type the matcher chose that the rules had no row for comes back as the rules' pick: say so.
    if (hints.docType && out.docType !== hints.docType) decidedBy.docType = "rules";
  } else if (type && type.agrees && type.sure && out.confidence) {
    // Two independent readers agree: the type is surer than the rules alone said.
    const fields = { ...out.confidence.fields, docType: Math.max(out.confidence.fields.docType || 0, Math.min(0.9, type.conf)) };
    out = { ...out, confidence: { ...out.confidence, fields } };
  }
  out = { ...out, match: { version: MATCH_VERSION, decidedBy, type, sender, notes,
    neighbors: neighbors.slice(0, 3).map(({ ex, sim }) => ({ docType: ex.docType, issuer: ex.synthetic ? "" : ex.issuer || "", sim: round(sim), source: ex.source || "" })) } };
  return { card: out, decidedBy, notes };
}
const round = (x) => Math.round(x * 1000) / 1000;
