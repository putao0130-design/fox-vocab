// Service worker navigation: network-first, 3s timeout, cache: 'no-cache', update cached index.html.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadSw(opts) {
  opts = opts || {};
  const listeners = {};
  const pages = Object.create(null);
  if (opts.cachedIndex != null) pages['./index.html'] = opts.cachedIndex;
  const puts = [];
  const fetchCalls = [];
  const timeouts = [];
  let tid = 0;
  const cache = {
    addAll: async function () {},
    put: async function (req, res) {
      const key = typeof req === 'string' ? req : (req && req.url) || '';
      const body = res && (res.bodyText != null ? res.bodyText : (res._body != null ? res._body : String(res)));
      pages[key] = body;
      puts.push({ key: key, body: body });
    },
    match: async function (req) {
      const key = typeof req === 'string' ? req : (req && req.url) || '';
      if (Object.prototype.hasOwnProperty.call(pages, key)) return makeResponse(pages[key], 200);
      return undefined;
    }
  };
  let fetchImpl = opts.fetch || async function () { throw new Error('network'); };
  const self = {
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting: function () {},
    clients: { claim: async function () {} }
  };
  const caches = {
    open: async function () { return cache; },
    match: async function (req) { return cache.match(req); },
    keys: async function () { return []; },
    delete: async function () { return true; }
  };
  function fetch(req, init) {
    fetchCalls.push({ req: req, init: init });
    return fetchImpl(req, init);
  }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), {
    self: self, caches: caches, fetch: fetch, URL: URL, Promise: Promise,
    Object: Object, Array: Array, String: String, Error: Error,
    setTimeout: function (fn, ms) {
      const id = ++tid;
      timeouts.push({ id: id, fn: fn, ms: ms });
      return id;
    },
    clearTimeout: function (id) {
      for (let i = timeouts.length - 1; i >= 0; i--) if (timeouts[i].id === id) timeouts.splice(i, 1);
    },
    undefined: undefined, console: console
  }, { filename: 'sw.js' });
  return {
    listeners: listeners, pages: pages, puts: puts, fetchCalls: fetchCalls, timeouts: timeouts,
    setFetch: function (fn) { fetchImpl = fn; },
    runTimeouts: function (maxMs) {
      const due = timeouts.filter(function (t) { return t.ms <= maxMs; });
      due.forEach(function (t) {
        const i = timeouts.indexOf(t);
        if (i >= 0) timeouts.splice(i, 1);
        t.fn();
      });
    },
    dispatchFetch: function (request) {
      let pending = null;
      const event = {
        request: request,
        respondWith: function (p) { pending = Promise.resolve(p); }
      };
      (listeners.fetch || []).forEach(function (fn) { fn(event); });
      return pending;
    }
  };
}

function makeResponse(body, status) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    bodyText: body,
    clone: function () { return makeResponse(body, status); },
    text: async function () { return body; }
  };
}

function navigateRequest() {
  return { method: 'GET', mode: 'navigate', url: 'https://example.test/fox-vocab/' };
}

async function testNavigateSuccessReturnsNetworkAndUpdatesCachedIndex() {
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(async function () { return makeResponse('NEW_INDEX', 200); });
  const res = await sw.dispatchFetch(navigateRequest());
  assert.ok(res, 'navigate must respond');
  assert.strictEqual(await res.text(), 'NEW_INDEX', 'successful navigate must serve the network body, not the stale cache');
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(sw.pages['./index.html'], 'NEW_INDEX', 'successful navigate must update the cached ./index.html');
}

async function testNavigateFailureFallsBackToCachedIndex() {
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(async function () { throw new Error('offline'); });
  const res = await sw.dispatchFetch(navigateRequest());
  assert.ok(res, 'failed navigate must fall back to a cached response');
  assert.strictEqual(await res.text(), 'OLD_INDEX', 'failed navigate must return caches.match("./index.html")');
  assert.strictEqual(sw.puts.length, 0, 'failed navigate must not overwrite the cached index');
}

async function testNavigateTimeoutReturnsOldCacheFirst() {
  let resolveFetch;
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(function () {
    return new Promise(function (resolve) { resolveFetch = resolve; });
  });
  const pending = sw.dispatchFetch(navigateRequest());
  const scheduled = sw.timeouts.filter(function (t) { return t.ms === 3000; });
  assert.strictEqual(scheduled.length, 1, 'navigate fetch must race a 3-second timeout');
  sw.runTimeouts(3000);
  const res = await pending;
  assert.ok(res, 'timed-out navigate must respond from cache');
  assert.strictEqual(await res.text(), 'OLD_INDEX', 'timeout must return the old cached ./index.html first');
  assert.strictEqual(sw.pages['./index.html'], 'OLD_INDEX');
  // Keep the hanging fetch so the later-update test can share this pattern; resolve is unused here.
  if (typeof resolveFetch === 'function') { /* leave pending */ }
}

async function testNavigateLateNetworkStillUpdatesCache() {
  let resolveFetch;
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(function () {
    return new Promise(function (resolve) { resolveFetch = resolve; });
  });
  const pending = sw.dispatchFetch(navigateRequest());
  sw.runTimeouts(3000);
  const res = await pending;
  assert.strictEqual(await res.text(), 'OLD_INDEX', 'timeout must return the old cache first');
  resolveFetch(makeResponse('NEW_INDEX', 200));
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(sw.pages['./index.html'], 'NEW_INDEX', 'a later successful network response must still update the cached ./index.html');
}

async function testNavigateFetchUsesNoCache() {
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(async function () { return makeResponse('NEW_INDEX', 200); });
  await sw.dispatchFetch(navigateRequest());
  assert.ok(sw.fetchCalls.length >= 1, 'navigate must call fetch');
  assert.strictEqual(sw.fetchCalls[0].init && sw.fetchCalls[0].init.cache, 'no-cache');
}

(async function main() {
  await testNavigateSuccessReturnsNetworkAndUpdatesCachedIndex();
  await testNavigateFailureFallsBackToCachedIndex();
  await testNavigateTimeoutReturnsOldCacheFirst();
  await testNavigateLateNetworkStillUpdatesCache();
  await testNavigateFetchUsesNoCache();
  console.log('ok ' + module.filename);
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
