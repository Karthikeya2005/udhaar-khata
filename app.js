(function () {
  'use strict';

  /* ================= constants ================= */
  var KEY2 = 'udhaar-khata.v2', KEY1 = 'udhaar-khata.v1', PIN_KEY = 'udhaar-khata.pin';
  var EXP_CATS = ['Food', 'Travel', 'Hostel & rent', 'Bills & recharge', 'Subscriptions', 'Shopping', 'Education & projects', 'Health', 'Entertainment', 'Other'];
  var INC_CATS = ['Pocket money', 'Stipend', 'Freelance', 'Gift', 'Other'];
  var METHODS = ['UPI', 'Cash', 'Bank transfer', 'Other'];
  var KINDS = { loan: 1, txn: 1, acct: 1, budget: 1, goal: 1, recur: 1 };
  var TABS = [['home', 'Home'], ['money', 'Money'], ['lending', 'Lending'], ['plan', 'Plan'], ['reports', 'Reports']];

  /* ================= helpers ================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var arr = function (x) { return Array.isArray(x) ? x : []; };
  var r2 = function (n) { return Math.round((+n || 0) * 100) / 100; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  function inr(n) {
    n = +n || 0;
    var neg = n < -0.004;
    var s = (Math.round(Math.abs(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return (neg ? '−' : '') + '₹' + s;
  }
  function compact(n) {
    var t = function (x) { return String(Math.round(x * 10) / 10); };
    if (n >= 1e7) return t(n / 1e7) + 'Cr';
    if (n >= 1e5) return t(n / 1e5) + 'L';
    if (n >= 1e3) return t(n / 1e3) + 'k';
    return String(Math.round(n));
  }
  var isoOf = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var todayISO = function () { return isoOf(new Date()); };
  var parts = function (iso) { return String(iso || '').split('-').map(Number); };
  var dayDiff = function (a, b) {
    var x = parts(a), y = parts(b);
    return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 864e5);
  };
  var addDays = function (iso, n) { var p = parts(iso); return isoOf(new Date(p[0], p[1] - 1, p[2] + n)); };
  var daysIn = function (y, m) { return new Date(y, m, 0).getDate(); };
  var fmtDate = function (iso) {
    if (!iso) return '';
    var p = parts(iso);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  var monthOf = function (iso) { return String(iso || '').slice(0, 7); };
  var thisMonth = function () { return monthOf(todayISO()); };
  var addMonths = function (key, n) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    var d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  };
  var monthLabel = function (key) { return new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
  var monthName = function (key) { return new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString('en-IN', { month: 'long' }); };
  var monthShort = function (key) { return new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString('en-IN', { month: 'short' }); };
  var newId = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var plural = function (n, w) { return n + ' ' + (n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'); };
  var money = function (v) { var n = parseFloat(String(v).replace(/[,₹\s]/g, '')); return isFinite(n) ? n : NaN; };
  var slug = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var ordinal = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  var fk = function (l) { return String(l.friend || '').trim().toLowerCase(); };
  var nowISO = function () { return new Date().toISOString(); };

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 2800);
  }

  /* ================= state and storage ================= */
  var docs = [], mode = 'pending', ready = false, dl = null;
  var cloud = null, cu = null, ckey = null, cmeta = null, cstate = 'off', cerr = '', unsub = null, listenSeq = 0, appliedSeq = 0;
  var ui = { tab: 'home', last: 'home', fview: 'home', fkey: null, ffilter: 'all', mfilter: 'all', month: thisMonth(), q: '', confirm: null, refocus: null };
  var lastFocus = null, armTimer = null, chain = Promise.resolve(), busy = {};
  var lock = { rec: null, locked: false, fails: 0, until: 0 };
  var hasCrypto = !!(window.crypto && window.crypto.subtle);
  var standalone = !(window.claude && window.claude.use);

  function loadLocal() {
    try {
      var raw = localStorage.getItem(KEY2);
      if (raw) { docs = arr(JSON.parse(raw)); return; }
      var old = localStorage.getItem(KEY1);
      if (old) docs = arr(JSON.parse(old)).map(function (l) { return Object.assign({ kind: 'loan' }, l); });
    } catch (e) { docs = []; }
  }
  function saveLocal() { try { localStorage.setItem(KEY2, JSON.stringify(docs)); } catch (e) {} }
  function persist(fn) {
    chain = chain.then(fn).catch(function (e) {
      console.error(e);
      toast('Could not save that. Check your connection and try again.');
    });
    return chain;
  }
  function putDoc(d) {
    var body = JSON.parse(JSON.stringify(d));
    var id = body.id; delete body.id;
    if (mode === 'cloud') return cloudPut(id, body);
    var i = docs.findIndex(function (x) { return x.id === id; });
    var full = Object.assign({ id: id }, body);
    if (i >= 0) docs[i] = full; else docs.push(full);
    saveLocal(); render();
    return Promise.resolve();
  }
  function removeDoc(id) {
    if (mode === 'cloud') return cu && cloud.remove(cu.uid, id);
    docs = docs.filter(function (x) { return x.id !== id; });
    saveLocal(); render();
    return Promise.resolve();
  }
  function byId(id) { return docs.find(function (d) { return d.id === id; }); }
  function once(key, fn) {
    if (busy[key]) return;
    busy[key] = true;
    persist(fn).then(function () { delete busy[key]; });
  }
  function fallbackLocal() { mode = 'local'; loadLocal(); ready = true; render(); }

  async function init() {
    loadPin();
    if (standalone) {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    }
    if (lock.rec) lock.locked = true;
    render();
    fallbackLocal();
    try { cloud = await Promise.race([window.khataCloudP || Promise.resolve(null), new Promise(function (r) { setTimeout(function () { r(null); }, 8000); })]); } catch (e) { cloud = null; }
    if (cloud) { cstate = 'out'; cloud.onAuth(onUser); render(); }
  }

  /* ================= cloud sync (Firebase, optional) ================= */
  var SYNC_ITERS = 200000, CK = 'udhaar-khata.ck.', META = 'udhaar-khata.meta.', UPLOADED = 'udhaar-khata.up.';
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ldel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  async function deriveSyncKey(pass, saltB64) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: SYNC_ITERS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function sealWith(key, text) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    return { v: 1, iv: b64(iv), ct: b64(ct) };
  }
  async function unsealWith(key, o) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct));
    return new TextDecoder().decode(pt);
  }
  async function keyMatches(key, meta) {
    try { return (await unsealWith(key, meta.check)) === 'udhaar-khata'; } catch (e) { return false; }
  }
  async function rememberedKey(uid) {
    try {
      var j = lget(CK + uid);
      return j ? await crypto.subtle.importKey('jwk', JSON.parse(j), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']) : null;
    } catch (e) { return null; }
  }
  async function rememberKey(uid, key) { try { lset(CK + uid, JSON.stringify(await crypto.subtle.exportKey('jwk', key))); } catch (e) {} }
  async function cloudPut(id, body) {
    if (!cu) throw new Error('not signed in');
    return cloud.set(cu.uid, id, ckey ? await sealWith(ckey, JSON.stringify(body)) : body);
  }
  function localDocs() { try { return arr(JSON.parse(lget(KEY2) || '[]')); } catch (e) { return []; } }
  function stopListen() { if (unsub) { try { unsub(); } catch (e) {} unsub = null; } listenSeq++; }
  function goLocal() { stopListen(); mode = 'local'; loadLocal(); ready = true; render(); }

  async function onUser(u) {
    stopListen();
    cu = u; cerr = '';
    if (!u) { ckey = null; cmeta = null; cstate = 'out'; goLocal(); return; }
    cstate = 'locked'; render();
    try { cmeta = await cloud.getMeta(u.uid); if (cmeta) lset(META + u.uid, JSON.stringify(cmeta)); }
    catch (e) { var c = lget(META + u.uid); cmeta = c ? JSON.parse(c) : undefined; }
    if (cmeta === undefined) { cstate = 'error'; cerr = 'Could not reach your account. Showing this device’s copy.'; render(); return; }
    if (!cmeta) { openSetupSync(); return; }
    if (cmeta.enc === false) { ckey = null; startListen(); return; }
    var k = await rememberedKey(u.uid);
    if (k && await keyMatches(k, cmeta)) { ckey = k; startListen(); return; }
    openUnlockSync();
  }
  function startListen() {
    var my = ++listenSeq;
    cstate = 'on'; mode = 'cloud'; ready = false; render();
    unsub = cloud.listen(cu.uid, async function (items, fromCache) {
      var out = [], bad = 0;
      for (var i = 0; i < items.length; i++) {
        try {
          var d = items[i].data;
          if (d && d.ct) { if (!ckey) throw new Error('locked'); d = JSON.parse(await unsealWith(ckey, d)); }
          out.push(Object.assign({}, d, { id: items[i].id }));
        } catch (e) { bad++; }
      }
      if (my !== listenSeq || my < appliedSeq) return;
      appliedSeq = my;
      docs = out; ready = true; render();
      if (bad) toast(plural(bad, 'entry') + ' could not be opened. Wrong passphrase?');
      if (!fromCache && !items.length) offerUpload();
    }, function () {
      if (my !== listenSeq) return;
      cstate = 'error'; cerr = 'Lost the connection to your account. Showing this device’s copy.';
      toast('Lost the connection to your saved ledger.'); goLocal();
    });
  }
  function offerUpload() {
    var n = localDocs().length;
    if (!n || !cu || lget(UPLOADED + cu.uid)) return;
    lset(UPLOADED + cu.uid, '1');
    openSheet('<h2 id="sheet-title">Upload this device’s entries?</h2><p class="hint">Your account is empty and this device has ' + plural(n, 'entry') + '. Upload them so your other devices can see them too. The copy on this device stays as it is.</p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Not now</button><button type="button" class="btn btn-primary" data-act="cloud-upload">Upload</button></div>');
  }
  function uploadLocal() {
    var have = {}; docs.forEach(function (d) { have[d.id] = 1; });
    var todo = localDocs().filter(function (d) { return d && d.id && !have[d.id]; });
    closeSheet();
    if (mode !== 'cloud') { toast('Sign in and unlock sync first.'); return; }
    if (!todo.length) { toast('Nothing new to upload.'); return; }
    persist(async function () {
      for (var i = 0; i < todo.length; i++) await putDoc(todo[i]);
      toast('Uploaded ' + plural(todo.length, 'entry'));
    });
  }
  function openSetupSync() {
    openSheet('<form id="sync-form" novalidate><h2 id="sheet-title">Set up cloud sync</h2>' +
      '<p class="hint">Choose a sync passphrase. Your entries are locked with it on this device before they are uploaded, so only you can read them. If you forget it, the cloud copy cannot be recovered, so keep a backup file too.</p>' +
      '<label for="sy-p1">Sync passphrase (at least 8 characters)</label><input id="sy-p1" type="password" autocomplete="new-password" maxlength="64">' +
      '<label for="sy-p2">Type it again</label><input id="sy-p2" type="password" autocomplete="new-password" maxlength="64">' +
      '<label class="chk"><input id="sy-rem" type="checkbox" checked> Remember it on this device</label>' +
      '<label class="chk"><input id="sy-plain" type="checkbox"> Do not lock my entries (not recommended)</label>' +
      '<p id="sy-err" class="err" role="alert" hidden></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Later</button><button type="submit" class="btn btn-primary">Turn on sync</button></div></form>', function (sh) {
      var err = $('#sy-err', sh), fail = function (m) { err.textContent = m; err.hidden = false; };
      $('#sync-form', sh).addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var plain = $('#sy-plain', sh).checked, p1 = $('#sy-p1', sh).value, p2 = $('#sy-p2', sh).value;
        try {
          var meta;
          if (plain) { meta = { v: 1, enc: false }; ckey = null; }
          else {
            if (p1.length < 8) return fail('Use at least 8 characters.');
            if (p1 !== p2) return fail('The two passphrases do not match.');
            var salt = b64(crypto.getRandomValues(new Uint8Array(16)));
            var key = await deriveSyncKey(p1, salt);
            meta = { v: 1, enc: true, salt: salt, iters: SYNC_ITERS, check: await sealWith(key, 'udhaar-khata') };
            ckey = key;
            if ($('#sy-rem', sh).checked) await rememberKey(cu.uid, key);
          }
          await cloud.setMeta(cu.uid, meta); cmeta = meta; lset(META + cu.uid, JSON.stringify(meta));
          closeSheet(); startListen();
        } catch (e) { console.error(e); fail('Could not set up sync. Check your connection and try again.'); }
      });
    });
  }
  function openUnlockSync() {
    openSheet('<form id="sync-form" novalidate><h2 id="sheet-title">Unlock cloud sync</h2>' +
      '<p class="hint">Enter your sync passphrase to open your entries.</p>' +
      '<label for="sy-p1">Sync passphrase</label><input id="sy-p1" type="password" autocomplete="current-password" maxlength="64">' +
      '<label class="chk"><input id="sy-rem" type="checkbox" checked> Remember it on this device</label>' +
      '<p id="sy-err" class="err" role="alert" hidden></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Later</button><button type="submit" class="btn btn-primary">Unlock</button></div></form>', function (sh) {
      var err = $('#sy-err', sh), fail = function (m) { err.textContent = m; err.hidden = false; };
      $('#sync-form', sh).addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var pw = $('#sy-p1', sh).value;
        if (!pw) return fail('Enter your passphrase.');
        try {
          var key = await deriveSyncKey(pw, cmeta.salt);
          if (!await keyMatches(key, cmeta)) return fail('That passphrase is not right.');
          ckey = key;
          if ($('#sy-rem', sh).checked) await rememberKey(cu.uid, key);
          closeSheet(); startListen();
        } catch (e) { console.error(e); fail('Could not unlock. Try again.'); }
      });
    });
  }
  function cloudSignIn() {
    if (!cloud) return;
    cloud.signIn().catch(function (e) {
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
      console.error(e); toast('Sign-in failed. Check that this site is allowed in Firebase.');
    });
  }
  function cloudSignOut() {
    if (cu) ldel(CK + cu.uid);
    ckey = null;
    cloud.signOut().catch(function () {});
  }
  function syncHTML() {
    var b = function (act, label, primary) { return '<button class="btn' + (primary ? ' btn-primary' : '') + '" type="button" data-act="' + act + '">' + label + '</button>'; };
    var body;
    if (!cloud) body = '<p class="note-p muted">Cloud sync is not set up in this build. Add your Firebase config to turn it on. See docs/FIREBASE_SETUP.md.</p>';
    else if (!cu) body = '<p class="note-p">Sign in with Google to keep the same ledger on your phone and computer. Your entries are locked with a passphrase on your device before upload.</p><div class="acts">' + b('cloud-signin', 'Sign in with Google', true) + '</div>';
    else if (cstate === 'on') body = '<p class="note-p">Signed in as <b>' + esc(cu.email || cu.name) + '</b>. ' + (ckey ? 'Entries are locked with your passphrase before upload.' : 'Entries are uploaded without a passphrase lock.') + '</p><div class="acts">' + b('cloud-upload', 'Upload this device’s entries') + b('cloud-signout', 'Sign out') + '</div>';
    else if (cstate === 'locked') body = '<p class="note-p">Signed in as <b>' + esc(cu.email || cu.name) + '</b>. Sync is waiting for your passphrase. Until then, new entries are saved on this device only.</p><div class="acts">' + b(cmeta ? 'cloud-unlock' : 'cloud-setup', cmeta ? 'Unlock sync' : 'Set up sync', true) + b('cloud-signout', 'Sign out') + '</div>';
    else body = '<p class="note-p">' + esc(cerr || 'Sync is not working right now.') + '</p><div class="acts">' + b('cloud-signout', 'Sign out') + '</div>';
    return section('Cloud sync (beta)', body);
  }

  /* ---- export ---- */
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCSV() {
    var S = derive(), rows = [];
    S.loans.forEach(function (l) {
      var c = calc(l);
      rows.push([l.lent, l.dir === 'borrowed' ? 'Borrowed' : 'Lent', l.friend, '', l.reason, l.amount, c.paid, c.bal, l.due || '', l.method || '']);
    });
    S.txns.forEach(function (t) { rows.push([t.date, t.type === 'income' ? 'Income' : 'Expense', '', t.cat || '', t.note || '', t.amount, '', '', '', t.method || '']); });
    rows.sort(function (a, b) { return String(b[0]).localeCompare(String(a[0])); });
    rows.unshift(['Date', 'Type', 'Friend', 'Category', 'Note or reason', 'Amount', 'Repaid', 'Balance', 'Due', 'Method']);
    var text = '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'udhaar-khata-' + todayISO() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Exported ' + plural(rows.length - 1, 'row'));
  }

  /* ================= domain logic ================= */
  function derive() {
    var S = { loans: [], txns: [], accts: [], budgets: [], goals: [], recurs: [], acctMap: {} };
    docs.forEach(function (d) {
      if (!d.kind || d.kind === 'loan') S.loans.push(d);
      else if (d.kind === 'txn') S.txns.push(d);
      else if (d.kind === 'acct') { S.accts.push(d); S.acctMap[d.id] = d; }
      else if (d.kind === 'budget') S.budgets.push(d);
      else if (d.kind === 'goal') S.goals.push(d);
      else if (d.kind === 'recur') S.recurs.push(d);
    });
    S.accts.sort(function (a, b) { return (a.type === b.type ? 0 : a.type === 'bank' ? -1 : 1) || String(a.name).localeCompare(String(b.name)); });
    return S;
  }

  function calc(l) {
    var paid = arr(l.repayments).reduce(function (s, r) { return s + (+r.amount || 0); }, 0);
    var bal = Math.max(0, r2((+l.amount || 0) - paid));
    var t = todayISO();
    var settled = bal <= 0.005;
    var overdue = !settled && !!l.due && l.due < t;
    var lastPaid = arr(l.repayments).map(function (r) { return r.date; }).sort().pop() || '';
    var settledOn = settled ? (lastPaid || l.lent) : '';
    return {
      paid: paid, bal: bal, settled: settled, overdue: overdue,
      lateDays: overdue ? dayDiff(l.due, t) : 0, settledOn: settledOn,
      onTime: settled && (!l.due || settledOn <= l.due)
    };
  }

  function acctBalance(a, S) {
    var b = +a.opening || 0, since = a.created || '';
    S.txns.forEach(function (t) {
      if (t.acct === a.id && (t.created || '') >= since) b += t.type === 'income' ? +t.amount : -(+t.amount);
    });
    S.loans.forEach(function (l) {
      if (l.acct !== a.id) return;
      var lent = l.dir !== 'borrowed';
      if ((l.created || '') >= since) b += lent ? -(+l.amount) : +l.amount;
      arr(l.repayments).forEach(function (r) {
        if ((r.at || l.created || '') >= since) b += lent ? +r.amount : -(+r.amount);
      });
    });
    return r2(b);
  }

  function netWorth(S) {
    var cash = 0, bank = 0, owed = 0, owe = 0;
    S.accts.forEach(function (a) { var b = acctBalance(a, S); if (a.type === 'cash') cash += b; else bank += b; });
    S.loans.forEach(function (l) { var c = calc(l); if (l.dir === 'borrowed') owe += c.bal; else owed += c.bal; });
    cash = r2(cash); bank = r2(bank); owed = r2(owed); owe = r2(owe);
    return { cash: cash, bank: bank, owed: owed, owe: owe, net: r2(cash + bank + owed - owe), hasAccts: S.accts.length > 0 };
  }

  function monthStats(S, key) {
    var income = 0, spend = 0, lent = 0, back = 0, borrowed = 0, paid = 0, cats = {};
    S.txns.forEach(function (t) {
      if (monthOf(t.date) !== key) return;
      if (t.type === 'income') income += +t.amount;
      else { spend += +t.amount; cats[t.cat] = (cats[t.cat] || 0) + (+t.amount); }
    });
    S.loans.forEach(function (l) {
      var isLent = l.dir !== 'borrowed';
      if (monthOf(l.lent) === key) { if (isLent) lent += +l.amount; else borrowed += +l.amount; }
      arr(l.repayments).forEach(function (r) {
        if (monthOf(r.date) !== key) return;
        if (isLent) back += +r.amount; else paid += +r.amount;
      });
    });
    income = r2(income); spend = r2(spend); lent = r2(lent); back = r2(back); borrowed = r2(borrowed); paid = r2(paid);
    return {
      income: income, spend: spend, lent: lent, back: back, borrowed: borrowed, paid: paid, cats: cats,
      saved: r2(income - spend - lent + back + borrowed - paid)
    };
  }

  function budgetRows(S) {
    var cats = monthStats(S, thisMonth()).cats;
    return S.budgets.map(function (b) {
      var used = r2(cats[b.cat] || 0), limit = +b.limit || 0;
      var pct = limit > 0 ? used / limit * 100 : 0;
      return { b: b, used: used, limit: limit, pct: pct, left: r2(limit - used), sev: pct > 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok' };
    }).sort(function (a, b) { return String(a.b.cat).localeCompare(String(b.b.cat)); });
  }

  function goalCalc(g) {
    var saved = r2(arr(g.contribs).reduce(function (s, c) { return s + (+c.amount || 0); }, 0));
    var target = +g.target || 0;
    var left = Math.max(0, r2(target - saved));
    var done = left <= 0.005;
    var pct = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
    var need = 0, late = false;
    if (!done && g.deadline) {
      var t = todayISO();
      if (g.deadline < t) late = true;
      else need = Math.ceil(left / Math.max(1, Math.ceil(dayDiff(t, g.deadline) / 30.4375)));
    }
    return { saved: saved, left: left, done: done, pct: pct, need: need, late: late };
  }

  function nextDue(r) {
    var p = parts(r.next);
    if (r.freq === 'weekly') return addDays(r.next, 7);
    if (r.freq === 'yearly') {
      var y = p[0] + 1;
      return y + '-' + pad(p[1]) + '-' + pad(Math.min(r.day || p[2], daysIn(y, p[1])));
    }
    var yy = p[0], mm = p[1] + 1;
    if (mm > 12) { mm = 1; yy++; }
    return yy + '-' + pad(mm) + '-' + pad(Math.min(r.day || p[2], daysIn(yy, mm)));
  }
  function freqLabel(r) {
    if (r.freq === 'weekly') return 'Weekly';
    var p = parts(r.next);
    if (r.freq === 'yearly') return 'Yearly, on ' + new Date(2001, p[1] - 1, r.day || p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return 'Monthly, on the ' + ordinal(r.day || p[2]);
  }
  function monthlyEquivalent(r) {
    var a = +r.amount || 0;
    return r.freq === 'weekly' ? a * 52 / 12 : r.freq === 'yearly' ? a / 12 : a;
  }

  function whenWord(d) {
    return d < 0 ? 'Overdue by ' + plural(-d, 'day') : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : 'Due in ' + plural(d, 'day');
  }

  function dueText(l, c) {
    if (c.settled) return 'Settled ' + fmtDate(c.settledOn) + (l.due ? (c.onTime ? ' · on time' : ' · after the due date') : '');
    if (!l.due) return 'No repay-by date set';
    var d = dayDiff(todayISO(), l.due);
    if (d < 0) return 'Was due ' + fmtDate(l.due) + ' · ' + plural(-d, 'day') + ' overdue';
    if (d === 0) return 'Due today';
    return 'Due ' + fmtDate(l.due) + ' · in ' + plural(d, 'day');
  }

  function reminders(S) {
    var out = [], t = todayISO();
    S.loans.forEach(function (l) {
      var c = calc(l);
      if (c.settled || !l.due) return;
      var d = dayDiff(t, l.due);
      if (d > 3) return;
      var lent = l.dir !== 'borrowed', name = String(l.friend).trim();
      out.push({
        d: d, sev: d < 0 ? 'late' : d === 0 ? 'warn' : 'soon', tag: d < 0 ? 'Overdue' : d === 0 ? 'Today' : 'Soon',
        text: lent ? name + ' owes you ' + inr(c.bal) + '. ' + whenWord(d) + '.' : 'You owe ' + name + ' ' + inr(c.bal) + '. ' + whenWord(d) + '.',
        sub: l.reason, act: lent ? 'msg' : 'open-friend', label: lent ? 'Remind' : 'Open', key: fk(l), kind: 'remind'
      });
    });
    S.recurs.forEach(function (r) {
      if (r.active === false || !r.next) return;
      var d = dayDiff(t, r.next);
      if (d > 3) return;
      out.push({
        d: d, sev: d < 0 ? 'late' : d === 0 ? 'warn' : 'soon', tag: d < 0 ? 'Overdue' : d === 0 ? 'Today' : 'Soon',
        text: r.name + ': ' + inr(r.amount) + '. ' + whenWord(d) + '.', sub: freqLabel(r), act: 'log-recur', label: 'Log it', id: r.id
      });
    });
    budgetRows(S).forEach(function (row) {
      if (row.pct > 100) out.push({ d: 0, sev: 'late', tag: 'Over budget', text: row.b.cat + ' budget is over by ' + inr(-row.left) + '.', sub: 'This month', act: 'goto', label: 'Open', tab: 'plan' });
      else if (row.pct >= 90) out.push({ d: 0, sev: 'warn', tag: 'Near limit', text: row.b.cat + ' budget has ' + inr(row.left) + ' left.', sub: 'This month', act: 'goto', label: 'Open', tab: 'plan' });
    });
    var rank = { late: 0, warn: 1, soon: 2 };
    out.sort(function (a, b) { return (rank[a.sev] - rank[b.sev]) || (a.d - b.d); });
    return out;
  }

  function buildFriends(loans) {
    var m = new Map();
    loans.forEach(function (l) {
      var key = fk(l), f = m.get(key);
      if (!f) { f = { key: key, name: '', items: [] }; m.set(key, f); }
      f.items.push({ l: l, c: calc(l) });
    });
    var out = [];
    m.forEach(function (f) {
      f.items.sort(function (a, b) { return (b.l.lent || '').localeCompare(a.l.lent || '') || (b.l.created || '').localeCompare(a.l.created || ''); });
      f.name = String(f.items[0].l.friend).trim();
      f.lent = 0; f.back = 0; f.owed = 0; f.borrowed = 0; f.paidBack = 0; f.owe = 0;
      f.overdue = 0; f.overdueOwe = 0; f.settledCount = 0; f.onTimeCount = 0; f.oldest = '';
      f.hasL = false; f.hasB = false;
      f.items.forEach(function (it) {
        var lent = it.l.dir !== 'borrowed';
        if (lent) { f.hasL = true; f.lent += +it.l.amount; f.back += it.c.paid; f.owed += it.c.bal; if (it.c.overdue) f.overdue += it.c.bal; }
        else { f.hasB = true; f.borrowed += +it.l.amount; f.paidBack += it.c.paid; f.owe += it.c.bal; if (it.c.overdue) f.overdueOwe += it.c.bal; }
        if (it.c.settled) { f.settledCount++; if (it.c.onTime) f.onTimeCount++; }
        else if (!f.oldest || it.l.lent < f.oldest) f.oldest = it.l.lent;
      });
      f.owed = r2(f.owed); f.owe = r2(f.owe); f.net = r2(f.owed - f.owe);
      f.pending = f.owed + f.owe > 0.005;
      out.push(f);
    });
    out.sort(function (a, b) {
      return ((b.overdue + b.overdueOwe > 0) - (a.overdue + a.overdueOwe > 0)) || ((b.owed + b.owe) - (a.owed + a.owe)) || a.name.localeCompare(b.name);
    });
    return out;
  }

  /* ---- search ---- */
  function entries(S) {
    var out = [];
    var an = function (id) { return (S.acctMap[id] || {}).name || ''; };
    S.txns.forEach(function (t) {
      out.push({
        kind: 'txn', id: t.id, type: t.type, label: t.type === 'income' ? 'Income' : 'Expense', dir: t.type === 'income' ? 'in' : 'out',
        date: t.date, amount: +t.amount, title: t.note || t.cat, sub: t.cat + (an(t.acct) ? ' · ' + an(t.acct) : ''),
        text: [t.cat, t.note, an(t.acct), t.type === 'income' ? 'income' : 'expense spent'].join(' ')
      });
    });
    S.loans.forEach(function (l) {
      var lent = l.dir !== 'borrowed';
      var base = { kind: 'loan', id: l.id, key: fk(l), title: String(l.friend).trim() + ': ' + l.reason };
      out.push(Object.assign({}, base, {
        label: lent ? 'Lent' : 'Borrowed', dir: lent ? 'out' : 'in', date: l.lent, amount: +l.amount,
        sub: (l.method || '') + (l.ref ? ' · ' + l.ref : ''),
        text: [l.friend, l.reason, l.method, l.ref, lent ? 'lent given loan' : 'borrowed owe loan'].join(' ')
      }));
      arr(l.repayments).forEach(function (r) {
        out.push(Object.assign({}, base, {
          label: lent ? 'Repaid to you' : 'You paid back', dir: lent ? 'in' : 'out', date: r.date, amount: +r.amount,
          sub: r.note || 'Repayment', text: [l.friend, l.reason, r.note, 'repayment returned back paid'].join(' ')
        }));
      });
    });
    out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return out;
  }
  function matches(e, q) {
    var toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return false;
    var p = parts(e.date), d = new Date(p[0], p[1] - 1, p[2]);
    var hay = (e.text + ' ' + d.toLocaleDateString('en-IN', { month: 'long' }) + ' ' + d.toLocaleDateString('en-IN', { month: 'short' }) + ' ' + p[0] + ' ' + e.date).toLowerCase();
    return toks.every(function (tok) {
      var num = tok.replace(/[₹,]/g, '');
      if (/^\d+(\.\d+)?$/.test(num)) {
        if (Math.abs(parseFloat(num) - e.amount) < 0.005) return true;
        return /^\d{4}$/.test(num) && String(p[0]) === num;
      }
      return hay.indexOf(tok) >= 0;
    });
  }

  /* ================= PIN lock ================= */
  function loadPin() {
    try {
      var r = JSON.parse(localStorage.getItem(PIN_KEY) || 'null');
      if (r && r.salt && r.hash && hasCrypto) lock.rec = r;
    } catch (e) {}
  }
  function b64(buf) {
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  async function pbkdf2Bits(secret, salt, iters) {
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iters, hash: 'SHA-256' }, key, 256);
  }
  async function makePinRec(pin) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iters = 150000;
    return { salt: b64(salt), hash: b64(await pbkdf2Bits(pin, salt, iters)), iters: iters, len: pin.length };
  }
  async function checkPin(pin) {
    if (!lock.rec) return true;
    return b64(await pbkdf2Bits(pin, unb64(lock.rec.salt), lock.rec.iters)) === lock.rec.hash;
  }
  async function tryUnlock(pin) {
    var wait = Math.ceil((lock.until - Date.now()) / 1000);
    if (wait > 0) return 'Too many tries. Wait ' + wait + ' seconds.';
    if (await checkPin(pin)) { lock.locked = false; lock.fails = 0; render(); return ''; }
    lock.fails++;
    if (lock.fails >= 5) { lock.fails = 0; lock.until = Date.now() + 30000; return 'Too many tries. Wait 30 seconds.'; }
    return 'That PIN is not right.';
  }
  function lockNow() {
    if (!lock.rec) return;
    closeSheet(); lock.locked = true; render();
  }

  /* ---- encrypted backup ---- */
  async function encryptText(text, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await crypto.subtle.importKey('raw', await pbkdf2Bits(password, salt, 200000), 'AES-GCM', false, ['encrypt']);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    return JSON.stringify({ app: 'udhaar-khata', enc: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  }
  async function decryptText(obj, password) {
    var key = await crypto.subtle.importKey('raw', await pbkdf2Bits(password, unb64(obj.salt), 200000), 'AES-GCM', false, ['decrypt']);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.ct));
    return new TextDecoder().decode(pt);
  }
  async function backupText(password) {
    var plain = JSON.stringify({ app: 'udhaar-khata', v: 2, exported: nowISO(), docs: docs });
    return password ? encryptText(plain, password) : plain;
  }

  /* ================= views ================= */
  function section(title, body, action, o) {
    return '<section class="sec"' + (o ? ' data-o="' + o + '"' : '') + '><div class="sec-h"><h2 class="label">' + title + '</h2>' + (action || '') + '</div>' + body + '</section>';
  }
  function meterHTML(pct, sev) {
    return '<div class="meter" style="--m:var(--meter-' + sev + ')" role="img" aria-label="' + Math.round(pct) + ' percent"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>';
  }

  function headerHTML() {
    return '<header class="top"><div class="brand"><h1>Udhaar Khata</h1><p>Who owes you, what you spend, what you keep.</p></div>' +
      '<div class="tools"><button class="btn btn-quiet" type="button" data-act="goto" data-tab="search">Search</button>' +
      '<button class="btn btn-quiet" type="button" data-act="goto" data-tab="settings">Settings</button>' +
      (lock.rec ? '<button class="btn btn-quiet" type="button" data-act="lock-now">Lock</button>' : '') + '</div></header>';
  }
  function tabsHTML() {
    return '<nav class="tabs" aria-label="Sections">' + TABS.map(function (t) {
      return '<button type="button" class="tab" data-act="goto" data-tab="' + t[0] + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</nav>';
  }
  function lockHTML() {
    return '<div class="lockscreen"><h1>Udhaar Khata</h1><p class="muted">Enter your PIN to open your ledger.</p>' +
      '<form id="lock-form" novalidate><label for="pin" class="vh">PIN</label>' +
      '<input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••">' +
      '<p id="lock-err" class="err" role="alert" hidden></p><button class="btn btn-primary" type="submit">Unlock</button></form>' +
      '<p class="hint">' + (standalone ? 'Forgot your PIN? Clearing this site’s data in your browser removes the lock, and your entries with it. Keep a backup file.' : 'Forgot your PIN? Clearing this site’s data in your browser removes the lock. Entries saved to your account are kept. Entries stored only in this browser are not.') + '</p></div>';
  }

  /* ---- home ---- */
  function welcomeHTML() {
    return '<div class="empty"><h2>Start your ledger</h2>' +
      '<p>Add what you hold in cash and bank, log the money you lend to friends with the reason, and track spending against budgets. Net worth, reminders and monthly reports fill in from there.</p>' +
      '<div class="row"><button class="btn btn-primary" type="button" data-act="add-acct">Add a cash or bank balance</button>' +
      '<button class="btn" type="button" data-act="add-loan">Add a loan to a friend</button>' +
      '<button class="btn" type="button" data-act="load-samples">Try with sample data</button></div></div>';
  }
  function remRowHTML(r) {
    var chip = r.sev === 'late' ? 'late' : r.sev === 'warn' ? 'warn' : '';
    var attrs = ' data-act="' + r.act + '"' + (r.kind ? ' data-kind="' + r.kind + '"' : '') + (r.key ? ' data-key="' + esc(r.key) + '"' : '') + (r.id ? ' data-id="' + esc(r.id) + '"' : '') + (r.tab ? ' data-tab="' + r.tab + '"' : '');
    return '<div class="rem"><div class="rem-text"><div class="rem-tag"><span class="chip ' + chip + '">' + esc(r.tag) + '</span></div><div>' + esc(r.text) + '</div><div class="sub">' + esc(r.sub) + '</div></div>' +
      '<button type="button" class="btn btn-small"' + attrs + '>' + esc(r.label) + '</button></div>';
  }
  function budgetRowHTML(row, edit) {
    var chip = row.sev === 'bad' ? '<span class="chip late">Over budget</span>' : row.sev === 'warn' ? '<span class="chip warn">Close to limit</span>' : '';
    var status = row.left < 0 ? 'Over by ' + inr(-row.left) : inr(row.left) + ' left';
    return '<div class="brow"><div class="brow-top"><span class="bname">' + esc(row.b.cat) + '</span><span class="bamt">' + inr(row.used) + ' of ' + inr(row.limit) + '</span></div>' +
      meterHTML(row.pct, row.sev) +
      '<div class="brow-sub"><span class="left"><span>' + status + '</span>' + chip + '</span>' +
      (edit ? '<button type="button" class="btn btn-quiet btn-small" data-act="edit-budget" data-id="' + esc(row.b.id) + '">Edit</button>' : '') + '</div></div>';
  }
  function goalRowHTML(g, full) {
    var c = goalCalc(g);
    var sub = c.done ? '<span class="chip ok">Goal reached</span>' : '<span>' + inr(c.left) + ' to go' +
      (g.deadline ? ' · by ' + fmtDate(g.deadline) + (c.late ? ' (deadline passed)' : ' · about ' + inr(c.need) + ' a month') : '') + '</span>';
    var hist = '';
    if (full) {
      var cs = arr(g.contribs).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      hist = '<details class="det"><summary>History (' + cs.length + ')</summary><ul>' + cs.map(function (x) {
        return '<li><span class="num">' + inr(x.amount) + '</span><span class="muted">' + fmtDate(x.date) + (x.note ? ' · ' + esc(x.note) : '') + '</span>' +
          '<button type="button" class="btn btn-quiet btn-danger btn-small" data-act="del-contrib" data-id="' + esc(g.id) + '" data-cid="' + esc(x.id) + '">Remove</button></li>';
      }).join('') + '</ul></details>';
    }
    return '<div class="grow"><div class="brow-top"><span class="bname">' + esc(g.name) + '</span><span class="bamt">' + inr(c.saved) + ' of ' + inr(g.target) + ' · ' + c.pct + '%</span></div>' +
      meterHTML(c.pct, 'ok') + '<div class="brow-sub"><span class="left">' + sub + '</span>' +
      (full ? '<span><button type="button" class="btn btn-small" data-act="goal-add" data-id="' + esc(g.id) + '">Add money</button> <button type="button" class="btn btn-quiet btn-small" data-act="edit-goal" data-id="' + esc(g.id) + '">Edit</button></span>' : '') +
      '</div>' + hist + '</div>';
  }
  function recurRowHTML(r, full) {
    var t = todayISO(), d = dayDiff(t, r.next), inc = r.type === 'income';
    var chip = r.active === false ? '<span class="chip">Paused</span>' : d < 0 ? '<span class="chip late">Overdue</span>' : d <= 0 ? '<span class="chip warn">Due today</span>' : '';
    var due = r.active === false ? 'Paused' : whenWord(d).replace('Due ', 'Next ').replace('Overdue by', 'Was due') + (d < 0 ? ' ago' : '') + ' · ' + fmtDate(r.next);
    var acts = '';
    if (full) {
      acts = '<div class="entry-actions">' + (r.active !== false && d <= 0 ? '<button type="button" class="btn btn-small" data-act="log-recur" data-id="' + esc(r.id) + '">Log it</button><button type="button" class="btn btn-small" data-act="skip-recur" data-id="' + esc(r.id) + '">Skip</button>' : '') +
        '<button type="button" class="btn btn-quiet btn-small" data-act="edit-recur" data-id="' + esc(r.id) + '">Edit</button></div>';
    }
    return '<div class="grow"><div class="brow-top"><span class="bname">' + esc(r.name) + '</span><span class="bamt">' + (inc ? '+' : '−') + inr(r.amount) + '</span></div>' +
      '<div class="brow-sub"><span class="left"><span>' + esc(freqLabel(r)) + ' · ' + esc(r.cat) + '</span>' + chip + '</span><span>' + esc(due) + '</span></div>' + acts + '</div>';
  }

  function homeHTML(S) {
    if (!docs.length) return welcomeHTML();
    var nw = netWorth(S), ms = monthStats(S, thisMonth()), rem = reminders(S);
    var quick = '<div class="quick-actions"><button class="btn btn-primary" type="button" data-act="add-txn" data-type="expense">+ Expense</button>' +
      '<button class="btn" type="button" data-act="add-txn" data-type="income">+ Income</button>' +
      '<button class="btn" type="button" data-act="add-loan">+ Loan</button></div>';
    var att = section('Needs attention', rem.length ? rem.map(remRowHTML).join('') : '<p class="muted note-p">Nothing is due in the next 3 days.</p>', '', 1);
    var nwH = '<section class="sec nw" data-o="2"><div class="label">Net worth</div><div class="hero' + (nw.net < 0 ? ' neg' : '') + '">' + inr(nw.net) + '</div>' +
      '<dl class="tally"><dt>Cash</dt><dd>' + inr(nw.cash) + '</dd><dt><span class="sg">+</span>Bank</dt><dd>' + inr(nw.bank) + '</dd>' +
      '<dt><span class="sg">+</span>Owed to you</dt><dd>' + inr(nw.owed) + '</dd><dt><span class="sg">−</span>You owe</dt><dd>' + inr(nw.owe) + '</dd>' +
      '<dt class="total">Net worth</dt><dd class="total' + (nw.net < 0 ? ' late' : '') + '">' + inr(nw.net) + '</dd></dl>' +
      (nw.hasAccts ? '' : '<p class="hint" style="margin-top:10px">Cash and bank show ₹0 until you add your balances. <button class="btn btn-quiet btn-small" type="button" data-act="add-acct">Add an account</button></p>') + '</section>';
    var savedCls = ms.saved < 0 ? ' late' : '';
    var month = section(monthLabel(thisMonth()),
      '<div class="stats"><div class="stat"><div class="label">Income</div><div class="fig">' + inr(ms.income) + '</div></div>' +
      '<div class="stat"><div class="label">Spending</div><div class="fig">' + inr(ms.spend) + '</div></div>' +
      '<div class="stat"><div class="label">Lent</div><div class="fig">' + inr(ms.lent) + '</div></div>' +
      '<div class="stat"><div class="label">Saved</div><div class="fig' + savedCls + '">' + inr(ms.saved) + '</div></div></div>',
      '<button class="btn btn-quiet btn-small" type="button" data-act="goto" data-tab="reports">Full report</button>', 3);
    var brs = budgetRows(S).sort(function (a, b) { return b.pct - a.pct; }).slice(0, 4);
    var bud = section('Budgets this month', brs.length ? brs.map(function (r) { return budgetRowHTML(r, false); }).join('') :
      '<p class="muted note-p">No budgets yet. Set a monthly limit for food, travel or anything else.</p>',
      '<button class="btn btn-quiet btn-small" type="button" data-act="goto" data-tab="plan">' + (brs.length ? 'All budgets' : 'Set one') + '</button>', 4);
    var gs = S.goals.slice(0, 2);
    var goals = section('Savings goals', gs.length ? gs.map(function (g) { return goalRowHTML(g, false); }).join('') : '<p class="muted note-p">No goals yet. Name something you are saving for.</p>',
      '<button class="btn btn-quiet btn-small" type="button" data-act="goto" data-tab="plan">' + (gs.length ? 'All goals' : 'Add one') + '</button>', 5);
    var up = S.recurs.filter(function (r) { return r.active !== false && r.next; }).sort(function (a, b) { return a.next.localeCompare(b.next); }).slice(0, 3);
    var upc = section('Coming up', up.length ? up.map(function (r) { return recurRowHTML(r, false); }).join('') : '<p class="muted note-p">No recurring payments yet. Add rent, recharge or subscriptions on the Plan tab.</p>', '', 6);
    return '<div class="view">' + quick + '<div class="cols" style="margin-top:20px"><div class="col">' + att + month + upc + '</div><div class="col">' + nwH + bud + goals + '</div></div></div>';
  }

  /* ---- money ---- */
  function monthNavHTML() {
    return '<div class="mnav"><button class="btn btn-small" type="button" data-act="month" data-d="-1" aria-label="Previous month">‹</button><strong>' + monthLabel(ui.month) + '</strong>' +
      '<button class="btn btn-small" type="button" data-act="month" data-d="1" aria-label="Next month"' + (ui.month >= thisMonth() ? ' disabled' : '') + '>›</button></div>';
  }
  function moneyHTML(S) {
    var accts = S.accts.length ? S.accts.map(function (a) {
      var b = acctBalance(a, S);
      return '<div class="lrow"><span class="t">' + esc(a.name) + (a.sample ? ' <span class="chip sample">Sample</span>' : '') + '</span><span class="a">' + inr(b) + '</span>' +
        '<span class="s">' + (a.type === 'cash' ? 'Cash' : 'Bank or UPI') + '</span><span class="x"><button type="button" class="btn btn-quiet btn-small" data-act="bal-acct" data-id="' + esc(a.id) + '">Update balance</button><button type="button" class="btn btn-quiet btn-small" data-act="edit-acct" data-id="' + esc(a.id) + '">Edit</button></span></div>';
    }).join('') : '<p class="muted note-p">No accounts yet. Add the cash you carry and each bank or UPI account so net worth is complete.</p>';
    var list = S.txns.filter(function (t) {
      return monthOf(t.date) === ui.month && (ui.mfilter === 'all' || t.type === ui.mfilter);
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.created).localeCompare(String(a.created)); });
    var ms = monthStats(S, ui.month);
    var groups = {};
    list.forEach(function (t) { (groups[t.date] = groups[t.date] || []).push(t); });
    var rows = Object.keys(groups).sort().reverse().map(function (d) {
      var p = parts(d);
      return '<div class="dayh">' + new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + '</div>' + groups[d].map(function (t) {
        var inc = t.type === 'income', an = (S.acctMap[t.acct] || {}).name;
        return '<button type="button" class="lrow rowbtn" data-act="edit-txn" data-id="' + esc(t.id) + '" data-type="' + esc(t.type) + '"><span class="t">' + esc(t.note || t.cat) + '</span>' +
          '<span class="a ' + (inc ? 'pos' : '') + '">' + (inc ? '+' : '−') + inr(t.amount) + '</span><span class="s">' + esc(t.cat) + (an ? ' · ' + esc(an) : '') + (t.sample ? ' · sample' : '') + '</span></button>';
      }).join('');
    }).join('');
    var chips = [['all', 'All'], ['income', 'Income'], ['expense', 'Spending']].map(function (p) {
      return '<button type="button" class="fchip" data-act="mfilter" data-f="' + p[0] + '" aria-pressed="' + (ui.mfilter === p[0]) + '">' + p[1] + '</button>';
    }).join('');
    return '<div class="view"><div class="narrow">' +
      section('Accounts', accts, '<button class="btn btn-quiet btn-small" type="button" data-act="add-acct">+ Add account</button>') +
      section('Income and spending', '<div class="acts" style="margin-top:8px"><button class="btn btn-primary" type="button" data-act="add-txn" data-type="expense">+ Expense</button><button class="btn" type="button" data-act="add-txn" data-type="income">+ Income</button></div>' +
        monthNavHTML() + '<p class="hint" style="margin-top:8px">Income <span class="num">' + inr(ms.income) + '</span> · Spending <span class="num">' + inr(ms.spend) + '</span></p>' +
        '<div class="filters" role="group" aria-label="Filter transactions">' + chips + '</div>' +
        (rows || '<p class="placeholder">Nothing logged for ' + monthLabel(ui.month) + '. Add an expense or income to start.</p>')) +
      '</div></div>';
  }

  /* ---- lending ---- */
  function lendingHTML(S) {
    var fs = buildFriends(S.loans);
    if (!S.loans.length) {
      return '<div class="view"><div class="empty"><h2>No loans recorded yet</h2><p>Each entry keeps the amount, the reason, the date you gave it, when it is due and every repayment, so you can answer “why did I take this?” with a date and a reason.</p>' +
        '<div class="row"><button class="btn btn-primary" type="button" data-act="add-loan">Add your first loan</button><button class="btn" type="button" data-act="load-samples">Try with sample data</button></div></div></div>';
    }
    var tot = fs.reduce(function (a, f) { return { owed: a.owed + f.owed, over: a.over + f.overdue, owe: a.owe + f.owe, n: a.n + (f.overdue > 0 ? 1 : 0) }; }, { owed: 0, over: 0, owe: 0, n: 0 });
    var strip = '<div class="strip"><div><div class="label">Owed to you</div><div class="fig">' + inr(tot.owed) + '</div><div class="note">pending</div></div>' +
      '<div><div class="label">Overdue</div><div class="fig' + (tot.over > 0 ? ' late' : '') + '">' + inr(tot.over) + '</div><div class="note">' + plural(tot.n, 'friend') + '</div></div>' +
      '<div><div class="label">You owe</div><div class="fig">' + inr(tot.owe) + '</div><div class="note">to friends</div></div></div>';
    var cur = fs.find(function (x) { return x.key === ui.fkey; });
    if (ui.fview === 'friend' && !cur) { ui.fview = 'home'; ui.fkey = null; }
    var counts = {
      all: fs.length,
      owing: fs.filter(function (f) { return f.owed > 0; }).length,
      oweyou: fs.filter(function (f) { return f.owe > 0; }).length,
      overdue: fs.filter(function (f) { return f.overdue + f.overdueOwe > 0; }).length,
      settled: fs.filter(function (f) { return !f.pending; }).length
    };
    var shown = fs.filter(function (f) {
      if (ui.ffilter === 'owing') return f.owed > 0;
      if (ui.ffilter === 'oweyou') return f.owe > 0;
      if (ui.ffilter === 'overdue') return f.overdue + f.overdueOwe > 0;
      if (ui.ffilter === 'settled') return !f.pending;
      return true;
    });
    var chips = [['all', 'All'], ['owing', 'Owe you'], ['oweyou', 'You owe'], ['overdue', 'Overdue'], ['settled', 'Settled']].map(function (p) {
      return '<button type="button" class="fchip" data-act="filter" data-f="' + p[0] + '" aria-pressed="' + (ui.ffilter === p[0]) + '">' + p[1] + ' ' + counts[p[0]] + '</button>';
    }).join('');
    var rows = shown.map(function (f) {
      var sub = plural(f.items.length, 'loan') + (f.oldest ? ' · since ' + fmtDate(f.oldest) : '');
      var amt = !f.pending ? 'Settled' : f.net > 0 ? inr(f.net) : f.net < 0 ? 'You owe ' + inr(-f.net) : 'Even';
      var tag = f.overdue > 0 ? '<span class="chip late">' + inr(f.overdue) + ' overdue</span>' : f.overdueOwe > 0 ? '<span class="chip late">You are late</span>' : !f.pending ? '<span class="chip ok">Clear</span>' : f.net > 0 ? '<span class="chip">Owes you</span>' : '';
      return '<button type="button" class="frow' + (!f.pending ? ' is-settled' : '') + '" data-act="open-friend" data-key="' + esc(f.key) + '"' + (ui.fkey === f.key ? ' aria-current="true"' : '') + '>' +
        '<span class="name">' + esc(f.name) + '</span><span class="amt">' + amt + '</span><span class="sub">' + esc(sub) + '</span><span class="tagcell">' + tag + '</span></button>';
    }).join('');
    return '<div class="view"><div class="acts" style="margin-top:0"><button class="btn btn-primary" type="button" data-act="add-loan">+ Add a loan</button></div>' + strip +
      '<div class="shell" data-view="' + ui.fview + '"><section class="list-pane" aria-label="Friends"><div class="filters" role="group" aria-label="Filter friends">' + chips + '</div>' +
      (rows || '<p class="placeholder">No friends match this filter.</p>') + '</section>' +
      '<section class="detail-pane" aria-label="Friend account">' + friendDetailHTML(cur) + '</section></div></div>';
  }
  function friendDetailHTML(f) {
    if (!f) return '<p class="placeholder">Pick a friend to see everything you have given them, what each amount was for, and what is still pending.</p>';
    var rel = f.settledCount > 0 ? 'Repaid on time: ' + f.onTimeCount + ' of ' + plural(f.settledCount, 'settled loan') : 'No settled loans yet';
    var entries = f.items.map(function (it) {
      var l = it.l, c = it.c, lent = l.dir !== 'borrowed';
      var pct = Math.min(100, Math.round((c.paid / (+l.amount || 1)) * 100));
      var chip = c.settled ? '<span class="chip ok">Settled</span>' : c.overdue ? '<span class="chip late">Overdue</span>' : '<span class="chip">Open</span>';
      var dirChip = lent ? '' : '<span class="chip warn">You borrowed</span>';
      var meta = (lent ? 'Given ' : 'Borrowed ') + fmtDate(l.lent) + (l.method ? ' via ' + esc(l.method) : '') + (l.ref ? ' · ' + esc(l.ref) : '');
      var reps = arr(l.repayments).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).map(function (r) {
        var armed = ui.confirm === 'dr:' + l.id + ':' + r.id;
        return '<li><span class="num">' + inr(r.amount) + '</span><span class="rdate">' + (lent ? 'received ' : 'paid ') + fmtDate(r.date) + '</span><span class="rnote">' + esc(r.note || '') + '</span>' +
          '<button type="button" class="btn btn-quiet btn-danger btn-small' + (armed ? ' armed' : '') + '" data-act="del-rep" data-id="' + esc(l.id) + '" data-rep="' + esc(r.id) + '">' + (armed ? 'Tap again to remove' : 'Remove') + '</button></li>';
      }).join('');
      var dl2 = ui.confirm === 'dl:' + l.id;
      return '<article class="entry"><div class="entry-top"><h3 class="reason">' + esc(l.reason) + '</h3><span class="amount">' + inr(l.amount) + '</span></div>' +
        '<p class="meta">' + meta + '</p><p class="due' + (c.overdue ? ' late' : '') + '">' + chip + dirChip + '<span>' + esc(dueText(l, c)) + '</span>' + (l.sample ? '<span class="chip sample">Sample</span>' : '') + '</p>' +
        meterHTML(pct, 'ok') + '<p class="barnote num">' + inr(c.paid) + (lent ? ' received of ' : ' paid back of ') + inr(l.amount) + (c.settled ? '' : ' · ' + inr(c.bal) + ' ' + (lent ? 'pending' : 'left to pay')) + '</p>' +
        (reps ? '<ul class="reps">' + reps + '</ul>' : '') +
        '<div class="entry-actions">' + (c.settled ? '' : '<button type="button" class="btn btn-small" data-act="repay" data-id="' + esc(l.id) + '">' + (lent ? 'Record repayment' : 'Record payment') + '</button><button type="button" class="btn btn-small" data-act="settle" data-id="' + esc(l.id) + '">Mark fully repaid</button>') +
        '<button type="button" class="btn btn-small" data-act="share-loan" data-id="' + esc(l.id) + '">Share</button>' +
        '<button type="button" class="btn btn-small" data-act="edit-loan" data-id="' + esc(l.id) + '">Edit</button>' +
        '<button type="button" class="btn btn-small btn-danger' + (dl2 ? ' armed' : '') + '" data-act="del-loan" data-id="' + esc(l.id) + '">' + (dl2 ? 'Tap again to delete' : 'Delete') + '</button></div></article>';
    }).join('');
    var rows = '';
    if (f.hasL) rows += '<dt>Lent</dt><dd>' + inr(f.lent) + '</dd><dt>Received back</dt><dd>' + inr(f.back) + '</dd>';
    if (f.hasB) rows += '<dt>Borrowed</dt><dd>' + inr(f.borrowed) + '</dd><dt>You paid back</dt><dd>' + inr(f.paidBack) + '</dd>';
    var tl = f.hasL && f.hasB ? (f.net > 0 ? 'They owe you' : f.net < 0 ? 'You owe them' : 'Even') : f.hasB ? 'You owe' : 'Pending';
    var tv = f.hasL && f.hasB ? Math.abs(f.net) : f.hasB ? f.owe : f.owed;
    return '<div class="acct"><button type="button" class="btn btn-quiet back" data-act="back">← All friends</button>' +
      '<div class="acct-head"><h2>' + esc(f.name) + '</h2><p>' + esc(rel) + '</p></div>' +
      '<dl class="tally">' + rows + '<dt class="total">' + tl + '</dt><dd class="total' + (f.overdue > 0 ? ' late' : '') + '">' + inr(tv) + '</dd></dl>' +
      '<div class="acct-actions"><button type="button" class="btn btn-primary" data-act="add-loan" data-friend="' + esc(f.name) + '">+ New loan</button>' +
      (f.owed > 0 ? '<button type="button" class="btn" data-act="msg" data-kind="remind" data-key="' + esc(f.key) + '">Remind</button>' : '') +
      '<button type="button" class="btn" data-act="msg" data-kind="statement" data-key="' + esc(f.key) + '">Statement</button></div>' +
      '<div class="entries"><h3>Entries, newest first</h3>' + entries + '</div></div>';
  }

  /* ---- plan ---- */
  function planHTML(S) {
    var br = budgetRows(S);
    var bud = section('Budgets for ' + monthLabel(thisMonth()), br.length ? br.map(function (r) { return budgetRowHTML(r, true); }).join('') : '<p class="muted note-p">No budgets yet. Pick a category and a monthly limit, and the meter fills as you log spending.</p>',
      '<button class="btn btn-quiet btn-small" type="button" data-act="add-budget">+ Add budget</button>');
    var goals = section('Savings goals', S.goals.length ? S.goals.map(function (g) { return goalRowHTML(g, true); }).join('') : '<p class="muted note-p">No goals yet. A laptop, a trip, an emergency fund. Add one and put money towards it as you can.</p>',
      '<button class="btn btn-quiet btn-small" type="button" data-act="add-goal">+ Add goal</button>');
    var rs = S.recurs.slice().sort(function (a, b) { return String(a.next).localeCompare(String(b.next)); });
    var fixed = rs.filter(function (r) { return r.active !== false && r.type !== 'income'; }).reduce(function (s, r) { return s + monthlyEquivalent(r); }, 0);
    var rec = section('Recurring payments', (rs.length ? rs.map(function (r) { return recurRowHTML(r, true); }).join('') + '<p class="hint" style="margin-top:10px">Fixed costs come to about <span class="num">' + inr(Math.round(fixed)) + '</span> a month.</p>' :
      '<p class="muted note-p">Hostel fees, rent, recharge, subscriptions. Add them once. When one falls due it shows on Home, and one tap logs it.</p>'),
      '<button class="btn btn-quiet btn-small" type="button" data-act="add-recur">+ Add recurring</button>');
    return '<div class="view"><div class="narrow">' + bud + goals + rec + '</div></div>';
  }

  /* ---- reports ---- */
  function trendHTML(S, key, W) {
    var months = [];
    for (var i = 5; i >= 0; i--) months.push(addMonths(key, -i));
    var data = months.map(function (k) { var m = monthStats(S, k); return { key: k, income: m.income, spend: m.spend, saved: m.saved }; });
    var max = Math.max.apply(null, data.map(function (d) { return Math.max(d.income, d.spend); }).concat([0]));
    if (max <= 0) return '<p class="muted note-p">Add income and spending to see the six-month trend.</p>';
    var raw = max / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p10;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p10;
    var top = step * Math.ceil(max / step);
    var H = 220, ml = 50, mr = 6, mt = 18, mb = 28, pw = W - ml - mr, ph = H - mt - mb, band = pw / 6;
    var bw = Math.max(8, Math.min(22, Math.floor((band - 8) / 2))), gap = 2;
    var y = function (v) { return mt + ph - (v / top) * ph; };
    var bar = function (x, v, cls) {
      if (v <= 0) return '';
      var h = (v / top) * ph, yy = y(v), r = Math.min(4, h);
      return '<path class="bar" fill="var(--' + cls + ')" d="M' + x + ',' + (yy + h) + ' L' + x + ',' + (yy + r) + ' Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + ' L' + (x + bw - r) + ',' + yy + ' Q' + (x + bw) + ',' + yy + ' ' + (x + bw) + ',' + (yy + r) + ' L' + (x + bw) + ',' + (yy + h) + ' Z"/>';
    };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Income and spending for the last six months, ending ' + esc(monthLabel(key)) + '">';
    for (var v = 0; v <= top + 1e-6; v += step) {
      s += '<line class="' + (v === 0 ? 'base' : 'grid') + '" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text x="' + (ml - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v).toLocaleString('en-IN') + '</text>';
    }
    data.forEach(function (d, i) {
      var x0 = ml + i * band, gx = x0 + (band - (2 * bw + gap)) / 2;
      var tip = monthLabel(d.key) + ': income ' + inr(d.income) + ', spending ' + inr(d.spend);
      s += '<rect class="band" x="' + x0 + '" y="' + mt + '" width="' + band + '" height="' + ph + '" tabindex="0" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '"/>';
      s += bar(gx, d.income, 's1') + bar(gx + bw + gap, d.spend, 's2');
      s += '<text x="' + (x0 + band / 2) + '" y="' + (H - 9) + '" text-anchor="middle">' + monthShort(d.key) + '</text>';
      if (i === 5 && W >= 440) {
        if (d.income > 0) s += '<text class="bl" x="' + (gx + bw) + '" y="' + (y(d.income) - 4) + '" text-anchor="end">' + compact(d.income) + '</text>';
        if (d.spend > 0) s += '<text class="bl" x="' + (gx + bw + gap) + '" y="' + (y(d.spend) - 4) + '" text-anchor="start">' + compact(d.spend) + '</text>';
      }
    });
    s += '</svg>';
    var table = '<details class="tbl"><summary>Show as table</summary><div class="scroll"><table><thead><tr><th>Month</th><th>Income</th><th>Spending</th><th>Saved</th></tr></thead><tbody>' +
      data.map(function (d) { return '<tr><td>' + esc(monthLabel(d.key)) + '</td><td>' + inr(d.income) + '</td><td>' + inr(d.spend) + '</td><td>' + inr(d.saved) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return '<div class="legend"><span><i style="background:var(--s1)"></i>Income</span><span><i style="background:var(--s2)"></i>Spending</span><span class="muted">Amounts in ₹</span></div>' + s + table;
  }
  function drawTrend() {
    var host = $('#trend');
    if (!host) return;
    host.innerHTML = trendHTML(derive(), ui.month, Math.max(280, Math.min(720, Math.floor(host.clientWidth || 320))));
  }
  function reportsHTML(S) {
    var key = ui.month, ms = monthStats(S, key), pm = monthStats(S, addMonths(key, -1));
    var row = function (sg, label, val, cls) { return '<dt><span class="sg">' + sg + '</span>' + label + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + inr(val) + '</dd>'; };
    var rows = row('', 'Income', ms.income) + row('−', 'Spending', ms.spend) + row('−', 'Lent to friends', ms.lent) + row('+', 'Repaid to you', ms.back);
    if (ms.borrowed > 0) rows += row('+', 'Borrowed', ms.borrowed);
    if (ms.paid > 0) rows += row('−', 'You paid back', ms.paid);
    rows += '<dt class="total">Saved</dt><dd class="total' + (ms.saved < 0 ? ' late' : '') + '">' + inr(ms.saved) + '</dd>';
    var lines = [];
    if (ms.income > 0) lines.push(ms.saved >= 0 ? 'You kept ' + Math.round(ms.saved / ms.income * 100) + '% of your income.' : 'Money out was ' + inr(-ms.saved) + ' more than money in.');
    if (pm.spend > 0 && ms.spend > 0) {
      var diff = r2(ms.spend - pm.spend);
      lines.push('Spending is ' + inr(Math.abs(diff)) + (diff < 0 ? ' lower' : ' higher') + ' than in ' + monthName(addMonths(key, -1)) + ' (' + Math.abs(Math.round(diff / pm.spend * 100)) + '%).');
    }
    var cats = Object.keys(ms.cats).map(function (c) { return [c, ms.cats[c]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var cmax = cats.length ? cats[0][1] : 1;
    var bars = cats.length ? '<div class="cbars">' + cats.map(function (c) {
      var share = Math.round(c[1] / ms.spend * 100);
      return '<div class="cbar" data-tip="' + esc(c[0] + ': ' + inr(c[1]) + ', ' + share + '% of spending') + '"><span class="nm">' + esc(c[0]) + '</span><span class="tr"><span style="width:' + Math.max(1, c[1] / cmax * 100) + '%"></span></span><span class="vl">' + inr(c[1]) + ' · ' + share + '%</span></div>';
    }).join('') + '</div>' : '<p class="muted note-p">No spending logged for ' + monthLabel(key) + '.</p>';
    return '<div class="view"><div class="narrow">' + monthNavHTML() +
      section('Month at a glance', '<dl class="tally" style="max-width:none">' + rows + '</dl>' + lines.map(function (l) { return '<p class="note-p">' + esc(l) + '</p>'; }).join('')) +
      section('Spending by category', bars) +
      section('Last six months', '<div id="trend" class="chart"></div>') + '</div></div>';
  }

  /* ---- search and settings ---- */
  function resultsHTML(S) {
    var q = ui.q.trim();
    if (!q) return '<p class="placeholder">Type to search loans, repayments, income and spending at once.</p>';
    var hits = entries(S).filter(function (e) { return matches(e, q); });
    if (!hits.length) return '<p class="placeholder">Nothing matches “' + esc(q) + '”.</p>';
    var tin = 0, tout = 0;
    hits.forEach(function (e) { if (e.dir === 'in') tin += e.amount; else tout += e.amount; });
    return '<p class="sumline">' + plural(hits.length, 'result') + ' · money in <span class="num">' + inr(tin) + '</span> · money out <span class="num">' + inr(tout) + '</span></p>' +
      hits.slice(0, 100).map(function (e) {
        return '<button type="button" class="srow" data-act="open-entry" data-kind="' + e.kind + '" data-id="' + esc(e.id) + '" data-key="' + esc(e.key || '') + '" data-type="' + esc(e.type || '') + '">' +
          '<span class="t">' + esc(e.title) + '</span><span class="a ' + (e.dir === 'in' ? 'pos' : '') + '">' + (e.dir === 'in' ? '+' : '−') + inr(e.amount) + '</span>' +
          '<span class="s"><span class="chip">' + esc(e.label) + '</span><span>' + fmtDate(e.date) + (e.sub ? ' · ' + esc(e.sub) : '') + '</span></span></button>';
      }).join('') + (hits.length > 100 ? '<p class="hint">Showing the newest 100. Add a word to narrow it down.</p>' : '');
  }
  function searchHTML(S) {
    return '<div class="view"><div class="narrow"><div class="sec-h"><h2 class="label">Search</h2><button class="btn btn-quiet btn-small" type="button" data-act="goto" data-tab="' + ui.last + '">Close</button></div>' +
      '<label for="q" class="vh">Search your ledger</label><input id="q" class="qbox" type="search" autocomplete="off" placeholder="Name, reason, category, month or amount" value="' + esc(ui.q) + '">' +
      '<p class="hint" style="margin-top:6px">Try a name like Rahul, a word like PCB, a month like October, or an amount like ₹2000.</p><div id="sr">' + resultsHTML(S) + '</div></div></div>';
  }
  function settingsHTML() {
    var sec = lock.rec ?
      '<p class="note-p">PIN lock is on. The ledger locks when it opens and after a minute away.</p><div class="acts"><button class="btn" type="button" data-act="change-pin">Change PIN</button><button class="btn" type="button" data-act="off-pin">Turn off</button><button class="btn" type="button" data-act="lock-now">Lock now</button></div>' :
      (hasCrypto ? '<p class="note-p">Add a PIN to hide your ledger when the page opens or has been idle for a minute.</p><div class="acts"><button class="btn btn-primary" type="button" data-act="set-pin">Set a PIN</button></div>' :
        '<p class="note-p muted">PIN lock needs a secure browser connection, which is not available here.</p>');
    var samples = docs.some(function (d) { return d.sample; });
    return '<div class="view"><div class="narrow"><div class="sec-h"><h2 class="label">Settings</h2><button class="btn btn-quiet btn-small" type="button" data-act="goto" data-tab="' + ui.last + '">Close</button></div>' +
      section('Security', sec) +
      syncHTML() +
      section('Backup', '<p class="note-p">' + (mode === 'cloud' ? 'Your entries are saved to your account, private to you.' : 'Your entries are stored in this browser only.') + ' Keep a file copy too. You can lock the file with a password.</p><div class="acts"><button class="btn btn-primary" type="button" data-act="backup">Back up</button><button class="btn" type="button" data-act="restore">Restore</button></div>') +
      section('Your data', '<p class="note-p">' + plural(docs.length, 'entry') + ' saved.</p>' + '<div class="acts"><button class="btn" type="button" data-act="export-csv">Export CSV</button>' + (samples ? '<button class="btn" type="button" data-act="clear-samples">Remove sample data</button>' : '') + '</div>') +
      section('Good to know', '<p class="note-p"><b>Reminders</b> appear on Home when you open the app. A web page cannot send phone notifications.</p>' +
        '<p class="note-p"><b>Fingerprint or face unlock</b> is not available here, so the lock uses a PIN.</p>' +
        '<p class="note-p"><b>The PIN</b> is a screen lock kept on this browser only. It does not encrypt your entries. Backup files can be encrypted with a password.</p>') +
      '</div></div>';
  }

  /* ================= render ================= */
  function render() {
    var app = $('#app');
    if (lock.locked) {
      if (!$('#lock-form', app)) { app.innerHTML = lockHTML(); var p = $('#pin'); if (p) p.focus(); }
      return;
    }
    var ae = document.activeElement, hadQ = ae && ae.id === 'q', pos = hadQ ? ae.selectionStart : 0;
    if (!ready) { app.innerHTML = headerHTML() + '<p class="loading">Opening your ledger…</p>'; return; }
    var S = derive();
    var view = ui.tab === 'home' ? homeHTML(S) : ui.tab === 'money' ? moneyHTML(S) : ui.tab === 'lending' ? lendingHTML(S) :
      ui.tab === 'plan' ? planHTML(S) : ui.tab === 'reports' ? reportsHTML(S) : ui.tab === 'search' ? searchHTML(S) : settingsHTML();
    var hasSample = docs.some(function (d) { return d.sample; });
    app.innerHTML = headerHTML() + tabsHTML() +
      (hasSample ? '<div class="banner"><span>Sample data is showing. None of it is real.</span><button type="button" class="btn btn-quiet btn-small" data-act="clear-samples">Clear sample data</button></div>' : '') +
      view +
      '<p class="foot">' + (mode === 'cloud' ? 'Synced to your account' + (ckey ? ' and locked with your passphrase.' : '.') : (standalone ? 'Saved on this device only. Use Settings, then Back up, to keep a copy.' : 'Saved in this browser only. Open this page while signed in to keep entries across devices.')) + '</p>';
    if (ui.tab === 'reports') drawTrend();
    if (ui.refocus) { var el = $(ui.refocus, app); if (el) el.focus(); ui.refocus = null; }
    if (hadQ) { var q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  /* ================= sheets and forms ================= */
  function openSheet(html, mount) {
    lastFocus = document.activeElement;
    var s = $('#sheet');
    s.innerHTML = '<div class="backdrop" data-act="close-sheet"></div><div class="panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' + html + '</div>';
    s.hidden = false;
    document.body.classList.add('lock');
    var first = s.querySelector('input:not([type="radio"]), textarea, select');
    if (first) first.focus();
    if (mount) mount(s);
  }
  function closeSheet() {
    var s = $('#sheet');
    s.hidden = true; s.innerHTML = '';
    document.body.classList.remove('lock');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function fieldHTML(f) {
    var id = 'f-' + f.name, v = f.value == null ? '' : f.value, input;
    if (f.type === 'select') {
      input = '<select id="' + id + '" name="' + f.name + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(v) ? ' selected' : '') + '>' + esc(o.l) + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'password') {
      input = '<input id="' + id + '" name="' + f.name + '" type="password" inputmode="numeric" autocomplete="off" maxlength="6">';
    } else {
      input = '<input id="' + id + '" name="' + f.name + '" type="' + (f.type === 'date' ? 'date' : 'text') + '"' + (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') +
        ' autocomplete="off" maxlength="' + (f.max || 80) + '" value="' + esc(v) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
    }
    return '<div class="fld' + (f.half ? ' half' : '') + '"><label for="' + id + '">' + esc(f.label) + '</label>' + input + (f.help ? '<p class="fhelp">' + esc(f.help) + '</p>' : '') + '</div>';
  }
  function openForm(o) {
    var html = '<form id="gform" novalidate><h2 id="sheet-title">' + esc(o.title) + '</h2>' + (o.hint ? '<p class="hint">' + esc(o.hint) + '</p>' : '') +
      '<div class="fields">' + o.fields.map(fieldHTML).join('') + '</div>' + (o.extra || '') + '<p id="g-err" class="err" role="alert" hidden></p>' +
      '<div class="actions">' + (o.remove ? '<button type="button" class="btn btn-danger push" id="g-rm">' + esc(o.remove.label || 'Delete') + '</button>' : '') +
      '<button type="button" class="btn" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">' + esc(o.submit || 'Save') + '</button></div></form>';
    openSheet(html, function (s) {
      var form = $('#gform', s), err = $('#g-err', s);
      if (o.mount) o.mount(form, s);
      if (o.remove) {
        var rm = $('#g-rm', s), armed = false;
        rm.addEventListener('click', function () {
          if (!armed) { armed = true; rm.textContent = 'Tap again to confirm'; rm.classList.add('armed'); return; }
          closeSheet(); o.remove.fn();
        });
      }
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var vals = {};
        Array.prototype.forEach.call(form.elements, function (el) {
          if (!el.name) return;
          if (el.type === 'radio') { if (el.checked) vals[el.name] = el.value; } else vals[el.name] = el.value.trim();
        });
        var msg = await o.onSubmit(vals, form);
        if (msg) { err.textContent = msg; err.hidden = false; return; }
        closeSheet();
      });
    });
  }
  var acctOptions = function (S) { return [{ v: '', l: 'No account' }].concat(S.accts.map(function (a) { return { v: a.id, l: a.name }; })); };
  var catOptions = function (list) { return list.map(function (c) { return { v: c, l: c }; }); };

  function openTxnForm(type, t) {
    var S = derive(), cats = type === 'income' ? INC_CATS : EXP_CATS;
    openForm({
      title: (t ? 'Edit ' : 'Add ') + (type === 'income' ? 'income' : 'expense'),
      fields: [
        { name: 'amount', label: 'Amount (₹)', value: t ? t.amount : '', inputmode: 'decimal', half: true },
        { name: 'date', label: 'Date', type: 'date', value: t ? t.date : todayISO(), half: true },
        { name: 'cat', label: 'Category', type: 'select', options: catOptions(cats), value: t ? t.cat : cats[0], half: true },
        { name: 'acct', label: 'Account', type: 'select', options: acctOptions(S), value: t ? (t.acct || '') : (S.accts[0] ? S.accts[0].id : ''), half: true },
        { name: 'note', label: 'Note (optional)', value: t ? t.note : '', placeholder: type === 'income' ? 'e.g. Fiverr PCB layout gig' : 'e.g. KiCad board fabrication' }
      ],
      submit: t ? 'Save changes' : 'Save',
      onSubmit: function (v) {
        var amt = money(v.amount);
        if (!(amt > 0)) return 'Enter the amount as a number greater than zero.';
        if (!v.date) return 'Pick a date.';
        var obj = t ? Object.assign({}, t) : { id: newId('t'), kind: 'txn', created: nowISO() };
        Object.assign(obj, { type: type, amount: amt, date: v.date, cat: v.cat, note: v.note, acct: v.acct });
        persist(function () { return putDoc(obj); });
        if (ui.tab === 'money') ui.month = monthOf(v.date);
        toast(t ? 'Changes saved' : type === 'income' ? 'Income added' : 'Expense added');
      },
      remove: t ? { fn: function () { persist(function () { return removeDoc(t.id); }); toast('Deleted'); } } : null
    });
  }
  function openAcctForm(a) {
    var fields = [
      { name: 'name', label: 'Name', value: a ? a.name : '', placeholder: 'e.g. SBI savings', max: 40 },
      { name: 'type', label: 'Type', type: 'select', options: [{ v: 'bank', l: 'Bank or UPI' }, { v: 'cash', l: 'Cash' }], value: a ? a.type : 'bank', half: !a }
    ];
    if (!a) fields.push({ name: 'opening', label: 'Balance now (₹)', value: '', inputmode: 'decimal', half: true });
    openForm({
      title: a ? 'Edit account' : 'Add account',
      hint: a ? 'Entries linked to a deleted account stay in your history but stop changing any balance.' : 'Enter what you hold right now. Everything you log after this updates it.',
      fields: fields, submit: a ? 'Save changes' : 'Add account',
      onSubmit: function (v) {
        if (!v.name) return 'Give the account a name.';
        var obj = a ? Object.assign({}, a) : { id: newId('a'), kind: 'acct', created: nowISO() };
        if (!a) {
          var n = parseFloat(String(v.opening).replace(/[,₹\s]/g, ''));
          if (!isFinite(n)) return 'Enter your current balance. Use 0 if it is empty.';
          obj.opening = n;
        }
        Object.assign(obj, { name: v.name, type: v.type });
        persist(function () { return putDoc(obj); });
        toast(a ? 'Changes saved' : 'Account added');
      },
      remove: a ? { fn: function () { persist(function () { return removeDoc(a.id); }); toast('Account deleted'); } } : null
    });
  }
  function openBalanceForm(a) {
    var S = derive(), cur = acctBalance(a, S);
    openForm({
      title: 'Update balance', hint: a.name + '. Use this when the real balance differs from what the app shows, for example after an ATM withdrawal.',
      fields: [{ name: 'bal', label: 'Balance now (₹)', value: cur, inputmode: 'decimal' }], submit: 'Update',
      onSubmit: function (v) {
        var n = parseFloat(String(v.bal).replace(/[,₹\s]/g, ''));
        if (!isFinite(n)) return 'Enter the balance as a number.';
        var flows = cur - (+a.opening || 0);
        persist(function () { return putDoc(Object.assign({}, a, { opening: r2(n - flows) })); });
        toast('Balance updated');
      }
    });
  }
  function openBudgetForm(b) {
    var S = derive(), used = {};
    S.budgets.forEach(function (x) { used[x.cat] = 1; });
    var free = EXP_CATS.filter(function (c) { return !used[c]; });
    if (!b && !free.length) { toast('Every category already has a budget.'); return; }
    openForm({
      title: b ? 'Edit budget' : 'Add budget', hint: 'The limit applies to each calendar month.',
      fields: [
        { name: 'cat', label: 'Category', type: 'select', options: catOptions(b ? [b.cat] : free), value: b ? b.cat : free[0], half: true },
        { name: 'limit', label: 'Monthly limit (₹)', value: b ? b.limit : '', inputmode: 'decimal', half: true }
      ],
      onSubmit: function (v) {
        var lim = money(v.limit);
        if (!(lim > 0)) return 'Enter a limit greater than zero.';
        persist(function () { return putDoc({ id: 'b-' + slug(v.cat), kind: 'budget', cat: v.cat, limit: lim }); });
        toast(b ? 'Budget updated' : 'Budget added');
      },
      remove: b ? { fn: function () { persist(function () { return removeDoc(b.id); }); toast('Budget deleted'); } } : null
    });
  }
  function openGoalForm(g) {
    var fields = [
      { name: 'name', label: 'What are you saving for?', value: g ? g.name : '', placeholder: 'e.g. Laptop', max: 40 },
      { name: 'target', label: 'Target (₹)', value: g ? g.target : '', inputmode: 'decimal', half: true },
      { name: 'deadline', label: 'Reach it by (optional)', type: 'date', value: g ? g.deadline : '', half: true }
    ];
    if (!g) fields.push({ name: 'start', label: 'Already set aside (₹, optional)', value: '', inputmode: 'decimal' });
    openForm({
      title: g ? 'Edit goal' : 'Add goal', hint: g ? '' : 'The money stays in your account. A goal tracks how much of it you have set aside.',
      fields: fields,
      onSubmit: function (v) {
        var target = money(v.target);
        if (!v.name) return 'Name the goal.';
        if (!(target > 0)) return 'Enter a target greater than zero.';
        var obj = g ? Object.assign({}, g) : { id: newId('g'), kind: 'goal', contribs: [], created: nowISO() };
        Object.assign(obj, { name: v.name, target: target, deadline: v.deadline || '' });
        if (!g && v.start) {
          var s0 = money(v.start);
          if (isFinite(s0) && s0 > 0) obj.contribs = [{ id: newId('c'), amount: s0, date: todayISO(), note: 'Starting amount' }];
        }
        persist(function () { return putDoc(obj); });
        toast(g ? 'Goal updated' : 'Goal added');
      },
      remove: g ? { fn: function () { persist(function () { return removeDoc(g.id); }); toast('Goal deleted'); } } : null
    });
  }
  function openContribForm(g) {
    openForm({
      title: 'Add money to ' + g.name, hint: 'Record what you have set aside for this goal.',
      fields: [
        { name: 'amount', label: 'Amount (₹)', value: '', inputmode: 'decimal', half: true },
        { name: 'date', label: 'Date', type: 'date', value: todayISO(), half: true },
        { name: 'note', label: 'Note (optional)', value: '' }
      ], submit: 'Add',
      onSubmit: function (v) {
        var amt = money(v.amount);
        if (!(amt > 0)) return 'Enter the amount as a number greater than zero.';
        if (!v.date) return 'Pick a date.';
        var ng = Object.assign({}, g, { contribs: arr(g.contribs).concat([{ id: newId('c'), amount: amt, date: v.date, note: v.note }]) });
        persist(function () { return putDoc(ng); });
        toast('Added to ' + g.name);
      }
    });
  }
  function openRecurForm(r) {
    var S = derive(), t0 = r ? r.type || 'expense' : 'expense';
    openForm({
      title: r ? 'Edit recurring payment' : 'Add recurring payment',
      hint: r ? '' : 'When it falls due it shows on Home. One tap logs it.',
      fields: [
        { name: 'name', label: 'Name', value: r ? r.name : '', placeholder: 'e.g. Hostel mess fee', max: 40 },
        { name: 'amount', label: 'Amount (₹)', value: r ? r.amount : '', inputmode: 'decimal', half: true },
        { name: 'type', label: 'Type', type: 'select', options: [{ v: 'expense', l: 'Expense' }, { v: 'income', l: 'Income' }], value: t0, half: true },
        { name: 'cat', label: 'Category', type: 'select', options: catOptions(t0 === 'income' ? INC_CATS : EXP_CATS), value: r ? r.cat : EXP_CATS[0], half: true },
        { name: 'freq', label: 'Repeats', type: 'select', options: [{ v: 'monthly', l: 'Monthly' }, { v: 'weekly', l: 'Weekly' }, { v: 'yearly', l: 'Yearly' }], value: r ? r.freq : 'monthly', half: true },
        { name: 'next', label: 'Next due date', type: 'date', value: r ? r.next : todayISO(), half: true },
        { name: 'acct', label: 'Account', type: 'select', options: acctOptions(S), value: r ? (r.acct || '') : (S.accts[0] ? S.accts[0].id : ''), half: true },
        { name: 'active', label: 'Status', type: 'select', options: [{ v: 'on', l: 'Active' }, { v: 'off', l: 'Paused' }], value: r && r.active === false ? 'off' : 'on', half: true }
      ],
      mount: function (form) {
        form.elements.type.addEventListener('change', function () {
          var list = form.elements.type.value === 'income' ? INC_CATS : EXP_CATS;
          form.elements.cat.innerHTML = list.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
        });
      },
      onSubmit: function (v) {
        var amt = money(v.amount);
        if (!v.name) return 'Give it a name.';
        if (!(amt > 0)) return 'Enter the amount as a number greater than zero.';
        if (!v.next) return 'Pick the next due date.';
        var obj = r ? Object.assign({}, r) : { id: newId('c'), kind: 'recur', created: nowISO() };
        Object.assign(obj, { name: v.name, amount: amt, type: v.type, cat: v.cat, freq: v.freq, next: v.next, day: parts(v.next)[2], acct: v.acct, active: v.active !== 'off' });
        persist(function () { return putDoc(obj); });
        toast(r ? 'Changes saved' : 'Recurring payment added');
      },
      remove: r ? { fn: function () { persist(function () { return removeDoc(r.id); }); toast('Deleted'); } } : null
    });
  }
  function openPinForm(kind) {
    var fields = [];
    if (kind !== 'set') fields.push({ name: 'cur', label: 'Current PIN', type: 'password' });
    if (kind !== 'off') {
      fields.push({ name: 'pin', label: 'New PIN (4 to 6 digits)', type: 'password', half: true });
      fields.push({ name: 'pin2', label: 'Repeat new PIN', type: 'password', half: true });
    }
    openForm({
      title: kind === 'set' ? 'Set a PIN' : kind === 'change' ? 'Change PIN' : 'Turn off PIN lock', fields: fields, submit: kind === 'off' ? 'Turn off' : 'Save',
      onSubmit: async function (v) {
        if (kind !== 'set' && !(await checkPin(v.cur))) return 'The current PIN is not right.';
        if (kind === 'off') {
          try { localStorage.removeItem(PIN_KEY); } catch (e) {}
          lock.rec = null; toast('PIN lock turned off'); render(); return;
        }
        if (!/^\d{4,6}$/.test(v.pin)) return 'Use 4 to 6 digits.';
        if (v.pin !== v.pin2) return 'The two PINs do not match.';
        var rec = await makePinRec(v.pin);
        try { localStorage.setItem(PIN_KEY, JSON.stringify(rec)); } catch (e) { return 'This browser blocks saving a PIN, so the lock cannot be turned on here.'; }
        lock.rec = rec; toast(kind === 'set' ? 'PIN lock is on' : 'PIN changed'); render();
      }
    });
  }

  /* ---- loans ---- */
  function openLoanForm(opts) {
    opts = opts || {};
    var S = derive(), l = opts.loan, editing = !!l;
    var names = Array.from(new Set(S.loans.map(function (x) { return String(x.friend).trim(); }))).sort();
    var dir0 = l ? (l.dir === 'borrowed' ? 'borrowed' : 'lent') : 'lent';
    var method0 = l ? l.method : 'UPI';
    var defAcct = function (m) {
      var want = m === 'Cash' ? 'cash' : 'bank', hit = S.accts.find(function (a) { return a.type === want; }) || S.accts[0];
      return hit ? hit.id : '';
    };
    var acct0 = l ? (l.acct || '') : defAcct(method0);
    var html = '<form id="loan-form" novalidate><h2 id="sheet-title">' + (editing ? 'Edit loan' : 'New loan') + '</h2>' +
      '<p class="hint">Write the reason now. It is the part you will not remember later.</p>' +
      '<div class="seg" role="radiogroup" aria-label="Direction"><label><input type="radio" name="dir" value="lent"' + (dir0 === 'lent' ? ' checked' : '') + '><span>I lent</span></label>' +
      '<label><input type="radio" name="dir" value="borrowed"' + (dir0 === 'borrowed' ? ' checked' : '') + '><span>I borrowed</span></label></div>' +
      '<label for="f-friend">Friend</label><input id="f-friend" name="friend" list="f-names" autocomplete="off" maxlength="60" value="' + esc(l ? l.friend : (opts.friend || '')) + '">' +
      '<datalist id="f-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist><div id="f-warn" class="warnbox" hidden></div>' +
      '<div class="two"><div><label for="f-amount">Amount (₹)</label><input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" value="' + esc(l ? l.amount : '') + '"></div>' +
      '<div><label for="f-lent">Date</label><input id="f-lent" name="lent" type="date" value="' + esc(l ? l.lent : todayISO()) + '"></div></div>' +
      '<label for="f-reason">What was it for?</label><input id="f-reason" name="reason" autocomplete="off" maxlength="140" placeholder="e.g. PCB components for his project" value="' + esc(l ? l.reason : '') + '">' +
      '<div class="quick" aria-label="Common reasons">' + ['Food', 'Travel', 'Recharge', 'College fees', 'Project parts', 'Emergency'].map(function (r) { return '<button type="button" data-reason="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
      '<div class="two"><div><label for="f-due">Repay by</label><input id="f-due" name="due" type="date" value="' + esc(l ? l.due : '') + '"></div>' +
      '<div><label for="f-method">Paid via</label><select id="f-method" name="method">' + METHODS.map(function (m) { return '<option' + (m === method0 ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="quick" aria-label="Quick repay-by dates"><button type="button" data-days="7">In 1 week</button><button type="button" data-days="14">In 2 weeks</button><button type="button" data-days="30">In 1 month</button></div>' +
      '<label for="f-acct">Account</label><select id="f-acct" name="acct">' + acctOptions(S).map(function (o) { return '<option value="' + esc(o.v) + '"' + (o.v === acct0 ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select>' +
      '<p class="fhelp">Money moves out of this account when you lend and back in as it is repaid. Loans added before the account was created do not change its balance.</p>' +
      '<label for="f-ref">UPI reference or note (optional)</label><input id="f-ref" name="ref" autocomplete="off" maxlength="80" value="' + esc(l ? l.ref : '') + '">' +
      '<p id="f-err" class="err" role="alert" hidden></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">' + (editing ? 'Save changes' : 'Save loan') + '</button></div></form>';
    openSheet(html, function (s) {
      var form = $('#loan-form', s), warn = $('#f-warn', s), err = $('#f-err', s), touched = editing;
      function checkWarn() {
        var key = form.elements.friend.value.trim().toLowerCase();
        var others = S.loans.filter(function (x) { return (!l || x.id !== l.id) && fk(x) === key; });
        var f = key && others.length ? buildFriends(others)[0] : null;
        if (f && f.owed > 0 && form.elements.dir.value === 'lent') {
          warn.textContent = f.name + ' still owes you ' + inr(f.owed) + (f.overdue > 0 ? ', and ' + inr(f.overdue) + ' of that is overdue.' : '.');
          warn.hidden = false;
        } else warn.hidden = true;
      }
      checkWarn();
      form.elements.friend.addEventListener('input', checkWarn);
      form.elements.dir.forEach(function (r) { r.addEventListener('change', checkWarn); });
      form.elements.acct.addEventListener('change', function () { touched = true; });
      form.elements.method.addEventListener('change', function () { if (!touched) form.elements.acct.value = defAcct(form.elements.method.value); });
      form.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-reason], button[data-days]');
        if (!b) return;
        if (b.dataset.reason) { if (!form.elements.reason.value.trim()) form.elements.reason.value = b.dataset.reason + ': '; form.elements.reason.focus(); }
        else form.elements.due.value = addDays(form.elements.lent.value || todayISO(), +b.dataset.days);
      });
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var fail = function (m) { err.textContent = m; err.hidden = false; };
        var friend = form.elements.friend.value.trim(), amount = money(form.elements.amount.value), reason = form.elements.reason.value.trim();
        var lent = form.elements.lent.value, due = form.elements.due.value;
        if (!friend) return fail('Enter your friend’s name.');
        if (!(amount > 0)) return fail('Enter the amount as a number greater than zero.');
        if (reason.length < 2) return fail('Write what the money was for. This is what you will need later.');
        if (!lent) return fail('Pick the date.');
        if (due && due < lent) return fail('The repay-by date is before the loan date.');
        var paid = l ? calc(l).paid : 0;
        if (amount < paid) return fail('This is less than the ' + inr(paid) + ' already repaid. Remove a repayment first.');
        var existing = S.loans.find(function (x) { return fk(x) === friend.toLowerCase(); });
        if (existing) friend = String(existing.friend).trim();
        var obj = l ? Object.assign({}, l) : { id: newId('l'), kind: 'loan', repayments: [], created: nowISO() };
        Object.assign(obj, { friend: friend, amount: amount, reason: reason, lent: lent, due: due || '', method: form.elements.method.value, ref: form.elements.ref.value.trim(), dir: form.elements.dir.value, acct: form.elements.acct.value });
        persist(function () { return putDoc(obj); });
        ui.tab = 'lending'; ui.fview = 'friend'; ui.fkey = friend.toLowerCase();
        closeSheet(); render(); window.scrollTo(0, 0);
        toast(editing ? 'Changes saved' : 'Loan saved');
      });
    });
  }
  function openRepayForm(id) {
    var l = byId(id);
    if (!l) return;
    var c = calc(l), lent = l.dir !== 'borrowed';
    openForm({
      title: lent ? 'Record repayment' : 'Record payment', hint: String(l.friend).trim() + ' · ' + l.reason + ' · ' + inr(c.bal) + (lent ? ' pending' : ' left to pay'),
      fields: [
        { name: 'amount', label: lent ? 'Amount received (₹)' : 'Amount paid (₹)', value: c.bal, inputmode: 'decimal', half: true },
        { name: 'date', label: lent ? 'Received on' : 'Paid on', type: 'date', value: todayISO(), half: true },
        { name: 'note', label: 'Note (optional)', value: '', placeholder: 'e.g. Part payment by UPI' }
      ], submit: 'Save',
      onSubmit: function (v) {
        var amt = money(v.amount);
        if (!(amt > 0)) return 'Enter the amount as a number greater than zero.';
        if (amt > c.bal + 0.005) return 'That is more than the ' + inr(c.bal) + ' still pending.';
        if (!v.date) return 'Pick a date.';
        if (v.date < l.lent) return 'The date is before the loan was made.';
        var nl = Object.assign({}, l, { repayments: arr(l.repayments).concat([{ id: newId('r'), amount: amt, date: v.date, note: v.note, at: nowISO() }]) });
        persist(function () { return putDoc(nl); });
        toast('Recorded');
      }
    });
  }

  /* ---- messages ---- */
  function reminderText(f) {
    var lines = f.items.filter(function (it) { return !it.c.settled && it.l.dir !== 'borrowed'; }).map(function (it) {
      var part = it.c.paid > 0 ? inr(it.c.bal) + ' pending of ' + inr(it.l.amount) : inr(it.l.amount);
      return '• ' + part + ' for “' + it.l.reason + '”, given on ' + fmtDate(it.l.lent) + (it.l.due ? (it.c.overdue ? ', was due ' : ', due ') + fmtDate(it.l.due) : '');
    });
    return 'Hi ' + f.name + ', a quick reminder about the money I gave you:\n\n' + lines.join('\n') + '\n\nTotal pending: ' + inr(f.owed) + '. Please send it when you can. Thanks!';
  }
  function statementText(f) {
    var out = ['Account statement for ' + f.name, 'As of ' + fmtDate(todayISO()), ''];
    f.items.slice().reverse().forEach(function (it, i) {
      var lent = it.l.dir !== 'borrowed';
      out.push((i + 1) + '. ' + fmtDate(it.l.lent) + ' – ' + (lent ? 'I lent ' : 'I borrowed ') + inr(it.l.amount) + ' – ' + it.l.reason + (it.l.method ? ' (' + it.l.method + ')' : ''));
      arr(it.l.repayments).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (r) { out.push('   ' + (lent ? 'Received ' : 'Paid back ') + inr(r.amount) + ' on ' + fmtDate(r.date)); });
      out.push('   ' + (it.c.settled ? 'Settled' : (lent ? 'Pending ' : 'Still to pay ') + inr(it.c.bal) + (it.l.due ? ', due ' + fmtDate(it.l.due) : '')));
      out.push('');
    });
    if (f.hasL) out.push('Total lent: ' + inr(f.lent), 'Received back: ' + inr(f.back));
    if (f.hasB) out.push('Total borrowed: ' + inr(f.borrowed), 'Paid back: ' + inr(f.paidBack));
    out.push(f.net >= 0 ? 'Pending from ' + f.name + ': ' + inr(f.net) : 'Pending to ' + f.name + ': ' + inr(-f.net));
    return out.join('\n');
  }
  function loanShareText(l) {
    var c = calc(l), lent = l.dir !== 'borrowed', name = String(l.friend).trim(), out = [];
    out.push(lent ? 'Hi ' + name + ', here is the summary of the ' + inr(l.amount) + ' I gave you on ' + fmtDate(l.lent) + ' for “' + l.reason + '”:' :
      'Hi ' + name + ', noting down the ' + inr(l.amount) + ' I borrowed from you on ' + fmtDate(l.lent) + ' for “' + l.reason + '”:');
    out.push('');
    arr(l.repayments).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (r) {
      out.push('• ' + (lent ? 'Received ' : 'Paid back ') + inr(r.amount) + ' on ' + fmtDate(r.date));
    });
    out.push(c.settled ? '• Fully settled' : '• ' + (lent ? 'Remaining: ' : 'Still to pay: ') + inr(c.bal));
    if (!c.settled && l.due) out.push('• ' + (lent ? 'Repay by: ' : 'I will pay by: ') + fmtDate(l.due));
    out.push('', c.settled ? 'Thank you!' : lent ? 'Please send it when you can. Thanks!' : 'Thanks for the help!');
    return out.join('\n');
  }
  function openText(title, text, hint) {
    openSheet('<h2 id="sheet-title">' + esc(title) + '</h2><p class="hint">' + esc(hint || 'Edit the text if you like, then copy it or open it in WhatsApp.') + '</p>' +
      '<label for="m-text">Message</label><textarea id="m-text" rows="12">' + esc(text) + '</textarea>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Close</button><a id="m-wa" class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">Open in WhatsApp</a>' +
      '<button type="button" class="btn btn-primary" data-act="copy-msg">Copy</button></div>', function (s) {
      var ta = $('#m-text', s);
      ta.addEventListener('input', function () { $('#m-wa', s).href = 'https://wa.me/?text=' + encodeURIComponent(ta.value); });
    });
  }
  function openMessage(kind, key) {
    var f = buildFriends(derive().loans).find(function (x) { return x.key === key; });
    if (!f) return;
    openText((kind === 'remind' ? 'Reminder for ' : 'Statement for ') + f.name, kind === 'remind' ? reminderText(f) : statementText(f));
  }
  async function copyFrom(sel) {
    var ta = $(sel);
    if (!ta) return;
    try { await navigator.clipboard.writeText(ta.value); toast('Copied'); }
    catch (e) { ta.focus(); ta.select(); toast('Select and copy the text'); }
  }

  /* ---- backup and restore ---- */
  function openBackup() {
    openSheet('<h2 id="sheet-title">Back up</h2><p class="hint">Saves every entry to one file you keep. Add a password to encrypt it. Without the password the file cannot be opened, so remember it.</p>' +
      (hasCrypto ? '<label for="bk-pw">Password (optional)</label><input id="bk-pw" type="password" autocomplete="new-password" maxlength="64">' : '') +
      '<div id="bk-box" hidden><label for="bk-out">Backup text</label><textarea id="bk-out" rows="6" readonly></textarea></div><p id="bk-err" class="err" role="alert" hidden></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Close</button><button type="button" class="btn" data-act="bk-copy">Copy backup text</button>' +
      (dl || standalone ? '<button type="button" class="btn btn-primary" data-act="bk-save">Download file</button>' : '') + '</div>');
  }
  async function makeBackup() {
    var pw = $('#bk-pw'), err = $('#bk-err');
    err.hidden = true;
    try { return await backupText(pw && pw.value ? pw.value : ''); }
    catch (e) { err.textContent = 'Could not create the backup.'; err.hidden = false; return null; }
  }
  async function saveBackup() {
    var text = await makeBackup();
    if (!text) return;
    if (!dl) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = 'udhaar-khata-backup-' + todayISO() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Backup downloaded');
      return;
    }
    try { await dl.save({ filename: 'udhaar-khata-backup-' + todayISO() + '.json', data: text }); toast('Backup saved'); }
    catch (e) { if (!e || e.code !== 'declined') toast('Could not save the file. Try Copy backup text instead.'); }
  }
  async function copyBackup() {
    var text = await makeBackup();
    if (!text) return;
    $('#bk-out').value = text; $('#bk-box').hidden = false;
    copyFrom('#bk-out');
  }
  function openRestore() {
    openSheet('<h2 id="sheet-title">Restore</h2><p class="hint">Adds back anything missing and overwrites entries that have the same ID. It never deletes anything.</p>' +
      '<label for="rs-file">Backup file</label><input id="rs-file" type="file" accept=".json,.txt,application/json,text/plain">' +
      '<label for="rs-text">Or paste the backup text</label><textarea id="rs-text" rows="5"></textarea>' +
      (hasCrypto ? '<label for="rs-pw">Password (only if the backup is encrypted)</label><input id="rs-pw" type="password" autocomplete="off" maxlength="64">' : '') +
      '<p id="rs-err" class="err" role="alert" hidden></p><div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button type="button" class="btn btn-primary" data-act="do-restore">Restore</button></div>', function (s) {
      $('#rs-file', s).addEventListener('change', function (ev) {
        var f = ev.target.files && ev.target.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () { $('#rs-text', s).value = String(fr.result || ''); };
        fr.readAsText(f);
      });
    });
  }
  async function doRestore() {
    var txt = ($('#rs-text').value || '').trim(), err = $('#rs-err'), pwEl = $('#rs-pw');
    err.hidden = true;
    var fail = function (m) { err.textContent = m; err.hidden = false; };
    if (!txt) return fail('Choose a backup file or paste its text first.');
    var obj;
    try { obj = JSON.parse(txt); } catch (e) { return fail('That does not look like a backup file.'); }
    if (obj && obj.enc) {
      if (!hasCrypto) return fail('This browser cannot open encrypted backups.');
      var pw = pwEl ? pwEl.value : '';
      if (!pw) return fail('This backup is encrypted. Enter its password.');
      try { obj = JSON.parse(await decryptText(obj, pw)); } catch (e) { return fail('The password is wrong, or the file is damaged.'); }
    }
    if (!obj || obj.app !== 'udhaar-khata' || !Array.isArray(obj.docs)) return fail('That file is not an Udhaar Khata backup.');
    var good = obj.docs.filter(function (d) {
      return d && typeof d.id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,100}$/.test(d.id) && (!d.kind || KINDS[d.kind]);
    });
    if (!good.length) return fail('The backup has no entries.');
    closeSheet();
    persist(async function () {
      for (var i = 0; i < good.length; i++) await putDoc(good[i]);
      toast('Restored ' + plural(good.length, 'entry'));
    });
  }

  /* ---- sample data ---- */
  function loadSamples() {
    var t = todayISO(), ym = monthOf(t), pym = addMonths(ym, -1), td = parts(t)[2], now = nowISO();
    var D = function (n) { return ym + '-' + pad(Math.min(n, td)); };
    var P = function (n) { return pym + '-' + pad(n); };
    var list = [], idCash = newId('a'), idBank = newId('a');
    var push = function (o) { o.sample = true; o.created = now; list.push(o); };
    push({ id: idCash, kind: 'acct', name: 'Cash in hand', type: 'cash', opening: 2500 });
    push({ id: idBank, kind: 'acct', name: 'SBI savings', type: 'bank', opening: 14000 });
    var tx = function (type, amount, date, cat, note, acct) { push({ id: newId('t'), kind: 'txn', type: type, amount: amount, date: date, cat: cat, note: note, acct: acct || '' }); };
    tx('income', 8000, D(1), 'Pocket money', 'Monthly pocket money', idBank);
    tx('income', 4500, D(4), 'Freelance', 'Fiverr PCB layout gig', idBank);
    tx('expense', 650, D(2), 'Food', 'Canteen and snacks', idCash);
    tx('expense', 480, D(5), 'Food', 'Dinner with friends', idCash);
    tx('expense', 520, D(7), 'Food', 'Groceries', idCash);
    tx('expense', 3500, D(1), 'Hostel & rent', 'Hostel mess fee', idBank);
    tx('expense', 299, D(3), 'Bills & recharge', 'Phone recharge', idBank);
    tx('expense', 1250, D(4), 'Education & projects', 'PCB fabrication order', idBank);
    tx('expense', 340, D(6), 'Travel', 'Metro card top-up', idBank);
    tx('expense', 199, D(5), 'Subscriptions', 'Music subscription', idBank);
    tx('expense', 799, D(7), 'Shopping', 'Headphones', idBank);
    tx('expense', 250, D(8), 'Entertainment', 'Movie night', idBank);
    tx('income', 8000, P(1), 'Pocket money', 'Monthly pocket money');
    tx('income', 3000, P(12), 'Freelance', 'Fiverr PCB layout gig');
    tx('expense', 2100, P(10), 'Food', 'Canteen and groceries');
    tx('expense', 3500, P(1), 'Hostel & rent', 'Hostel mess fee');
    tx('expense', 299, P(3), 'Bills & recharge', 'Phone recharge');
    tx('expense', 900, P(14), 'Education & projects', 'Components order');
    tx('expense', 520, P(15), 'Travel', 'Train tickets');
    tx('expense', 199, P(5), 'Subscriptions', 'Music subscription');
    tx('expense', 1200, P(20), 'Shopping', 'Shoes');
    tx('expense', 450, P(22), 'Entertainment', 'Movie night');
    var loan = function (o) {
      o.id = newId('l'); o.kind = 'loan';
      o.repayments = (o.reps || []).map(function (r) { return { id: newId('r'), amount: r[0], date: r[1], note: r[2], at: now }; });
      delete o.reps; push(o);
    };
    loan({ friend: 'Rahul', amount: 5000, reason: 'PCB components for his project', lent: addDays(t, -6), due: addDays(t, 1), method: 'UPI', dir: 'lent', acct: idBank, reps: [[2000, addDays(t, -2), 'Part payment']] });
    loan({ friend: 'Sneha', amount: 1200, reason: 'Lab record and file charges', lent: addDays(t, -25), due: addDays(t, -10), method: 'UPI', dir: 'lent', acct: '', reps: [] });
    loan({ friend: 'Aman', amount: 300, reason: 'Auto fare to the station', lent: addDays(t, -30), due: addDays(t, -20), method: 'Cash', dir: 'lent', acct: '', reps: [[300, addDays(t, -22), 'Paid in full']] });
    loan({ friend: 'Karan', amount: 800, reason: 'Train ticket, borrowed', lent: addDays(t, -4), due: addDays(t, 9), method: 'UPI', dir: 'borrowed', acct: idBank, reps: [] });
    [['Food', 2500], ['Education & projects', 1000], ['Shopping', 900], ['Entertainment', 500]].forEach(function (b) { push({ id: 'b-' + slug(b[0]), kind: 'budget', cat: b[0], limit: b[1] }); });
    push({ id: newId('g'), kind: 'goal', name: 'Laptop', target: 60000, deadline: addDays(t, 200), contribs: [{ id: newId('c'), amount: 15000, date: P(18), note: '' }, { id: newId('c'), amount: 9000, date: D(3), note: '' }] });
    push({ id: newId('g'), kind: 'goal', name: 'Emergency fund', target: 10000, deadline: '', contribs: [{ id: newId('c'), amount: 2500, date: D(2), note: '' }] });
    var rec = function (name, amount, cat, next) { push({ id: newId('c'), kind: 'recur', name: name, amount: amount, type: 'expense', cat: cat, freq: 'monthly', next: next, day: parts(next)[2], acct: idBank, active: true }); };
    rec('Hostel mess fee', 3500, 'Hostel & rent', addMonths(ym, 1) + '-01');
    rec('Phone recharge', 299, 'Bills & recharge', addDays(t, 2));
    rec('Music subscription', 199, 'Subscriptions', addDays(t, -1));
    persist(async function () { for (var i = 0; i < list.length; i++) await putDoc(list[i]); });
    ui.tab = 'home';
  }

  /* ================= events ================= */
  function arm(key, refocus) {
    ui.confirm = key; ui.refocus = refocus; render();
    clearTimeout(armTimer);
    armTimer = setTimeout(function () { ui.confirm = null; render(); }, 4000);
  }
  function goto(tab) {
    if (tab === 'search' || tab === 'settings') { if (ui.tab !== 'search' && ui.tab !== 'settings') ui.last = ui.tab; }
    ui.tab = tab; ui.confirm = null; render(); window.scrollTo(0, 0);
    if (tab === 'search') { var q = $('#q'); if (q) q.focus(); }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act, id = el.dataset.id, d = el.dataset;
    switch (act) {
      case 'goto': goto(d.tab); break;
      case 'lock-now': lockNow(); break;
      case 'month': ui.month = addMonths(ui.month, +d.d); if (ui.month > thisMonth()) ui.month = thisMonth(); render(); break;
      case 'add-txn': openTxnForm(d.type); break;
      case 'edit-txn': var tx = byId(id); if (tx) openTxnForm(tx.type, tx); break;
      case 'mfilter': ui.mfilter = d.f; render(); break;
      case 'add-acct': openAcctForm(); break;
      case 'edit-acct': var ac = byId(id); if (ac) openAcctForm(ac); break;
      case 'bal-acct': var ab = byId(id); if (ab) openBalanceForm(ab); break;
      case 'add-loan': openLoanForm({ friend: d.friend }); break;
      case 'edit-loan': var el2 = byId(id); if (el2) openLoanForm({ loan: el2 }); break;
      case 'open-friend': ui.tab = 'lending'; ui.fview = 'friend'; ui.fkey = d.key; render(); window.scrollTo(0, 0); break;
      case 'back': ui.fview = 'home'; ui.fkey = null; render(); window.scrollTo(0, 0); break;
      case 'filter': ui.ffilter = d.f; render(); break;
      case 'repay': openRepayForm(id); break;
      case 'settle':
        var sl = byId(id);
        if (sl) {
          var bal = calc(sl).bal;
          once('settle:' + id, function () { return putDoc(Object.assign({}, sl, { repayments: arr(sl.repayments).concat([{ id: newId('r'), amount: bal, date: todayISO(), note: 'Marked fully repaid', at: nowISO() }]) })); });
          toast('Marked fully repaid');
        }
        break;
      case 'del-loan':
        if (ui.confirm !== 'dl:' + id) { arm('dl:' + id, '[data-act="del-loan"][data-id="' + id + '"]'); break; }
        ui.confirm = null; persist(function () { return removeDoc(id); }); toast('Loan deleted'); render();
        break;
      case 'del-rep':
        var rk = 'dr:' + id + ':' + d.rep;
        if (ui.confirm !== rk) { arm(rk, '[data-act="del-rep"][data-rep="' + d.rep + '"]'); break; }
        var rl = byId(id);
        ui.confirm = null;
        if (rl) { persist(function () { return putDoc(Object.assign({}, rl, { repayments: arr(rl.repayments).filter(function (r) { return r.id !== d.rep; }) })); }); toast('Repayment removed'); }
        render();
        break;
      case 'msg': openMessage(d.kind, d.key); break;
      case 'share-loan': var sh = byId(id); if (sh) openText('Share with ' + String(sh.friend).trim(), loanShareText(sh), 'A summary you can send. Edit it, then copy it or open it in WhatsApp.'); break;
      case 'copy-msg': copyFrom('#m-text'); break;
      case 'add-budget': openBudgetForm(); break;
      case 'edit-budget': var bd = byId(id); if (bd) openBudgetForm(bd); break;
      case 'add-goal': openGoalForm(); break;
      case 'edit-goal': var gd = byId(id); if (gd) openGoalForm(gd); break;
      case 'goal-add': var ga = byId(id); if (ga) openContribForm(ga); break;
      case 'del-contrib':
        var gc = byId(id);
        if (gc) { persist(function () { return putDoc(Object.assign({}, gc, { contribs: arr(gc.contribs).filter(function (c) { return c.id !== d.cid; }) })); }); toast('Removed'); }
        break;
      case 'add-recur': openRecurForm(); break;
      case 'edit-recur': var rd = byId(id); if (rd) openRecurForm(rd); break;
      case 'log-recur':
        var rr = byId(id);
        if (rr) {
          var txn = { id: newId('t'), kind: 'txn', type: rr.type || 'expense', amount: rr.amount, date: rr.next, cat: rr.cat, note: rr.name, acct: rr.acct || '', recur: rr.id, created: nowISO() };
          if (rr.sample) txn.sample = true;
          once('recur:' + id + ':' + rr.next, async function () { await putDoc(txn); await putDoc(Object.assign({}, rr, { next: nextDue(rr) })); });
          toast('Logged ' + rr.name);
        }
        break;
      case 'skip-recur':
        var rs = byId(id);
        if (rs) { once('recur:' + id + ':' + rs.next, function () { return putDoc(Object.assign({}, rs, { next: nextDue(rs) })); }); toast('Skipped'); }
        break;
      case 'open-entry':
        if (d.kind === 'txn') { var te = byId(id); if (te) openTxnForm(te.type, te); }
        else { ui.tab = 'lending'; ui.fview = 'friend'; ui.fkey = d.key; render(); window.scrollTo(0, 0); }
        break;
      case 'load-samples': loadSamples(); break;
      case 'clear-samples':
        docs.filter(function (x) { return x.sample; }).forEach(function (x) { persist(function () { return removeDoc(x.id); }); });
        toast('Sample data cleared');
        break;
      case 'cloud-signin': cloudSignIn(); break;
      case 'cloud-signout': cloudSignOut(); break;
      case 'cloud-unlock': openUnlockSync(); break;
      case 'cloud-setup': openSetupSync(); break;
      case 'cloud-upload': uploadLocal(); break;
      case 'export-csv': exportCSV(); break;
      case 'set-pin': openPinForm('set'); break;
      case 'change-pin': openPinForm('change'); break;
      case 'off-pin': openPinForm('off'); break;
      case 'backup': openBackup(); break;
      case 'bk-save': saveBackup(); break;
      case 'bk-copy': copyBackup(); break;
      case 'restore': openRestore(); break;
      case 'do-restore': doRestore(); break;
      case 'close-sheet': closeSheet(); break;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'q') { ui.q = t.value; var sr = $('#sr'); if (sr) sr.innerHTML = resultsHTML(derive()); }
    else if (t.id === 'pin' && lock.rec && t.value.length === lock.rec.len) {
      tryUnlock(t.value).then(function (msg) { var er = $('#lock-err'); if (msg && er) { er.textContent = msg; er.hidden = false; t.value = ''; } });
    }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'lock-form') return;
    e.preventDefault();
    var pin = e.target.elements.pin.value;
    tryUnlock(pin).then(function (msg) { var er = $('#lock-err'); if (msg && er) { er.textContent = msg; er.hidden = false; e.target.elements.pin.value = ''; } });
  });

  /* chart tooltips */
  var tip = $('#tip');
  function showTip(target) {
    var tx = target.getAttribute('data-tip');
    if (!tx) return;
    tip.textContent = tx; tip.hidden = false;
    var r = target.getBoundingClientRect(), w = tip.offsetWidth;
    var cx = Math.min(Math.max(r.left + r.width / 2, 8 + w / 2), window.innerWidth - 8 - w / 2);
    tip.style.left = cx + 'px'; tip.style.top = Math.max(r.top, 40) + 'px';
  }
  document.addEventListener('pointerover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('pointerout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) tip.hidden = true; });
  document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('focusout', function () { tip.hidden = true; });
  window.addEventListener('scroll', function () { tip.hidden = true; }, { passive: true });

  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (!lock.locked && ui.tab === 'reports') drawTrend(); }, 150); });

  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = Date.now();
    else if (lock.rec && hiddenAt && Date.now() - hiddenAt > 60000) lockNow();
  });

  init();
})();
