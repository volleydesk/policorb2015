/* ==================================================================
   Volleysched – sincronizzazione con un archivio GitHub privato
   Nell'archivio online:
     dati.json      tutte le schede (senza immagini) + lapidi + impostazioni
     img/<hash>.png le immagini degli esercizi e degli atleti, una per file
   Ogni sincronizzazione legge l'ultima versione online, la unisce con
   quella del dispositivo (per ogni scheda vince la modifica più recente)
   e, se serve, scrive una nuova versione in un unico salvataggio (commit).
   GitHub conserva tutte le versioni: è anche la copia di sicurezza.
   ================================================================== */
"use strict";
const Sync = (() => {
  const API = self.SYNC_API_OVERRIDE || 'https://api.github.com';   // l'alternativa serve solo per le prove
  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
  let cfg = null;               // {owner, repo, token, branch}
  let state = { status: 'off', msg: '', at: 0 };
  const listeners = new Set();
  let running = null, again = false, timer = null, debounce = null, retryT = null;
  const refMemo = new Map();    // dataURL -> nome del file immagine
  const imgCache = new Map();   // nome del file immagine -> dataURL

  /* ---------------------------------------------------------------- utilità */
  function set(status, msg = '') { state = Object.assign({}, state, { status, msg }); if (status === 'ok') state.at = Date.now(); listeners.forEach(f => f(state)); }
  function b64FromBytes(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  const b64utf8 = str => b64FromBytes(new TextEncoder().encode(str));
  const utf8b64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  async function refOf(dataURL) {
    let r = refMemo.get(dataURL); if (r) return r;
    const m = /^data:([^;,]+)[;,]/.exec(dataURL); const ext = EXT[m && m[1]] || 'bin';
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataURL));
    r = [...new Uint8Array(h)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('') + '.' + ext;
    refMemo.set(dataURL, r); imgCache.set(r, dataURL); return r;
  }
  class GhError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
  async function gh(path, opts = {}, c = cfg) {
    let r;
    try {
      r = await fetch(API + '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + path, {
        method: opts.method || 'GET', cache: 'no-store',
        headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          opts.body ? { 'Content-Type': 'application/json' } : {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) { throw new GhError('Nessuna connessione a internet', 0); }
    if (r.ok) return r.status === 204 ? null : r.json();
    let msg = ''; try { msg = (await r.json()).message || ''; } catch (_) {}
    if (r.status === 401) throw new GhError('Codice di accesso non valido o scaduto: creane uno nuovo (Archivio e impostazioni).', 401);
    if (r.status === 404) throw new GhError('Archivio "' + c.owner + '/' + c.repo + '" non trovato, oppure il codice di accesso non ha il permesso di usarlo.', 404);
    if (r.status === 403) throw new GhError('GitHub ha rifiutato l\'accesso: ' + (msg || 'permessi insufficienti') + '. Il codice deve avere il permesso "Contents: Read and write".', 403);
    throw new GhError(msg || ('Errore GitHub ' + r.status), r.status);
  }
  const deviceName = () => (navigator.userAgentData ? navigator.userAgentData.mobile : /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) ? 'telefono' : 'computer';

  /* ---------------------------------------------------------------- lettura dell'archivio online */
  async function head(c = cfg) {
    try {
      const ref = await gh('/git/ref/heads/' + encodeURIComponent(c.branch), {}, c);
      return { commit: ref.object.sha, tree: null };
    } catch (e) {
      if (e.status === 409 || e.status === 404) {   // archivio vuoto (nessun file ancora)
        if (e.status === 404) { await gh('', {}, c); }   // se l'archivio non esiste davvero, qui esce l'errore giusto
        return null;
      }
      throw e;
    }
  }
  async function initRepo(c = cfg) {
    await gh('/contents/README.md', { method: 'PUT', body: { message: 'Archivio di Volleysched', branch: c.branch,
      content: b64utf8('# Dati di Volleysched\n\nQuesto archivio privato contiene i dati della app (dati.json e le immagini nella cartella img). Non modificarlo a mano.\n') } }, c);
  }
  async function readRemote(h, c = cfg) {
    const empty = { doc: { collections: {}, tombs: {}, settings: { values: {}, _mk: {} } }, imgs: new Map(), datiPath: false };
    if (!h) return empty;
    if (!h.tree) h.tree = (await gh('/git/commits/' + h.commit, {}, c)).tree.sha;
    const tree = await gh('/git/trees/' + h.tree + '?recursive=1', {}, c);
    const imgs = new Map(); let dati = null;
    for (const t of tree.tree) {
      if (t.type !== 'blob') continue;
      if (t.path === 'dati.json') dati = t.sha;
      else if (t.path.startsWith('img/')) imgs.set(t.path.slice(4), t.sha);
    }
    if (!dati) return Object.assign(empty, { imgs });
    const b = await gh('/git/blobs/' + dati, {}, c);
    const doc = JSON.parse(utf8b64(b.content));
    doc.collections = doc.collections || {}; doc.tombs = doc.tombs || {}; doc.settings = doc.settings || { values: {}, _mk: {} };
    return { doc, imgs, datiPath: true };
  }
  async function fetchImg(ref, imgs) {
    if (imgCache.has(ref)) return imgCache.get(ref);
    const sha = imgs.get(ref); if (!sha) return null;
    const b = await gh('/git/blobs/' + sha);
    const url = 'data:' + (MIME[ref.split('.').pop()] || 'application/octet-stream') + ';base64,' + b.content.replace(/\s/g, '');
    imgCache.set(ref, url); refMemo.set(url, ref); return url;
  }
  /* da scheda online (con riferimenti alle immagini) a scheda locale */
  async function fromRemote(c, r, imgs) {
    const o = Object.assign({}, r);
    const f = c === 'exercises' ? 'image' : c === 'athletes' ? 'avatar' : null;
    if (f && typeof o[f] === 'string' && o[f].startsWith('img:')) o[f] = (await fetchImg(o[f].slice(4), imgs)) || (f === 'image' ? null : '');
    return o;
  }
  async function toRemote(c, r) {
    const o = Object.assign({}, r);
    const f = c === 'exercises' ? 'image' : c === 'athletes' ? 'avatar' : null;
    if (f && typeof o[f] === 'string' && o[f].startsWith('data:')) o[f] = 'img:' + await refOf(o[f]);
    return o;
  }
  async function pool(list, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } })); return out; }

  /* ---------------------------------------------------------------- una sincronizzazione */
  async function syncOnce() {
    const snap = Store.snapshot();
    const last = Store.getMeta('syncState') || {};
    let h = await head();
    if (h && h.commit === last.commit && snap.seq === last.seq) return false;   // niente di nuovo da nessuna parte
    if (!h) { await initRepo(); h = await head(); }
    const { doc, imgs } = await readRemote(h);
    const tombs = Object.assign({}, doc.tombs);
    for (const [k, t] of Object.entries(snap.tombs)) if ((tombs[k] || 0) < t) tombs[k] = t;
    const out = {}, toLocal = { puts: [], dels: [], tombs, settings: null };
    let push = JSON.stringify(tombs) !== JSON.stringify(doc.tombs || {});
    const remoteNeedImg = [];
    for (const c of Store.COLS) {
      const R = new Map((doc.collections[c] || []).map(r => [r.id, r])), L = snap[c];
      const ids = new Set([...R.keys(), ...L.keys()]);
      out[c] = [];
      for (const id of ids) {
        const l = L.get(id), r = R.get(id), t = tombs[c + ':' + id] || 0;
        const lm = l ? (l._m || 0) : -1, rm = r ? (r._m || 0) : -1;
        const win = lm >= rm ? 'L' : 'R', wm = Math.max(lm, rm);
        if (t && t >= wm) {                 // eliminata
          if (r) push = true;
          if (l) toLocal.dels.push([c, id, t]);
          continue;
        }
        if (win === 'L') { out[c].push(await toRemote(c, l)); if (!r || rm !== lm) push = true; }
        else { out[c].push(r); toLocal.puts.push([c, r]); }
      }
    }
    // impostazioni: per ogni voce vince la modifica più recente
    const ls = snap.settings || { values: {}, _mk: {} }, rs = doc.settings;
    const ms = { values: {}, _mk: {} }; let setToLocal = false;
    for (const k of new Set([...Object.keys(ls._mk || {}), ...Object.keys(rs._mk || {})])) {
      const lt = (ls._mk || {})[k] || 0, rt = (rs._mk || {})[k] || 0;
      if (lt >= rt) { ms.values[k] = (ls.values || {})[k]; ms._mk[k] = lt; if (lt !== rt) push = true; }
      else { ms.values[k] = rs.values[k]; ms._mk[k] = rt; setToLocal = true; }
    }
    if (setToLocal) toLocal.settings = ms;

    let commit = h.commit;
    if (push) {
      set('syncing', 'Invio delle modifiche…');
      const referenced = new Set();
      for (const c of Store.COLS) for (const r of out[c]) for (const f of ['image', 'avatar']) if (typeof r[f] === 'string' && r[f].startsWith('img:')) referenced.add(r[f].slice(4));
      const missing = [...referenced].filter(ref => !imgs.has(ref));
      const entries = [];
      await pool(missing, 4, async ref => {
        const url = imgCache.get(ref); if (!url) return;
        const b = await gh('/git/blobs', { method: 'POST', body: { content: url.slice(url.indexOf(',') + 1), encoding: 'base64' } });
        entries.push({ path: 'img/' + ref, mode: '100644', type: 'blob', sha: b.sha });
      });
      for (const ref of imgs.keys()) if (!referenced.has(ref)) entries.push({ path: 'img/' + ref, mode: '100644', type: 'blob', sha: null });
      const newDoc = { app: 'schedario-pallavolo', formato: 1, aggiornato: new Date().toISOString(), da: deviceName(), collections: Object.assign({}, doc.collections, out), tombs, settings: ms };
      const blob = await gh('/git/blobs', { method: 'POST', body: { content: b64utf8(JSON.stringify(newDoc)), encoding: 'base64' } });
      entries.push({ path: 'dati.json', mode: '100644', type: 'blob', sha: blob.sha });
      const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: h.tree, tree: entries } });
      const cm = await gh('/git/commits', { method: 'POST', body: { message: 'Modifiche dal ' + deviceName(), tree: tree.sha, parents: [h.commit] } });
      try { await gh('/git/refs/heads/' + encodeURIComponent(cfg.branch), { method: 'PATCH', body: { sha: cm.sha, force: false } }); }
      catch (e) { if (e.status === 422 || e.status === 409) { const er = new Error('conflict'); er.conflict = true; throw er; } throw e; }
      commit = cm.sha;
    }
    // porta sul dispositivo le schede più recenti arrivate dall'archivio online
    if (toLocal.puts.length) set('syncing', 'Ricezione delle modifiche…');
    const puts = await pool(toLocal.puts, 6, async ([c, r]) => [c, await fromRemote(c, r, imgs)]);
    toLocal.puts = puts;
    const changed = await Store.applyRemote(toLocal);
    await Store.setMeta('syncState', { commit, seq: snap.seq, at: Date.now() });
    return changed;
  }
  async function run() {
    if (!cfg) return;
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do {
          again = false;
          set('syncing', 'Sincronizzazione…');
          let tries = 0;
          for (;;) {
            try { await syncOnce(); break; }
            catch (e) { if (e.conflict && ++tries < 4) continue; throw e; }
          }
          const st = Store.getMeta('syncState') || {};
          set(Store.seq() === st.seq ? 'ok' : 'pending', '');
          if (Store.seq() !== st.seq) again = true;
        } while (again);
      } catch (e) {
        console.error(e);
        if (e.status === 0) { set('offline', 'Senza connessione: le modifiche restano sul dispositivo e partono appena torna la rete.'); clearTimeout(retryT); retryT = setTimeout(run, 20000); }
        else set('error', e.message || String(e));
      } finally { running = null; }
    })();
    return running;
  }
  function schedule(ms = 2500) { clearTimeout(debounce); if (cfg) { if (state.status === 'ok') set('pending'); debounce = setTimeout(run, ms); } }

  /* ---------------------------------------------------------------- collegamento */
  async function probe(c) {
    c = Object.assign({ branch: '' }, c);
    let repo;
    try {
      const r = await fetch(API + '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo), { cache: 'no-store', headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' } });
      if (r.status === 401) throw new GhError('Il codice di accesso non è valido o è scaduto.', 401);
      if (r.status === 404) throw new GhError('Archivio non trovato: controlla nome utente e nome dell\'archivio, e che il codice dia accesso proprio a questo archivio.', 404);
      if (!r.ok) throw new GhError('GitHub ha risposto con errore ' + r.status, r.status);
      repo = await r.json();
    } catch (e) { if (e instanceof GhError) throw e; throw new GhError('Nessuna connessione a internet', 0); }
    if (repo.permissions && repo.permissions.push === false) throw new GhError('Il codice di accesso permette solo di leggere: serve "Contents: Read and write".', 403);
    c.branch = repo.default_branch || 'main';
    const h = await head(c);
    let count = 0;
    if (h) { const { doc } = await readRemote(h, c); count = Store.COLS.reduce((n, k) => n + (doc.collections[k] || []).length, 0); }
    return { cfg: c, private: !!repo.private, remoteCount: count };
  }
  async function connect(c, replaceLocal) {
    cfg = c;
    await Store.setMeta('syncCfg', c);
    await Store.setMeta('syncState', {});
    if (replaceLocal) {
      set('syncing', 'Scarico i dati dall\'archivio online…');
      const h = await head();
      const { doc, imgs } = await readRemote(h);
      const data = { tombs: doc.tombs, settings: doc.settings };
      for (const k of Store.COLS) data[k] = await pool(doc.collections[k] || [], 6, r => fromRemote(k, r, imgs));
      await Store.replaceAll(data);
      await Store.setMeta('syncState', { commit: h && h.commit, seq: Store.seq(), at: Date.now() });
    }
    start();
    return run();
  }
  async function disconnect() { cfg = null; clearInterval(timer); await Store.setMeta('syncCfg', null); set('off'); }
  function start() {
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 60000);
  }
  async function init() {
    cfg = Store.getMeta('syncCfg') || null;
    Store.onChange(kind => { if (kind === 'local') schedule(); });
    window.addEventListener('online', () => run());
    window.addEventListener('offline', () => cfg && set('offline', 'Senza connessione: le modifiche restano sul dispositivo e partono appena torna la rete.'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); else if (state.status === 'pending') run(); });
    if (cfg) { start(); set('pending'); run(); } else set('off');
  }
  return { init, run, probe, connect, disconnect, onStatus: f => { listeners.add(f); f(state); }, status: () => state, config: () => cfg && { owner: cfg.owner, repo: cfg.repo } };
})();
