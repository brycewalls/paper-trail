// backend.js: the one object every other module talks to Firebase, Claude and Drive's fetch through.
// `B` is Firebase in production, or tools/fake/fake-backend.js on localhost with ?fake=1. Both
// implement the same interface (docs/web-contract.md, "Backend interface"); a feature that adds a
// method adds it to both, in the same change.
import { FIREBASE, OAUTH, FAKE, params } from "./config.js";

export let B = null;

export async function initBackend() {
  if (FAKE) {
    const { createFakeBackend } = await import(new URL("../tools/fake/fake-backend.js", location.href).href);
    B = createFakeBackend(params);
  } else {
    B = await firebaseBackend();
  }
  return B;
}

async function firebaseBackend() {
  const v = FIREBASE.version;
  const [appM, authM, fsM, fnM] = await Promise.all(["app", "auth", "firestore", "functions"]
    .map((m) => import(`https://www.gstatic.com/firebasejs/${v}/firebase-${m}.js`)));
  const app = appM.initializeApp(FIREBASE.config);
  const auth = authM.getAuth(app);
  const db = fsM.getFirestore(app);
  const classifyFn = fnM.httpsCallable(fnM.getFunctions(app, "us-central1"), "classify", { timeout: 300000 });
  let uid = null;
  const col = (name) => fsM.collection(db, "users", uid, name);
  const ref = (path) => fsM.doc(db, "users", uid, ...path.split("/"));
  const who = (u) => ({ uid: u.uid, email: u.email || "", name: u.displayName || "" });
  return {
    // Firebase keeps the session in IndexedDB (browserLocalPersistence), so a reload stays signed in.
    onUser(cb) { authM.onAuthStateChanged(auth, (u) => { uid = u ? u.uid : null; cb(u ? who(u) : null); }); },
    // The sign-in flow (#15, docs/web-contract.md "Auth"): a full-page redirect to Google; the page
    // comes back through oauthCallback to #/auth/done, redeems the handoff, then signs in.
    authorize(url) { location.assign(url); },
    async redeem({ handoff, state, verifier }) {
      let res;
      try { res = await fetch(OAUTH.redeemPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handoff, state, verifier }), credentials: "same-origin", cache: "no-store" }); }
      catch (e) { throw Object.assign(new Error("The sign-in server couldn't be reached."), { code: "oauth/network", cause: e }); }
      let j = {};
      try { j = await res.json(); } catch { /* not JSON */ }
      if (!res.ok) throw Object.assign(new Error(`Redeem failed (${res.status})`), { code: `oauth/${j.code || "unknown"}` });
      return j;
    },
    // Same Google account, same Firebase project: the same uid as the iPhone app.
    async signInWithTokens({ idToken, accessToken }) {
      const r = await authM.signInWithCredential(auth, authM.GoogleAuthProvider.credential(idToken, accessToken || null));
      uid = r.user.uid;
      return who(r.user);
    },
    signOut: () => authM.signOut(auth),
    classify: async (payload) => (await classifyFn(payload)).data,
    // Any other callable by name, e.g. driveToken (#15). Owners: auth.js (driveToken), classify.js.
    call: async (name, data) => (await fnM.httpsCallable(fnM.getFunctions(app, "us-central1"), name, { timeout: 60000 })(data || {})).data,
    watch(name, order, cb, err) {
      const q = order ? fsM.query(col(name), fsM.orderBy(order, "desc"), fsM.limit(1000)) : col(name);
      return fsM.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), err);
    },
    add: async (name, data) => (await fsM.addDoc(col(name), data)).id,
    get: async (path) => { const s = await fsM.getDoc(ref(path)); return s.exists() ? s.data() : null; },
    set: (path, data) => fsM.setDoc(ref(path), data),
    update: (path, data) => fsM.updateDoc(ref(path), data),
    del: (path) => fsM.deleteDoc(ref(path)),
    fetch: (...a) => fetch(...a),
  };
}
