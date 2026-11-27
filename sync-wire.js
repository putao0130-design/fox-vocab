// Shared pairing bytes. No tokens, no network, no learning state.
// A pairing payload is not a URL and does not grant progress.
(function (root) {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  function bytesToB64url(bytes) {
    let bin = '';
    const list = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < list.length; i++) bin += String.fromCharCode(list[i]);
    const b64 = (typeof btoa === 'function' ? btoa(bin) : Buffer.from(list).toString('base64'));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function b64urlToBytes(text) {
    const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + pad;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }
  function randomToken(bytes) { return bytesToB64url(randomBytes(bytes || 32)); }
  function pairingCode() {
    const raw = randomBytes(16);
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += CROCKFORD[raw[i] & 31];
      if (i === 3 || i === 7 || i === 11) out += '-';
    }
    return out;
  }
  function pairingPayload(pairingId, code) {
    return 'dogverb-pair:v1:' + pairingId + '.' + code;
  }
  function parsePairingPayload(text) {
    const s = String(text || '');
    if (s.indexOf('http://') === 0 || s.indexOf('https://') === 0) return null;
    const m = /^dogverb-pair:v1:([A-Za-z0-9_-]+)\.([0-9A-HJKMNP-TV-Z-]+)$/.exec(s);
    if (!m) return null;
    return { pairingId: m[1], code: m[2] };
  }
  function canonicalJwk(jwk) {
    return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  }
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }
  async function fingerprintJwk(jwk) { return sha256Hex(canonicalJwk(jwk)); }
  function signText(purpose, nonce, fingerprint, extra) {
    return ['dogverb', '1', purpose, nonce, fingerprint || '', extra || ''].join('\n');
  }
  function publicJwkOnly(jwk) {
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) return null;
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, alg: 'ES256', ext: true, key_ops: ['verify'] };
  }

  const api = {
    bytesToB64url: bytesToB64url, b64urlToBytes: b64urlToBytes, randomToken: randomToken,
    pairingCode: pairingCode, pairingPayload: pairingPayload, parsePairingPayload: parsePairingPayload,
    canonicalJwk: canonicalJwk, sha256Hex: sha256Hex, fingerprintJwk: fingerprintJwk,
    signText: signText, publicJwkOnly: publicJwkOnly
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DogverbWire = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
