const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { createReferenceServer } = require('../sync-server.js');

const CHROME = '/usr/bin/google-chrome-stable';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function getJson(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      let body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve(JSON.parse(body)); });
    }).on('error', reject);
  });
}
function connect(url) {
  const parsed = new URL(url);
  return new Promise(function (resolve, reject) {
    const socket = net.connect(parsed.port, parsed.hostname);
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    socket.on('error', reject);
    socket.on('data', function (chunk) {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buf.slice(0, headerEnd).toString();
      if (header.indexOf('101') < 0) { reject(new Error('websocket')); return; }
      const rest = buf.slice(headerEnd + 4);
      const frames = [];
      let pending = rest;
      const api = {
        send: function (obj) {
          const data = Buffer.from(JSON.stringify(obj));
          const mask = crypto.randomBytes(4);
          let head;
          if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
          else head = Buffer.concat([Buffer.from([0x81, 0x80 | 126]), Buffer.from([(data.length >> 8) & 255, data.length & 255])]);
          const masked = Buffer.alloc(data.length);
          for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
          socket.write(Buffer.concat([head, mask, masked]));
        },
        next: function () {
          if (frames.length) return Promise.resolve(frames.shift());
          return new Promise(function (res) { api._wait = res; });
        },
        close: function () { socket.end(); }
      };
      socket.removeAllListeners('data');
      pending = rest;
      socket.on('data', function (chunk) { pending = Buffer.concat([pending, chunk]); readFrames(); });
      function readFrames() {
        while (pending.length >= 2) {
          const b0 = pending[0]; const b1 = pending[1];
          let len = b1 & 127; let start = 2;
          if (len === 126) { if (pending.length < 4) return; len = pending.readUInt16BE(2); start = 4; }
          else if (len === 127) { if (pending.length < 10) return; len = Number(pending.readBigUInt64BE(2)); start = 10; }
          if (pending.length < start + len) return;
          const payload = pending.slice(start, start + len);
          pending = pending.slice(start + len);
          if ((b0 & 15) === 1) {
            const msg = JSON.parse(payload.toString());
            if (api._wait) { const wait = api._wait; api._wait = null; wait(msg); }
            else frames.push(msg);
          }
        }
      }
      readFrames();
      resolve(api);
    });
    socket.write('GET ' + parsed.pathname + ' HTTP/1.1\r\nHost: ' + parsed.host + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
}

async function browser(port, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--user-data-dir=' + dir, '--remote-debugging-port=' + String(port), '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await getJson('http://127.0.0.1:' + port + '/json/version'); break; }
    catch (e) { await sleep(50); }
  }
  if (!version) throw new Error('chrome did not start');
  const ws = await connect(version.webSocketDebuggerUrl);
  let id = 0;
  async function call(method, params, sessionId) {
    const msgId = ++id;
    ws.send({ id: msgId, method: method, params: params || {}, sessionId: sessionId });
    for (;;) {
      const msg = await ws.next();
      if (msg.id === msgId) return msg;
    }
  }
  const created = await call('Target.createTarget', { url: 'about:blank' });
  const attached = await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true });
  const sessionId = attached.result.sessionId;
  async function page(method, params) { return call(method, params, sessionId); }
  await page('Page.enable');
  await page('Runtime.enable');
  return {
    proc: proc, dir: dir, ws: ws,
    async open(url) {
      await page('Page.navigate', { url: url });
      for (let i = 0; i < 40; i++) {
        const ready = await page('Runtime.evaluate', { expression: 'typeof DogverbSync', returnByValue: true });
        if (ready.result && ready.result.result && ready.result.result.value === 'object') return;
        await sleep(50);
      }
      throw new Error('harness did not load');
    },
    async eval(expression) {
      const out = await page('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
      if (out.result && out.result.exceptionDetails) throw new Error(out.result.exceptionDetails.text || 'eval');
      return out.result.result.value;
    },
    async close() {
      proc.kill('SIGKILL'); ws.close();
      await sleep(300);
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* chrome may still be releasing the profile */ }
    }
  };
}

(async function () {
  const dbPath = path.join(os.tmpdir(), 'dogverb-browser-' + process.pid + '.sqlite');
  fs.rmSync(dbPath, { force: true });
  const srv = createReferenceServer({ dbPath: dbPath, log: function () {} });
  const url = await srv.listen(0);
  const phone = await browser(9431, path.join(os.tmpdir(), 'dogverb-phone-' + process.pid));
  const desktop = await browser(9432, path.join(os.tmpdir(), 'dogverb-pwa-' + process.pid));
  try {
    await phone.open(url + '/harness.html');
    await desktop.open(url + '/harness.html');
    const created = await phone.eval(`(async () => {
      const made = await DogverbSync.createSpace({ server: location.origin, deviceName: 'phone browser', storage: DogverbSync.idbStorage() });
      window.__session = made.session;
      localStorage.setItem('profile-sentinel', 'mobile-browser');
      const leaked = JSON.stringify(localStorage).indexOf(made.session.refreshToken) >= 0 || JSON.stringify(localStorage).indexOf(made.recoverySecret) >= 0;
      const recoveryLen = made.recoverySecret.length;
      made.recoverySecret = '';
      return { recoveryLen: recoveryLen, leaked: leaked, locked: await DogverbSync.privateKeyExportFails(made.session) };
    })()`);
    assert.ok(created.recoveryLen >= 43);
    assert.strictEqual(created.leaked, false);
    assert.strictEqual(created.locked, true);
    const otherStore = await desktop.eval(`({ sentinel: localStorage.getItem('profile-sentinel'), sync: typeof DogverbSync })`);
    assert.strictEqual(otherStore.sentinel, null);
    assert.strictEqual(otherStore.sync, 'object');
    const minted = await phone.eval(`DogverbSync.mintPairing(window.__session)`);
    const payload = JSON.stringify(minted.payload);
    const joined = await desktop.eval(`(async () => {
      const pending = await DogverbSync.submitPairing({ server: location.origin, payload: ${payload}, deviceName: 'installed pwa', storage: DogverbSync.idbStorage() });
      window.__session = pending.session;
      localStorage.setItem('profile-sentinel', 'installed-pwa');
      return { fingerprint: pending.fingerprint, pairingId: pending.session.pairingId };
    })()`);
    assert.notStrictEqual(await phone.eval(`localStorage.getItem('profile-sentinel')`), 'installed-pwa');
    await phone.eval(`DogverbSync.confirmPairing(window.__session, ${JSON.stringify(joined.pairingId)}, ${JSON.stringify(joined.fingerprint)})`);
    await desktop.eval(`DogverbSync.claimPairing(window.__session)`);
    await phone.eval(`DogverbSync.pushLegacy(window.__session, { v: 2, bookId: 'ielts-toefl-core', settings: { dailyNew: 20, autoPlay: true }, books: { 'ielts-toefl-core': { cards: { analyse: { due: 2000, stability: 2, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: 1000, learnedAt: 1, mastered: false, masteredAt: null } } } }, customBooks: [], days: { '2026-11-01': { new: 2, review: 1, correct: 1, wrong: 0 } }, studyDays: ['2026-11-01'], fox: { food: 1, xp: 1, fed: 0, hunger: 90, name: '豆豆' } })`);
    const seen = await desktop.eval(`(async () => {
      const view = await DogverbSync.pull(window.__session);
      return { reps: view.state.books['ielts-toefl-core'].cards.analyse.reps, production: view.production, sentinel: localStorage.getItem('profile-sentinel') };
    })()`);
    assert.strictEqual(seen.reps, 2);
    assert.strictEqual(seen.production, false);
    assert.strictEqual(seen.sentinel, 'installed-pwa');
    const offline = await phone.eval(`(async () => {
      const real = window.__session.server;
      window.__session.server = 'http://127.0.0.1:9';
      const queued = await DogverbSync.pushEvents(window.__session, [{ id: 'browser-grade', type: 'grade', bookId: 'ielts-toefl-core', word: 'analyse', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' }]);
      window.__session.server = real;
      const flushed = await DogverbSync.pushEvents(window.__session, []);
      const again = await DogverbSync.pushEvents(window.__session, [{ id: 'browser-grade', type: 'grade', bookId: 'ielts-toefl-core', word: 'analyse', rating: 3, productDay: '2026-11-20', dayZone: 'Asia/Shanghai' }]);
      return { queued: queued.queued, consumed: flushed.results.some(row => row.id === 'browser-grade' && row.consumed), duplicate: again.results.some(row => row.id === 'browser-grade' && row.noop) };
    })()`);
    assert.strictEqual(offline.queued, 1);
    assert.strictEqual(offline.consumed, true);
    assert.strictEqual(offline.duplicate, true);
    const deviceId = await desktop.eval(`window.__session.deviceId`);
    await phone.eval(`DogverbSync.revokeDevice(window.__session, ${JSON.stringify(deviceId)})`);
    const blocked = await desktop.eval(`DogverbSync.pull(window.__session).then(() => 'allowed', err => err.data && err.data.error)`);
    assert.strictEqual(blocked, 'unauthorized');
    await phone.open(url + '/harness.html');
    const resumed = await phone.eval(`(async () => {
      window.__session = await DogverbSync.resume({ server: location.origin, storage: DogverbSync.idbStorage() });
      const view = await DogverbSync.pull(window.__session);
      return { reps: view.state.books['ielts-toefl-core'].cards.analyse.reps, sentinel: localStorage.getItem('profile-sentinel'), review: view.state.days['Asia/Shanghai|2026-11-20'].review };
    })()`);
    assert.strictEqual(resumed.reps >= 2, true);
    assert.strictEqual(resumed.review, 1);
    assert.strictEqual(resumed.sentinel, 'mobile-browser');
    console.log('sync-browser tests ok');
  } finally {
    await phone.close();
    await desktop.close();
    await srv.close();
    fs.rmSync(dbPath, { force: true });
  }
})().catch(function (err) { console.error(err); process.exit(1); });
