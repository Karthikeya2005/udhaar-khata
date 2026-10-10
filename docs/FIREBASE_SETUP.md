# Turn on cloud sync (Firebase, free)

Cloud sync is optional. Without it the app works exactly as before, with data stored on each device.
With it, you sign in with Google and the same ledger shows on your phone and computer.

Firebase's free Spark plan is enough. It needs no card.

## 1. Create the project
1. Go to <https://console.firebase.google.com> and click **Add project**. Name it anything (for example `udhaar-khata`).
2. You can turn Google Analytics off.

## 2. Turn on Google sign-in
1. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
2. Pick your email as the support email and save.
3. **Authentication → Settings → Authorized domains → Add domain**: add `karthikeya2005.github.io` (your GitHub Pages host).
   `localhost` is already allowed for local testing.

## 3. Create the database (production mode)
1. **Build → Firestore Database → Create database**.
2. Choose a location near you (for example `asia-south1`, Mumbai).
3. Choose **Start in production mode**. Never choose test mode, because test mode leaves the database open.
4. Open the **Rules** tab, replace everything with the contents of `firestore.rules` from this repo, and click **Publish**.

The rules say: a signed-in user can read and write only `users/<their own id>/...`. Everything else is denied.

## 4. Get your web config
1. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app (no hosting needed).
2. Copy the `firebaseConfig` values.
3. Paste them into `firebase-config.js`:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  appId: "1:1234567890:web:abcdef"
};
```

These values are identifiers, not passwords. They are safe in a public repo. The security comes from login plus the rules in step 3.

## 5. Try it locally, then deploy
```bash
npm start          # opens http://localhost:3000
```
Open **Settings → Cloud sync → Sign in with Google**, choose a sync passphrase, and your entries upload.
On your phone, open the site, sign in with the same Google account, and enter the same passphrase.

When it works, commit and push. Pages redeploys in about a minute.

## How your data is protected
- **Login:** only your Google account can read your documents (Firestore rules).
- **Passphrase lock:** entries are encrypted on your device (AES-GCM, key from PBKDF2 with 200,000 rounds) before upload. The database holds only scrambled text, plus a random salt and a check value. Neither Google, the project owner nor this app's code can read it without your passphrase.
- **Forget the passphrase and the cloud copy cannot be recovered.** Keep a backup file (Settings → Back up).
- **"Remember it on this device"** stores the derived key in this browser. Untick it on a shared computer. Sign out removes it.

## Troubleshooting
- **"Sign-in failed"**: the site's domain is missing from Authentication → Settings → Authorized domains.
- **Popup is blocked on a phone**: the app falls back to a redirect sign-in. If that loops in the Android APK, sign in once in Chrome and use the PWA install instead.
- **"Missing or insufficient permissions"**: the rules were not published, or you are signed in with a different account.
