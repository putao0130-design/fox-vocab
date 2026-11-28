// P0 sync fixes: project() null handling, outbox flush/dead-letter,
// pending pairing persist/resume/timeout, and arming sync without the settings page.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const adapter = require('../supabase/client-adapter.js');
const wire = require('../sync-wire.js');

const ROOT = path.join(__dirname, '..');
const KEY = 'foxVocab.v2';
const ON = 'foxVocab.syncOn';
const BASE = 'foxVocab.syncBase';
const OUT = 'foxVocab.syncOutbox';
const DEAD = 'foxVocab.syncDead';
const BOOK = 'ielts-toefl-core';
const PROJECT_URL = adapter.PROJECT_URL;
const FAKE_ANON = 'anon-public-test-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const NULL_STATUS = '已连接，但云端数据没读出来，本次没有合并';

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
  if (opts.outbox) localStorage.setItem(OUT, JSON.stringify(opts.outbox));
  if (opts.dead) localStorage.setItem(DEAD, JSON.stringify(opts.dead));

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
  let active = opts.focus === 'body' ? body : ids['sync-join'];
  const listeners = {};
  const timeouts = [];
  const intervals = [];
  let tid = 0;
  const logs = { pull: 0, flush: 0, push: 0, refresh: 0, resume: 0, apply: 0, claim: 0, pendingResume: 0, clearPending: 0 };
  let forceDefer = !!opts.forceDefer;
  const remote = opts.remote || { state: remoteState() };
  const pushImpl = opts.pushEvents || async function (session, events) {
    logs.push += 1;
    return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
  };

  const backend = {
    accessExpired: function (session) {
      if (!session || !session.accessToken) return true;
      if (!session.accessExpires) return false;
      return Date.now() >= session.accessExpires - 15000;
    },
    refreshSession: async function (session) {
      logs.refresh += 1;
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
      const expiresAt = opts.pairExpiresAt != null ? opts.pairExpiresAt : (Date.now() + 5 * 60 * 1000);
      return {
        fingerprint: 'abcdabcd99999999', status: 'pending', expiresAt: expiresAt,
        session: {
          pairingId: 'pair-1', fingerprint: 'abcdabcd99999999',
          pendingPairing: 1, pendingPairingExpiresAt: expiresAt
        }
      };
    },
    claimPairing: async function (session) {
      logs.claim += 1;
      if (opts.claimError) {
        const err = new Error(opts.claimError);
        err.data = { error: opts.claimError };
        throw err;
      }
      session.accessToken = opts.accessToken || 'join-access';
      session.refreshToken = 'join-refresh';
      session.accessExpires = Date.now() + 5 * 60 * 1000;
      session.spaceId = 'space';
      session.deviceId = 'member-dev';
      session.role = 'member';
      delete session.pendingPairing;
      return session;
    },
    pull: async function (session) {
      logs.pull += 1;
      if (opts.pullFails) {
        const err = new Error('network');
        err.data = { error: 'network' };
        throw err;
      }
      return JSON.parse(JSON.stringify(remote));
    },
    pushEvents: async function (session, events) {
      return pushImpl(session, events);
    },
    mintPairing: async function () { return { payload: 'TEST-PAYLOAD-NOT-A-REAL-CODE' }; },
    pendingPairings: async function () { return { pending: [] }; },
    resumePendingPairing: async function () {
      logs.pendingResume += 1;
      if (!opts.pendingResume) return null;
      return opts.pendingResume;
    },
    clearPendingPairing: async function () { logs.clearPending += 1; }
  };

  const document = {
    body: body,
    visibilityState: 'visible',
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
  ids['sync-join'].blur = function () { if (opts.allowBlur) active = body; };
  ids['sync-recover'].blur = ids['sync-join'].blur;
  ids['sync-code'].blur = ids['sync-join'].blur;
  ids['sync-secret'].blur = ids['sync-join'].blur;

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
  ctx.__dogverbApplyRemote = function (next) {
    if (forceDefer) { return { deferred: true }; }
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
    ctx: ctx, ids: ids, document: document, localStorage: localStorage, logs: logs,
    backend: backend, intervals: intervals, timeouts: timeouts,
    get state() { return S; },
    flushTimeouts: flushTimeouts,
    status: function () { return ctx.DogverbAppSync.status(); },
    diag: function () { return ctx.DogverbAppSync.diag(); },
    projectDiag: function () { return ctx.DogverbAppSync.projectDiag(); },
    timerInfo: function () { return ctx.DogverbAppSync.timerInfo(); }
  };
}

function emptyRemote() {
  return { v: 2, settings: {}, books: {}, customBooks: [], days: {}, studyDays: [], fox: {} };
}


function hostSeedFour() {
  const books = { [BOOK]: { cards: {}, sentences: [], extra: [], today: [] } };
  const days = {};
  const studyDays = [];
  ['analyse', 'approach', 'area', 'assess'].forEach(function (word, i) {
    books[BOOK].cards[word] = card(2000 + i, 1);
  });
  ['2026-11-20', '2026-11-22', '2026-11-24'].forEach(function (day) {
    days[day] = { day: day, zone: 'device-local', new: 1, review: 0, correct: 1, wrong: 0 };
    studyDays.push({ day: day, zone: 'device-local', source: 'test' });
  });
  return {
    v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK, settingsRev: 1 },
    settingsRev: 1, books: books, customBooks: [], days: days, studyDays: studyDays,
    fox: { food: 4, xp: 4, fed: 0, name: 'SeedA' }
  };
}
function joinerSeedTwo() {
  return {
    v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
    books: { [BOOK]: { cards: { economy: card(10, 1), environment: card(11, 1) }, sentences: [], extra: [], today: [] } },
    customBooks: [],
    days: {
      '2026-11-18': { new: 1, review: 0, correct: 1, wrong: 0 },
      '2026-11-19': { new: 1, review: 0, correct: 1, wrong: 0 }
    },
    studyDays: ['2026-11-18', '2026-11-19'],
    fox: { food: 2, xp: 2, fed: 0, name: 'SeedB' }
  };
}
function applyCommitOpsToRemote(remote, events) {
  const next = JSON.parse(JSON.stringify(remote));
  (events || []).forEach(function (ev) {
    (ev.ops || []).forEach(function (op) {
      if (op.kind === 'card') {
        if (!next.books[op.bookId]) next.books[op.bookId] = { cards: {}, sentences: [], extra: [], today: [] };
        next.books[op.bookId].cards[op.word] = op.card;
      } else if (op.kind === 'study') {
        const has = (next.studyDays || []).some(function (d) { return d && d.day === op.day && d.zone === (op.zone || 'device-local'); });
        if (!has) next.studyDays.push({ day: op.day, zone: op.zone || 'device-local', source: 'event' });
      } else if (op.kind === 'day') {
        const day = op.day;
        let key = null;
        Object.keys(next.days || {}).forEach(function (k) {
          const row = next.days[k];
          if (row && row.day === day && row.zone === (op.zone || 'device-local')) key = k;
        });
        if (!key) key = day;
        const row = next.days[key] || { day: day, zone: op.zone || 'device-local', new: 0, review: 0, correct: 0, wrong: 0 };
        const delta = op.delta || {};
        row.new = (row.new || 0) + (delta.new || 0);
        row.review = (row.review || 0) + (delta.review || 0);
        row.correct = (row.correct || 0) + (delta.correct || 0);
        row.wrong = (row.wrong || 0) + (delta.wrong || 0);
        next.days[key] = row;
      }
    });
  });
  return next;
}

(async function main() {
  // P0-1: genuine empty cloud vs local progress — no 已连接, no syncBase write, machine-readable error.
  const empty = boot({ syncOn: true, focus: 'body', remote: { state: emptyRemote() } });
  const beforeEmpty = empty.localStorage.getItem(BASE);
  const appliedEmpty = empty.ctx.DogverbAppSync.finishRemoteApply({ state: emptyRemote() }, '已连接');
  assert.strictEqual(appliedEmpty.projectNull, true);
  assert.strictEqual(appliedEmpty.result, 'null-empty');
  assert.strictEqual(empty.status().statusText, NULL_STATUS);
  assert.notStrictEqual(empty.status().statusText, '已连接');
  assert.strictEqual(empty.status().errorText, 'project-null: cards=0 days=0 studyDays=0');
  assert.strictEqual(empty.localStorage.getItem(BASE), beforeEmpty, 'must not write syncBase when project returns null');
  assert.strictEqual(empty.projectDiag().result, 'null-empty');
  assert.strictEqual(empty.projectDiag().remoteEmpty, true);
  assert.strictEqual(empty.projectDiag().localEmpty, false);
  assert.strictEqual(cardCount(empty.state), 2, 'local progress is left untouched');

  // P0-1: unreadable shape errors as null-shape, not a successful connect.
  const shaped = boot({ syncOn: true, focus: 'body' });
  const badRemote = { books: [{ cards: [{ word: 'alpha' }] }], days: ['2026-11-03'], studyDays: { day: '2026-11-03' } };
  const appliedShape = shaped.ctx.DogverbAppSync.finishRemoteApply({ state: badRemote }, '已连接');
  assert.strictEqual(appliedShape.result, 'null-shape');
  assert.strictEqual(shaped.projectDiag().result, 'null-shape');
  assert.strictEqual(shaped.status().statusText, NULL_STATUS);
  assert.ok(/^project-null: cards=/.test(shaped.status().errorText));
  assert.strictEqual(shaped.localStorage.getItem(BASE), null);
  assert.strictEqual(cardCount(shaped.state), 2);

  // P0-1: readable cloud payload still merges and may show 已连接.
  const merged = boot({ syncOn: true, focus: 'body' });
  const appliedOk = merged.ctx.DogverbAppSync.finishRemoteApply({ state: remoteState() }, '已连接');
  assert.strictEqual(appliedOk.applied, true);
  assert.strictEqual(merged.projectDiag().result, 'merged');
  assert.strictEqual(merged.status().statusText, '已连接');
  assert.strictEqual(cardCount(merged.state), 14);
  assert.strictEqual(cardCount(JSON.parse(merged.localStorage.getItem(BASE))), 14);
  assert.strictEqual(merged.projectDiag().remoteCards, 14);
  assert.ok(merged.projectDiag().remoteDaysRows >= 1);
  assert.ok(merged.projectDiag().remoteStudyDays >= 1);

  // P0-2: pull flushes first; a leftover outbox is not a silent return.
  const flushCalls = [];
  const blocked = boot({
    syncOn: true, focus: 'body',
    outbox: [{ id: 'commit-1', type: 'commit', ops: [{ kind: 'fox', food: 1 }] }],
    pushEvents: async function (session, events) {
      flushCalls.push(events.map(function (e) { return e.id; }));
      return { results: events.map(function (ev) { return { id: ev.id, reason: 'no-food' }; }) };
    }
  });
  const pullRes = await blocked.ctx.DogverbAppSync.pull();
  assert.ok(flushCalls.length >= 1, 'pull must flush before inspecting the outbox');
  assert.strictEqual(pullRes.blocked, true);
  assert.strictEqual(blocked.status().statusText, '本机有 1 条待上传，暂不拉取');
  assert.strictEqual(blocked.logs.pull, 0, 'must not pull while the main outbox still has events');
  assert.ok(blocked.diag().pullBlockedByOutbox >= 1);
  assert.strictEqual(JSON.parse(blocked.localStorage.getItem(OUT)).length, 1, 'failed event stays in the outbox');

  // P0-3: flush keeps failures, clears successes and duplicates, and uses the new copy.
  const mixed = boot({
    syncOn: true, focus: 'body',
    outbox: [
      { id: 'ok-1', type: 'commit', ops: [{ kind: 'fox', food: 1 }] },
      { id: 'dup-1', type: 'commit', ops: [{ kind: 'fox', food: 1 }] },
      { id: 'bad-1', type: 'commit', ops: [{ kind: 'fox', food: 1 }] }
    ],
    pushEvents: async function (session, events) {
      return {
        results: [
          { id: 'ok-1', consumed: true, reason: null },
          { id: 'dup-1', consumed: false, reason: 'duplicate' },
          { id: 'bad-1', consumed: false, reason: 'no-food' }
        ]
      };
    }
  });
  await mixed.ctx.DogverbAppSync.flush();
  const left = JSON.parse(mixed.localStorage.getItem(OUT) || '[]');
  assert.deepStrictEqual(left.map(function (e) { return e.id; }), ['bad-1']);
  assert.strictEqual(left[0].retries, 1);
  assert.strictEqual(mixed.status().statusText, '有 1 条没写上：no-food');

  // P0-2: the same event failing 3 times is dead-lettered and can be retried.
  const stuck = boot({
    syncOn: true, focus: 'body',
    outbox: [{ id: 'bad-2', type: 'commit', ops: [{ kind: 'fox', food: 1 }] }],
    pushEvents: async function (session, events) {
      return { results: events.map(function (ev) { return { id: ev.id, reason: 'no-food' }; }) };
    }
  });
  await stuck.ctx.DogverbAppSync.flush();
  await stuck.ctx.DogverbAppSync.flush();
  assert.strictEqual(JSON.parse(stuck.localStorage.getItem(OUT) || '[]').length, 1);
  await stuck.ctx.DogverbAppSync.flush();
  assert.deepStrictEqual(JSON.parse(stuck.localStorage.getItem(OUT) || '[]'), []);
  const dead = JSON.parse(stuck.localStorage.getItem(DEAD) || '[]');
  assert.strictEqual(dead.length, 1);
  assert.strictEqual(dead[0].id, 'bad-2');
  assert.strictEqual(dead[0].dead, true);
  assert.strictEqual(dead[0].retries, 3);
  assert.ok(stuck.ids.syncstatus.textContent.indexOf('有 1 条没传上去（点此重试）') !== -1);
  assert.strictEqual(typeof stuck.ids.syncstatus.onclick, 'function');

  let retried = 0;
  stuck.backend.pushEvents = async function (session, events) {
    retried += 1;
    return { results: events.map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
  };
  await stuck.ctx.DogverbAppSync.retryDead();
  assert.ok(retried >= 1, 'click/retry re-queues dead items and flushes');
  assert.deepStrictEqual(JSON.parse(stuck.localStorage.getItem(DEAD) || '[]'), []);
  assert.deepStrictEqual(JSON.parse(stuck.localStorage.getItem(OUT) || '[]'), []);
  assert.ok(stuck.logs.pull >= 1, 'after a successful retry, pull can proceed');

  // Follow-up: empty results with a non-empty outbox are treated as success, not dead-lettered.
  const emptyResults = boot({
    syncOn: true, focus: 'body',
    outbox: [
      { id: 'gone-1', type: 'commit', ops: [{ kind: 'fox', food: 1 }] },
      { id: 'gone-2', type: 'commit', ops: [{ kind: 'fox', food: 1 }] }
    ],
    pushEvents: async function () { return { results: [] }; }
  });
  await emptyResults.ctx.DogverbAppSync.flush();
  assert.deepStrictEqual(JSON.parse(emptyResults.localStorage.getItem(OUT) || '[]'), []);
  assert.deepStrictEqual(JSON.parse(emptyResults.localStorage.getItem(DEAD) || '[]'), []);
  assert.strictEqual(emptyResults.status().statusText, '已同步');
  assert.ok(emptyResults.ids.syncstatus.textContent.indexOf('有 ') === -1 || emptyResults.ids.syncstatus.textContent.indexOf('条没传上去') === -1);
  assert.ok(emptyResults.ids.syncstatus.textContent.indexOf('有 2 条没传上去') === -1);
  assert.ok(emptyResults.ids.syncstatus.textContent.indexOf('有 1 条没传上去') === -1);

  // Follow-up: a returned duplicate is cleared.
  const dupOnly = boot({
    syncOn: true, focus: 'body',
    outbox: [{ id: 'x', type: 'commit', ops: [{ kind: 'fox', food: 1 }] }],
    pushEvents: async function () { return { results: [{ id: 'x', reason: 'duplicate' }] }; }
  });
  await dupOnly.ctx.DogverbAppSync.flush();
  assert.deepStrictEqual(JSON.parse(dupOnly.localStorage.getItem(OUT) || '[]'), []);
  assert.deepStrictEqual(JSON.parse(dupOnly.localStorage.getItem(DEAD) || '[]'), []);
  assert.strictEqual(dupOnly.status().statusText, '已同步');

  // Follow-up: overlapping flushes and mid-study saves must not drop outbox events.
  let releaseFlush;
  const gate = new Promise(function (resolve) { releaseFlush = resolve; });
  let enteredFirstPush = false;
  const pushedBatches = [];
  const overlap = boot({
    syncOn: true, focus: 'body',
    pushEvents: async function (session, events) {
      pushedBatches.push((events || []).map(function (e) { return e.id; }));
      if (!enteredFirstPush) {
        enteredFirstPush = true;
        await gate;
      }
      return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
    }
  });
  overlap.localStorage.setItem(BASE, JSON.stringify(localState()));
  const save1 = localState(); save1.fox = Object.assign({}, save1.fox, { food: 10 });
  overlap.ctx.__dogverbAfterSave(save1);
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.ok(enteredFirstPush, 'first flush reached pushEvents and is held open');
  const save2 = localState(); save2.fox = Object.assign({}, save2.fox, { food: 11 });
  overlap.ctx.__dogverbAfterSave(save2);
  const save3 = localState(); save3.fox = Object.assign({}, save3.fox, { food: 12 });
  overlap.ctx.__dogverbAfterSave(save3);
  const overlapping = overlap.ctx.DogverbAppSync.flush();
  const midIds = JSON.parse(overlap.localStorage.getItem(OUT) || '[]').map(function (e) { return e.id; });
  assert.ok(midIds.length >= 2, 'later saves appended while the first flush was in flight: ' + midIds.join(','));
  releaseFlush();
  await overlapping;
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  const leftoverOverlap = JSON.parse(overlap.localStorage.getItem(OUT) || '[]');
  const allPushed = {};
  pushedBatches.forEach(function (batch) {
    batch.forEach(function (id) { allPushed[id] = 1; });
  });
  leftoverOverlap.forEach(function (item) { if (item && item.id) allPushed[item.id] = 1; });
  midIds.concat(['commit-1']).forEach(function (id) {
    assert.ok(allPushed[id], 'outbox event ' + id + ' must not be dropped by overlapping flushes');
  });
  assert.deepStrictEqual(leftoverOverlap, [], 'after serialized follow-up flushes, successfully pushed events are cleared');
  const uniquePushed = Object.keys(allPushed);
  assert.ok(uniquePushed.length >= 3, 'all mid-study commits were pushed: ' + uniquePushed.join(','));

  // Follow-up: claim success + pull throw is not 「配对没有成功」, and arm() still starts.
  const claimedPullFail = boot({ focus: 'join', pullFails: true });
  const joinField = claimedPullFail.ids['sync-join'].value;
  await claimedPullFail.ctx.DogverbAppSync.join();
  await claimedPullFail.flushTimeouts();
  assert.strictEqual(claimedPullFail.logs.claim, 1);
  assert.strictEqual(claimedPullFail.localStorage.getItem(ON), '1');
  assert.strictEqual(claimedPullFail.status().statusText, '已连上，但这次拉取失败：暂时连不上同步');
  assert.notStrictEqual(claimedPullFail.status().errorText, '配对没有成功');
  assert.strictEqual(claimedPullFail.timerInfo().armed, true);
  assert.strictEqual(claimedPullFail.ids['sync-join'].value, joinField, 'must not rerender the settings form');

  // Follow-up: successful apply refreshes 已学 / 自建词书 / 打卡 only.
  const preview = boot({ syncOn: true, focus: 'body' });
  preview.ids['sync-preview'].textContent = '将上传本机进度：已学 2，自建词书 0，打卡 2。请确认后再上传。';
  preview.ids['sync-join'].value = 'TEST-PAYLOAD-NOT-A-REAL-CODE';
  preview.ctx.DogverbAppSync.finishRemoteApply({ state: emptyRemote() }, '已连接');
  assert.ok(preview.ids['sync-preview'].textContent.indexOf('将上传本机进度') === 0, 'paint must not wipe the enable confirmation copy');
  preview.ctx.DogverbAppSync.finishRemoteApply({ state: remoteState() }, '已连接');
  assert.strictEqual(preview.ids['sync-preview'].textContent, '已学 14，自建词书 0，打卡 9');
  assert.strictEqual(preview.ids['sync-join'].value, 'TEST-PAYLOAD-NOT-A-REAL-CODE', 'successful apply must not rebuild the settings page');

  // Follow-up: project() records zone skips and does not invent a timezone.
  const zoned = boot({ syncOn: true, focus: 'body' });
  const zonedRemote = remoteState();
  zonedRemote.days['Asia/Shanghai|2026-11-20'] = { day: '2026-11-20', zone: 'Asia/Shanghai', new: 3, review: 0, correct: 1, wrong: 0 };
  zonedRemote.studyDays.push({ day: '2026-11-20', zone: 'Asia/Shanghai', source: 'test' });
  zonedRemote.studyDays.push({ day: '2026-11-21', zone: 'Europe/Paris', source: 'test' });
  const zonedApply = zoned.ctx.DogverbAppSync.finishRemoteApply({ state: zonedRemote }, '已连接');
  assert.strictEqual(zonedApply.applied, true);
  assert.strictEqual(zoned.projectDiag().daysSkippedByZone, 1);
  assert.strictEqual(zoned.projectDiag().studyDaysSkippedByZone, 2);
  assert.strictEqual((zoned.state.days || {})['2026-11-20'], undefined, 'non-device-local days stay unmerged; no timezone guessed');
  assert.ok((zoned.state.studyDays || []).indexOf('2026-11-20') === -1);
  assert.ok((zoned.state.studyDays || []).indexOf('2026-11-21') === -1);

  // Join-side push-back: after apply merges remote 4/3 with local 2/2 into 6/5,
  // the joiner must enqueue and flush the local-only extras so a later host pull can see 6/5.
  const pushedJoin = [];
  const joiner = boot({
    syncOn: true, focus: 'body',
    state: joinerSeedTwo(),
    remote: { state: hostSeedFour() },
    pushEvents: async function (session, events) {
      pushedJoin.push(JSON.parse(JSON.stringify(events || [])));
      return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
    }
  });
  assert.strictEqual(cardCount(joiner.state), 2);
  assert.strictEqual((joiner.state.studyDays || []).length, 2);
  const joinApply = joiner.ctx.DogverbAppSync.finishRemoteApply({ state: hostSeedFour() }, '已连接');
  assert.strictEqual(joinApply.applied, true);
  assert.strictEqual(cardCount(joiner.state), 6);
  assert.strictEqual((joiner.state.studyDays || []).length, 5);
  assert.ok((joiner.state.studyDays || []).indexOf('2026-11-18') !== -1);
  assert.ok((joiner.state.studyDays || []).indexOf('2026-11-24') !== -1);
  assert.ok(joiner.state.books[BOOK].cards.economy);
  assert.ok(joiner.state.books[BOOK].cards.analyse);
  assert.strictEqual(joiner.status().statusText, '已连接');
  assert.strictEqual(joiner.projectDiag().result, 'merged');
  assert.strictEqual(joiner.projectDiag().remoteCards, 4, 'diag must stay on the real merge, not the blank cloud snapshot');
  const queued = JSON.parse(joiner.localStorage.getItem(OUT) || '[]');
  assert.ok(queued.length >= 1, 'post-merge local extras must be enqueued');
  const ops = [];
  queued.forEach(function (ev) { (ev.ops || []).forEach(function (op) { ops.push(op); }); });
  const cardWords = ops.filter(function (op) { return op.kind === 'card'; }).map(function (op) { return op.word; }).sort();
  assert.deepStrictEqual(cardWords, ['economy', 'environment']);
  const studyDaysPushed = ops.filter(function (op) { return op.kind === 'study'; }).map(function (op) { return op.day; }).sort();
  assert.deepStrictEqual(studyDaysPushed, ['2026-11-18', '2026-11-19']);
  const dayOrFoxPushed = ops.filter(function (op) { return op.kind === 'day' || op.kind === 'fox'; });
  assert.deepStrictEqual(dayOrFoxPushed, [], 'gap-fill must not reverse-engineer additive day/fox ops from a snapshot');
  assert.ok(ops.every(function (op) {
    return op.kind !== 'card' || (op.word !== 'analyse' && op.word !== 'approach' && op.word !== 'area' && op.word !== 'assess');
  }), 'must not push the host/cloud cards back as new events');
  await joiner.ctx.DogverbAppSync.flush();
  assert.ok(pushedJoin.length >= 1);
  assert.deepStrictEqual(JSON.parse(joiner.localStorage.getItem(OUT) || '[]'), []);
  assert.strictEqual(joiner.status().statusText, '已连接', 'successful post-merge flush must not replace 已连接');

  const cloudAfter = applyCommitOpsToRemote(hostSeedFour(), pushedJoin.reduce(function (all, batch) { return all.concat(batch); }, []));
  assert.strictEqual(cardCount(cloudAfter), 6);
  assert.strictEqual((cloudAfter.studyDays || []).length, 5);

  const host = boot({
    syncOn: true, focus: 'body',
    state: (function () {
      const s = hostSeedFour();
      s.studyDays = ['2026-11-20', '2026-11-22', '2026-11-24'];
      s.days = {
        '2026-11-20': { new: 1, review: 0, correct: 1, wrong: 0 },
        '2026-11-22': { new: 1, review: 0, correct: 1, wrong: 0 },
        '2026-11-24': { new: 1, review: 0, correct: 1, wrong: 0 }
      };
      return s;
    })(),
    remote: { state: cloudAfter }
  });
  const hostApply = host.ctx.DogverbAppSync.finishRemoteApply({ state: cloudAfter }, '已连接');
  assert.strictEqual(hostApply.applied, true);
  assert.strictEqual(cardCount(host.state), 6, 'host pull of the updated cloud project sees the union');
  assert.strictEqual((host.state.studyDays || []).length, 5);
  assert.ok(host.state.books[BOOK].cards.economy && host.state.books[BOOK].cards.analyse);
  const hostOps = [];
  JSON.parse(host.localStorage.getItem(OUT) || '[]').forEach(function (ev) {
    (ev.ops || []).forEach(function (op) { hostOps.push(op); });
  });
  const hostNewCards = hostOps.filter(function (op) { return op.kind === 'card'; });
  assert.strictEqual(hostNewCards.length, 0, 'host already represented in the cloud must not re-push the union');

  // Same path through join() (claim + pull + apply), not only finishRemoteApply.
  const pushedViaJoin = [];
  const viaJoin = boot({
    focus: 'join',
    state: joinerSeedTwo(),
    remote: { state: hostSeedFour() },
    pushEvents: async function (session, events) {
      pushedViaJoin.push(JSON.parse(JSON.stringify(events || [])));
      return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
    }
  });
  await viaJoin.ctx.DogverbAppSync.join();
  await viaJoin.flushTimeouts();
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  await viaJoin.ctx.DogverbAppSync.flush();
  assert.strictEqual(cardCount(viaJoin.state), 6);
  assert.strictEqual((viaJoin.state.studyDays || []).length, 5);
  assert.strictEqual(viaJoin.status().statusText, '已连接');
  const viaOps = [];
  pushedViaJoin.forEach(function (batch) {
    batch.forEach(function (ev) { (ev.ops || []).forEach(function (op) { viaOps.push(op); }); });
  });
  assert.deepStrictEqual(viaOps.filter(function (op) { return op.kind === 'card'; }).map(function (op) { return op.word; }).sort(), ['economy', 'environment']);

  // Follow-up: project-null must not count toward failStreak backoff.
  // Follow-up: project-null must not count toward failStreak backoff.
  const noBackoff = boot({ syncOn: true, focus: 'body', pullFails: true });
  for (let i = 0; i < 4; i++) await noBackoff.ctx.DogverbAppSync.pull();
  assert.strictEqual(noBackoff.timerInfo().failStreak, 4);
  for (let i = 0; i < 5; i++) {
    noBackoff.ctx.DogverbAppSync.finishRemoteApply({ state: emptyRemote() }, '已连接');
  }
  assert.strictEqual(noBackoff.status().statusText, NULL_STATUS);
  assert.strictEqual(noBackoff.timerInfo().failStreak, 4, 'project-null is not a transport failure');
  noBackoff.ctx.DogverbAppSync.arm();
  assert.strictEqual(noBackoff.timerInfo().intervalMs, 5000);

  // P0-4 client wait() loop: a deadline in the past shows the expiry copy and stops polling.
  const expired = boot({ focus: 'join', pairExpiresAt: Date.now() - 1000, claimError: 'pair-not-confirmed' });
  await expired.ctx.DogverbAppSync.join();
  await expired.flushTimeouts();
  assert.strictEqual(expired.status().errorText, '配对已过期，请重新生成配对码');
  assert.strictEqual(expired.logs.claim, 0, 'expired wait must not keep claiming');
  const leftover = expired.timeouts.length;
  await expired.flushTimeouts();
  assert.strictEqual(expired.timeouts.length, leftover, 'expiry must not schedule another 700ms poll');
  assert.ok(expired.logs.clearPending >= 1);

  // P0-4: startup resume of an unclaimed pairing shows the continue copy.
  const resumeAt = Date.now() + 45 * 1000;
  const resumed = boot({
    focus: 'body',
    pendingResume: {
      session: { pairingId: 'pair-resume', fingerprint: 'abcdabcd99999999', pendingPairing: 1, pendingPairingExpiresAt: resumeAt },
      expiresAt: resumeAt
    }
  });
  resumed.ctx.DogverbAppSync.boot();
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.ok(resumed.logs.pendingResume >= 1);
  assert.ok(/^上次配对未完成，正在继续（还剩 \d+ 秒）$/.test(resumed.status().statusText), resumed.status().statusText);
  assert.ok(resumed.timeouts.length >= 1, 'resume continues wait() polling');

  // P0-5: arm starts from boot/save without mount; second arm does not stack intervals.
  const home = boot({ syncOn: true, focus: 'body' });
  assert.strictEqual(home.timerInfo().armed, false);
  home.ctx.__dogverbAfterSave(home.state);
  assert.strictEqual(home.timerInfo().armed, true);
  assert.strictEqual(home.intervals.length, 1);
  assert.strictEqual(home.timerInfo().intervalMs, 5000);
  home.ctx.DogverbAppSync.arm();
  home.ctx.DogverbAppSync.boot();
  assert.strictEqual(home.intervals.length, 1, 'arm is idempotent and must not stack intervals');

  // P0-5: becoming visible triggers an immediate pull.
  const pullsBefore = home.logs.pull;
  home.document.visibilityState = 'visible';
  home.document.dispatch('visibilitychange');
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.ok(home.logs.pull > pullsBefore, 'visibilitychange to visible must pull');

  // P0-5: 5 consecutive failures back off to 30s; a success returns to 5s.
  const slow = boot({ syncOn: true, focus: 'body', pullFails: true });
  for (let i = 0; i < 5; i++) await slow.ctx.DogverbAppSync.pull();
  slow.ctx.DogverbAppSync.arm();
  assert.strictEqual(slow.timerInfo().failStreak, 5);
  assert.strictEqual(slow.timerInfo().intervalMs, 30000);
  slow.backend.pull = async function () {
    slow.logs.pull += 1;
    return { state: remoteState() };
  };
  // replace the failing flag by swapping pull; next pull should succeed
  const after = await slow.ctx.DogverbAppSync.pull();
  assert.ok(after && after.applied);
  assert.strictEqual(slow.timerInfo().failStreak, 0);
  assert.strictEqual(slow.timerInfo().intervalMs, 5000);

  // P0-5: mount still pulls immediately (and still arms).
  const mounted = boot({ syncOn: true, focus: 'body' });
  mounted.ctx.DogverbAppSync.mount();
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.ok(mounted.logs.pull >= 1, 'mount keeps its immediate pull');
  assert.strictEqual(cardCount(mounted.state), 14);
  assert.strictEqual(mounted.status().statusText, '已连接');
  assert.strictEqual(mounted.timerInfo().armed, true);

  // Independent unit test 1: local card with a later last_review is kept.
  function testLocalLaterLastReviewIsKept() {
    const later = boot({
      syncOn: true, focus: 'body',
      state: {
        v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
        books: { [BOOK]: { cards: { keepme: { due: 2, stability: 99, difficulty: 5, reps: 2, lapses: 0, state: 2, last_review: '2026-11-28T12:00:00.000Z', learnedAt: 1, mastered: false, masteredAt: null } }, sentences: [], extra: [], today: [] } },
        customBooks: [], days: {}, studyDays: [], fox: { food: 0, xp: 0, fed: 0, name: 'SeedB' }
      },
      remote: { state: {
        v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
        books: { [BOOK]: { cards: { keepme: { due: 3, stability: 1, difficulty: 5, reps: 9, lapses: 0, state: 2, last_review: '2026-11-27T12:00:00.000Z', learnedAt: 1, mastered: false, masteredAt: null } }, sentences: [], extra: [], today: [] } },
        customBooks: [], days: {}, studyDays: [], fox: { food: 0, xp: 0, fed: 0, name: 'SeedA' }
      } }
    });
    const ret = later.ctx.DogverbAppSync.finishRemoteApply({ state: {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
      books: { [BOOK]: { cards: { keepme: { due: 3, stability: 1, difficulty: 5, reps: 9, lapses: 0, state: 2, last_review: '2026-11-27T12:00:00.000Z', learnedAt: 1, mastered: false, masteredAt: null } }, sentences: [], extra: [], today: [] } },
      customBooks: [], days: {}, studyDays: [], fox: { food: 0, xp: 0, fed: 0, name: 'SeedA' }
    } }, '已连接');
    assert.strictEqual(ret.applied, true);
    const kept = later.state.books[BOOK].cards.keepme;
    assert.strictEqual(kept.stability, 99, 'local card with a later last_review must be kept');
    assert.strictEqual(kept.last_review, '2026-11-28T12:00:00.000Z');
    assert.strictEqual(kept.reps, 2);
  }
  testLocalLaterLastReviewIsKept();

  // Independent unit test 2: pushing the same gap-fill twice must not double days or fox/dog food.
  async function testGapFillTwiceDoesNotDoubleDaysOrFox() {
    const day = '2026-11-20';
    const local = {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
      books: { [BOOK]: { cards: { economy: card(10, 1) }, sentences: [], extra: [], today: [] } },
      customBooks: [],
      days: { [day]: { new: 2, review: 0, correct: 2, wrong: 0 } },
      studyDays: [day],
      fox: { food: 2, xp: 2, fed: 0, name: 'SeedB' }
    };
    const remote = {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK, settingsRev: 1 },
      settingsRev: 1,
      books: { [BOOK]: { cards: { analyse: card(2000, 1) }, sentences: [], extra: [], today: [] } },
      customBooks: [],
      days: { [day]: { day: day, zone: 'device-local', new: 3, review: 0, correct: 3, wrong: 0 } },
      studyDays: [{ day: day, zone: 'device-local', source: 'test' }],
      fox: { food: 4, xp: 4, fed: 0, name: 'SeedA' }
    };
    const env = boot({ syncOn: true, focus: 'body', state: local, remote: { state: remote } });
    const first = env.ctx.DogverbAppSync.finishRemoteApply({ state: remote }, '已连接');
    assert.strictEqual(first.applied, true);
    const daysAfterFirst = env.state.days[day].new;
    const foodAfterFirst = env.state.fox.food;
    assert.strictEqual(daysAfterFirst, 3);
    assert.strictEqual(foodAfterFirst, 4);
    const second = env.ctx.DogverbAppSync.finishRemoteApply({ state: remote }, '已连接');
    assert.strictEqual(second.applied, true);
    assert.strictEqual(env.state.days[day].new, daysAfterFirst, 'second gap-fill/apply must not double day counts');
    assert.strictEqual(env.state.fox.food, foodAfterFirst, 'second gap-fill/apply must not double fox/dog food');
    const queued = JSON.parse(env.localStorage.getItem(OUT) || '[]');
    let dayOps = 0, foxOps = 0;
    queued.forEach(function (ev) {
      (ev.ops || []).forEach(function (op) {
        if (op.kind === 'day') dayOps += 1;
        if (op.kind === 'fox') foxOps += 1;
      });
    });
    assert.strictEqual(dayOps, 0, 'gap-fill must not enqueue snapshot-derived day ops');
    assert.strictEqual(foxOps, 0, 'gap-fill must not enqueue snapshot-derived fox ops');
  }
  await testGapFillTwiceDoesNotDoubleDaysOrFox();

  // Independent unit test 3: same-day learns of 3 and 2 keep the larger side.
  function testSameDayLearnsTakesTheLargerSide() {
    const day = '2026-11-21';
    const local = {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
      books: { [BOOK]: { cards: {}, sentences: [], extra: [], today: [] } },
      customBooks: [], days: { [day]: { new: 2, review: 0, correct: 2, wrong: 0 } },
      studyDays: [day], fox: { food: 2, xp: 0, fed: 0, name: 'SeedB' }
    };
    const remote = {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
      books: { [BOOK]: { cards: {}, sentences: [], extra: [], today: [] } },
      customBooks: [],
      days: { [day]: { day: day, zone: 'device-local', new: 3, review: 0, correct: 3, wrong: 0 } },
      studyDays: [{ day: day, zone: 'device-local', source: 'test' }],
      fox: { food: 3, xp: 0, fed: 0, name: 'SeedA' }
    };
    const env = boot({ syncOn: true, focus: 'body', state: local, remote: { state: remote } });
    const ret = env.ctx.DogverbAppSync.finishRemoteApply({ state: remote }, '已连接');
    assert.strictEqual(ret.applied, true);
    assert.strictEqual(env.state.days[day].new, 3, 'same-day 3 and 2 must keep the larger side');
  }
  testSameDayLearnsTakesTheLargerSide();

  // Independent unit test 4: running the same-day max merge again stays at the larger side, not inflated.
  function testSameDayMergeAgainStaysStableNotEight() {
    const day = '2026-11-21';
    const local = {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
      books: { [BOOK]: { cards: {}, sentences: [], extra: [], today: [] } },
      customBooks: [], days: { [day]: { new: 2, review: 0, correct: 2, wrong: 0 } },
      studyDays: [day], fox: { food: 2, xp: 0, fed: 0, name: 'SeedB' }
    };
    const remote = {
      v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
      books: { [BOOK]: { cards: {}, sentences: [], extra: [], today: [] } },
      customBooks: [],
      days: { [day]: { day: day, zone: 'device-local', new: 3, review: 0, correct: 3, wrong: 0 } },
      studyDays: [{ day: day, zone: 'device-local', source: 'test' }],
      fox: { food: 3, xp: 0, fed: 0, name: 'SeedA' }
    };
    const env = boot({ syncOn: true, focus: 'body', state: local, remote: { state: remote } });
    assert.strictEqual(env.ctx.DogverbAppSync.finishRemoteApply({ state: remote }, '已连接').applied, true);
    assert.strictEqual(env.state.days[day].new, 3);
    assert.strictEqual(env.ctx.DogverbAppSync.finishRemoteApply({ state: remote }, '已连接').applied, true);
    assert.strictEqual(env.state.days[day].new, 3, 'merging again must stay at the larger side, not inflate');
    assert.strictEqual(env.state.fox.food, 3);
  }
  testSameDayMergeAgainStaysStableNotEight();

  // Adapter P0-4: submitPairing persists immediately with pendingPairing=1 and pairingId.
  const store = Object.create(null);
  const storage = {
    get: async function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    set: async function (k, v) { store[k] = v; }
  };
  let nonce = 0;
  const fetchFn = async function (url, opts) {
    const body = JSON.parse(opts.body);
    const json = function (obj, status) {
      return { ok: (status || 200) < 400, status: status || 200, json: async function () { return obj; } };
    };
    if (body.action === 'challenge') return json({ nonce: 'n' + (++nonce) });
    if (body.action === 'submit') {
      return json({ fingerprint: 'f'.repeat(64), status: 'waiting-for-original', pairingId: 'pair-persist', expiresAt: Date.now() + 60 * 1000 });
    }
    if (body.action === 'claim') {
      return json({
        accessToken: 'claimed-access', refreshToken: 'claimed-refresh', accessTtlMs: 300000,
        spaceId: 'space', deviceId: 'dev', role: 'member', fingerprint: 'f'.repeat(64)
      });
    }
    return json({ error: 'unexpected-action' }, 400);
  };
  const api = adapter.bind({ url: PROJECT_URL, anonKey: FAKE_ANON, fetch: fetchFn });
  const submitted = await api.submitPairing({ code: 'FAKECODE', deviceName: 'test device', storage: storage });
  assert.ok(store['supabase-device'], 'submitPairing must persist before claim');
  assert.strictEqual(store['supabase-device'].pendingPairing, 1);
  assert.strictEqual(store['supabase-device'].pairingId, 'pair-persist');
  assert.ok(store['supabase-device'].privateKey, 'device key is persisted immediately');
  assert.ok(!store['supabase-device'].refreshToken, 'unclaimed session has no refresh token yet');
  assert.strictEqual(submitted.session.pendingPairing, 1);
  const pending = await api.resumePendingPairing({ storage: storage });
  assert.ok(pending && pending.session);
  assert.strictEqual(pending.pairingId, 'pair-persist');
  assert.ok(pending.expiresAt > Date.now());

  const claimed = await api.claimPairing(submitted.session);
  assert.ok(claimed.refreshToken);
  assert.ok(!store['supabase-device'].pendingPairing, 'claim persist must drop pendingPairing');
  assert.ok(store['supabase-device'].refreshToken);
  const afterClaim = await api.resumePendingPairing({ storage: storage });
  assert.strictEqual(afterClaim, null);

  // Adapter: clearPendingPairing on expiry must not resume forever on later startups.
  store['supabase-device'] = {
    url: PROJECT_URL, pendingPairing: 1, pairingId: 'pair-old',
    publicJwk: { kty: 'EC' }, fingerprint: 'f'.repeat(64), privateKey: submitted.session.privateKey,
    pendingPairingExpiresAt: Date.now() - 1000
  };
  const stale = await api.resumePendingPairing({ storage: storage });
  assert.ok(stale);
  await api.clearPendingPairing(stale.session);
  const gone = await api.resumePendingPairing({ storage: storage });
  assert.strictEqual(gone, null);

  assert.strictEqual(adapter.PAIR_TTL_MS, 5 * 60 * 1000);

  console.log('ok ' + module.filename);
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
