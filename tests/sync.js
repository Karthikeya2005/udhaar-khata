// Cloud-sync test with a mock backend (no Firebase account needed).
// The mock keeps one shared "Firestore" in Node, so two browser contexts act as two devices.
// It checks: sign-in, passphrase setup, upload, that the stored data is encrypted, a second device
// reading it with the passphrase, remembered key on reload, deletes, sign-out and CSV export.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, '=>', detail === undefined ? '' : JSON.stringify(detail)); }
};
const sq = (t) => String(t).replace(/\s+/g, '').toLowerCase();
const has = (t, s) => sq(t).includes(sq(s));

const store = { meta: {}, items: {} };

function freezeClock() {
  const FIXED = new Date('2026-10-09T10:00:00+05:30').getTime(), R = Date;
  window.Date = class extends R { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } };
}
function mockCloud() {
  const cbs = [];
  const api = {
    onAuth(cb) { cbs.push(cb); const u = localStorage.getItem('mock-user'); setTimeout(() => cb(u ? JSON.parse(u) : null), 0); return () => {}; },
    async signIn() { const u = { uid: 'u1', email: 'me@test.dev', name: 'Me' }; localStorage.setItem('mock-user', JSON.stringify(u)); cbs.forEach((c) => c(u)); },
    async signOut() { localStorage.removeItem('mock-user'); cbs.forEach((c) => c(null)); },
    getMeta: (uid) => window.__fsGetMeta(uid),
    setMeta: (uid, o) => window.__fsSetMeta(uid, o),
    listen(uid, cb) {
      let last = null;
      const t = setInterval(async () => { const items = await window.__fsList(uid); const j = JSON.stringify(items); if (j !== last) { last = j; cb(items, false); } }, 60);
      return () => clearInterval(t);
    },
    set: (uid, id, d) => window.__fsSet(uid, id, d),
    remove: (uid, id) => window.__fsDel(uid, id)
  };
  const p = Promise.resolve(api);
  Object.defineProperty(window, 'khataCloudP', { get: () => p, set: () => {}, configurable: true });
}

async function device(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', acceptDownloads: true });
  await ctx.exposeFunction('__fsGetMeta', (uid) => store.meta[uid] || null);
  await ctx.exposeFunction('__fsSetMeta', (uid, o) => { store.meta[uid] = o; });
  await ctx.exposeFunction('__fsList', (uid) => Object.entries(store.items[uid] || {}).map(([id, data]) => ({ id, data })));
  await ctx.exposeFunction('__fsSet', (uid, id, d) => { (store.items[uid] = store.items[uid] || {})[id] = JSON.parse(JSON.stringify(d)); });
  await ctx.exposeFunction('__fsDel', (uid, id) => { if (store.items[uid]) delete store.items[uid][id]; });
  await ctx.addInitScript(freezeClock);
  await ctx.addInitScript(mockCloud);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(base);
  return { ctx, page, errors };
}
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const openSettings = (page) => page.click('.tools [data-tab="settings"]');

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/index.html';
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ---- device A: has local data, turns sync on
  const A = await device(browser, base);
  await A.page.waitForSelector('.empty h2');
  await A.page.click('[data-act="load-samples"]');
  await A.page.waitForSelector('.hero');
  await openSettings(A.page);
  check('sync card offers sign-in', has(await text(A.page, '.view'), 'Sign in with Google'));
  await A.page.click('[data-act="cloud-signin"]');
  await A.page.waitForSelector('#sync-form');
  check('setup sheet opens after first sign-in', has(await text(A.page, '#sheet'), 'Set up cloud sync'));
  if (process.env.SHOT) await A.page.screenshot({ path: process.env.SHOT + '-sheet.png' });
  await A.page.fill('#sy-p1', 'short'); await A.page.fill('#sy-p2', 'short');
  await A.page.click('#sync-form button[type="submit"]');
  check('short passphrase refused', has(await text(A.page, '#sy-err'), 'at least 8'));
  await A.page.fill('#sy-p1', 'correct horse'); await A.page.fill('#sy-p2', 'different one');
  await A.page.click('#sync-form button[type="submit"]');
  check('mismatched passphrase refused', has(await text(A.page, '#sy-err'), 'do not match'));
  await A.page.fill('#sy-p2', 'correct horse');
  await A.page.click('#sync-form button[type="submit"]');
  await A.page.waitForSelector('#sheet:not([hidden]) h2:has-text("Upload this device")');
  check('offers to upload the local entries', has(await text(A.page, '#sheet'), 'Upload this device'));
  const localCount = await A.page.evaluate(() => JSON.parse(localStorage.getItem('udhaar-khata.v2')).length);
  await A.page.click('#sheet [data-act="cloud-upload"]');
  await new Promise((r) => setTimeout(r, 600));
  const stored = Object.values(store.items.u1 || {});
  check('all entries uploaded', stored.length === localCount, [stored.length, localCount]);
  check('stored entries are encrypted', stored.every((d) => d.ct && d.iv && !d.friend && !d.amount), stored[0]);
  check('nothing readable in the cloud copy', !JSON.stringify(store).includes('Rahul') && !JSON.stringify(store).includes('PCB'));
  check('meta holds salt and check only', store.meta.u1 && store.meta.u1.enc === true && store.meta.u1.salt && !JSON.stringify(store.meta.u1).includes('correct horse'));
  await A.page.click('.tab[data-tab="home"]');
  await A.page.waitForSelector('.hero');
  check('device A shows net worth from cloud', (await text(A.page, '.hero')) === '₹21,913', await text(A.page, '.hero'));
  check('footer says synced and locked', has(await text(A.page, '.foot'), 'Synced to your account and locked'), await text(A.page, '.foot'));

  if (process.env.SHOT) { await openSettings(A.page); await A.page.screenshot({ path: process.env.SHOT + '-settings.png' }); }

  // ---- device B: fresh browser, reads the same account
  const B = await device(browser, base);
  await B.page.waitForSelector('.empty h2');
  await openSettings(B.page);
  await B.page.click('[data-act="cloud-signin"]');
  await B.page.waitForSelector('#sync-form');
  check('device B is asked to unlock, not to set up', has(await text(B.page, '#sheet'), 'Unlock cloud sync'));
  await B.page.fill('#sy-p1', 'wrong passphrase');
  await B.page.click('#sync-form button[type="submit"]');
  await B.page.waitForSelector('#sy-err:not([hidden])');
  check('wrong passphrase refused', has(await text(B.page, '#sy-err'), 'not right'));
  await B.page.fill('#sy-p1', 'correct horse');
  await B.page.click('#sync-form button[type="submit"]');
  await B.page.waitForSelector('#sheet', { state: 'hidden' });
  await B.page.click('.tab[data-tab="home"]');
  await B.page.waitForSelector('.hero');
  check('device B sees the same net worth', (await text(B.page, '.hero')) === '₹21,913', await text(B.page, '.hero'));
  await B.page.click('.tab[data-tab="lending"]');
  check('device B sees the loan reason', has(await text(B.page, '.view'), 'Rahul'), '');

  // ---- remembered key: device A reloads and opens straight into the cloud copy
  await A.page.reload();
  await A.page.waitForSelector('.hero');
  check('reload opens cloud data without asking', (await text(A.page, '.hero')) === '₹21,913' && (await A.page.$('#sync-form')) === null);

  // ---- a delete on A reaches B
  await A.page.click('[data-act="clear-samples"]');
  await new Promise((r) => setTimeout(r, 1500));
  check('delete reaches the cloud', Object.keys(store.items.u1 || {}).length === 0, Object.keys(store.items.u1 || {}).length);
  await B.page.click('.tab[data-tab="home"]');
  await B.page.waitForSelector('.empty h2', { timeout: 5000 });
  check('device B updates after the delete', has(await text(B.page, '.empty h2'), 'Start your ledger'), await text(B.page, '.empty h2'));

  // ---- sign out returns to the device copy; CSV export
  await openSettings(A.page);
  await A.page.click('[data-act="cloud-signout"]');
  await A.page.waitForSelector('[data-act="cloud-signin"]');
  check('signed out shows sign-in again', has(await text(A.page, '.view'), 'Sign in with Google'));
  check('remembered key is forgotten on sign-out', await A.page.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith('udhaar-khata.ck.'))));
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('[data-act="export-csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('csv has a header and a BOM', csv.startsWith('﻿Date,Type,Friend,Category,Note or reason,Amount,Repaid,Balance,Due,Method'), csv.slice(0, 60));
  check('csv has the Rahul loan row', /Lent,Rahul,,PCB components for his project,5000,2000,3000/.test(csv), csv.split('\r\n').filter((l) => /Rahul/.test(l)));
  check('csv has expense rows', /Expense,,Food/.test(csv));

  const errs = A.errors.concat(B.errors);
  console.log('\nerrors:', errs.length ? errs : 'none');
  await browser.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
