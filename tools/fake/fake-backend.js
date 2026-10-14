// In-memory stand-ins for Firebase Auth, Firestore, the classify function and the Drive REST API,
// so the deck can be exercised on localhost with no Google account, no key and no network:
//   node tools/serve.mjs, then http://localhost:5178/public/index.html?fake=1
// The page only loads this on localhost with ?fake in the address; it is not deployed (Hosting
// serves public/ only). Options, all in the query string:
//   as=stranger      sign in as an account that isn't on the allowlist (the private screen)
//   signedout        start signed out (the sign-in screen)
//   nodrive          start without a Drive token (the Connect Drive link)
//   drive401         the first upload gets a 401, to exercise Reconnect Drive
//   readfail         the first read fails with rate_limited, to exercise Try again
// Everything it saw is on window.__PT_FAKE__ for tests: files uploaded (with their bytes),
// folders, classify payloads and the Firestore records.

const SAMPLES = [
  { title: "Duke Energy bill, March 2024", docType: "Utility bill", issuer: "Duke Energy", docDate: "2024-03-12", summary: "Electric bill for $84.12 on the account ending 4411.", folder: "06 Home", filename: "2024-03-12_duke-energy-electric-bill", verdict: "shred", verdictReason: "Duke Energy keeps every statement online, and nothing on this one is still needed.", retention: "Not needed", sensitive: false, paperless: { possible: true, issuer: "Duke Energy", how: "Sign in at duke-energy.com, then Billing and Payment, then Paperless Billing." } },
  { title: "W-2 from Acme Corp, 2023", docType: "W-2", issuer: "Acme Corp", docDate: "2024-01-26", summary: "Wage and tax statement showing $61,400 in wages for 2023.", folder: "02 Taxes", filename: "2024-01-26_acme-corp-w2-2023", verdict: "scan_shred", verdictReason: "Tax backup is worth a digital copy, but the paper itself has no legal value.", retention: "Keep 7 years (tax backup)", sensitive: true, paperless: { possible: true, issuer: "Acme Corp", how: "Turn on electronic W-2 delivery in the payroll portal." } },
  { title: "Birth certificate, Bryce Walls", docType: "Birth certificate", issuer: "State of North Carolina", docDate: "1996-05-02", summary: "Certified copy with a raised seal.", folder: "01 Identity & Legal", filename: "1996-05-02_nc-birth-certificate", verdict: "keep_original", verdictReason: "A certified birth certificate with a raised seal has to stay on paper.", retention: "Permanently", sensitive: true, paperless: { possible: false, issuer: "", how: "" } },
];

export function createFakeBackend(params) {
  const OWNER = { uid: "fake-owner", email: "bryce.evan.walls@gmail.com" };
  const STRANGER = { uid: "fake-stranger", email: "someone@example.com" };
  const state = {
    user: params.has("signedout") ? null : params.get("as") === "stranger" ? STRANGER : OWNER,
    db: new Map(),             // "docs/abc" -> data
    listeners: [],             // { name, order, cb }
    files: [],                 // { id, name, parents, size, bytes, mimeType }
    folders: [],               // { id, name, parent }
    sessions: new Map(),       // upload session URL -> metadata
    classifyCalls: [],
    drive401: params.has("drive401"),
    readfail: params.has("readfail"),
    authCb: null,
    nextId: 1,
  };
  window.__PT_FAKE__ = state;
  const id = (p) => `${p}${state.nextId++}`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const denied = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
  const allowed = () => state.user && state.user.uid === OWNER.uid;

  function notify() {
    for (const l of state.listeners) {
      const list = [...state.db.entries()].filter(([k]) => k.startsWith(l.name + "/")).map(([k, v]) => ({ id: k.slice(l.name.length + 1), ...v }));
      if (l.order) list.sort((a, b) => String(b[l.order]).localeCompare(String(a[l.order])));
      l.cb(list);
    }
  }
  if (state.user && allowed() && !params.has("nodrive")) {
    try { sessionStorage.setItem("pt-drive-token", JSON.stringify({ token: "fake-token", uid: OWNER.uid, exp: Date.now() + 3300000 })); } catch { /* ignore */ }
  }

  const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });
  async function fakeFetch(url, opts = {}) {
    await wait(120);
    const u = new URL(url);
    const method = (opts.method || "GET").toUpperCase();
    const auth = (opts.headers && opts.headers.Authorization) || "";
    if (!/^Bearer fake-token/.test(auth)) return json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401);
    if (u.hostname === "fake-upload.test" && method === "PUT") {
      const meta = state.sessions.get(url);
      if (!meta) return json({ error: { code: 404 } }, 404);
      const bytes = new Uint8Array(await opts.body.arrayBuffer());
      const file = { id: id("file-"), name: meta.name, parents: meta.parents, mimeType: meta.mimeType, size: bytes.length, bytes };
      state.files.push(file);
      return json({ id: file.id, webViewLink: `https://drive.google.com/file/d/${file.id}/view` });
    }
    if (u.pathname === "/upload/drive/v3/files" && method === "POST") {
      if (state.drive401) { state.drive401 = false; return json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401); }
      const meta = JSON.parse(opts.body);
      if (!state.folders.some((f) => f.id === meta.parents[0])) return json({ error: { code: 404, errors: [{ reason: "notFound" }] } }, 404);
      const session = `https://fake-upload.test/session/${id("s")}`;
      state.sessions.set(session, meta);
      return new Response(null, { status: 200, headers: { Location: session } });
    }
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const qs = u.searchParams.get("q") || "";
      const name = (qs.match(/name = '((?:[^'\\]|\\.)*)'/) || [])[1]?.replace(/\\(.)/g, "$1");
      const parent = (qs.match(/'((?:[^'\\]|\\.)*)' in parents/) || [])[1];
      return json({ files: state.folders.filter((f) => f.name === name && f.parent === parent).map((f) => ({ id: f.id, name: f.name })) });
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(opts.body);
      const f = { id: id("folder-"), name: meta.name, parent: meta.parents[0] };
      state.folders.push(f);
      return json({ id: f.id });
    }
    return json({ error: { code: 404 } }, 404);
  }

  return {
    onUser(cb) { state.authCb = cb; setTimeout(() => cb(state.user), 50); },
    async signIn() {
      await wait(200);
      state.user = OWNER;
      setTimeout(() => state.authCb(state.user), 0);
      return { uid: OWNER.uid, token: "fake-token" };
    },
    async reconnect() { await wait(200); return { uid: state.user.uid, token: "fake-token" }; },
    async signOut() { state.user = null; state.listeners = []; state.authCb(null); },
    async classify(payload) {
      state.classifyCalls.push(payload);
      await wait(400 + Math.random() * 500);
      if (state.readfail) { state.readfail = false; throw Object.assign(new Error("rate"), { code: "functions/resource-exhausted", details: { code: "rate_limited" } }); }
      if (!payload || (payload.kind === "pdf" && !payload.pdf) || (payload.kind === "images" && !payload.images?.length)) throw Object.assign(new Error("bad"), { code: "functions/invalid-argument", details: { code: "bad_request" } });
      // Photos read as the birth certificate; a PDF that mentions W-2 as the W-2; anything else as the bill.
      const sample = payload.kind === "images" ? SAMPLES[2] : /W-2/.test(atob(payload.pdf)) ? SAMPLES[1] : SAMPLES[0];
      return { result: structuredClone(sample), model: "fake" };
    },
    watch(name, order, cb) {
      const l = { name, order, cb };
      state.listeners.push(l);
      setTimeout(notify, 0);
      return () => { state.listeners = state.listeners.filter((x) => x !== l); };
    },
    async add(name, data) { if (!allowed()) throw denied(); const k = id(""); state.db.set(`${name}/${k}`, structuredClone(data)); notify(); return k; },
    async get(path) { if (!allowed()) throw denied(); return state.db.has(path) ? structuredClone(state.db.get(path)) : null; },
    async set(path, data) { if (!allowed()) throw denied(); state.db.set(path, structuredClone(data)); notify(); },
    async update(path, data) { if (!allowed()) throw denied(); state.db.set(path, { ...state.db.get(path), ...data }); notify(); },
    async del(path) { if (!allowed()) throw denied(); state.db.delete(path); notify(); },
    fetch: fakeFetch,
  };
}
