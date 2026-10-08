"use strict";
/* ==================================================================
   Volleydesk – cestino delle anagrafiche
   - Un atleta o una persona dello staff eliminati vanno nel cestino
     (campo «cestino» con la data): spariscono da squadre, quote,
     scadenzario, promemoria e archivi degli allenatori, ma si possono
     ripristinare con tutto quello che avevano.
   - «Elimina definitivamente» toglie la scheda e ogni riferimento:
     quote e rate, documenti allegati e i loro file, convocazioni e
     presenze, consegne del magazzino (che restano come «anagrafica
     eliminata» per non falsare le giacenze).
     I soldi già incassati o pagati possono restare in prima nota come
     movimenti senza nome, così la cassa non cambia.
   - Le quote rimaste senza atleta (eliminato prima del cestino) si
     sistemano dallo stesso posto.
   ================================================================== */
SOC_TABS.push(['cestino', 'Cestino']);
/* l'etichetta mostra quante schede ci sono nel cestino */
Object.defineProperty(SOC_TABS[SOC_TABS.length - 1], 1, { get(){ const n = Store.trash().length; return n ? `🗑 Cestino (${n})` : 'Cestino'; } });

const binName = x => fullName(x) || 'Senza nome';
const binWhen = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); };

/* tutto quello che fa riferimento a una scheda */
function binRefs(c, id){
  const o = { pay: [], inc: [], docs: [], ma: [], tr: [], inv: [], led: [] };
  if(c === 'athletes'){
    o.pay = Store.list('payments').filter(p => p.atletaId === id);
    o.inc = o.pay.flatMap(p => (p.incassi || []).map(x => ({ p, x })));
    o.docs = Store.list('docs').filter(d => d.rif === 'at:' + id);
    o.ma = Store.list('matches').filter(m => ['convocati', 'assenti', 'disponibili'].some(k => (m[k] || []).includes(id)));
    o.tr = Store.list('trainings').filter(t => t.presenze && id in t.presenze);
    o.inv = Store.list('inventory').filter(x => (x.consegne || []).some(k => k.atletaId === id));
  } else {
    o.led = Store.list('ledger').filter(m => m.staffId === id);
    o.docs = Store.list('docs').filter(d => d.rif === 'st:' + id);
  }
  o.incTot = r2(o.inc.reduce((s, k) => s + (+k.x.importo || 0), 0));
  o.dueTot = r2(o.pay.reduce((s, p) => s + payDue(p), 0));
  o.ledTot = r2(o.led.reduce((s, m) => s + (+m.importo || 0), 0));
  return o;
}
function binRefsText(c, R){
  const L = [];
  if(R.pay.length) L.push(`${R.pay.length} quot${R.pay.length === 1 ? 'a' : 'e'}${R.incTot ? ' · incassati ' + eur(R.incTot) : ''}${R.dueTot ? ' · da incassare ' + eur(R.dueTot) : ''}`);
  if(R.led.length) L.push(`${R.led.length} pagament${R.led.length === 1 ? 'o' : 'i'} in prima nota (${eur(R.ledTot)})`);
  if(R.docs.length) L.push(`${R.docs.length} document${R.docs.length === 1 ? 'o' : 'i'}`);
  if(R.ma.length) L.push(`${R.ma.length} partit${R.ma.length === 1 ? 'a' : 'e'}`);
  if(R.tr.length) L.push(`${R.tr.length} allenament${R.tr.length === 1 ? 'o' : 'i'}`);
  if(R.inv.length) L.push(`consegne del magazzino`);
  return L.join(' · ') || 'nessun altro dato collegato';
}
/* quote rimaste senza atleta (eliminato prima che ci fosse il cestino) */
function binOrphans(){
  const known = id => !!Store.any('athletes', id), m = new Map();
  Store.list('payments').forEach(p => { if(!known(p.atletaId)){ if(!m.has(p.atletaId)) m.set(p.atletaId, []); m.get(p.atletaId).push(p); } });
  Store.list('docs').forEach(d => { const [k, id] = d.rif.split(':'); if(k === 'at' && id && !known(id) && !m.has(id)) m.set(id, []); });
  return [...m.entries()].map(([id, P]) => ({ id, P, R: binRefs('athletes', id) }));
}
const binCount = () => Store.trash().length + binOrphans().length;

SOC_BODY.cestino = function(){
  const T = Store.trash().sort((a, b) => (b.cestino || '').localeCompare(a.cestino || '')), O = binOrphans();
  const row = (c, x) => { const R = binRefs(c, x.id);
    return `<div class="sd-row bin-row"><span class="nm"><b>${c === 'athletes' ? '🏐' : '👤'} ${esc(binName(x))}</b><small>${c === 'athletes' ? 'Atleta' : esc(x.ruolo || 'Staff')} · nel cestino dal ${binWhen(x.cestino)}<br>${esc(binRefsText(c, R))}</small></span>
      <span class="bin-act"><button class="btn sm" data-action="bin-restore" data-c="${c}" data-id="${esc(x.id)}">↩ Ripristina</button><button class="btn sm danger" data-action="bin-purge" data-c="${c}" data-id="${esc(x.id)}">Elimina definitivamente</button></span></div>`; };
  const orow = o => `<div class="sd-row bin-row"><span class="nm"><b>❔ Atleta eliminato</b><small>${esc(binRefsText('athletes', o.R))}${o.P.length ? '<br>' + o.P.slice(0, 3).map(p => esc(payDesc(p) + (p.stagione ? ' ' + p.stagione : ''))).join(', ') + (o.P.length > 3 ? '…' : '') : ''}</small></span>
      <span class="bin-act"><button class="btn sm danger" data-action="bin-purge" data-c="orfano" data-id="${esc(o.id)}">Elimina definitivamente</button></span></div>`;
  const at = T.filter(x => x._c === 'athletes'), st = T.filter(x => x._c === 'staff');
  return `<p class="muted" style="margin-top:0;font-size:13.5px">Le anagrafiche eliminate restano qui finché non le elimini del tutto: non compaiono nelle squadre, nelle quote, nello scadenzario, nei promemoria e negli archivi degli allenatori. «Ripristina» le rimette com'erano, con quote, documenti e presenze.</p>
  ${T.length + O.length ? `<div class="sd-quick"><button class="btn danger" data-action="bin-purge-all">🗑 Svuota il cestino (${T.length + O.length})</button></div>` : ''}
  ${at.length ? `<h3 class="sd-h3">Atleti</h3><div class="panel sd-rows">${at.map(x => row('athletes', x)).join('')}</div>` : ''}
  ${st.length ? `<h3 class="sd-h3">Staff</h3><div class="panel sd-rows">${st.map(x => row('staff', x)).join('')}</div>` : ''}
  ${O.length ? `<h3 class="sd-h3">Quote e documenti senza anagrafica</h3><p class="muted" style="font-size:13px;margin:0 0 8px">Appartengono ad atleti eliminati con una versione precedente di Volleydesk: non compaiono più nelle quote, ma sono ancora nei dati.</p><div class="panel sd-rows">${O.map(orow).join('')}</div>` : ''}
  ${T.length + O.length ? '' : '<div class="empty">Il cestino è vuoto.<br>Quando elimini un atleta o una persona dello staff finisce qui: potrai ripristinarla o eliminarla del tutto.</div>'}`;
};

async function binRestore(c, id){
  const x = Store.any(c, id); if(!x) return;
  const r = Object.assign({}, x, { cestino: '', updatedAt: Date.now() });
  try{ await api('PUT', '/api/' + (c === 'athletes' ? 'atleti' : SOC_ROUTE.staff) + '/' + encodeURIComponent(id), r); }catch(e){ saveFail(e); return; }
  await loadState(); SOCD = null; render(); toast(binName(x) + ' ripristinat' + (x.sesso === 'F' ? 'a' : 'o'));
}

/* conferma con l'elenco di quello che sparisce; targets: [{c, id}] */
function binPurgeModal(targets){
  const T = targets.map(t => { const x = t.c === 'orfano' ? null : Store.any(t.c, t.id); const c = t.c === 'staff' ? 'staff' : 'athletes'; return { c: t.c, id: t.id, x, R: binRefs(c, t.id) }; });
  const sum = k => T.reduce((s, t) => s + t.R[k].length, 0), inc = r2(T.reduce((s, t) => s + t.R.incTot, 0)), led = r2(T.reduce((s, t) => s + t.R.ledTot, 0));
  const names = T.map(t => t.x ? binName(t.x) : 'atleta eliminato'), title = T.length === 1 ? names[0] : T.length + ' anagrafiche';
  const li = [];
  if(T.some(t => t.x)) li.push(`la scheda${T.length > 1 ? ' di ' + T.filter(t => t.x).length + ' persone' : ''} con tutti i dati personali`);
  if(sum('pay')) li.push(`${sum('pay')} quot${sum('pay') === 1 ? 'a' : 'e'} e rate`);
  if(sum('docs')) li.push(`${sum('docs')} document${sum('docs') === 1 ? 'o' : 'i'} allegat${sum('docs') === 1 ? 'o' : 'i'}, anche dall'archivio online`);
  if(sum('ma') + sum('tr')) li.push(`convocazioni e presenze (${sum('ma')} partite, ${sum('tr')} allenamenti); le statistiche delle partite restano senza nome`);
  if(sum('inv')) li.push(`il nome nelle consegne del magazzino (le giacenze non cambiano)`);
  const cash = inc || led;
  openModal(`<div class="modal-box" style="max-width:560px">
    <div class="modal-head"><div style="flex:1;min-width:0"><h2>Elimina definitivamente</h2><div class="muted" style="font-size:13.5px;margin-top:3px">${esc(title)}</div></div><button class="iconbtn" data-action="close-modal" title="Chiudi">✕</button></div>
    <div class="modal-body">
      <p style="margin-top:0">Vengono tolti per sempre:</p><ul class="bin-list">${li.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${cash ? `<fieldset class="bin-cash"><legend>Soldi già ${inc && led ? 'incassati e pagati' : inc ? 'incassati' : 'pagati'} (${eur(r2(inc + led))})</legend>
        <label><input type="radio" name="bin-cash" value="keep" checked> <span><b>Restano in prima nota</b> come movimenti senza nome${inc ? ', con il numero di ricevuta' : ''}: la cassa e il rendiconto non cambiano.</span></label>
        <label><input type="radio" name="bin-cash" value="del"> <span><b>Elimina anche questi</b>: spariscono dalla prima nota e dal saldo di cassa.</span></label></fieldset>` : ''}
      <p class="muted" style="font-size:13px">Non si può annullare. Le copie di sicurezza già scaricate restano come sono.</p>
    </div>
    <div class="modal-foot"><span style="flex:1"></span><button class="btn" data-action="close-modal">Annulla</button><button class="btn danger-fill" data-action="bin-purge-go">Elimina definitivamente</button></div></div>`);
  ui.binT = targets;
}

async function binPurge(targets, keepCash){
  const items = [], dels = [], files = new Set(), now = Date.now();
  const put = (c, r) => { const k = items.findIndex(i => i.c === c && i.r.id === r.id); if(k >= 0) items[k] = { c, r }; else items.push({ c, r }); };
  const cur = (c, r) => (items.find(i => i.c === c && i.r.id === r.id) || {}).r || clone(r);
  for(const t of targets){
    const c = t.c === 'staff' ? 'staff' : 'athletes', id = t.id, R = binRefs(c, id);
    R.docs.forEach(d => { dels.push({ c: 'docs', id: d.id }); files.add(d.file.replace(/^img:/, '')); });
    if(c === 'athletes'){
      R.pay.forEach(p => {
        if(keepCash) (p.incassi || []).forEach(x => put('ledger', { id: newId('mv'), data: x.data || todayISO(), tipo: 'E', categoria: 'Quote atleti', descrizione: payDesc(p) + ' (anagrafica eliminata)',
          importo: x.importo, metodo: x.metodo || '', controparte: '', documento: x.ricevuta ? 'Ricevuta ' + x.ricevuta : '', stagione: p.stagione || '', squadra: '', note: '', createdAt: now, updatedAt: now }));
        dels.push({ c: 'payments', id: p.id });
      });
      R.ma.forEach(m => { const o = cur('matches', m); ['convocati', 'assenti', 'disponibili'].forEach(k => { o[k] = (o[k] || []).filter(x => x !== id); }); o.updatedAt = now; put('matches', o); });
      R.tr.forEach(tr => { const o = cur('trainings', tr); delete o.presenze[id]; o.updatedAt = now; put('trainings', o); });
      R.inv.forEach(v => { const o = cur('inventory', v); o.consegne = o.consegne.map(k => k.atletaId === id ? Object.assign({}, k, { atletaId: '', a: 'anagrafica eliminata' }) : k); o.updatedAt = now; put('inventory', o); });
    } else {
      R.led.forEach(m => {
        if(keepCash) put('ledger', Object.assign(cur('ledger', m), { staffId: '', controparte: '', updatedAt: now }));
        else { dels.push({ c: 'ledger', id: m.id }); Store.list('docs').filter(d => d.rif === 'mv:' + m.id).forEach(d => { dels.push({ c: 'docs', id: d.id }); files.add(d.file.replace(/^img:/, '')); }); }
      });
    }
    if(t.c !== 'orfano') dels.push({ c, id });
  }
  await api('POST', '/api/multipli', { items, dels });
  for(const f of files) await Store.delFile(f).catch(() => {});
  await loadState(); SOCD = null;
}

/* dal dispositivo della segreteria anche lo staff va nel cestino */
Object.assign(actions, {
  'st-del': async () => { const x = ui.stDraft; if(!x.id) return; const r = Store.any('staff', x.id); if(!r) return;
    if(!confirm(`Spostare ${fullName(r)} nel cestino?\n\nPuoi ripristinarla o eliminarla del tutto da Società › Cestino.`)) return;
    try{ await socPut('staff', Object.assign({}, r, { cestino: new Date().toISOString() })); }catch(e){ saveFail(e); return; }
    closeModal(); toast('Spostato nel cestino'); socRefreshBehind(); },
  'bin-restore': b => binRestore(b.dataset.c, b.dataset.id),
  'bin-purge': b => binPurgeModal([{ c: b.dataset.c, id: b.dataset.id }]),
  'bin-purge-all': () => binPurgeModal([...Store.trash().map(x => ({ c: x._c, id: x.id })), ...binOrphans().map(o => ({ c: 'orfano', id: o.id }))]),
  'bin-purge-go': async () => {
    const T = ui.binT || [], keep = ($('input[name=bin-cash]:checked') || { value: 'keep' }).value === 'keep';
    const btn = $('[data-action=bin-purge-go]'); if(btn){ btn.disabled = true; btn.textContent = 'Elimino…'; }
    try{ await binPurge(T, keep); }catch(e){ saveFail(e); if(btn){ btn.disabled = false; btn.textContent = 'Elimina definitivamente'; } return; }
    ui.binT = null; closeModal(); render(); toast(T.length === 1 ? 'Eliminato definitivamente' : 'Cestino svuotato');
  }
});

GUIDE.splice(6, 0, ['🗑', 'Cestino delle anagrafiche', `
<p>Quando elimini un atleta o una persona dello staff, la scheda va nel <b>cestino</b> (Società → Cestino): sparisce dalle squadre, dalle quote, dallo scadenzario, dai promemoria e dagli archivi degli allenatori, ma niente è perso.</p>
<ul><li><b>Ripristina</b> la rimette com'era, con quote, documenti, convocazioni e presenze.</li>
<li><b>Elimina definitivamente</b> toglie la scheda e ogni riferimento: quote, documenti (anche dall'archivio online), convocazioni e presenze. I soldi già incassati o pagati possono restare in prima nota come movimenti senza nome, così la cassa non cambia.</li>
<li>Se una famiglia si iscrive di nuovo o la reimporti da Excel, la scheda nel cestino torna attiva.</li>
<li>Sul telefono dell'allenatore «Elimina» toglie l'atleta solo dalla sua squadra, come prima.</li></ul>`]);
