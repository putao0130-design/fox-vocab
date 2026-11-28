// Join-apply and session-refresh tests for the shared web client.
// Leftover focus on #sync-join after submit is the default path (Safari, Edge,
// HarmonyOS, and any browser that does not move focus to the submit button).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const adapter = require('../supabase/client-adapter.js');

const ROOT = path.join(__dirname, '..');
const KEY = 'foxVocab.v2';
const ON = 'foxVocab.syncOn';
const BASE = 'foxVocab.syncBase';
const REV = 'foxVocab.syncSettingsRev';
const BOOK = 'ielts-toefl-core';
const PROJECT_URL = adapter.PROJECT_URL;
const FAKE_ANON = 'anon-public-test-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function card(last, reps) {
  return { due: last + 86400000, stability: 2, difficulty: 5, reps: reps, lapses: 0, state: 2, last_review: last, learnedAt: last, mastered: false, masteredAt: null };
}
function localState() {
  return {
    v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
    books: { [BOOK]: { cards: { alpha: card(1, 1), beta: card(2, 1) }, sentences: [], extra: [], today: [] } },
    customBooks: [], days: { '2026-11-03': { new: 1, review: 0, correct: 1, wrong: 0 }, '2026-11-04': { new: 1, review: 0, correct: 1, wrong: 0 } },
    studyDays: ['2026-11-03', '2026-11-04'], fox: { food: 2, xp: 2, fed: 0, name: '豆豆' }
  };
}
function remoteState() {
  const books = { [BOOK]: { cards: {}, sentences: [], extra: [], today: [] } };
  const days = {};
  const studyDays = [];
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi'];
  words.forEach(function (word, i) {
    books[BOOK].cards[word] = card(1000 + i, 1);
    const day = i < 2 ? '2026-11-0' + (3 + i) : '2026-11-' + String(5 + (i % 5)).padStart(2, '0');
    days[day] = { day: day, zone: 'device-local', new: 1, review: 0, correct: 1, wrong: 0 };
    studyDays.push({ day: day, zone: 'device-local', source: 'test' });
  });
  // 14 cards, unique days 11/03–11/09 = 7, plus we already have 11/03 and 11/04
  // Add two extra unique days so the merge has 9 check-in days.
  ['2026-11-10', '2026-11-11'].forEach(function (day) {
    days[day] = { day: day, zone: 'device-local', new: 1, review: 0, correct: 1, wrong: 0 };
    studyDays.push({ day: day, zone: 'device-local', source: 'test' });
  });
  return {
    v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK, settingsRev: 3 },
    settingsRev: 3, books: books, customBooks: [], days: days, studyDays: studyDays,
    fox: { food: 14, xp: 14, fed: 0, name: '豆豆' }
  };
}
function cardCount(state) {
  let n = 0;
  Object.keys((state && state.books) || {}).forEach(function (id) {
    n += Object.keys((state.books[id] && state.books[id].cards) || {}).length;
  });
  return n;
}
function memoryLocalStorage() {
  const m = Object.create(null);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }
  };
}
function el(tag, id, parent) {
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    id: id || '',
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    parentNode: parent || null,
    onclick: null,
    addEventListener: function () {},
    closest: function (sel) {
      if (!sel || sel.charAt(0) !== '#') return null;
      const want = sel.slice(1);
      let cur = node;
      while (cur) {
        if (cur.id === want) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
  };
  return node;
}

function boot(opts) {
  opts = opts || {};
  const prep = require('../sync-prep.js');
  const localStorage = memoryLocalStorage();
  let S = opts.state ? JSON.parse(JSON.stringify(opts.state)) : localState();
  localStorage.setItem(KEY, JSON.stringify(S));
  if (opts.syncOn) localStorage.setItem(ON, '1');

  const slot = el('div', 'sync-slot');
  const ids = {
    'sync-slot': slot,
    'syncstatus': el('div', 'syncstatus', slot),
    'sync-preview': el('div', 'sync-preview', slot),
    'sync-enable': el('button', 'sync-enable', slot),
    'sync-go': el('button', 'sync-go', slot),
    'sync-secret': el('input', 'sync-secret', slot),
    'sync-hid': el('button', 'sync-hid', slot),
    'sync-code': el('input', 'sync-code', slot),
    'sync-join': el('input', 'sync-join', slot),
    'sync-submit': el('button', 'sync-submit', slot),
    'sync-recover': el('input', 'sync-recover', slot),
    'sync-recover-go': el('button', 'sync-recover-go', slot),
    'sync-pending': el('div', 'sync-pending', slot)
  };
  const body = el('body', '');
  body.tagName = 'BODY';
  // Default: leftover focus stays on the pairing field after submit, as on
  // Safari / Edge / HarmonyOS. blur() is a no-op unless allowBlur is set.
  let active = opts.focus === 'body' ? body : ids['sync-join'];
  const listeners = {};
  const timeouts = [];
  const intervals = [];
  let tid = 0;
  const logs = { pull: 0, refresh: 0, resume: 0, apply: 0, deferred: 0, tokens: [] };
  let forceDefer = !!opts.forceDefer;
  const remote = opts.remote || { state: remoteState() };

  const backend = {
    accessExpired: function (session) {
      if (!session || !session.accessToken) return true;
      if (!session.accessExpires) return false;
      return Date.now() >= session.accessExpires - 15000;
    },
    refreshSession: async function (session) {
      logs.refresh += 1;
      if (opts.refreshFails) {
        const err = new Error('expired');
        err.data = { error: 'expired' };
        throw err;
      }
      session.accessToken = 'fresh-access';
      session.refreshToken = 'fresh-refresh';
      session.accessExpires = Date.now() + 5 * 60 * 1000;
      return session;
    },
    resume: async function () {
      logs.resume += 1;
      return {
        accessToken: 'resumed-access', refreshToken: 'resumed-refresh',
        accessExpires: Date.now() + 5 * 60 * 1000, spaceId: 'space', deviceId: 'dev', role: 'member'
      };
    },
    submitPairing: async function () {
      return { fingerprint: 'abcdabcd99999999', status: 'pending', session: { pairingId: 'pair-1', fingerprint: 'abcdabcd99999999' } };
    },
    claimPairing: async function (session) {
      session.accessToken = opts.accessToken || 'join-access';
      session.refreshToken = 'join-refresh';
      session.accessExpires = opts.accessExpires != null ? opts.accessExpires : Date.now() + 5 * 60 * 1000;
      session.spaceId = 'space';
      session.deviceId = 'member-dev';
      session.role = 'member';
      return session;
    },
    pull: async function (session) {
      logs.pull += 1;
      logs.tokens.push(session && session.accessToken);
      if (opts.pullExpired && session && session.accessToken !== 'fresh-access' && session.accessToken !== 'resumed-access') {
        const err = new Error('expired');
        err.data = { error: 'expired' };
        throw err;
      }
      if (opts.pullUnauthorized) {
        const err = new Error('unauthorized');
        err.data = { error: 'unauthorized' };
        throw err;
      }
      return JSON.parse(JSON.stringify(remote));
    },
    mintPairing: async function () { return { payload: 'TEST-PAYLOAD-NOT-A-REAL-CODE' }; },
    pendingPairings: async function () { return { pending: [] }; },
    recover: async function () {
      return { session: { accessToken: 'rec-access', refreshToken: 'rec-refresh', accessExpires: Date.now() + 5 * 60 * 1000, spaceId: 'space', deviceId: 'rec-dev', role: 'owner' } };
    }
  };

  const document = {
    body: body,
    get activeElement() { return active; },
    set activeElement(v) { active = v; },
    getElementById: function (id) { return ids[id] || null; },
    addEventListener: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    dispatch: function (type) {
      (listeners[type] || []).forEach(function (fn) { fn({ type: type }); });
    }
  };
  ids['sync-join'].value = 'TEST-PAYLOAD-NOT-A-REAL-CODE';
  ids['sync-join'].blur = function () {
    if (opts.allowBlur) active = body;
    // else: leftover focus stays on the pairing field (default path)
  };
  ids['sync-recover'].blur = ids['sync-join'].blur;
  ids['sync-code'].blur = ids['sync-join'].blur;
  ids['sync-secret'].blur = ids['sync-join'].blur;

  function fieldBusy() {
    const node = document.activeElement;
    if (!node || node.nodeType !== 1) return false;
    if (node.closest && node.closest('#sync-slot')) return false;
    if (node.id === 'sync-join' || node.id === 'sync-recover' || node.id === 'sync-code' || node.id === 'sync-secret') return false;
    return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT';
  }

  const ctx = {
    console: console,
    Date: Date, JSON: JSON, Object: Object, Array: Array, Number: Number,
    String: String, Math: Math, Error: Error, Boolean: Boolean, Promise: Promise,
    parseInt: parseInt, isFinite: isFinite, NaN: NaN, undefined: undefined,
    setTimeout: function (fn, ms) { const id = ++tid; timeouts.push({ id: id, fn: fn, ms: ms }); return id; },
    clearTimeout: function (id) { for (let i = timeouts.length - 1; i >= 0; i--) if (timeouts[i].id === id) timeouts.splice(i, 1); },
    setInterval: function (fn, ms) { const id = ++tid; intervals.push({ id: id, fn: fn, ms: ms }); return id; },
    clearInterval: function (id) { for (let i = intervals.length - 1; i >= 0; i--) if (intervals[i].id === id) intervals.splice(i, 1); },
    localStorage: localStorage,
    document: document,
    VocabSyncPrep: prep,
    DogverbSync: { idbStorage: function () { return { get: async function () { return null; }, set: async function () {} }; } },
    DogverbSupabase: { disabled: function () { return false; }, bind: function () { return backend; } },
    DOGVERB_SYNC_CONFIG: { url: PROJECT_URL, anonKey: FAKE_ANON }
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.__dogverbReadState = function () { return JSON.parse(JSON.stringify(S)); };
  ctx.__dogverbFieldBusy = fieldBusy;
  ctx.__dogverbApplyRemote = function (next) {
    if (forceDefer || fieldBusy()) {
      logs.deferred += 1;
      return { deferred: true };
    }
    logs.apply += 1;
    S = JSON.parse(JSON.stringify(next));
    localStorage.setItem(KEY, JSON.stringify(S));
    return { applied: true };
  };

  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sync-app.js'), 'utf8'), ctx, { filename: 'sync-app.js' });

  async function flushTimeouts() {
    const batch = timeouts.splice(0, timeouts.length);
    for (let i = 0; i < batch.length; i++) await batch[i].fn();
  }

  return {
    ctx: ctx, ids: ids, document: document, localStorage: localStorage, logs: logs, backend: backend,
    fieldBusy: fieldBusy,
    get state() { return S; },
    set forceDefer(v) { forceDefer = v; },
    get forceDefer() { return forceDefer; },
    flushTimeouts: flushTimeouts,
    status: function () { return ctx.DogverbAppSync.status(); },
    pending: function () { return ctx.DogverbAppSync.pending(); },
    setFocus: function (node) { active = node; }
  };
}

function fieldBusyFromApp(document) {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const m = src.match(/function fieldBusy\(\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'fieldBusy not found in app.js');
  const sandbox = { document: document, result: null };
  vm.runInNewContext(m[0] + '\nresult = fieldBusy();', sandbox);
  return sandbox.result;
}

(async function main() {
  // fieldBusy: leftover focus on pairing fields is not busy; study typers still are.
  const slot = el('div', 'sync-slot');
  const join = el('input', 'sync-join', slot);
  const recover = el('input', 'sync-recover', slot);
  const typo = el('input', 'inp');
  typo.closest = function () { return null; };
  const body = el('body', '');
  assert.strictEqual(fieldBusyFromApp({ activeElement: join }), false, 'sync-join leftover focus must not be fieldBusy');
  assert.strictEqual(fieldBusyFromApp({ activeElement: recover }), false, 'sync-recover leftover focus must not be fieldBusy');
  assert.strictEqual(fieldBusyFromApp({ activeElement: typo }), true, 'study typers stay fieldBusy');
  assert.strictEqual(fieldBusyFromApp({ activeElement: body }), false);
  assert.strictEqual(fieldBusyFromApp({ activeElement: null }), false);
  // Fallback when closest is missing (older WebViews): id list still applies.
  const noClosest = el('input', 'sync-join', slot);
  noClosest.closest = undefined;
  assert.strictEqual(fieldBusyFromApp({ activeElement: noClosest }), false, 'id fallback without closest');

  // Default path: join while #sync-join stays focused (blur is a no-op).
  // Progress must be written, syncBase must be the merge, 已连接 only after the write.
  const a = boot({ focus: 'join' });
  const preMerge = a.localStorage.getItem(KEY);
  assert.strictEqual(cardCount(a.state), 2);
  assert.strictEqual(a.fieldBusy(), false, 'pairing field focus is not busy on the default path');
  await a.ctx.DogverbAppSync.join();
  assert.notStrictEqual(a.status().statusText, '已连接', 'must not show 已连接 before the delayed claim/apply');
  assert.strictEqual(a.localStorage.getItem(BASE), null, 'must not snapshot pre-merge local state as syncBase before apply');
  assert.strictEqual(a.localStorage.getItem(KEY), preMerge);
  await a.flushTimeouts();
  assert.ok(a.ids['sync-join'] === a.document.activeElement, 'cursor still on #sync-join after submit (default leftover-focus path)');
  assert.strictEqual(a.status().statusText, '已连接');
  assert.strictEqual(cardCount(a.state), 14);
  assert.strictEqual((a.state.studyDays || []).length, 9);
  const base = JSON.parse(a.localStorage.getItem(BASE));
  assert.strictEqual(cardCount(base), 14, 'syncBase is the merged state, not the 2-card local history');
  assert.notStrictEqual(a.localStorage.getItem(KEY), preMerge);
  assert.ok(a.logs.apply >= 1);
  assert.strictEqual(a.logs.deferred, 0);
  assert.strictEqual(a.pending(), null);

  // If apply would be deferred (e.g. a study field is busy), join must not
  // write syncBase from pre-merge local state or show 已连接. A later retry
  // after focus leaves must still apply the successful remote merge.
  const b = boot({ focus: 'join', forceDefer: true });
  const before = b.localStorage.getItem(KEY);
  await b.ctx.DogverbAppSync.join();
  await b.flushTimeouts();
  assert.notStrictEqual(b.status().statusText, '已连接', 'deferred join must not show 已连接');
  assert.strictEqual(b.localStorage.getItem(BASE), null, 'deferred join must not snapshot pre-merge local as syncBase');
  assert.strictEqual(cardCount(b.state), 2);
  assert.strictEqual(b.localStorage.getItem(KEY), before);
  assert.ok(b.pending(), 'deferred merge is kept for retry');
  assert.ok(b.logs.deferred >= 1);
  b.forceDefer = false;
  b.setFocus(b.ctx.document ? b.document.body : b.document.body);
  b.ctx.DogverbAppSync.retryPendingApply();
  assert.strictEqual(b.status().statusText, '已连接');
  assert.strictEqual(cardCount(b.state), 14);
  assert.strictEqual((JSON.parse(b.localStorage.getItem(BASE)).studyDays || []).length, 9);
  assert.strictEqual(b.pending(), null);

  // Later pull still proceeds after focus leaves and does not permanently skip the merge.
  const c = boot({ focus: 'join', forceDefer: true, syncOn: true });
  await c.ctx.DogverbAppSync.join();
  await c.flushTimeouts();
  assert.notStrictEqual(c.status().statusText, '已连接');
  assert.strictEqual(cardCount(c.state), 2);
  c.forceDefer = false;
  c.setFocus(c.document.body);
  await c.ctx.DogverbAppSync.pull();
  assert.strictEqual(c.status().statusText, '已连接');
  assert.strictEqual(cardCount(c.state), 14);
  assert.strictEqual(cardCount(JSON.parse(c.localStorage.getItem(BASE))), 14);

  // Token expiry: in-memory session is refreshed; pull applies instead of stalling on 暂时连不上同步.
  const d = boot({
    focus: 'join',
    forceDefer: true,
    accessExpires: Date.now() - 1000,
    accessToken: 'stale-access',
    pullExpired: true
  });
  await d.ctx.DogverbAppSync.join();
  await d.flushTimeouts();
  assert.strictEqual(cardCount(d.state), 2, 'first apply deferred');
  assert.notStrictEqual(d.status().statusText, '已连接');
  d.forceDefer = false;
  d.setFocus(d.document.body);
  // Claim left a stale in-memory token; later pull must refresh, then apply.
  await d.ctx.DogverbAppSync.pull();
  assert.ok(d.logs.refresh >= 1, 'expired in-memory access token is refreshed');
  assert.ok(d.logs.tokens.indexOf('fresh-access') !== -1, 'pull uses the refreshed token');
  assert.notStrictEqual(d.status().errorText, '暂时连不上同步');
  assert.strictEqual(d.status().statusText, '已连接');
  assert.strictEqual(cardCount(d.state), 14);

  // mount() after reload pulls immediately (does not wait for the 5s interval).
  const e = boot({
    focus: 'body',
    syncOn: true,
    accessExpires: Date.now() - 1000
  });
  // Preload an in-memory session by joining is not needed; mount calls ensureSession.
  // Put a stale session into the backend resume path already handled; also
  // inject a stale in-memory session by calling ensureSession after a fake session is impossible
  // without internals. Instead, resume() is used on mount because session starts null.
  // Cover "immediate pull on mount":
  e.ctx.DogverbAppSync.mount();
  // ensureSession().then(pull).then(arm) — those thenables use the sandbox Promise.
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.ok(e.logs.resume >= 1, 'mount resumes the session');
  assert.ok(e.logs.pull >= 1, 'mount pulls immediately, not only on the 5s interval');
  assert.strictEqual(cardCount(e.state), 14);
  assert.strictEqual(e.status().statusText, '已连接');

  // Adapter: accessExpires is tracked; withAccess refreshes before pull when expired.
  const calls = [];
  let nonce = 0;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const fetchFn = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body.action + ':' + (body.accessToken || body.refreshToken || ''));
    const json = function (obj, status) {
      return { ok: (status || 200) < 400, status: status || 200, json: async function () { return obj; } };
    };
    if (body.action === 'challenge') return json({ nonce: 'n' + (++nonce) });
    if (body.action === 'refresh') {
      return json({
        accessToken: 'fresh-access', refreshToken: 'fresh-refresh', accessTtlMs: 300000,
        spaceId: 'space', deviceId: 'dev', role: 'member', fingerprint: 'ffffffff'
      });
    }
    if (body.action === 'pull') {
      if (body.accessToken === 'stale-access') return json({ error: 'expired' }, 401);
      if (body.accessToken === 'fresh-access') return json({ state: remoteState() });
      return json({ error: 'unexpected-token' }, 401);
    }
    return json({ error: 'unexpected-action' }, 400);
  };
  const api = adapter.bind({ url: PROJECT_URL, anonKey: FAKE_ANON, fetch: fetchFn });
  assert.strictEqual(api.accessExpired({ accessToken: 'x', accessExpires: Date.now() - 1 }), true);
  assert.strictEqual(api.accessExpired({ accessToken: 'x', accessExpires: Date.now() + 60000 }), false);
  assert.strictEqual(api.accessExpired({ accessToken: 'x' }), false, 'unknown expiry is tried first, then retried on expired');
  assert.strictEqual(api.accessExpired({}), true);
  const session = {
    privateKey: pair.privateKey, publicJwk: pub, fingerprint: 'ffffffff',
    accessToken: 'stale-access', refreshToken: 'stale-refresh',
    accessExpires: Date.now() - 1000, spaceId: 'space', deviceId: 'dev', role: 'member'
  };
  const pulled = await api.pull(session);
  assert.ok(pulled && pulled.state, 'pull succeeds after refresh');
  assert.strictEqual(session.accessToken, 'fresh-access');
  assert.ok(session.accessExpires > Date.now(), 'adopt records a new accessExpires');
  assert.ok(calls.some(function (c) { return c.indexOf('refresh:') === 0; }), 'adapter refreshes the expired access token');
  assert.ok(calls.some(function (c) { return c === 'pull:fresh-access'; }), 'adapter pull uses the new access token');

  // Clock-skew path: token not yet marked expired, server returns expired, retry after refresh.
  const calls2 = [];
  let nonce2 = 0;
  const fetch2 = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls2.push(body.action + ':' + (body.accessToken || body.refreshToken || ''));
    const json = function (obj, status) {
      return { ok: (status || 200) < 400, status: status || 200, json: async function () { return obj; } };
    };
    if (body.action === 'challenge') return json({ nonce: 'n' + (++nonce2) });
    if (body.action === 'refresh') {
      return json({
        accessToken: 'fresh-access', refreshToken: 'fresh-refresh', accessTtlMs: 300000,
        spaceId: 'space', deviceId: 'dev', role: 'member', fingerprint: 'ffffffff'
      });
    }
    if (body.action === 'pull') {
      if (body.accessToken === 'stale-access') return json({ error: 'expired' }, 401);
      return json({ state: remoteState() });
    }
    return json({ error: 'unexpected-action' }, 400);
  };
  const api2 = adapter.bind({ url: PROJECT_URL, anonKey: FAKE_ANON, fetch: fetch2 });
  const session2 = {
    privateKey: pair.privateKey, publicJwk: pub, fingerprint: 'ffffffff',
    accessToken: 'stale-access', refreshToken: 'stale-refresh',
    accessExpires: Date.now() + 60000, spaceId: 'space', deviceId: 'dev', role: 'member'
  };
  const pulled2 = await api2.pull(session2);
  assert.ok(pulled2 && pulled2.state);
  assert.ok(calls2.indexOf('pull:stale-access') !== -1, 'first pull attempted with in-memory token');
  assert.ok(calls2.some(function (c) { return c.indexOf('refresh:') === 0; }));
  assert.ok(calls2.indexOf('pull:fresh-access') !== -1);
  assert.strictEqual(session2.accessToken, 'fresh-access');

  console.log('ok ' + module.filename);
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
