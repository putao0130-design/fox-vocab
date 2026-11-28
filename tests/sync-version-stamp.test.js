// Settings 「跨设备同步」 card version stamp: script query string + local ON flag.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const adapter = require('../supabase/client-adapter.js');

const ROOT = path.join(__dirname, '..');
const ON = 'foxVocab.syncOn';
const KEY = 'foxVocab.v2';
const PROJECT_URL = adapter.PROJECT_URL;
const FAKE_ANON = 'anon-public-test-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function memoryLocalStorage() {
  const m = Object.create(null);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }
  };
}

function boot(opts) {
  opts = opts || {};
  const localStorage = memoryLocalStorage();
  if (opts.syncOn) localStorage.setItem(ON, '1');
  localStorage.setItem(KEY, JSON.stringify({ v: 2, books: {}, customBooks: [], days: {}, studyDays: [], fox: {} }));
  const byId = Object.create(null);
  function parseIds(html) {
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const id = m[1];
      const open = html.indexOf('>', m.index);
      const close = html.indexOf('</', open);
      const text = close > open ? html.slice(open + 1, close) : '';
      const node = byId[id] || { id: id, textContent: '', value: '', style: {}, onclick: null, addEventListener: function () {}, blur: function () {} };
      node.textContent = text;
      byId[id] = node;
    }
  }
  const slot = {
    id: 'sync-slot',
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) { this._html = String(html); parseIds(html); }
  };
  byId['sync-slot'] = slot;
  const script = { src: opts.scriptSrc || 'sync-app.js?v=42', tagName: 'SCRIPT', getAttribute: function (n) { return n === 'src' ? this.src : null; } };
  const document = {
    currentScript: opts.useCurrentScript === false ? null : script,
    body: { tagName: 'BODY' },
    visibilityState: 'visible',
    get activeElement() { return document.body; },
    getElementById: function (id) { return byId[id] || null; },
    getElementsByTagName: function (tag) { return String(tag).toLowerCase() === 'script' ? [script] : []; },
    querySelector: function (sel) {
      if (sel && sel.indexOf('sync-app') !== -1) return script;
      return null;
    },
    addEventListener: function () {}
  };
  const ctx = {
    console: console,
    Date: Date, JSON: JSON, Object: Object, Array: Array, Number: Number,
    String: String, Math: Math, Error: Error, Boolean: Boolean, Promise: Promise,
    parseInt: parseInt, isFinite: isFinite, decodeURIComponent: decodeURIComponent,
    URL: URL, NaN: NaN, undefined: undefined,
    setTimeout: function (fn) { return 1; },
    clearTimeout: function () {},
    setInterval: function () { return 1; },
    clearInterval: function () {},
    localStorage: localStorage,
    document: document,
    VocabSyncPrep: require('../sync-prep.js'),
    DogverbSync: { idbStorage: function () { return { get: async function () { return null; }, set: async function () {} }; } },
    DogverbSupabase: { disabled: function () { return false; }, bind: function () { return {}; } },
    __dogverbReadState: function () { return { v: 2, books: {}, customBooks: [], days: {}, studyDays: [], fox: {} }; },
    __dogverbApplyRemote: function () { return { applied: true }; }
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  if (!opts.noCfg) ctx.DOGVERB_SYNC_CONFIG = { url: PROJECT_URL, anonKey: FAKE_ANON };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sync-app.js'), 'utf8'), ctx, { filename: 'sync-app.js' });
  return {
    ctx: ctx, localStorage: localStorage, document: document, script: script,
    stamp: function () { const el = document.getElementById('sync-build'); return el ? el.textContent : ''; },
    mount: function () { ctx.DogverbAppSync.mount(); }
  };
}

function testStampReadsQueryStringAndReportsDisabled() {
  const env = boot({ scriptSrc: 'https://example.test/fox-vocab/sync-app.js?v=42', syncOn: false });
  env.mount();
  assert.strictEqual(env.stamp(), '脚本 v=42 / 数据 未开启');
}

function testStampReadsQueryStringAndReportsEnabled() {
  const env = boot({ scriptSrc: 'sync-app.js?v=42', syncOn: true });
  env.mount();
  assert.strictEqual(env.stamp(), '脚本 v=42 / 数据 已开启');
}

function testStampFallsBackToScriptSrcSelector() {
  const env = boot({ scriptSrc: 'assets/sync-app.js?v=42&cache=1', useCurrentScript: false, syncOn: false });
  env.mount();
  assert.strictEqual(env.stamp(), '脚本 v=42 / 数据 未开启');
}

function testStampIsNonEmptyWhenConfigMissing() {
  const env = boot({ scriptSrc: 'sync-app.js?v=42', syncOn: false, noCfg: true });
  env.mount();
  const text = env.stamp();
  assert.ok(text && text.length, 'under !cfg() the version stamp must be non-empty');
  assert.strictEqual(text, '脚本 v=42 / 数据 未开启');
}

function main() {
  testStampReadsQueryStringAndReportsDisabled();
  testStampReadsQueryStringAndReportsEnabled();
  testStampFallsBackToScriptSrcSelector();
  testStampIsNonEmptyWhenConfigMissing();
  console.log('ok ' + module.filename);
}
main();
