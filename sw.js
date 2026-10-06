/* Volleydesk – funzionamento senza rete.
   Cambiare VERSION a ogni pubblicazione: l'app proporrà "Aggiorna". */
const VERSION = 'v4-2026-10-06';
const CACHE = 'volleydesk-shell-' + VERSION;
const SHELL = ['./', 'index.html', 'store.js', 'sync.js', 'societa.js', 'societa.css', 'accessi.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('volleydesk-shell-') && k !== CACHE) await caches.delete(k);   // solo le cache di Volleydesk: Volleysched può stare sullo stesso sito
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // GitHub e il resto: sempre in rete
  if (url.searchParams.has('fresh')) return;   // controllo della versione online: sempre dalla rete
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
