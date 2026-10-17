// lab/match/match-worker.js: the on-device matcher (#102), in its own module Web Worker so the
// model, the embedding and the vote never touch the page's main thread. lab/match/matcher.js
// starts it. No network beyond the lab site's own files, no AI service, no LLM.
//
// The model loads lazily: the first "prepare" (sent when a lab read starts) imports transformers.js
// from /lab-models/match/ and loads all-MiniLM-L6-v2 on ONNX Runtime's WASM build, one thread.
// transformers.js keeps the model files and the WASM binary in Cache Storage ("transformers-cache"),
// so later visits load from the phone, not the network. Until the model is ready (or if it can't
// load) a read still gets the sender autocorrect, which needs no model; only the vote waits.
//
// Messages in:
//   { type: "init", embedder: "model"|"hash"|"none", examples: [{ id, v, s, docType, issuer, source }] }
//   { type: "examples", examples }                 Bryce's filed and corrected examples, replaced whole
//   { type: "prepare" }                            start loading the model (no answer)
//   { type: "match", id, textPages, meta, card, waitMs }
//        -> { id, ok, result: { card, decidedBy, vector: { v, s } | null, ms: { embed, match, total },
//             model: "ready"|"loading"|"failed"|"off", neighbors } } or { id, ok: false, error }
//   { type: "status", id } -> { id, ok, result: { model, examples, corpus, loadMs } }
// "hash" is a stand-in embedder for the tests on the fake backend: words hashed into the same 384
// numbers, so the vote and the learning loop run without the 23 MB model.
// Owner: lab matcher.
import { MODEL, docText } from "./model.js";
import { nearest, vote, packVector, unpackVector } from "./knn.js";
import { combine } from "./combine.js";
import { KNOWN_SENDERS } from "../rules/senders.js";

const BASE = new URL("../../../lab-models/match/", import.meta.url);
const LIBRARY = new URL("vendor/transformers-4.3.0/transformers.min.js", BASE);
// ONNX Runtime: the same version and the same files the OCR worker loads (lab/ocr-worker.js), so the
// phone downloads one runtime binary for both. The OCR worker takes the asyncify build when the
// device has a WebGPU adapter and the plain one otherwise; the matcher picks the same way (it runs
// on the CPU either way, and transformers.js embeds the same on both builds).
const ORT_DIR = new URL("vendor/ort-1.31.0-dev.20260914-8d85527a0/", BASE);
const runtimeFiles = (asyncify) => {
  const name = asyncify ? "ort-wasm-simd-threaded.asyncify" : "ort-wasm-simd-threaded";
  return { wasm: new URL(`${name}.wasm`, ORT_DIR).href, mjs: new URL(`${name}.mjs`, ORT_DIR).href };
};
async function hasGpu() {
  try { const gpu = self.navigator && self.navigator.gpu; return !!(gpu && await gpu.requestAdapter()); } catch { return false; }
}
const MODELS = new URL(`models/${MODEL.revision.slice(0, 7)}/`, BASE);

let embedder = "none";
let state = "off";          // the model: off, loading, ready, failed
let extractor = null, loading = null, loadMs = 0;
let corpus = [];            // the bundled synthetic examples: they vote on the type only
let ready = Promise.resolve();
let learned = [];           // Bryce's filed and corrected documents
const KNOWN = KNOWN_SENDERS.map((k) => ({ name: k.name, aliases: k.aliases, source: "known sender" }));

const unpack = (list, extra = {}) => (list || []).filter((e) => e && e.v && typeof e.s === "number").map((e) => {
  try { return { id: e.id, docType: e.docType || "", issuer: e.issuer || "", source: e.source || "filed", vec: unpackVector(e), ...extra }; } catch { return null; }
}).filter((e) => e && e.vec.length === MODEL.dims);

async function loadCorpus() {
  if (embedder !== "model") return;
  try {
    const res = await fetch(new URL("./corpus-examples.json", import.meta.url));
    const data = await res.json();
    if (data.model !== MODEL.id || data.revision !== MODEL.revision || data.dims !== MODEL.dims) return;
    corpus = unpack(data.examples, { synthetic: true, source: "corpus" });
  } catch { corpus = []; }
}

function prepare() {
  if (embedder !== "model" || loading) return loading;
  state = "loading";
  const started = performance.now();
  loading = (async () => {
    const { pipeline, env } = await import(LIBRARY.href);
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    // A path, not a full URL: transformers.js treats an http(s) URL as a remote model, which
    // allowRemoteModels = false refuses, and the tokenizer then comes back empty.
    env.localModelPath = MODELS.pathname;
    env.useBrowserCache = typeof caches !== "undefined";
    env.useWasmCache = typeof caches !== "undefined";
    const onnx = env.backends.onnx;
    onnx.wasm.wasmPaths = runtimeFiles(await hasGpu());
    onnx.wasm.numThreads = 1;      // no cross-origin isolation on the site, and one core is kinder to the battery
    onnx.wasm.proxy = false;       // this is already a worker
    extractor = await pipeline("feature-extraction", MODEL.id, { dtype: MODEL.dtype, device: "wasm" });
    loadMs = Math.round(performance.now() - started);
    state = "ready";
  })().catch((e) => {
    state = "failed";
    console.warn("The lab matcher's model didn't load; reads go on without the vote", e && e.message);
  });
  return loading;
}

// Hashed words and word pairs, for the tests only.
function hashVector(text) {
  const out = new Float32Array(MODEL.dims);
  const words = String(text).split(" ").filter(Boolean);
  const add = (t, w) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); out[(h >>> 0) % MODEL.dims] += w; };
  words.forEach((w, i) => { add(w, 1); if (i) add(words[i - 1] + " " + w, 0.5); });
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

async function embed(textPages) {
  const text = docText(textPages);
  if (!text) return null;
  if (embedder === "hash") return hashVector(text);
  if (state !== "ready" || !extractor) return null;
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data);
}

async function match({ textPages = [], meta = {}, card, waitMs = 0 }) {
  const started = performance.now();
  await ready;
  if (embedder === "model" && state === "loading" && waitMs > 0) await Promise.race([loading, new Promise((r) => setTimeout(r, waitMs))]);
  const t = performance.now();
  const vec = await embed(textPages).catch((err) => { console.warn("The lab matcher couldn't embed this one", err && err.message); return null; });
  const embedMs = Math.round(performance.now() - t);
  const examples = [...learned, ...corpus];
  const neighbors = vec ? nearest(vec, examples, 7) : [];
  const typeVote = neighbors.length ? vote(neighbors, "docType") : null;
  const issuerVote = neighbors.length ? vote(neighbors, "issuer") : null;
  const rules = (meta.senderRules || []).filter((r) => r && r.issuer).map((r) => ({ name: r.issuer, source: "sender rule" }));
  const filed = [...new Set(learned.map((e) => e.issuer).filter(Boolean))].map((name) => ({ name, source: "filed" }));
  const out = await combine({ card, textPages, meta, typeVote, issuerVote, candidates: [...rules, ...filed, ...KNOWN], neighbors });
  const total = Math.round(performance.now() - started);
  return { card: out.card, decidedBy: out.decidedBy, vector: vec ? packVector(vec) : null,
    ms: { embed: embedMs, match: Math.round(performance.now() - t) - embedMs, total }, model: embedder === "hash" ? "hash" : state,
    neighbors: out.card.match ? out.card.match.neighbors : [] };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === "init") {
      embedder = ["model", "hash"].includes(msg.embedder) ? msg.embedder : "none";
      learned = unpack(msg.examples);
      ready = loadCorpus();
      return;
    }
    if (msg.type === "examples") { learned = unpack(msg.examples); return; }
    if (msg.type === "prepare") { prepare(); return; }
    if (msg.type === "status") {
      self.postMessage({ id: msg.id, ok: true, result: { model: embedder === "model" ? state : embedder, examples: learned.length, corpus: corpus.length, loadMs } });
      return;
    }
    if (msg.type === "match") self.postMessage({ id: msg.id, ok: true, result: await match(msg) });
  } catch (err) {
    if (msg.id) self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};
