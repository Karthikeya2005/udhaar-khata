# Udhaar Khata

A personal-finance ledger that started as a lending tracker. It remembers **who you lent money to, why, and when**, so nobody can say "what money?" later. It also covers everyday money: spending, budgets, savings goals, recurring payments, net worth and monthly reports.

It's a static web app (plain HTML, CSS and JavaScript, no build step) and installs on a phone as a PWA.

![Home](docs/screenshot-home.png)

| Phone | Reports (dark) |
|---|---|
| ![Phone](docs/screenshot-phone.png) | ![Reports](docs/screenshot-reports-dark.png) |

## Features

- **Lending and borrowing**: every loan has a reason, date and due date. Money you owe a friend is tracked the same way.
- **Repayment tracking**: ₹5,000 lent → ₹2,000 returned → ₹3,000 remaining.
- **Automatic reminders**: "Rahul owes you ₹3,000. Due tomorrow." Overdue, due soon and upcoming recurring payments show on Home.
- **Share via WhatsApp**: send a friend a clear summary of the transaction.
- **Search**: by name, reason, month or amount (`Rahul`, `PCB`, `October`, `₹2000`).
- **Monthly reports**: income, spending, lent, saved, a 6-month trend and category breakdown.
- **Budgets**: per-category monthly limits with used and remaining.
- **Savings goals**: target, saved so far, progress.
- **Recurring payments**: rent, hostel, subscriptions, recharge. You confirm each one; nothing is posted automatically.
- **Net worth**: cash + bank + money owed to you − money you owe.
- **Backup and security**: PIN lock and encrypted backup files.
- **Cloud sync (beta, optional)**: sign in with Google and keep the same ledger on every device. Entries are locked with your own passphrase before upload. See [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md).
- **CSV export** of loans and transactions (Settings → Export CSV).

## How the numbers work

- **Account balance** = opening balance + income − spending − money lent + repayments received (and the reverse for money you borrow).
- **Net worth** = cash + bank balances + money owed to you − money you owe.
- **Saved (month)** = income − spending − lent + repaid.
- **Goals** are earmarks inside your balances, not extra money, so they don't change net worth.
- **Recurring payments** only create a transaction when you tap Log.

## Try it

```bash
git clone https://github.com/<your-username>/udhaar-khata.git
cd udhaar-khata
npm start        # serves the folder with `serve`
```

Open the printed URL. Tap **Load sample data** to explore, and **Clear sample data** when done.

## Install on Android

1. Host it (see GitHub Pages below).
2. Open the site in Chrome on your phone.
3. Menu (⋮) → **Install app** or **Add to Home screen**.

It then opens full-screen like a normal app and works offline.

Want a real `.apk`? Paste your Pages URL into [PWABuilder](https://www.pwabuilder.com) and choose Android. It packages the PWA as a Trusted Web Activity.

## Deploy on GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. Your app will be at `https://<your-username>.github.io/udhaar-khata/`.

## Data and privacy

- By default all data is stored in your browser's `localStorage` (key `udhaar-khata.v2`) on your device. There is no server and no account.
- If you turn on cloud sync, entries are encrypted on your device (AES-GCM) and stored in your own Firebase project, readable only by your Google account. Without your passphrase they cannot be read.
- The PIN is hashed with PBKDF2. Backup files are encrypted with AES-GCM using a password you choose.
- Network requests: Google Fonts, plus Firebase only when cloud sync is configured.

## Limits (honest ones)

- No push notifications. Reminders show when you open the app.
- No fingerprint/face unlock. The PIN is a screen lock, not encryption of the stored data.
- Data lives in one browser on one device. **Back up regularly** (Settings → Back up); clearing site data erases it.
- Sync needs your own free Firebase project. Until you set one up, there is no sync between devices.
- If you forget your sync passphrase, the cloud copy cannot be recovered. Keep a backup file.

## Tests

```bash
npm install
npx playwright install chromium
npm test           # end-to-end checks plus a mock-cloud sync test (no Firebase account needed)
npm run shots      # also regenerates docs/ screenshots
```

CI runs the same tests on every push (`.github/workflows/test.yml`).

## Project structure

```
index.html              app shell
styles.css              styles (light and dark)
app.js                  all logic and views
sw.js                   offline service worker
sync.js                 Firebase adapter (optional)
firebase-config.js      your Firebase web config (empty = local only)
firestore.rules         security rules to publish in Firebase
manifest.webmanifest    PWA manifest
icons/                  app icons
tests/e2e.js            Playwright end-to-end tests
tests/sync.js           cloud sync tests against a mock backend
docs/                   screenshots
.github/workflows/      CI
```

## Ideas for later

- Parse UPI/bank SMS into transactions
- Repayment-likelihood score per friend
- Live collaboration on shared expenses
- Push reminders (Firebase Cloud Messaging)

## Licence

MIT, see [LICENSE](LICENSE).
