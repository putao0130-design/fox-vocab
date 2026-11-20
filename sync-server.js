// LOCAL REFERENCE BACKEND. Not production and not deployed.
// GitHub Pages cannot run this process. Authoritative pairing, rate limits,
// token checks, and the SQLite file live here. The learning app does not start it.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const prep = require('./sync-prep.js');
const wire = require('./sync-wire.js');

const BODY_LIMIT = 8 * 1024 * 1024;
const HEADER = 'x-dogverb-request';

function defaultLimits() {
  return {
    pairMintPerSpace: 10, pairMintWindowMs: 60 * 60 * 1000,
    submitFailPerIp: 8, submitWindowMs: 10 * 60 * 1000,
    confirmFailPerPair: 5,
    recoveryPerIp: 5, recoveryWindowMs: 60 * 60 * 1000,
    accessTtlMs: 5 * 60 * 1000,
    refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
    pairTtlMs: 5 * 60 * 1000,
    nonceTtlMs: 2 * 60 * 1000
  };
}

function createReferenceServer(options) {
  const opts = options || {};
  const limits = Object.assign(defaultLimits(), opts.limits || {});
  const now = function () { return opts.now ? opts.now() : Date.now(); };
  const allow = opts.origins || [];
  const log = opts.log || function () {};
  const db = new DatabaseSync(opts.dbPath || ':memory:');
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=FULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY, recovery_hash TEXT NOT NULL, linked_account TEXT,
      account_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, public_jwk TEXT NOT NULL,
      fingerprint TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      revoked_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pairing (
      id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, space_id TEXT NOT NULL,
      device_name TEXT, public_jwk TEXT, fingerprint TEXT, device_id TEXT,
      expires_at INTEGER NOT NULL, consumed_at INTEGER, claimed_at INTEGER,
      fail_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, device_id TEXT NOT NULL,
      space_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate (
      key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
    );
  `);

  let turn = Promise.resolve();
  function exclusive(fn) {
    const run = turn.then(fn, fn);
    turn = run.then(function () {}, function () {});
    return run;
  }
  function hashSecret(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
  function q(sql) { return db.prepare(sql); }
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (err) { /* already closed */ } throw e; }
  }
  function rateHit(key, limit, windowMs) {
    return tx(function () {
      const t = now();
      const row = q('SELECT window_start, count FROM rate WHERE key = ?').get(key);
      if (!row || t - row.window_start >= windowMs) {
        q('INSERT INTO rate (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').run(key, t);
        return true;
      }
      if (row.count >= limit) return false;
      q('UPDATE rate SET count = count + 1 WHERE key = ?').run(key);
      return true;
    });
  }
  function issueNonce(purpose) {
    const nonce = wire.randomToken(32);
    q('INSERT INTO nonces (nonce, purpose, expires_at, used_at) VALUES (?, ?, ?, NULL)').run(nonce, purpose, now() + limits.nonceTtlMs);
    return nonce;
  }
  function takeNonce(nonce, purpose) {
    return tx(function () {
      const row = q('SELECT purpose, expires_at, used_at FROM nonces WHERE nonce = ?').get(nonce);
      if (!row || row.purpose !== purpose || row.used_at || row.expires_at <= now()) return false;
      const changed = q('UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL').run(now(), nonce);
      return changed.changes === 1;
    });
  }
  async function verify(jwkText, purpose, nonce, fingerprint, extra, signature) {
    const jwk = wire.publicJwkOnly(JSON.parse(jwkText));
    if (!jwk || !signature) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const data = new TextEncoder().encode(wire.signText(purpose, nonce, fingerprint, extra));
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, wire.b64urlToBytes(signature), data);
  }
  function deviceById(id) { return q('SELECT * FROM devices WHERE id = ?').get(id); }
  function trusted(device) { return device && !device.revoked_at && (device.role === 'original' || device.role === 'recovered'); }
  function loadStore(spaceId) {
    const row = q('SELECT account_json FROM spaces WHERE id = ?').get(spaceId);
    const store = prep.createStore();
    if (row) store.accounts[spaceId] = JSON.parse(row.account_json);
    return store;
  }
  function saveStore(spaceId, store) {
    q('UPDATE spaces SET account_json = ? WHERE id = ?').run(JSON.stringify(store.accounts[spaceId]), spaceId);
  }
  function mintSession(device, kind, ttl) {
    const token = wire.randomToken(32);
    q('INSERT INTO sessions (token_hash, kind, device_id, space_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(hashSecret(token), kind, device.id, device.space_id, now() + ttl);
    return token;
  }
  function readSession(token, kind) {
    if (!token) return { error: 'unauthorized' };
    const row = q('SELECT * FROM sessions WHERE token_hash = ? AND kind = ?').get(hashSecret(token), kind);
    if (!row) return { error: 'unauthorized' };
    const device = deviceById(row.device_id);
    if (!device || device.revoked_at) return { error: 'revoked' };
    if (row.expires_at <= now()) return { error: 'expired' };
    return { row: row, device: device };
  }
  function bearer(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(h);
    return m ? m[1] : '';
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = req.headers.origin || '';
    if (url.search) return json(res, req, 400, { error: 'query-forbidden' });
    if (origin && allow.length && allow.indexOf(origin) < 0) return json(res, req, 403, { error: 'origin-rejected' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(origin));
      res.end();
      log({ method: 'OPTIONS', path: url.pathname, status: 204 });
      return;
    }
    if (req.method === 'GET') return get(req, res, url);
    if (req.method !== 'POST') return json(res, req, 405, { error: 'method' });
    if (req.headers[HEADER] !== '1') return json(res, req, 400, { error: 'missing-header' });
    const bodyLimit = url.pathname === '/v1/sync/push' ? BODY_LIMIT : 16 * 1024;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > bodyLimit) {
      json(res, req, 413, { error: 'too-large' });
      req.destroy();
      return;
    }
    let body;
    try { body = await readBody(req, bodyLimit); }
    catch (e) { return json(res, req, e.status || 400, { error: e.code || 'bad-body' }); }
    try { await exclusive(function () { return route(req, res, url.pathname, body); }); }
    catch (e) { if (!res.headersSent) return json(res, req, 500, { error: 'server' }); }
  }

  function get(req, res, url) {
    if (url.pathname === '/health') return json(res, req, 200, { ok: true, role: 'local-reference' });
    if (url.pathname === '/harness.html') return file(res, req, 'text/html; charset=utf-8', harnessHtml());
    if (url.pathname === '/sync-wire.js') return file(res, req, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(__dirname, 'sync-wire.js')));
    if (url.pathname === '/sync-client.js') return file(res, req, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(__dirname, 'sync-client.js')));
    return json(res, req, 404, { error: 'not-found' });
  }

  async function route(req, res, pathname, body) {
    if (pathname === '/v1/challenge') {
      const purpose = String(body.purpose || '');
      if (['create-space', 'mint-pair', 'submit-pair', 'confirm-pair', 'claim-pair', 'reject-pair', 'refresh', 'revoke', 'recover', 'link', 'sync'].indexOf(purpose) < 0) {
        return json(res, req, 400, { error: 'bad-purpose' });
      }
      return json(res, req, 200, { nonce: issueNonce(purpose) });
    }
    if (pathname === '/v1/spaces') return createSpace(req, res, body);
    if (pathname === '/v1/pair/mint') return mint(req, res, body);
    if (pathname === '/v1/pair/submit') return submit(req, res, body);
    if (pathname === '/v1/pair/pending') return pending(req, res);
    if (pathname === '/v1/pair/confirm') return confirm(req, res, body);
    if (pathname === '/v1/pair/reject') return rejectPair(req, res, body);
    if (pathname === '/v1/pair/claim') return claim(req, res, body);
    if (pathname === '/v1/session/refresh') return refresh(req, res, body);
    if (pathname === '/v1/devices/revoke') return revoke(req, res, body);
    if (pathname === '/v1/sync/push') return push(req, res, body);
    if (pathname === '/v1/sync/pull') return pull(req, res);
    if (pathname === '/v1/recover') return recover(req, res, body);
    if (pathname === '/v1/spaces/link') return linkAccount(req, res, body);
    return json(res, req, 404, { error: 'not-found' });
  }

  async function createSpace(req, res, body) {
    const jwk = wire.publicJwkOnly(body.publicKey);
    if (!jwk) return json(res, req, 400, { error: 'bad-key' });
    const fingerprint = await wire.fingerprintJwk(jwk);
    if (body.fingerprint !== fingerprint) return json(res, req, 400, { error: 'bad-key' });
    if (!takeNonce(body.nonce, 'create-space')) return json(res, req, 401, { error: 'nonce-replay' });
    const ok = await verify(JSON.stringify(jwk), 'create-space', body.nonce, fingerprint, '', body.signature);
    if (!ok) return json(res, req, 401, { error: 'proof-invalid' });
    if (!/^[a-f0-9]{64}$/.test(body.recoveryHash || '')) return json(res, req, 400, { error: 'bad-recovery' });
    const spaceId = wire.randomToken(16);
    const device = {
      id: wire.randomToken(16), space_id: spaceId, public_jwk: JSON.stringify(jwk),
      fingerprint: fingerprint, name: cleanName(body.deviceName), role: 'original', revoked_at: null
    };
    tx(function () {
      q('INSERT INTO spaces (id, recovery_hash, linked_account, account_json, created_at) VALUES (?, ?, NULL, ?, ?)').run(spaceId, body.recoveryHash, JSON.stringify(prep.emptyAccount()), now());
      q('INSERT INTO devices (id, space_id, public_jwk, fingerprint, name, role, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').run(device.id, spaceId, device.public_jwk, fingerprint, device.name, 'original', now());
    });
    const access = mintSession(device, 'access', limits.accessTtlMs);
    const refreshToken = mintSession(device, 'refresh', limits.refreshTtlMs);
    return json(res, req, 201, { spaceId: spaceId, deviceId: device.id, role: 'original', fingerprint: fingerprint, accessToken: access, refreshToken: refreshToken, accessTtlMs: limits.accessTtlMs });
  }

  async function mint(req, res, body) {
    const gate = await gateTrusted(req, body, 'mint-pair', '');
    if (gate.error) return json(res, req, gate.status, { error: gate.error });
    if (!rateHit('mint:' + gate.device.space_id, limits.pairMintPerSpace, limits.pairMintWindowMs)) return json(res, req, 429, { error: 'rate-limited' });
    const code = wire.pairingCode();
    const id = wire.randomToken(16);
    q('INSERT INTO pairing (id, code_hash, space_id, device_name, public_jwk, fingerprint, device_id, expires_at, consumed_at, claimed_at, fail_count) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, 0)').run(id, hashSecret(code), gate.device.space_id, now() + limits.pairTtlMs);
    return json(res, req, 201, { pairingId: id, code: code, payload: wire.pairingPayload(id, code), expiresAt: now() + limits.pairTtlMs });
  }

  async function submit(req, res, body) {
    const ip = req.socket.remoteAddress || 'unknown'; // socket address only; X-Forwarded-For is not a client-controlled bypass
    const jwk = wire.publicJwkOnly(body.publicKey);
    if (!jwk) return json(res, req, 400, { error: 'bad-key' });
    const fingerprint = await wire.fingerprintJwk(jwk);
    if (!takeNonce(body.nonce, 'submit-pair')) return json(res, req, 401, { error: 'nonce-replay' });
    const ok = await verify(JSON.stringify(jwk), 'submit-pair', body.nonce, fingerprint, body.code || '', body.signature);
    if (!ok) return json(res, req, 401, { error: 'proof-invalid' });
    const parsed = wire.parsePairingPayload(body.payload || wire.pairingPayload(body.pairingId || '', body.code || ''));
    const code = parsed ? parsed.code : body.code;
    const row = code ? q('SELECT * FROM pairing WHERE code_hash = ?').get(hashSecret(code)) : null;
    if (!row) {
      if (!rateHit('submit:' + ip, limits.submitFailPerIp, limits.submitWindowMs)) return json(res, req, 429, { error: 'rate-limited' });
      return json(res, req, 404, { error: 'pair-unknown' });
    }
    if (row.expires_at <= now()) return json(res, req, 410, { error: 'pair-expired' });
    if (row.consumed_at) return json(res, req, 409, { error: 'pair-consumed' });
    if (row.public_jwk && row.fingerprint !== fingerprint) return json(res, req, 409, { error: 'pair-bound' });
    if (!row.public_jwk) {
      const changed = q("UPDATE pairing SET public_jwk = ?, fingerprint = ?, device_name = ? WHERE id = ? AND public_jwk IS NULL AND consumed_at IS NULL").run(JSON.stringify(jwk), fingerprint, cleanName(body.deviceName), row.id);
      if (changed.changes !== 1) return json(res, req, 409, { error: 'pair-bound' });
    }
    return json(res, req, 200, { pairingId: row.id, fingerprint: fingerprint, status: 'waiting-for-original' });
  }

  function pending(req, res) {
    const auth = readSession(bearer(req), 'access');
    if (auth.error) return json(res, req, 401, { error: auth.error });
    if (!trusted(auth.device)) return json(res, req, 403, { error: 'not-original' });
    const rows = q('SELECT id, device_name, fingerprint, expires_at FROM pairing WHERE space_id = ? AND consumed_at IS NULL AND public_jwk IS NOT NULL AND expires_at > ?').all(auth.device.space_id, now());
    return json(res, req, 200, { pending: rows.map(function (row) { return { pairingId: row.id, deviceName: row.device_name, fingerprint: row.fingerprint, expiresAt: row.expires_at }; }) });
  }

  async function confirm(req, res, body) {
    const gate = await gateTrusted(req, body, 'confirm-pair', body.pairingId || '');
    if (gate.error) return json(res, req, gate.status, { error: gate.error });
    const result = tx(function () {
      const row = q('SELECT * FROM pairing WHERE id = ? AND space_id = ?').get(body.pairingId, gate.device.space_id);
      if (!row || !row.public_jwk) return { error: 'pair-unknown', status: 404 };
      if (row.expires_at <= now()) return { error: 'pair-expired', status: 410 };
      if (row.consumed_at) return { error: 'pair-consumed', status: 409 };
      if (row.fingerprint !== body.fingerprint) {
        const fails = row.fail_count + 1;
        if (fails >= limits.confirmFailPerPair) q('UPDATE pairing SET fail_count = ?, expires_at = ? WHERE id = ?').run(fails, now() - 1, row.id);
        else q('UPDATE pairing SET fail_count = ? WHERE id = ?').run(fails, row.id);
        return { error: fails >= limits.confirmFailPerPair ? 'rate-limited' : 'pair-fingerprint-mismatch', status: fails >= limits.confirmFailPerPair ? 429 : 409 };
      }
      const changed = q('UPDATE pairing SET consumed_at = ?, device_id = ? WHERE id = ? AND consumed_at IS NULL AND fingerprint = ?').run(now(), wire.randomToken(16), row.id, body.fingerprint);
      if (changed.changes !== 1) return { error: 'pair-consumed', status: 409 };
      const fresh = q('SELECT * FROM pairing WHERE id = ?').get(row.id);
      q('INSERT INTO devices (id, space_id, public_jwk, fingerprint, name, role, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').run(fresh.device_id, fresh.space_id, fresh.public_jwk, fresh.fingerprint, fresh.device_name, 'member', now());
      return { ok: true, deviceId: fresh.device_id };
    });
    if (result.error) return json(res, req, result.status, { error: result.error });
    return json(res, req, 200, { ok: true, deviceId: result.deviceId });
  }

  async function rejectPair(req, res, body) {
    const gate = await gateTrusted(req, body, 'reject-pair', body.pairingId || '');
    if (gate.error) return json(res, req, gate.status, { error: gate.error });
    q('DELETE FROM pairing WHERE id = ? AND space_id = ? AND consumed_at IS NULL').run(body.pairingId, gate.device.space_id);
    return json(res, req, 200, { ok: true });
  }

  async function claim(req, res, body) {
    const row = q('SELECT * FROM pairing WHERE id = ?').get(body.pairingId);
    if (!row || !row.public_jwk) return json(res, req, 404, { error: 'pair-unknown' });
    if (!takeNonce(body.nonce, 'claim-pair')) return json(res, req, 401, { error: 'nonce-replay' });
    const ok = await verify(row.public_jwk, 'claim-pair', body.nonce, row.fingerprint, row.id, body.signature);
    if (!ok) return json(res, req, 401, { error: 'proof-invalid' });
    if (!row.consumed_at) return json(res, req, 409, { error: 'pair-not-confirmed' });
    if (row.claimed_at) return json(res, req, 409, { error: 'pair-replay' });
    let issued = null;
    try {
      issued = tx(function () {
        const changed = q('UPDATE pairing SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL AND consumed_at IS NOT NULL').run(now(), row.id);
        if (changed.changes !== 1) return { error: 'pair-replay' };
        const device = deviceById(row.device_id);
        if (!device || device.revoked_at) { const err = new Error('revoked'); err.code = 'revoked'; throw err; }
        return { tokens: tokensFor(device) };
      });
    } catch (e) {
      if (e.code === 'revoked') return json(res, req, 401, { error: 'revoked' });
      throw e;
    }
    if (issued.error) return json(res, req, 409, { error: issued.error });
    return json(res, req, 200, issued.tokens);
  }

  async function refresh(req, res, body) {
    const presented = readSession(body.refreshToken, 'refresh');
    if (presented.error) return json(res, req, 401, { error: presented.error });
    if (!takeNonce(body.nonce, 'refresh')) return json(res, req, 401, { error: 'nonce-replay' });
    const ok = await verify(presented.device.public_jwk, 'refresh', body.nonce, presented.device.fingerprint, '', body.signature);
    if (!ok) return json(res, req, 401, { error: 'proof-invalid' });
    const rotated = tx(function () {
      const gone = q('DELETE FROM sessions WHERE token_hash = ? AND kind = ?').run(hashSecret(body.refreshToken), 'refresh');
      if (gone.changes !== 1) return null;
      return tokensFor(presented.device);
    });
    if (!rotated) return json(res, req, 401, { error: 'unauthorized' });
    return json(res, req, 200, rotated);
  }

  async function revoke(req, res, body) {
    const gate = await gateTrusted(req, body, 'revoke', body.deviceId || '');
    if (gate.error) return json(res, req, gate.status, { error: gate.error });
    const target = deviceById(body.deviceId);
    if (!target || target.space_id !== gate.device.space_id) return json(res, req, 404, { error: 'not-found' });
    tx(function () {
      q('UPDATE devices SET revoked_at = ? WHERE id = ?').run(now(), target.id);
      q('DELETE FROM sessions WHERE device_id = ?').run(target.id);
    });
    return json(res, req, 200, { ok: true });
  }

  async function recover(req, res, body) {
    const ip = req.socket.remoteAddress || 'unknown'; // socket address only; X-Forwarded-For is not a client-controlled bypass
    if (!rateHit('recover:' + ip, limits.recoveryPerIp, limits.recoveryWindowMs)) return json(res, req, 429, { error: 'rate-limited' });
    const jwk = wire.publicJwkOnly(body.publicKey);
    if (!jwk || typeof body.recoverySecret !== 'string' || body.recoverySecret.length < 40) return json(res, req, 400, { error: 'bad-recovery' });
    const fingerprint = await wire.fingerprintJwk(jwk);
    if (!takeNonce(body.nonce, 'recover')) return json(res, req, 401, { error: 'nonce-replay' });
    const ok = await verify(JSON.stringify(jwk), 'recover', body.nonce, fingerprint, '', body.signature);
    if (!ok) return json(res, req, 401, { error: 'proof-invalid' });
    const recoveryHash = await wire.sha256Hex(body.recoverySecret);
    const space = q('SELECT id FROM spaces WHERE recovery_hash = ?').get(recoveryHash);
    if (!space) return json(res, req, 401, { error: 'unauthorized' });
    const device = {
      id: wire.randomToken(16), space_id: space.id, public_jwk: JSON.stringify(jwk),
      fingerprint: fingerprint, name: cleanName(body.deviceName), role: 'recovered'
    };
    q('INSERT INTO devices (id, space_id, public_jwk, fingerprint, name, role, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').run(device.id, device.space_id, device.public_jwk, fingerprint, device.name, 'recovered', now());
    const response = tokensFor(device);
    response.spaceId = space.id;
    response.role = 'recovered';
    return json(res, req, 201, response);
  }

  async function linkAccount(req, res, body) {
    const gate = await gateTrusted(req, body, 'link', body.accountLabel || '');
    if (gate.error) return json(res, req, gate.status, { error: gate.error });
    const label = String(body.accountLabel || '').slice(0, 80);
    if (!label) return json(res, req, 400, { error: 'bad-account' });
    q('UPDATE spaces SET linked_account = ? WHERE id = ?').run(label, gate.device.space_id);
    const view = prep.materialize(loadStore(gate.device.space_id), gate.device.space_id);
    return json(res, req, 200, { spaceId: gate.device.space_id, linkedAccount: label, eventIds: view.eventIds, migrations: view.migrations });
  }

  async function push(req, res, body) {
    const gate = await gateMember(req, body, 'sync');
    if (gate.error) return json(res, req, gate.status, { error: gate.error });
    const outcome = tx(function () {
      const store = loadStore(gate.device.space_id);
      let legacy = null;
      if (body.legacy) {
        legacy = prep.importLegacy(store, gate.device.space_id, body.legacy);
        if (!legacy.ok && legacy.reason !== 'empty-snapshot') return { status: 400, error: legacy.reason || 'bad-snapshot' };
        if (legacy.reason === 'empty-snapshot') return { status: 409, error: 'empty-snapshot' };
      }
      const events = prep.acceptEvents(store, gate.device.space_id, body.events || [], { appliedAt: now() });
      if (!events.ok) return { status: 400, error: events.reason || 'bad-events' };
      saveStore(gate.device.space_id, store);
      const view = prep.materialize(store, gate.device.space_id);
      return {
        status: 200,
        body: {
          legacy: legacy ? { applied: !!legacy.applied, noop: !!legacy.noop, migrationId: legacy.migrationId || null, limitation: legacy.export ? legacy.export.limitation : null } : null,
          results: events.results.map(function (row) { return { id: row.id, consumed: !!row.consumed, noop: !!row.noop, reason: row.reason || null }; }),
          limitations: view.limitations
        }
      };
    });
    return json(res, req, outcome.status, outcome.body || { error: outcome.error });
  }

  async function pull(req, res) {
    const auth = readSession(bearer(req), 'access');
    if (auth.error) return json(res, req, 401, { error: auth.error });
    const view = prep.materialize(loadStore(auth.device.space_id), auth.device.space_id) || Object.assign(prep.emptyAccount(), { accountId: auth.device.space_id, v: 2 });
    const space = q('SELECT linked_account FROM spaces WHERE id = ?').get(auth.device.space_id);
    const devices = q('SELECT id, name, role, fingerprint, revoked_at FROM devices WHERE space_id = ?').all(auth.device.space_id);
    return json(res, req, 200, {
      spaceId: auth.device.space_id, linkedAccount: space.linked_account, state: view,
      devices: devices.map(function (device) { return { deviceId: device.id, name: device.name, role: device.role, fingerprint: device.fingerprint, revoked: !!device.revoked_at }; })
    });
  }

  async function gateTrusted(req, body, purpose, extra) {
    const auth = readSession(bearer(req), 'access');
    if (auth.error) return { error: auth.error, status: 401 };
    if (!trusted(auth.device)) return { error: 'not-original', status: 403 };
    if (!takeNonce(body.nonce, purpose)) return { error: 'nonce-replay', status: 401 };
    const ok = await verify(auth.device.public_jwk, purpose, body.nonce, auth.device.fingerprint, extra, body.signature);
    if (!ok) return { error: 'proof-invalid', status: 401 };
    return { device: auth.device };
  }
  async function gateMember(req, body, purpose) {
    const auth = readSession(bearer(req), 'access');
    if (auth.error) return { error: auth.error, status: 401 };
    if (!takeNonce(body.nonce, purpose)) return { error: 'nonce-replay', status: 401 };
    const ok = await verify(auth.device.public_jwk, purpose, body.nonce, auth.device.fingerprint, '', body.signature);
    if (!ok) return { error: 'proof-invalid', status: 401 };
    return { device: auth.device };
  }
  function tokensFor(device) {
    return {
      spaceId: device.space_id, deviceId: device.id, role: device.role, fingerprint: device.fingerprint,
      accessToken: mintSession(device, 'access', limits.accessTtlMs),
      refreshToken: mintSession(device, 'refresh', limits.refreshTtlMs),
      accessTtlMs: limits.accessTtlMs
    };
  }
  function cleanName(name) {
    const text = String(name || 'device').replace(/[\u0000-\u001f]/g, '').trim();
    return (text || 'device').slice(0, 40);
  }
  function cors(origin) {
    const headers = { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-dogverb-request', 'vary': 'Origin' };
    if (origin && (allow.indexOf(origin) >= 0 || allow.length === 0)) headers['access-control-allow-origin'] = origin;
    return headers;
  }
  function json(res, req, status, body) {
    const origin = req.headers.origin || '';
    const payload = JSON.stringify(Object.assign({ reference: true, production: false }, body));
    res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-dogverb-backend': 'local-reference', 'x-content-type-options': 'nosniff' }, cors(origin)));
    res.end(payload);
    log({ method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname, status: status });
  }
  function file(res, req, type, buf) {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-dogverb-backend': 'local-reference' });
    res.end(buf);
    log({ method: 'GET', path: new URL(req.url, 'http://127.0.0.1').pathname, status: 200 });
  }
  function readBody(req, limit) {
    return new Promise(function (resolve, reject) {
      const chunks = []; let size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > limit) { reject(Object.assign(new Error('too-large'), { status: 413, code: 'too-large' })); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (e) { reject(Object.assign(new Error('bad-body'), { status: 400, code: 'bad-body' })); }
      });
    });
  }
  function harnessHtml() {
    return '<!doctype html><html><head><meta charset="utf-8"><title>Dog Verb reference harness</title></head><body><p>Local reference harness. Not the learning app.</p><script src="/sync-wire.js"></script><script src="/sync-client.js"></script></body></html>';
  }

  const server = http.createServer(function (req, res) {
    Promise.resolve(handle(req, res)).catch(function () { if (!res.headersSent) { res.writeHead(500); res.end(); } });
  });
  return {
    limits: limits, now: now, db: db,
    listen: function (port) {
      return new Promise(function (resolve) {
        server.listen(port || 0, '127.0.0.1', function () {
          const addr = server.address();
          resolve('http://127.0.0.1:' + addr.port);
        });
      });
    },
    close: function () { return new Promise(function (resolve) { server.close(function () { db.close(); resolve(); }); }); }
  };
}

module.exports = { createReferenceServer: createReferenceServer, defaultLimits: defaultLimits };
