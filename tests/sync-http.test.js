const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createReferenceServer } = require('../sync-server.js');
const client = require('../sync-client.js');
const prep = require('../sync-prep.js');

function hidden(value, text) { return String(text).indexOf(value) !== -1; }
async function post(url, body, headers) {
  const res = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-dogverb-request': '1' }, headers || {}), body: JSON.stringify(body || {}) });
  const data = await res.json();
  return { status: res.status, data: data, headers: res.headers };
}
function card(last, reps) {
  return { due: last + 86400000, stability: 2, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: reps, lapses: 0, state: 2, last_review: last, learnedAt: last, mastered: false, masteredAt: null };
}
function snap(days, word, last, reps, food) {
  const books = { 'ielts-toefl-core': { cards: {} } };
  books['ielts-toefl-core'].cards[word] = card(last, reps);
  return { v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: books, customBooks: [], days: days, studyDays: Object.keys(days), fox: { food: food, xp: food, fed: 0, hunger: 10, name: '豆豆' } };
}
async function withServer(opts, fn) {
  const logs = [];
  const dbPath = path.join(os.tmpdir(), 'dogverb-ref-' + process.pid + '-' + Math.random().toString(16).slice(2) + '.sqlite');
  const clock = { t: Date.now() };
  const srv = createReferenceServer(Object.assign({ dbPath: dbPath, now: function () { return clock.t; }, log: function (row) { logs.push(row); } }, opts || {}));
  const url = await srv.listen(0);
  try { await fn({ srv: srv, url: url, logs: logs, clock: clock, dbPath: dbPath }); }
  finally { await srv.close(); fs.rmSync(dbPath, { force: true }); }
}

(async function () {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(html.indexOf('sync-server') < 0 && app.indexOf('sync-client.js') < 0);
  assert.ok(html.indexOf('DOGVERB_SYNC_CONFIG') < 0, 'the shipped page does not turn sync on');
  assert.ok(sw.indexOf("const CACHE = 'dog-verb-shell-v28'") >= 0);

  await withServer({}, async function (ctx) {
    const health = await fetch(ctx.url + '/health');
    const body = await health.json();
    assert.strictEqual(body.production, false);
    assert.strictEqual(body.role, 'local-reference');
    assert.strictEqual(health.headers.get('x-dogverb-backend'), 'local-reference');
    assert.strictEqual(health.headers.get('set-cookie'), null);
    const queried = await fetch(ctx.url + '/v1/sync/pull?access=no', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dogverb-request': '1' }, body: '{}' });
    assert.strictEqual(queried.status, 400);
    assert.strictEqual((await queried.json()).error, 'query-forbidden');
    const missing = await fetch(ctx.url + '/v1/sync/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual((await missing.json()).error, 'missing-header');
    const denied = await post(ctx.url + '/v1/sync/pull', {});
    assert.strictEqual(denied.data.error, 'unauthorized');
    const missingSpace = await fetch(ctx.url + '/v1/spaces/not-a-grant');
    assert.strictEqual(missingSpace.status, 404);

    const created = await client.createSpace({ server: ctx.url, deviceName: 'phone', storage: client.memoryStorage() });
    assert.strictEqual(created.session.role, 'original');
    assert.ok(created.recoverySecret.length >= 43);
    assert.strictEqual(hidden(created.recoverySecret, JSON.stringify(ctx.logs)), false);
    assert.strictEqual(hidden(created.recoverySecret, fs.readFileSync(ctx.dbPath)), false);
    assert.strictEqual(await client.privateKeyExportFails(created.session), true);
    const minted = await client.mintPairing(created.session);
    assert.ok(minted.payload.indexOf('http://') !== 0 && minted.payload.indexOf('https://') !== 0);
    assert.strictEqual(hidden(minted.code, fs.readFileSync(ctx.dbPath)), false);
    const early = client.claimPairing;
    let claimEarly = null;
    try { await early({ server: ctx.url, privateKey: created.session.privateKey, fingerprint: created.session.fingerprint, pairingId: minted.pairingId, storage: client.memoryStorage() }); }
    catch (e) { claimEarly = e.data.error; }
    assert.strictEqual(claimEarly, 'pair-unknown');
    const joined = await client.submitPairing({ server: ctx.url, payload: minted.payload, deviceName: 'windows', storage: client.memoryStorage() });
    let tooSoon = null;
    try { await client.claimPairing(joined.session); } catch (e) { tooSoon = e.data.error; }
    assert.strictEqual(tooSoon, 'pair-not-confirmed');
    let wrong = null;
    try { await client.confirmPairing(created.session, minted.pairingId, '0'.repeat(64)); } catch (e) { wrong = e.data.error; }
    assert.strictEqual(wrong, 'pair-fingerprint-mismatch');
    await client.confirmPairing(created.session, minted.pairingId, joined.fingerprint);
    let reuse = null;
    try { await client.confirmPairing(created.session, minted.pairingId, joined.fingerprint); } catch (e) { reuse = e.data.error; }
    assert.strictEqual(reuse, 'pair-consumed');
    await client.claimPairing(joined.session);
    let replay = null;
    try { await client.claimPairing(joined.session); } catch (e) { replay = e.data.error; }
    assert.strictEqual(replay, 'pair-replay');
    let memberMint = null;
    try { await client.mintPairing(joined.session); } catch (e) { memberMint = e.data.error; }
    assert.strictEqual(memberMint, 'not-original');

    const first = snap({ '2026-11-01': { new: 3, review: 2, correct: 4, wrong: 1 } }, 'analyse', 1000, 2, 3);
    const second = snap({ '2026-11-01': { new: 5, review: 2, correct: 1, wrong: 0 } }, 'analyse', 2000, 4, 1);
    second.books['ielts-toefl-core'].cards.approach = card(1500, 1);
    await client.pushLegacy(created.session, first);
    await client.pushLegacy(joined.session, second);
    let empty = null;
    try { await client.pushLegacy(created.session, { v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: {}, customBooks: [], days: {}, studyDays: [], fox: { food: 0, xp: 0, hunger: 80, fed: 0, name: '小狗' } }); }
    catch (e) { empty = e.data.error; }
    assert.strictEqual(empty, 'empty-snapshot');
    const pulled = await client.pull(joined.session);
    assert.strictEqual(pulled.state.days['device-local|2026-11-01'].new, 5);
    assert.strictEqual(pulled.state.days['device-local|2026-11-01'].review, 2);
    assert.strictEqual(pulled.state.books['ielts-toefl-core'].cards.analyse.reps, 4);
    assert.ok(pulled.state.books['ielts-toefl-core'].cards.approach);
    assert.strictEqual(pulled.state.fox.hunger, undefined);
    assert.ok(pulled.state.limitations.indexOf(prep.LEGACY_OVERLAP_LIMIT) >= 0);
    assert.strictEqual(pulled.production, false);

    const event = { id: 'grade-1', type: 'grade', bookId: 'ielts-toefl-core', word: 'analyse', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' };
    const offline = Object.assign({}, created.session, { server: 'http://127.0.0.1:9' });
    const queued = await client.pushEvents(offline, [event]);
    assert.strictEqual(queued.offline, true);
    created.session.storage = offline.storage;
    const flushed = await client.pushEvents(created.session, []);
    assert.ok(flushed.results.some(function (row) { return row.id === 'grade-1' && row.consumed; }));
    const again = await client.pushEvents(created.session, [event]);
    assert.ok(again.results.some(function (row) { return row.id === 'grade-1' && row.noop; }));
    const after = await client.pull(joined.session);
    assert.strictEqual(after.state.days['Asia/Shanghai|2026-11-20'].review, 1);
    assert.strictEqual(after.state.days['device-local|2026-11-01'].new, 5);

    const other = await client.createSpace({ server: ctx.url, deviceName: 'stranger', storage: client.memoryStorage() });
    const otherView = await client.pull(other.session);
    assert.ok(!otherView.state.books['ielts-toefl-core']);
    assert.notStrictEqual(otherView.spaceId, pulled.spaceId);
    const linked = await client.linkAccount(created.session, 'later-account');
    assert.strictEqual(linked.spaceId, created.session.spaceId);
    assert.ok(linked.eventIds.indexOf('grade-1') >= 0);

    await client.revokeDevice(created.session, joined.session.deviceId);
    let revoked = null;
    try { await client.pull(joined.session); } catch (e) { revoked = e.data.error; }
    assert.strictEqual(revoked, 'unauthorized');
    let revived = null;
    try { await client.resume({ server: ctx.url, storage: joined.session.storage }); } catch (e) { revived = e.data.error; }
    assert.strictEqual(revived, 'unauthorized');
    const still = await client.pull(created.session);
    assert.strictEqual(still.state.books['ielts-toefl-core'].cards.analyse.reps, 5);

    const recovered = await client.recover({ server: ctx.url, recoverySecret: created.recoverySecret, deviceName: 'new phone', storage: client.memoryStorage() });
    assert.strictEqual(recovered.session.spaceId, created.session.spaceId);
    assert.strictEqual((await client.pull(recovered.session)).state.eventIds.indexOf('grade-1') >= 0, true);
    ctx.logs.forEach(function (row) { assert.deepStrictEqual(Object.keys(row).sort(), ['method', 'path', 'status']); });
  });

  await withServer({ limits: { submitFailPerIp: 2, confirmFailPerPair: 2, pairTtlMs: 5000, accessTtlMs: 1000 } }, async function (ctx) {
    let limited = 0;
    for (let i = 0; i < 3; i++) {
      try { await client.submitPairing({ server: ctx.url, payload: 'dogverb-pair:v1:none.AAAA-BBBB-CCCC-DDDD', deviceName: 'x', storage: client.memoryStorage() }); }
      catch (e) { if (e.data.error === 'rate-limited') limited++; else assert.strictEqual(e.data.error, 'pair-unknown'); }
    }
    assert.strictEqual(limited, 1);
    let forwarded = null;
    try { await client.submitPairing({ server: ctx.url, payload: 'dogverb-pair:v1:none.AAAA-BBBB-CCCC-DDDD', deviceName: 'spoof', storage: client.memoryStorage() }); }
    catch (e) { forwarded = e.data.error; }
    assert.strictEqual(forwarded, 'rate-limited');

    const clockServer = ctx;
    const owner = await client.createSpace({ server: clockServer.url, deviceName: 'phone', storage: client.memoryStorage() });
    const code = await client.mintPairing(owner.session);
    clockServer.clock.t += 6000;
    let expired = null;
    try { await client.submitPairing({ server: clockServer.url, payload: code.payload, deviceName: 'late', storage: client.memoryStorage() }); }
    catch (e) { expired = e.data.error; }
    assert.strictEqual(expired, 'pair-expired');
  });

  await withServer({ limits: { confirmFailPerPair: 2 } }, async function (ctx) {
    const owner = await client.createSpace({ server: ctx.url, deviceName: 'phone', storage: client.memoryStorage() });
    const code = await client.mintPairing(owner.session);
    const joined = await client.submitPairing({ server: ctx.url, payload: code.payload, deviceName: 'windows', storage: client.memoryStorage() });
    let last = null;
    for (let i = 0; i < 2; i++) {
      try { await client.confirmPairing(owner.session, code.pairingId, 'f'.repeat(64)); } catch (e) { last = e.data.error; }
    }
    assert.strictEqual(last, 'rate-limited');
    let blocked = null;
    try { await client.confirmPairing(owner.session, code.pairingId, joined.fingerprint); } catch (e) { blocked = e.data.error; }
    assert.strictEqual(blocked, 'pair-expired');
  });

  const dbPath = path.join(os.tmpdir(), 'dogverb-restart-' + process.pid + '.sqlite');
  fs.rmSync(dbPath, { force: true });
  const first = createReferenceServer({ dbPath: dbPath, log: function () {} });
  const url = await first.listen(0);
  const owner = await client.createSpace({ server: url, deviceName: 'phone', storage: client.memoryStorage() });
  await client.pushLegacy(owner.session, snap({ '2026-11-03': { new: 1, review: 0, correct: 1, wrong: 0 } }, 'area', 1000, 1, 1));
  const refreshToken = owner.session.refreshToken;
  await first.close();
  const second = createReferenceServer({ dbPath: dbPath, log: function () {} });
  const url2 = await second.listen(0);
  owner.session.server = url2;
  const resumed = await client.resume({ server: url2, storage: owner.session.storage });
  assert.strictEqual(resumed.spaceId, owner.session.spaceId);
  assert.notStrictEqual(resumed.refreshToken, refreshToken);
  let replayed = null;
  try {
    await post(url2 + '/v1/session/refresh', { refreshToken: refreshToken, nonce: 'stale', signature: 'no' });
  } catch (e) { replayed = e; }
  const replay = await post(url2 + '/v1/session/refresh', { refreshToken: refreshToken, nonce: 'stale', signature: 'no' });
  assert.strictEqual(replay.data.error, 'unauthorized');
  const view = await client.pull(resumed);
  assert.strictEqual(view.state.books['ielts-toefl-core'].cards.area.reps, 1);
  await second.close();
  fs.rmSync(dbPath, { force: true });

  await withServer({ origins: ['http://127.0.0.1:9'] }, async function (ctx) {
    const blocked = await post(ctx.url + '/v1/challenge', { purpose: 'create-space' }, { origin: 'https://evil.example' });
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.data.error, 'origin-rejected');
    assert.strictEqual(blocked.headers.get('access-control-allow-origin'), null);
  });

  await withServer({ origins: ['https://putao0130-design.github.io'] }, async function (ctx) {
    const owner = await client.createSpace({ server: ctx.url, deviceName: 'phone', storage: client.memoryStorage() });
    const bare = await post(ctx.url + '/v1/sync/pull', {});
    assert.strictEqual(bare.status, 401, 'an allowed origin without a token is not authenticated');
    const evil = await fetch(ctx.url + '/v1/sync/pull', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dogverb-request': '1', authorization: 'Bearer ' + owner.session.accessToken, origin: 'https://evil.example' }, body: '{}' });
    const evilBody = await evil.json();
    assert.strictEqual(evil.status, 403);
    assert.strictEqual(JSON.stringify(evilBody).indexOf('ielts'), -1);
    const code = await client.mintPairing(owner.session);
    const raw = code.code.replace(/-/g, '');
    assert.strictEqual(raw.length, 16);
    assert.ok(/^[0-9A-HJKMNP-TV-Z]+$/.test(raw));
    await client.pushEvents(owner.session, [{ id: 'commit-security', type: 'commit', ops: [{ kind: 'card', bookId: 'ielts-toefl-core', word: 'benefit', card: card(3000, 2) }, { kind: 'day', zone: 'device-local', day: '2026-11-08', delta: { new: 1, review: 0, correct: 1, wrong: 0 } }] }]);
    const again = await client.pushEvents(owner.session, [{ id: 'commit-security', type: 'commit', ops: [{ kind: 'day', zone: 'device-local', day: '2026-11-08', delta: { new: 1, review: 0, correct: 0, wrong: 0 } }] }]);
    assert.ok(again.results.some(function (row) { return row.id === 'commit-security' && row.noop; }));
    const view = await client.pull(owner.session);
    assert.strictEqual(view.state.days['device-local|2026-11-08'].new, 1);
    assert.strictEqual(view.state.books['ielts-toefl-core'].cards.benefit.reps, 2);
    const reset = await client.pushEvents(owner.session, [{ id: 'commit-reset', type: 'commit', ops: [{ kind: 'reset' }] }]);
    assert.ok(reset.results.some(function (row) { return row.id === 'commit-reset' && row.reason === 'reset-not-synced'; }));
    await client.revokeDevice(owner.session, owner.session.deviceId);
    let originalDead = null;
    try { await client.pull(owner.session); } catch (e) { originalDead = e.data.error; }
    assert.strictEqual(originalDead, 'unauthorized');
    const recovered = await client.recover({ server: ctx.url, recoverySecret: owner.recoverySecret, deviceName: 'restored', storage: client.memoryStorage() });
    assert.strictEqual((await client.pull(recovered.session)).state.books['ielts-toefl-core'].cards.benefit.reps, 2);
    const copy = Object.assign({}, recovered.session, { storage: client.memoryStorage() });
    await copy.storage.set('device', { refreshToken: recovered.session.refreshToken, privateKey: recovered.session.privateKey, publicJwk: recovered.session.publicJwk, fingerprint: recovered.session.fingerprint, server: ctx.url, spaceId: recovered.session.spaceId, deviceId: recovered.session.deviceId });
    ctx.clock.t += 1000 * 60 * 10;
    const raced = await Promise.allSettled([client.pull(recovered.session), client.pull(copy)]);
    assert.strictEqual(raced.filter(function (row) { return row.status === 'fulfilled'; }).length, 1);
    assert.strictEqual(raced.filter(function (row) { return row.status === 'rejected'; }).length, 1);
  });

  await new Promise(function (resolve, reject) {
    const srv = createReferenceServer({ log: function () {} });
    srv.listen(0).then(function (url) {
      const req = http.request(url + '/v1/pair/submit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dogverb-request': '1', 'content-length': String(32 * 1024 * 1024) } });
      const timer = setTimeout(function () { req.destroy(); reject(new Error('oversized header was not rejected before the body')); }, 1000);
      req.on('response', function (res) {
        clearTimeout(timer);
        let body = '';
        res.on('data', function (c) { body += c; });
        res.on('end', function () {
          srv.close().then(function () {
            assert.strictEqual(res.statusCode, 413);
            assert.ok(body.indexOf('too-large') >= 0);
            resolve();
          });
        });
      });
      req.on('error', function () { clearTimeout(timer); resolve(); });
      req.end();
    }).catch(reject);
  });

  console.log('sync-http tests ok');
})().catch(function (err) { console.error(err); process.exit(1); });
