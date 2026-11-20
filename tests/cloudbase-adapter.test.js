const assert = require('assert');
const fs = require('fs');
const path = require('path');
const wire = require('../sync-wire.js');
const prep = require('../sync-prep.js');
const { handleAction } = require('../cloudbase/functions/dogverb-sync/actions.js');
const { createMemoryDb } = require('../cloudbase/memory-db.js');
const adapter = require('../cloudbase/client-adapter.js');

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

(async function () {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../cloudbase/security-rules.json'), 'utf8'));
  assert.strictEqual(rules.database, 'document');
  Object.keys(rules.collections).forEach(function (name) {
    assert.strictEqual(rules.collections[name].read, false);
    assert.strictEqual(rules.collections[name].write, false);
    assert.strictEqual(rules.collections[name].delete, false);
  });
  assert.ok(!JSON.stringify(rules).includes('auth.uid()'));
  const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(!page.includes('envId') && !page.includes('tcb.cloud.tencent.com'));
  let calls = 0;
  let refused = false;
  try { await adapter.bind({ envId: '', callFunction: function () { calls++; } }).createSpace({}); }
  catch (e) { refused = e.data && e.data.error === 'sync-disabled'; }
  assert.strictEqual(refused, true);
  assert.strictEqual(calls, 0);

  const db = createMemoryDb();
  const owner = await device();
  const nonce = await challenge(db, 'create-space');
  const recoverySecret = wire.randomToken(32);
  const created = await handleAction(db, { action: 'createSpace', publicKey: owner.publicJwk, fingerprint: owner.fingerprint, nonce: nonce, signature: await owner.sign('create-space', nonce, ''), recoveryHash: await wire.sha256Hex(recoverySecret), deviceName: 'phone' });
  assert.ok(created.spaceId && created.accessToken);
  const dumped = JSON.stringify(db.dump());
  assert.strictEqual(dumped.includes(recoverySecret), false);
  assert.strictEqual(dumped.includes(created.accessToken), false);

  const mintNonce = await challenge(db, 'mint-pair');
  const minted = await handleAction(db, { action: 'mint', accessToken: created.accessToken, nonce: mintNonce, signature: await owner.sign('mint-pair', mintNonce, '') });
  assert.strictEqual(JSON.stringify(db.dump()).includes(minted.code), false);
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

  const shared = createMemoryDb();
  const transport = adapter.bind({
    envId: 'dogverb-test',
    callFunction: async function (call) {
      assert.strictEqual(call.name, 'dogverb-sync');
      assert.strictEqual(call.data.origin, 'https://putao0130-design.github.io');
      assert.ok(!JSON.stringify(call.data).includes('secretKey'));
      return { result: await handleAction(shared, call.data) };
    }
  });
  const made = await transport.createSpace({ deviceName: 'adapter', storage: { async get() { return null; }, async set() {} } });
  assert.ok(made.session.spaceId);
  assert.ok(made.recoverySecret.length >= 43);
  console.log('cloudbase adapter tests ok');
})().catch(function (err) { console.error(err); process.exit(1); });
