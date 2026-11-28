/* Dog Verb shell cache. Install identity stays app-v18. Quote-card assets stay at v=22. Etymology data stays at ?v=31. Study-card sense list and typography stay at ?v=32. Shell query is v=37 on this preview branch only: after a successful join/pull apply, the client enqueues and flushes the local-only extras (the post-merge gap against the cloud snapshot) so the union can reach the cloud and the host; plus the earlier P0 flush, pending-pairing, and arming fixes. Official Pages is at v=35 / dog-verb-shell-v35 until this change ships. Do not open production ?v=37; GitHub Pages only deploys main. Fetch handling is unchanged. */
const CACHE = 'dog-verb-shell-v37';
const SHELL = [
  './index.html',
  './style.css?v=32',
  './app.js?v=36',
  './core.js?v=32',
  './sync-wire.js?v=33',
  './sync-client.js?v=33',
  './sync-prep.js?v=34',
  './supabase/client-adapter.js?v=36',
  './sync-config.js?v=33',
  './sync-app.js?v=37',
  './data/books-index.js?v=31',
  './data/book-ielts.js',
  './data/book-kaoyan.js',
  './data/book-anatomy.js',
  './data/example-zh.js?v=31',
  './data/etymology.js?v=31',
  './data/senses.js?v=32',
  './data/t2s.js?v=22',
  './vendor/ts-fsrs.umd.js',
  './assets/dog-mascot.png?v=15',
  './assets/dog-mascot-transparent.png?v=22',
  './assets/paw.svg?v=15',
  './assets/paw-check-128.png',
  './assets/icons/logo-doubao-2048.png?v=22',
  './assets/fonts/inria-serif-italic.woff2?v=22',
  './assets/fonts/noto-serif-sc-regular.woff2?v=22',
  './assets/fonts/noto-sans-sc-regular.woff2?v=22',
  './assets/fonts/nunito-wght.woff2?v=32',
  './assets/fonts/lxgw-wenkai-regular.woff2?v=32',
  './assets/fonts/lxgw-wenkai-medium.woff2?v=32',
  './assets/landscapes/wallabi-beach.jpg?v=22',
  './assets/landscapes/kubota-garden-seattle.jpg?v=22',
  './assets/landscapes/lyon-riverside-terrace.jpg?v=22',
  './assets/icons/install-v18/apple-180.png?v=18',
  './assets/icons/install-v18/favicon-48.png?v=18',
  './assets/icons/install-v18/icon-192.png?v=18',
  './assets/icons/install-v18/icon-512.png?v=18',
  './assets/icons/install-v18/maskable-192.png?v=18',
  './assets/icons/install-v18/maskable-512.png?v=18',
  './manifest.webmanifest?v=18'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.indexOf('/assets/icons/') !== -1 && url.pathname.indexOf('/install-v18/') === -1 && url.pathname.indexOf('/logo-doubao-2048.png') === -1) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).catch(() => {
    if (event.request.mode === 'navigate') return caches.match('./index.html');
  })));
});
