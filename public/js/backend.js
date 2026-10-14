// backend.js: the one object every other module talks to Firebase, Claude and Drive's fetch through.
// `B` is Firebase in production, or tools/fake/fake-backend.js on localhost with ?fake=1. Both
// implement the same interface (docs/v2-contract.md, "Backend interface"); a feature that adds a
// method adds it to both, in the same change.
import { FIREBASE, DRIVE_SCOPE, FAKE, params } from "./config.js";

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
  const provider = (custom) => { const p = new authM.GoogleAuthProvider(); p.addScope(DRIVE_SCOPE); p.setCustomParameters(custom); return p; };
  const tokenOf = (r) => authM.GoogleAuthProvider.credentialFromResult(r)?.accessToken || null;
  return {
    onUser(cb) { authM.onAuthStateChanged(auth, (u) => { uid = u ? u.uid : null; cb(u ? { uid: u.uid, email: u.email || "" } : null); }); },
    async signIn() { const r = await authM.signInWithPopup(auth, provider({ prompt: "select_account" })); return { uid: r.user.uid, token: tokenOf(r) }; },
    // Same account again, for a fresh Drive token (about an hour each). A different pick fails with auth/user-mismatch.
    async reconnect() { const u = auth.currentUser; const r = await authM.reauthenticateWithPopup(u, provider({ login_hint: u.email || "" })); return { uid: r.user.uid, token: tokenOf(r) }; },
    signOut: () => authM.signOut(auth),
    classify: async (payload) => (await classifyFn(payload)).data,
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
