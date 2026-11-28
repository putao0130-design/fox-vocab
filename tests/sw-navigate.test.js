// Service worker navigation: network-first, update cached index.html, fall back on failure.
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
  function fetch(req) { return fetchImpl(req); }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), {
    self: self, caches: caches, fetch: fetch, URL: URL, Promise: Promise,
    Object: Object, Array: Array, String: String, Error: Error,
    undefined: undefined, console: console
  }, { filename: 'sw.js' });
  return {
    listeners: listeners, pages: pages, puts: puts,
    setFetch: function (fn) { fetchImpl = fn; },
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
  const res = {
    ok: status >= 200 && status < 300,
    status: status,
    bodyText: body,
    clone: function () { return makeResponse(body, status); },
    text: async function () { return body; }
  };
  return res;
}

async function testNavigateSuccessReturnsNetworkAndUpdatesCachedIndex() {
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(async function () { return makeResponse('NEW_INDEX', 200); });
  const res = await sw.dispatchFetch({
    method: 'GET',
    mode: 'navigate',
    url: 'https://example.test/fox-vocab/'
  });
  assert.ok(res, 'navigate must respond');
  assert.strictEqual(await res.text(), 'NEW_INDEX', 'successful navigate must serve the network body, not the stale cache');
  // cache.put is async and not awaited by the handler; wait a tick
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(sw.pages['./index.html'], 'NEW_INDEX', 'successful navigate must update the cached ./index.html');
}

async function testNavigateFailureFallsBackToCachedIndex() {
  const sw = loadSw({ cachedIndex: 'OLD_INDEX' });
  sw.setFetch(async function () { throw new Error('offline'); });
  const res = await sw.dispatchFetch({
    method: 'GET',
    mode: 'navigate',
    url: 'https://example.test/fox-vocab/'
  });
  assert.ok(res, 'failed navigate must fall back to a cached response');
  assert.strictEqual(await res.text(), 'OLD_INDEX', 'failed navigate must return caches.match("./index.html")');
  assert.strictEqual(sw.puts.length, 0, 'failed navigate must not overwrite the cached index');
}

(async function main() {
  await testNavigateSuccessReturnsNetworkAndUpdatesCachedIndex();
  await testNavigateFailureFallsBackToCachedIndex();
  console.log('ok ' + module.filename);
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
