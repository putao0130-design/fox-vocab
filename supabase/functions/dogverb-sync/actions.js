// Authoritative Dog Verb pairing for the Supabase Postgres project.
// Call this only from the Edge Function. The Data API has RLS enabled and no
// anon/authenticated policies, so clients cannot read or write rows directly.
// The learning space is the pairing space id, not a Supabase Auth user id.
'use strict';
const crypto = require('crypto');
function load(file) {
  try { return require('./' + file); }
  catch (e) { return require('../../../' + file); }
}
const wire = load('sync-wire.js');
const prep = load('sync-prep.js');

const ORIGIN = 'https://putao0130-design.github.io';
const LIMITS = { submitFailPerIp: 8, submitWindowMs: 10 * 60 * 1000, confirmFailPerPair: 5, recoveryPerIp: 5, recoveryWindowMs: 60 * 60 * 1000, accessTtlMs: 5 * 60 * 1000, refreshTtlMs: 30 * 24 * 60 * 60 * 1000, pairTtlMs: 5 * 60 * 1000, nonceTtlMs: 2 * 60 * 1000 };

function hashSecret(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function cleanName(name) {
  const text = String(name || 'device').replace(/[\u0000-\u001f]/g, '').trim();
  return (text || 'device').slice(0, 40);
}
async function verify(jwkText, purpose, nonce, fingerprint, extra, signature) {
  const jwk = wire.publicJwkOnly(JSON.parse(jwkText));
  if (!jwk || !signature) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, wire.b64urlToBytes(signature), new TextEncoder().encode(wire.signText(purpose, nonce, fingerprint, extra)));
}
function originRejected(event) {
  if (!event || !event.origin) return false;
  return event.origin !== ORIGIN;
}

async function handleAction(db, event, ctx) {
  const now = (ctx && ctx.now) || Date.now();
  if (originRejected(event)) return { error: 'origin-rejected' };
  const action = event && event.action;
  try {
    if (action === 'challenge') return challenge(db, event, now);
    if (action === 'createSpace') return await createSpace(db, event, now);
    if (action === 'mint') return await mint(db, event, now);
    if (action === 'submit') return await submit(db, event, now);
    if (action === 'pending') return await pending(db, event, now);
    if (action === 'confirm') return await confirm(db, event, now);
    if (action === 'claim') return await claim(db, event, now);
    if (action === 'refresh') return await refresh(db, event, now);
    if (action === 'revoke') return await revoke(db, event, now);
    if (action === 'recover') return await recover(db, event, now);
    if (action === 'push') return await push(db, event, now);
    if (action === 'pull') return await pull(db, event, now);
    return { error: 'not-found' };
  } catch (e) {
    if (e && e.code === 'pair-replay') return { error: 'pair-replay' };
    if (e && e.code === 'unauthorized') return { error: 'unauthorized' };
    throw e;
  }
}

async function challenge(db, event, now) {
  const purpose = String(event.purpose || '');
  if (['create-space', 'mint-pair', 'submit-pair', 'confirm-pair', 'claim-pair', 'refresh', 'revoke', 'recover', 'sync'].indexOf(purpose) < 0) return { error: 'bad-purpose' };
  const nonce = wire.randomToken(32);
  await db.put('nonces', nonce, { purpose: purpose, expiresAt: now + LIMITS.nonceTtlMs, usedAt: null });
  return { nonce: nonce };
}
async function takeNonce(db, nonce, purpose, now) {
  return db.transaction(async function (tx) {
    const row = await tx.get('nonces', nonce);
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= now) return false;
    await tx.patch('nonces', nonce, { usedAt: now });
    return true;
  });
}
async function rateHit(db, key, limit, windowMs, now) {
  return db.transaction(async function (tx) {
    const row = await tx.get('rate', key);
    if (!row || now - row.windowStart >= windowMs) { await tx.put('rate', key, { windowStart: now, count: 1 }); return true; }
    if (row.count >= limit) return false;
    await tx.patch('rate', key, { count: row.count + 1 });
    return true;
  });
}
async function readSession(db, token, kind, now) {
  if (!token) return { error: 'unauthorized' };
  const row = await db.get('sessions', hashSecret(token));
  if (!row || row.kind !== kind) return { error: 'unauthorized' };
  const device = await db.get('devices', row.deviceId);
  if (!device || device.revokedAt) return { error: 'unauthorized' };
  if (row.expiresAt <= now) return { error: 'expired' };
  return { device: device };
}
function trusted(device) { return device && !device.revokedAt && (device.role === 'original' || device.role === 'recovered'); }
async function issue(db, device, now) {
  const access = wire.randomToken(32);
  const refresh = wire.randomToken(32);
  await db.put('sessions', hashSecret(access), { kind: 'access', deviceId: device.id, spaceId: device.spaceId, expiresAt: now + LIMITS.accessTtlMs });
  await db.put('sessions', hashSecret(refresh), { kind: 'refresh', deviceId: device.id, spaceId: device.spaceId, expiresAt: now + LIMITS.refreshTtlMs });
  return { spaceId: device.spaceId, deviceId: device.id, role: device.role, fingerprint: device.fingerprint, accessToken: access, refreshToken: refresh, accessTtlMs: LIMITS.accessTtlMs };
}

async function createSpace(db, event, now) {
  const jwk = wire.publicJwkOnly(event.publicKey);
  if (!jwk) return { error: 'bad-key' };
  const fingerprint = await wire.fingerprintJwk(jwk);
  if (event.fingerprint !== fingerprint) return { error: 'bad-key' };
  if (!(await takeNonce(db, event.nonce, 'create-space', now))) return { error: 'nonce-replay' };
  if (!(await verify(JSON.stringify(jwk), 'create-space', event.nonce, fingerprint, '', event.signature))) return { error: 'proof-invalid' };
  if (!/^[a-f0-9]{64}$/.test(event.recoveryHash || '')) return { error: 'bad-recovery' };
  const spaceId = wire.randomToken(16);
  const device = { id: wire.randomToken(16), spaceId: spaceId, publicJwk: JSON.stringify(jwk), fingerprint: fingerprint, name: cleanName(event.deviceName), role: 'original', revokedAt: null };
  return db.transaction(async function (tx) {
    await tx.put('spaces', spaceId, { recoveryHash: event.recoveryHash, linkedAccount: null, account: prep.emptyAccount(), createdAt: now });
    await tx.put('devices', device.id, device);
    return issue(tx, device, now);
  });
}

async function mint(db, event, now) {
  const auth = await readSession(db, event.accessToken, 'access', now);
  if (auth.error) return auth;
  if (!trusted(auth.device)) return { error: 'not-original' };
  if (!(await takeNonce(db, event.nonce, 'mint-pair', now))) return { error: 'nonce-replay' };
  if (!(await verify(auth.device.publicJwk, 'mint-pair', event.nonce, auth.device.fingerprint, '', event.signature))) return { error: 'proof-invalid' };
  const code = wire.pairingCode();
  const id = wire.randomToken(16);
  await db.put('pairing', id, { codeHash: hashSecret(code), spaceId: auth.device.spaceId, deviceName: null, publicJwk: null, fingerprint: null, deviceId: null, expiresAt: now + LIMITS.pairTtlMs, consumedAt: null, claimedAt: null, failCount: 0 });
  return { pairingId: id, code: code, payload: wire.pairingPayload(id, code), expiresAt: now + LIMITS.pairTtlMs };
}

async function submit(db, event, now) {
  const jwk = wire.publicJwkOnly(event.publicKey);
  if (!jwk) return { error: 'bad-key' };
  const fingerprint = await wire.fingerprintJwk(jwk);
  if (!(await takeNonce(db, event.nonce, 'submit-pair', now))) return { error: 'nonce-replay' };
  if (!(await verify(JSON.stringify(jwk), 'submit-pair', event.nonce, fingerprint, event.code || '', event.signature))) return { error: 'proof-invalid' };
  const parsed = wire.parsePairingPayload(event.payload || '');
  const code = parsed ? parsed.code : event.code;
  const rows = code ? await db.find('pairing', { codeHash: hashSecret(code) }) : [];
  const row = rows[0];
  if (!row) {
    if (!(await rateHit(db, 'submit:' + String(event.ip || 'unknown'), LIMITS.submitFailPerIp, LIMITS.submitWindowMs, now))) return { error: 'rate-limited' };
    return { error: 'pair-unknown' };
  }
  if (row.expiresAt <= now) return { error: 'pair-expired' };
  if (row.consumedAt) return { error: 'pair-consumed' };
  if (row.publicJwk && row.fingerprint !== fingerprint) return { error: 'pair-bound' };
  if (!row.publicJwk) {
    const bound = await db.transaction(async function (tx) {
      const fresh = await tx.get('pairing', row.id);
      if (!fresh || fresh.publicJwk || fresh.consumedAt) return false;
      await tx.patch('pairing', row.id, { publicJwk: JSON.stringify(jwk), fingerprint: fingerprint, deviceName: cleanName(event.deviceName) });
      return true;
    });
    if (!bound) return { error: 'pair-bound' };
  }
  return { pairingId: row.id, fingerprint: fingerprint, status: 'waiting-for-original' };
}

async function pending(db, event, now) {
  const auth = await readSession(db, event.accessToken, 'access', now);
  if (auth.error) return auth;
  if (!trusted(auth.device)) return { error: 'not-original' };
  const rows = await db.find('pairing', { spaceId: auth.device.spaceId });
  return { pending: rows.filter(function (row) { return row.publicJwk && !row.consumedAt && row.expiresAt > now; }).map(function (row) { return { pairingId: row.id, deviceName: row.deviceName, fingerprint: row.fingerprint, expiresAt: row.expiresAt }; }) };
}

async function confirm(db, event, now) {
  const auth = await readSession(db, event.accessToken, 'access', now);
  if (auth.error) return auth;
  if (!trusted(auth.device)) return { error: 'not-original' };
  if (!(await takeNonce(db, event.nonce, 'confirm-pair', now))) return { error: 'nonce-replay' };
  if (!(await verify(auth.device.publicJwk, 'confirm-pair', event.nonce, auth.device.fingerprint, event.pairingId || '', event.signature))) return { error: 'proof-invalid' };
  return db.transaction(async function (tx) {
    const row = await tx.get('pairing', event.pairingId);
    if (!row || row.spaceId !== auth.device.spaceId || !row.publicJwk) return { error: 'pair-unknown' };
    if (row.expiresAt <= now) return { error: 'pair-expired' };
    if (row.consumedAt) return { error: 'pair-consumed' };
    if (row.fingerprint !== event.fingerprint) {
      const fails = (row.failCount || 0) + 1;
      await tx.patch('pairing', row.id, fails >= LIMITS.confirmFailPerPair ? { failCount: fails, expiresAt: now - 1 } : { failCount: fails });
      return { error: fails >= LIMITS.confirmFailPerPair ? 'rate-limited' : 'pair-fingerprint-mismatch' };
    }
    const deviceId = wire.randomToken(16);
    await tx.patch('pairing', row.id, { consumedAt: now, deviceId: deviceId });
    await tx.put('devices', deviceId, { id: deviceId, spaceId: row.spaceId, publicJwk: row.publicJwk, fingerprint: row.fingerprint, name: row.deviceName, role: 'member', revokedAt: null });
    return { ok: true, deviceId: deviceId };
  });
}

async function claim(db, event, now) {
  const row = await db.get('pairing', event.pairingId);
  if (!row || !row.publicJwk) return { error: 'pair-unknown' };
  if (!(await takeNonce(db, event.nonce, 'claim-pair', now))) return { error: 'nonce-replay' };
  if (!(await verify(row.publicJwk, 'claim-pair', event.nonce, row.fingerprint, row.id, event.signature))) return { error: 'proof-invalid' };
  if (!row.consumedAt) return { error: 'pair-not-confirmed' };
  return db.transaction(async function (tx) {
    const fresh = await tx.get('pairing', row.id);
    if (!fresh || fresh.claimedAt || !fresh.consumedAt) { const err = new Error('pair-replay'); err.code = 'pair-replay'; throw err; }
    const device = await tx.get('devices', fresh.deviceId);
    if (!device || device.revokedAt) { const err = new Error('unauthorized'); err.code = 'unauthorized'; throw err; }
    await tx.patch('pairing', fresh.id, { claimedAt: now });
    const tokens = await issue(tx, device, now);
    return tokens;
  });
}

async function refresh(db, event, now) {
  const presented = await readSession(db, event.refreshToken, 'refresh', now);
  if (presented.error) return presented;
  if (!(await takeNonce(db, event.nonce, 'refresh', now))) return { error: 'nonce-replay' };
  if (!(await verify(presented.device.publicJwk, 'refresh', event.nonce, presented.device.fingerprint, '', event.signature))) return { error: 'proof-invalid' };
  return db.transaction(async function (tx) {
    const key = hashSecret(event.refreshToken);
    const row = await tx.get('sessions', key);
    if (!row) { const err = new Error('unauthorized'); err.code = 'unauthorized'; throw err; }
    await tx.remove('sessions', key);
    return issue(tx, presented.device, now);
  });
}

async function revoke(db, event, now) {
  const auth = await readSession(db, event.accessToken, 'access', now);
  if (auth.error) return auth;
  if (!trusted(auth.device)) return { error: 'not-original' };
  if (!(await takeNonce(db, event.nonce, 'revoke', now))) return { error: 'nonce-replay' };
  if (!(await verify(auth.device.publicJwk, 'revoke', event.nonce, auth.device.fingerprint, event.deviceId || '', event.signature))) return { error: 'proof-invalid' };
  const target = await db.get('devices', event.deviceId);
  if (!target || target.spaceId !== auth.device.spaceId) return { error: 'not-found' };
  await db.transaction(async function (tx) {
    await tx.patch('devices', target.id, { revokedAt: now });
    const sessions = await tx.find('sessions', { deviceId: target.id });
    for (let i = 0; i < sessions.length; i++) await tx.remove('sessions', sessions[i].id);
  });
  return { ok: true };
}

async function recover(db, event, now) {
  if (!(await rateHit(db, 'recover:' + String(event.ip || 'unknown'), LIMITS.recoveryPerIp, LIMITS.recoveryWindowMs, now))) return { error: 'rate-limited' };
  const jwk = wire.publicJwkOnly(event.publicKey);
  if (!jwk || typeof event.recoverySecret !== 'string' || event.recoverySecret.length < 40) return { error: 'bad-recovery' };
  const fingerprint = await wire.fingerprintJwk(jwk);
  if (!(await takeNonce(db, event.nonce, 'recover', now))) return { error: 'nonce-replay' };
  if (!(await verify(JSON.stringify(jwk), 'recover', event.nonce, fingerprint, '', event.signature))) return { error: 'proof-invalid' };
  const recoveryHash = await wire.sha256Hex(event.recoverySecret);
  const spaces = await db.find('spaces', { recoveryHash: recoveryHash });
  if (!spaces.length) return { error: 'unauthorized' };
  const device = { id: wire.randomToken(16), spaceId: spaces[0].id, publicJwk: JSON.stringify(jwk), fingerprint: fingerprint, name: cleanName(event.deviceName), role: 'recovered', revokedAt: null };
  return db.transaction(async function (tx) {
    await tx.put('devices', device.id, device);
    const tokens = await issue(tx, device, now);
    tokens.role = 'recovered';
    return tokens;
  });
}

async function push(db, event, now) {
  const auth = await gate(db, event, now);
  if (auth.error) return auth;
  return db.transaction(async function (tx) {
    const space = await tx.get('spaces', auth.device.spaceId);
    const store = prep.createStore();
    store.accounts[space.id] = space.account;
    let legacy = null;
    if (event.legacy) {
      legacy = prep.importLegacy(store, space.id, event.legacy);
      if (!legacy.ok && legacy.reason === 'empty-snapshot') return { error: 'empty-snapshot' };
      if (!legacy.ok) return { error: legacy.reason || 'bad-snapshot' };
    }
    const events = prep.acceptEvents(store, space.id, event.events || [], { appliedAt: now });
    if (!events.ok) return { error: events.reason || 'bad-events' };
    await tx.patch('spaces', space.id, { account: store.accounts[space.id] });
    return {
      legacy: legacy ? { applied: !!legacy.applied, noop: !!legacy.noop, limitation: legacy.export ? legacy.export.limitation : null } : null,
      results: events.results.map(function (row) { return { id: row.id, consumed: !!row.consumed, noop: !!row.noop, reason: row.reason || null }; }),
      limitations: prep.materialize(store, space.id).limitations
    };
  });
}

async function pull(db, event, now) {
  const auth = await readSession(db, event.accessToken, 'access', now);
  if (auth.error) return auth;
  const space = await db.get('spaces', auth.device.spaceId);
  const store = prep.createStore();
  store.accounts[space.id] = space.account;
  const devices = await db.find('devices', { spaceId: space.id });
  return { spaceId: space.id, state: prep.materialize(store, space.id), devices: devices.map(function (device) { return { deviceId: device.id, name: device.name, role: device.role, fingerprint: device.fingerprint, revoked: !!device.revokedAt }; }) };
}

async function gate(db, event, now) {
  const auth = await readSession(db, event.accessToken, 'access', now);
  if (auth.error) return auth;
  if (!(await takeNonce(db, event.nonce, 'sync', now))) return { error: 'nonce-replay' };
  if (!(await verify(auth.device.publicJwk, 'sync', event.nonce, auth.device.fingerprint, '', event.signature))) return { error: 'proof-invalid' };
  return auth;
}

module.exports = { handleAction: handleAction, ORIGIN: ORIGIN, hashSecret: hashSecret };
