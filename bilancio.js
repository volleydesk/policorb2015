"use strict";
/* ==================================================================
   Volleydesk – bilancio preventivo e compensi dello staff
   - Preventivo: per ogni stagione un importo previsto per ogni categoria
     di entrata e di uscita, confrontato con il consuntivo (prima nota +
     incassi delle quote). Salvato nelle impostazioni della società.
   - Compensi: le uscite di prima nota collegate a una persona dello staff,
     con il riepilogo per anno solare e l'avviso quando ci si avvicina alla
     soglia annua impostata dalla società.
   ================================================================== */

/* ================================================================ PREVENTIVO */
function prevAll(){ const v=socCfg().preventivi; return v && typeof v==='object' ? v : {}; }
function prevOf(season){ const p=prevAll()[season]||{}; return { E:Object.assign({}, p.E), U:Object.assign({}, p.U), note:p.note||'' }; }
async function prevSave(season, p){ const all=Object.assign({}, prevAll()); all[season]=p; await socCfgSet({preventivi:all}); }
function socPrevSeason(season){
  const y0=parseInt(season,10); if(!y0) return '';
  return (+socCfg().meseInizio||9)===1 ? String(y0-1) : (y0-1)+'/'+String(y0%100).padStart(2,'0');
}
/* consuntivo di una stagione: {E:{cat:importo}, U:{…}} */
function consOf(season){
  const o={E:{}, U:{}};
  socMovements(socSeasonRange(season)).forEach(m=>{ const k=m.categoria||'Senza categoria'; o[m.tipo][k]=r2((o[m.tipo][k]||0)+m.importo); });
  return o;
}
const sumObj = o => r2(Object.values(o||{}).reduce((s,v)=>s+(+v||0),0));
function prevCats(t, p, c){
  const base = t==='E' ? ['Quote atleti', ...socLines('catE')] : socLines('catU');
  return [...new Set([...base, ...Object.keys(p[t]), ...Object.keys(c[t])])];
}
/* quanto della stagione è già passato (per leggere il consuntivo) */
function seasonElapsed(season){
  const [a,b]=socSeasonRange(season), A=parseISO(a), B=parseISO(b), T=today0();
  if(!A || !B) return null; if(T<=A) return 0; if(T>=B) return 100;
  return Math.round((T-A)/(B-A)*100);
}
/* suggerimenti per alcune voci */
function prevHints(season){
  const H={E:{}, U:{}};
  const q=r2(socData().payA.filter(p=>p.stagione===season && !p.annullata).reduce((s,p)=>s+p.importo,0));
  if(q) H.E['Quote atleti']=[q, 'quote assegnate'];
  if(typeof palSeasonCost==='function'){ const c=palSeasonCost(season); if(c) H.U['Affitto palestra']=[c, 'dai turni delle palestre']; }
  const st=staffSeasonEstimate(); if(st) H.U['Rimborsi e compensi staff']=[st, 'pagati negli ultimi 12 mesi'];
  return H;
}
function staffSeasonEstimate(){
  const from=toISO(new Date(today0().getTime()-365*864e5));
  return r2(socData().led.filter(m=>m.tipo==='U' && m.staffId && m.data>=from).reduce((s,m)=>s+m.importo,0));
}

SOC_TABS.splice(SOC_TABS.findIndex(t=>t[0]==='cassa')+1, 0, ['preventivo','Preventivo']);
SOC_SEASON_TABS.push('preventivo');
SOC_BODY.preventivo = function(season){
  const p=prevOf(season), c=consOf(season), H=prevHints(season), el=seasonElapsed(season), ps=socPrevSeason(season);
  const has=Object.keys(p.E).length+Object.keys(p.U).length>0;
  const tP={E:sumObj(p.E), U:sumObj(p.U)}, tC={E:sumObj(c.E), U:sumObj(c.U)};
  const prevHas=!!prevAll()[ps], consPrev=consOf(ps), consPrevHas=sumObj(consPrev.E)+sumObj(consPrev.U)>0;
  const table=t=>{
    const cats=prevCats(t,p,c);
    return `<div class="panel bp-tab"><div class="sd-ph"><h2>${t==='E'?'Entrate':'Uscite'}</h2><button class="btn sm ghost" data-action="bp-add" data-t="${t}">＋ Voce</button></div>
      <div class="bp-head"><span>Voce</span><span>Preventivo</span><span>Consuntivo</span><span>Differenza</span></div>
      ${cats.map(k=>{ const pv=+p[t][k]||0, cv=+c[t][k]||0, d=r2(cv-pv), h=H[t][k], pct=pv?Math.round(cv/pv*100):null;
        const cls = !(pv||cv) ? '' : t==='U' ? (cv>pv ? 'sd-red' : '') : (pv && cv>=pv ? 'sd-green' : '');   // rosso solo se si spende più del previsto
        return `<div class="bp-row ${!pv&&!cv?'bp-zero':''}"><span class="k">${esc(k)}${h&&Math.abs(h[0]-pv)>0.5?`<button class="bp-hint" data-action="bp-use" data-t="${t}" data-k="${esc(k)}" data-v="${h[0]}" title="Usa questo importo">↙ ${eur(h[0])} <small>${esc(h[1])}</small></button>`:''}</span>
          <span><input type="text" inputmode="decimal" data-bp="${t}" data-k="${esc(k)}" value="${pv?esc(moneyIn(pv)):''}" placeholder="0"></span>
          <span class="n">${cv?eur(cv):'—'}${pct!==null?`<span class="sd-bar ${t==='U'?'u':''}"><i style="width:${Math.min(100,pct)}%"></i></span>`:''}</span>
          <span class="n ${cls}">${pv||cv?(d>0?'+':'')+eur(d):''}${pct!==null?`<small>${pct}%</small>`:''}</span></div>`; }).join('')}
      <div class="bp-row tot"><span class="k">Totale</span><span class="n">${eur(tP[t])}</span><span class="n">${eur(tC[t])}</span><span class="n">${tP[t]||tC[t]?(tC[t]-tP[t]>0?'+':'')+eur(tC[t]-tP[t]):''}</span></div></div>`;
  };
  const saldoP=r2(tP.E-tP.U), saldoC=r2(tC.E-tC.U);
  return `<div class="sd-quick">
      ${prevHas?`<button class="btn" data-action="bp-copy" data-from="prev">Copia il preventivo ${esc(ps)}</button>`:''}
      ${consPrevHas?`<button class="btn" data-action="bp-copy" data-from="cons">Copia il consuntivo ${esc(ps)}</button>`:''}
      <button class="btn" data-action="bp-print">🖨 Stampa preventivo e consuntivo</button><button class="btn" data-action="bp-csv">⬇ Excel (CSV)</button>
      ${has?'<button class="btn danger" data-action="bp-clear">Svuota</button>':''}</div>
    <div class="sd-kpis">
      ${socKpi('Entrate previste', eur(tP.E), tP.E?`incassate finora ${eur(tC.E)} (${Math.round(tC.E/tP.E*100)}%)`:'')}
      ${socKpi('Uscite previste', eur(tP.U), tP.U?`spese finora ${eur(tC.U)} (${Math.round(tC.U/tP.U*100)}%)`:'')}
      ${socKpi('Risultato previsto', eur(saldoP), saldoP<0?'<b class="sd-red">disavanzo previsto</b>':'avanzo previsto', saldoP<0?'bad':'ok')}
      ${socKpi('Risultato finora', eur(saldoC), el===null?'':el>=100?'stagione conclusa':`stagione trascorsa al ${el}%`, saldoC<0?'bad':'')}
    </div>
    ${!has?`<div class="warn">Il preventivo della stagione ${esc(season)} è vuoto. Scrivi gli importi previsti accanto alle voci${prevHas||consPrevHas?', oppure parti da quelli della stagione '+esc(ps)+' con i pulsanti in alto':''}. Le frecce ↙ propongono un importo calcolato dai dati che hai già (quote assegnate, turni delle palestre, compensi dello staff).</div>`:''}
    <div class="sd-cols">${table('E')}${table('U')}</div>
    <div class="panel" style="margin-top:16px"><label class="f">Note al preventivo (compaiono nella stampa)<textarea data-bpnote="1" rows="3" placeholder="Es. Approvato dall'assemblea del 15 settembre. Aumento dell'affitto della palestra dal 1° gennaio.">${esc(p.note)}</textarea></label></div>`;
};
async function bpSet(t, k, v, render0){
  const season=socSeason(), p=prevOf(season), n=money(v);
  if(n) p[t][k]=n; else delete p[t][k];
  try{ await prevSave(season, p); }catch(e){ saveFail(e); return; }
  if(render0!==false){ const y=window.scrollY; render(); window.scrollTo(0,y); }
}
function bpPrint(){
  const season=socSeason(), p=prevOf(season), c=consOf(season);
  const tbl=t=>{ const cats=prevCats(t,p,c).filter(k=>p[t][k]||c[t][k]);
    return `<table class="p-sched"><thead><tr><th>${t==='E'?'Entrate':'Uscite'}</th><th class="n">Preventivo</th><th class="n">Consuntivo</th><th class="n">Differenza</th></tr></thead>
    <tbody>${cats.map(k=>{ const pv=+p[t][k]||0, cv=+c[t][k]||0; return `<tr><td>${esc(k)}</td><td class="n">${eur(pv)}</td><td class="n">${eur(cv)}</td><td class="n">${eur(cv-pv)}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td>Totale</td><td class="n">${eur(sumObj(p[t]))}</td><td class="n">${eur(sumObj(c[t]))}</td><td class="n">${eur(sumObj(c[t])-sumObj(p[t]))}</td></tr></tfoot></table>`; };
  const sP=sumObj(p.E)-sumObj(p.U), sC=sumObj(c.E)-sumObj(c.U), el=seasonElapsed(season);
  doPrint(`<div class="rc-page wide">${socHeadHTML('Preventivo e consuntivo', 'stagione '+esc(season)+' · '+socSeasonRange(season).map(shortDate).join(' – '))}
    ${tbl('E')}${tbl('U')}
    <table class="p-sched"><tbody><tr><td><b>Risultato</b></td><td class="n"><b>${eur(sP)}</b></td><td class="n"><b>${eur(sC)}</b></td><td class="n">${eur(sC-sP)}</td></tr></tbody></table>
    <p class="rc-note">${el!==null&&el<100?`Consuntivo aggiornato al ${shortDate(todayISO())} (stagione trascorsa al ${el}%). `:''}Il consuntivo comprende gli incassi delle quote e i movimenti di prima nota.</p>
    ${p.note?`<p class="rc-body">${nl2br(p.note)}</p>`:''}</div>`, 'Preventivo '+season.replace('/','-'));
}
function bpCsv(){
  const season=socSeason(), p=prevOf(season), c=consOf(season), rows=[];
  ['E','U'].forEach(t=>prevCats(t,p,c).filter(k=>p[t][k]||c[t][k]).forEach(k=>rows.push([t==='E'?'Entrata':'Uscita', k, +p[t][k]||0, +c[t][k]||0, r2((+c[t][k]||0)-(+p[t][k]||0))])));
  socCsv('preventivo-'+season.replace('/','-')+'.csv', ['Tipo','Voce','Preventivo','Consuntivo','Differenza'], rows);
}
Object.assign(actions, {
  'bp-use': b=>bpSet(b.dataset.t, b.dataset.k, b.dataset.v),
  'bp-add': async b=>{ const k=(prompt('Nome della nuova voce di '+(b.dataset.t==='E'?'entrata':'uscita')+':')||'').trim(); if(!k) return;
    const key=b.dataset.t==='E'?'catE':'catU', L=socLines(key); if(!L.includes(k)) await socCfgSet({[key]:[...L,k].join('\n')}); render(); setTimeout(()=>{ const i=document.querySelector(`[data-bp="${b.dataset.t}"][data-k="${CSS.escape(k)}"]`); if(i) i.focus(); },50); },
  'bp-copy': async b=>{ const season=socSeason(), ps=socPrevSeason(season), src=b.dataset.from==='prev'?prevOf(ps):consOf(ps), p=prevOf(season);
    if((Object.keys(p.E).length||Object.keys(p.U).length) && !confirm('Sostituire gli importi del preventivo '+season+' con quelli '+(b.dataset.from==='prev'?'del preventivo':'del consuntivo')+' '+ps+'?')) return;
    const r=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>+v).map(([k,v])=>[k, Math.round(+v)]));
    try{ await prevSave(season, {E:r(src.E), U:r(src.U), note:p.note}); }catch(e){ saveFail(e); return; } render(); toast('Preventivo compilato: ora aggiusta le voci'); },
  'bp-clear': async ()=>{ if(!confirm('Svuotare il preventivo della stagione '+socSeason()+'?')) return; await prevSave(socSeason(), {E:{},U:{},note:''}); render(); },
  'bp-print': ()=>bpPrint(),
  'bp-csv': ()=>bpCsv()
});
document.addEventListener('change', e=>{
  const t=e.target;
  if(t.dataset.bp){ bpSet(t.dataset.bp, t.dataset.k, t.value); return; }
  if(t.dataset.bpnote){ const season=socSeason(), p=prevOf(season); p.note=t.value; prevSave(season, p).then(()=>toast('Note salvate')).catch(saveFail); }
});
document.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target.dataset && e.target.dataset.bp){ e.preventDefault(); e.target.blur(); } });

/* il rendiconto stampato mostra anche il preventivo, se c'è */
const _bpPrintRend = socPrintRend;
socPrintRend = function(){
  const season=socSeason(), p=prevOf(season);
  if(!Object.keys(p.E).length && !Object.keys(p.U).length) return _bpPrintRend();
  _bpPrintRend();
  const area=$('#print-area'); if(!area) return;
  const c=consOf(season);
  const tbl=t=>{ const cats=prevCats(t,p,c).filter(k=>p[t][k]||c[t][k]);
    return `<table class="p-sched"><thead><tr><th>${t==='E'?'Entrate':'Uscite'}</th><th class="n">Preventivo</th><th class="n">Consuntivo</th></tr></thead><tbody>${cats.map(k=>`<tr><td>${esc(k)}</td><td class="n">${eur(+p[t][k]||0)}</td><td class="n">${eur(+c[t][k]||0)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Totale</td><td class="n">${eur(sumObj(p[t]))}</td><td class="n">${eur(sumObj(c[t]))}</td></tr></tfoot></table>`; };
  const two=area.querySelector('.rc-2'); if(two) two.innerHTML=tbl('E')+tbl('U');
};

/* ================================================================ COMPENSI DELLO STAFF */
const stNorm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]+/g,' ').trim();
function staffNames(x){ const a=stNorm(x.nome+' '+x.cognome), b=stNorm(x.cognome+' '+x.nome); return [a,b]; }
/* pagamenti di una persona in un anno solare (anche quelli vecchi senza collegamento, riconosciuti dal nome) */
function staffPays(x, year){
  const N=staffNames(x);
  return socData().led.filter(m=>m.tipo==='U' && (!year || (m.data||'').startsWith(year)) && (m.staffId===x.id || (!m.staffId && m.controparte && N.includes(stNorm(m.controparte)))))
    .sort((a,b)=>(b.data||'').localeCompare(a.data||''));
}
function staffTot(x, year){
  const L=staffPays(x, year), comp=r2(L.filter(m=>m.natura!=='rimborso').reduce((s,m)=>s+m.importo,0)), rimb=r2(L.filter(m=>m.natura==='rimborso').reduce((s,m)=>s+m.importo,0));
  return {L, comp, rimb, tot:r2(comp+rimb)};
}
function staffSoglia(){ const c=socCfg(); return { s:money(c.sogliaCompensi)||0, p:+c.sogliaAvviso||80 }; }
function staffSogliaState(comp){ const S=staffSoglia(); if(!S.s) return null; const pct=Math.round(comp/S.s*100); return {pct, cls:pct>=100?'p-bad':pct>=S.p?'p-warn':'', s:S.s}; }
function staffYear(){ return ui.stYear || String(today0().getFullYear()); }
function staffYears(){ const Y=new Set([String(today0().getFullYear())]); socData().led.forEach(m=>{ if(m.tipo==='U' && m.staffId && m.data) Y.add(m.data.slice(0,4)); }); return [...Y].sort().reverse(); }

const _stStaffHTML = socStaffHTML;
socStaffHTML = function(){
  const D=socData(), y=staffYear(), S=staffSoglia(); let html=_stStaffHTML();
  if(!D.staff.length) return html;
  const T=D.staff.map(x=>({x, t:staffTot(x,y)})), tot=r2(T.reduce((s,o)=>s+o.t.tot,0)), comp=r2(T.reduce((s,o)=>s+o.t.comp,0));
  const near=T.filter(o=>{ const st=staffSogliaState(o.t.comp); return st && st.cls; });
  const head=`<div class="st-year"><span class="muted">Compensi e rimborsi dell'anno</span><div class="chips">${staffYears().map(v=>`<button class="chip ${v===y?'on':''}" data-action="st-year" data-v="${v}">${v}</button>`).join('')}</div>
    <span style="flex:1"></span><button class="btn sm" data-action="st-print-all">🖨 Riepilogo ${y}</button><button class="btn sm" data-action="st-csv">⬇ CSV</button></div>
    <div class="sd-kpis sm">${socKpi('Pagati nel '+y, eur(tot), `${T.filter(o=>o.t.tot).length} persone`)}${socKpi('Compensi e forfettari', eur(comp), S.s?`soglia per persona ${eur(S.s)}`:'nessuna soglia impostata')}${socKpi('Rimborsi spese documentate', eur(r2(tot-comp)), '')}</div>
    ${near.length?`<div class="warn">⚠ ${near.map(o=>`<b>${esc(fullName(o.x))}</b> ${staffSogliaState(o.t.comp).pct}%`).join(' · ')} della soglia annua dei compensi.</div>`:''}`;
  html=html.replace('<div class="panel sd-rows">', head+'<div class="panel sd-rows">');
  T.forEach(({x,t})=>{
    const st=staffSogliaState(t.comp);
    const tag=t.tot?`<b>${eur(t.tot)}</b><small>nel ${y}${st&&t.comp>0?` · <span class="sd-pill ${st.cls}">${st.pct}% soglia</span>`:''}</small>`:(x.cellulare?`<small>${esc(x.cellulare)}</small>`:'');
    html=html.replace(new RegExp(`(data-action="soc-staff" data-id="${x.id}"[\\s\\S]*?<span class="am">)[\\s\\S]*?(</span></button>)`), `$1${tag}$2`);
  });
  return html;
};
function staffPayHTML(x){
  const y=staffYear(), t=staffTot(x,y), st=staffSogliaState(t.comp), all=staffPays(x), years=[...new Set([y, ...all.map(m=>(m.data||'').slice(0,4))])].sort().reverse();
  return `<div class="atf" id="st-pay"><h3>Compensi e rimborsi</h3>
    <div class="st-year" style="margin-bottom:8px"><div class="chips">${years.map(v=>`<button type="button" class="chip ${v===y?'on':''}" data-action="st-year" data-v="${v}" data-id="${x.id}">${v}</button>`).join('')}</div><span style="flex:1"></span>
      <button type="button" class="btn sm primary" data-action="st-pay" data-id="${x.id}">＋ Registra un pagamento</button>${t.tot?`<button type="button" class="btn sm" data-action="st-print" data-id="${x.id}">🖨 Riepilogo ${y}</button>`:''}</div>
    <div class="sd-kpis sm">${socKpi('Compensi e forfettari', eur(t.comp), st?`<span class="sd-bar ${st.cls==='p-bad'?'u':''}"><i style="width:${Math.min(100,st.pct)}%"></i></span>${st.pct}% della soglia di ${eur(st.s)}`:'', st&&st.cls?(st.cls==='p-bad'?'bad':'warn'):'')}${socKpi('Rimborsi documentati', eur(t.rimb))}${socKpi('Totale '+y, eur(t.tot), t.L.length+' pagament'+(t.L.length===1?'o':'i'))}</div>
    ${t.L.length?`<div class="st-pays">${t.L.map(m=>`<button type="button" data-action="soc-led-edit" data-id="${m.id}"><span>${shortDate(m.data)}</span><span class="d">${esc(m.descrizione||m.categoria||'Pagamento')}${m.staffId?'':' <small class="muted">(riconosciuto dal nome)</small>'}</span><span class="t">${m.natura==='rimborso'?'rimborso':'compenso'}</span><b>${eur(m.importo)}</b></button>`).join('')}</div>`
      :`<p class="muted" style="margin:0">Nessun pagamento nel ${y}.</p>`}</div>`;
}
const _stOpenStaff = openStaff;
openStaff = function(id){
  _stOpenStaff(id);
  if(!id) return; const x=socData().staff.find(s=>s.id===id); if(!x) return;
  const body=$('#st-form .modal-body'); if(body) body.insertAdjacentHTML('beforeend', staffPayHTML(x));
};
function staffPayNew(id){
  const x=socData().staff.find(s=>s.id===id); if(!x) return;
  const mese=cap(new Date().toLocaleDateString('it-IT',{month:'long', year:'numeric'}));
  openLedger(null, 'U', {id:null, tipo:'U', data:todayISO(), importo:'', categoria:'Rimborsi e compensi staff', descrizione:`${x.ruolo?x.ruolo+' – ':''}${mese}`, controparte:fullName(x), metodo:x.iban?'Bonifico':'', documento:'', squadra:(x.squadre||[]).length===1?x.squadre[0]:'', note:'', staffId:x.id, natura:'compenso'});
}
function staffPrint(x){
  const y=staffYear(), t=staffTot(x,y), c=socCfg();
  doPrint(`<div class="rc-page"><div class="rc">${socHeadHTML('Riepilogo compensi e rimborsi', 'anno '+esc(y))}
    <p class="rc-body">Somme corrisposte nell'anno ${esc(y)} a <b>${esc([x.nome,x.cognome].filter(Boolean).join(' '))}</b>${x.codiceFiscale?` (C.F. ${esc(x.codiceFiscale)})`:''}${x.ruolo?`, ${esc(x.ruolo.toLowerCase())}`:''}:</p>
    <table class="p-sched"><thead><tr><th>Data</th><th>Descrizione</th><th>Tipo</th><th>Modalità</th><th class="n">Importo</th></tr></thead>
    <tbody>${[...t.L].reverse().map(m=>`<tr><td>${shortDate(m.data)}</td><td>${esc(m.descrizione||'')}${m.documento?' ('+esc(m.documento)+')':''}</td><td>${m.natura==='rimborso'?'Rimborso spese documentate':'Compenso / rimborso forfettario'}</td><td>${esc(m.metodo||'')}</td><td class="n">${eur(m.importo)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Compensi e rimborsi forfettari</td><td class="n">${eur(t.comp)}</td></tr><tr><td colspan="4">Rimborsi di spese documentate</td><td class="n">${eur(t.rimb)}</td></tr><tr><td colspan="4">Totale</td><td class="n">${eur(t.tot)}</td></tr></tfoot></table>
    <p class="rc-note">Riepilogo interno della società. Per la certificazione e gli adempimenti fiscali e previdenziali fai riferimento al commercialista.</p>
    <div class="rc-foot"><div class="rc-sign">Per ricevuta<br><br><span>_____________________________</span></div><div class="rc-sign">${shortDate(todayISO())}<br><br>${esc(c.firma||'Il legale rappresentante')}<br><span>_____________________________</span></div></div></div></div>`, 'Compensi '+y+' '+fullName(x));
}
function staffPrintAll(){
  const y=staffYear(), T=socData().staff.map(x=>({x, t:staffTot(x,y)})).filter(o=>o.t.tot).sort((a,b)=>b.t.tot-a.t.tot), S=staffSoglia();
  doPrint(`<div class="rc-page wide">${socHeadHTML('Compensi e rimborsi dello staff', 'anno '+esc(y))}
    <table class="p-sched"><thead><tr><th>Persona</th><th>Ruolo</th><th>Codice fiscale</th><th class="n">Pagamenti</th><th class="n">Compensi e forfettari</th><th class="n">Rimborsi documentati</th><th class="n">Totale</th>${S.s?'<th class="n">% soglia</th>':''}</tr></thead>
    <tbody>${T.map(({x,t})=>`<tr><td>${esc(fullName(x))}</td><td>${esc(x.ruolo||'')}</td><td>${esc(x.codiceFiscale||'')}</td><td class="n">${t.L.length}</td><td class="n">${eur(t.comp)}</td><td class="n">${eur(t.rimb)}</td><td class="n">${eur(t.tot)}</td>${S.s?`<td class="n">${Math.round(t.comp/S.s*100)}%</td>`:''}</tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Totale</td><td class="n">${eur(T.reduce((s,o)=>s+o.t.comp,0))}</td><td class="n">${eur(T.reduce((s,o)=>s+o.t.rimb,0))}</td><td class="n">${eur(T.reduce((s,o)=>s+o.t.tot,0))}</td>${S.s?'<td></td>':''}</tr></tfoot></table>
    ${S.s?`<p class="rc-note">Soglia annua per persona impostata dalla società: ${eur(S.s)} (solo compensi e rimborsi forfettari).</p>`:''}</div>`, 'Compensi staff '+y);
}
Object.assign(actions, {
  'st-year': b=>{ ui.stYear=b.dataset.v; if(b.dataset.id){ const el=$('#st-pay'), x=socData().staff.find(s=>s.id===b.dataset.id); if(el && x) el.outerHTML=staffPayHTML(x); } else { const yy=window.scrollY; render(); window.scrollTo(0,yy); } },
  'st-pay': b=>staffPayNew(b.dataset.id),
  'st-print': b=>{ const x=socData().staff.find(s=>s.id===b.dataset.id); if(x) staffPrint(x); },
  'st-print-all': ()=>staffPrintAll(),
  'st-csv': ()=>{ const y=staffYear(), rows=[]; socData().staff.forEach(x=>staffPays(x,y).forEach(m=>rows.push([fullName(x), x.ruolo||'', x.codiceFiscale||'', shortDate(m.data), m.descrizione||'', m.natura==='rimborso'?'Rimborso spese documentate':'Compenso / forfettario', m.metodo||'', m.importo])));
    rows.sort((a,b)=>a[0].localeCompare(b[0],'it')); socCsv('compensi-staff-'+y+'.csv', ['Persona','Ruolo','Codice fiscale','Data','Descrizione','Tipo','Modalità','Importo'], rows); }
});
/* nel modulo di spesa: scegliendo una persona dello staff si compilano categoria e destinatario */
document.addEventListener('change', e=>{
  if(e.target.id!=='led-staff') return; const f=$('#led-form'), x=socData().staff.find(s=>s.id===e.target.value); if(!f || !x) return;
  const set=(n,v)=>{ const i=f.querySelector(`[name=${n}]`); if(i && !i.value.trim()) i.value=v; };
  set('categoria','Rimborsi e compensi staff'); set('controparte', fullName(x));
});
/* soglia nelle impostazioni della società */
const _stDati = socDatiHTML;
socDatiHTML = function(){
  const c=socCfg();
  return _stDati().replace('<div class="panel"><h2>Ricevute</h2>', `<div class="panel"><h2>Compensi dello staff</h2><div class="grid g3">
    <label class="f">Soglia annua per persona (€)<input type="text" inputmode="decimal" data-soc="sogliaCompensi" value="${esc(c.sogliaCompensi||'')}" placeholder="nessuna"></label>
    <label class="f">Avvisa al raggiungimento del (%)<input type="number" min="10" max="100" data-soc="sogliaAvviso" value="${esc(c.sogliaAvviso||80)}"></label></div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Conta solo compensi e rimborsi forfettari, non i rimborsi di spese documentate, per anno solare. Limiti e regole dipendono dalla normativa e dal tipo di collaborazione: fatti indicare dal commercialista la soglia da usare.</p></div>
    <div class="panel"><h2>Ricevute</h2>`);
};
/* da sistemare: staff vicino alla soglia */
const _stChecks = socChecks;
socChecks = function(){
  const G=_stChecks(), y=String(today0().getFullYear());
  const L=socData().staff.map(x=>({x, st:staffSogliaState(staffTot(x,y).comp)})).filter(o=>o.st && o.st.cls);
  if(L.length) G.push({t:'Staff vicino alla soglia annua dei compensi', L:L.map(o=>({a:o.x, s:o.st.pct+'% nel '+y})), hint:'', staff:true});
  return G;
};

/* guida */
GUIDE.splice(3, 0,
['📊','Preventivo della stagione',`
<p>In <b>Società → Preventivo</b> scrivi per ogni voce quanto prevedi di incassare e di spendere nella stagione. Accanto vedi il <b>consuntivo</b> (incassi delle quote e movimenti di prima nota) e la differenza.</p>
<ul><li>Le frecce <b>↙</b> propongono un importo calcolato dai dati che hai già: quote assegnate, costo dei turni delle palestre, compensi dello staff dell'ultimo anno.</li>
<li>Per la stagione nuova puoi partire dal preventivo o dal consuntivo di quella prima, con un tocco.</li>
<li>Il rosso indica le uscite che superano il previsto; le entrate diventano verdi quando raggiungono l'obiettivo.</li>
<li>La stampa «Preventivo e consuntivo» è pronta per l'assemblea; anche il rendiconto della prima nota mostra il confronto.</li></ul>`],
['🧾','Compensi e rimborsi dello staff',`
<p>Quando registri una spesa per una persona dello staff, in <b>Prima nota → Uscita</b> scegli la persona e il tipo: <b>compenso o rimborso forfettario</b> oppure <b>rimborso di spese documentate</b>. Più comodo: apri la persona in <b>Società → Staff</b> e premi <b>Registra un pagamento</b>.</p>
<p>Per ogni persona vedi il totale dell'anno solare, con la stampa del riepilogo da far firmare per ricevuta e il file per il commercialista. In <b>Dati società</b> puoi impostare una soglia annua per persona: l'app avvisa quando ci si avvicina. La soglia giusta dipende dalla normativa e dal tipo di collaborazione: chiedila al commercialista.</p>`],
['🏟','Palestre, turni e affitti',`
<p>In <b>Società → Palestre</b> inserisci le palestre con il costo orario e le chiusure (Natale, Pasqua, lavori), poi i turni di ogni squadra: giorno, orario e periodo. Se la squadra ha già gli orari di allenamento, l'app li propone.</p>
<ul><li>La <b>settimana tipo</b> mostra chi usa cosa e segnala le sovrapposizioni.</li>
<li>Il <b>costo del mese</b> conta i turni reali (tolte le chiusure), per palestra e per squadra; con <b>Registra in prima nota</b> la spesa entra nella cassa con il dettaglio delle ore.</li>
<li>La stima della stagione compare nel preventivo, alla voce «Affitto palestra».</li></ul>`]);
