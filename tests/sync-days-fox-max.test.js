// Days/fox merge regressions: failed-push re-pull must not drop a same-day count,
// and merge → learn one more → push → pull must not double-count the increment.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const adapter = require('../supabase/client-adapter.js');

const ROOT = path.join(__dirname, '..');
const KEY = 'foxVocab.v2';
const ON = 'foxVocab.syncOn';
const OUT = 'foxVocab.syncOutbox';
const BOOK = 'ielts-toefl-core';
const DAY = '2026-11-26';
const PROJECT_URL = adapter.PROJECT_URL;
const FAKE_ANON = 'anon-public-test-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function card(last, reps) {
  return { due: last + 86400000, stability: 2, difficulty: 5, reps: reps, lapses: 0, state: 2, last_review: last, learnedAt: last, mastered: false, masteredAt: null };
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
  return {
    tagName: String(tag).toUpperCase(), nodeType: 1, id: id || '', value: '',
    textContent: '', innerHTML: '', className: '', style: {}, parentNode: parent || null,
    onclick: null, addEventListener: function () {}, blur: function () {},
    closest: function () { return null; }
  };
}
function localShape(daysNew, food, cards) {
  return {
    v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
    books: { [BOOK]: { cards: cards || { anchor: card(10, 1) }, sentences: [], extra: [], today: [] } },
    customBooks: [],
    days: { [DAY]: { new: daysNew, review: 0, correct: daysNew, wrong: 0 } },
    studyDays: [DAY],
    fox: { food: food, xp: food, fed: 0, name: 'SeedB' }
  };
}
function remoteShape(daysNew, food, cards) {
  return {
    v: 2, bookId: BOOK, settings: { dailyNew: 20, autoPlay: true, bookId: BOOK },
    settingsRev: 1,
    books: { [BOOK]: { cards: cards || { anchor: card(10, 1) }, sentences: [], extra: [], today: [] } },
    customBooks: [],
    days: { [DAY]: { day: DAY, zone: 'device-local', new: daysNew, review: 0, correct: daysNew, wrong: 0 } },
    studyDays: [{ day: DAY, zone: 'device-local', source: 'test' }],
    fox: { food: food, xp: food, fed: 0, name: 'SeedA' }
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
        let key = null;
        Object.keys(next.days || {}).forEach(function (k) {
          const row = next.days[k];
          if (row && row.day === op.day && row.zone === (op.zone || 'device-local')) key = k;
        });
        if (!key) key = op.day;
        const row = next.days[key] || { day: op.day, zone: op.zone || 'device-local', new: 0, review: 0, correct: 0, wrong: 0 };
        const delta = op.delta || {};
        row.new = (row.new || 0) + (delta.new || 0);
        row.review = (row.review || 0) + (delta.review || 0);
        row.correct = (row.correct || 0) + (delta.correct || 0);
        row.wrong = (row.wrong || 0) + (delta.wrong || 0);
        next.days[key] = row;
      } else if (op.kind === 'fox') {
        next.fox = next.fox || {};
        next.fox.food = (next.fox.food || 0) + (op.food || 0);
        next.fox.xp = (next.fox.xp || 0) + (op.xp || 0);
        next.fox.fed = (next.fox.fed || 0) + (op.fed || 0);
        if (op.name) next.fox.name = op.name;
      }
    });
  });
  return next;
}
function boot(opts) {
  opts = opts || {};
  const prep = require('../sync-prep.js');
  const localStorage = memoryLocalStorage();
  let S = JSON.parse(JSON.stringify(opts.state));
  let remote = opts.remote ? JSON.parse(JSON.stringify(opts.remote)) : { state: remoteShape(2, 2) };
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
  const listeners = {};
  const timeouts = [];
  let tid = 0;
  const pushImpl = opts.pushEvents || async function (session, events) {
    return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
  };
  const backend = {
    accessExpired: function (session) {
      if (!session || !session.accessToken) return true;
      if (!session.accessExpires) return false;
      return Date.now() >= session.accessExpires - 15000;
    },
    refreshSession: async function (session) {
      session.accessToken = 'fresh-access';
      session.refreshToken = 'fresh-refresh';
      session.accessExpires = Date.now() + 5 * 60 * 1000;
      return session;
    },
    resume: async function () {
      return {
        accessToken: 'resumed-access', refreshToken: 'resumed-refresh',
        accessExpires: Date.now() + 5 * 60 * 1000, spaceId: 'space', deviceId: 'dev', role: 'member'
      };
    },
    pull: async function () { return JSON.parse(JSON.stringify(remote)); },
    pushEvents: async function (session, events) { return pushImpl(session, events); },
    mintPairing: async function () { return { payload: 'TEST-PAYLOAD-NOT-A-REAL-CODE' }; },
    pendingPairings: async function () { return { pending: [] }; },
    resumePendingPairing: async function () { return null; },
    clearPendingPairing: async function () {}
  };
  const document = {
    body: body,
    visibilityState: 'visible',
    get activeElement() { return body; },
    getElementById: function (id) { return ids[id] || null; },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  };
  const ctx = {
    console: console,
    Date: Date, JSON: JSON, Object: Object, Array: Array, Number: Number,
    String: String, Math: Math, Error: Error, Boolean: Boolean, Promise: Promise,
    parseInt: parseInt, isFinite: isFinite, NaN: NaN, undefined: undefined,
    setTimeout: function (fn, ms) { const id = ++tid; timeouts.push({ id: id, fn: fn, ms: ms }); return id; },
    clearTimeout: function (id) { for (let i = timeouts.length - 1; i >= 0; i--) if (timeouts[i].id === id) timeouts.splice(i, 1); },
    setInterval: function () { return ++tid; },
    clearInterval: function () {},
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
    S = JSON.parse(JSON.stringify(next));
    localStorage.setItem(KEY, JSON.stringify(S));
    return { applied: true };
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sync-app.js'), 'utf8'), ctx, { filename: 'sync-app.js' });
  return {
    ctx: ctx, localStorage: localStorage, backend: backend,
    get state() { return S; },
    setState: function (next) {
      S = JSON.parse(JSON.stringify(next));
      localStorage.setItem(KEY, JSON.stringify(S));
    },
    get remote() { return remote; },
    setRemote: function (next) { remote = JSON.parse(JSON.stringify(next)); },
    dayNew: function () { return (S.days && S.days[DAY] && S.days[DAY].new) || 0; }
  };
}

async function testMergePushFailsPullDoesNotDropSameDayCount() {
  let cloud = { state: remoteShape(2, 2) };
  const env = boot({
    syncOn: true,
    state: localShape(3, 3),
    remote: cloud,
    pushEvents: async function (session, events) {
      return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: false, reason: 'no-food' }; }) };
    }
  });
  const merged = env.ctx.DogverbAppSync.finishRemoteApply(cloud, '已连接');
  assert.strictEqual(merged.applied, true);
  await env.ctx.DogverbAppSync.flush();
  // Push failed (or there was nothing additive to push); the server is still 2.
  env.setRemote(cloud);
  const pulled = await env.ctx.DogverbAppSync.pull();
  if (pulled && pulled.blocked) {
    const retry = env.ctx.DogverbAppSync.finishRemoteApply(env.remote, '已连接');
    assert.strictEqual(retry.applied, true);
  } else {
    assert.strictEqual(pulled && pulled.applied, true);
  }
  const count = env.dayNew();
  assert.notStrictEqual(count, 2, 'same-day count must not drop back to the stale server value 2');
  assert.notStrictEqual(count, 0, 'same-day count must not drop to 0');
  assert.strictEqual(count, 3, 'same-day local 3 and remote 2 must stay at the larger side after a failed push and re-pull');
}

async function testMergeLearnOneMorePushPullIsSixNotSeven() {
  let cloud = { state: remoteShape(2, 2) };
  const env = boot({
    syncOn: true,
    state: localShape(2, 2),
    remote: cloud,
    pushEvents: async function (session, events) {
      cloud.state = applyCommitOpsToRemote(cloud.state, events);
      env.setRemote(cloud);
      return { results: (events || []).map(function (ev) { return { id: ev.id, consumed: true, reason: null }; }) };
    }
  });
  // A prior apply of the same cloud snapshot writes the 933cf56 baseline (R_prev=2).
  assert.strictEqual(env.ctx.DogverbAppSync.finishRemoteApply(cloud, '已连接').applied, true);
  // Starting side is already 5 (needed so max(5,2)=5, then +1 → 6).
  const alreadyFive = localShape(5, 5);
  env.setState(alreadyFive);
  const merged = env.ctx.DogverbAppSync.finishRemoteApply(cloud, '已连接');
  assert.strictEqual(merged.applied, true);
  const afterMerge = env.dayNew();
  const learned = JSON.parse(JSON.stringify(env.state));
  learned.days[DAY] = { new: afterMerge + 1, review: 0, correct: afterMerge + 1, wrong: 0 };
  learned.fox = { food: (learned.fox.food || 0) + 1, xp: (learned.fox.xp || 0) + 1, fed: 0, name: learned.fox.name };
  learned.books[BOOK].cards.newer = card(20, 1);
  env.setState(learned);
  env.ctx.__dogverbAfterSave(learned);
  await env.ctx.DogverbAppSync.flush();
  const pulled = await env.ctx.DogverbAppSync.pull();
  assert.strictEqual(pulled && pulled.applied, true);
  assert.strictEqual(env.dayNew(), 6, 'after merge, learning 1 more word, push, and pull, the same-day count must be 6, not 7');
}

(async function main() {
  await testMergePushFailsPullDoesNotDropSameDayCount();
  await testMergeLearnOneMorePushPullIsSixNotSeven();
  console.log('ok ' + module.filename);
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
