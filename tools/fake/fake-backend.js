// In-memory stand-ins for Firebase Auth, Firestore, the classify function and the Drive REST API,
// so the deck can be exercised on localhost with no Google account, no key and no network:
//   node tools/serve.mjs, then http://localhost:5178/public/index.html?fake=1
// The page only loads this on localhost with ?fake in the address; it is not deployed (Hosting
// serves public/ only). Options, all in the query string:
//   as=stranger      sign in as an account that isn't on the allowlist (the private screen)
//   signedout        start signed out (the sign-in screen)
//   nodrive          start without a Drive token (the Connect Drive link)
//   drive401         the first upload gets a 401, to exercise Reconnect Drive
//   readfail         the first read fails with rate_limited, to exercise Try again; readfail=N fails
//                    the first N calls (the reading queue retries a rate limit twice by itself)
// Added for the web v2 build (#83, docs/web-contract.md, "Fake backend"):
//   seed             start with a filed library: docs in every pile and state, paperless senders in
//                    every status, two sender rules and config/settings (for Piles, Search, Paperless)
//   unsure           reads that ask for confidence come back unsure of the sender and the date, with
//                    alternatives (the A2 card and the check-fields sheet)
//   driverevoked     the driveToken callable answers drive_revoked (Reconnect Drive, spec 4.16)
//   offline          every Drive request fails as a network error (the outbox's offline state)
//   slowupload       uploads take about 4 seconds, so progress and the undo hold can be watched
//   dupe=<sha256>    a filed doc ("2025 W-2", filed Oct 2) with that contentHash, so a capture of
//                    the same bytes shows the duplicate line (#2). Tests pass the hash of the file
//                    they import; an imported PDF is filed byte for byte, so its hash is the file's
//   splitfail        split mode answers bad_request, like a function deployed before split mode
// Drive also answers files.get (metadata with a real md5Checksum), files.update with trashed: true,
// alt=media downloads and fullText search over what was uploaded; B.call("driveToken") mints the
// fake token.
// Everything it saw is on window.__PT_FAKE__ for tests: files uploaded (with their bytes),
// folders, classify payloads and the Firestore records.

const SAMPLES = [
  { title: "Duke Energy bill, March 2024", docType: "Utility bill", issuer: "Duke Energy", docDate: "2024-03-12", summary: "Electric bill for $84.12 on the account ending 4411.", folder: "06 Home", filename: "2024-03-12_duke-energy-electric-bill", verdict: "shred", verdictReason: "Duke Energy keeps every statement online, and nothing on this one is still needed.", retention: "Not needed", sensitive: false, paperless: { possible: true, issuer: "Duke Energy", how: "Sign in at duke-energy.com, then Billing and Payment, then Paperless Billing." } },
  { title: "W-2 from Acme Corp, 2023", docType: "W-2", issuer: "Acme Corp", docDate: "2024-01-26", summary: "Wage and tax statement showing $61,400 in wages for 2023.", folder: "02 Taxes", filename: "2024-01-26_acme-corp-w2-2023", verdict: "scan_shred", verdictReason: "Tax backup is worth a digital copy, but the paper itself has no legal value.", retention: "Keep 7 years (tax backup)", sensitive: true, paperless: { possible: true, issuer: "Acme Corp", how: "Turn on electronic W-2 delivery in the payroll portal." } },
  { title: "Birth certificate, Bryce Walls", docType: "Birth certificate", issuer: "State of North Carolina", docDate: "1996-05-02", summary: "Certified copy with a raised seal.", folder: "01 Identity & Legal", filename: "1996-05-02_nc-birth-certificate", verdict: "keep_original", verdictReason: "A certified birth certificate with a raised seal has to stay on paper.", retention: "Permanently", sensitive: true, paperless: { possible: false, issuer: "", how: "" } },
];

import { md5 } from "../../public/js/md5.js";

// A filed library for ?seed. Dates are relative to today so holds and "check back" stay current.
function seedLibrary(db) {
  const day = 86400000, now = Date.now();
  const iso = (d) => new Date(now - d * day).toISOString();
  const ymd = (d) => iso(d).slice(0, 10);
  const doc = (id, f) => db.set(`docs/${id}`, {
    title: "", docType: "", issuer: "", docDate: "", summary: "", folder: "11 Other", filename: id, verdict: "scan_shred", verdictReason: "",
    retention: "", sensitive: false, paperless: { possible: false, issuer: "", how: "" }, pages: 1, filed: true,
    driveId: `seed-${id}`, driveUrl: `https://drive.google.com/file/d/seed-${id}/view`, physical: "to_shred", filedAt: iso(1), shreddedAt: "", ...f });
  doc("w2-2023", { title: "2023 W-2", docType: "W-2", issuer: "Northwind Logistics", docDate: "2024-01-30", folder: "02 Taxes", filename: "2024-01-30_W-2_Northwind-Logistics",
    verdictReason: "Box 1 wages matter for taxes. The IRS has its own copy.", retention: "Keep 7 years", sensitive: true, physical: "to_shred",
    filedAt: iso(9), verifiedAt: iso(9), verifiedPages: 1, source: "ios", amount: "61400.00",
    fullText: "Form W-2 Wage and Tax Statement 2023. Northwind Logistics. Box 1 wages, tips, other compensation 61,400.00.", searchTerms: ["2023", "w-2", "northwind", "logistics", "taxes"] });
  doc("w2-2023-c", { title: "2023 W-2, corrected", docType: "W-2", issuer: "Northwind Logistics", docDate: "2024-03-02", folder: "02 Taxes", filename: "2024-03-02_W-2c_Northwind-Logistics",
    retention: "Keep 7 years", sensitive: true, physical: "to_shred", filedAt: iso(1), verifiedAt: iso(1), verifiedPages: 1, source: "ios",
    fullText: "Form W-2c Corrected Wage and Tax Statement 2023.", searchTerms: ["2023", "w-2", "corrected", "northwind"] });
  doc("1099-int", { title: "2023 1099-INT", docType: "1099-INT", issuer: "Harbor Federal CU", docDate: "2024-01-31", folder: "02 Taxes", filename: "2024-01-31_1099-INT_Harbor-Federal",
    retention: "Keep 7 years", sensitive: true, physical: "shredded", shreddedAt: iso(20), filedAt: iso(25), verifiedAt: iso(25), source: "ios", searchTerms: ["2023", "1099-int", "harbor"] });
  doc("pharmacy", { title: "Pharmacy receipt", docType: "Receipt", issuer: "Elm Street Pharmacy", docDate: ymd(60), folder: "05 Medical", filename: `${ymd(60)}_Receipt_Elm-Street-Pharmacy`,
    retention: "Keep for HSA, 3 years", sensitive: true, physical: "to_shred", filedAt: iso(6), verifiedAt: iso(6), verifiedPages: 1, source: "ios" });
  doc("electric-aug", { title: "Electric bill, August", docType: "Utility bill", issuer: "Cascade Power & Light", docDate: ymd(70), folder: "06 Home", filename: `${ymd(70)}_electric-bill`,
    verdict: "shred", retention: "Not needed", physical: "to_shred", filed: false, driveId: "", driveUrl: "", filedAt: iso(5),
    paperless: { possible: true, issuer: "Cascade Power & Light", how: "Account settings, then Billing, then Paper bill off." } });
  doc("electric-sep", { title: "Electric bill, September", docType: "Utility bill", issuer: "Cascade Power & Light", docDate: ymd(18), folder: "06 Home", filename: `${ymd(18)}_electric-bill`,
    verdict: "scan_shred", retention: "Keep 1 year", physical: "to_shred", filedAt: iso(0), source: "ios" });
  doc("car-title", { title: "Vehicle title", docType: "Title", issuer: "DMV", docDate: "2021-06-14", folder: "07 Auto", filename: "2021-06-14_vehicle-title",
    verdict: "keep_original", verdictReason: "A title is the legal proof of ownership. Keep the paper.", retention: "Keep while you own the car", sensitive: true, physical: "keep", filedAt: iso(3), verifiedAt: iso(3), source: "ios" });
  doc("birth-cert", { title: "Birth certificate", docType: "Birth certificate", issuer: "State of North Carolina", docDate: "1996-05-02", folder: "01 Identity & Legal", filename: "1996-05-02_birth-certificate",
    verdict: "keep_original", retention: "Permanently", sensitive: true, physical: "stored", filedAt: iso(40) });
  const sender = (id, f) => db.set(`paperless/${id}`, { issuer: "", how: "", status: "todo", firstSeen: iso(90), ...f });
  sender("cascade-power-light", { issuer: "Cascade Power & Light", how: "Account settings, then Billing, then Paper bill off.", status: "requested",
    requestedAt: iso(20), checkBackAt: new Date(now + 15 * day).toISOString(), stillMailingAt: iso(2), lastSeen: iso(2), steps: ["Account settings", "Billing", "Paper bill off"] });
  sender("summit-health-plan", { issuer: "Summit Health Plan", how: "Member portal, then Preferences, then Go paperless.", status: "waiting_cycle", checkBackAt: new Date(now + 13 * day).toISOString() });
  sender("brightline-wireless", { issuer: "Brightline Wireless", how: "Account settings, then Billing, then Paper bill off.", status: "todo" });
  sender("harbor-federal-cu", { issuer: "Harbor Federal CU", how: "Online banking, then Statements, then eStatements.", status: "done", doneAt: iso(60) });
  sender("dmv", { issuer: "DMV", how: "Registration renewals still come by mail.", status: "skip" });
  db.set("senders/cascade-power-light", { key: "cascade-power-light", issuer: "Cascade Power & Light", folder: "06 Home", verdict: "scan_shred", docType: "Utility bill",
    filenamePattern: "{date}_{issuer}-electric-bill", updatedAt: iso(9) });
  db.set("senders/northwind-logistics", { key: "northwind-logistics", issuer: "Northwind Logistics", folder: "02 Taxes", verdict: "scan_shred", updatedAt: iso(30) });
  db.set("config/settings", { shredHoldDays: 3 });
}

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
    readfail: params.has("readfail") ? Math.max(1, Number(params.get("readfail")) || 1) : 0,
    unsure: params.has("unsure"),
    driveRevoked: params.has("driverevoked"),
    offline: params.has("offline"),
    slowUpload: params.has("slowupload"),
    calls: [],                 // { name, data } for every B.call
    authCb: null,
    nextId: 1,
  };
  window.__PT_FAKE__ = state;
  if (params.has("seed")) seedLibrary(state.db);
  if (params.get("dupe")) state.db.set("docs/dupe-w2", { title: "2025 W-2", docType: "W-2", issuer: "Northwind Logistics", docDate: "2026-01-30", folder: "02 Taxes",
    filename: "2026-01-30_W-2_Northwind-Logistics", verdict: "scan_shred", filed: true, physical: "to_shred", pages: 1, source: "web",
    filedAt: `${new Date().getFullYear()}-10-02T15:00:00.000Z`, contentHash: params.get("dupe").toLowerCase() });
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
    if (state.offline) throw new TypeError("Failed to fetch");
    const u = new URL(url);
    const method = (opts.method || "GET").toUpperCase();
    const auth = (opts.headers && opts.headers.Authorization) || "";
    if (!/^Bearer fake-token/.test(auth)) return json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401);
    if (u.hostname === "fake-upload.test" && method === "PUT") {
      const meta = state.sessions.get(url);
      if (!meta) return json({ error: { code: 404 } }, 404);
      const bytes = new Uint8Array(await opts.body.arrayBuffer());
      if (state.slowUpload) await wait(4000);
      const file = { id: id("file-"), name: meta.name, parents: meta.parents, mimeType: meta.mimeType, size: bytes.length, bytes, md5Checksum: md5(bytes), trashed: false };
      state.files.push(file);
      return json({ id: file.id, webViewLink: `https://drive.google.com/file/d/${file.id}/view`, md5Checksum: file.md5Checksum, size: String(file.size) });
    }
    if (u.pathname === "/upload/drive/v3/files" && method === "POST") {
      if (state.drive401) { state.drive401 = false; return json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401); }
      const meta = JSON.parse(opts.body);
      if (!state.folders.some((f) => f.id === meta.parents[0])) return json({ error: { code: 404, errors: [{ reason: "notFound" }] } }, 404);
      const session = `https://fake-upload.test/session/${id("s")}`;
      state.sessions.set(session, meta);
      return new Response(null, { status: 200, headers: { Location: session } });
    }
    const one = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (one) {
      const f = state.files.find((x) => x.id === one[1]);
      if (!f) return json({ error: { code: 404, errors: [{ reason: "notFound" }] } }, 404);
      if (method === "PATCH") { Object.assign(f, JSON.parse(opts.body || "{}")); return json({ id: f.id, trashed: f.trashed }); }
      if (u.searchParams.get("alt") === "media") return new Response(f.bytes, { status: 200, headers: { "Content-Type": f.mimeType || "application/pdf" } });
      return json({ id: f.id, name: f.name, md5Checksum: f.md5Checksum, size: String(f.size), trashed: !!f.trashed, parents: f.parents, webViewLink: `https://drive.google.com/file/d/${f.id}/view` });
    }
    if (u.pathname === "/drive/v3/files" && method === "GET" && /fullText contains/.test(u.searchParams.get("q") || "")) {
      const term = ((u.searchParams.get("q").match(/fullText contains '((?:[^'\\]|\\.)*)'/) || [])[1] || "").toLowerCase();
      const hits = state.files.filter((f) => !f.trashed && (f.name.toLowerCase().includes(term) || new TextDecoder("latin1").decode(f.bytes).toLowerCase().includes(term)));
      return json({ files: hits.map((f) => ({ id: f.id, name: f.name, parents: f.parents, webViewLink: `https://drive.google.com/file/d/${f.id}/view` })) });
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
      if (state.readfail > 0) { state.readfail--; throw Object.assign(new Error("rate"), { code: "functions/resource-exhausted", details: { code: "rate_limited" } }); }
      if (!payload || (payload.kind === "pdf" && !payload.pdf) || (payload.kind === "images" && !payload.images?.length)) throw Object.assign(new Error("bad"), { code: "functions/invalid-argument", details: { code: "bad_request" } });
      // Split mode (#19): a new document starts at every page whose text says "page 1".
      if (payload.mode === "split") {
        if (params.has("splitfail")) throw Object.assign(new Error("bad"), { code: "functions/invalid-argument", details: { code: "bad_request" } });
        const pages = payload.pages || [];
        const starts = pages.map((p, i) => (i === 0 || /\bpage 1\b/i.test(p.text || "") ? i : -1)).filter((i) => i >= 0);
        return { split: { documents: starts.map((s, k) => ({ start: s, end: (starts[k + 1] ?? pages.length) - 1, label: String(pages[s].text || "Document").split(/\s+/).slice(0, 4).join(" ").slice(0, 60) })) }, model: "fake" };
      }
      // Photos read as the birth certificate; a PDF that mentions W-2 as the W-2; anything else as the bill.
      const sample = payload.kind === "images" ? SAMPLES[2] : payload.pdf && /W-2/.test(atob(payload.pdf)) ? SAMPLES[1] : SAMPLES[0];
      const result = structuredClone(sample);
      // Confidence (#20), sparse: only the unsure fields are listed.
      if (payload.wantConfidence) {
        result.confidence = state.unsure && sample === SAMPLES[0]
          ? { overall: 0.55, fields: { issuer: 0.6, docDate: 0.55 }, sparse: true } : { overall: 1, fields: {}, sparse: true };
        if (state.unsure && sample === SAMPLES[0]) result.alternatives = { issuer: ["Duke Energy Progress"], docDate: ["2024-03-28"] };
      }
      // Sender rules (#21): the rule whose key is the slug of the issuer applies.
      const key = String(result.issuer || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const rule = (payload.senderHints || []).find((r) => r.key === key);
      if (rule) { for (const f of ["folder", "verdict", "docType"]) if (rule[f]) result[f] = rule[f]; result.appliedRule = rule.key; }
      return { result, model: "fake" };
    },
    // Callables other than classify (#15). driveToken mints the fake token unless ?driverevoked.
    async call(name, data) {
      state.calls.push({ name, data });
      await wait(150);
      if (!state.user) throw Object.assign(new Error("Sign in first."), { code: "functions/unauthenticated", details: { code: "signed_out" } });
      if (!allowed()) throw Object.assign(new Error("This app is private."), { code: "functions/permission-denied", details: { code: "not_allowed" } });
      if (name === "driveToken") {
        if (state.driveRevoked) throw Object.assign(new Error("Drive needs reconnecting."), { code: "functions/failed-precondition", details: { code: "drive_revoked" } });
        return { accessToken: "fake-token", expiresIn: 3600, expiresAt: new Date(Date.now() + 3600000).toISOString() };
      }
      if (name === "classify") return this.classify(data);
      throw Object.assign(new Error(`No callable ${name}`), { code: "functions/not-found", details: { code: "bad_request" } });
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
