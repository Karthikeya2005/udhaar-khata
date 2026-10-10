// Firebase adapter. Exposes a small, plain API through window.khataCloudP so app.js never touches the SDK.
// Loaded as an ES module. If the config is empty or the SDK cannot load, the app stays in local-only mode.
const cfg = window.FIREBASE_CONFIG;
if (cfg) {
  (async () => {
    try {
      const V = '10.14.1', B = 'https://www.gstatic.com/firebasejs/' + V + '/';
      const [appM, authM, fsM] = await Promise.all([
        import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')
      ]);
      const app = appM.initializeApp(cfg);
      const auth = authM.getAuth(app);
      const db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
      const items = (uid) => fsM.collection(db, 'users', uid, 'items');
      const toUser = (u) => u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null;

      authM.getRedirectResult(auth).catch(() => {});
      window.__khataResolve({
        onAuth(cb) { return authM.onAuthStateChanged(auth, (u) => cb(toUser(u))); },
        async signIn() {
          const p = new authM.GoogleAuthProvider();
          try { await authM.signInWithPopup(auth, p); }
          catch (e) {
            if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) { await authM.signInWithRedirect(auth, p); return; }
            throw e;
          }
        },
        signOut() { return authM.signOut(auth); },
        async getMeta(uid) { const s = await fsM.getDoc(fsM.doc(db, 'users', uid, 'meta', 'crypto')); return s.exists() ? s.data() : null; },
        setMeta(uid, obj) { return fsM.setDoc(fsM.doc(db, 'users', uid, 'meta', 'crypto'), obj); },
        listen(uid, cb, err) {
          return fsM.onSnapshot(items(uid), (snap) => cb(snap.docs.map((d) => ({ id: d.id, data: d.data() })), snap.metadata.fromCache), err);
        },
        set(uid, id, data) { return fsM.setDoc(fsM.doc(db, 'users', uid, 'items', id), data); },
        remove(uid, id) { return fsM.deleteDoc(fsM.doc(db, 'users', uid, 'items', id)); }
      });
    } catch (e) {
      console.error('Cloud sync could not start', e);
      window.__khataResolve(null);
    }
  })();
}
