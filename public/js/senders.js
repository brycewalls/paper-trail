// senders.js: sender rules (#21). Owner: deck. Watches users/{uid}/senders while signed in and keeps
// the list the reads send as hints (classify.classifyItem's senderHints), and saves a rule when the
// check-fields sheet or the card detail has "Remember for this sender" on. A rule is the iPhone
// app's SenderRule: key (slug of the issuer), issuer, folder, verdict, docType, filenamePattern,
// updatedAt. Emits "sender:saved" with { key } after a rule is saved or forgotten.
// The Sender rules screen (spec 4.12) builds on ruleList(), saveRule() and forgetRule().
import { slug, on, emit } from "./ui.js";
import { watchSenders, setSenderRule, deleteSenderRule } from "./store.js";
import { patternFromFilename } from "./classify.js";

let rules = [];
let unwatch = null;

export const ruleList = () => rules;
export const ruleFor = (issuer) => { const k = slug(issuer); return k === "unknown" ? null : rules.find((r) => r.key === k) || null; };

// The rule a confirmed card teaches (SenderRuleEngine.rule(from:)): its folder, verdict, document
// type, and its filename with the date prefix as the {date} token.
export function ruleFromCard(card, now = new Date()) {
  const rule = { key: slug(card.issuer), issuer: card.issuer, folder: card.folder, verdict: card.verdict, updatedAt: now.toISOString() };
  const pattern = patternFromFilename(card.filename, card.docDate);
  if (pattern) rule.filenamePattern = pattern;
  if (card.docType) rule.docType = card.docType;
  return rule;
}

// Saves the rule for this card's sender. Never throws: a rule that fails to save must not stop the
// card from filing (CheckFieldsModel.confirm). Resolves true when it saved.
export async function saveRule(card) {
  if (!card || slug(card.issuer) === "unknown") return false;
  const rule = ruleFromCard(card);
  try {
    await setSenderRule(rule.key, rule);
    rules = [...rules.filter((r) => r.key !== rule.key), rule];
    emit("sender:saved", { key: rule.key });
    return true;
  } catch (e) {
    console.warn("Sender rule didn't save", e);
    return false;
  }
}

export async function forgetRule(key) {
  await deleteSenderRule(key);
  rules = rules.filter((r) => r.key !== key);
  emit("sender:saved", { key });
}

on("session:started", () => {
  if (unwatch) unwatch();
  unwatch = watchSenders((list) => { rules = list.filter((r) => r && r.issuer).map((r) => ({ ...r, key: r.key || r.id })); }, () => { rules = []; });
});
on("session:ended", () => { if (unwatch) unwatch(); unwatch = null; rules = []; });
