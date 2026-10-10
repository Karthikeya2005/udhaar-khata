// Regenerates the README screenshots in docs/ (sample data, frozen clock, mock cloud for the sync screens).
//   node tests/shots.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..'), DOCS = path.join(ROOT, 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const store = { meta: {}, items: {} };
function freezeClock() {
  const FIXED = new Date('2026-10-09T10:00:00+05:30').getTime(), R = Date;
  window.Date = class extends R { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } };
}
function mockCloud() {
  const cbs = [];
  const api = {
    onAuth(cb) { cbs.push(cb); setTimeout(() => cb(null), 0); return () => {}; },
    async signIn() { const u = { uid: 'u1', email: 'you@example.com', name: 'You' }; cbs.forEach((c) => c(u)); },
    async signOut() { cbs.forEach((c) => c(null)); },
    getMeta: (uid) => window.__fsGetMeta(uid), setMeta: (uid, o) => window.__fsSetMeta(uid, o),
    listen(uid, cb) { let last = null; const t = setInterval(async () => { const items = await window.__fsList(uid); const j = JSON.stringify(items); if (j !== last) { last = j; cb(items, false); } }, 60); return () => clearInterval(t); },
    set: (uid, id, d) => window.__fsSet(uid, id, d), remove: (uid, id) => window.__fsDel(uid, id)
  };
  const p = Promise.resolve(api);
  Object.defineProperty(window, 'khataCloudP', { get: () => p, set: () => {}, configurable: true });
}
async function ctxFor(browser, opts, mock) {
  const ctx = await browser.newContext(Object.assign({ locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' }, opts));
  if (mock) {
    await ctx.exposeFunction('__fsGetMeta', (uid) => store.meta[uid] || null);
    await ctx.exposeFunction('__fsSetMeta', (uid, o) => { store.meta[uid] = o; });
    await ctx.exposeFunction('__fsList', (uid) => Object.entries(store.items[uid] || {}).map(([id, data]) => ({ id, data })));
    await ctx.exposeFunction('__fsSet', (uid, id, d) => { (store.items[uid] = store.items[uid] || {})[id] = JSON.parse(JSON.stringify(d)); });
    await ctx.exposeFunction('__fsDel', (uid, id) => { if (store.items[uid]) delete store.items[uid][id]; });
  }
  await ctx.addInitScript(freezeClock);
  if (mock) await ctx.addInitScript(mockCloud);
  return ctx;
}
const out = (n) => path.join(DOCS, n);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/index.html';
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const withSamples = async (opts, mock) => {
    const ctx = await ctxFor(browser, opts, mock), page = await ctx.newPage();
    await page.goto(base);
    await page.click('[data-act="load-samples"]');
    await page.waitForSelector('.hero');
    return { ctx, page };
  };
  const wide = { viewport: { width: 1100, height: 1000 }, colorScheme: 'light' };

  let s = await withSamples(wide);
  await s.page.screenshot({ path: out('screenshot-home.png') });
  await s.page.click('.tab[data-tab="lending"]'); await s.page.waitForSelector('.frow');
  await s.page.click('.frow >> nth=0'); await s.page.waitForSelector('.entry');
  await s.page.screenshot({ path: out('screenshot-lending.png') });
  await s.page.click('.tab[data-tab="plan"]'); await s.page.waitForSelector('.brow');
  await s.page.screenshot({ path: out('screenshot-plan.png') });
  await s.ctx.close();

  s = await withSamples({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await s.page.screenshot({ path: out('screenshot-phone.png') });
  await s.ctx.close();

  s = await withSamples({ viewport: { width: 1100, height: 1000 }, colorScheme: 'dark' });
  await s.page.click('.tab[data-tab="reports"]'); await s.page.waitForSelector('#trend svg');
  await s.page.screenshot({ path: out('screenshot-reports-dark.png') });
  await s.ctx.close();

  // sync screens, using the mock cloud
  s = await withSamples({ viewport: { width: 1100, height: 900 }, colorScheme: 'light' }, true);
  await s.page.click('.tools [data-tab="settings"]');
  await s.page.click('[data-act="cloud-signin"]');
  await s.page.waitForSelector('#sync-form');
  await s.page.screenshot({ path: out('screenshot-sync-setup.png') });
  await s.page.fill('#sy-p1', 'correct horse'); await s.page.fill('#sy-p2', 'correct horse');
  await s.page.click('#sync-form button[type="submit"]');
  await s.page.waitForSelector('#sheet:not([hidden]) h2:has-text("Upload this device")');
  await s.page.click('#sheet [data-act="cloud-upload"]');
  await s.page.waitForSelector('#sheet', { state: 'hidden' });
  await new Promise((r) => setTimeout(r, 800));
  await s.page.mouse.move(5, 5);
  await s.page.screenshot({ path: out('screenshot-sync-settings.png'), clip: { x: 0, y: 150, width: 800, height: 560 } });
  await s.ctx.close();

  await browser.close(); server.close();
  console.log('screenshots written to docs/');
})().catch((e) => { console.error(e); process.exit(1); });
