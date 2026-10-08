"use strict";
/* ==================================================================
   Volleydesk – iscrizione online delle famiglie (senza server)
   1. La segreteria crea un link al modulo iscrizione.html. Nel link (dopo
      il #, che non viene mai inviato a nessun sito) ci sono il nome della
      società, le squadre e una chiave PUBBLICA generata qui.
   2. La famiglia compila il modulo dal telefono; i dati vengono cifrati con
      quella chiave e inviati alla segreteria via WhatsApp o email come
      codice «VDI1-…».
   3. La segreteria incolla il messaggio qui: solo questa app, che ha la
      chiave PRIVATA (salvata nelle impostazioni della società), lo legge,
      e con un tocco crea o aggiorna la scheda dell'atleta.
   ================================================================== */
const ISC_RE = /VDI1-([zn])\.([\w-]+)\.([\w-]+)\.([\w-]+)!/g;
const iscB64u = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const iscUnb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
function iscCfg(){ try{ const v = JSON.parse((db.settings && db.settings.iscrizioni) || '{}'); return v && typeof v === 'object' ? v : {}; }catch(e){ return {}; } }
async function iscSet(patch){ const v = Object.assign(iscCfg(), patch); db.settings.iscrizioni = JSON.stringify(v); await persist.settings(); }
async function iscKeys(){
  const c = iscCfg(); if(c.pub && c.priv) return c;
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const pub = iscB64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  await iscSet({ pub, priv }); return iscCfg();
}
function iscLink(){
  const c = iscCfg(), sc = socCfg(); if(!c.pub) return '';
  const teams = accTeams().filter(t => !c.squadre || !c.squadre.length || c.squadre.includes(t.id || '_')).map(t => [t.id || '_', t.nome]);
  const conf = { v: 1, k: c.pub, s: sc.ragioneSociale || db.settings.squadra || '', st: c.stagione || socSeasonOf(todayISO()), t: teams, wa: waNumber(c.wa || ''), em: c.email || '', pu: c.privacyUrl || '', n: c.note || '' };
  return new URL('iscrizione.html', location.href.split('#')[0].split('?')[0]).href + '#c=' + iscB64u(new TextEncoder().encode(JSON.stringify(conf)));
}
async function iscDecrypt(m){
  const c = iscCfg(); if(!c.priv) throw new Error('Su questo dispositivo manca la chiave delle iscrizioni');
  const priv = await crypto.subtle.importKey('jwk', c.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const eph = await crypto.subtle.importKey('raw', iscUnb64u(m[2]), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: eph }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iscUnb64u(m[3]) }, key, iscUnb64u(m[4])));
  if(m[1] === 'z') data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(data));
}
const iscHash = m => m[4].slice(0, 24);

/* ---------------------------------------------------------------- scheda «Iscrizioni» */
SOC_TABS.splice(SOC_TABS.findIndex(t => t[0] === 'dati'), 0, ['iscrizioni', 'Iscrizioni online']);
const _iscViewSocieta = viewSocieta;
viewSocieta = function(){
  if(ui.socTab !== 'iscrizioni') return _iscViewSocieta();
  const html = _iscViewSocieta.call(null);
  return html.replace(/(<\/nav>)[\s\S]*(<\/section>)$/, `$1${iscHTML()}$2`);
};
function iscHTML(){
  const c = iscCfg(), link = c.pub ? iscLink() : '', T = accTeams(), sel = c.squadre || [];
  return `<div class="panel"><h2>Iscrizione online delle famiglie</h2>
    <p style="margin-top:0">Mandi un link: la famiglia compila il modulo dal telefono e ti rimanda l'iscrizione su WhatsApp o per email. I dati viaggiano <b>cifrati</b>: solo Volleydesk della segreteria li legge. Qui sotto incolli il messaggio ricevuto e l'atleta entra in anagrafica, con genitore, codice fiscale e consensi.</p>
    ${link ? `<div class="isc-link"><input type="text" readonly value="${esc(link)}" id="isc-url"><button class="btn sm" data-action="isc-copy">Copia il link</button><a class="btn sm wa" href="https://wa.me/?text=${encodeURIComponent('Per l\'iscrizione a ' + (socCfg().ragioneSociale || 'la società') + ' compila questo modulo:\n' + link)}" target="_blank" rel="noopener">Manda su WhatsApp</a><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Prova il modulo</a></div>
      <p class="muted" style="font-size:12.5px;margin-bottom:0">Il link cambia se cambi le impostazioni qui sotto: manda sempre l'ultimo. Un link vecchio continua comunque a funzionare.</p>`
    : `<button class="btn primary" data-action="isc-keys">Prepara il modulo di iscrizione</button>`}
  </div>
  ${c.pub ? `<div class="panel"><h2>Iscrizioni ricevute</h2>
    <label class="f">Incolla qui il messaggio ricevuto (anche più messaggi insieme)<textarea id="isc-paste" rows="4" placeholder="Iscrizione di … Codice per la segreteria: VDI1-…"></textarea></label>
    <div class="actions" style="margin-top:8px"><button class="btn primary" data-action="isc-read">Leggi le iscrizioni</button></div>
    <div id="isc-list">${ui.iscList ? iscListHTML() : ''}</div></div>
  <div class="panel"><h2>Impostazioni del modulo</h2><div class="grid g2">
    <label class="f">Stagione<input type="text" data-isc="stagione" value="${esc(c.stagione || socSeasonOf(todayISO()))}"></label>
    <label class="f">Cellulare della segreteria (per WhatsApp)<input type="tel" data-isc="wa" value="${esc(c.wa || '')}" placeholder="333 1234567"></label>
    <label class="f">Email della segreteria<input type="email" data-isc="email" value="${esc(c.email || socCfg().email || '')}"></label>
    <label class="f">Link all'informativa privacy (se ce l'avete online)<input type="url" data-isc="privacyUrl" value="${esc(c.privacyUrl || '')}" placeholder="https://…"></label>
    ${T.length > 1 ? `<div class="f span2" style="font-size:13px;font-weight:600;color:var(--ink-2)">Squadre tra cui scegliere<div class="at-teams">${T.map(t => `<label class="sw"><input type="checkbox" data-iscsq="${esc(t.id || '_')}" ${!sel.length || sel.includes(t.id || '_') ? 'checked' : ''}> ${esc(t.nome)}</label>`).join('')}</div></div>` : ''}
    <label class="f span2">Messaggio in cima al modulo<textarea data-isc="note" rows="3" placeholder="Es. Benvenuti! Compilate un modulo per ogni figlio. Le quote si pagano entro il 15 ottobre.">${esc(c.note || '')}</textarea></label>
  </div><p class="muted" style="font-size:12.5px;margin:8px 0 0">La chiave per leggere le iscrizioni è salvata nelle impostazioni della società e arriva su tutti i dispositivi della segreteria collegati. Non va negli archivi delle squadre né nei file per gli altri allenatori.</p></div>` : ''}`;
}
function iscListHTML(){
  const L = ui.iscList || [], fatte = new Set(iscCfg().fatte || []), piani = socCfg().pianiQuota || [];
  if(!L.length) return '<p class="muted">Nel testo non ho trovato codici di iscrizione (iniziano con «VDI1-»).</p>';
  return `<div class="isc-cards">${L.map((x, i) => {
    if(x.err) return `<div class="isc-card bad"><b>Codice non leggibile</b><small>${esc(x.err)}</small></div>`;
    const r = x.r, a = r.at, g = r.gen || {}, ex = iscMatch(r), done = fatte.has(x.h);
    const row = (k, v) => v ? `<span><small>${k}</small>${esc(v)}</span>` : '';
    return `<div class="isc-card ${done ? 'done' : ''}"><div class="h"><b>${esc(a.cognome + ' ' + a.nome)}</b><small>${esc(r.squadraNome || '')}${r.quando ? ' · inviata il ' + new Date(r.quando).toLocaleDateString('it-IT') : ''}</small></div>
      <div class="d">${row('Nato/a', shortDate(a.dataNascita) + (a.luogoNascita ? ' a ' + a.luogoNascita : ''))}${row('C.F.', a.codiceFiscale)}${row('Indirizzo', a.indirizzo)}${row('Genitore', g.nome)}${row('C.F. genitore', g.cf)}${row('Telefono', g.tel || a.cellulare)}${row('Email', g.email || a.email)}${row('Taglia', a.taglia)}${row('Visita fino al', a.scadenzaVisita ? shortDate(a.scadenzaVisita) : '')}${row('Note', a.note)}${row('Consensi', ['privacy', r.consensi && r.consensi.foto ? 'foto e video' : 'NO foto', r.consensi && r.consensi.regolamento ? 'regolamento' : ''].filter(Boolean).join(', '))}${row('Firma', r.firma)}</div>
      ${done ? '<p class="ok-line">✓ Già importata</p>' : `<div class="act">${piani.length ? `<select data-iscplan="${i}"><option value="">Nessuna quota</option>${piani.map(p => `<option value="${p.id}">Assegna «${esc(p.nome)}»</option>`).join('')}</select>` : ''}<button class="btn sm primary" data-action="isc-add" data-i="${i}">${ex ? 'Aggiorna la scheda di ' + esc(fullName(ex)) : 'Aggiungi in anagrafica'}</button></div>`}</div>`; }).join('')}</div>`;
}
function iscMatch(r){
  const a = r.at, L = [...Store.list('athletes'), ...Store.trash().filter(x => x._c === 'athletes')];   // anche chi è nel cestino: torna attivo
  return L.find(x => a.codiceFiscale && (x.codiceFiscale || '').toUpperCase() === a.codiceFiscale) ||
    L.find(x => impNorm(x.cognome) === impNorm(a.cognome) && impNorm(x.nome) === impNorm(a.nome) && (!x.dataNascita || x.dataNascita === a.dataNascita)) || null;
}
async function iscRead(){
  const txt = ($('#isc-paste').value || '').replace(/\s+/g, ''); const out = [], seen = new Set();
  for(const m of txt.matchAll(ISC_RE)){ const h = iscHash(m); if(seen.has(h)) continue; seen.add(h);
    try{ out.push({ h, r: await iscDecrypt(m) }); }catch(e){ out.push({ h, err: 'Il codice è incompleto, è stato modificato oppure è stato creato con il link di un\'altra società.' }); } }
  ui.iscList = out; $('#isc-list').innerHTML = iscListHTML();
}
async function iscAdd(i){
  const x = ui.iscList[i]; if(!x || !x.r) return; const r = x.r, a = r.at, g = r.gen || {};
  const ex = iscMatch(r), now = Date.now();
  const at = ex ? clone(ex) : { id: newId('at'), iscritto: true, createdAt: now };
  const put = (k, v) => { if(v) at[k] = v; };
  ['nome','cognome','sesso','dataNascita','luogoNascita','codiceFiscale','indirizzo','email','cellulare','taglia','scadenzaVisita'].forEach(k => put(k, a[k]));
  put('genitore', g.nome); put('cfGenitore', g.cf); put('telGenitore', g.tel); put('emailGenitore', g.email);
  at.privacy = r.consensi && r.consensi.privacy ? 'si' : (at.privacy || ''); at.consensoFoto = r.consensi && r.consensi.foto ? 'si' : '';
  at.iscritto = true; at.cestino = ''; delete at._c;
  const tid = r.squadra === '_' ? '' : r.squadra;
  if(teamMulti() && tid && teamsRaw().some(t => t.id === tid)) at.squadre = [...new Set([...(ex ? atTeams(ex) : []), tid])];
  else if(teamMulti() && !ex) at.squadre = [teamCur()];
  const nota = `Iscrizione online del ${new Date(r.quando || now).toLocaleDateString('it-IT')}, firmata da ${r.firma || '—'}.` + (a.note ? '\n' + a.note : '');
  at.note = [ex && ex.note, nota].filter(Boolean).join('\n'); at.updatedAt = now;
  const items = [{ c: 'athletes', r: at }];
  const pid = ($(`[data-iscplan="${i}"]`) || {}).value, plan = pid && (socCfg().pianiQuota || []).find(p => p.id === pid);
  if(plan){ const st = r.stagione || socSeason();
    if(!Store.list('payments').some(p => p.atletaId === at.id && p.pianoId === plan.id && p.stagione === st))
      plan.rate.forEach((q, k) => items.push({ c: 'payments', r: { id: newId('qt') + k, atletaId: at.id, stagione: st, voce: plan.voce || SOC_VOCI[0], descrizione: plan.nome + (plan.rate.length > 1 ? ' – ' + (q.descrizione || 'rata ' + (k + 1)).toLowerCase() : ''), importo: money(q.importo), scadenza: q.scadenza || '', pianoId: plan.id, incassi: [], createdAt: now, updatedAt: now } })); }
  try{ await api('POST', '/api/multipli', { items }); await iscSet({ fatte: [...(iscCfg().fatte || []), x.h].slice(-500) }); }
  catch(e){ saveFail(e); return; }
  SOCD = null; await loadState(); toast(ex ? 'Scheda aggiornata: ' + fullName(at) : 'Nuovo atleta: ' + fullName(at)); const l = $('#isc-list'); if(l) l.innerHTML = iscListHTML();
}
Object.assign(actions, {
  'isc-keys': async () => { try{ await iscKeys(); render(); toast('Modulo pronto: copia il link e mandalo alle famiglie'); }catch(e){ alert('Questo browser non permette di creare la chiave: ' + (e.message || e)); } },
  'isc-copy': () => copyText($('#isc-url').value),
  'isc-read': () => iscRead(),
  'isc-add': b => iscAdd(+b.dataset.i)
});
document.addEventListener('change', async e => {
  const t = e.target;
  if(t.dataset.isc){ await iscSet({ [t.dataset.isc]: t.value.trim() }); if(ui.view === 'societa' && ui.socTab === 'iscrizioni'){ const y = window.scrollY; render(); window.scrollTo(0, y); } toast('Salvato: il link è aggiornato'); }
  if(t.dataset.iscsq){ const all = accTeams().map(x => x.id || '_'), cur = new Set(iscCfg().squadre && iscCfg().squadre.length ? iscCfg().squadre : all); if(t.checked) cur.add(t.dataset.iscsq); else cur.delete(t.dataset.iscsq);
    await iscSet({ squadre: [...cur] }); const y = window.scrollY; render(); window.scrollTo(0, y); }
});
