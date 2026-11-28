// Browser-side transport to the dogverb-sync Edge Function.
// It does not embed a service role key or database password.
// Network calls happen only when DOGVERB_SYNC_CONFIG has the public project
// URL and a real anon/publishable key (not a placeholder).
(function (root) {
  const wire = root.DogverbWire || (typeof require === 'function' ? require('../sync-wire.js') : null);
  const PROJECT_URL = 'https://zkvscutsjspzuteogfet.supabase.co';
  const ORIGIN = 'https://putao0130-design.github.io';
  const PLACEHOLDER = /^(?:|PASTE_.*|YOUR_.*|CHANGE_ME.*|PLACEHOLDER.*)$/i;

  function disabled(config) {
    if (!config || !config.url || String(config.url) !== PROJECT_URL) return true;
    const key = String(config.anonKey || '');
    if (PLACEHOLDER.test(key) || key.length < 40) return true;
    return false;
  }
  function functionUrl(config) {
    return String(config.url).replace(/\/+$/, '') + '/functions/v1/dogverb-sync';
  }
  async function invoke(config, action, data) {
    if (disabled(config)) { const err = new Error('sync-disabled'); err.data = { error: 'sync-disabled' }; throw err; }
    const origin = (root.location && root.location.origin) || ORIGIN;
    const fetchFn = config.fetch || fetch;
    let res;
    try {
      res = await fetchFn(functionUrl(config), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'apikey': config.anonKey,
          'authorization': 'Bearer ' + config.anonKey,
          'x-dogverb-request': '1'
        },
        body: JSON.stringify(Object.assign({ action: action, origin: origin }, data || {}))
      });
    } catch (e) {
      const err = new Error('network');
      err.network = true;
      throw err;
    }
    const body = await res.json().catch(function () { return {}; });
    if (body && body.error) { const err = new Error(body.error); err.status = res.status; err.data = body; throw err; }
    if (!res.ok) { const err = new Error('http'); err.status = res.status; err.data = body; throw err; }
    return body || {};
  }
  async function generateDevice() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const publicJwk = wire.publicJwkOnly(await crypto.subtle.exportKey('jwk', pair.publicKey));
    return { privateKey: pair.privateKey, publicJwk: publicJwk, fingerprint: await wire.fingerprintJwk(publicJwk) };
  }
  async function sign(privateKey, text) {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text));
    return wire.bytesToB64url(new Uint8Array(sig));
  }
  function bind(config) {
    const storageOf = function (opts) {
      return (opts && opts.storage) || (root.DogverbSync && root.DogverbSync.idbStorage ? root.DogverbSync.idbStorage() : null);
    };
    async function proof(session, purpose, extra) {
      const challenge = await invoke(config, 'challenge', { purpose: purpose });
      const signature = await sign(session.privateKey, wire.signText(purpose, challenge.nonce, session.fingerprint, extra || ''));
      return { nonce: challenge.nonce, signature: signature };
    }
    function adopt(session, tokens) {
      session.spaceId = tokens.spaceId;
      session.deviceId = tokens.deviceId;
      session.role = tokens.role || session.role;
      session.fingerprint = tokens.fingerprint || session.fingerprint;
      session.accessToken = tokens.accessToken;
      session.refreshToken = tokens.refreshToken;
      const ttl = Number(tokens.accessTtlMs);
      session.accessExpires = Date.now() + (ttl > 0 ? ttl : 5 * 60 * 1000);
    }
    function accessExpired(session, skewMs) {
      if (!session || !session.accessToken) return true;
      if (!session.accessExpires) return false;
      return Date.now() >= session.accessExpires - (typeof skewMs === 'number' ? skewMs : 15000);
    }
    async function refreshSession(session) {
      if (!session || !session.refreshToken || !session.privateKey) {
        const err = new Error('expired');
        err.data = { error: 'expired' };
        throw err;
      }
      const signed = await proof(session, 'refresh', '');
      const tokens = await invoke(config, 'refresh', Object.assign({ refreshToken: session.refreshToken }, signed));
      adopt(session, tokens);
      await persist(session);
      return session;
    }
    async function withAccess(session, run) {
      if (accessExpired(session)) await refreshSession(session);
      try {
        return await run();
      } catch (e) {
        if (e && e.data && e.data.error === 'expired') {
          await refreshSession(session);
          return await run();
        }
        throw e;
      }
    }
    const PAIR_TTL_MS = 5 * 60 * 1000;
    async function persist(session) {
      if (!session.storage) return;
      const rec = {
        url: config.url, spaceId: session.spaceId, deviceId: session.deviceId, role: session.role,
        refreshToken: session.refreshToken, publicJwk: session.publicJwk, fingerprint: session.fingerprint,
        privateKey: session.privateKey
      };
      if (session.pendingPairing && session.pairingId && !session.refreshToken) {
        rec.pendingPairing = 1;
        rec.pairingId = session.pairingId;
        rec.pendingPairingExpiresAt = session.pendingPairingExpiresAt;
      }
      await session.storage.set('supabase-device', rec);
    }
    async function clearPendingPairing(session) {
      if (!session) return;
      delete session.pendingPairing;
      delete session.pendingPairingExpiresAt;
      if (!session.storage) return;
      const saved = await session.storage.get('supabase-device');
      if (!saved || saved.pendingPairing !== 1) return;
      if (session.refreshToken || saved.refreshToken) {
        await persist(session);
        return;
      }
      await session.storage.set('supabase-device', {
        url: saved.url, publicJwk: saved.publicJwk, fingerprint: saved.fingerprint,
        privateKey: saved.privateKey, role: saved.role
      });
    }
    async function resumePendingPairing(opts) {
      const storage = storageOf(opts);
      if (!storage) return null;
      const saved = await storage.get('supabase-device');
      if (!saved || saved.url !== config.url || saved.pendingPairing !== 1 || !saved.pairingId || !saved.privateKey) return null;
      if (saved.refreshToken) return null;
      return {
        session: Object.assign({ storage: storage, server: 'supabase:' + config.url }, saved),
        expiresAt: Number(saved.pendingPairingExpiresAt) || 0,
        pairingId: saved.pairingId
      };
    }
    return {
      async createSpace(opts) {
        const device = await generateDevice();
        const challenge = await invoke(config, 'challenge', { purpose: 'create-space' });
        const signature = await sign(device.privateKey, wire.signText('create-space', challenge.nonce, device.fingerprint, ''));
        const recoverySecret = wire.randomToken(32);
        const created = await invoke(config, 'createSpace', {
          deviceName: (opts && opts.deviceName) || 'device', publicKey: device.publicJwk, fingerprint: device.fingerprint,
          nonce: challenge.nonce, signature: signature, recoveryHash: await wire.sha256Hex(recoverySecret)
        });
        const session = { storage: storageOf(opts), privateKey: device.privateKey, publicJwk: device.publicJwk, server: 'supabase:' + config.url };
        adopt(session, created);
        await persist(session);
        return { session: session, recoverySecret: recoverySecret };
      },
      async mintPairing(session) {
        return withAccess(session, async function () {
          const signed = await proof(session, 'mint-pair', '');
          return invoke(config, 'mint', Object.assign({ accessToken: session.accessToken }, signed));
        });
      },
      async submitPairing(opts) {
        const device = await generateDevice();
        const parsed = wire.parsePairingPayload(opts.payload || '');
        const code = parsed ? parsed.code : opts.code;
        const challenge = await invoke(config, 'challenge', { purpose: 'submit-pair' });
        const signature = await sign(device.privateKey, wire.signText('submit-pair', challenge.nonce, device.fingerprint, code));
        const submitted = await invoke(config, 'submit', {
          code: code, payload: opts.payload, publicKey: device.publicJwk, fingerprint: device.fingerprint,
          deviceName: opts.deviceName || 'new device', nonce: challenge.nonce, signature: signature
        });
        const expiresAt = Number(submitted.expiresAt) > 0 ? Number(submitted.expiresAt) : (Date.now() + PAIR_TTL_MS);
        const session = {
          storage: storageOf(opts), privateKey: device.privateKey, publicJwk: device.publicJwk,
          fingerprint: device.fingerprint, pairingId: submitted.pairingId, role: 'member',
          server: 'supabase:' + config.url,
          pendingPairing: 1, pendingPairingExpiresAt: expiresAt
        };
        await persist(session);
        return {
          fingerprint: submitted.fingerprint, status: submitted.status,
          session: session, expiresAt: expiresAt
        };
      },
      async confirmPairing(session, pairingId, fingerprint) {
        return withAccess(session, async function () {
          const signed = await proof(session, 'confirm-pair', pairingId);
          return invoke(config, 'confirm', Object.assign({ accessToken: session.accessToken, pairingId: pairingId, fingerprint: fingerprint }, signed));
        });
      },
      async claimPairing(session) {
        const signed = await proof(session, 'claim-pair', session.pairingId);
        const tokens = await invoke(config, 'claim', Object.assign({ pairingId: session.pairingId }, signed));
        adopt(session, tokens);
        await persist(session);
        return session;
      },
      async pushEvents(session, events) {
        const stored = (session.storage && (await session.storage.get('outbox'))) || [];
        const merged = [];
        const seen = {};
        (stored.concat(events || [])).forEach(function (item) {
          if (!item || !item.id || seen[item.id]) return;
          seen[item.id] = true;
          merged.push(item);
        });
        if (!merged.length) return { results: [] };
        try {
          return await withAccess(session, async function () {
            const signed = await proof(session, 'sync', '');
            const res = await invoke(config, 'push', Object.assign({ accessToken: session.accessToken, events: merged }, signed));
            if (session.storage) await session.storage.set('outbox', []);
            return res;
          });
        } catch (e) {
          if (e.network) {
            if (session.storage) await session.storage.set('outbox', merged);
            return { offline: true, queued: merged.length };
          }
          throw e;
        }
      },
      async pushLegacy(session, snapshot) {
        return withAccess(session, async function () {
          const signed = await proof(session, 'sync', '');
          return invoke(config, 'push', Object.assign({ accessToken: session.accessToken, legacy: snapshot, events: [] }, signed));
        });
      },
      async pull(session) {
        return withAccess(session, function () {
          return invoke(config, 'pull', { accessToken: session.accessToken });
        });
      },
      async pendingPairings(session) {
        return withAccess(session, function () {
          return invoke(config, 'pending', { accessToken: session.accessToken });
        });
      },
      async revokeDevice(session, deviceId) {
        return withAccess(session, async function () {
          const signed = await proof(session, 'revoke', deviceId);
          return invoke(config, 'revoke', Object.assign({ accessToken: session.accessToken, deviceId: deviceId }, signed));
        });
      },
      async recover(opts) {
        const device = await generateDevice();
        const challenge = await invoke(config, 'challenge', { purpose: 'recover' });
        const signature = await sign(device.privateKey, wire.signText('recover', challenge.nonce, device.fingerprint, ''));
        const tokens = await invoke(config, 'recover', {
          recoverySecret: opts.recoverySecret, publicKey: device.publicJwk, fingerprint: device.fingerprint,
          deviceName: opts.deviceName || 'recovered', nonce: challenge.nonce, signature: signature
        });
        const session = { storage: storageOf(opts), privateKey: device.privateKey, publicJwk: device.publicJwk, server: 'supabase:' + config.url };
        adopt(session, tokens);
        await persist(session);
        return { session: session };
      },
      async resume(opts) {
        const saved = await opts.storage.get('supabase-device');
        if (!saved || saved.url !== config.url || !saved.refreshToken || !saved.privateKey) return null;
        const session = Object.assign({ storage: opts.storage, server: 'supabase:' + config.url }, saved);
        const signed = await proof(session, 'refresh', '');
        const tokens = await invoke(config, 'refresh', Object.assign({ refreshToken: session.refreshToken }, signed));
        adopt(session, tokens);
        await persist(session);
        return session;
      },
      accessExpired: accessExpired,
      refreshSession: refreshSession,
      resumePendingPairing: resumePendingPairing,
      clearPendingPairing: clearPendingPairing
    };
  }
  const api = { bind: bind, disabled: disabled, PROJECT_URL: PROJECT_URL, ORIGIN: ORIGIN, PAIR_TTL_MS: 5 * 60 * 1000 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DogverbSupabase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
