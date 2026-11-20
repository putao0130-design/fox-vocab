// Browser-side CloudBase transport. It does not embed an env id or a secret.
// Writes happen only when the page sets DOGVERB_SYNC_CONFIG.envId and supplies callFunction.
(function (root) {
  const wire = root.DogverbWire || (typeof require === 'function' ? require('../sync-wire.js') : null);
  const ENV_RE = /^[A-Za-z0-9-]{4,64}$/;
  const ORIGIN = 'https://putao0130-design.github.io';

  function disabled(config) {
    return !config || !config.envId || !ENV_RE.test(String(config.envId));
  }
  async function invoke(config, action, data) {
    if (disabled(config)) { const err = new Error('sync-disabled'); err.data = { error: 'sync-disabled' }; throw err; }
    if (typeof config.callFunction !== 'function') { const err = new Error('cloudbase-sdk-missing'); err.data = { error: 'cloudbase-sdk-missing' }; throw err; }
    const origin = (root.location && root.location.origin) || ORIGIN;
    const res = await config.callFunction({ name: 'dogverb-sync', data: Object.assign({ action: action, origin: origin }, data || {}) });
    const body = res && (res.result || res);
    if (body && body.error) { const err = new Error(body.error); err.data = body; throw err; }
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
    const storageOf = function (opts) { return (opts && opts.storage) || (root.DogverbSync && root.DogverbSync.idbStorage ? root.DogverbSync.idbStorage() : null); };
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
    }
    async function persist(session) {
      if (!session.storage) return;
      await session.storage.set('cloudbase-device', { envId: config.envId, spaceId: session.spaceId, deviceId: session.deviceId, role: session.role, refreshToken: session.refreshToken, publicJwk: session.publicJwk, fingerprint: session.fingerprint, privateKey: session.privateKey });
    }
    return {
      async createSpace(opts) {
        const device = await generateDevice();
        const challenge = await invoke(config, 'challenge', { purpose: 'create-space' });
        const signature = await sign(device.privateKey, wire.signText('create-space', challenge.nonce, device.fingerprint, ''));
        const recoverySecret = wire.randomToken(32);
        const created = await invoke(config, 'createSpace', { deviceName: opts.deviceName || 'device', publicKey: device.publicJwk, fingerprint: device.fingerprint, nonce: challenge.nonce, signature: signature, recoveryHash: await wire.sha256Hex(recoverySecret) });
        const session = { storage: storageOf(opts), privateKey: device.privateKey, publicJwk: device.publicJwk, server: 'cloudbase:' + config.envId };
        adopt(session, created);
        await persist(session);
        return { session: session, recoverySecret: recoverySecret };
      },
      async mintPairing(session) {
        const signed = await proof(session, 'mint-pair', '');
        return invoke(config, 'mint', Object.assign({ accessToken: session.accessToken }, signed));
      },
      async submitPairing(opts) {
        const device = await generateDevice();
        const parsed = wire.parsePairingPayload(opts.payload || '');
        const code = parsed ? parsed.code : opts.code;
        const challenge = await invoke(config, 'challenge', { purpose: 'submit-pair' });
        const signature = await sign(device.privateKey, wire.signText('submit-pair', challenge.nonce, device.fingerprint, code));
        const submitted = await invoke(config, 'submit', { code: code, payload: opts.payload, publicKey: device.publicJwk, fingerprint: device.fingerprint, deviceName: opts.deviceName || 'new device', nonce: challenge.nonce, signature: signature });
        return { fingerprint: submitted.fingerprint, status: submitted.status, session: { storage: storageOf(opts), privateKey: device.privateKey, publicJwk: device.publicJwk, fingerprint: device.fingerprint, pairingId: submitted.pairingId, role: 'member', server: 'cloudbase:' + config.envId } };
      },
      async confirmPairing(session, pairingId, fingerprint) {
        const signed = await proof(session, 'confirm-pair', pairingId);
        return invoke(config, 'confirm', Object.assign({ accessToken: session.accessToken, pairingId: pairingId, fingerprint: fingerprint }, signed));
      },
      async claimPairing(session) {
        const signed = await proof(session, 'claim-pair', session.pairingId);
        const tokens = await invoke(config, 'claim', Object.assign({ pairingId: session.pairingId }, signed));
        adopt(session, tokens);
        await persist(session);
        return session;
      },
      async pushEvents(session, events) {
        const signed = await proof(session, 'sync', '');
        return invoke(config, 'push', Object.assign({ accessToken: session.accessToken, events: events || [] }, signed));
      },
      async pushLegacy(session, snapshot) {
        const signed = await proof(session, 'sync', '');
        return invoke(config, 'push', Object.assign({ accessToken: session.accessToken, legacy: snapshot, events: [] }, signed));
      },
      async pull(session) {
        return invoke(config, 'pull', { accessToken: session.accessToken });
      },
      async pendingPairings(session) {
        return invoke(config, 'pending', { accessToken: session.accessToken });
      },
      async revokeDevice(session, deviceId) {
        const signed = await proof(session, 'revoke', deviceId);
        return invoke(config, 'revoke', Object.assign({ accessToken: session.accessToken, deviceId: deviceId }, signed));
      },
      async recover(opts) {
        const device = await generateDevice();
        const challenge = await invoke(config, 'challenge', { purpose: 'recover' });
        const signature = await sign(device.privateKey, wire.signText('recover', challenge.nonce, device.fingerprint, ''));
        const tokens = await invoke(config, 'recover', { recoverySecret: opts.recoverySecret, publicKey: device.publicJwk, fingerprint: device.fingerprint, deviceName: opts.deviceName || 'recovered', nonce: challenge.nonce, signature: signature });
        const session = { storage: storageOf(opts), privateKey: device.privateKey, publicJwk: device.publicJwk, server: 'cloudbase:' + config.envId };
        adopt(session, tokens);
        await persist(session);
        return { session: session };
      },
      async resume(opts) {
        const saved = await opts.storage.get('cloudbase-device');
        if (!saved || saved.envId !== config.envId || !saved.refreshToken || !saved.privateKey) return null;
        const session = Object.assign({ storage: opts.storage, server: 'cloudbase:' + config.envId }, saved);
        const signed = await proof(session, 'refresh', '');
        const tokens = await invoke(config, 'refresh', Object.assign({ refreshToken: session.refreshToken }, signed));
        adopt(session, tokens);
        await persist(session);
        return session;
      }
    };
  }
  const api = { bind: bind, disabled: disabled, ORIGIN: ORIGIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DogverbCloudBase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
