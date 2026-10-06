/* ==================================================================
   Volleydesk – sincronizzazione con un archivio GitHub privato
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
    await gh('/contents/README.md', { method: 'PUT', body: { message: 'Archivio di Volleydesk', branch: c.branch,
      content: b64utf8('# Dati di Volleydesk\n\nQuesto archivio privato contiene i dati della app (dati.json e le immagini nella cartella img). Non modificarlo a mano.\n') } }, c);
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
  async function fetchImg(ref, imgs, c = cfg) {
    if (imgCache.has(ref)) return imgCache.get(ref);
    const sha = imgs.get(ref); if (!sha) return null;
    const b = await gh('/git/blobs/' + sha, {}, c);
    const url = 'data:' + (MIME[ref.split('.').pop()] || 'application/octet-stream') + ';base64,' + b.content.replace(/\s/g, '');
    imgCache.set(ref, url); refMemo.set(url, ref); return url;
  }
  /* da scheda online (con riferimenti alle immagini) a scheda locale */
  async function fromRemote(c, r, imgs, rc = cfg) {
    const o = Object.assign({}, r);
    const f = c === 'exercises' ? 'image' : c === 'athletes' ? 'avatar' : null;
    if (f && typeof o[f] === 'string' && o[f].startsWith('img:')) o[f] = (await fetchImg(o[f].slice(4), imgs, rc)) || (f === 'image' ? null : '');
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
      commit = await commitDoc(cfg, h, imgs, { app: 'schedario-pallavolo', formato: 1, aggiornato: new Date().toISOString(), da: deviceName(),
        ambito: doc.ambito, collections: Object.assign({}, doc.collections, out), tombs, settings: ms }, 'Modifiche dal ' + deviceName());
    }
    if (doc.ambito && JSON.stringify(doc.ambito) !== JSON.stringify(Store.getMeta('ambito') || null)) await Store.setMeta('ambito', doc.ambito);
    // porta sul dispositivo le schede più recenti arrivate dall'archivio online
    if (toLocal.puts.length) set('syncing', 'Ricezione delle modifiche…');
    const puts = await pool(toLocal.puts, 6, async ([c, r]) => [c, await fromRemote(c, r, imgs)]);
    toLocal.puts = puts;
    const changed = await Store.applyRemote(toLocal);
    await Store.setMeta('syncState', { commit, seq: snap.seq, at: Date.now() });
    return changed;
  }
  /* scrive una nuova versione di dati.json (e le immagini che mancano) in un unico salvataggio */
  async function commitDoc(c, h, imgs, newDoc, message) {
    const referenced = new Set();
    for (const L of Object.values(newDoc.collections)) for (const r of L || []) for (const f of ['image', 'avatar']) if (typeof r[f] === 'string' && r[f].startsWith('img:')) referenced.add(r[f].slice(4));
    const missing = [...referenced].filter(ref => !imgs.has(ref));
    const entries = [];
    await pool(missing, 4, async ref => {
      const url = imgCache.get(ref); if (!url) return;
      const b = await gh('/git/blobs', { method: 'POST', body: { content: url.slice(url.indexOf(',') + 1), encoding: 'base64' } }, c);
      entries.push({ path: 'img/' + ref, mode: '100644', type: 'blob', sha: b.sha });
    });
    for (const ref of imgs.keys()) if (!referenced.has(ref)) entries.push({ path: 'img/' + ref, mode: '100644', type: 'blob', sha: null });
    const blob = await gh('/git/blobs', { method: 'POST', body: { content: b64utf8(JSON.stringify(newDoc)), encoding: 'base64' } }, c);
    entries.push({ path: 'dati.json', mode: '100644', type: 'blob', sha: blob.sha });
    if (!h.tree) h.tree = (await gh('/git/commits/' + h.commit, {}, c)).tree.sha;
    const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: h.tree, tree: entries } }, c);
    const cm = await gh('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [h.commit] } }, c);
    try { await gh('/git/refs/heads/' + encodeURIComponent(c.branch), { method: 'PATCH', body: { sha: cm.sha, force: false } }, c); }
    catch (e) { if (e.status === 422 || e.status === 409) { const er = new Error('conflict'); er.conflict = true; throw er; } throw e; }
    return cm.sha;
  }

  /* ---------------------------------------------------------------- archivi delle squadre (li aggiorna la segreteria)
     Ogni squadra può avere un archivio privato suo, a cui l'allenatore accede con un codice
     valido solo lì: GitHub gli impedisce di leggere l'archivio della società.
     Il dispositivo della segreteria fa da tramite: scrive nell'archivio della squadra solo
     le schede di quella squadra (senza dati sensibili) e riporta qui le modifiche degli allenatori. */
  const TEAM_COLS = ['exercises', 'sessions', 'athletes', 'matches', 'trainings', 'notes'];
  const HUBV = 1;
  let hub = null;                 // funzioni fornite dall'app (accessi.js)
  const teamState = {};           // id squadra -> {status, msg, at}
  function setTeam(id, st) { teamState[id] = Object.assign({}, teamState[id], st, st.status === 'ok' ? { at: Date.now(), msg: '' } : {}); listeners.forEach(f => f(state)); }
  async function teamCfg(t) {
    const c = { owner: t.owner || cfg.owner, repo: t.repo, token: cfg.token, branch: t.branch || '' };
    if (c.owner.toLowerCase() === cfg.owner.toLowerCase() && c.repo.toLowerCase() === cfg.repo.toLowerCase()) throw new GhError("L'archivio della squadra non può essere quello della società.", 400);
    if (!c.branch) {
      const m = Store.getMeta('teamSync:' + t.id) || {};
      if (m.branch && m.repo === c.owner + '/' + c.repo) c.branch = m.branch;
      else { const r = await gh('', {}, c); if (r.permissions && r.permissions.push === false) throw new GhError('Il codice della segreteria può solo leggere questo archivio.', 403); c.branch = r.default_branch || 'main'; }
    }
    return c;
  }
  async function syncTeam(t) {
    const c = await teamCfg(t), key = 'teamSync:' + t.id, full = c.owner + '/' + c.repo;
    let last = Store.getMeta(key) || {}; if (last.repo !== full) last = {};
    const snap = Store.snapshot();
    let h = await head(c);
    if (h && h.commit === last.commit && snap.seq === last.seq && last.v === HUBV && last.setv === hub.settingsKey(t.id)) return 0;
    if (!h) { await initRepo(c); h = await head(c); }
    const { doc, imgs } = await readRemote(h, c);
    const hasData = Object.values(doc.collections).some(L => (L || []).length);
    if (doc.ambito && doc.ambito.id !== t.id) throw new GhError('Questo archivio è già usato per un\'altra squadra («' + (doc.ambito.nome || '?') + '»).', 400);
    if (!doc.ambito && hasData) throw new GhError('Questo archivio contiene già altri dati: usa un archivio nuovo e vuoto per la squadra.', 400);
    const rt = doc.tombs || {}, tombs = Object.assign({}, rt), hubT = Object.assign({}, last.hubTombs);
    const out = {}, puts = [], dels = [], adoptQ = [];
    let push = !doc.ambito;
    for (const col of TEAM_COLS) {
      const R = new Map((doc.collections[col] || []).map(r => [r.id, r])), L = snap[col];
      const mine = [...L.values()].filter(r => hub.belongs(col, r, t.id)).map(r => r.id);
      out[col] = [];
      for (const id of new Set([...R.keys(), ...mine])) {
        const k = col + ':' + id, l = L.get(id), r = R.get(id), lt = snap.tombs[k] || 0, tt = rt[k] || 0;
        if (lt && !l) { if (tt < lt) { tombs[k] = lt; push = true; } if (r) push = true; continue; }       // eliminata dalla società
        if (l && !hub.belongs(col, l, t.id)) {                                                       // non è (più) di questa squadra
          if (r) push = true;
          if (!tt) { tombs[k] = Date.now(); hubT[k] = tombs[k]; push = true; }
          continue;
        }
        if (!l) { if (r && !(tt >= (r._m || 0))) { adoptQ.push([col, r, null]); out[col].push(r); } continue; }   // nuova, creata dall'allenatore
        let lm = l._m || 0; const rm = r ? (r._m || 0) : -1;
        if (tt && tt >= lm && tt >= rm) {
          if (!hubT[k]) { const res = hub.coachDelete(col, l, t.id); if (res) puts.push([col, res]); else dels.push([col, id]); continue; }   // eliminata dall'allenatore
          lm = tt + 1; delete hubT[k];                                                                 // torna nella squadra dopo esserne uscita
        }
        if (lm >= rm) { const o = await toRemote(col, hub.strip(col, l)); o._m = lm; out[col].push(o); if (!r || rm !== lm) push = true; }
        else { out[col].push(r); adoptQ.push([col, r, l]); }
      }
    }
    // impostazioni della squadra: confronto a tre (ultimo invio, dispositivo, archivio della squadra)
    const lv = hub.teamSettings(t.id), sent = last.sent || {}, rs = doc.settings || { values: {}, _mk: {} };
    const ms = { values: Object.assign({}, rs.values), _mk: Object.assign({}, rs._mk) }, patch = {}, nowSent = {};
    for (const k of Object.keys(lv)) {
      const a = lv[k] == null ? '' : String(lv[k]), b = rs.values[k] == null ? '' : String(rs.values[k]);
      if (a === b) { nowSent[k] = a; continue; }
      if (k in sent && sent[k] === a) { patch[k] = b; nowSent[k] = b; }                               // cambiata dall'allenatore
      else { ms.values[k] = a; ms._mk[k] = Date.now(); nowSent[k] = a; push = true; }
    }
    if (doc.ambito && doc.ambito.nome !== t.nome) push = true;
    let commit = h.commit;
    if (push) {
      for (const k of Object.keys(rt)) if (!TEAM_COLS.includes(k.split(':')[0])) delete tombs[k];
      commit = await commitDoc(c, h, imgs, { app: 'schedario-pallavolo', formato: 1, aggiornato: new Date().toISOString(), da: 'segreteria',
        ambito: { tipo: 'squadra', id: t.id, nome: t.nome || '' }, collections: out, tombs, settings: ms }, 'Aggiornamento dalla segreteria');
    }
    for (const [col, r, l] of adoptQ) puts.push([col, hub.adopt(col, await fromRemote(col, r, imgs, c), l, t.id)]);
    const n = await Store.applyTeam(puts, dels);
    if (Object.keys(patch).length) await hub.setTeamSettings(t.id, patch);
    await Store.setMeta(key, { repo: full, branch: c.branch, commit, seq: Store.seq(), v: HUBV, hubTombs: hubT, sent: nowSent, setv: hub.settingsKey(t.id) });
    return n + Object.keys(patch).length;
  }
  async function syncTeams() {
    if (!hub || !cfg) return 0;
    let n = 0;
    for (const t of hub.teams()) {
      if (!t.repo) continue;
      try { setTeam(t.id, { status: 'syncing' }); let tries = 0;
        for (;;) { try { n += await syncTeam(t); break; } catch (e) { if (e.conflict && ++tries < 4) continue; throw e; } }
        setTeam(t.id, { status: 'ok' });
      } catch (e) { console.error(e); setTeam(t.id, { status: e.status === 0 ? 'offline' : 'error', msg: e.message || String(e) }); }
    }
    return n;
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
          if (await syncTeams()) again = true;
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
    let count = 0, ambito = null;
    if (h) { const { doc } = await readRemote(h, c); count = Store.COLS.reduce((n, k) => n + (doc.collections[k] || []).length, 0); ambito = doc.ambito || null; }
    return { cfg: c, private: !!repo.private, remoteCount: count, ambito };
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
  async function disconnect() { cfg = null; clearInterval(timer); await Store.setMeta('syncCfg', null); await Store.setMeta('ambito', null); set('off'); }
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
  return { init, run, probe, connect, disconnect, setHub: h => { hub = h; }, teamStatus: () => Object.assign({}, teamState),
    checkTeamRepo: async t => { if (!cfg) throw new GhError("Prima collega l'archivio della società.", 400); const c = await teamCfg(t); const h = await head(c); const { doc } = await readRemote(h, c);
      if (doc.ambito && doc.ambito.id !== t.id) throw new GhError('Questo archivio è già usato per un\'altra squadra («' + (doc.ambito.nome || '?') + '»).', 400);
      if (!doc.ambito && Object.values(doc.collections).some(L => (L || []).length)) throw new GhError('Questo archivio contiene già altri dati: usa un archivio nuovo e vuoto per la squadra.', 400);
      return true; }, onStatus: f => { listeners.add(f); f(state); }, status: () => state, config: () => cfg && { owner: cfg.owner, repo: cfg.repo } };
})();
