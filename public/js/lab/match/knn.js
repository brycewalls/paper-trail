// lab/match/knn.js: nearest labeled examples and their vote on document type and sender (#102).
// Pure, no DOM, runs in Node for the eval.
//
// Vectors are the embedding model's unit-length sentence vectors. Stored, each is packed as int8
// with one scale (packVector / unpackVector): 384 numbers in 384 bytes, about 512 characters of
// base64, which keeps the bundled corpus small and a Firestore example doc under 1 KB.
//
//   nearest(vec, examples, k)      [{ ex, sim }] by cosine similarity, best first
//   vote(neighbors, field, opts)   { value, conf, sim, share, votes } or null when no one is sure
// examples: [{ vec: Float32Array, docType, issuer, source, synthetic? }]. A synthetic example (the
// bundled corpus) votes on type only: its senders are made up.
// Owner: lab matcher.

export function packVector(vec) {
  let max = 0;
  for (const x of vec) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1;
  const bytes = new Uint8Array(vec.length);
  for (let i = 0; i < vec.length; i++) bytes[i] = (Math.round(vec[i] / scale) + 256) & 255;
  return { v: toBase64(bytes), s: Number(scale.toPrecision(7)) };
}
export function unpackVector({ v, s }) {
  const bytes = fromBase64(v);
  const out = new Float32Array(bytes.length);
  let norm = 0;
  for (let i = 0; i < bytes.length; i++) { const b = bytes[i] > 127 ? bytes[i] - 256 : bytes[i]; out[i] = b * s; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
function toBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromBase64(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;   // both unit length
}

export function nearest(vec, examples, k = 7) {
  const scored = [];
  for (const ex of examples) if (ex.vec && ex.vec.length === vec.length) scored.push({ ex, sim: cosine(vec, ex.vec) });
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, k);
}

// Thresholds, tuned on the dev split with leave-one-out (tools/lab/eval-rules.mjs --matcher):
//   minSim   neighbors below this don't vote at all
//   topSim   the winner's closest example has to be at least this close
//   share    the winner needs this share of the weighted vote
export const VOTE = {
  docType: { minSim: 0.55, topSim: 0.8, share: 0.6 },
  issuer: { minSim: 0.7, topSim: 0.88, share: 0.6 },
};

export function vote(neighbors, field, opts = VOTE[field]) {
  const tally = new Map();
  let total = 0;
  for (const { ex, sim } of neighbors) {
    if (sim < opts.minSim) continue;
    if (field === "issuer" && (ex.synthetic || !ex.issuer)) continue;
    const value = ex[field];
    if (!value) continue;
    const w = sim * sim;
    const t = tally.get(value) || { w: 0, top: 0, n: 0 };
    t.w += w; t.n++; t.top = Math.max(t.top, sim);
    tally.set(value, t);
    total += w;
  }
  if (!total) return null;
  const [value, t] = [...tally].sort((a, b) => b[1].w - a[1].w)[0];
  const share = t.w / total;
  const votes = Object.fromEntries([...tally].map(([k, x]) => [k, Math.round(x.w * 100) / 100]));
  const sure = t.top >= opts.topSim && share >= opts.share;
  // conf: how close the nearest agreeing example is, scaled by how one-sided the vote was.
  const conf = Math.round(Math.min(1, t.top * (0.5 + share / 2)) * 100) / 100;
  return { value, conf, sim: Math.round(t.top * 1000) / 1000, share: Math.round(share * 100) / 100, n: t.n, votes, sure };
}
