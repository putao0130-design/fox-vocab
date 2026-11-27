const assert = require('assert');
const fs = require('fs');
const path = require('path');
const wire = require('../sync-wire.js');
const prep = require('../sync-prep.js');
const { handleAction } = require('../supabase/functions/dogverb-sync/actions.js');
const { createMemoryDb } = require('../supabase/memory-db.js');
const { createPgAdapter } = require('../supabase/functions/dogverb-sync/pg-adapter.js');
const adapter = require('../supabase/client-adapter.js');

const ROOT = path.join(__dirname, '..');
const PROJECT_URL = 'https://zkvscutsjspzuteogfet.supabase.co';
const FAKE_ANON = 'anon-public-test-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicJwk = wire.publicJwkOnly(await crypto.subtle.exportKey('jwk', pair.publicKey));
  const fingerprint = await wire.fingerprintJwk(publicJwk);
  return {
    privateKey: pair.privateKey, publicJwk: publicJwk, fingerprint: fingerprint,
    async sign(purpose, nonce, extra) {
      const buf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(wire.signText(purpose, nonce, fingerprint, extra || '')));
      return wire.bytesToB64url(new Uint8Array(buf));
    }
  };
}
async function challenge(db, purpose) { return (await handleAction(db, { action: 'challenge', purpose: purpose })).nonce; }
function card(last, reps) { return { due: last + 86400000, stability: 2, difficulty: 5, reps: reps, lapses: 0, state: 2, last_review: last, learnedAt: last, mastered: false, masteredAt: null }; }
function snap(dayNew, word, last, reps) {
  return { v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: { 'ielts-toefl-core': { cards: { [word]: card(last, reps) } } }, customBooks: [], days: { '2026-11-01': { new: dayNew, review: 1, correct: 1, wrong: 0 } }, studyDays: ['2026-11-01'], fox: { food: dayNew, xp: 1, fed: 0, name: '豆豆' } };
}

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function keyOf(coll, id) { return coll + '\n' + id; }

function commitTx(store, pReads, pWrites) {
  const allowed = { spaces: 1, devices: 1, pairing: 1, sessions: 1, nonces: 1, rate: 1 };
  const keys = Object.keys(Object.assign({}, pReads || {}, pWrites || {})).sort();
  for (let i = 0; i < keys.length; i++) {
    const parts = keys[i].split('\n');
    if (parts.length < 2 || !allowed[parts[0]]) throw new Error('bad-collection');
  }
  const reads = pReads || {};
  Object.keys(reads).forEach(function (k) {
    const parts = k.split('\n');
    const actual = store[keyOf(parts[0], parts.slice(1).join('\n'))] || null;
    const expected = reads[k];
    if (expected == null) {
      if (actual != null) { const err = new Error('conflict'); err.conflict = true; throw err; }
    } else if (actual == null || JSON.stringify(actual) !== JSON.stringify(expected)) {
      const err = new Error('conflict'); err.conflict = true; throw err;
    }
  });
  const writes = pWrites || {};
  Object.keys(writes).forEach(function (k) {
    const w = writes[k];
    const coll = w.coll || k.split('\n')[0];
    const id = w.id || k.split('\n').slice(1).join('\n');
    if (w.op === 'remove') delete store[keyOf(coll, id)];
    else if (w.op === 'put') store[keyOf(coll, id)] = clone(w.doc);
    else throw new Error('bad-op');
  });
  return true;
}

function createMockClient() {
  const store = {};
  function rowsNow() {
    return Object.keys(store).map(function (k) {
      const parts = k.split('\n');
      return { coll: parts[0], id: parts.slice(1).join('\n'), doc: clone(store[k]) };
    });
  }
  return {
    _store: store,
    from(table) {
      assert.strictEqual(table, 'dogverb_kv');
      let rows = rowsNow();
      const api = {
        select() { return api; },
        eq(col, val) {
          if (col === 'coll') rows = rows.filter(function (r) { return r.coll === val; });
          else if (col === 'id') rows = rows.filter(function (r) { return r.id === val; });
          return api;
        },
        maybeSingle() { return Promise.resolve({ data: rows[0] ? { doc: rows[0].doc } : null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows.map(function (r) { return { doc: r.doc }; }), error: null }).then(resolve, reject); }
      };
      return api;
    },
    rpc(name, args) {
      assert.strictEqual(name, 'dogverb_commit_tx');
      try {
        return Promise.resolve({ data: commitTx(store, args.p_reads, args.p_writes), error: null });
      } catch (e) {
        if (e.conflict) return Promise.resolve({ data: false, error: null });
        return Promise.resolve({ data: null, error: { message: e.message } });
      }
    }
  };
}

async function runProtocol(db) {
  const owner = await device();
  const nonce = await challenge(db, 'create-space');
  const recoverySecret = wire.randomToken(32);
  const created = await handleAction(db, { action: 'createSpace', publicKey: owner.publicJwk, fingerprint: owner.fingerprint, nonce: nonce, signature: await owner.sign('create-space', nonce, ''), recoveryHash: await wire.sha256Hex(recoverySecret), deviceName: 'phone' });
  assert.ok(created.spaceId && created.accessToken);
  if (typeof db.dump === 'function') {
    const dumped = JSON.stringify(db.dump());
    assert.strictEqual(dumped.includes(recoverySecret), false);
    assert.strictEqual(dumped.includes(created.accessToken), false);
  }

  const mintNonce = await challenge(db, 'mint-pair');
  const minted = await handleAction(db, { action: 'mint', accessToken: created.accessToken, nonce: mintNonce, signature: await owner.sign('mint-pair', mintNonce, '') });
  if (typeof db.dump === 'function') assert.strictEqual(JSON.stringify(db.dump()).includes(minted.code), false);
  const newbie = await device();
  const submitNonce = await challenge(db, 'submit-pair');
  const submitted = await handleAction(db, { action: 'submit', code: minted.code, payload: minted.payload, publicKey: newbie.publicJwk, fingerprint: newbie.fingerprint, nonce: submitNonce, signature: await newbie.sign('submit-pair', submitNonce, minted.code), deviceName: 'windows' });
  const badNonce = await challenge(db, 'confirm-pair');
  const bad = await handleAction(db, { action: 'confirm', accessToken: created.accessToken, pairingId: minted.pairingId, fingerprint: '0'.repeat(64), nonce: badNonce, signature: await owner.sign('confirm-pair', badNonce, minted.pairingId) });
  assert.strictEqual(bad.error, 'pair-fingerprint-mismatch');
  const yesNonce = await challenge(db, 'confirm-pair');
  const yesSig = await owner.sign('confirm-pair', yesNonce, minted.pairingId);
  const raced = await Promise.all([
    handleAction(db, { action: 'confirm', accessToken: created.accessToken, pairingId: minted.pairingId, fingerprint: submitted.fingerprint, nonce: yesNonce, signature: yesSig }),
    handleAction(db, { action: 'confirm', accessToken: created.accessToken, pairingId: minted.pairingId, fingerprint: submitted.fingerprint, nonce: yesNonce, signature: yesSig })
  ]);
  assert.strictEqual(raced.filter(function (row) { return row.ok; }).length, 1);
  assert.strictEqual(raced.filter(function (row) { return row.error === 'pair-consumed' || row.error === 'nonce-replay'; }).length, 1);
  const claimNonce = await challenge(db, 'claim-pair');
  const claimed = await handleAction(db, { action: 'claim', pairingId: submitted.pairingId, nonce: claimNonce, signature: await newbie.sign('claim-pair', claimNonce, submitted.pairingId) });
  assert.ok(claimed.accessToken);
  const replayNonce = await challenge(db, 'claim-pair');
  const replay = await handleAction(db, { action: 'claim', pairingId: submitted.pairingId, nonce: replayNonce, signature: await newbie.sign('claim-pair', replayNonce, submitted.pairingId) });
  assert.strictEqual(replay.error, 'pair-replay');

  const first = snap(3, 'analyse', 1000, 2);
  const second = snap(5, 'analyse', 2000, 4);
  const pushA = await challenge(db, 'sync');
  await handleAction(db, { action: 'push', accessToken: created.accessToken, nonce: pushA, signature: await owner.sign('sync', pushA, ''), legacy: first });
  const pushB = await challenge(db, 'sync');
  const merged = await handleAction(db, { action: 'push', accessToken: claimed.accessToken, nonce: pushB, signature: await newbie.sign('sync', pushB, ''), legacy: second });
  assert.strictEqual(merged.legacy.limitation, prep.LEGACY_OVERLAP_LIMIT);
  const view = await handleAction(db, { action: 'pull', accessToken: claimed.accessToken });
  assert.strictEqual(view.state.days['device-local|2026-11-01'].new, 5);
  assert.strictEqual(view.state.books['ielts-toefl-core'].cards.analyse.reps, 4);
  const emptyNonce = await challenge(db, 'sync');
  const empty = await handleAction(db, { action: 'push', accessToken: created.accessToken, nonce: emptyNonce, signature: await owner.sign('sync', emptyNonce, ''), legacy: { v: 2, books: {}, customBooks: [], days: {}, studyDays: [], settings: { dailyNew: 20, autoPlay: true }, fox: { name: '小狗', food: 0, xp: 0, fed: 0 } } });
  assert.strictEqual(empty.error, 'empty-snapshot');
  assert.strictEqual((await handleAction(db, { action: 'pull', accessToken: created.accessToken })).state.days['device-local|2026-11-01'].new, 5);
  const commitNonce = await challenge(db, 'sync');
  await handleAction(db, { action: 'push', accessToken: created.accessToken, nonce: commitNonce, signature: await owner.sign('sync', commitNonce, ''), events: [{ id: 'commit-1', type: 'commit', ops: [{ kind: 'day', zone: 'device-local', day: '2026-11-01', delta: { new: 1, review: 0, correct: 0, wrong: 0 } }] }] });
  const commitAgain = await challenge(db, 'sync');
  const dup = await handleAction(db, { action: 'push', accessToken: created.accessToken, nonce: commitAgain, signature: await owner.sign('sync', commitAgain, ''), events: [{ id: 'commit-1', type: 'commit', ops: [{ kind: 'day', zone: 'device-local', day: '2026-11-01', delta: { new: 1, review: 0, correct: 0, wrong: 0 } }] }] });
  assert.ok(dup.results.some(function (row) { return row.id === 'commit-1' && row.noop; }));
  assert.strictEqual((await handleAction(db, { action: 'pull', accessToken: created.accessToken })).state.days['device-local|2026-11-01'].new, 6);

  const revokeNonce = await challenge(db, 'revoke');
  await handleAction(db, { action: 'revoke', accessToken: created.accessToken, deviceId: created.deviceId, nonce: revokeNonce, signature: await owner.sign('revoke', revokeNonce, created.deviceId) });
  assert.strictEqual((await handleAction(db, { action: 'pull', accessToken: created.accessToken })).error, 'unauthorized');
  const recoverNonce = await challenge(db, 'recover');
  const recovered = await handleAction(db, { action: 'recover', publicKey: (await device()).publicJwk, fingerprint: '', nonce: recoverNonce, signature: 'bad', recoverySecret: recoverySecret });
  assert.strictEqual(recovered.error, 'proof-invalid');
  const again = await device();
  const recoverNonce2 = await challenge(db, 'recover');
  const back = await handleAction(db, { action: 'recover', publicKey: again.publicJwk, fingerprint: again.fingerprint, nonce: recoverNonce2, signature: await again.sign('recover', recoverNonce2, ''), recoverySecret: recoverySecret, deviceName: 'restored' });
  assert.strictEqual(back.spaceId, created.spaceId);
  assert.strictEqual((await handleAction(db, { action: 'pull', accessToken: back.accessToken })).state.days['device-local|2026-11-01'].new, 6);
  const foreign = await handleAction(db, { action: 'pull', accessToken: back.accessToken, origin: 'https://evil.example' });
  assert.strictEqual(foreign.error, 'origin-rejected');
  assert.strictEqual((await handleAction(db, { action: 'pull', accessToken: back.accessToken, origin: 'https://putao0130-design.github.io' })).spaceId, created.spaceId);
  return { created: created, recoverySecret: recoverySecret };
}

(async function () {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/001_dogverb_sync.sql'), 'utf8');
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE public.dogverb_kv FROM anon'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE public.dogverb_kv FROM authenticated'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.dogverb_commit_tx(jsonb, jsonb) FROM anon'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.dogverb_commit_tx(jsonb, jsonb) TO service_role'));
  assert.ok(sql.includes('automatic grants') || sql.includes('automatic grants OFF') || sql.toLowerCase().includes('auto-grant') || sql.includes('自动授予') || sql.includes('automatic grants'));
  assert.ok(!/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(sql));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT, 'sync-config.js'), 'utf8');
  assert.ok(config.includes("anonKey: ''"));
  assert.ok(config.includes('PASTE_SUPABASE_ANON_PUBLIC_KEY'));
  assert.ok(config.includes(PROJECT_URL));
  assert.ok(!/service_role\s*[:=]\s*['\"]/i.test(config));
  assert.ok(html.includes('sync-config.js?v=33'));
  assert.ok(!html.includes('cloudbase'));

  let calls = 0;
  let refused = false;
  try {
    await adapter.bind({ url: PROJECT_URL, anonKey: '', fetch: function () { calls++; } }).createSpace({});
  } catch (e) { refused = e.data && e.data.error === 'sync-disabled'; }
  assert.strictEqual(refused, true);
  assert.strictEqual(calls, 0);
  refused = false;
  try {
    await adapter.bind({ url: PROJECT_URL, anonKey: 'PASTE_SUPABASE_ANON_PUBLIC_KEY', fetch: function () { calls++; } }).createSpace({});
  } catch (e) { refused = e.data && e.data.error === 'sync-disabled'; }
  assert.strictEqual(refused, true);
  assert.strictEqual(calls, 0);
  refused = false;
  try {
    await adapter.bind({ url: 'https://example.supabase.co', anonKey: FAKE_ANON, fetch: function () { calls++; } }).createSpace({});
  } catch (e) { refused = e.data && e.data.error === 'sync-disabled'; }
  assert.strictEqual(refused, true);
  assert.strictEqual(calls, 0);

  await runProtocol(createMemoryDb());
  await runProtocol(createPgAdapter(createMockClient()));

  const shared = createMemoryDb();
  const transport = adapter.bind({
    url: PROJECT_URL,
    anonKey: FAKE_ANON,
    fetch: async function (url, opts) {
      assert.ok(String(url).indexOf('/functions/v1/dogverb-sync') > 0);
      assert.strictEqual(opts.headers.apikey, FAKE_ANON);
      assert.strictEqual(opts.headers.authorization, 'Bearer ' + FAKE_ANON);
      assert.strictEqual(opts.headers['x-dogverb-request'], '1');
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.origin, 'https://putao0130-design.github.io');
      assert.ok(!JSON.stringify(body).includes('service_role'));
      assert.ok(!JSON.stringify(body).includes('SERVICE_ROLE'));
      const result = await handleAction(shared, body);
      const status = result && result.error ? 400 : 200;
      return { ok: status === 200, status: status, json: async function () { return result; } };
    }
  });
  const made = await transport.createSpace({ deviceName: 'adapter', storage: { async get() { return null; }, async set() {} } });
  assert.ok(made.session.spaceId);
  assert.ok(made.recoverySecret.length >= 43);

  console.log('supabase adapter tests ok');
})().catch(function (err) { console.error(err); process.exit(1); });
