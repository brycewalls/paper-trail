// lab/match/matcher.js: the page's side of the on-device matcher (#102). It starts the matcher's
// worker (lab/match/match-worker.js), hands it each lab read after the rules, and keeps the
// examples it learns from: every document Bryce files or corrects in the lab becomes one, stored
// as a vector and its labels in users/{uid}/lab/data/examples/{readId} (store.js) and synced back
// to the worker on every device he signs in on. No document text is stored with an example.
//
//   matcherOn()                      the lab, and Settings, Lab, On-device matcher not turned off
//   prepareMatcher()                 start the worker and the model's lazy load (a read is coming)
//   matchRead(textPages, meta, card) the rules' card with the matcher's say added: { card, decidedBy,
//                                    vector, ms, model } or null (off, or it failed: keep the rules')
//   learnFrom(item, source)          save item's vector and final labels as an example
//   matcherStatus()                  { model, examples, corpus, loadMs } from the worker (tests, Lab Stats)
// On the fake backend the worker uses a hashed-words stand-in for the model unless ?matcher=model,
// and ?matcher=off turns it off. Events: "lab:read" (to know the items), "deck:decided" (filed or
// shredded, so the card is confirmed), "lab:compared" (picks saved), session events.
// Owner: lab matcher.
import { LAB, FAKE, params } from "../../config.js";
import { on } from "../../ui.js";
import { watchLabExamples, putLabExample } from "../../store.js";
import { matcherSetting } from "../../lab.js";
import { MODEL } from "./model.js";

const MATCH_TIMEOUT = 20000;
// How long a read waits for a model that is still loading (from the phone's cache this is a second
// or two). On a first visit, while the 23 MB download runs, reads go on with the rules and the
// sender autocorrect and don't wait.
const WAIT_FOR_MODEL = 4000;
const EMBEDDER = !LAB ? "none" : FAKE ? (params.get("matcher") === "model" ? "model" : "hash") : "model";

export const matcherOn = () => LAB && params.get("matcher") !== "off" && matcherSetting();

let worker = null, broken = false, nextId = 1;
const waiting = new Map();
let examples = [];

function start() {
  if (broken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./match-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const job = waiting.get(e.data && e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.ok) job.resolve(e.data.result); else job.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {   // the module didn't load: reads go on with the rules alone
      if (e && e.preventDefault) e.preventDefault();
      broken = true;
      try { worker.terminate(); } catch { /* gone */ }
      worker = null;
      for (const [id, job] of waiting) { waiting.delete(id); job.resolve(null); }
    };
    worker.postMessage({ type: "init", embedder: EMBEDDER, examples });
  } catch { broken = true; worker = null; }
  return worker;
}
function ask(msg, timeout = MATCH_TIMEOUT) {
  const w = start();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { if (waiting.delete(id)) resolve(null); }, timeout);
    waiting.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    try { w.postMessage({ ...msg, id }); } catch { waiting.delete(id); clearTimeout(timer); resolve(null); }
  });
}

export function prepareMatcher() {
  if (!matcherOn()) return;
  const w = start();
  if (w) w.postMessage({ type: "prepare" });
}

export async function matchRead(textPages, meta, card) {
  if (!matcherOn() || !card) return null;
  try {
    return await ask({ type: "match", textPages, meta, card, waitMs: WAIT_FOR_MODEL });
  } catch (e) {
    console.warn("The lab matcher didn't run on this one; the rules' card stands", e);
    return null;
  }
}

export const matcherStatus = () => ask({ type: "status" }, 5000);

// ---------- learning ----------
const items = new Map();       // readId -> the deck's item, from "lab:read"
const saved = new Map();       // readId -> what was last saved, so a repeat event writes nothing
export async function learnFrom(item, source = "filed") {
  const lab = item && item.lab;
  const vec = lab && lab.match && lab.match.vector;
  const card = item && (item.card || (lab && lab.rules));
  if (!vec || !card || !lab.readId) return false;
  const rec = { v: vec.v, s: vec.s, docType: String(card.docType || "").slice(0, 80), issuer: String(card.issuer || "").slice(0, 100),
    source, model: MODEL.id, revision: MODEL.revision.slice(0, 7), at: new Date().toISOString() };
  if (!rec.docType && !rec.issuer) return false;
  const key = `${rec.docType}|${rec.issuer}|${source}`;
  if (saved.get(lab.readId) === key) return false;
  saved.set(lab.readId, key);
  try { await putLabExample(lab.readId, rec); return true; } catch (e) { console.warn("The lab example didn't save", e); saved.delete(lab.readId); return false; }
}

if (LAB) {
  let unwatch = null;
  on("lab:read", ({ item }) => {
    if (!item || !item.lab) return;
    items.set(item.lab.readId, item);
    if (items.size > 200) items.delete(items.keys().next().value);
  });
  // A decision on the deck (file, shred, keep) means the card, as Bryce left it, is right.
  on("deck:decided", ({ id, decision }) => {
    if (!decision) return;
    const item = items.get(id) || [...items.values()].find((i) => i.id === id);
    if (item) learnFrom(item, item.edited || (item.lab && item.lab.picks) ? "corrected" : "filed");
  });
  on("lab:compared", ({ id }) => {
    const item = items.get(id) || [...items.values()].find((i) => i.id === id);
    if (item && item.lab && item.lab.picks) learnFrom(item, "corrected");
  });
  on("session:started", () => {
    if (unwatch) unwatch();
    unwatch = watchLabExamples((list) => {
      examples = list.filter((d) => d.model === MODEL.id).map((d) => ({ id: d.id, v: d.v, s: d.s, docType: d.docType, issuer: d.issuer, source: d.source }));
      if (worker) worker.postMessage({ type: "examples", examples });
    }, (e) => console.warn("Lab examples", e));
  });
  on("session:ended", () => {
    if (unwatch) unwatch();
    unwatch = null;
    examples = [];
    items.clear(); saved.clear();
    if (worker) worker.postMessage({ type: "examples", examples });
  });
}
