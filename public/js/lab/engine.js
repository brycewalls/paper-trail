// lab/engine.js: the one door from the lab reader to the rules engine (#92). Everything that runs
// the rules (lab/reader.js on the page, lab/rules-worker.js in the worker) imports runRules from here,
// so swapping the engine is one line. No AI, no network, no DOM.
//
//   runRules(textPages, meta) -> Promise<classify-shaped result>
//     textPages  one string per page: the PDF's own text, or on-device OCR of the page picture
//     meta       { name, pages, textSource: "text"|"ocr"|"mixed"|"none", senderRules: [rule], today: "YYYY-MM-DD" }
//                senderRules are users/{uid}/senders (or the lab's), the same objects classify.js keeps
//
// INTEGRATOR: once feat/lab-rules lands, import classify from its entry module (public/js/lab/rules/)
// instead of the stub, and delete lab/rules-stub.js.
// Owner: lab reader.
import { classify } from "./rules-stub.js";

export async function runRules(textPages, meta = {}) {
  return classify(textPages, meta);
}
