// Device pairing client. Access tokens stay in memory. The device private key is
// non-extractable. A refresh token may sit in IndexedDB so a reload can continue;
// script access on this origin can use that key, which is the browser XSS limit.
// HttpOnly cookies are not used: the learning app origin and this API origin differ,
// so a cookie would be cross-site. Requests send a bearer token plus X-Dogverb-Request,
// which a foreign form cannot attach without a CORS preflight.
(function (root) {
  const wire = root.DogverbWire || (typeof require === 'function' ? require('./sync-wire.js') : null);
  if (!wire) throw new Error('DogverbWire required');

  function memoryStorage() {
    const data = new Map();
    return {
      async get(key) { return data.has(key) ? data.get(key) : null; },
      async set(key, value) { data.set(key, value); },
      async delete(key) { data.delete(key); }
    };
  }
  function idbStorage() {
    const open = function () {
      return new Promise(function (resolve, reject) {
        const req = indexedDB.open('dogverb-sync', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    };
    const run = async function (mode, fn) {
      const db = await open();
      try {
        return await new Promise(function (resolve, reject) {
          const tx = db.transaction('kv', mode);
          const store = tx.objectStore('kv');
          const req = fn(store);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      } finally { db.close(); }
    };
    return {
      async get(key) { const value = await run('readonly', function (store) { return store.get(key); }); return value === undefined ? null : value; },
      async set(key, value) { await run('readwrite', function (store) { return store.put(value, key); }); },
      async delete(key) { await run('readwrite', function (store) { return store.delete(key); }); }
    };
  }
  async function generateDevice() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const publicJwk = wire.publicJwkOnly(await crypto.subtle.exportKey('jwk', pair.publicKey));
    const fingerprint = await wire.fingerprintJwk(publicJwk);
    return { privateKey: pair.privateKey, publicJwk: publicJwk, fingerprint: fingerprint };
  }
  async function sign(privateKey, text) {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text));
    return wire.bytesToB64url(new Uint8Array(sig));
  }
  async function post(url, body, session) {
    const headers = { 'content-type': 'application/json', 'x-dogverb-request': '1' };
    if (session && session.accessToken) headers.authorization = 'Bearer ' + session.accessToken;
    let res;
    try { res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }); }
    catch (e) { const err = new Error('network'); err.network = true; throw err; }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) { const err = new Error(data.error || 'http'); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  async function challenge(server, purpose) { return (await post(server + '/v1/challenge', { purpose: purpose })).nonce; }
  async function signed(session, purpose, extra) {
    const nonce = await challenge(session.server, purpose);
    const signature = await sign(session.privateKey, wire.signText(purpose, nonce, session.fingerprint, extra || ''));
    return { nonce: nonce, signature: signature };
  }
  async function persist(session) {
    await session.storage.set('device', {
      server: session.server, spaceId: session.spaceId, deviceId: session.deviceId, role: session.role,
      refreshToken: session.refreshToken, publicJwk: session.publicJwk, fingerprint: session.fingerprint,
      privateKey: session.privateKey
    });
  }
  function adopt(session, tokens) {
    session.spaceId = tokens.spaceId;
    session.deviceId = tokens.deviceId;
    session.role = tokens.role || session.role;
    session.fingerprint = tokens.fingerprint || session.fingerprint;
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken;
    session.accessExpires = Date.now() + tokens.accessTtlMs;
  }
  async function refresh(session) {
    const proof = await signed(session, 'refresh', '');
    const tokens = await post(session.server + '/v1/session/refresh', {
      refreshToken: session.refreshToken, nonce: proof.nonce, signature: proof.signature
    });
    adopt(session, tokens);
    await persist(session);
    return session;
  }
  async function authed(session, path, body, purpose, extra) {
    const proof = await signed(session, purpose, extra || '');
    const payload = Object.assign({}, body || {}, proof);
    try { return await post(session.server + path, payload, session); }
    catch (e) {
      if (e.status === 401 && e.data && e.data.error === 'expired') {
        await refresh(session);
        const again = await signed(session, purpose, extra || '');
        return await post(session.server + path, Object.assign({}, body || {}, again), session);
      }
      throw e;
    }
  }
  async function createSpace(opts) {
    const storage = opts.storage || memoryStorage();
    const device = await generateDevice();
    const server = opts.server;
    const nonce = await challenge(server, 'create-space');
    const signature = await sign(device.privateKey, wire.signText('create-space', nonce, device.fingerprint, ''));
    const recoverySecret = wire.randomToken(32);
    const recoveryHash = await wire.sha256Hex(recoverySecret);
    const created = await post(server + '/v1/spaces', {
      deviceName: opts.deviceName || 'device', publicKey: device.publicJwk, fingerprint: device.fingerprint,
      nonce: nonce, signature: signature, recoveryHash: recoveryHash
    });
    const session = { server: server, storage: storage, privateKey: device.privateKey, publicJwk: device.publicJwk };
    adopt(session, created);
    await persist(session);
    return { session: session, recoverySecret: recoverySecret };
  }
  async function mintPairing(session) {
    const proof = await signed(session, 'mint-pair', '');
    const minted = await post(session.server + '/v1/pair/mint', proof, session);
    return { pairingId: minted.pairingId, code: minted.code, payload: minted.payload, expiresAt: minted.expiresAt };
  }
  async function submitPairing(opts) {
    const storage = opts.storage || memoryStorage();
    const device = await generateDevice();
    const parsed = wire.parsePairingPayload(opts.payload || '');
    const code = parsed ? parsed.code : opts.code;
    const nonce = await challenge(opts.server, 'submit-pair');
    const signature = await sign(device.privateKey, wire.signText('submit-pair', nonce, device.fingerprint, code));
    const submitted = await post(opts.server + '/v1/pair/submit', {
      code: code, payload: opts.payload || wire.pairingPayload(opts.pairingId || '', code),
      publicKey: device.publicJwk, fingerprint: device.fingerprint, deviceName: opts.deviceName || 'new device',
      nonce: nonce, signature: signature
    });
    const session = {
      server: opts.server, storage: storage, privateKey: device.privateKey, publicJwk: device.publicJwk,
      fingerprint: device.fingerprint, pairingId: submitted.pairingId, role: 'member'
    };
    return { session: session, fingerprint: submitted.fingerprint, status: submitted.status };
  }
  async function confirmPairing(session, pairingId, fingerprint) {
    return authed(session, '/v1/pair/confirm', { pairingId: pairingId, fingerprint: fingerprint }, 'confirm-pair', pairingId);
  }
  async function claimPairing(session) {
    const proof = await signed(session, 'claim-pair', session.pairingId);
    const tokens = await post(session.server + '/v1/pair/claim', { pairingId: session.pairingId, nonce: proof.nonce, signature: proof.signature });
    adopt(session, tokens);
    await persist(session);
    return session;
  }
  async function resume(opts) {
    const storage = opts.storage;
    const saved = await storage.get('device');
    if (!saved || !saved.refreshToken || !saved.privateKey) return null;
    const session = Object.assign({}, saved, { storage: storage, server: opts.server || saved.server });
    await refresh(session);
    return session;
  }
  function dedupe(list) {
    const seen = {}; const out = [];
    for (let i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].id || seen[list[i].id]) continue;
      seen[list[i].id] = true; out.push(list[i]);
    }
    return out;
  }
  async function pushEvents(session, events) {
    const stored = (await session.storage.get('outbox')) || [];
    const merged = dedupe(stored.concat(events || []));
    if (!merged.length) return { results: [] };
    try {
      const res = await authed(session, '/v1/sync/push', { events: merged }, 'sync', '');
      await session.storage.set('outbox', []);
      return res;
    } catch (e) {
      if (e.network) { await session.storage.set('outbox', merged); return { offline: true, queued: merged.length }; }
      throw e;
    }
  }
  async function pushLegacy(session, snapshot) {
    return authed(session, '/v1/sync/push', { legacy: snapshot, events: [] }, 'sync', '');
  }
  async function pull(session) {
    try { return await post(session.server + '/v1/sync/pull', {}, session); }
    catch (e) {
      if (e.status === 401 && e.data && e.data.error === 'expired') { await refresh(session); return await post(session.server + '/v1/sync/pull', {}, session); }
      throw e;
    }
  }
  async function revokeDevice(session, deviceId) {
    return authed(session, '/v1/devices/revoke', { deviceId: deviceId }, 'revoke', deviceId);
  }
  async function recover(opts) {
    const storage = opts.storage || memoryStorage();
    const device = await generateDevice();
    const nonce = await challenge(opts.server, 'recover');
    const signature = await sign(device.privateKey, wire.signText('recover', nonce, device.fingerprint, ''));
    const tokens = await post(opts.server + '/v1/recover', {
      recoverySecret: opts.recoverySecret, publicKey: device.publicJwk, fingerprint: device.fingerprint,
      deviceName: opts.deviceName || 'recovered', nonce: nonce, signature: signature
    });
    const session = { server: opts.server, storage: storage, privateKey: device.privateKey, publicJwk: device.publicJwk };
    adopt(session, tokens);
    await persist(session);
    return { session: session };
  }
  async function linkAccount(session, accountLabel) {
    return authed(session, '/v1/spaces/link', { accountLabel: accountLabel }, 'link', accountLabel);
  }
  async function privateKeyExportFails(session) {
    try { await crypto.subtle.exportKey('jwk', session.privateKey); return false; }
    catch (e) { return true; }
  }

  const api = {
    memoryStorage: memoryStorage, idbStorage: idbStorage, createSpace: createSpace, mintPairing: mintPairing,
    submitPairing: submitPairing, confirmPairing: confirmPairing, claimPairing: claimPairing, resume: resume,
    pushEvents: pushEvents, pushLegacy: pushLegacy, pull: pull, revokeDevice: revokeDevice, recover: recover,
    linkAccount: linkAccount, privateKeyExportFails: privateKeyExportFails
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DogverbSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
