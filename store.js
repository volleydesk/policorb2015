/* ==================================================================
   Volleydesk – archivio locale nel browser (IndexedDB)
   Fa le stesse cose che faceva il programma Python (app.py):
   l'interfaccia chiama Store.api(metodo, indirizzo, dati) come prima
   chiamava il server.
   Ogni scheda salvata riceve "_m" (momento dell'ultima modifica su
   questo dispositivo): serve alla sincronizzazione per capire quale
   versione è la più recente. Le schede eliminate lasciano una
   "lapide" (tombstone) con lo stesso scopo.
   ================================================================== */
"use strict";
const Store = (() => {
  const DBNAME = 'volleydesk', VERSION = 5;
  const COLS = ['exercises', 'sessions', 'athletes', 'matches', 'trainings', 'notes', 'payments', 'ledger', 'deadlines', 'staff', 'inventory', 'venues', 'docs'];
  const SETTING_KEYS = ['squadra', 'allenatore', 'noteGenerali', 'calendarioAllenamenti', 'colore', 'accento', 'logo', 'campionati', 'preferiti', 'licenza', 'provaDal', 'opzioni', 'squadre', 'societa', 'accessi', 'iscrizioni', 'promemoria'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^\d{1,2}:\d{2}$/;
  let idb = null;
  const mem = {}; COLS.forEach(c => mem[c] = new Map());
  let settings = { values: {}, _mk: {} };
  let tombs = {};          // "collezione:id" -> momento dell'eliminazione
  let meta = {};           // altre informazioni (inizializzato, configurazione sincronizzazione, ...)
  let seq = 0;             // aumenta a ogni modifica locale
  let lastM = 0;
  const listeners = new Set();

  const now = () => { let t = Date.now(); if (t <= lastM) t = lastM + 1; lastM = t; return t; };
  const s = v => v == null ? '' : String(v);
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const newId = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toIntOrNull = v => { if (v === null || v === undefined || v === '') return null; const n = Math.round(parseFloat(v)); return isNaN(n) ? null : Math.max(0, n); };
  const DEFAULT_NOTE_FALLBACK = '';

  /* ---------------------------------------------------------------- IndexedDB */
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DBNAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const c of COLS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');   // contenuto dei documenti allegati (dataURL), per nome del file
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Archivio bloccato da un\'altra scheda aperta: chiudila e ricarica.'));
    });
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function loadAll() {
    const t = idb.transaction([...COLS, 'meta'], 'readonly');
    for (const c of COLS) {
      const all = await reqP(t.objectStore(c).getAll());
      mem[c] = new Map(all.map(r => [r.id, r]));
    }
    const ms = t.objectStore('meta');
    const keys = await reqP(ms.getAllKeys()), vals = await reqP(ms.getAll());
    meta = {}; keys.forEach((k, i) => meta[k] = vals[i]);
    settings = meta.settings || { values: {}, _mk: {} };
    tombs = meta.tombs || {};
    seq = meta.seq || 0;
    lastM = Math.max(lastM, meta.lastM || 0);
  }
  /* scrive in un'unica transazione: puts = [[collezione, record]], dels = [[collezione, id]] */
  function write(puts = [], dels = [], metaPuts = {}) {
    return new Promise((res, rej) => {
      const t = idb.transaction([...COLS, 'meta'], 'readwrite');
      for (const [c, r] of puts) t.objectStore(c).put(r);
      for (const [c, id] of dels) t.objectStore(c).delete(id);
      for (const [k, v] of Object.entries(metaPuts)) t.objectStore('meta').put(v, k);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error || new Error('Scrittura non riuscita'));
      t.onabort = () => rej(t.error || new Error('Scrittura annullata (spazio esaurito?)'));
    });
  }
  /* modifica locale: aggiorna memoria + disco e avvisa la sincronizzazione */
  async function commitLocal(puts = [], dels = [], extraMeta = {}) {
    for (const [c, r] of puts) { mem[c].set(r.id, r); delete tombs[c + ':' + r.id]; }
    const t = now();
    for (const [c, id] of dels) { mem[c].delete(id); tombs[c + ':' + id] = t; }
    seq++;
    await write(puts, dels, Object.assign({ tombs, seq, lastM, settings }, extraMeta));
    listeners.forEach(f => { try { f('local'); } catch (e) { console.error(e); } });
  }
  async function setMeta(k, v) { meta[k] = v; await write([], [], { [k]: v }); }

  /* ---------------------------------------------------------------- normalizzazione (come app.py) */
  function normEx(e, old) {
    if (!s(e.titolo).trim()) throw new Error('Il titolo è obbligatorio');
    const r = {
      id: s(e.id), titolo: s(e.titolo).trim(), fondamentale: s(e.fondamentale), formazione: s(e.formazione),
      durata: toIntOrNull(e.durata) ?? '', intensita: s(e.intensita), materiale: s(e.materiale),
      organizzazione: s(e.organizzazione), svolgimento: s(e.svolgimento), puntoChiave: s(e.puntoChiave),
      variante: s(e.variante), note: s(e.note), video: s(e.video).trim(), image: e.image || null,
      schema: e.schema || null, origine: s(e.origine), distretto: s(e.distretto),
      dosaggio: (e.dosaggio && typeof e.dosaggio === 'object') ? e.dosaggio : null,
      createdAt: (old && old.createdAt) || e.createdAt || Date.now(), updatedAt: e.updatedAt || Date.now()
    };
    return r;
  }
  function normSess(x, old) {
    const items = (x.items || []).map(it => {
      const uid = s(it.uid) || newId('it'), durata = toIntOrNull(it.durata) || 0;
      if (it.type === 'ex' && mem.exercises.has(it.exId))
        return { uid, type: 'ex', exId: it.exId, durata, nota: s(it.nota), dosaggio: (it.dosaggio && typeof it.dosaggio === 'object') ? it.dosaggio : null };
      return { uid, type: 'free', titolo: it.type !== 'ex' ? s(it.titolo) : '(esercizio non presente nello schedario)', durata,
        fondamentale: s(it.fondamentale), descrizione: s(it.descrizione) || s(it.nota) };
    });
    return { id: s(x.id), titolo: s(x.titolo), data: s(x.data), oraInizio: s(x.oraInizio), luogo: s(x.luogo),
      obiettivo: s(x.obiettivo), note: s(x.note), items,
      createdAt: (old && old.createdAt) || x.createdAt || Date.now(), updatedAt: x.updatedAt || Date.now() };
  }
  const AT_FIELDS = ['nome', 'cognome', 'cellulare', 'ruolo', 'ruolo2', 'sesso', 'dataNascita', 'scadenzaVisita', 'scadenzaDocumento', 'taglia', 'note', 'numeroMaglia', 'numeroDocumento', 'avatar',
    /* dati per la società */ 'codiceFiscale', 'email', 'indirizzo', 'luogoNascita', 'genitore', 'cfGenitore', 'telGenitore', 'emailGenitore', 'tessera', 'scadenzaTessera', 'privacy', 'consensoFoto', 'certificato'];
  function normAt(a, old) {
    if (!(s(a.nome).trim() || s(a.cognome).trim())) throw new Error('Inserisci almeno il nome o il cognome');
    const r = { id: s(a.id) };
    for (const k of AT_FIELDS) {
      const v = s(a[k]).trim();
      if (['dataNascita', 'scadenzaVisita', 'scadenzaDocumento', 'scadenzaTessera'].includes(k) && v && !DATE_RE.test(v)) throw new Error('Data non valida: ' + v);
      r[k] = v;
    }
    if (r.avatar.length > 500000) throw new Error("Immagine dell'atleta troppo grande");
    r.iscritto = [true, 1, '1', 'si', 'SI', 'Si', 'Sì', 'true'].includes(a.iscritto);
    r.squadre = Array.isArray(a.squadre) ? a.squadre.filter(Boolean).map(String) : [];
    r.infortuni = Array.isArray(a.infortuni) ? a.infortuni.filter(x => x && typeof x === 'object').map(x => ({ id: s(x.id), cosa: s(x.cosa).trim(), dal: s(x.dal).trim(), rientro: s(x.rientro).trim(), note: s(x.note), chiuso: !!x.chiuso })) : [];
    r.createdAt = (old && old.createdAt) || a.createdAt || Date.now(); r.updatedAt = a.updatedAt || Date.now();
    return r;
  }
  const MA_FIELDS = ['data', 'ora', 'oraRitrovo', 'avversario', 'palestra', 'indirizzo', 'competizione', 'divisa', 'risultato', 'note', 'giornata', 'numeroGara'];
  function normMatch(m, old) {
    const r = { id: s(m.id) };
    for (const k of MA_FIELDS) {
      const v = k === 'note' ? s(m[k]) : s(m[k]).trim();
      if (k === 'data' && v && !DATE_RE.test(v)) throw new Error('Data non valida: ' + v);
      if ((k === 'ora' || k === 'oraRitrovo') && v && !TIME_RE.test(v)) throw new Error('Orario non valido: ' + v);
      r[k] = v;
    }
    r.inCasa = ![false, 0, '0', 'false'].includes(m.inCasa);
    r.convocati = (m.convocati || []).filter(Boolean).map(String);
    r.assenti = (m.assenti || []).filter(Boolean).map(String);
    r.disponibili = (m.disponibili || []).filter(Boolean).map(String);
    r.formazione = (m.formazione && typeof m.formazione === 'object') ? clone(m.formazione) : null;
    r.stats = (m.stats && typeof m.stats === 'object') ? clone(m.stats) : null;
    r.referto = (m.referto && typeof m.referto === 'object') ? clone(m.referto) : null;
    r.squadra = s(m.squadra); r.pgsId = s(m.pgsId); r.parziali = s(m.parziali);
    r.createdAt = (old && old.createdAt) || m.createdAt || Date.now(); r.updatedAt = m.updatedAt || Date.now();
    return r;
  }
  function normTr(t, old) {
    const d = s(t.data).trim();
    if (!DATE_RE.test(d)) throw new Error("Data dell'allenamento non valida: " + d);
    const ora = s(t.ora).trim();
    if (ora && !TIME_RE.test(ora)) throw new Error('Orario non valido: ' + ora);
    const pres = {};
    if (t.presenze && typeof t.presenze === 'object') for (const [k, v] of Object.entries(t.presenze)) if (['P', 'A', 'G'].includes(v)) pres[s(k)] = v;
    return { id: s(t.id), squadra: s(t.squadra), data: d, ora, note: s(t.note), annullato: [true, 1, '1', 'true'].includes(t.annullato), presenze: pres,
      createdAt: (old && old.createdAt) || t.createdAt || Date.now(), updatedAt: t.updatedAt || Date.now() };
  }
  function normNote(n, old) {
    const testo = s(n.testo), titolo = s(n.titolo).trim();
    if (!titolo && !testo.trim()) throw new Error('La nota è vuota');
    return { id: s(n.id), squadra: s(n.squadra), titolo, testo, colore: s(n.colore), fissata: [true, 1, '1', 'true'].includes(n.fissata), etichetta: s(n.etichetta).trim(),
      createdAt: (old && old.createdAt) || n.createdAt || Date.now(), updatedAt: n.updatedAt || Date.now() };
  }
  /* ---------------------------------------------------------------- società */
  const money = v => {
    if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return isNaN(v) ? 0 : Math.round(v * 100) / 100;
    let t = String(v).replace(/[\s€]/g, '');
    if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');   // 1.200,50 oppure 1,200.50
    else if (t.includes(',')) t = t.replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');                                                                          // 2.000
    const n = parseFloat(t); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const dateOrEmpty = (v, what) => { v = s(v).trim(); if (v && !DATE_RE.test(v)) throw new Error('Data non valida' + (what ? ' (' + what + ')' : '') + ': ' + v); return v; };
  const yes = v => [true, 1, '1', 'true', 'si', 'sì'].includes(v);
  const stamp = (r, x, old) => { r.createdAt = (old && old.createdAt) || x.createdAt || Date.now(); r.updatedAt = x.updatedAt || Date.now(); return r; };
  /* una quota (o rata) da incassare da un atleta, con gli incassi registrati */
  function normPay(p, old) {
    if (!s(p.atletaId)) throw new Error("Manca l'atleta della quota");
    const r = { id: s(p.id), atletaId: s(p.atletaId), stagione: s(p.stagione).trim(), voce: s(p.voce).trim() || 'Quota', descrizione: s(p.descrizione).trim(),
      importo: money(p.importo), scadenza: dateOrEmpty(p.scadenza, 'scadenza'), note: s(p.note), pianoId: s(p.pianoId), annullata: yes(p.annullata), sconto: s(p.sconto).trim() };
    r.incassi = (Array.isArray(p.incassi) ? p.incassi : []).filter(x => x && typeof x === 'object').map(x => ({
      id: s(x.id) || newId('in'), data: dateOrEmpty(x.data, 'incasso'), importo: money(x.importo), metodo: s(x.metodo).trim(), ricevuta: s(x.ricevuta).trim(),
      pagatoDa: s(x.pagatoDa).trim(), cfPagante: s(x.cfPagante).trim().toUpperCase(), note: s(x.note) })).filter(x => x.importo !== 0);
    return stamp(r, p, old);
  }
  /* prima nota: entrate e uscite che non sono quote degli atleti */
  function normLedger(m, old) {
    const data = dateOrEmpty(m.data, 'movimento'); if (!data) throw new Error('Inserisci la data del movimento');
    const importo = money(m.importo); if (!importo) throw new Error("Inserisci l'importo");
    return stamp({ id: s(m.id), data, tipo: m.tipo === 'U' ? 'U' : 'E', categoria: s(m.categoria).trim(), descrizione: s(m.descrizione).trim(), importo: Math.abs(importo),
      metodo: s(m.metodo).trim(), controparte: s(m.controparte).trim(), documento: s(m.documento).trim(), stagione: s(m.stagione).trim(), squadra: s(m.squadra), note: s(m.note),
      staffId: s(m.staffId), natura: ['compenso', 'rimborso'].includes(m.natura) ? m.natura : '', rif: s(m.rif) }, m, old);
  }
  const RICORRENZE = ['', 'mensile', 'bimestrale', 'trimestrale', 'semestrale', 'annuale'];
  function normDeadline(d, old) {
    const titolo = s(d.titolo).trim(); if (!titolo) throw new Error('Scrivi cosa scade');
    const data = dateOrEmpty(d.data, 'scadenza'); if (!data) throw new Error('Inserisci la data di scadenza');
    return stamp({ id: s(d.id), titolo, data, categoria: s(d.categoria).trim(), importo: d.importo === '' || d.importo == null ? '' : money(d.importo),
      ricorrenza: RICORRENZE.includes(s(d.ricorrenza)) ? s(d.ricorrenza) : '', fatto: yes(d.fatto), fattoIl: dateOrEmpty(d.fattoIl), avviso: toIntOrNull(d.avviso) ?? 7, note: s(d.note) }, d, old);
  }
  const STAFF_FIELDS = ['nome', 'cognome', 'ruolo', 'cellulare', 'email', 'codiceFiscale', 'tessera', 'qualifica', 'compenso', 'note', 'iban'];
  function normStaff(x, old) {
    if (!(s(x.nome).trim() || s(x.cognome).trim())) throw new Error('Inserisci almeno il nome o il cognome');
    const r = { id: s(x.id) }; for (const k of STAFF_FIELDS) r[k] = k === 'note' ? s(x[k]) : s(x[k]).trim();
    r.scadenzaTessera = dateOrEmpty(x.scadenzaTessera, 'tessera'); r.scadenzaVisita = dateOrEmpty(x.scadenzaVisita, 'visita');
    r.scadenzaQualifica = dateOrEmpty(x.scadenzaQualifica, 'qualifica'); r.scadenzaCasellario = dateOrEmpty(x.scadenzaCasellario, 'casellario');
    r.attivo = x.attivo === undefined ? true : yes(x.attivo);
    r.squadre = Array.isArray(x.squadre) ? x.squadre.filter(Boolean).map(String) : [];
    return stamp(r, x, old);
  }
  function normInv(x, old) {
    const articolo = s(x.articolo).trim(); if (!articolo) throw new Error("Scrivi il nome dell'articolo");
    const r = { id: s(x.id), articolo, categoria: s(x.categoria).trim(), taglia: s(x.taglia).trim(), quantita: toIntOrNull(x.quantita) ?? 0, costo: x.costo === '' || x.costo == null ? '' : money(x.costo),
      sogliaMin: toIntOrNull(x.sogliaMin) ?? '', note: s(x.note) };
    r.consegne = (Array.isArray(x.consegne) ? x.consegne : []).filter(c => c && typeof c === 'object').map(c => ({ id: s(c.id) || newId('cg'), atletaId: s(c.atletaId),
      a: s(c.a).trim(), data: dateOrEmpty(c.data, 'consegna'), quantita: toIntOrNull(c.quantita) || 1, restituito: yes(c.restituito), resoIl: dateOrEmpty(c.resoIl), note: s(c.note) }));
    return stamp(r, x, old);
  }
  /* palestra con i suoi turni settimanali e i periodi di chiusura */
  const TIME = v => { v = s(v).trim(); if (v && !TIME_RE.test(v)) throw new Error('Orario non valido: ' + v); return v ? v.padStart(5, '0') : ''; };
  function normVenue(x, old) {
    const nome = s(x.nome).trim(); if (!nome) throw new Error('Scrivi il nome della palestra');
    const r = { id: s(x.id), nome, indirizzo: s(x.indirizzo).trim(), ente: s(x.ente).trim(), costoOrario: x.costoOrario === '' || x.costoOrario == null ? '' : money(x.costoOrario), note: s(x.note), attiva: x.attiva === undefined ? true : yes(x.attiva) };
    r.turni = (Array.isArray(x.turni) ? x.turni : []).filter(t => t && typeof t === 'object').map(t => {
      const g = parseInt(t.giorno, 10); if (!(g >= 1 && g <= 7)) throw new Error('Giorno del turno non valido');
      const dalle = TIME(t.dalle), alle = TIME(t.alle); if (!dalle || !alle || alle <= dalle) throw new Error("Controlla gli orari del turno: l'ora di fine deve venire dopo quella di inizio");
      return { id: s(t.id) || newId('tu'), giorno: g, dalle, alle, squadra: s(t.squadra), chi: s(t.chi).trim(), dal: dateOrEmpty(t.dal, 'inizio turno'), al: dateOrEmpty(t.al, 'fine turno'),
        costoOrario: t.costoOrario === '' || t.costoOrario == null ? '' : money(t.costoOrario), note: s(t.note) };
    });
    r.chiusure = (Array.isArray(x.chiusure) ? x.chiusure : []).filter(c => c && typeof c === 'object').map(c => ({ id: s(c.id) || newId('ch'), dal: dateOrEmpty(c.dal, 'chiusura'), al: dateOrEmpty(c.al, 'chiusura') || dateOrEmpty(c.dal), motivo: s(c.motivo).trim() })).filter(c => c.dal);
    return stamp(r, x, old);
  }
  /* documento allegato: i dati del file stanno a parte (archivio 'files'), qui solo il riferimento */
  const DOC_TIPI = ['certificato', 'privacy', 'tessera', 'documento', 'fattura', 'ricevuta', 'contratto', 'verbale', 'statuto', 'polizza', 'altro'];
  function normDoc(x, old) {
    const file = s(x.file); if (!/^img:[\w.-]+$/.test(file)) throw new Error('Manca il file del documento');
    const rif = s(x.rif); if (!/^(at|st|mv|soc)(:[\w-]+)?$/.test(rif)) throw new Error('Documento senza collegamento');
    return stamp({ id: s(x.id), titolo: s(x.titolo).trim() || s(x.nome).trim() || 'Documento', tipo: DOC_TIPI.includes(x.tipo) ? x.tipo : 'altro', rif, file,
      nome: s(x.nome).trim(), mime: s(x.mime), size: toIntOrNull(x.size) || 0, data: dateOrEmpty(x.data, 'documento'), scadenza: dateOrEmpty(x.scadenza, 'scadenza documento'), note: s(x.note) }, x, old);
  }
  const NORM = { exercises: normEx, venues: normVenue, docs: normDoc, sessions: normSess, athletes: normAt, matches: normMatch, trainings: normTr, notes: normNote,
    payments: normPay, ledger: normLedger, deadlines: normDeadline, staff: normStaff, inventory: normInv };
  function prep(c, body) {
    const old = mem[c].get(body.id);
    const r = NORM[c](body, old);
    r._m = now();
    return r;
  }

  /* ---------------------------------------------------------------- stato completo (come /api/stato) */
  const strip = r => { const o = Object.assign({}, r); delete o._m; return clone(o); };
  const coll = (a, b) => (a || '').localeCompare(b || '', 'it', { sensitivity: 'base' });
  function fullState() {
    const ex = [...mem.exercises.values()].sort((a, b) => coll(a.fondamentale, b.fondamentale) || coll(a.titolo, b.titolo));
    const se = [...mem.sessions.values()].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    const at = [...mem.athletes.values()].sort((a, b) => coll(a.cognome, b.cognome) || coll(a.nome, b.nome));
    const ma = [...mem.matches.values()].sort((a, b) => ((a.data || '') + (a.ora || '')).localeCompare((b.data || '') + (b.ora || '')));
    const tr = [...mem.trainings.values()].sort((a, b) => ((a.data || '') + (a.ora || '')).localeCompare((b.data || '') + (b.ora || '')));
    const no = [...mem.notes.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const byDate = k => (a, b) => (s(a[k])).localeCompare(s(b[k]));
    return { exercises: ex.map(strip), sessions: se.map(strip), athletes: at.map(strip), matches: ma.map(strip), trainings: tr.map(strip), notes: no.map(strip),
      payments: [...mem.payments.values()].sort(byDate('scadenza')).map(strip), ledger: [...mem.ledger.values()].sort(byDate('data')).map(strip),
      deadlines: [...mem.deadlines.values()].sort(byDate('data')).map(strip), staff: [...mem.staff.values()].sort((a, b) => coll(a.cognome, b.cognome) || coll(a.nome, b.nome)).map(strip),
      docs: [...mem.docs.values()].sort((a, b) => (b.data || '').localeCompare(a.data || '')).map(strip),
      venues: [...mem.venues.values()].sort((a, b) => coll(a.nome, b.nome)).map(strip),
      inventory: [...mem.inventory.values()].sort((a, b) => coll(a.categoria, b.categoria) || coll(a.articolo, b.articolo)).map(strip),
      settings: getSettings(), info: {} };
  }
  function getSettings() {
    const v = settings.values || {};
    return { squadra: v.squadra || '', allenatore: v.allenatore || '',
      noteGenerali: v.noteGenerali ?? (typeof DEFAULT_NOTE !== 'undefined' ? DEFAULT_NOTE : DEFAULT_NOTE_FALLBACK),
      calendarioAllenamenti: v.calendarioAllenamenti || '', colore: v.colore || '', accento: v.accento || '', logo: v.logo || '', campionati: v.campionati || '', preferiti: v.preferiti || '', licenza: v.licenza || '', provaDal: v.provaDal || '', opzioni: v.opzioni || '', squadre: v.squadre || '', societa: v.societa || '', accessi: v.accessi || '', iscrizioni: v.iscrizioni || '', promemoria: v.promemoria || '' };
  }
  async function saveSettings(st) {
    const t = now(); let changed = false;
    settings = { values: Object.assign({}, settings.values), _mk: Object.assign({}, settings._mk) };
    for (const k of SETTING_KEYS) if (k in st && s(st[k]) !== s(settings.values[k])) { settings.values[k] = s(st[k]); settings._mk[k] = t; changed = true; }
    if (changed) await commitLocal([], [], { settings });
  }

  /* ---------------------------------------------------------------- operazioni */
  async function deleteExercise(id) {
    const e = mem.exercises.get(id); if (!e) return;
    const puts = [];
    for (const se of mem.sessions.values()) {
      if (!se.items.some(it => it.type === 'ex' && it.exId === id)) continue;
      const n = clone(se);
      n.items = n.items.map(it => it.type === 'ex' && it.exId === id
        ? { uid: it.uid, type: 'free', titolo: e.titolo, durata: it.durata, fondamentale: e.fondamentale, descrizione: [e.svolgimento, it.nota].filter(Boolean).join('\n') }
        : it);
      n._m = now(); puts.push(['sessions', n]);
    }
    await commitLocal(puts, [['exercises', id]]);
  }
  function seedExercise(e) {
    const t = Date.now();
    return { id: newId('ex'), titolo: e.titolo, fondamentale: e.fondamentale || '', formazione: e.formazione || '', durata: e.durata ?? '',
      organizzazione: e.organizzazione || '', materiale: e.materiale || '', intensita: e.intensita || '', distretto: e.distretto || '',
      dosaggio: e.dosaggio || null, svolgimento: e.svolgimento || '', puntoChiave: e.puntoChiave || '', variante: e.variante || '',
      note: e.note || '', image: e.image || null, schema: e.schema || null, origine: 'catalogo', createdAt: t, updatedAt: t };
  }
  async function insertMissingSeed(list) {
    const have = new Set([...mem.exercises.values()].map(e => e.titolo));
    const puts = [];
    for (const e of (list || [])) if (e && s(e.titolo).trim() && !have.has(e.titolo)) { const x = prep('exercises', seedExercise(e)); puts.push(['exercises', x]); }
    if (puts.length) await commitLocal(puts);
    return puts.length;
  }

  /* importazione (come import_data di app.py) */
  async function importData(data, mode) {
    if (data && data.data && typeof data.data === 'object') data = data.data;
    const exs = data.exercises, sess = data.sessions;
    if (!Array.isArray(exs) || !Array.isArray(sess)) throw new Error('Il file non è un backup valido dello schedario');
    await setMeta('primaImport', { at: Date.now(), state: fullState() });   // copia di sicurezza
    const puts = [], dels = [];
    let added = 0, updated = 0;
    // vista di lavoro: parte da quello che c'è (o da vuoto se "sostituisci")
    const W = {}; for (const c of COLS) W[c] = new Map(mem[c]);
    const wipe = c => { for (const id of W[c].keys()) dels.push([c, id]); W[c] = new Map(); };
    const put = (c, r) => { W[c].set(r.id, r); puts.push([c, r]); };
    if (mode === 'replace') { wipe('exercises'); wipe('sessions'); if (data.settings && typeof data.settings === 'object') await saveSettings(data.settings); }
    else if (data.settings && typeof data.settings === 'object') {   // unisci: prende le impostazioni del file solo dove qui sono vuote
      const cur = settings.values || {}, add = {};
      for (const k of SETTING_KEYS) if (!s(cur[k]).trim() && s(data.settings[k]).trim()) add[k] = data.settings[k];
      if (Object.keys(add).length) await saveSettings(add);
    }
    const ts = x => x || 0;
    const idmap = {};
    const exPrep = e => { const r = normEx(e, W.exercises.get(e.id)); r._m = now(); return r; };
    for (const e of exs) {
      if (!e.id || !s(e.titolo).trim()) continue;
      const cur = W.exercises.get(e.id);
      if (cur) { if (ts(e.updatedAt) > ts(cur.updatedAt)) { put('exercises', exPrep(e)); updated++; } continue; }
      let m = null;
      if (e.origine === 'catalogo') {
        for (const x of W.exercises.values()) if (x.origine === 'catalogo' && (x.titolo === s(e.titolo) || (x.image && x.image === e.image))) { m = x; break; }
      }
      if (m && !Object.values(idmap).includes(m.id)) {
        idmap[e.id] = m.id;
        const changedInFile = ts(e.updatedAt) > ts(e.createdAt) + 1000, untouched = ts(m.updatedAt) <= ts(m.createdAt) + 1000;
        if ((changedInFile && untouched) || ts(e.updatedAt) > ts(m.updatedAt)) { put('exercises', exPrep(Object.assign({}, e, { id: m.id, createdAt: m.createdAt }))); updated++; }
        continue;
      }
      put('exercises', exPrep(e)); added++;
    }
    // le sessioni devono vedere gli esercizi appena importati
    const saved = mem.exercises; mem.exercises = W.exercises;
    try {
      for (let x of sess) {
        if (!x.id) continue;
        x = Object.assign({}, x, { items: (x.items || []).map(it => Object.assign({}, it, { exId: idmap[it.exId] || it.exId })) });
        let cur = W.sessions.get(x.id);
        if (!cur) { for (const y of W.sessions.values()) if (s(y.titolo) === s(x.titolo) && s(y.data) === s(x.data)) { cur = y; x.id = y.id; break; } }
        const mk = () => { const r = normSess(x, cur); r._m = now(); return r; };
        if (!cur) { put('sessions', mk()); added++; } else if (ts(x.updatedAt) > ts(cur.updatedAt)) { put('sessions', mk()); updated++; }
      }
    } finally { mem.exercises = saved; }
    const generic = (c, list, same, valid) => {
      if (!Array.isArray(list)) return;
      if (mode === 'replace') wipe(c);
      for (let a of list) {
        if (!a.id || !valid(a)) continue;
        let cur = W[c].get(a.id);
        if (!cur) { for (const y of W[c].values()) if (same(y, a)) { cur = y; a = Object.assign({}, a, { id: y.id }); break; } }
        const mk = () => { const r = NORM[c](a, cur); r._m = now(); return r; };
        if (!cur) { put(c, mk()); added++; } else if (ts(a.updatedAt) > ts(cur.updatedAt)) { put(c, mk()); updated++; }
      }
    };
    const lc = v => s(v).toLowerCase();
    generic('athletes', data.athletes, (y, a) => lc(y.nome) === lc(a.nome) && lc(y.cognome) === lc(a.cognome) && s(y.dataNascita) === s(a.dataNascita),
      a => !!(s(a.nome).trim() || s(a.cognome).trim()));
    generic('matches', data.matches, (y, m) => !!m.data && s(y.data) === s(m.data) && lc(y.avversario) === lc(m.avversario), () => true);
    generic('trainings', data.trainings, (y, t) => s(y.data) === s(t.data) && s(y.ora) === s(t.ora), t => DATE_RE.test(s(t.data)));
    generic('payments', data.payments, (y, p) => s(y.atletaId) === s(p.atletaId) && s(y.descrizione) === s(p.descrizione) && s(y.scadenza) === s(p.scadenza), p => !!s(p.atletaId));
    generic('ledger', data.ledger, (y, m) => s(y.data) === s(m.data) && money(y.importo) === money(m.importo) && s(y.descrizione) === s(m.descrizione), m => DATE_RE.test(s(m.data)));
    generic('deadlines', data.deadlines, (y, d) => s(y.titolo) === s(d.titolo) && s(y.data) === s(d.data), d => !!s(d.titolo).trim() && DATE_RE.test(s(d.data)));
    generic('staff', data.staff, (y, a) => lc(y.nome) === lc(a.nome) && lc(y.cognome) === lc(a.cognome), a => !!(s(a.nome).trim() || s(a.cognome).trim()));
    if (data.files && typeof data.files === 'object') for (const [ref, url] of Object.entries(data.files)) if (/^[\w.-]+$/.test(ref) && typeof url === 'string' && url.startsWith('data:')) await putFile(ref, url);
    generic('docs', data.docs, (y, x) => s(y.file) === s(x.file) && s(y.rif) === s(x.rif), x => /^img:/.test(s(x.file)));
    generic('venues', data.venues, (y, x) => lc(y.nome) === lc(x.nome), x => !!s(x.nome).trim());
    generic('inventory', data.inventory, (y, x) => lc(y.articolo) === lc(x.articolo) && s(y.taglia) === s(x.taglia), x => !!s(x.articolo).trim());
    generic('notes', data.notes, (y, n) => s(y.titolo) === s(n.titolo) && s(y.testo) === s(n.testo), n => !!(s(n.titolo).trim() || s(n.testo).trim()));
    // un id messo e poi tolto nella stessa importazione: vale l'ultima operazione
    const finalPuts = new Map(), delSet = new Set();
    for (const [c, id] of dels) delSet.add(c + ':' + id);
    for (const [c, r] of puts) { finalPuts.set(c + ':' + r.id, [c, r]); delSet.delete(c + ':' + r.id); }
    await commitLocal([...finalPuts.values()], [...delSet].map(k => { const i = k.indexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; }));
    return { aggiunti: added, aggiornati: updated };
  }

  /* ---------------------------------------------------------------- "server" */
  const ROUTES = [[/^\/api\/quote\/([\w-]+)$/, 'payments'], [/^\/api\/movimenti\/([\w-]+)$/, 'ledger'], [/^\/api\/scadenze\/([\w-]+)$/, 'deadlines'],
    [/^\/api\/staff\/([\w-]+)$/, 'staff'], [/^\/api\/magazzino\/([\w-]+)$/, 'inventory'], [/^\/api\/palestre\/([\w-]+)$/, 'venues'], [/^\/api\/documenti\/([\w-]+)$/, 'docs'], [/^\/api\/esercizi\/([\w-]+)$/, 'exercises'], [/^\/api\/sessioni\/([\w-]+)$/, 'sessions'], [/^\/api\/atleti\/([\w-]+)$/, 'athletes'],
    [/^\/api\/partite\/([\w-]+)$/, 'matches'], [/^\/api\/allenamenti\/([\w-]+)$/, 'trainings'], [/^\/api\/note\/([\w-]+)$/, 'notes']];
  function route(url) { for (const [re, c] of ROUTES) { const m = re.exec(url); if (m) return [c, decodeURIComponent(m[1])]; } return [null, null]; }
  async function api(method, url, body) {
    url = url.split('?')[0];
    if (method === 'GET' && url === '/api/stato') return fullState();
    const [c, id] = route(url);
    if (method === 'PUT') {
      if (c) { const r = prep(c, Object.assign({}, body, { id })); await commitLocal([[c, r]]); return { ok: true }; }
      if (url === '/api/impostazioni') { await saveSettings(body || {}); return { ok: true }; }
    }
    if (method === 'DELETE' && c) {
      if (c === 'exercises') await deleteExercise(id); else await commitLocal([], [[c, id]]);
      return { ok: true };
    }
    if (method === 'POST') {
      if (url === '/api/importa') return importData((body && body.data) || {}, (body && body.mode) || 'merge');
      if (url === '/api/allenamenti-multipli') { const puts = (body.items || []).map(t => ['trainings', prep('trainings', t)]); await commitLocal(puts); return { aggiunti: puts.length }; }
      if (url === '/api/multipli') {   // più schede in un colpo solo: {items:[{c:'payments', r:{...}}]}
        const puts = (body.items || []).map(x => { if (!COLS.includes(x.c)) throw new Error('Collezione sconosciuta'); return [x.c, prep(x.c, x.r)]; });
        const dels = (body.dels || []).filter(x => COLS.includes(x.c)).map(x => [x.c, s(x.id)]);
        await commitLocal(puts, dels); return { salvati: puts.length, eliminati: dels.length };
      }
      if (url === '/api/ripristina-iniziali') return { aggiunti: await insertMissingSeed(body && body.exercises) };
    }
    throw new Error('Operazione non prevista: ' + method + ' ' + url);
  }

  /* ---------------------------------------------------------------- per la sincronizzazione */
  function snapshot() {
    const o = { seq, settings: clone(settings), tombs: Object.assign({}, tombs) };
    for (const c of COLS) o[c] = new Map(mem[c]);
    return o;
  }
  /* applica le modifiche arrivate dall'archivio online, senza sovrascrivere
     quello che è stato modificato qui nel frattempo */
  async function applyRemote(ch) {
    const puts = [], dels = [];
    for (const [c, r] of ch.puts) { const cur = mem[c].get(r.id); if (!cur || (cur._m || 0) < (r._m || 0)) { mem[c].set(r.id, r); puts.push([c, r]); } }
    for (const [c, id, t] of ch.dels) { const cur = mem[c].get(id); if (cur && (cur._m || 0) <= t) { mem[c].delete(id); dels.push([c, id]); } }
    for (const [k, t] of Object.entries(ch.tombs || {})) if ((tombs[k] || 0) < t) tombs[k] = t;
    let setChanged = false;
    if (ch.settings) {
      const v = Object.assign({}, settings.values), mk = Object.assign({}, settings._mk);
      for (const k of SETTING_KEYS) if ((ch.settings._mk?.[k] || 0) > (mk[k] || 0)) { v[k] = ch.settings.values[k]; mk[k] = ch.settings._mk[k]; setChanged = true; }
      if (setChanged) settings = { values: v, _mk: mk };
    }
    await write(puts, dels, { tombs, settings, lastM });
    const changed = puts.length + dels.length + (setChanged ? 1 : 0);
    if (changed) listeners.forEach(f => { try { f('remote'); } catch (e) { console.error(e); } });
    return changed;
  }
  async function replaceAll(data) {   // sostituisce tutto il contenuto locale (primo collegamento)
    const dels = []; for (const c of COLS) for (const id of mem[c].keys()) dels.push([c, id]);
    for (const c of COLS) mem[c] = new Map();
    const puts = [];
    for (const c of COLS) for (const r of data[c] || []) { mem[c].set(r.id, r); puts.push([c, r]); }
    settings = data.settings || { values: {}, _mk: {} }; tombs = data.tombs || {};
    for (const c of COLS) for (const r of mem[c].values()) lastM = Math.max(lastM, r._m || 0);
    await write(puts, dels.filter(([c, id]) => !mem[c].has(id)), { tombs, settings, lastM, seq });
    listeners.forEach(f => { try { f('remote'); } catch (e) { console.error(e); } });
  }
  /* dati lasciati da Volleysched nello stesso browser (stesso sito): si possono copiare qui una volta */
  async function legacyInfo() {
    try {
      if (indexedDB.databases) { const L = await indexedDB.databases(); if (!L.some(d => d.name === 'schedario-pallavolo')) return null; }
      else return null;
      const d = await new Promise((res, rej) => { const r = indexedDB.open('schedario-pallavolo'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} }; });
      const names = [...d.objectStoreNames], out = { counts: {}, data: {} };
      const cols = ['exercises', 'sessions', 'athletes', 'matches', 'trainings', 'notes'].filter(c => names.includes(c));
      if (!cols.length || !names.includes('meta')) { d.close(); return null; }
      const t = d.transaction([...cols, 'meta'], 'readonly');
      for (const c of cols) { out.data[c] = await reqP(t.objectStore(c).getAll()); out.counts[c] = out.data[c].length; }
      out.settings = await reqP(t.objectStore('meta').get('settings')); d.close();
      return Object.values(out.counts).some(n => n > 0) ? out : null;
    } catch (e) { console.warn('Volleysched non letto', e); return null; }
  }
  async function importLegacy() {
    const L = await legacyInfo(); if (!L) throw new Error('Non ho trovato dati di Volleysched in questo browser');
    const data = Object.assign({}, L.data, { settings: (L.settings && L.settings.values) || {} });
    return importData(data, 'merge');
  }
  /* modifiche arrivate dall'archivio di una squadra (le porta la segreteria):
     valgono come modifiche locali, così raggiungono anche l'archivio della società */
  async function applyTeam(puts = [], dels = []) {
    if (!puts.length && !dels.length) return 0;
    for (const [c, r] of puts) { mem[c].set(r.id, r); delete tombs[c + ':' + r.id]; lastM = Math.max(lastM, r._m || 0); }
    const t = now();
    for (const [c, id] of dels) { mem[c].delete(id); tombs[c + ':' + id] = t; }
    seq++;
    await write(puts, dels, { tombs, seq, lastM, settings });
    listeners.forEach(f => { try { f('remote'); } catch (e) { console.error(e); } });
    listeners.forEach(f => { try { f('local'); } catch (e) { console.error(e); } });
    return puts.length + dels.length;
  }
  /* cancella l'intero archivio di questo dispositivo (per ripartire da zero) */
  async function wipe() {
    try { if (idb) idb.close(); } catch (e) {}
    idb = null;
    await new Promise(res => { const r = indexedDB.deleteDatabase(DBNAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  }
  /* file dei documenti: fuori dalla memoria, letti solo quando servono */
  function fileTx(mode, fn) { return new Promise((res, rej) => { const t = idb.transaction(['files'], mode), st = t.objectStore('files'); const r = fn(st); t.oncomplete = () => res(r && 'result' in r ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Spazio esaurito?')); }); }
  const putFile = (ref, url) => fileTx('readwrite', st => st.put(url, ref));
  const getFile = ref => fileTx('readonly', st => st.get(ref)).catch(() => null);
  const delFile = ref => fileTx('readwrite', st => st.delete(ref));
  const fileKeys = () => fileTx('readonly', st => st.getAllKeys()).catch(() => []);
  function isEmpty() { return COLS.every(c => mem[c].size === 0); }

  return {
    COLS, init: async () => { idb = await open(); await loadAll(); }, api, fullState, snapshot, applyRemote, replaceAll, isEmpty,
    getMeta: k => meta[k], setMeta, onChange: f => listeners.add(f), seq: () => seq,
    insertMissingSeed, seedExercise, prep, commitLocal, legacyInfo, importLegacy, money, applyTeam, getSettings, stamp: () => now(), wipe, putFile, getFile, delFile, fileKeys,
    list: c => [...(mem[c] || new Map()).values()].map(strip),   // una sola collezione (tutte le squadre)
    counts: () => Object.fromEntries(COLS.map(c => [c, mem[c].size]))
  };
})();
