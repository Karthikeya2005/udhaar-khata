// End-to-end test for Udhaar Khata.
//
// Opens index.html in headless Chromium with the clock frozen at 9 Oct 2026, loads the built-in
// sample data and checks the app's numbers against values worked out by hand:
//   cash 2,500 - food 1,650                                       = 850
//   bank 14,000 + income 12,500 - spending 6,637 - lent 5,000
//        + repaid 2,000 + borrowed 800                            = 17,663
//   owed to you 3,000 + 1,200, you owe 800  =>  net worth 850 + 17,663 + 4,200 - 800 = 21,913
//
// Run:  npm test            (add --shots to refresh the README screenshots in docs/)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Serve the folder over http (module scripts do not load from file://).
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
let URL = '';
const DOCS = path.resolve(__dirname, '..', 'docs');
const SHOTS = process.argv.includes('--shots');

let pass = 0, fail = 0;
const sq = (t) => String(t).replace(/\s+/g, '').toLowerCase();
const has = (t, s) => sq(t).includes(sq(s));
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, '=>', detail === undefined ? '' : JSON.stringify(detail)); }
};

// Freeze "today" so the sample data and every date-based figure is repeatable.
function freezeClock() {
  const FIXED = new Date('2026-10-09T10:00:00+05:30').getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
    static now() { return FIXED; }
  }
  window.Date = FakeDate;
}

async function newPage(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' }, opts));
  await ctx.addInitScript(freezeClock);
  return { ctx, page: await ctx.newPage() };
}

async function screenshots(browser) {
  const withSamples = async (opts) => {
    const { ctx, page } = await newPage(browser, opts);
    await page.goto(URL);
    await page.click('[data-act="load-samples"]');
    await page.waitForSelector('.hero');
    return { ctx, page };
  };
  let s = await withSamples({ viewport: { width: 1100, height: 1000 }, colorScheme: 'light' });
  await s.page.screenshot({ path: path.join(DOCS, 'screenshot-home.png') });
  await s.ctx.close();
  s = await withSamples({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await s.page.screenshot({ path: path.join(DOCS, 'screenshot-phone.png') });
  await s.ctx.close();
  s = await withSamples({ viewport: { width: 1100, height: 1000 }, colorScheme: 'dark' });
  await s.page.click('.tab[data-tab="reports"]');
  await s.page.waitForSelector('#trend svg');
  await s.page.screenshot({ path: path.join(DOCS, 'screenshot-reports-dark.png') });
  await s.ctx.close();
  console.log('screenshots written to docs/');
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  URL = 'http://localhost:' + server.address().port + '/index.html';
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const { ctx, page } = await newPage(browser, { viewport: { width: 1100, height: 900 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.waitForSelector('.empty h2');
  check('welcome shown on empty ledger', (await page.textContent('.empty h2')) === 'Start your ledger');

  await page.click('[data-act="load-samples"]');
  await page.waitForSelector('.hero');
  const txt = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

  // home
  check('net worth', (await txt('.hero')) === '₹21,913', await txt('.hero'));
  const nwRows = await txt('.nw .tally');
  check('net worth rows', has(nwRows, 'Cash₹850') && has(nwRows, 'Bank₹17,663') && has(nwRows, 'Owed to you₹4,200') && has(nwRows, 'You owe₹800'), nwRows);
  const rems = await page.$$eval('.rem .rem-text > div:nth-child(2)', (els) => els.map((e) => e.textContent));
  check('five reminders', rems.length === 5, rems);
  check('Rahul reminder wording', rems.includes('Rahul owes you ₹3,000. Due tomorrow.'), rems);
  check('Sneha overdue reminder', rems.includes('Sneha owes you ₹1,200. Overdue by 10 days.'), rems);
  const stats = await txt('.stats');
  check('home month stats', has(stats, 'Income₹12,500') && has(stats, 'Spending₹8,287') && has(stats, 'Lent₹5,000') && has(stats, 'Saved₹2,013'), stats);
  check('footer says device only', has(await txt('.foot'), 'Saved on this device only'), await txt('.foot'));

  // reports
  await page.click('.tab[data-tab="reports"]');
  await page.waitForSelector('#trend svg');
  const led = await txt('.tally');
  check('report ledger', has(led, 'Income₹12,500') && has(led, 'Spending₹8,287') && has(led, 'Lent to friends₹5,000') && has(led, 'Repaid to you₹2,000') && has(led, 'Borrowed₹800') && has(led, 'Saved₹2,013'), led);
  check('vs last month', has(await txt('.view'), '₹881 lower than in September'));
  check('six month bands', (await page.$$('#trend .band')).length === 6);
  check('top category is Hostel', sq(await txt('.cbar')).startsWith(sq('Hostel & rent₹3,500')));
  await page.click('[data-act="month"][data-d="-1"]');
  const sep = await txt('.tally');
  check('September report', has(sep, 'Income₹11,000') && has(sep, 'Spending₹9,168') && has(sep, 'Lent to friends₹1,500') && has(sep, 'Repaid to you₹300') && has(sep, 'Saved₹632'), sep);
  await page.click('[data-act="month"][data-d="1"]');

  // plan
  await page.click('.tab[data-tab="plan"]');
  await page.waitForSelector('.brow');
  const plan = await txt('.view');
  check('food budget', has(plan, 'Food₹1,650 of ₹2,500₹850 left'), plan.slice(0, 400));
  check('education over budget', has(plan, 'Education & projects₹1,250 of ₹1,000Over by ₹250Over budget'));
  check('shopping close to limit', has(plan, 'Shopping₹799 of ₹900₹101 leftClose to limit'));
  check('laptop goal', has(plan, 'Laptop₹24,000 of ₹60,000 · 40%') && has(plan, '₹36,000 to go'));
  check('fixed costs', has(plan, 'about ₹3,998 a month'));

  // lending
  await page.click('.tab[data-tab="lending"]');
  await page.waitForSelector('.frow');
  const strip = await txt('.strip');
  check('lending strip', has(strip, 'Owed to you₹4,200') && has(strip, 'Overdue₹1,200') && has(strip, 'You owe₹800'), strip);
  await page.click('.frow[data-key="rahul"]');
  const acct = await txt('.acct');
  check('Rahul account', has(acct, 'Lent₹5,000') && has(acct, 'Received back₹2,000') && has(acct, 'Pending₹3,000'), acct.slice(0, 300));
  await page.click('[data-act="share-loan"]');
  const share = await page.inputValue('#m-text');
  check('share text', /Remaining: ₹3,000/.test(share) && /Received ₹2,000/.test(share) && /PCB components/.test(share), share);
  check('whatsapp link', (await page.getAttribute('#m-wa', 'href')).startsWith('https://wa.me/?text='));
  await page.keyboard.press('Escape');

  // search
  await page.click('[data-act="goto"][data-tab="search"]');
  await page.fill('#q', 'pcb');
  check('search pcb', (await txt('.sumline')).startsWith('5 results'), await txt('.sumline'));
  await page.fill('#q', '₹2000');
  check('search amount', (await txt('.sumline')).startsWith('1 result'), await txt('.sumline'));
  await page.fill('#q', 'october');
  check('search october', (await txt('.sumline')).startsWith('15 results'), await txt('.sumline'));
  await page.fill('#q', 'rahul october');
  check('search two words', (await txt('.sumline')).startsWith('2 results'), await txt('.sumline'));
  await page.fill('#q', 'zzzz');
  check('search none', /Nothing matches/.test(await txt('#sr')));
  await page.click('.tab[data-tab="plan"]');

  // log a recurring payment
  await page.waitForSelector('[data-act="log-recur"]');
  await page.click('.grow:has-text("Music subscription") [data-act="log-recur"]');
  await page.waitForTimeout(300);
  await page.click('.tab[data-tab="home"]');
  check('net worth after logging', (await txt('.hero')) === '₹21,714', await txt('.hero'));
  await page.click('.tab[data-tab="plan"]');
  const plan2 = await txt('.grow:has-text("Music subscription")');
  check('recurring advanced', /8 Nov 2026/.test(plan2) && !/Log it/.test(plan2), plan2);

  // PIN lock
  await page.click('[data-act="goto"][data-tab="settings"]');
  await page.click('[data-act="set-pin"]');
  await page.fill('#f-pin', '1234');
  await page.fill('#f-pin2', '1234');
  await page.click('#gform button[type="submit"]');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  check('lock button visible', !!(await page.$('[data-act="lock-now"]')));
  await page.reload();
  await page.waitForSelector('#lock-form');
  check('locked after reload', !(await page.$('.hero')) && !!(await page.$('#pin')));
  check('no data in the page while locked', !/₹/.test(await page.textContent('#app')));
  await page.fill('#pin', '0000');
  await page.waitForSelector('#lock-err:not([hidden])');
  check('wrong pin message', /not right/.test(await txt('#lock-err')), await txt('#lock-err'));
  await page.fill('#pin', '1234');
  await page.waitForSelector('.hero');
  check('unlocked', (await txt('.hero')) === '₹21,714', await txt('.hero'));

  // encrypted backup and restore
  await page.click('[data-act="goto"][data-tab="settings"]');
  await page.click('[data-act="backup"]');
  check('download button is offered', !!(await page.$('[data-act="bk-save"]')));
  await page.fill('#bk-pw', 'secret1');
  await page.click('[data-act="bk-copy"]');
  await page.waitForSelector('#bk-box:not([hidden])');
  const backup = await page.inputValue('#bk-out');
  check('backup is encrypted', backup.startsWith('{"app":"udhaar-khata","enc":1') && !/Rahul/.test(backup), backup.slice(0, 80));
  await page.keyboard.press('Escape');
  await page.click('[data-act="clear-samples"] >> nth=0');
  await page.waitForFunction(() => /0 entries saved/.test(document.querySelector('#app').textContent));
  check('sample data cleared completely', true);
  await page.click('[data-act="restore"]');
  await page.fill('#rs-text', backup);
  await page.fill('#rs-pw', 'wrong');
  await page.click('[data-act="do-restore"]');
  await page.waitForSelector('#rs-err:not([hidden])');
  check('wrong restore password is refused', /password is wrong/.test(await txt('#rs-err')), await txt('#rs-err'));
  await page.fill('#rs-pw', 'secret1');
  await page.click('[data-act="do-restore"]');
  await page.waitForFunction(() => /Restored/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
  await page.click('.tab[data-tab="home"]');
  await page.waitForSelector('.hero');
  check('restored net worth', (await txt('.hero')) === '₹21,714', await txt('.hero'));

  // phone layout
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['home', 'money', 'lending', 'plan', 'reports']) {
    await page.click('.tab[data-tab="' + tab + '"]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('no sideways scroll on a phone (' + tab + ')', !overflow);
  }
  await ctx.close();

  if (SHOTS) await screenshots(browser);
  await browser.close(); server.close();

  console.log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) fail += errors.length;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
