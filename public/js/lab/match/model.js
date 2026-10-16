// lab/match/model.js: which embedding model the lab's matcher uses, where its files live, and the
// text it embeds (#102). Pure constants and one text helper; shared by the worker
// (lab/match/match-worker.js), tools/lab/build-examples.mjs and the eval, so the bundled vectors and
// the ones made on the phone always come from the same model and the same text.
//
// The model is all-MiniLM-L6-v2 (sentence-transformers, Apache-2.0), as the quantized ONNX export in
// Xenova/all-MiniLM-L6-v2 (Apache-2.0), pinned to one revision. It runs through transformers.js
// (@huggingface/transformers 4.3.0, Apache-2.0) on ONNX Runtime Web's WASM build
// (onnxruntime-web 1.31.0-dev.20260914-8d85527a0, MIT). Every file is self-hosted on the lab site
// under /lab-models/match/ by tools/lab/fetch-models.sh, which checks each one's SHA-256; nothing is
// fetched from a CDN at run time. The files aren't in git (about 38 MB). Their paths carry the
// version (vendor/transformers-4.3.0/, models/751bff3/), so Hosting can cache them for a year.
// Owner: lab matcher.

export const MODEL = {
  id: "Xenova/all-MiniLM-L6-v2",
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  dtype: "q8",           // onnx/model_quantized.onnx, 22.97 MB
  dims: 384,
  license: "Apache-2.0",
};
export const RUNTIME = { transformers: "4.3.0", onnxruntimeWeb: "1.31.0-dev.20260914-8d85527a0" };
// What gets embedded: the words of the first pages, lowercased, with every token that holds a digit
// left out (amounts, dates, account and ID numbers). Those say nothing about what kind of document
// it is, they drown out the words that do, and leaving them out means no number ever reaches a
// stored vector. About 1,200 characters, close to the model's 256 tokens.
export const EMBED_CHARS = 1200;
export function docText(pages) {
  const list = (Array.isArray(pages) ? pages : [pages]).map((p) => String(p || ""));
  const words = list.join("\n").toLowerCase().split(/\s+/).filter((t) => t && !/\d/.test(t)).join(" ");
  return words.replace(/[^a-z&' ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, EMBED_CHARS);
}
