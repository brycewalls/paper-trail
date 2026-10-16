// The lab matcher's embedding model in Node (#102), for tools/lab/build-examples.mjs and
// eval-rules.mjs --matcher. The same model, revision, quantization and text as the phone
// (public/js/lab/match/model.js), read from the self-hosted files in public/lab-models/match/ (run
// bash tools/lab/fetch-models.sh once), through @huggingface/transformers installed in
// tools/lab/matcher-deps (run npm ci --prefix tools/lab/matcher-deps once). Never goes to the network.
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODEL, docText } from "../../public/js/lab/match/model.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

export async function loadEmbedder() {
  const lib = join(here, "matcher-deps", "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs");
  if (!existsSync(lib)) throw new Error("transformers.js isn't installed. Run: npm ci --prefix tools/lab/matcher-deps");
  const models = join(root, "public", "lab-models", "match", "models", MODEL.revision.slice(0, 7)) + "/";
  if (!existsSync(join(models, MODEL.id, "onnx", "model_quantized.onnx"))) throw new Error("The model files aren't there. Run: bash tools/lab/fetch-models.sh");
  const { pipeline, env } = await import(pathToFileURL(lib).href);
  env.allowRemoteModels = false;
  env.localModelPath = models;
  const started = performance.now();
  const extractor = await pipeline("feature-extraction", MODEL.id, { dtype: MODEL.dtype });
  const loadMs = Math.round(performance.now() - started);
  // pages -> Float32Array (unit length)
  async function embedPages(pages) {
    const out = await extractor(docText(pages), { pooling: "mean", normalize: true });
    return Float32Array.from(out.data);
  }
  return { embedPages, loadMs };
}
