// Builds public/js/lab/match/corpus-examples.json (#102): every document in the synthetic corpus
// (tools/lab/corpus/), embedded ahead of time with the matcher's model, so the lab's first read can
// vote on the type without embedding a hundred examples on the phone. Run it again whenever the
// corpus or the model changes; the worker ignores the file if its model doesn't match.
//   node tools/lab/build-examples.mjs
// Needs npm ci --prefix tools/lab/matcher-deps and bash tools/lab/fetch-models.sh first. The corpus
// is synthetic (made-up people, companies and numbers), so its vectors are safe in the public repo.
import { writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./eval-rules.mjs";
import { loadEmbedder } from "./embedder.mjs";
import { MODEL } from "../../public/js/lab/match/model.js";
import { packVector } from "../../public/js/lab/match/knn.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const corpus = await loadCorpus();
const { embedPages } = await loadEmbedder();
const examples = [];
for (const doc of corpus) {
  const vec = await embedPages(doc.pages);
  examples.push({ id: doc.id, split: doc.split, docType: doc.expect.docType, issuer: doc.expect.issuer || "", ...packVector(vec) });
}
const out = { about: "Synthetic corpus examples for the lab matcher (#102), built by tools/lab/build-examples.mjs. Made-up documents: they vote on the type only, never the sender.",
  model: MODEL.id, revision: MODEL.revision, dtype: MODEL.dtype, dims: MODEL.dims, examples };
const path = join(root, "public", "js", "lab", "match", "corpus-examples.json");
writeFileSync(path, JSON.stringify(out) + "\n");
console.log(`Wrote ${examples.length} examples to ${path}`);
