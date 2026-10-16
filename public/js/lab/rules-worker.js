// lab/rules-worker.js: runs the rules engine off the main thread (a module Web Worker), so a long
// document never stutters a swipe (#92). lab/reader.js starts it on the first read and falls back to
// the main thread if it can't load. Messages: in { id, textPages, meta }, out { id, ok, result | error }.
// Owner: lab reader.
import { runRules } from "./engine.js";

self.onmessage = async (e) => {
  const { id, textPages, meta } = e.data || {};
  try {
    const result = await runRules(textPages, meta);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
