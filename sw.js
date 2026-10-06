/* Volleydesk – funzionamento senza rete.
   Cambiare VERSION a ogni pubblicazione: l'app proporrà "Aggiorna". */
const VERSION = 'v5-2026-10-06';
const CACHE = 'volleydesk-shell-' + VERSION;
const SHELL = ['./', 'index.html', 'store.js', 'sync.js', 'societa.js', 'societa.css', 'accessi.js', 'squadre.js', 'importa.js', 'iscrizioni.js', 'promemoria.js', 'iscrizione.html', 'promemoria/promemoria.py', 'promemoria/volleydesk-promemoria.yml', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
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
    // il modulo di iscrizione per le famiglie è una pagina a sé: sempre aggiornato dalla rete, dalla cache solo se offline
    if (url.pathname.endsWith('/iscrizione.html')) { e.respondWith(fetch(e.request).catch(() => caches.match('iscrizione.html', 'promemoria/promemoria.py', 'promemoria/volleydesk-promemoria.yml', { ignoreSearch: true }))); return; }
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
