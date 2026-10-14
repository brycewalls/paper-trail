// What functions/index.js reaches outside itself for: the Claude client and the config values.
// index.js fills these in; the unit tests swap them for stand-ins.
module.exports = { client: null, allowlist: null, model: null, effort: null, today: null, Anthropic: null, log: null };
