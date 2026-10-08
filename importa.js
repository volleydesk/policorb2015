"use strict";
/* ==================================================================
   Volleydesk – importazione da Excel / CSV
   Atleti, quote (con i pagamenti già fatti) e movimenti di prima nota.
   Si sceglie un file .xlsx/.xls/.csv oppure si incollano le righe
   copiate da Excel; l'app riconosce le colonne dai titoli e mostra
   un'anteprima prima di importare.
   ================================================================== */
const IMP_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const IMP_TIPI = {
  atleti: { l: 'Atleti', ic: '👥', fields: [
    ['cognome','Cognome',['cognome','surname','last name']], ['nome','Nome',['nome','name','first name']],
    ['cognomeNome','Cognome e nome',['cognome e nome','cognome nome','nominativo','atleta','giocatore','giocatrice']], ['nomeCognome','Nome e cognome',['nome e cognome','nome cognome']],
    ['sesso','Sesso',['sesso','genere','m f','sex']], ['dataNascita','Data di nascita',['data di nascita','data nascita','nato il','nata il','nascita','data nasc']],
    ['luogoNascita','Luogo di nascita',['luogo di nascita','luogo nascita','nato a','nata a','comune di nascita']], ['codiceFiscale','Codice fiscale',['codice fiscale','cf','c f','cod fiscale','codfisc']],
    ['cellulare','Cellulare',['cellulare','telefono','cell','tel','telefono atleta','cellulare atleta']], ['email','Email',['email','e mail','mail','email atleta']],
    ['indirizzo','Indirizzo',['indirizzo','via','residenza','indirizzo di residenza']], ['citta','CAP e città',['citta','comune','comune di residenza','cap','localita']],
    ['genitore','Genitore',['genitore','nome genitore','genitore 1','padre','madre','tutore','chi paga']], ['cfGenitore','C.F. del genitore',['cf genitore','codice fiscale genitore','c f genitore']],
    ['telGenitore','Cellulare del genitore',['cellulare genitore','telefono genitore','tel genitore','cell genitore']], ['emailGenitore','Email del genitore',['email genitore','mail genitore','e mail genitore']],
    ['squadra','Squadra',['squadra','categoria','gruppo','team']], ['ruolo','Ruolo',['ruolo','posizione']], ['numeroMaglia','N° di maglia',['maglia','numero maglia','n maglia','numero']],
    ['taglia','Taglia',['taglia','size']], ['scadenzaVisita','Scadenza visita medica',['scadenza visita','visita medica','scadenza certificato','certificato medico','visita']],
    ['numeroDocumento','N° documento',['numero documento','documento','carta identita','n documento']], ['scadenzaDocumento','Scadenza documento',['scadenza documento','scadenza carta identita']],
    ['tessera','N° tessera',['tessera','n tessera','numero tessera','matricola']], ['scadenzaTessera','Scadenza tessera',['scadenza tessera']],
    ['privacy','Privacy firmata',['privacy','consenso privacy']], ['note','Note',['note','allergie','annotazioni']]
  ]},
  quote: { l: 'Quote e pagamenti', ic: '💶', fields: [
    ['atleta','Atleta (nome completo)',['atleta','nominativo','cognome e nome','nome e cognome','giocatore','giocatrice']], ['cognome','Cognome',['cognome']], ['nome','Nome',['nome']],
    ['codiceFiscale','Codice fiscale',['codice fiscale','cf','c f']], ['voce','Voce',['voce','tipo','tipologia']], ['descrizione','Descrizione',['descrizione','causale','rata','quota']],
    ['stagione','Stagione',['stagione','anno']], ['importo','Importo dovuto',['importo','dovuto','totale','quota dovuta','importo dovuto']],
    ['scadenza','Scadenza',['scadenza','entro il','data scadenza']], ['versato','Già versato',['versato','pagato','incassato','importo pagato','importo versato']],
    ['dataPagamento','Data del pagamento',['data pagamento','pagato il','data versamento','data incasso']], ['metodo','Modalità',['modalita','metodo','pagamento','modalita pagamento']],
    ['ricevuta','N° ricevuta',['ricevuta','n ricevuta','numero ricevuta']], ['note','Note',['note']]
  ]},
  movimenti: { l: 'Movimenti di prima nota', ic: '📒', fields: [
    ['data','Data',['data','giorno','data movimento','data operazione']], ['tipo','Entrata/uscita',['tipo','entrata uscita','e u','segno']],
    ['importo','Importo',['importo','totale','euro']], ['entrata','Entrata',['entrata','entrate','dare','avere entrate']], ['uscita','Uscita',['uscita','uscite','spesa','spese']],
    ['categoria','Categoria',['categoria','capitolo','conto']], ['descrizione','Descrizione',['descrizione','causale','dettaglio']],
    ['controparte','Da / a chi',['controparte','fornitore','cliente','beneficiario','da chi','a chi']], ['metodo','Modalità',['modalita','metodo','pagamento','cassa banca']],
    ['documento','N° documento',['documento','fattura','n fattura','ricevuta','scontrino']], ['note','Note',['note']]
  ]}
};
const impNorm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const impTxt = v => v == null ? '' : String(v).trim();

/* ---------------------------------------------------------------- lettura dei file */
function impCsv(text){
  text = text.replace(/^﻿/, '');
  /* separatore: quello più presente nelle prime righe (gli estratti conto hanno righe di intestazione senza separatori) */
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 15);
  const cnt = c => Math.max(0, ...lines.map(l => (l.match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) || []).length));
  const sep = ['\t', ';', ','].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], cell = '', q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if(ch === '"' && cell === '') q = true;
    else if(ch === sep){ row.push(cell); cell = ''; }
    else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if(cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}
function impLoadXlsx(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = IMP_XLSX; s.onload = () => res(); s.onerror = () => rej(new Error('Per leggere i file Excel serve la connessione a internet (la prima volta). In alternativa salva il file come CSV oppure copia e incolla le righe.')); document.head.appendChild(s); });
}
async function impReadFile(f){
  if(/\.(xlsx|xlsm|xls|ods)$/i.test(f.name)){
    await impLoadXlsx();
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    return rows.map(r => r.map(v => v instanceof Date ? toISO(new Date(v.getTime() + 12 * 36e5)) : v)).filter(r => r.some(c => impTxt(c)));
  }
  return impCsv(await f.text());
}

/* ---------------------------------------------------------------- conversione dei valori */
function impDate(v){
  if(v == null || v === '') return '';
  if(typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())){ const n = +v; if(n > 1000 && n < 80000){ const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return d.toISOString().slice(0, 10); } return ''; }
  const s = String(v).trim(); let m;
  if((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return impYmd(+m[1], +m[2], +m[3]);
  if((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))){ let y = +m[3]; if(y < 100) y += y > (new Date().getFullYear() % 100) + 1 ? 1900 : 2000; return impYmd(y, +m[2], +m[1]); }
  return '';
}
function impYmd(y, mo, d){ if(mo < 1 || mo > 12 || d < 1 || d > 31) return ''; const x = new Date(y, mo - 1, d); return x.getMonth() === mo - 1 ? toISO(x) : ''; }
function impMoney(v){
  if(v == null || v === '') return null; if(typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).replace(/[€\s]/g, ''); const neg = /^\(.*\)$/.test(s) || /^-/.test(s); s = s.replace(/[()+-]/g, '');
  if(s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if(s.includes(',')) s = s.replace(',', '.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s); return isNaN(n) ? null : Math.round((neg ? -n : n) * 100) / 100;
}
function impSex(v){ const s = impNorm(v); if(/^(m|maschio|maschile|uomo|male|ragazzo)$/.test(s)) return 'M'; if(/^(f|femmina|femminile|donna|female|ragazza)$/.test(s)) return 'F'; return ''; }
function impBool(v){ const s = impNorm(v); return /^(si|s|x|yes|y|1|vero|true|firmata|ok)$/.test(s) ? 'si' : ''; }
/* dal codice fiscale si ricavano sesso e data di nascita */
function impFromCF(cf){
  const m = /^[A-Z]{6}([0-9LMNPQRSTUV]{2})([ABCDEHLMPRST])([0-9LMNPQRSTUV]{2})[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.exec(String(cf || '').toUpperCase()); if(!m) return null;
  const om = c => c.replace(/[LMNPQRSTUV]/g, x => 'LMNPQRSTUV'.indexOf(x));
  const yy = +om(m[1]), mo = 'ABCDEHLMPRST'.indexOf(m[2]) + 1; let dd = +om(m[3]); const sex = dd > 40 ? 'F' : 'M'; if(dd > 40) dd -= 40;
  const y = yy + (yy > (new Date().getFullYear() % 100) ? 1900 : 2000);
  return { sesso: sex, dataNascita: impYmd(y, mo, dd) };
}
function impTeam(v){ const s = impNorm(v); if(!s) return null; const L = teamsRaw(); const t = L.find((x, i) => impNorm(teamLabel(x, i)) === s) || L.find((x, i) => impNorm(teamLabel(x, i)).includes(s) || s.includes(impNorm(teamLabel(x, i)))); return t ? t.id : null; }

/* ---------------------------------------------------------------- abbinamento automatico delle colonne */
function impGuess(tipo, head){
  const F = IMP_TIPI[tipo].fields, used = new Set(), map = {};
  head.forEach((h, i) => {
    const n = impNorm(h); if(!n) return;
    let best = null, score = 0;
    for(const [k, , syn] of F){ if(used.has(k)) continue;
      for(const s of syn){ const sc = n === s ? 3 : (n.startsWith(s + ' ') || n.endsWith(' ' + s)) ? 2 : (s.length > 3 && n.includes(s)) ? 1 : 0; if(sc > score){ score = sc; best = k; } } }
    if(best){ map[i] = best; used.add(best); }
  });
  return map;
}

/* ---------------------------------------------------------------- interfaccia */
function openImport(tipo){
  ui.imp = { tipo: tipo || (ui.view === 'societa' && ui.socTab === 'cassa' ? 'movimenti' : ui.view === 'societa' && ui.socTab === 'quote' ? 'quote' : 'atleti'), rows: null, head: true, map: {}, team: teamMulti() ? teamCur() : '', iscritti: true, aggiorna: true, paste: '' };
  impRender();
}
function impRender(){
  const o = ui.imp, T = IMP_TIPI[o.tipo];
  const tipi = Object.entries(IMP_TIPI).filter(([k]) => k === 'atleti' || !(typeof isCoach === 'function' && isCoach()));
  if(!o.rows){
    openModal(`<div class="modal-box" style="max-width:640px"><div class="modal-head"><div style="flex:1"><h2>Importa da Excel o CSV</h2><div class="muted" style="font-size:13.5px;margin-top:3px">Per partire con i dati che hai già in un foglio di calcolo.</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
      <div class="modal-body">
        <div class="chips" style="margin-bottom:14px">${tipi.map(([k, t]) => `<button class="chip ${o.tipo === k ? 'on' : ''}" data-action="imp-tipo" data-v="${k}">${t.ic} ${t.l}</button>`).join('')}</div>
        <div class="imp-drop"><button class="btn primary" data-action="imp-file">📄 Scegli il file (.xlsx, .xls, .csv)</button><span class="muted" style="font-size:13px">Viene letto il primo foglio. La prima riga dovrebbe contenere i titoli delle colonne.</span></div>
        <label class="f" style="margin-top:14px">Oppure incolla qui le righe copiate da Excel (titoli compresi)<textarea id="imp-paste" rows="6" placeholder="Cognome	Nome	Data di nascita	…">${esc(o.paste)}</textarea></label>
        <div class="actions" style="margin-top:8px"><button class="btn" data-action="imp-paste">Usa il testo incollato</button><span style="flex:1"></span><button class="btn sm ghost" data-action="imp-model">⬇ Scarica un modello per ${esc(T.l.toLowerCase())}</button></div>
        ${o.tipo === 'quote' ? '<p class="muted" style="font-size:12.5px;margin-bottom:0">Gli atleti devono essere già in anagrafica: vengono riconosciuti dal codice fiscale o dal nome e cognome. Se c\'è una colonna «Già versato», l\'app registra anche il pagamento.</p>' : ''}
      </div></div>`);
    return;
  }
  const head = o.head ? o.rows[0] : o.rows[0].map((_, i) => 'Colonna ' + (i + 1)), data = o.head ? o.rows.slice(1) : o.rows;
  const P = impPlan(), opts = (sel) => `<option value="">— non importare —</option>${T.fields.map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  const sample = i => data.slice(0, 3).map(r => impTxt(r[i])).filter(Boolean).map(v => esc(v.length > 24 ? v.slice(0, 22) + '…' : v)).join(' · ');
  openModal(`<div class="modal-box" style="max-width:880px"><div class="modal-head"><div style="flex:1"><h2>${T.ic} ${esc(T.l)}: controlla le colonne</h2><div class="muted" style="font-size:13.5px;margin-top:3px">${data.length} righe. Ho abbinato le colonne dai titoli: correggi dove serve.</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body">
      <label class="sw" style="margin-bottom:6px"><input type="checkbox" data-impo="head" ${o.head ? 'checked' : ''}> La prima riga contiene i titoli delle colonne</label>
      <div class="imp-map">${head.map((h, i) => `<div><span class="h"><b>${esc(impTxt(h) || '(senza titolo)')}</b><small>${sample(i) || '<i>vuota</i>'}</small></span><select data-impmap="${i}">${opts(o.map[i])}</select></div>`).join('')}</div>
      ${o.tipo === 'atleti' ? `<div class="grid g3" style="margin-top:14px;align-items:end">
        ${teamMulti() ? `<label class="f">Squadra dei nuovi atleti<select data-impo="team">${teamsRaw().map((t, i) => `<option value="${t.id}" ${o.team === t.id ? 'selected' : ''}>${esc(teamLabel(t, i))}</option>`).join('')}</select></label>` : ''}
        <label class="sw"><input type="checkbox" data-impo="iscritti" ${o.iscritti ? 'checked' : ''}> Segna i nuovi come iscritti</label>
        <label class="sw"><input type="checkbox" data-impo="aggiorna" ${o.aggiorna ? 'checked' : ''}> Completa gli atleti già presenti</label></div>` : ''}
      <h3 class="sd-h3">Anteprima</h3>
      <div class="imp-sum"><span class="ok">${P.nuovi} nuov${P.nuovi === 1 ? 'o' : 'i'}</span>${P.agg ? `<span>${P.agg} da aggiornare</span>` : ''}${P.skip.length ? `<span class="bad">${P.skip.length} righe scartate</span>` : ''}</div>
      <div class="imp-prev">${P.preview.slice(0, 12).map(x => `<div class="${x.st}"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></div>`).join('')}${P.preview.length > 12 ? `<div class="muted">… e altre ${P.preview.length - 12}</div>` : ''}</div>
      ${P.skip.length ? `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer">Perché alcune righe sono scartate</summary><div class="imp-prev">${P.skip.slice(0, 30).map(x => `<div class="skip"><b>Riga ${x.n}</b><small>${esc(x.why)}</small></div>`).join('')}</div></details>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" data-action="imp-back">← Indietro</button><span style="flex:1"></span><button class="btn" data-action="close-modal">Annulla</button><button class="btn primary" data-action="imp-go" ${P.items.length ? '' : 'disabled'}>Importa ${P.items.length ? P.nuovi + P.agg : ''}</button></div></div>`);
}

/* ---------------------------------------------------------------- calcolo di cosa importare */
function impPlan(){
  const o = ui.imp, data = o.head ? o.rows.slice(1) : o.rows, F = {};
  Object.entries(o.map).forEach(([i, k]) => { if(k) F[k] = +i; });
  const get = (r, k) => F[k] === undefined ? '' : r[F[k]];
  const out = { items: [], nuovi: 0, agg: 0, skip: [], preview: [] };
  const rowN = j => j + (o.head ? 2 : 1);
  if(o.tipo === 'atleti') impPlanAtleti(data, get, out, rowN);
  else if(o.tipo === 'quote') impPlanQuote(data, get, out, rowN);
  else impPlanMov(data, get, out, rowN);
  return out;
}
const impKey = (c, n) => impNorm(c) + '|' + impNorm(n);
function impFindAt(L, cf, cog, nom, nasc){
  if(cf){ const a = L.find(x => (x.codiceFiscale || '').toUpperCase() === cf); if(a) return a; }
  const k = impKey(cog, nom), k2 = impKey(nom, cog);
  const C = L.filter(x => impKey(x.cognome, x.nome) === k || impKey(x.cognome, x.nome) === k2);
  if(C.length === 1) return (!nasc || !C[0].dataNascita || C[0].dataNascita === nasc) ? C[0] : null;
  return C.find(x => nasc && x.dataNascita === nasc) || null;
}
function impSplitName(full, cognomePrima){
  const p = impTxt(full).split(/\s+/).filter(Boolean); if(p.length < 2) return [p[0] || '', ''];
  return cognomePrima ? [p[0], p.slice(1).join(' ')] : [p[p.length - 1], p.slice(0, -1).join(' ')];
}
function impPlanAtleti(data, get, out, rowN){
  const o = ui.imp, L = [...Store.list('athletes'), ...Store.trash().filter(x => x._c === 'athletes')], seen = new Map();
  const FIELDS = ['sesso','dataNascita','luogoNascita','codiceFiscale','cellulare','email','genitore','cfGenitore','telGenitore','emailGenitore','ruolo','numeroMaglia','taglia','scadenzaVisita','numeroDocumento','scadenzaDocumento','tessera','scadenzaTessera','privacy','note'];
  const DATES = ['dataNascita','scadenzaVisita','scadenzaDocumento','scadenzaTessera'];
  data.forEach((r, j) => {
    let cog = impTxt(get(r, 'cognome')), nom = impTxt(get(r, 'nome'));
    if(!cog && !nom && impTxt(get(r, 'cognomeNome'))) [cog, nom] = impSplitName(get(r, 'cognomeNome'), true);
    if(!cog && !nom && impTxt(get(r, 'nomeCognome'))) [cog, nom] = impSplitName(get(r, 'nomeCognome'), false);
    if(!cog && !nom){ if(r.some(c => impTxt(c))) out.skip.push({ n: rowN(j), why: 'manca il nome' }); return; }
    const v = {};
    for(const k of FIELDS){
      let x = get(r, k);
      if(DATES.includes(k)){ const d = impDate(x); if(impTxt(x) && !d){ out.skip.push({ n: rowN(j), why: `data non riconosciuta in «${impTxt(x)}»: il resto della riga è importato` }); } x = d; }
      else if(k === 'sesso') x = impSex(x);
      else if(k === 'privacy') x = impTxt(x) ? impBool(x) : '';
      else if(k === 'codiceFiscale' || k === 'cfGenitore') x = impTxt(x).toUpperCase().replace(/\s+/g, '');
      else x = impTxt(x);
      if(x) v[k] = x;
    }
    const ind = [impTxt(get(r, 'indirizzo')), impTxt(get(r, 'citta'))].filter(Boolean).join(', '); if(ind) v.indirizzo = ind;
    const cfx = v.codiceFiscale && impFromCF(v.codiceFiscale); if(cfx){ if(!v.sesso) v.sesso = cfx.sesso; if(!v.dataNascita) v.dataNascita = cfx.dataNascita; }
    const team = impTeam(get(r, 'squadra'));
    const dupKey = v.codiceFiscale || impKey(cog, nom) + '|' + (v.dataNascita || '');
    if(seen.has(dupKey)){ out.skip.push({ n: rowN(j), why: 'ripete la riga ' + seen.get(dupKey) }); return; } seen.set(dupKey, rowN(j));
    const ex = impFindAt(L, v.codiceFiscale, cog, nom, v.dataNascita);
    if(ex){
      if(!o.aggiorna){ out.skip.push({ n: rowN(j), why: fullName(ex) + ' è già presente' }); return; }
      const a = clone(ex); let ch = []; delete a._c;
      if(a.cestino){ a.cestino = ''; ch.push('torna dal cestino'); }
      for(const [k, x] of Object.entries(v)) if(String(a[k] || '') !== x){ a[k] = x; ch.push(k); }
      if(team && teamMulti() && !atTeams(a).includes(team)){ a.squadre = [...new Set([...(a.squadre || []).filter(Boolean), team])]; ch.push('squadra'); }
      if(!ch.length){ out.preview.push({ st: 'same', t: fullName(a), s: 'già presente, niente da aggiornare' }); return; }
      a.updatedAt = Date.now(); out.items.push({ c: 'athletes', r: a }); out.agg++;
      out.preview.push({ st: 'upd', t: fullName(a), s: 'aggiorna: ' + ch.length + ' camp' + (ch.length === 1 ? 'o' : 'i') });
    } else {
      const a = Object.assign({ id: newId('at'), nome: nom, cognome: cog, iscritto: o.iscritti, squadre: teamMulti() ? [team || o.team] : [], createdAt: Date.now(), updatedAt: Date.now() }, v);
      out.items.push({ c: 'athletes', r: a }); out.nuovi++;
      out.preview.push({ st: 'new', t: fullName(a), s: [v.dataNascita ? shortDate(v.dataNascita) : '', v.codiceFiscale || '', teamMulti() ? (teamsRaw().find(t => t.id === a.squadre[0]) || {}).squadra || '' : ''].filter(Boolean).join(' · ') || 'nuovo atleta' });
    }
  });
}
function impPlanQuote(data, get, out, rowN){
  const L = Store.list('athletes'), P = Store.list('payments');
  data.forEach((r, j) => {
    let cog = impTxt(get(r, 'cognome')), nom = impTxt(get(r, 'nome')); const cf = impTxt(get(r, 'codiceFiscale')).toUpperCase();
    let a = null;
    if(!cog && !nom && impTxt(get(r, 'atleta'))){ const [c1, n1] = impSplitName(get(r, 'atleta'), true); a = impFindAt(L, cf, c1, n1, ''); if(!a){ const [c2, n2] = impSplitName(get(r, 'atleta'), false); a = impFindAt(L, cf, c2, n2, ''); } cog = c1; nom = n1; }
    else a = impFindAt(L, cf, cog, nom, '');
    const label = impTxt(get(r, 'atleta')) || [cog, nom].filter(Boolean).join(' ');
    if(!label && !cf){ if(r.some(c => impTxt(c))) out.skip.push({ n: rowN(j), why: "manca l'atleta" }); return; }
    if(!a){ out.skip.push({ n: rowN(j), why: `«${label || cf}» non è in anagrafica (importa prima gli atleti)` }); return; }
    const imp = impMoney(get(r, 'importo')), vers = impMoney(get(r, 'versato'));
    const importo = imp != null ? imp : vers;
    if(!importo){ out.skip.push({ n: rowN(j), why: 'manca l\'importo' }); return; }
    const scad = impDate(get(r, 'scadenza')), voce = impTxt(get(r, 'voce')) || 'Quota', descr = impTxt(get(r, 'descrizione')) || voce;
    const stag = impTxt(get(r, 'stagione')) || socSeasonOf(scad || impDate(get(r, 'dataPagamento')) || todayISO());
    if(P.some(p => p.atletaId === a.id && (p.descrizione || '') === descr && (p.scadenza || '') === scad && Math.abs(p.importo - importo) < .005)){ out.skip.push({ n: rowN(j), why: fullName(a) + ': quota già presente' }); return; }
    const p = { id: newId('qt'), atletaId: a.id, stagione: stag, voce, descrizione: descr, importo, scadenza: scad, note: impTxt(get(r, 'note')), incassi: [], createdAt: Date.now(), updatedAt: Date.now() };
    if(vers){ const dp = impDate(get(r, 'dataPagamento')) || scad || todayISO(); const payer = socPayer(a);
      p.incassi = [{ id: newId('in'), data: dp, importo: vers, metodo: impTxt(get(r, 'metodo')), ricevuta: impTxt(get(r, 'ricevuta')), pagatoDa: payer.nome, cfPagante: payer.cf, note: 'importato' }]; }
    out.items.push({ c: 'payments', r: p }); out.nuovi++;
    out.preview.push({ st: 'new', t: fullName(a) + ' – ' + descr, s: [eur(importo), scad ? 'scadenza ' + shortDate(scad) : '', vers ? 'versati ' + eur(vers) : 'da pagare'].filter(Boolean).join(' · ') });
  });
}
function impPlanMov(data, get, out, rowN){
  const M = Store.list('ledger');
  data.forEach((r, j) => {
    const d = impDate(get(r, 'data'));
    if(!d){ if(r.some(c => impTxt(c))) out.skip.push({ n: rowN(j), why: impTxt(get(r, 'data')) ? `data non riconosciuta in «${impTxt(get(r, 'data'))}»` : 'manca la data' }); return; }
    let imp = impMoney(get(r, 'importo')), tipo = '';
    const e = impMoney(get(r, 'entrata')), u = impMoney(get(r, 'uscita')), t = impNorm(get(r, 'tipo'));
    if(e) { imp = e; tipo = 'E'; } else if(u){ imp = u; tipo = 'U'; }
    if(!tipo){ if(/^(e|entrata|entrate|in|incasso|\+|avere)/.test(t)) tipo = 'E'; else if(/^(u|uscita|uscite|out|spesa|\-|dare)/.test(t)) tipo = 'U'; else if(imp != null) tipo = imp < 0 ? 'U' : 'E'; }
    if(!imp){ out.skip.push({ n: rowN(j), why: "manca l'importo" }); return; }
    imp = Math.abs(imp); const descr = impTxt(get(r, 'descrizione'));
    if(M.some(m => m.data === d && Math.abs(m.importo - imp) < .005 && (m.descrizione || '') === descr)){ out.skip.push({ n: rowN(j), why: 'movimento già presente' }); return; }
    const m = { id: newId('mv'), data: d, tipo, importo: imp, categoria: impTxt(get(r, 'categoria')), descrizione: descr, controparte: impTxt(get(r, 'controparte')),
      metodo: impTxt(get(r, 'metodo')), documento: impTxt(get(r, 'documento')), note: impTxt(get(r, 'note')), stagione: socSeasonOf(d), squadra: '', createdAt: Date.now(), updatedAt: Date.now() };
    out.items.push({ c: 'ledger', r: m }); out.nuovi++;
    out.preview.push({ st: 'new', t: (tipo === 'E' ? '+ ' : '− ') + eur(imp) + ' · ' + (descr || m.categoria || 'movimento'), s: [shortDate(d), m.categoria, m.controparte].filter(Boolean).join(' · ') });
  });
}
async function impGo(){
  const P = impPlan(); if(!P.items.length) return;
  const btn = $('[data-action=imp-go]'); if(btn){ btn.disabled = true; btn.textContent = 'Importo…'; }
  try{
    for(let i = 0; i < P.items.length; i += 200) await api('POST', '/api/multipli', { items: P.items.slice(i, i + 200) });
  }catch(e){ alert('Importazione non riuscita: ' + (e.message || e)); if(btn){ btn.disabled = false; btn.textContent = 'Importa'; } return; }
  ui.imp = null; closeModal(); if(typeof SOCD !== 'undefined') SOCD = null; await loadState(); render();
  toast(`Importati: ${P.nuovi} nuovi${P.agg ? ', ' + P.agg + ' aggiornati' : ''}${P.skip.length ? ' · ' + P.skip.length + ' righe scartate' : ''}`);
}
function impModel(){
  const o = ui.imp, ex = {
    atleti: [['Cognome','Nome','Sesso','Data di nascita','Luogo di nascita','Codice fiscale','Cellulare','Email','Indirizzo','Genitore','C.F. genitore','Cellulare genitore','Email genitore','Squadra','Ruolo','Maglia','Taglia','Scadenza visita','Tessera','Privacy','Note'],
             ['Rossi','Giulia','F','15/03/2013','Magenta (MI)','','','','Via Roma 1, 20011 Corbetta','Paolo Rossi','','333 1234567','paolo.rossi@esempio.it', teamMulti() ? (teamsRaw()[0] || {}).squadra || '' : '','Banda','7','S','30/06/2027','','sì','']],
    quote: [['Atleta','Codice fiscale','Voce','Descrizione','Stagione','Importo','Scadenza','Già versato','Data pagamento','Modalità','Ricevuta','Note'],
            ['Rossi Giulia','','Quota di iscrizione','Prima rata', socSeasonOf(todayISO()),'150','15/10/2026','150','10/10/2026','Bonifico','','']],
    movimenti: [['Data','Entrata/uscita','Importo','Categoria','Descrizione','Da / a chi','Modalità','N° documento','Note'],
                ['01/10/2026','Uscita','420','Affitto palestra','Affitto palestra ottobre','Comune','Bonifico','Fatt. 118','']]
  }[o.tipo];
  socCsv('modello-' + o.tipo + '.csv', ex[0], [ex[1]]);
}
Object.assign(actions, {
  'imp-xl': b => openImport(b.dataset.t),
  'imp-tipo': b => { ui.imp.tipo = b.dataset.v; ui.imp.paste = ($('#imp-paste') || {}).value || ''; impRender(); },
  'imp-model': () => impModel(),
  'imp-file': () => { const inp = $('#filepick'); inp.value = ''; inp.accept = '.xlsx,.xls,.xlsm,.ods,.csv,.txt';
    inp.onchange = async () => { const f = inp.files[0]; if(!f) return; try{ impSetRows(await impReadFile(f)); }catch(e){ alert(e.message || e); } }; inp.click(); },
  'imp-paste': () => { const t = ($('#imp-paste') || {}).value || ''; if(!t.trim()){ alert('Incolla prima le righe copiate da Excel.'); return; } ui.imp.paste = t; impSetRows(impCsv(t)); },
  'imp-back': () => { ui.imp.rows = null; impRender(); },
  'imp-go': () => impGo()
});
function impSetRows(rows){
  if(!rows.length){ alert('Nel file non ho trovato righe da importare.'); return; }
  const w = Math.max(...rows.map(r => r.length)); rows = rows.map(r => { const x = r.slice(); while(x.length < w) x.push(''); return x; });
  const o = ui.imp; o.rows = rows; o.map = impGuess(o.tipo, rows[0]);
  o.head = Object.keys(o.map).length > 0;
  if(!o.head) o.map = {};
  impRender();
}
document.addEventListener('change', e => {
  const t = e.target; if(!ui.imp || !ui.imp.rows) return;
  if(t.dataset.impmap !== undefined){ const k = t.value; if(k) for(const [i, v] of Object.entries(ui.imp.map)) if(v === k && i !== t.dataset.impmap) delete ui.imp.map[i]; ui.imp.map[t.dataset.impmap] = k; impRender(); return; }
  if(t.dataset.impo){ const k = t.dataset.impo; ui.imp[k] = t.type === 'checkbox' ? t.checked : t.value; if(k === 'head' && t.checked && !Object.keys(ui.imp.map).some(i => ui.imp.map[i])) ui.imp.map = impGuess(ui.imp.tipo, ui.imp.rows[0]); impRender(); }
});

/* pulsanti nelle pagine */
const _impViewAtleti = viewAtleti;
viewAtleti = function(){ return _impViewAtleti().replace('<button class="btn" data-action="print-at">', '<button class="btn" data-action="imp-xl" data-t="atleti">📥 Importa da Excel</button><button class="btn" data-action="print-at">'); };
const _impQuote = socQuoteHTML, _impCassa = socCassaHTML;
socQuoteHTML = function(s){ return _impQuote(s).replace('<button class="btn" data-action="soc-csv-quote">', '<button class="btn" data-action="imp-xl" data-t="quote">📥 Importa</button><button class="btn" data-action="soc-csv-quote">'); };
socCassaHTML = function(s){ return _impCassa(s).replace('<button class="btn" data-action="soc-csv-led">', '<button class="btn" data-action="imp-xl" data-t="movimenti">📥 Importa</button><button class="btn" data-action="soc-csv-led">'); };
