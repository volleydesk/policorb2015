"use strict";
/* ==================================================================
   Volleydesk – palestre e turni
   Ogni palestra ha un costo orario, i turni settimanali (giorno, orario,
   squadra, periodo) e i periodi di chiusura. Da qui: la settimana tipo con
   le sovrapposizioni, il costo di ogni mese per palestra e per squadra
   (da registrare in prima nota con un tocco) e la stima della stagione,
   che il preventivo usa come suggerimento.
   ================================================================== */
const PAL_GG = ['','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
const PAL_G3 = ['','Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
const palVen = () => socData().ven || [];
const palIsoDow = d => (d.getDay() || 7);
const palMin = t => { const m=/^(\d{1,2}):(\d{2})$/.exec(t||''); return m ? +m[1]*60 + +m[2] : 0; };
const palHours = t => Math.max(0, (palMin(t.alle) - palMin(t.dalle)) / 60);
const palRate = (v, t) => t.costoOrario !== '' && t.costoOrario != null ? +t.costoOrario : (+v.costoOrario || 0);
const palClosed = (v, iso) => (v.chiusure || []).some(c => iso >= c.dal && iso <= (c.al || c.dal));
const palActive = (t, iso) => (!t.dal || iso >= t.dal) && (!t.al || iso <= t.al);
function palTeam(id){
  if(!id) return null; const L=teamsRaw(); const i=L.findIndex(t=>t.id===id);
  if(i>=0) return {nome:teamLabel(L[i],i), col:teamColor(L[i],i)};
  return id==='_' || (!L.length) ? {nome:db.settings.squadra||'La squadra', col:'#2f6fb8'} : null;
}
const palWho = t => (palTeam(t.squadra)||{}).nome || t.chi || 'Altro';
const palCol = t => (palTeam(t.squadra)||{}).col || '#8a8f9c';
const palYm = () => ui.palMese || todayISO().slice(0,7);
function palMonthRange(ym){ const [y,m]=ym.split('-').map(Number); return [toISO(new Date(y,m-1,1)), toISO(new Date(y,m,0))]; }
const palMonthLabel = ym => { const [y,m]=ym.split('-').map(Number); return cap(new Date(y,m-1,1).toLocaleDateString('it-IT',{month:'long', year:'numeric'})); };
function palShiftYm(ym, n){ const [y,m]=ym.split('-').map(Number); const d=new Date(y,m-1+n,1); return toISO(d).slice(0,7); }

/* volte in cui si usa la palestra in un periodo: [{data, t}] */
function palOcc(v, from, to){
  const out=[]; if(v.attiva===false) return out;
  const A=parseISO(from), B=parseISO(to); if(!A||!B) return out;
  for(let d=new Date(A); d<=B; d.setDate(d.getDate()+1)){
    const iso=toISO(d), g=palIsoDow(d); if(palClosed(v, iso)) continue;
    (v.turni||[]).forEach(t=>{ if(t.giorno===g && palActive(t, iso)) out.push({data:iso, t}); });
  }
  return out;
}
function palCost(v, from, to){
  const O=palOcc(v, from, to), per={}; let ore=0, euro=0;
  O.forEach(({t})=>{ const h=palHours(t), c=h*palRate(v,t), k=palWho(t); ore+=h; euro+=c; per[k]=per[k]||{ore:0, euro:0, n:0, col:palCol(t)}; per[k].ore+=h; per[k].euro+=c; per[k].n++; });
  return {n:O.length, ore:Math.round(ore*100)/100, euro:r2(euro), per};
}
function palSeasonCost(season){ const [a,b]=socSeasonRange(season); return r2(palVen().reduce((s,v)=>s+palCost(v,a,b).euro,0)); }
/* sovrapposizioni: stessa palestra, stesso giorno, orari e periodi che si toccano; oppure stessa squadra in due posti */
function palConflicts(){
  const all=[]; palVen().filter(v=>v.attiva!==false).forEach(v=>(v.turni||[]).forEach(t=>all.push({v,t})));
  const per=(a,b)=>(!a.t.al||!b.t.dal||a.t.al>=b.t.dal) && (!b.t.al||!a.t.dal||b.t.al>=a.t.dal);
  const ov=(a,b)=>a.t.giorno===b.t.giorno && palMin(a.t.dalle)<palMin(b.t.alle) && palMin(b.t.dalle)<palMin(a.t.alle) && per(a,b);
  const C=[], bad=new Set();
  for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++){ const a=all[i], b=all[j]; if(!ov(a,b)) continue;
    if(a.v.id===b.v.id){ C.push(`${PAL_GG[a.t.giorno]}: in ${a.v.nome} si sovrappongono ${palWho(a.t)} (${a.t.dalle}–${a.t.alle}) e ${palWho(b.t)} (${b.t.dalle}–${b.t.alle})`); bad.add(a.t.id); bad.add(b.t.id); }
    else if(a.t.squadra && a.t.squadra===b.t.squadra){ C.push(`${PAL_GG[a.t.giorno]}: ${palWho(a.t)} è in due palestre insieme (${a.v.nome} e ${b.v.nome})`); bad.add(a.t.id); bad.add(b.t.id); } }
  return {C, bad};
}

/* ---------------------------------------------------------------- vista */
SOC_TABS.splice(SOC_TABS.findIndex(t=>t[0]==='staff')+1, 0, ['palestre','Palestre']);
SOC_BODY.palestre = function(){
  const V=palVen(), ym=palYm(), [a,b]=palMonthRange(ym), cf=palConflicts(), season=socSeason(), [sa,sb]=socSeasonRange(season);
  if(!V.length) return `<div class="sd-quick"><button class="btn primary" data-action="pal-new">＋ Palestra</button></div>
    <div class="empty">Inserisci le palestre che usate, con il costo orario e i turni di ogni squadra.<br>Volleydesk ti mostra la settimana tipo con le sovrapposizioni, calcola quanto costa ogni mese (per palestra e per squadra) e lo registra in prima nota con un tocco.</div>`;
  /* settimana tipo */
  const today=todayISO(), week=[1,2,3,4,5,6,7].map(g=>{
    const L=[]; V.filter(v=>v.attiva!==false).forEach(v=>(v.turni||[]).forEach(t=>{ if(t.giorno===g && (!t.al || t.al>=today)) L.push({v,t}); }));
    return {g, L:L.sort((x,y)=>x.t.dalle.localeCompare(y.t.dalle))};
  });
  const shown=week.filter(d=>d.L.length || d.g<=5);
  /* costi del mese */
  const rows=V.map(v=>{ const c=palCost(v,a,b), rif=`pal:${v.id}:${ym}`, mv=socData().led.find(m=>m.rif===rif); return {v,c,mv,rif}; });
  const tot=r2(rows.reduce((s,r)=>s+r.c.euro,0)), perSq={};
  rows.forEach(r=>Object.entries(r.c.per).forEach(([k,o])=>{ perSq[k]=perSq[k]||{ore:0,euro:0,col:o.col}; perSq[k].ore+=o.ore; perSq[k].euro+=o.euro; }));
  const daReg=rows.filter(r=>r.c.euro>0 && !r.mv);
  return `<div class="sd-quick"><button class="btn primary" data-action="pal-turno">＋ Turno</button><button class="btn" data-action="pal-new">＋ Palestra</button><button class="btn" data-action="pal-print">🖨 Stampa orari</button></div>
  ${cf.C.length?`<div class="warn"><b>⚠ Sovrapposizioni</b><br>${cf.C.map(esc).join('<br>')}</div>`:''}
  <div class="panel"><div class="sd-ph"><h2>Settimana tipo</h2><span class="muted" style="font-size:13px">turni in corso e futuri</span></div>
    <div class="pal-week" style="--n:${shown.length}">${shown.map(d=>`<div class="pal-day"><b>${PAL_GG[d.g]}</b>${d.L.length?d.L.map(({v,t})=>`<button class="pal-t ${cf.bad.has(t.id)?'bad':''}" style="--c:${palCol(t)}" data-action="pal-turno" data-v="${v.id}" data-id="${t.id}"><span class="h">${t.dalle}–${t.alle}</span><span class="w">${esc(palWho(t))}</span><small>${esc(v.nome)}</small></button>`).join(''):'<span class="muted pal-free">libero</span>'}</div>`).join('')}</div></div>
  <div class="panel"><div class="sd-ph"><h2>Costo del mese</h2><div class="pal-mnav"><button class="iconbtn" data-action="pal-m" data-n="-1" title="Mese precedente">‹</button><b>${esc(palMonthLabel(ym))}</b><button class="iconbtn" data-action="pal-m" data-n="1" title="Mese successivo">›</button></div></div>
    <div class="pal-cost">${rows.map(({v,c,mv})=>`<div class="pal-crow"><span class="nm"><b>${esc(v.nome)}</b><small>${c.n} turn${c.n===1?'o':'i'} · ${String(c.ore).replace('.',',')} ore${v.costoOrario!==''?' · '+eur(+v.costoOrario)+'/ora':' · <span class="sd-red">costo orario da inserire</span>'}</small></span>
      <span class="am"><b>${eur(c.euro)}</b></span><span class="act">${c.euro<=0?'':mv?`<button class="btn sm ghost sd-green" data-action="soc-led-edit" data-id="${mv.id}">✓ in prima nota</button>`:`<button class="btn sm" data-action="pal-reg" data-id="${v.id}">Registra in prima nota</button>`}</span></div>`).join('')}
      <div class="pal-crow tot"><span class="nm"><b>Totale ${esc(palMonthLabel(ym).toLowerCase())}</b></span><span class="am"><b>${eur(tot)}</b></span><span class="act">${daReg.length>1?`<button class="btn sm primary" data-action="pal-reg-all">Registra tutte (${daReg.length})</button>`:''}</span></div></div>
    ${Object.keys(perSq).length?`<h3 class="sd-h3">Per squadra</h3><div class="pal-sq">${Object.entries(perSq).sort((x,y)=>y[1].euro-x[1].euro).map(([k,o])=>`<span style="--c:${o.col}"><i></i>${esc(k)} <b>${eur(o.euro)}</b> <small>${String(Math.round(o.ore*100)/100).replace('.',',')} ore</small></span>`).join('')}</div>`:''}
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">Stima per la stagione ${esc(season)}: <b>${eur(palSeasonCost(season))}</b> (dai turni e dalle chiusure inseriti). Il preventivo la propone per la voce «Affitto palestra».</p></div>
  <div class="panel"><h2>Palestre</h2><div class="sd-rows pal-list">${V.map(v=>`<button class="sd-row ${v.attiva===false?'off':''}" data-action="pal-edit" data-id="${v.id}"><span class="nm"><b>${esc(v.nome)}</b><small>${[v.indirizzo, v.ente?'si paga a '+v.ente:'', (v.chiusure||[]).length?(v.chiusure.length+' chiusur'+(v.chiusure.length===1?'a':'e')):'', v.attiva===false?'non più usata':''].filter(Boolean).map(esc).join(' · ')}</small></span>
      <span class="pr"><small>${(v.turni||[]).length} turn${(v.turni||[]).length===1?'o':'i'} a settimana</small></span><span class="am">${v.costoOrario!==''?`<b>${eur(+v.costoOrario)}</b><small>all'ora</small>`:''}</span></button>`).join('')}</div></div>`;
};

/* ---------------------------------------------------------------- palestra */
function openVenue(id){
  const v=id?clone(palVen().find(x=>x.id===id)):{id:null, nome:'', indirizzo:'', ente:'', costoOrario:'', note:'', attiva:true, turni:[], chiusure:[]};
  if(!v) return; ui.venDraft=v; palVenueRender();
}
function palVenueRender(){
  const v=ui.venDraft, [sa]=socSeasonRange(socSeason());
  openModal(`<div class="modal-box" style="max-width:640px"><form id="ven-form" onsubmit="return false" autocomplete="off">
    <div class="modal-head"><h2 style="flex:1">${v.id?esc(v.nome):'Nuova palestra'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f span2">Nome<input type="text" name="nome" value="${esc(v.nome)}" placeholder="Es. Palestra comunale di via Verdi"></label>
      <label class="f span2">Indirizzo<input type="text" name="indirizzo" value="${esc(v.indirizzo)}"></label>
      <label class="f">A chi si paga<input type="text" name="ente" value="${esc(v.ente)}" placeholder="Es. Comune di Corbetta"></label>
      <label class="f">Costo orario (€)<input type="text" inputmode="decimal" name="costoOrario" value="${esc(moneyIn(v.costoOrario))}" placeholder="0,00"></label>
      <label class="f span2">Note<input type="text" name="note" value="${esc(v.note)}" placeholder="Es. chiavi dal custode, pagamento trimestrale"></label>
      ${v.id?`<label class="sw span2"><input type="checkbox" name="attiva" ${v.attiva!==false?'checked':''}> In uso</label>`:''}
    </div>
    <h3 class="sd-h3">Chiusure (feste, vacanze, lavori)</h3>
    ${(v.chiusure||[]).length?`<div class="pal-chs">${v.chiusure.map((c,i)=>`<div><input type="date" data-ch="${i}" data-k="dal" value="${esc(c.dal)}"><span>→</span><input type="date" data-ch="${i}" data-k="al" value="${esc(c.al)}"><input type="text" data-ch="${i}" data-k="motivo" value="${esc(c.motivo)}" placeholder="Motivo"><button type="button" class="iconbtn" data-action="pal-chdel" data-i="${i}" title="Togli">✕</button></div>`).join('')}</div>`:'<p class="muted" style="margin:0 0 6px">Nessuna chiusura: nei giorni di chiusura i turni non si contano nel costo.</p>'}
    <div class="actions"><button type="button" class="btn sm" data-action="pal-chadd">＋ Chiusura</button>${!(v.chiusure||[]).some(c=>/natal/i.test(c.motivo))?`<button type="button" class="btn sm ghost" data-action="pal-chadd" data-v="natale">＋ Vacanze di Natale</button>`:''}</div>
    ${v.id?`<h3 class="sd-h3">Turni</h3>${(v.turni||[]).length?`<div class="pal-tl">${[...v.turni].sort((x,y)=>x.giorno-y.giorno||x.dalle.localeCompare(y.dalle)).map(t=>`<button type="button" style="--c:${palCol(t)}" data-action="pal-turno" data-v="${v.id}" data-id="${t.id}"><b>${PAL_G3[t.giorno]} ${t.dalle}–${t.alle}</b> ${esc(palWho(t))}${t.dal||t.al?` <small>${t.dal?'dal '+shortDate(t.dal):''} ${t.al?'al '+shortDate(t.al):''}</small>`:''}</button>`).join('')}</div>`:'<p class="muted" style="margin:0 0 6px">Nessun turno.</p>'}<button type="button" class="btn sm" data-action="pal-turno" data-v="${v.id}">＋ Turno in questa palestra</button>`:''}
    </div>
    <div class="modal-foot">${v.id?'<button type="button" class="btn danger" data-action="pal-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="close-modal">Annulla</button><button type="button" class="btn primary" data-action="pal-save">${v.id?'Salva':'Salva e aggiungi i turni'}</button></div></form></div>`);
  void sa;
}
function palVenueRead(){ const f=$('#ven-form'); if(!f) return ui.venDraft; const fd=new FormData(f), v=ui.venDraft;
  ['nome','indirizzo','ente','note'].forEach(k=>v[k]=(fd.get(k)||'').toString().trim());
  const c=(fd.get('costoOrario')||'').toString().trim(); v.costoOrario=c===''?'':money(c); if(v.id) v.attiva=!!fd.get('attiva');
  return v; }
async function palVenueSave(){
  const v=palVenueRead(); if(!v.nome){ alert('Scrivi il nome della palestra.'); return; }
  const isNew=!v.id; if(isNew) v.id=newId('pa');
  try{ await socPut('venues', v); }catch(e){ if(isNew) v.id=null; alert(e.message||e); return; }
  toast('Palestra salvata'); socRefreshBehind();
  if(isNew) openTurno(v.id); else closeModal();
}

/* ---------------------------------------------------------------- turno */
function openTurno(vid, tid){
  const V=palVen(); if(!V.length){ openVenue(null); return; }
  const v=V.find(x=>x.id===vid) || V[0], t0=tid && (v.turni||[]).find(t=>t.id===tid);
  const [sa,sb]=socSeasonRange(socSeasonOf(todayISO()));
  const t=t0?clone(t0):{id:null, giorno:1, dalle:'18:00', alle:'19:30', squadra:teamMulti()?teamCur():'_', chi:'', dal:sa, al:sb, costoOrario:'', note:''};
  ui.turDraft={vid:v.id, orig:v.id, t};
  const T=accTeams();
  openModal(`<div class="modal-box" style="max-width:560px"><form id="tur-form" onsubmit="return false">
    <div class="modal-head"><h2 style="flex:1">${t0?'Turno':'Nuovo turno'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f">Palestra<select name="vid">${V.map(x=>`<option value="${x.id}" ${x.id===v.id?'selected':''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="f">Chi la usa<select name="squadra" id="tur-sq">${T.map(x=>`<option value="${esc(x.id||'_')}" ${(t.squadra||'')===(x.id||'_')?'selected':''}>${esc(x.nome)}</option>`).join('')}<option value="" ${!t.squadra?'selected':''}>Altro (scrivi sotto)</option></select></label>
      <label class="f ${t.squadra?'hidden':''}" id="tur-chi">Chi<input type="text" name="chi" value="${esc(t.chi)}" placeholder="Es. corso adulti, altra società"></label>
      <label class="f">Giorno<select name="giorno">${[1,2,3,4,5,6,7].map(g=>`<option value="${g}" ${t.giorno===g?'selected':''}>${PAL_GG[g]}</option>`).join('')}</select></label>
      <label class="f">Dalle<input type="time" name="dalle" value="${esc(t.dalle)}"></label>
      <label class="f">Alle<input type="time" name="alle" value="${esc(t.alle)}"></label>
      <label class="f">Dal<input type="date" name="dal" value="${esc(t.dal)}"></label>
      <label class="f">Al<input type="date" name="al" value="${esc(t.al)}"></label>
      <label class="f">Costo orario diverso (€)<input type="text" inputmode="decimal" name="costoOrario" value="${esc(moneyIn(t.costoOrario))}" placeholder="${v.costoOrario!==''?'come la palestra: '+eur(+v.costoOrario):''}"></label>
      <label class="f span2">Note<input type="text" name="note" value="${esc(t.note)}"></label>
    </div>
    ${!t0?`<p class="pal-cal" id="tur-cal">${palCalHint(t.squadra)}</p>`:''}</div>
    <div class="modal-foot">${t0?'<button type="button" class="btn danger" data-action="tur-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="close-modal">Annulla</button>${t0?'':'<button type="button" class="btn" data-action="tur-save" data-again="1">Salva e aggiungi un altro</button>'}<button type="button" class="btn primary" data-action="tur-save">Salva</button></div></form></div>`);
}
/* orari di allenamento già impostati per la squadra (Presenze → calendario) */
function palTeamCal(sq){
  if(!sq || typeof accTeamSettings!=='function') return [];
  let c={}; try{ c=JSON.parse(accTeamSettings(sq==='_'?'':sq).calendarioAllenamenti||'{}')||{}; }catch(e){}
  return Object.entries(c.giorni||{}).filter(([,h])=>/^\d{1,2}:\d{2}$/.test(h||'')).map(([g,h])=>({giorno:(+g)||7, dalle:h.padStart(5,'0')}));
}
function palCalHint(sq){
  const L=palTeamCal(sq); if(!L.length) return '';
  return `Questa squadra si allena ${L.map(x=>PAL_GG[x.giorno].toLowerCase()+' alle '+x.dalle).join(', ')}. <button type="button" class="btn sm" data-action="tur-cal">Crea un turno per ognuno (1 ora e mezza)</button>`;
}
function palTurnoRead(){
  const fd=new FormData($('#tur-form')), D=ui.turDraft, t=D.t;
  D.vid=(fd.get('vid')||'').toString(); t.squadra=(fd.get('squadra')||'').toString(); t.chi=t.squadra?'':(fd.get('chi')||'').toString().trim();
  t.giorno=+fd.get('giorno'); ['dalle','alle','dal','al','note'].forEach(k=>t[k]=(fd.get(k)||'').toString().trim());
  const c=(fd.get('costoOrario')||'').toString().trim(); t.costoOrario=c===''?'':money(c);
  return D;
}
async function palTurnoSave(again){
  const D=palTurnoRead(), t=D.t, V=palVen();
  if(!t.squadra && !t.chi){ alert('Scrivi chi usa la palestra in questo turno.'); return; }
  if(!t.dalle || !t.alle || t.alle<=t.dalle){ alert("Controlla gli orari: l'ora di fine deve venire dopo quella di inizio."); return; }
  if(t.dal && t.al && t.al<t.dal){ alert('Il periodo non è valido: «al» viene prima di «dal».'); return; }
  const isNew=!t.id; if(isNew) t.id=newId('tu');
  const items=[];
  const dst=clone(V.find(x=>x.id===D.vid)); dst.turni=(dst.turni||[]).filter(x=>x.id!==t.id).concat([t]); items.push({c:'venues', r:dst});
  if(D.orig!==D.vid){ const src=clone(V.find(x=>x.id===D.orig)); if(src){ src.turni=(src.turni||[]).filter(x=>x.id!==t.id); items.push({c:'venues', r:src}); } }
  try{ await socBulk(items); }catch(e){ if(isNew) t.id=null; alert(e.message||e); return; }
  const cf=palConflicts(); toast(cf.bad.has(t.id)?'⚠ Turno salvato, ma si sovrappone a un altro':'Turno salvato');
  if(again){ const vid=D.vid; openTurno(vid); const f=$('#tur-form'); if(f){ f.querySelector('[name=squadra]').value=t.squadra||''; ['dalle','alle','dal','al'].forEach(k=>f.querySelector(`[name=${k}]`).value=t[k]); f.querySelector('[name=giorno]').value=String(t.giorno%7+1); } }
  else closeModal();
  socRefreshBehind();
}
async function palFromCal(){
  const D=palTurnoRead(), L=palTeamCal(D.t.squadra), v=clone(palVen().find(x=>x.id===D.vid)); if(!L.length || !v) return;
  const add=L.filter(x=>!(v.turni||[]).some(t=>t.squadra===D.t.squadra && t.giorno===x.giorno && t.dalle===x.dalle));
  if(!add.length){ alert('In questa palestra ci sono già tutti i turni di allenamento di questa squadra.'); return; }
  const end=m=>{ const x=palMin(m)+90; return String(Math.floor(x/60)%24).padStart(2,'0')+':'+String(x%60).padStart(2,'0'); };
  v.turni=[...(v.turni||[]), ...add.map(x=>({id:newId('tu'), giorno:x.giorno, dalle:x.dalle, alle:end(x.dalle), squadra:D.t.squadra, chi:'', dal:D.t.dal, al:D.t.al, costoOrario:'', note:''}))];
  try{ await socPut('venues', v); }catch(e){ alert(e.message||e); return; }
  closeModal(); toast(`Creati ${add.length} turni: controlla l'ora di fine`); socRefreshBehind();
}

/* ---------------------------------------------------------------- registrazione in prima nota */
function palMovement(v, ym){
  const [a,b]=palMonthRange(ym), c=palCost(v,a,b); if(c.euro<=0) return null;
  const det=Object.entries(c.per).map(([k,o])=>`${k}: ${String(Math.round(o.ore*100)/100).replace('.',',')} ore (${eur(o.euro)})`).join('; ');
  return {id:newId('mv'), data:b<todayISO()?b:todayISO(), tipo:'U', importo:c.euro, categoria:'Affitto palestra', descrizione:`Affitto ${v.nome} – ${palMonthLabel(ym).toLowerCase()} (${String(c.ore).replace('.',',')} ore)`,
    controparte:v.ente||'', metodo:'', documento:'', squadra:'', note:det, rif:`pal:${v.id}:${ym}`, stagione:socSeasonOf(b), createdAt:Date.now(), updatedAt:Date.now()};
}
async function palRegister(ids){
  const ym=palYm(), items=ids.map(id=>palVen().find(v=>v.id===id)).filter(Boolean).filter(v=>!socData().led.some(m=>m.rif===`pal:${v.id}:${ym}`)).map(v=>palMovement(v,ym)).filter(Boolean).map(r=>({c:'ledger', r}));
  if(!items.length) return;
  try{ await socBulk(items); }catch(e){ saveFail(e); return; }
  toast(items.length===1?'Spesa registrata in prima nota':`${items.length} spese registrate in prima nota`); socRefreshBehind();
}
function palPrint(){
  const V=palVen().filter(v=>v.attiva!==false), today=todayISO();
  const rows=[]; V.forEach(v=>(v.turni||[]).filter(t=>!t.al||t.al>=today).forEach(t=>rows.push({v,t})));
  rows.sort((x,y)=>x.t.giorno-y.t.giorno||x.t.dalle.localeCompare(y.t.dalle));
  doPrint(`<div class="rc-page wide">${socHeadHTML('Orari delle palestre', 'stagione '+esc(socSeasonOf(today)))}
    <table class="p-sched"><thead><tr><th>Giorno</th><th>Orario</th><th>Chi</th><th>Palestra</th><th>Periodo</th></tr></thead>
    <tbody>${rows.map(({v,t})=>`<tr><td>${PAL_GG[t.giorno]}</td><td>${t.dalle}–${t.alle}</td><td>${esc(palWho(t))}</td><td>${esc(v.nome)}${v.indirizzo?'<br><small>'+esc(v.indirizzo)+'</small>':''}</td><td>${t.dal?shortDate(t.dal):''} – ${t.al?shortDate(t.al):''}</td></tr>`).join('')}</tbody></table>
    ${V.some(v=>(v.chiusure||[]).length)?`<h3>Chiusure</h3><table class="p-sched"><tbody>${V.flatMap(v=>(v.chiusure||[]).map(c=>`<tr><td>${esc(v.nome)}</td><td>${shortDate(c.dal)}${c.al&&c.al!==c.dal?' – '+shortDate(c.al):''}</td><td>${esc(c.motivo||'')}</td></tr>`)).join('')}</tbody></table>`:''}</div>`, 'Orari palestre');
}

Object.assign(actions, {
  'pal-new': ()=>openVenue(null),
  'pal-edit': b=>openVenue(b.dataset.id),
  'pal-save': ()=>palVenueSave(),
  'pal-del': async ()=>{ const v=ui.venDraft; if(!v.id) return; const n=(v.turni||[]).length;
    if(!confirm(`Eliminare «${v.nome}»${n?' e i suoi '+n+' turni':''}? Le spese già registrate in prima nota restano.`)) return;
    try{ await socDel('venues', v.id); }catch(e){ saveFail(e); return; } closeModal(); toast('Palestra eliminata'); socRefreshBehind(); },
  'pal-chadd': b=>{ const v=palVenueRead(); v.chiusure=v.chiusure||[];
    if(b.dataset.v==='natale'){ const [sa]=socSeasonRange(socSeason()), y=+sa.slice(0,4); v.chiusure.push({id:newId('ch'), dal:`${y}-12-23`, al:`${y+1}-01-06`, motivo:'Vacanze di Natale'}); }
    else v.chiusure.push({id:newId('ch'), dal:todayISO(), al:todayISO(), motivo:''});
    palVenueRender(); },
  'pal-chdel': b=>{ const v=palVenueRead(); v.chiusure.splice(+b.dataset.i,1); palVenueRender(); },
  'pal-turno': b=>openTurno(b.dataset.v, b.dataset.id),
  'tur-save': b=>palTurnoSave(!!b.dataset.again),
  'tur-del': async ()=>{ const D=ui.turDraft; if(!confirm('Eliminare questo turno?')) return; const v=clone(palVen().find(x=>x.id===D.orig)); if(!v) return;
    v.turni=(v.turni||[]).filter(t=>t.id!==D.t.id); try{ await socPut('venues', v); }catch(e){ saveFail(e); return; } closeModal(); toast('Turno eliminato'); socRefreshBehind(); },
  'tur-cal': ()=>palFromCal(),
  'pal-m': b=>{ ui.palMese=palShiftYm(palYm(), +b.dataset.n); const y=window.scrollY; render(); window.scrollTo(0,y); },
  'pal-reg': b=>palRegister([b.dataset.id]),
  'pal-reg-all': ()=>palRegister(palVen().map(v=>v.id)),
  'pal-print': ()=>palPrint()
});
document.addEventListener('change', e=>{
  const t=e.target;
  if(t.dataset.ch!==undefined && ui.venDraft){ const c=ui.venDraft.chiusure[+t.dataset.ch]; if(c) c[t.dataset.k]=t.value; return; }
  if(t.id==='tur-sq'){ const w=$('#tur-chi'); if(w) w.classList.toggle('hidden', !!t.value); const h=$('#tur-cal'); if(h) h.innerHTML=palCalHint(t.value); }
});
/* lo scadenzario e la panoramica non cambiano; i promemoria non riguardano le palestre */
