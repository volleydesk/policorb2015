"use strict";
/* ==================================================================
   Volleydesk – pagamenti online (PayPal, Satispay, bonifico) senza server
   - Pagina paga.html per le famiglie: importo e causale nel link (dopo il #),
     pulsanti PayPal (importo già inserito), Satispay e dati del bonifico.
   - Il link va nei solleciti (WhatsApp ed email) e nelle email automatiche.
   - «Ho pagato»: la famiglia manda alla segreteria un codice VDP1-…; la
     segreteria controlla di aver ricevuto i soldi e registra l'incasso.
   - Abbinamento degli estratti conto (banca, PayPal, Satispay): l'app
     propone a quale atleta e quota corrisponde ogni accredito.
   L'incasso non si registra mai da solo: senza server nessuno può
   ricevere le notifiche dei pagamenti, e conviene sempre controllare.
   ================================================================== */
const PG_B64 = s => { const u8 = new TextEncoder().encode(s); let o = ''; for(let i = 0; i < u8.length; i += 0x8000) o += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(o).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const PG_UNB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0)));
const PG_RE = /VDP1-([\w-]+)!/g;

/* PayPal.me: va bene il nome, «@nome» o il link intero (paypal.me/nome, https://www.paypal.me/nome/10) */
function pgPayPalName(v){ v = String(v || '').trim(); const m = /paypal\.me\/([^/?#\s]+)/i.exec(v); if(m) v = m[1]; return v.replace(/^@/, '').replace(/[^\w.-]/g, ''); }
function pgSatispayUrl(v){ v = String(v || '').trim(); if(!v) return ''; return /^https?:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/+/, ''); }
function pgMethods(){ const c = pgCfg(); return [['PayPal', !!c.pp, 'nome PayPal.me'], ['Satispay', !!c.sp, 'link Satispay'], ['Bonifico', !!c.iban, 'IBAN']]; }
function pgMethodsHTML(){ return pgMethods().map(([l, on, what]) => on ? `<span class="pg-m on">✓ ${l}</span>` : `<span class="pg-m off" title="Manca il ${what} in Dati società">✗ ${l}</span>`).join(''); }
function pgCfg(){ const c = socCfg(); return { pp: pgPayPalName(c.paypalMe), sp: pgSatispayUrl(c.satispayLink), iban: String(c.iban || '').replace(/\s+/g, ''), wa: String(c.waSegreteria || (typeof iscCfg === 'function' ? iscCfg().wa : '') || '').trim() }; }
const pgOn = () => { const c = pgCfg(); return !!(c.pp || c.sp || c.iban); };
function pgCausale(a, p){ const c = socCfg(); return (c.causale || 'Quota {stagione} – {atleta}').replace('{stagione}', (p && p.stagione) || socSeason()).replace('{atleta}', [a.nome, a.cognome].filter(Boolean).join(' ')); }
/* link alla pagina di pagamento per le rate aperte di un atleta (o solo alcune) */
function pgLink(a, pids){
  if(!a || !pgOn()) return '';
  let L = socData().pay.filter(p => p.atletaId === a.id && payDue(p) > 0);
  if(pids && pids.length) L = L.filter(p => pids.includes(p.id));
  L.sort((x, y) => (x.scadenza || '9').localeCompare(y.scadenza || '9')); if(!L.length) return '';
  const c = pgCfg(), s = socCfg(), age = socAge(a);
  const P = { v: 1, s: socName(), a: [a.nome, a.cognome].filter(Boolean).join(' '), r: L.map(p => [payDesc(p), payDue(p), p.scadenza || '']), t: r2(L.reduce((t, p) => t + payDue(p), 0)),
    q: L.map(p => p.id), c: pgCausale(a, L[0]), i: c.iban, h: s.intestatarioIban || s.ragioneSociale || '', pp: c.pp, sp: c.sp, wa: waNumber(c.wa), em: s.email || '', d: !!(s.detrazione && age !== null && age >= 5 && age <= 18) };
  Object.keys(P).forEach(k => { if(P[k] === '' || P[k] === false) delete P[k]; });
  return new URL('paga.html', location.href.split('#')[0].split('?')[0]).href + '#p=' + PG_B64(JSON.stringify(P));
}
/* il link entra nei solleciti: segnaposto {link}; se il testo non lo prevede si aggiunge in fondo */
const _pgFill = socFill;
socFill = function(tpl, a, p){
  let t = String(tpl || ''); const link = pgLink(a, p ? [p.id] : null);
  if(link && !t.includes('{link}')) t += '\nPer pagare online (PayPal, Satispay o bonifico): {link}';
  return _pgFill(t, a, p).replace(/\{link\}/g, link || '');
};

/* ---------------------------------------------------------------- registrazione degli incassi */
/* distribuisce un importo sulle rate aperte di un atleta (prima quelle indicate, poi le più vecchie) */
function pgAllocate(aid, importo, data, metodo, nota, pids, ricStart){
  let rest = r2(importo); const items = [], payer = socPayer(socAt(aid) || {});
  let n = ricStart;
  const L = socData().pay.filter(p => p.atletaId === aid && !p.annullata && payDue(p) > 0)
    .sort((x, y) => ((pids || []).includes(y.id) - (pids || []).includes(x.id)) || (x.scadenza || '9').localeCompare(y.scadenza || '9'));
  for(const p of L){ if(rest <= 0) break; const q = clone(p), amt = Math.min(rest, payDue(p));
    q.incassi = [...(q.incassi || []), { id: newId('in'), data, importo: amt, metodo, ricevuta: `${n.n++}/${data.slice(0, 4)}`, pagatoDa: payer.nome, cfPagante: payer.cf, note: nota || '' }];
    items.push({ c: 'payments', r: q }); rest = r2(rest - amt); }
  return { items, rest };
}
function pgRicStart(data){ const m = /^(\d+)\//.exec(socNextReceipt(data)); return { n: m ? +m[1] : 1 }; }

/* ---------------------------------------------------------------- link nel conto dell'atleta */
const _pgOpenSocAt = openSocAt;
openSocAt = function(aid){
  _pgOpenSocAt(aid);
  const a = socAt(aid), acc = a && socAccount(aid, null);
  if(!a || !acc.residuo || !pgOn()) return;
  const f = $('#modal .modal-foot'); if(f) f.insertAdjacentHTML('afterbegin', `<button class="btn" data-action="pg-link" data-a="${esc(aid)}">🔗 Link per pagare</button>`);
};
function pgLinkModal(aid){
  const a = socAt(aid), link = pgLink(a), pr = socPayer(a), acc = socAccount(aid, null);
  const msg = `Ciao ${(pr.nome || '').split(' ')[0]}, per ${[a.nome, a.cognome].join(' ')} risultano da versare ${eur(acc.residuo)}. Puoi pagare qui con PayPal, Satispay o bonifico: ${link}\nGrazie! ${socName()}`;
  openModal(`<div class="modal-box" style="max-width:560px"><div class="modal-head"><div style="flex:1"><h2>Link per pagare</h2><div class="muted" style="font-size:13.5px">${esc(fullName(a))} · ${eur(acc.residuo)}</div></div><button class="iconbtn" data-action="soc-at" data-id="${esc(aid)}">✕</button></div>
    <div class="modal-body"><div class="pg-ms">Nella pagina: ${pgMethodsHTML()}${pgMethods().some(m => !m[1]) ? ` <a href="#" data-action="pg-cfg">imposta gli altri metodi</a>` : ''}</div>
    <div class="isc-link"><input type="text" readonly value="${esc(link)}" id="pg-url"><button class="btn sm" data-action="pg-copy">Copia</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Apri</a></div>
    <label class="f" style="margin-top:12px">Messaggio<textarea id="pg-msg" rows="5">${esc(msg)}</textarea></label>
    <p class="muted" style="font-size:12.5px;margin-bottom:0">La pagina mostra le rate da pagare, apre PayPal con l'importo già scritto, Satispay e i dati del bonifico. Quando la famiglia ha pagato può avvisarti con «Ho pagato»: ti arriva un codice da incollare in Quote → Conferme di pagamento.</p></div>
    <div class="modal-foot"><span style="flex:1"></span>${pr.email ? `<a class="btn" href="mailto:${encodeURIComponent(pr.email)}?subject=${encodeURIComponent('Pagamento quota – ' + socName())}&body=${encodeURIComponent(msg)}">✉ Email</a>` : ''}${pr.tel ? `<a class="btn wa" href="https://wa.me/${waNumber(pr.tel)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div></div>`);
}

/* ---------------------------------------------------------------- conferme «Ho pagato» */
function pgConfModal(){
  openModal(`<div class="modal-box" style="max-width:720px"><div class="modal-head"><div style="flex:1"><h2>Conferme di pagamento</h2><div class="muted" style="font-size:13.5px">I messaggi «Ho pagato» mandati dalle famiglie dalla pagina di pagamento.</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><label class="f">Incolla qui il messaggio (anche più messaggi insieme)<textarea id="pg-paste" rows="4" placeholder="Ciao, ho pagato … Codice per la segreteria: VDP1-…"></textarea></label>
    <div class="actions" style="margin-top:8px"><button class="btn primary" data-action="pg-read">Leggi</button></div><div id="pg-list"></div>
    <p class="muted" style="font-size:12.5px;margin-bottom:0">Prima di registrare controlla di aver davvero ricevuto i soldi (nell'app di PayPal, di Satispay o della banca): il messaggio lo manda la famiglia e non è una prova del pagamento.</p></div></div>`);
}
function pgParse(txt){
  const out = [], seen = new Set(); txt = String(txt || '').replace(/\s+/g, '');
  for(const m of txt.matchAll(PG_RE)){ if(seen.has(m[1])) continue; seen.add(m[1]);
    try{ const o = JSON.parse(PG_UNB64(m[1])); out.push({ h: m[1].slice(0, 32), o }); }catch(e){ out.push({ h: m[1].slice(0, 32), err: true }); } }
  return out;
}
function pgListHTML(){
  const L = ui.pgList || [], fatte = new Set(socCfg().pagFatte || []);
  if(!L.length) return '<p class="muted">Non ho trovato codici di pagamento (iniziano con «VDP1-»).</p>';
  return `<div class="isc-cards">${L.map((x, i) => {
    if(x.err) return `<div class="isc-card bad"><b>Codice non leggibile</b><small>Il messaggio è stato modificato o tagliato.</small></div>`;
    const o = x.o, P = (o.q || []).map(id => socData().pay.find(p => p.id === id)).filter(Boolean), aid = P[0] && P[0].atletaId, a = aid && socAt(aid);
    const due = r2(P.reduce((s, p) => s + payDue(p), 0)), done = fatte.has(x.h);
    return `<div class="isc-card ${done ? 'done' : ''}"><div class="h"><b>${esc(a ? fullName(a) : o.a || '?')} · ${eur(o.t)} con ${esc(o.m || '?')}</b><small>avvisato il ${shortDate(o.d)} · ${P.map(p => esc(payDesc(p))).join(', ') || 'quote non trovate'}${a ? ` · ancora da versare ${eur(due)}` : ''}</small></div>
      ${done ? '<p class="ok-line">✓ Già registrato</p>' : !a ? '<p class="sd-red" style="margin:6px 0 0">Le quote di questo codice non esistono più (eliminate o di un\'altra società).</p>'
        : due <= 0 ? `<p class="muted" style="margin:6px 0 0">Queste rate risultano già pagate. <button class="btn sm ghost" data-action="pg-skip" data-i="${i}">Segna come visto</button></p>`
        : `<div class="act"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Importo ricevuto <input type="text" inputmode="decimal" id="pg-imp-${i}" value="${esc(moneyIn(Math.min(o.t, socAccount(aid, null).residuo)))}" style="width:100px"></label><label class="f" style="flex-direction:row;align-items:center;gap:6px">il <input type="date" id="pg-dt-${i}" value="${esc(o.d || todayISO())}"></label><button class="btn sm primary" data-action="pg-reg" data-i="${i}">Ho controllato: registra l'incasso</button></div>`}</div>`; }).join('')}</div>`;
}
async function pgRegister(i){
  const x = ui.pgList[i], o = x.o, P = (o.q || []).map(id => socData().pay.find(p => p.id === id)).filter(Boolean), aid = P[0].atletaId;
  const imp = money(($(`#pg-imp-${i}`) || {}).value), data = ($(`#pg-dt-${i}`) || {}).value || todayISO();
  if(!imp){ alert("Scrivi l'importo ricevuto."); return; }
  const A = pgAllocate(aid, imp, data, o.m || '', 'pagamento online', o.q, pgRicStart(data));
  if(A.rest > 0 && !confirm(`${eur(A.rest)} sono in più rispetto alle rate da pagare e non verranno registrati. Continuare?`)) return;
  try{ await socBulk(A.items); await socCfgSet({ pagFatte: [...(socCfg().pagFatte || []), x.h].slice(-500) }); }catch(e){ saveFail(e); return; }
  toast(`Incasso registrato: ${A.items.length} rat${A.items.length === 1 ? 'a' : 'e'}`); $('#pg-list').innerHTML = pgListHTML(); socRefreshBehind();
}

/* ---------------------------------------------------------------- abbinamento degli estratti conto */
const PG_COLS = { data: ['data', 'data operazione', 'data valuta', 'data contabile', 'date', 'giorno'], importo: ['lordo', 'importo', 'accrediti', 'accredito', 'entrate', 'avere', 'amount', 'gross', 'importo lordo', 'totale'],
  nome: ['nome', 'mittente', 'ordinante', 'da', 'name', 'from', 'cliente', 'controparte'], descr: ['causale', 'descrizione', 'oggetto', 'messaggio', 'note', 'dettagli', 'description', 'subject', 'descrizione operazione', 'riferimento'] };
function pgGuess(head){
  const map = {}; const N = head.map(impNorm);
  for(const [k, syn] of Object.entries(PG_COLS)){ let best = -1, sc = 0;
    N.forEach((n, i) => { if(Object.values(map).includes(i)) return; for(const s of syn){ const v = n === s ? 3 : n.startsWith(s + ' ') || n.endsWith(' ' + s) ? 2 : s.length > 3 && n.includes(s) ? 1 : 0; if(v > sc){ sc = v; best = i; } } });
    if(best >= 0) map[k] = best; }
  return map;
}
function pgEstModal(){ ui.pgEst = { rows: null, map: {}, metodo: 'Bonifico', sel: {}, who: {} }; pgEstRender(); }
function pgEstRender(){
  const E = ui.pgEst;
  if(!E.rows){
    openModal(`<div class="modal-box" style="max-width:640px"><div class="modal-head"><div style="flex:1"><h2>Abbina un estratto conto</h2><div class="muted" style="font-size:13.5px">Dagli accrediti ricevuti l'app propone a quale atleta e quota corrispondono.</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
      <div class="modal-body"><label class="f">Da dove arriva<select id="pg-met">${['Bonifico', 'PayPal', 'Satispay', 'Carta / POS'].map(m => `<option ${E.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <div class="imp-drop" style="margin-top:12px"><button class="btn primary" data-action="pg-est-file">📄 Scegli il file (.csv, .xlsx)</button><span class="muted" style="font-size:13px">L'elenco dei movimenti scaricato dalla banca, da PayPal (Attività → Estratti conto → CSV) o da Satispay Business.</span></div>
      <label class="f" style="margin-top:12px">Oppure incolla le righe copiate (titoli compresi)<textarea id="pg-est-paste" rows="5"></textarea></label>
      <div class="actions" style="margin-top:8px"><button class="btn" data-action="pg-est-paste">Usa il testo incollato</button></div></div></div>`);
    return;
  }
  const head = E.rows[0], data = E.rows.slice(1), M = E.map, opts = k => `<option value="">—</option>${head.map((h, i) => `<option value="${i}" ${M[k] === i ? 'selected' : ''}>${esc(impTxt(h) || 'colonna ' + (i + 1))}</option>`).join('')}`;
  const R = pgEstMatch(), ok = R.filter(r => r.st === 'new');
  const ats = socData().at.filter(a => socAccount(a.id, null).residuo > 0).sort((x, y) => fullName(x).localeCompare(fullName(y), 'it'));
  openModal(`<div class="modal-box" style="max-width:900px"><div class="modal-head"><div style="flex:1"><h2>Abbina l'estratto conto</h2><div class="muted" style="font-size:13.5px">${data.length} righe · ${R.length} accrediti · metodo: ${esc(E.metodo)}</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="grid g3" style="grid-template-columns:repeat(4,minmax(0,1fr))">${[['data', 'Data'], ['importo', 'Importo'], ['nome', 'Nome / mittente'], ['descr', 'Causale']].map(([k, l]) => `<label class="f">${l}<select data-pgmap="${k}">${opts(k)}</select></label>`).join('')}</div>
    ${!R.length ? '<p class="sd-red">Non trovo accrediti: controlla le colonne della data e dell\'importo.</p>' : `<div class="pg-est">${R.map((r, i) => `<div class="pg-r ${r.st}"><input type="checkbox" data-pgsel="${i}" ${r.st === 'new' && E.sel[i] !== false && (E.who[i] ?? r.aid) ? 'checked' : ''} ${r.st !== 'new' ? 'disabled' : ''}>
      <span class="d">${shortDate(r.data)}</span><b class="n">${eur(r.imp)}</b><span class="t">${esc(r.testo.slice(0, 90))}</span>
      ${r.st === 'dup' ? '<span class="muted">già registrato</span>' : `<select data-pgwho="${i}"><option value="">— non abbinare —</option>${ats.map(a => { const acc = socAccount(a.id, null); return `<option value="${a.id}" ${(E.who[i] ?? r.aid) === a.id ? 'selected' : ''}>${esc(fullName(a))} · deve ${eur(acc.residuo)}</option>`; }).join('')}</select>`}</div>`).join('')}</div>`}
    <p class="muted" style="font-size:12.5px;margin-bottom:0">L'app cerca nel nome e nella causale il cognome dell'atleta o del genitore e confronta l'importo con le rate da pagare. Controlla le proposte: le righe non abbinate non vengono registrate.</p></div>
    <div class="modal-foot"><button class="btn" data-action="pg-est-back">← Indietro</button><span style="flex:1"></span><button class="btn primary" data-action="pg-est-go">Registra i pagamenti selezionati</button></div></div>`);
  void ok;
}
function pgEstMatch(){
  const E = ui.pgEst, M = E.map, rows = E.rows.slice(1), out = [];
  if(M.data === undefined || M.importo === undefined) return out;
  const cand = socData().at.map(a => ({ a, acc: socAccount(a.id, null), k: [impNorm(a.cognome), impNorm(a.nome), impNorm(a.genitore || '')] })).filter(x => x.acc.residuo > 0);
  const incs = socData().pay.flatMap(p => (p.incassi || []).map(x => ({ aid: p.atletaId, data: x.data, imp: +x.importo, note: x.note || '' })));
  rows.forEach(r => {
    const imp = impMoney(r[M.importo]), data = impDate(r[M.data]); if(!imp || imp <= 0 || !data) return;
    const testo = [M.nome !== undefined ? impTxt(r[M.nome]) : '', M.descr !== undefined ? impTxt(r[M.descr]) : ''].filter(Boolean).join(' · '), T = ' ' + impNorm(testo) + ' ';
    let best = null;
    cand.forEach(c => { let s = 0; const [cg, nm, gen] = c.k;
      if(cg && T.includes(' ' + cg + ' ')) s += 3; if(nm && T.includes(' ' + nm + ' ')) s += 2;
      if(gen && gen.split(' ').filter(w => w.length > 2).every(w => T.includes(' ' + w + ' '))) s += 3;
      if(s && c.acc.next && Math.abs(payDue(c.acc.next) - imp) < .01) s += 2; else if(s && Math.abs(c.acc.residuo - imp) < .01) s += 2; else if(s && imp > c.acc.residuo + .01) s -= 1;
      if(s >= 3 && (!best || s > best.s)) best = { s, aid: c.a.id }; });
    const nota = 'da estratto conto: ' + testo.slice(0, 80);
    const dupAid = incs.find(x => x.data === data && (x.note === nota || (Math.abs(x.imp - imp) < .01 && (!best || x.aid === best.aid))));
    out.push({ data, imp, testo, aid: best ? best.aid : '', st: dupAid ? 'dup' : 'new' });
  });
  return out;
}
async function pgEstGo(){
  const E = ui.pgEst, R = pgEstMatch(); let items = [], n = 0, extra = 0;
  SOCD = null; socData();
  const byDate = {};
  R.forEach((r, i) => { if(r.st !== 'new') return; const box = document.querySelector(`[data-pgsel="${i}"]`); const aid = E.who[i] ?? r.aid; if(!box || !box.checked || !aid) return;
    const yr = r.data.slice(0, 4); byDate[yr] = byDate[yr] || pgRicStart(r.data);
    const A = pgAllocate(aid, r.imp, r.data, E.metodo, 'da estratto conto: ' + r.testo.slice(0, 80), null, byDate[yr]);
    /* le rate toccate da questa riga non devono essere riusate dalla riga dopo: si applicano subito alla vista dei dati */
    A.items.forEach(it => { const D = socData(), k = D.pay.findIndex(p => p.id === it.r.id); if(k >= 0) D.pay[k] = it.r; const j = items.findIndex(x => x.r.id === it.r.id); if(j >= 0) items[j] = it; else items.push(it); });
    n++; extra += A.rest; });
  if(!items.length){ alert('Nessun pagamento selezionato.'); SOCD = null; return; }
  try{ await socBulk(items); }catch(e){ SOCD = null; saveFail(e); return; }
  SOCD = null; closeModal(); toast(`Registrati ${n} pagamenti${extra > 0 ? ` · ${eur(extra)} in più non abbinati` : ''}`); socRefreshBehind();
}

/* ---------------------------------------------------------------- pulsanti e impostazioni */
const _pgQuote = socQuoteHTML;
socQuoteHTML = function(s){ return _pgQuote(s).replace('<button class="btn" data-action="soc-sol">', '<button class="btn" data-action="pg-conf">📩 Conferme di pagamento</button><button class="btn" data-action="pg-est">🏦 Abbina estratto conto</button><button class="btn" data-action="soc-sol">'); };
const _pgDati = socDatiHTML;
socDatiHTML = function(){
  const c = socCfg();
  return _pgDati().replace('<div class="panel"><div class="sd-ph"><h2>Piani delle quote</h2>', `<div class="panel"><h2>Pagamenti online</h2><div class="grid g3">
    <label class="f">PayPal.me (nome o link)<input type="text" data-soc="paypalMe" value="${esc(c.paypalMe || '')}" placeholder="es. VolleyCorbetta"></label>
    <label class="f">Link Satispay della società<input type="url" data-soc="satispayLink" value="${esc(c.satispayLink || '')}" placeholder="https://…"></label>
    <label class="f">Cellulare della segreteria (per gli avvisi)<input type="tel" data-soc="waSegreteria" value="${esc(c.waSegreteria || '')}" placeholder="333 1234567"></label></div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Con PayPal.me la famiglia trova l'importo già scritto. Il link Satispay lo trovi in Satispay Business (pagina o QR del negozio): nell'app la famiglia scrive l'importo. Per il bonifico si usano IBAN e causale qui sopra. Nei solleciti il link alla pagina di pagamento si aggiunge da solo (o dove scrivi {link}). </p>
    <div class="pg-ms" id="pg-ms" style="margin-top:10px">Nella pagina di pagamento: ${pgMethodsHTML()} <button type="button" class="btn sm" data-action="pg-preview">Vedi come appare</button></div></div>
    <div class="panel"><div class="sd-ph"><h2>Piani delle quote</h2>`);
};
function pgDemoLink(){ const a = socData().at.find(x => socAccount(x.id, null).residuo > 0); return a ? pgLink(a) : ''; }
Object.assign(actions, {
  'pg-link': b => pgLinkModal(b.dataset.a),
  'pg-preview': () => { const u = pgDemoLink(); if(!u){ alert(pgOn() ? 'Per l\'anteprima serve almeno un atleta con una rata da pagare.' : 'Inserisci almeno un metodo: nome PayPal.me, link Satispay o IBAN.'); return; } window.open(u, '_blank', 'noopener'); },
  'pg-cfg': () => { closeModal(); ui.socTab = 'dati'; go('societa'); setTimeout(() => { const i = document.querySelector('[data-soc=paypalMe]'); if(i){ i.scrollIntoView({ block: 'center' }); i.focus(); } }, 80); },
  'pg-copy': () => copyText($('#pg-url').value),
  'pg-conf': () => pgConfModal(),
  'pg-read': () => { ui.pgList = pgParse($('#pg-paste').value); $('#pg-list').innerHTML = pgListHTML(); },
  'pg-reg': b => pgRegister(+b.dataset.i),
  'pg-skip': async b => { const x = ui.pgList[+b.dataset.i]; await socCfgSet({ pagFatte: [...(socCfg().pagFatte || []), x.h].slice(-500) }); $('#pg-list').innerHTML = pgListHTML(); },
  'pg-est': () => pgEstModal(),
  'pg-est-back': () => { ui.pgEst.rows = null; pgEstRender(); },
  'pg-est-go': () => pgEstGo(),
  'pg-est-file': () => { const inp = $('#filepick'); inp.value = ''; inp.accept = '.csv,.txt,.xlsx,.xls';
    inp.onchange = async () => { const f = inp.files[0]; if(!f) return; try{ pgEstSet(await impReadFile(f)); }catch(e){ alert(e.message || e); } }; inp.click(); },
  'pg-est-paste': () => { const t = ($('#pg-est-paste') || {}).value || ''; if(!t.trim()){ alert('Incolla prima le righe.'); return; } pgEstSet(impCsv(t)); }
});
function pgEstSet(rows){
  /* gli estratti conto delle banche hanno spesso qualche riga di intestazione: si parte dalla prima riga che ha una data e un importo tra i titoli */
  let h = rows.findIndex(r => { const g = pgGuess(r); return g.data !== undefined && g.importo !== undefined; }); if(h < 0) h = 0;
  rows = rows.slice(h); if(rows.length < 2){ alert('Nel file non ho trovato movimenti.'); return; }
  const w = Math.max(...rows.map(r => r.length)); rows = rows.map(r => { const x = r.slice(); while(x.length < w) x.push(''); return x; });
  ui.pgEst.rows = rows; ui.pgEst.map = pgGuess(rows[0]); ui.pgEst.sel = {}; ui.pgEst.who = {}; pgEstRender();
}
document.addEventListener('change', e => {
  const t = e.target;
  if(t.id === 'pg-met' && ui.pgEst){ ui.pgEst.metodo = t.value; return; }
  if(t.dataset.pgmap && ui.pgEst){ if(t.value === '') delete ui.pgEst.map[t.dataset.pgmap]; else ui.pgEst.map[t.dataset.pgmap] = +t.value; pgEstRender(); return; }
  if(t.dataset.pgwho !== undefined && ui.pgEst){ ui.pgEst.who[+t.dataset.pgwho] = t.value; const c = document.querySelector(`[data-pgsel="${t.dataset.pgwho}"]`); if(c) c.checked = !!t.value; return; }
  if(t.dataset.pgsel !== undefined && ui.pgEst){ ui.pgEst.sel[+t.dataset.pgsel] = t.checked; }
  if(['paypalMe', 'satispayLink', 'iban'].includes(t.dataset.soc)) setTimeout(() => { const el = $('#pg-ms'); if(el) el.innerHTML = 'Nella pagina di pagamento: ' + pgMethodsHTML() + ' <button type="button" class="btn sm" data-action="pg-preview">Vedi come appare</button>'; }, 0);
});

/* indirizzo della pagina di pagamento per le email automatiche (promemoria.py) */
const _pgPromHTML = typeof promHTML === 'function' ? promHTML : null;
if(_pgPromHTML) promHTML = function(){
  const want = new URL('paga.html', location.href.split('#')[0].split('?')[0]).href;
  if(promCfg().pagaUrl !== want && location.protocol.startsWith('http')) promSet({ pagaUrl: want }).catch(() => {});
  let h = _pgPromHTML();
  const S = ui.promStato;
  if(S && S.ok && S.py && S.py !== '?' && +S.py < PROM_PY_V) h = h.replace('<div class="prom-st ok">', `<div class="warn">È disponibile una versione nuova dei promemoria (link per pagare online, niente avvisi a chi è nel cestino): premi «Aggiorna i file».</div><div class="prom-st ok">`);
  return h;
};
const PROM_PY_V = 4;

GUIDE.splice(2, 0, ['💳', 'Pagamenti online: PayPal, Satispay, bonifico', `
<p>In <b>Dati società → Pagamenti online</b> inserisci il nome PayPal.me della società, il link Satispay e il cellulare della segreteria (l'IBAN è già nella sezione Pagamenti).</p>
<ul><li>Nei <b>solleciti</b> (WhatsApp ed email) e nelle <b>email automatiche</b> c'è il link a una pagina con le rate da pagare: PayPal con l'importo già scritto, Satispay e i dati del bonifico da copiare.</li>
<li>Dal conto di un atleta, <b>🔗 Link per pagare</b> lo manda a una famiglia sola.</li>
<li>Dopo il pagamento la famiglia può premere <b>Ho pagato</b>: ti arriva un messaggio con un codice. In <b>Quote → 📩 Conferme di pagamento</b> lo incolli e, dopo aver controllato di aver ricevuto i soldi, registri l'incasso con la ricevuta.</li>
<li>Con <b>🏦 Abbina estratto conto</b> carichi l'elenco dei movimenti della banca, di PayPal o di Satispay: l'app propone a quale atleta corrisponde ogni accredito, tu confermi.</li></ul>
<p>Senza un server l'app non riceve le notifiche di PayPal e Satispay: l'incasso lo registri sempre tu, con un tocco.</p>`]);
