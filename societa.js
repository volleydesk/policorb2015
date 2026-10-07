"use strict";
/* ==================================================================
   Volleydesk – gestione della società
   Quote e rate degli atleti, incassi e ricevute, prima nota (entrate e
   uscite), scadenzario unico, staff, magazzino e dati della società.

   Le schede di questo modulo sono di TUTTA la società, non della squadra
   attiva: per questo gli atleti si leggono con Store.list('athletes') e
   non da db.athletes (che contiene solo quelli della squadra in uso).
   ================================================================== */

/* ---------------------------------------------------------------- costanti */
const SOC_TABS = [['panoramica','Panoramica'],['quote','Quote'],['cassa','Prima nota'],['scadenze','Scadenzario'],['staff','Staff'],['magazzino','Magazzino'],['dati','Dati società']];
const SOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 20.5h17"/><path d="M5 20.5V10M9.7 20.5V10M14.3 20.5V10M19 20.5V10"/><path d="M2.8 10h18.4L12 3.5z"/></svg>';
const SOC_VOCI = ['Quota di iscrizione','Quota associativa','Tesseramento','Divisa e kit','Torneo','Camp estivo','Trasferta','Altro'];
const SOC_RUOLI = ['Presidente','Vicepresidente','Segretario','Tesoriere','Consigliere','Dirigente accompagnatore','Allenatore','Secondo allenatore','Preparatore atletico','Segnapunti','Arbitro associato','Volontario'];
const SOC_CAT_SCAD = ['Federazione / ente di promozione','Iscrizione campionato','Affitto palestra','Assicurazione','Fiscale e contabile','Banca','Assemblea dei soci','Rinnovo registro (RASD)','Altro'];
const SOC_INV_CAT = ['Palloni','Divise gara','Abbigliamento','Attrezzatura','Primo soccorso','Altro'];
const SOC_RIC = [['','Una volta'],['mensile','Ogni mese'],['bimestrale','Ogni 2 mesi'],['trimestrale','Ogni 3 mesi'],['semestrale','Ogni 6 mesi'],['annuale','Ogni anno']];
const SOC_RIC_MESI = {mensile:1, bimestrale:2, trimestrale:3, semestrale:6, annuale:12};
const SOC_MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const SOC_DEF = {
  ragioneSociale:'', forma:'ASD', codiceFiscale:'', partitaIva:'', indirizzo:'', citta:'', email:'', pec:'', telefono:'', sito:'',
  presidente:'', tesoriere:'', firma:'', iban:'', intestatarioIban:'',
  meseInizio:9,
  metodi:'Contanti\nBonifico\nCarta / POS\nSatispay\nPayPal\nAssegno',
  catE:'Sponsor\nContributi ed erogazioni liberali\nEventi e feste\nTornei organizzati\nVendita materiale\n5 per mille\nContributi pubblici\nAltre entrate',
  catU:'Affitto palestra\nIscrizione campionati\nTesseramenti e assicurazione\nArbitri e tasse gara\nRimborsi e compensi staff\nMateriale sportivo\nDivise\nTrasferte\nVisite mediche\nSpese bancarie\nSegreteria e cancelleria\nAltre uscite',
  pianiQuota:[],
  notaRicevuta:'', detrazione:true, bollo:false,
  causale:'Quota {stagione} – {atleta}',
  sollecito:'Ciao {nome}, dalla segreteria di {societa}: per {atleta} risulta ancora da versare {importo} ({descrizione}, scadenza {scadenza}).{iban}\nGrazie!'
};

/* ---------------------------------------------------------------- impostazioni */
function socRaw(){ try{ const v=JSON.parse((db.settings && db.settings.societa) || '{}'); return v && typeof v==='object' ? v : {}; }catch(e){ return {}; } }
function socCfg(){ return Object.assign({}, SOC_DEF, socRaw()); }
async function socCfgSet(patch){ const v=Object.assign(socRaw(), patch); db.settings.societa=JSON.stringify(v); await persist.settings(); }
const socLines = k => String(socCfg()[k] || '').split('\n').map(x=>x.trim()).filter(Boolean);
const socName = () => socCfg().ragioneSociale || db.settings.squadra || 'la società';

/* ---------------------------------------------------------------- dati (tutte le squadre) */
let SOCD = null;
function socData(){
  if(!SOCD){
    const at=Store.list('athletes');
    SOCD = { at, atMap:new Map(at.map(a=>[a.id,a])), pay:Store.list('payments'), led:Store.list('ledger'), dl:Store.list('deadlines'), staff:Store.list('staff'), inv:Store.list('inventory'), ven:Store.list('venues') };
  }
  return SOCD;
}
Store.onChange(()=>{ SOCD=null; });
const SOC_ROUTE = {venues:'palestre', payments:'quote', ledger:'movimenti', deadlines:'scadenze', staff:'staff', inventory:'magazzino'};
async function socPut(c, r){ r.updatedAt=Date.now(); if(!r.createdAt) r.createdAt=r.updatedAt; await api('PUT', '/api/'+SOC_ROUTE[c]+'/'+encodeURIComponent(r.id), r); SOCD=null; }
async function socDel(c, id){ await api('DELETE', '/api/'+SOC_ROUTE[c]+'/'+encodeURIComponent(id)); SOCD=null; }
async function socBulk(items, dels){ await api('POST', '/api/multipli', {items, dels:dels||[]}); SOCD=null; }
const socAt = id => socData().atMap.get(id);
const socAtName = id => { const a=socAt(id); return a ? fullName(a) : 'Atleta eliminato'; };
function socTeamOf(a){ if(!a || !teamMulti()) return ''; const L=teamsRaw(); return atTeams(a).map(id=>{ const i=L.findIndex(t=>t.id===id); return i>=0?teamLabel(L[i],i):''; }).filter(Boolean).join(', '); }
function socRefresh(){ SOCD=null; if(ui.view==='societa'){ const y=window.scrollY; render(); window.scrollTo(0,y); } }

/* ---------------------------------------------------------------- denaro e date */
const r2 = n => Math.round((+n || 0) * 100) / 100;
const eur = n => r2(n).toLocaleString('it-IT', {style:'currency', currency:'EUR'});
const money = v => Store.money(v);
const moneyIn = n => (n===''||n==null) ? '' : String(r2(n)).replace('.', ',');
function eurWords(n){
  n=r2(n); const int=Math.floor(n), dec=Math.round((n-int)*100);
  const U=['zero','uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci','undici','dodici','tredici','quattordici','quindici','sedici','diciassette','diciotto','diciannove'];
  const T=['','','venti','trenta','quaranta','cinquanta','sessanta','settanta','ottanta','novanta'];
  const b100=x=>{ if(x<20) return x?U[x]:''; let t=T[Math.floor(x/10)]; const u=x%10; if(u===1||u===8) t=t.slice(0,-1); return t+(u?U[u]:''); };
  const b1000=x=>{ const h=Math.floor(x/100), r=x%100; let hs=h===0?'':h===1?'cento':U[h]+'cento'; const rs=b100(r); if(hs && rs.startsWith('o')) hs=hs.slice(0,-1); return hs+rs; };
  const words=x=>{ if(x===0) return 'zero'; let out=''; const m=Math.floor(x/1e6), k=Math.floor((x%1e6)/1000), r=x%1000;
    if(m) out+= m===1?'unmilione':b1000(m)+'milioni'; if(k) out+= k===1?'mille':b1000(k)+'mila'; out+=b1000(r);
    if(out.length>3 && out.endsWith('tre')) out=out.slice(0,-1)+'é'; return out; };
  return words(int)+'/'+String(dec).padStart(2,'0');
}
function socSeasonOf(iso){
  const st=+socCfg().meseInizio||9, d=parseISO(iso)||today0(), y=d.getFullYear(), m=d.getMonth()+1;
  if(st===1) return String(y);
  const y0=m>=st?y:y-1; return y0+'/'+String((y0+1)%100).padStart(2,'0');
}
function socSeasonRange(season){
  const st=+socCfg().meseInizio||9, y0=parseInt(season,10); if(!y0) return ['0000-00-00','9999-12-31'];
  if(st===1) return [y0+'-01-01', y0+'-12-31'];
  return [`${y0}-${String(st).padStart(2,'0')}-01`, toISO(new Date(y0+1, st-1, 0))];
}
function socSeason(){ return ui.socSeason || socSeasonOf(todayISO()); }
function socSeasons(){
  const S=new Set([socSeasonOf(todayISO())]); const D=socData();
  D.pay.forEach(p=>p.stagione && S.add(p.stagione)); D.led.forEach(m=>m.data && S.add(socSeasonOf(m.data)));
  const cur=socSeasonOf(todayISO()), y=parseInt(cur,10); if(y) S.add((+socCfg().meseInizio||9)===1?String(y+1):(y+1)+'/'+String((y+2)%100).padStart(2,'0'));
  return [...S].sort((a,b)=>b.localeCompare(a));
}
const inRange = (d, [a,b]) => !!d && d>=a && d<=b;
const socAge = (a, iso) => { const b=parseISO(a && a.dataNascita), t=parseISO(iso) || today0(); if(!b) return null; let y=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) y--; return y; };

/* ---------------------------------------------------------------- quote */
const payPaid = p => r2((p.incassi||[]).reduce((s,x)=>s+(+x.importo||0),0));
const payDue = p => p.annullata ? 0 : Math.max(0, r2(p.importo - payPaid(p)));
function payState(p){
  if(p.annullata) return 'annullata';
  if(payDue(p)<=0) return 'pagata';
  if(p.scadenza && p.scadenza<todayISO()) return 'scaduta';
  return payPaid(p)>0 ? 'parziale' : 'dapagare';
}
const PAY_ST = {pagata:['p-ok','Pagata'], parziale:['p-warn','In parte'], dapagare:['','Da pagare'], scaduta:['p-bad','Scaduta'], annullata:['p-off','Annullata']};
const payPill = st => `<span class="sd-pill ${PAY_ST[st][0]}">${PAY_ST[st][1]}</span>`;
function payDesc(p){ return p.descrizione || p.voce || 'Quota'; }
/* conto di un atleta in una stagione */
function socAccount(aid, season){
  const L=socData().pay.filter(p=>p.atletaId===aid && (!season || p.stagione===season) && !p.annullata);
  const dovuto=r2(L.reduce((s,p)=>s+p.importo,0)), pagato=r2(L.reduce((s,p)=>s+payPaid(p),0));
  const aperte=L.filter(p=>payDue(p)>0).sort((a,b)=>(a.scadenza||'9').localeCompare(b.scadenza||'9'));
  const scaduto=r2(aperte.filter(p=>payState(p)==='scaduta').reduce((s,p)=>s+payDue(p),0));
  const st=!L.length?'nessuna':aperte.length===0?'pagata':scaduto>0?'scaduta':pagato>0?'parziale':'dapagare';
  return {L, dovuto, pagato, residuo:r2(dovuto-pagato), scaduto, next:aperte[0]||null, st};
}
/* chi paga (per ricevute e solleciti): il genitore se l'atleta è minorenne */
function socPayer(a){
  if(!a) return {nome:'', cf:'', tel:'', email:''};
  const age=socAge(a), minor=age!==null && age<18;
  const self={nome:[a.nome,a.cognome].filter(Boolean).join(' '), cf:a.codiceFiscale||'', tel:a.cellulare||'', email:a.email||''};
  if(minor || a.genitore) return {nome:a.genitore||self.nome, cf:a.cfGenitore||(a.genitore?'':self.cf), tel:a.telGenitore||a.cellulare||'', email:a.emailGenitore||a.email||'', genitore:!!a.genitore};
  return self;
}
function socNextReceipt(iso){
  const y=(iso||todayISO()).slice(0,4); let max=0;
  socData().pay.forEach(p=>(p.incassi||[]).forEach(x=>{ const m=/^(\d+)\/(\d{4})$/.exec(x.ricevuta||''); if(m && m[2]===y) max=Math.max(max,+m[1]); }));
  return (max+1)+'/'+y;
}
/* tutti gli incassi delle quote, come movimenti di prima nota */
function socIncassi(){
  const out=[];
  socData().pay.forEach(p=>(p.incassi||[]).forEach(x=>out.push({src:'q', id:p.id+':'+x.id, pid:p.id, iid:x.id, data:x.data, tipo:'E', categoria:'Quote atleti',
    descrizione:payDesc(p)+' – '+socAtName(p.atletaId), controparte:x.pagatoDa||'', metodo:x.metodo, documento:x.ricevuta?'Ricevuta '+x.ricevuta:'', importo:+x.importo||0, atletaId:p.atletaId})));
  return out;
}
function socMovements(range){
  const L=[...socIncassi(), ...socData().led.map(m=>Object.assign({src:'m'}, m))];
  return L.filter(m=>!range || inRange(m.data, range)).sort((a,b)=>(b.data||'').localeCompare(a.data||'') || (b.updatedAt||0)-(a.updatedAt||0));
}

/* ---------------------------------------------------------------- scadenzario unico */
function socAgenda(horizon){
  const td=todayISO(), D=socData(), out=[], lim=horizon===undefined?365:horizon;
  const add=(o)=>{ const n=daysTo(o.d); if(n===null || n>lim) return; o.n=n; out.push(o); };
  D.pay.forEach(p=>{ const due=payDue(p); if(due>0 && p.scadenza) add({d:p.scadenza, k:'quote', ic:'💶', t:socAtName(p.atletaId), s:payDesc(p)+(payPaid(p)>0?' · versati '+eur(payPaid(p)):''), imp:due, act:'soc-at', id:p.atletaId}); });
  D.at.filter(a=>a.iscritto).forEach(a=>{
    if(a.scadenzaVisita) add({d:a.scadenzaVisita, k:'atleti', ic:'🩺', t:fullName(a), s:'Visita medica', act:'soc-at-edit', id:a.id});
    if(a.scadenzaTessera) add({d:a.scadenzaTessera, k:'atleti', ic:'🎫', t:fullName(a), s:'Tesseramento'+(a.tessera?' n° '+a.tessera:''), act:'soc-at-edit', id:a.id});
    if(a.scadenzaDocumento) add({d:a.scadenzaDocumento, k:'atleti', ic:'🪪', t:fullName(a), s:'Documento d\'identità', act:'soc-at-edit', id:a.id});
  });
  D.staff.filter(x=>x.attivo!==false).forEach(x=>{
    const nm=fullName(x);
    if(x.scadenzaTessera) add({d:x.scadenzaTessera, k:'staff', ic:'🎫', t:nm, s:'Tesseramento '+(x.ruolo||''), act:'soc-staff', id:x.id});
    if(x.scadenzaVisita) add({d:x.scadenzaVisita, k:'staff', ic:'🩺', t:nm, s:'Visita medica', act:'soc-staff', id:x.id});
    if(x.scadenzaQualifica) add({d:x.scadenzaQualifica, k:'staff', ic:'🎓', t:nm, s:(x.qualifica||'Qualifica / brevetto'), act:'soc-staff', id:x.id});
    if(x.scadenzaCasellario) add({d:x.scadenzaCasellario, k:'staff', ic:'📄', t:nm, s:'Certificato del casellario (lavoro con minori)', act:'soc-staff', id:x.id});
  });
  D.dl.filter(d=>!d.fatto).forEach(d=>add({d:d.data, k:'societa', ic:'📌', t:d.titolo, s:[d.categoria, SOC_RIC.find(r=>r[0]===d.ricorrenza)?.[0]?'si ripete '+SOC_RIC.find(r=>r[0]===d.ricorrenza)[1].toLowerCase():''].filter(Boolean).join(' · '), imp:d.importo===''?null:d.importo, act:'soc-dl', id:d.id, dl:d}));
  return out.sort((a,b)=>a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
}
function socAddMonths(iso, n){ const d=parseISO(iso); const day=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+n); const last=new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(day,last)); return toISO(d); }

/* ---------------------------------------------------------------- controlli */
function socChecks(){
  const D=socData(), td=todayISO(), I=D.at.filter(a=>a.iscritto), season=socSeason(), G=[];
  const add=(t,L,hint)=>{ if(L.length) G.push({t,L,hint}); };
  add('Senza visita medica valida', I.filter(a=>!a.scadenzaVisita || a.scadenzaVisita<td).map(a=>({a, s:a.scadenzaVisita?'scaduta il '+shortDate(a.scadenzaVisita):'manca la data'})), 'Non possono allenarsi né giocare finché non la portano.');
  add('Senza quote nella stagione '+season, I.filter(a=>!D.pay.some(p=>p.atletaId===a.id && p.stagione===season && !p.annullata)).map(a=>({a})), 'Usa «Assegna quote» per crearle in un colpo solo.');
  add('Minorenni senza i dati del genitore', I.filter(a=>{ const g=socAge(a); return g!==null && g<18 && (!a.genitore || !a.cfGenitore); }).map(a=>({a, s:!a.genitore?'manca il nome':'manca il codice fiscale'})), 'Servono per intestare le ricevute (detrazione nel 730).');
  add('Senza codice fiscale', I.filter(a=>!a.codiceFiscale).map(a=>({a})), 'Serve per il tesseramento e per le ricevute.');
  add('Privacy non firmata', I.filter(a=>!a.privacy).map(a=>({a})), 'Il modulo del consenso al trattamento dei dati personali.');
  add('Tesseramento da fare o scaduto', I.filter(a=>!a.tessera || (a.scadenzaTessera && a.scadenzaTessera<td)).map(a=>({a, s:a.tessera?'scaduto il '+shortDate(a.scadenzaTessera):'manca il numero di tessera'})), '');
  const R={}; D.pay.forEach(p=>(p.incassi||[]).forEach(x=>{ if(x.ricevuta){ (R[x.ricevuta]=R[x.ricevuta]||[]).push(p); } }));
  const dup=Object.entries(R).filter(([,L])=>L.length>1);
  if(dup.length) G.push({t:'Ricevute con lo stesso numero', L:dup.map(([n,L])=>({a:socAt(L[0].atletaId), s:'ricevuta '+n+' usata '+L.length+' volte', id:L[0].atletaId})), hint:'Può succedere se due dispositivi registrano un incasso senza rete: correggi il numero di una delle due.'});
  return G;
}

/* ---------------------------------------------------------------- vista principale */
/* schede aggiunte da altri file: SOC_BODY[nome] = stagione => html; SOC_SEASON_TABS: schede con la scelta della stagione */
const SOC_BODY = {}, SOC_SEASON_TABS = ['panoramica','quote','cassa'];
function viewSocieta(){
  const tab=ui.socTab||'panoramica', c=socCfg(), season=socSeason();
  const body = SOC_BODY[tab] ? SOC_BODY[tab](season) : tab==='quote'?socQuoteHTML(season) : tab==='cassa'?socCassaHTML(season) : tab==='scadenze'?socScadHTML() : tab==='staff'?socStaffHTML()
    : tab==='magazzino'?socInvHTML() : tab==='dati'?socDatiHTML() : socPanoramicaHTML(season);
  const seasonSel=SOC_SEASON_TABS.includes(tab)?`<select id="soc-season" class="sd-season" title="Stagione">${socSeasons().map(s=>`<option ${s===season?'selected':''}>${esc(s)}</option>`).join('')}</select>`:'';
  return `<section class="sd">
  <div class="page-head"><div><h1>${esc(c.ragioneSociale||'Società')}</h1><p class="muted">${c.ragioneSociale?'Gestione della società':'Inserisci il nome in «Dati società»'}${seasonSel?' · stagione ':''}${seasonSel}</p></div></div>
  <nav class="sd-tabs" role="tablist">${SOC_TABS.map(([k,l])=>`<button role="tab" class="${tab===k?'on':''}" data-action="soc-tab" data-t="${k}">${l}${k==='scadenze'?socBadge():''}</button>`).join('')}</nav>
  ${body}</section>`;
}
function socBadge(){ const n=socAgenda(7).length; return n?`<i class="sd-nb">${n}</i>`:''; }

/* ---------------------------------------------------------------- panoramica */
function socKpi(label, value, sub, cls, act){ return `<div class="sd-kpi ${cls||''} ${act?'go':''}" ${act||''}><span>${label}</span><b>${value}</b>${sub?`<small>${sub}</small>`:''}</div>`; }
function socPanoramicaHTML(season){
  const D=socData(), range=socSeasonRange(season);
  const P=D.pay.filter(p=>p.stagione===season && !p.annullata);
  const previsto=r2(P.reduce((s,p)=>s+p.importo,0)), incassato=r2(P.reduce((s,p)=>s+payPaid(p),0)), residuo=r2(previsto-incassato);
  const scad=P.filter(p=>payState(p)==='scaduta'), scadTot=r2(scad.reduce((s,p)=>s+payDue(p),0)), morosi=new Set(scad.map(p=>p.atletaId)).size;
  const M=socMovements(range), E=r2(M.filter(m=>m.tipo==='E').reduce((s,m)=>s+m.importo,0)), U=r2(M.filter(m=>m.tipo==='U').reduce((s,m)=>s+m.importo,0));
  const pct=previsto?Math.round(incassato/previsto*100):0;
  const ag=socAgenda(30).slice(0,10), checks=socChecks();
  return `
  <div class="sd-quick"><button class="btn primary" data-action="soc-pay-pick">💶 Registra un pagamento</button><button class="btn" data-action="soc-led-new" data-t="U">➖ Spesa</button><button class="btn" data-action="soc-led-new" data-t="E">➕ Entrata</button><button class="btn" data-action="soc-assign">📋 Assegna quote</button><button class="btn" data-action="soc-dl-new">📌 Scadenza</button></div>
  <div class="sd-kpis">
    ${socKpi('Quote della stagione', eur(previsto), P.length?`${new Set(P.map(p=>p.atletaId)).size} atleti · ${P.length} rate`:'nessuna quota assegnata', '', 'data-action="soc-tab" data-t="quote"')}
    ${socKpi('Incassato', eur(incassato), previsto?`<span class="sd-bar"><i style="width:${Math.min(100,pct)}%"></i></span>${pct}% del previsto`:'', 'ok')}
    ${socKpi('Da incassare', eur(residuo), scadTot?`<b class="sd-red">${eur(scadTot)} scaduti</b> · ${morosi} atlet${morosi===1?'a':'i'}`:'nessuna rata scaduta', scadTot?'bad':'', 'data-action="soc-quote-filter" data-v="scaduta"')}
    ${socKpi('Cassa della stagione', eur(E-U), `entrate ${eur(E)} · uscite ${eur(U)}`, E-U<0?'bad':'', 'data-action="soc-tab" data-t="cassa"')}
  </div>
  <div class="sd-cols">
    <div class="panel"><div class="sd-ph"><h2>In scadenza</h2><button class="btn sm ghost" data-action="soc-tab" data-t="scadenze">Tutto lo scadenzario →</button></div>
      ${ag.length?`<div class="sd-list">${ag.map(socAgRow).join('')}</div>`:'<p class="muted" style="margin:0">Niente in scadenza nei prossimi 30 giorni. 👍</p>'}</div>
    <div class="panel"><div class="sd-ph"><h2>Entrate e uscite per mese</h2></div>${socMonthChart(season, M)}</div>
  </div>
  ${checks.length?`<div class="panel sd-checks"><h2>Da sistemare</h2>${checks.map((g,i)=>`<details ${i===0?'open':''}><summary><b>${esc(g.t)}</b><span class="sd-pill p-bad">${g.L.length}</span></summary>${g.hint?`<p class="muted">${esc(g.hint)}</p>`:''}
    <div class="sd-names">${g.L.slice(0,40).map(x=>x.a?`<button data-action="${g.staff?'soc-staff':g.t.startsWith('Senza quote')||g.t.startsWith('Ricevute')?'soc-at':'soc-at-edit'}" data-id="${x.a.id}">${esc(fullName(x.a))}${x.s?` <small>${esc(x.s)}</small>`:''}</button>`:'').join('')}${g.L.length>40?`<span class="muted">e altri ${g.L.length-40}</span>`:''}</div></details>`).join('')}</div>`:''}`;
}
function socMonthChart(season, M){
  const [a]=socSeasonRange(season), d0=parseISO(a); if(!d0) return '';
  const months=[]; for(let i=0;i<12;i++){ const d=new Date(d0.getFullYear(), d0.getMonth()+i, 1); months.push({k:toISO(d).slice(0,7), l:SOC_MESI[d.getMonth()].slice(0,3), E:0, U:0}); }
  M.forEach(m=>{ const x=months.find(o=>o.k===(m.data||'').slice(0,7)); if(x) x[m.tipo]+=m.importo; });
  const max=Math.max(1, ...months.map(m=>Math.max(m.E,m.U)));
  if(!M.length) return '<p class="muted" style="margin:0">Ancora nessun movimento in questa stagione.</p>';
  return `<div class="sd-chart">${months.map(m=>`<div class="c" title="${esc(m.l)}: entrate ${eur(m.E)}, uscite ${eur(m.U)}"><div class="bars"><i class="e" style="height:${m.E/max*100}%"></i><i class="u" style="height:${m.U/max*100}%"></i></div><span>${m.l}</span></div>`).join('')}</div>
  <div class="sd-legend"><span><i class="e"></i>Entrate</span><span><i class="u"></i>Uscite</span></div>`;
}
function socAgRow(x){
  const n=x.n, when=n<0?`<b class="sd-red">scaduta da ${-n} g</b>`:n===0?'<b class="sd-red">oggi</b>':n===1?'domani':`tra ${n} giorni`;
  return `<div class="sd-ag ${n<0?'late':n<=7?'soon':''}"><button class="m" data-action="${x.act}" data-id="${x.id}"><span class="ic">${x.ic}</span><span class="tx"><b>${esc(x.t)}</b><small>${esc(x.s||'')}</small></span><span class="dt">${shortDate(x.d)}<small>${when}</small>${x.imp!=null&&x.imp!==''?`<em>${eur(x.imp)}</em>`:''}</span></button>
    ${x.k==='societa'?`<button class="btn sm" data-action="soc-dl-done" data-id="${x.id}" title="Segna come fatta">✓</button>`:''}</div>`;
}

/* ---------------------------------------------------------------- quote */
function socQuoteRows(season){
  const D=socData(), f=ui.sq||{}, q=(f.q||'').toLowerCase().trim();
  const ids=new Set(D.pay.filter(p=>p.stagione===season).map(p=>p.atletaId));
  let L=D.at.filter(a=>a.iscritto || ids.has(a.id)).map(a=>({a, acc:socAccount(a.id, season)}));
  ids.forEach(id=>{ if(!D.atMap.has(id)) L.push({a:{id, nome:'', cognome:'Atleta eliminato'}, acc:socAccount(id, season)}); });
  if(f.team) L=L.filter(x=>atTeams(x.a).includes(f.team));
  if(q) L=L.filter(x=>(fullName(x.a)+' '+(x.a.genitore||'')).toLowerCase().includes(q));
  if(f.st) L=L.filter(x=>f.st==='aperte'?x.acc.residuo>0:x.acc.st===f.st);
  const ord={scaduta:0, dapagare:1, parziale:2, nessuna:3, pagata:4};
  return L.sort((x,y)=>f.sort==='nome'?fullName(x.a).localeCompare(fullName(y.a),'it'):(ord[x.acc.st]-ord[y.acc.st]) || fullName(x.a).localeCompare(fullName(y.a),'it'));
}
function socQuoteHTML(season){
  const f=ui.sq=ui.sq||{}, L=socQuoteRows(season), tot=L.reduce((s,x)=>({d:s.d+x.acc.dovuto, p:s.p+x.acc.pagato, r:s.r+x.acc.residuo}), {d:0,p:0,r:0});
  const chips=[['','Tutti'],['aperte','Da incassare'],['scaduta','Scadute'],['pagata','In regola'],['nessuna','Senza quote']];
  return `<div class="sd-quick"><button class="btn primary" data-action="soc-assign">📋 Assegna quote</button><button class="btn" data-action="soc-sol">📨 Solleciti</button><button class="btn" data-action="soc-csv-quote">⬇ Excel (CSV)</button><button class="btn" data-action="soc-print-quote">🖨 Stampa</button></div>
  <div class="sd-filters"><div class="sbox">${EXI.search}<input type="search" id="soc-q" placeholder="Cerca atleta o genitore…" value="${esc(f.q||'')}"></div>
    ${teamMulti()?`<select id="soc-team"><option value="">Tutte le squadre</option>${teamsRaw().map((t,i)=>`<option value="${t.id}" ${f.team===t.id?'selected':''}>${esc(teamLabel(t,i))}</option>`).join('')}</select>`:''}
    <select id="soc-sort"><option value="">Prima chi deve pagare</option><option value="nome" ${f.sort==='nome'?'selected':''}>In ordine alfabetico</option></select></div>
  <div class="chips sd-chips">${chips.map(([v,l])=>`<button class="chip ${(f.st||'')===v?'on':''}" data-action="soc-quote-filter" data-v="${v}">${l}</button>`).join('')}</div>
  <div class="sd-sum"><span>${L.length} atlet${L.length===1?'a':'i'}</span><span>Dovuto <b>${eur(tot.d)}</b></span><span>Incassato <b class="sd-green">${eur(tot.p)}</b></span><span>Da incassare <b class="${tot.r>0?'sd-red':''}">${eur(tot.r)}</b></span></div>
  <div class="panel sd-rows" id="soc-rows">${L.length?L.map(socQuoteRow).join(''):`<div class="empty">${socData().at.length?'Nessun atleta con questi filtri.':'Non ci sono ancora atleti: inseriscili nella pagina Atleti.'}</div>`}</div>`;
}
function socQuoteRow({a, acc}){
  const pct=acc.dovuto?Math.min(100, Math.round(acc.pagato/acc.dovuto*100)):0;
  const st=acc.st==='nessuna'?'<span class="sd-pill">Nessuna quota</span>':payPill(acc.st);
  const nx=acc.next?`${acc.next.scadenza?'prossima '+shortDate(acc.next.scadenza)+' · ':''}${esc(payDesc(acc.next))}`:'';
  return `<button class="sd-row" data-action="soc-at" data-id="${a.id}"><span class="nm"><b>${esc(fullName(a))}</b><small>${[socTeamOf(a), a.iscritto===false?'non iscritto':''].filter(Boolean).map(esc).join(' · ')}${nx?(socTeamOf(a)?' · ':'')+nx:''}</small></span>
    <span class="pr">${acc.dovuto?`<span class="sd-bar"><i style="width:${pct}%"></i></span><small>${eur(acc.pagato)} di ${eur(acc.dovuto)}</small>`:''}</span>
    <span class="am">${acc.residuo>0?`<b class="${acc.scaduto?'sd-red':''}">${eur(acc.residuo)}</b>`:''}${st}</span></button>`;
}

/* conto dell'atleta */
function openSocAt(aid){
  const a=socAt(aid)||{id:aid, nome:'', cognome:'Atleta eliminato'}, D=socData(), payer=socPayer(a);
  const all=D.pay.filter(p=>p.atletaId===aid), seasons=[...new Set(all.map(p=>p.stagione||''))].sort((x,y)=>y.localeCompare(x));
  const tot=socAccount(aid, null);
  const rowP=p=>{ const st=payState(p), due=payDue(p);
    return `<div class="sd-q ${st}"><div class="h"><div><b>${esc(payDesc(p))}</b><small>${[p.voce&&p.descrizione&&p.voce!==p.descrizione?p.voce:'', p.scadenza?'scadenza '+shortDate(p.scadenza):'senza scadenza', p.note].filter(Boolean).map(esc).join(' · ')}</small></div>
      <div class="am"><b>${eur(p.importo)}</b>${payPill(st)}</div></div>
      ${(p.incassi||[]).length?`<div class="inc">${p.incassi.map(x=>`<div><span>✓ ${shortDate(x.data)} · ${eur(x.importo)}${x.metodo?' · '+esc(x.metodo):''}${x.ricevuta?' · ricevuta <b>'+esc(x.ricevuta)+'</b>':''}</span><span><button class="btn sm ghost" data-action="soc-inc-edit" data-p="${p.id}" data-i="${x.id}" title="Modifica l'incasso">✎</button>${x.ricevuta?`<button class="btn sm ghost" data-action="soc-rcpt" data-p="${p.id}" data-i="${x.id}" title="Stampa la ricevuta">🖨</button>`:''}</span></div>`).join('')}</div>`:''}
      <div class="act">${due>0?`<button class="btn sm primary" data-action="soc-inc-new" data-p="${p.id}">Incassa ${eur(due)}</button>`:''}<button class="btn sm" data-action="soc-pay-edit" data-p="${p.id}">✎ Modifica</button></div></div>`; };
  const yrs=[...new Set(all.flatMap(p=>(p.incassi||[]).map(x=>(x.data||'').slice(0,4))).filter(Boolean))].sort().reverse();
  openModal(`<div class="modal-box" style="max-width:720px">
    <div class="modal-head"><div style="flex:1;min-width:0"><h2>${esc(fullName(a))}</h2><div class="muted" style="font-size:13.5px;margin-top:3px">${[socTeamOf(a), payer.nome&&payer.genitore?'paga '+payer.nome:'', payer.tel].filter(Boolean).map(esc).join(' · ')||'&nbsp;'}</div></div><button class="iconbtn" data-action="close-modal" title="Chiudi">✕</button></div>
    <div class="modal-body">
      <div class="sd-kpis sm">${socKpi('Dovuto', eur(tot.dovuto))}${socKpi('Versato', eur(tot.pagato), '', 'ok')}${socKpi('Da versare', eur(tot.residuo), tot.scaduto?`<b class="sd-red">${eur(tot.scaduto)} scaduti</b>`:'', tot.scaduto?'bad':'')}</div>
      ${tot.residuo>0 && payer.tel?`<div class="actions" style="margin:-4px 0 14px"><a class="btn wa sm" href="${socWaHref(a)}" target="_blank" rel="noopener">WhatsApp: promemoria di pagamento</a>${payer.email?`<a class="btn sm" href="${socMailHref(a)}">✉ Email</a>`:''}</div>`:''}
      ${seasons.length?seasons.map(s=>`<h3 class="sd-h3">Stagione ${esc(s||'—')}</h3>${all.filter(p=>(p.stagione||'')===s).sort((x,y)=>(x.scadenza||'9').localeCompare(y.scadenza||'9')).map(rowP).join('')}`).join('')
        :'<div class="empty" style="padding:24px">Nessuna quota per questo atleta. Aggiungine una qui sotto, oppure usa «Assegna quote» per tutta la squadra.</div>'}
    </div>
    <div class="modal-foot"><button class="btn" data-action="soc-pay-new" data-a="${esc(aid)}">＋ Quota</button>${yrs.length?`<button class="btn" data-action="soc-att" data-a="${esc(aid)}" data-y="${yrs[0]}" title="Riepilogo dei pagamenti dell'anno, utile per la dichiarazione dei redditi">🧾 Attestazione ${yrs[0]}</button>`:''}${all.length?`<button class="btn" data-action="soc-estratto" data-a="${esc(aid)}">🖨 Estratto conto</button>`:''}<span style="flex:1"></span>${socAt(aid)?`<button class="btn" data-action="soc-at-edit" data-id="${esc(aid)}">Scheda atleta</button>`:''}<button class="btn primary" data-action="close-modal">Fatto</button></div></div>`);
}
function socFill(tpl, a, p){
  const c=socCfg(), payer=socPayer(a), acc=socAccount(a.id, null);
  const open=acc.next, due=p?payDue(p):acc.residuo;
  const causale=(c.causale||'').replace('{stagione}', (p||open||{}).stagione||socSeason()).replace('{atleta}', fullName(a));
  const iban=c.iban?` Puoi pagare con bonifico sull'IBAN ${c.iban}${c.intestatarioIban?' intestato a '+c.intestatarioIban:''}, causale «${causale}».`:'';
  return String(tpl||'').replace(/\{nome\}/g, (payer.nome||'').split(' ')[0]||'').replace(/\{atleta\}/g, [a.nome,a.cognome].filter(Boolean).join(' ')).replace(/\{societa\}/g, socName())
    .replace(/\{importo\}/g, eur(due)).replace(/\{descrizione\}/g, p?payDesc(p):(open?payDesc(open):'quote')).replace(/\{scadenza\}/g, (p||open)&&(p||open).scadenza?shortDate((p||open).scadenza):'—')
    .replace(/\{iban\}/g, iban).replace(/\{causale\}/g, causale);
}
const socWaHref = (a, p) => `https://wa.me/${waNumber(socPayer(a).tel)}?text=${encodeURIComponent(socFill(socCfg().sollecito, a, p))}`;
const socMailHref = (a, p) => `mailto:${encodeURIComponent(socPayer(a).email)}?subject=${encodeURIComponent('Promemoria pagamento – '+socName())}&body=${encodeURIComponent(socFill(socCfg().sollecito, a, p))}`;

/* modifica / nuova quota */
function openPayEdit(pid, aid){
  const p=pid?clone(socData().pay.find(x=>x.id===pid)):{id:null, atletaId:aid, stagione:socSeason(), voce:SOC_VOCI[0], descrizione:'', importo:'', scadenza:'', note:'', incassi:[], annullata:false};
  if(!p) return; ui.payDraft=p;
  openModal(`<div class="modal-box" style="max-width:560px"><form id="pay-form" onsubmit="return false">
    <div class="modal-head"><div style="flex:1"><h2>${pid?'Modifica quota':'Nuova quota'}</h2><div class="muted" style="font-size:13.5px">${esc(socAtName(p.atletaId))}</div></div><button type="button" class="iconbtn" data-action="soc-at" data-id="${esc(p.atletaId)}" title="Indietro">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f">Voce<input type="text" name="voce" list="dl-soc-voci" value="${esc(p.voce)}"><datalist id="dl-soc-voci">${SOC_VOCI.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></label>
      <label class="f">Stagione<input type="text" name="stagione" value="${esc(p.stagione)}" placeholder="Es. 2026/27"></label>
      <label class="f span2">Descrizione (compare su ricevute e solleciti)<input type="text" name="descrizione" value="${esc(p.descrizione)}" placeholder="Es. Quota 2026/27 – prima rata"></label>
      <label class="f">Importo (€)<input type="text" name="importo" inputmode="decimal" value="${esc(moneyIn(p.importo))}" placeholder="0,00"></label>
      <label class="f">Scadenza<input type="date" name="scadenza" value="${esc(p.scadenza)}"></label>
      <label class="f span2">Note<input type="text" name="note" value="${esc(p.note)}" placeholder="Es. sconto fratelli"></label>
      ${pid?`<label class="sw span2"><input type="checkbox" name="annullata" ${p.annullata?'checked':''}> Annullata (non conta più nei totali)</label>`:''}
    </div>${pid&&(p.incassi||[]).length?`<p class="muted" style="font-size:13px;margin:12px 0 0">Su questa quota sono già stati registrati ${eur(payPaid(p))}.</p>`:''}</div>
    <div class="modal-foot">${pid?'<button type="button" class="btn danger" data-action="soc-pay-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="soc-at" data-id="${esc(p.atletaId)}">Annulla</button><button type="button" class="btn primary" data-action="soc-pay-save">Salva</button></div></form></div>`);
}
async function socPaySave(){
  const fd=new FormData($('#pay-form')), p=ui.payDraft;
  ['voce','stagione','descrizione','scadenza','note'].forEach(k=>p[k]=(fd.get(k)||'').toString().trim());
  p.importo=money(fd.get('importo')); p.annullata=!!fd.get('annullata');
  if(!p.importo){ alert("Inserisci l'importo."); return; }
  if(!p.id){ p.id=newId('qt'); }
  try{ await socPut('payments', p); }catch(e){ saveFail(e); return; }
  toast('Quota salvata'); openSocAt(p.atletaId); socRefreshBehind();
}
function socRefreshBehind(){ if(ui.view==='societa'){ const y=window.scrollY; $('#app').innerHTML=viewSocieta(); window.scrollTo(0,y); } }

/* incasso */
function openIncasso(pid, iid){
  const p=socData().pay.find(x=>x.id===pid); if(!p) return; const a=socAt(p.atletaId)||{}, payer=socPayer(a);
  const x=iid?clone((p.incassi||[]).find(i=>i.id===iid)):{id:null, data:todayISO(), importo:payDue(p), metodo:'', ricevuta:'', pagatoDa:payer.nome, cfPagante:payer.cf, note:''};
  if(!x) return; ui.incDraft={pid, x};
  const metodi=socLines('metodi');
  openModal(`<div class="modal-box" style="max-width:560px"><form id="inc-form" onsubmit="return false">
    <div class="modal-head"><div style="flex:1"><h2>${iid?'Modifica incasso':'Registra un pagamento'}</h2><div class="muted" style="font-size:13.5px">${esc(fullName(a))} · ${esc(payDesc(p))} · da versare ${eur(payDue(p))}</div></div><button type="button" class="iconbtn" data-action="soc-at" data-id="${esc(p.atletaId)}" title="Indietro">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f">Importo ricevuto (€)<input type="text" name="importo" inputmode="decimal" value="${esc(moneyIn(x.importo))}"></label>
      <label class="f">Data<input type="date" name="data" value="${esc(x.data)}"></label>
      <label class="f">Modalità<select name="metodo" id="inc-metodo"><option value="">—</option>${[...new Set([...metodi, x.metodo].filter(Boolean))].map(m=>`<option ${x.metodo===m?'selected':''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="f">N° ricevuta<span class="sd-inl"><input type="text" name="ricevuta" id="inc-ric" value="${esc(x.ricevuta)}" placeholder="nessuna ricevuta"><button type="button" class="btn sm" data-action="soc-ric-next" title="Usa il prossimo numero libero">${iid?'Assegna':'Nuova'}</button></span></label>
      <label class="f">Pagato da<input type="text" name="pagatoDa" value="${esc(x.pagatoDa)}" placeholder="Nome e cognome"></label>
      <label class="f">Codice fiscale di chi paga<input type="text" name="cfPagante" value="${esc(x.cfPagante)}" style="text-transform:uppercase" maxlength="16"></label>
      <label class="f span2">Note<input type="text" name="note" value="${esc(x.note)}"></label>
    </div>
    <p class="muted sd-hint" id="inc-hint">${socIncHint(x.metodo)}</p></div>
    <div class="modal-foot">${iid?'<button type="button" class="btn danger" data-action="soc-inc-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="soc-at" data-id="${esc(p.atletaId)}">Annulla</button><button type="button" class="btn" data-action="soc-inc-save" data-print="1">Salva e stampa ricevuta</button><button type="button" class="btn primary" data-action="soc-inc-save">Salva</button></div></form></div>`);
  if(!iid) $('#inc-ric').value=socNextReceipt(x.data);
}
function socIncHint(m){ return /contant/i.test(m||'') ? '⚠ Per detrarre la spesa nella dichiarazione dei redditi serve un pagamento tracciabile (bonifico, carta, ecc.): con i contanti la ricevuta vale come quietanza ma non per la detrazione.' : ''; }
async function socIncSave(print){
  const fd=new FormData($('#inc-form')), {pid, x}=ui.incDraft, p=clone(socData().pay.find(q=>q.id===pid)); if(!p) return;
  ['data','metodo','ricevuta','pagatoDa','note'].forEach(k=>x[k]=(fd.get(k)||'').toString().trim()); x.cfPagante=(fd.get('cfPagante')||'').toString().trim().toUpperCase();
  x.importo=money(fd.get('importo')); if(!x.importo){ alert("Inserisci l'importo ricevuto."); return; } if(!x.data){ alert('Inserisci la data.'); return; }
  if(print && !x.ricevuta) x.ricevuta=socNextReceipt(x.data);
  if(x.ricevuta && socData().pay.some(q=>(q.incassi||[]).some(i=>i.ricevuta===x.ricevuta && i.id!==x.id)) && !confirm(`La ricevuta ${x.ricevuta} esiste già. Salvare lo stesso?`)) return;
  if(!x.id){ x.id=newId('in'); p.incassi=[...(p.incassi||[]), x]; } else p.incassi=p.incassi.map(i=>i.id===x.id?x:i);
  const over=r2(payPaid(p)-p.importo);
  if(over>0 && !confirm(`Così risultano versati ${eur(over)} in più dell'importo della quota. Salvare lo stesso?`)) return;
  try{ await socPut('payments', p); }catch(e){ saveFail(e); return; }
  toast('Pagamento registrato'); openSocAt(p.atletaId); socRefreshBehind();
  if(print) socPrintReceipt(p.id, x.id);
}

/* assegnazione delle quote con un piano */
function openAssign(){
  const c=socCfg(), piani=c.pianiQuota||[], D=socData();
  const o=ui.asg=ui.asg||{plan:piani[0]?piani[0].id:'__one', season:socSeason(), sel:{}, sconto:'', solo:true, one:{voce:SOC_VOCI[0], descrizione:'', importo:'', scadenza:''}};
  if(!Object.keys(o.sel).length) D.at.filter(a=>a.iscritto).forEach(a=>o.sel[a.id]=true);
  ui.asgOpen=true; socAssignRender();
}
function socAssignPlan(){ const o=ui.asg; if(o.plan==='__one') return {id:'', nome:'Quota singola', voce:o.one.voce, rate:[{descrizione:o.one.descrizione||o.one.voce, importo:money(o.one.importo), scadenza:o.one.scadenza}]}; return (socCfg().pianiQuota||[]).find(p=>p.id===o.plan); }
function socAssignPreview(){
  const o=ui.asg, plan=socAssignPlan(), D=socData(); if(!plan) return {n:0, skip:0, tot:0, items:[]};
  const sc=Math.min(100, Math.max(0, money(o.sconto)||0)), items=[]; let skip=0;
  D.at.filter(a=>o.sel[a.id]).forEach(a=>{
    if(plan.id && D.pay.some(p=>p.atletaId===a.id && p.pianoId===plan.id && p.stagione===o.season && !p.annullata)){ skip++; return; }
    plan.rate.forEach((r,i)=>{ const imp=r2(money(r.importo)*(100-sc)/100); if(!imp) return;
      items.push({c:'payments', r:{id:newId('qt')+i, atletaId:a.id, stagione:o.season, voce:plan.voce||SOC_VOCI[0], descrizione:plan.id?plan.nome+(plan.rate.length>1?' – '+(r.descrizione||'rata '+(i+1)).toLowerCase():''):(r.descrizione||plan.voce), importo:imp, scadenza:r.scadenza||'', pianoId:plan.id, note:sc?'sconto '+sc+'%':'', incassi:[]}}); });
  });
  return {n:new Set(items.map(x=>x.r.atletaId)).size, skip, tot:r2(items.reduce((s,x)=>s+x.r.importo,0)), items};
}
function socAssignRender(){
  const o=ui.asg, c=socCfg(), piani=c.pianiQuota||[], D=socData(), pv=socAssignPreview();
  const L=D.at.filter(a=>!o.solo || a.iscritto).sort((x,y)=>fullName(x).localeCompare(fullName(y),'it'));
  const groups=teamMulti()?teamsRaw().map((t,i)=>({t:teamLabel(t,i), L:L.filter(a=>atTeams(a)[0]===t.id)})):[{t:'', L}];
  const plan=socAssignPlan();
  openModal(`<div class="modal-box" style="max-width:760px"><div class="modal-head"><div style="flex:1"><h2>Assegna quote</h2><div class="muted" style="font-size:13.5px">Crea le rate per più atleti in un colpo solo.</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body">
      <div class="grid g3">
        <label class="f">Cosa assegnare<select data-asg="plan">${piani.map(p=>`<option value="${p.id}" ${o.plan===p.id?'selected':''}>${esc(p.nome)}</option>`).join('')}<option value="__one" ${o.plan==='__one'?'selected':''}>Una quota singola…</option></select></label>
        <label class="f">Stagione<input type="text" data-asg="season" value="${esc(o.season)}"></label>
        <label class="f">Sconto per questi atleti (%)<input type="text" inputmode="decimal" data-asg="sconto" value="${esc(o.sconto)}" placeholder="0"></label>
      </div>
      ${o.plan==='__one'?`<div class="grid g2" style="margin-top:12px">
        <label class="f">Voce<input type="text" list="dl-soc-voci2" data-asg1="voce" value="${esc(o.one.voce)}"><datalist id="dl-soc-voci2">${SOC_VOCI.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></label>
        <label class="f">Descrizione<input type="text" data-asg1="descrizione" value="${esc(o.one.descrizione)}" placeholder="Es. Torneo di Natale"></label>
        <label class="f">Importo (€)<input type="text" inputmode="decimal" data-asg1="importo" value="${esc(o.one.importo)}"></label>
        <label class="f">Scadenza<input type="date" data-asg1="scadenza" value="${esc(o.one.scadenza)}"></label></div>`
      :plan?`<div class="sd-rate">${plan.rate.map((r,i)=>`<span>${esc(r.descrizione||'Rata '+(i+1))}: <b>${eur(money(r.importo))}</b>${r.scadenza?' entro il '+shortDate(r.scadenza):''}</span>`).join('')}</div>`:''}
      ${!piani.length?`<p class="muted" style="font-size:13px">Suggerimento: in <b>Dati società → Piani delle quote</b> puoi salvare la quota annuale con le sue rate (es. 300 € in due rate) e riusarla ogni stagione.</p>`:''}
      <div class="sd-asg-head"><b>Atleti</b><label class="sw" style="min-height:0"><input type="checkbox" data-asg="solo" ${o.solo?'checked':''}> solo gli iscritti</label><span style="flex:1"></span><button class="btn sm" data-action="asg-all" data-v="1">Tutti</button><button class="btn sm" data-action="asg-all" data-v="0">Nessuno</button></div>
      <div class="sd-asg">${groups.filter(g=>g.L.length).map(g=>`${g.t?`<div class="g">${esc(g.t)}</div>`:''}${g.L.map(a=>{ const has=plan&&plan.id&&D.pay.some(p=>p.atletaId===a.id&&p.pianoId===plan.id&&p.stagione===o.season&&!p.annullata);
        return `<label class="${has?'has':''}"><input type="checkbox" data-asgat="${a.id}" ${o.sel[a.id]?'checked':''}> ${esc(fullName(a))}${has?' <small>già assegnata</small>':''}</label>`; }).join('')}`).join('')||'<p class="muted">Nessun atleta.</p>'}</div>
    </div>
    <div class="modal-foot"><span class="muted" style="font-size:13.5px">${pv.items.length?`Verranno create <b>${pv.items.length}</b> rate per <b>${pv.n}</b> atleti · totale <b>${eur(pv.tot)}</b>`:'Nessuna rata da creare'}${pv.skip?` · ${pv.skip} già assegnat${pv.skip===1?'a':'e'}`:''}</span><span style="flex:1"></span><button class="btn" data-action="close-modal">Annulla</button><button class="btn primary" data-action="asg-go" ${pv.items.length?'':'disabled'}>Crea le quote</button></div></div>`);
}
async function socAssignGo(){
  const pv=socAssignPreview(); if(!pv.items.length) return;
  try{ await socBulk(pv.items); }catch(e){ saveFail(e); return; }
  ui.asg=null; closeModal(); toast(`Create ${pv.items.length} rate per ${pv.n} atleti`); ui.socTab='quote'; render();
}

/* solleciti */
function openSolleciti(){
  const season=socSeason(), L=socQuoteRows(season).filter(x=>x.acc.scaduto>0 || (ui.solAll && x.acc.residuo>0));
  openModal(`<div class="modal-box" style="max-width:720px"><div class="modal-head"><div style="flex:1"><h2>Solleciti di pagamento</h2><div class="muted" style="font-size:13.5px">${ui.solAll?'Tutti quelli che devono ancora versare qualcosa':'Solo chi ha rate scadute'} · stagione ${esc(season)}</div></div><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><label class="sw" style="margin-bottom:8px"><input type="checkbox" id="sol-all" ${ui.solAll?'checked':''}> Includi anche le rate non ancora scadute</label>
    ${L.length?`<div class="sd-sol">${L.map(({a,acc})=>{ const pr=socPayer(a);
      return `<div><span class="nm"><b>${esc(fullName(a))}</b><small>${esc(pr.nome||'')}${pr.tel?' · '+esc(pr.tel):' · <span class="sd-red">nessun telefono</span>'}</small></span><b class="${acc.scaduto?'sd-red':''}">${eur(acc.residuo)}</b>
        <span class="actions">${pr.tel?`<a class="btn sm wa" href="${socWaHref(a)}" target="_blank" rel="noopener">WhatsApp</a>`:''}${pr.email?`<a class="btn sm" href="${socMailHref(a)}">✉</a>`:''}<button class="btn sm" data-action="soc-sol-copy" data-a="${a.id}" title="Copia il testo">⧉</button></span></div>`; }).join('')}</div>`
      :'<div class="empty" style="padding:24px">Nessuno da sollecitare. 👏</div>'}
    <p class="muted" style="font-size:12.5px;margin-bottom:0">Il testo del messaggio si cambia in <b>Dati società → Testo del sollecito</b>. WhatsApp si apre con il messaggio già scritto: devi solo premere Invia.</p></div>
    <div class="modal-foot"><span style="flex:1"></span><button class="btn primary" data-action="close-modal">Chiudi</button></div></div>`);
}

/* ---------------------------------------------------------------- prima nota */
function socCassaHTML(season){
  const f=ui.sl=ui.sl||{}, range=socSeasonRange(season), all=socMovements(range);
  const q=(f.q||'').toLowerCase().trim();
  const L=all.filter(m=>(!f.t||m.tipo===f.t) && (!f.m||(m.data||'').slice(0,7)===f.m) && (!f.c||m.categoria===f.c) && (!q||(m.descrizione+' '+m.controparte+' '+m.categoria+' '+(m.documento||'')).toLowerCase().includes(q)));
  const E=r2(L.filter(m=>m.tipo==='E').reduce((s,m)=>s+m.importo,0)), U=r2(L.filter(m=>m.tipo==='U').reduce((s,m)=>s+m.importo,0));
  const months=[...new Set(all.map(m=>(m.data||'').slice(0,7)))].sort().reverse(), cats=[...new Set(all.map(m=>m.categoria).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
  const byCat=t=>{ const o={}; L.filter(m=>m.tipo===t).forEach(m=>o[m.categoria||'Senza categoria']=(o[m.categoria||'Senza categoria']||0)+m.importo); return Object.entries(o).sort((a,b)=>b[1]-a[1]); };
  const catHTML=(t,tot)=>{ const C=byCat(t); return C.length?C.map(([k,v])=>`<div class="sd-cat"><span>${esc(k)}</span><span class="sd-bar ${t==='U'?'u':''}"><i style="width:${tot?v/tot*100:0}%"></i></span><b>${eur(v)}</b></div>`).join(''):'<p class="muted" style="margin:0">—</p>'; };
  return `<div class="sd-quick"><button class="btn primary" data-action="soc-led-new" data-t="E">➕ Entrata</button><button class="btn primary" data-action="soc-led-new" data-t="U">➖ Uscita</button><button class="btn" data-action="soc-csv-led">⬇ Excel (CSV)</button><button class="btn" data-action="soc-print-rend">🖨 Rendiconto</button></div>
  <div class="sd-filters"><div class="sbox">${EXI.search}<input type="search" id="soc-lq" placeholder="Cerca…" value="${esc(f.q||'')}"></div>
    <select id="soc-lm"><option value="">Tutti i mesi</option>${months.map(m=>`<option value="${m}" ${f.m===m?'selected':''}>${cap(SOC_MESI[+m.slice(5)-1])} ${m.slice(0,4)}</option>`).join('')}</select>
    <select id="soc-lc"><option value="">Tutte le categorie</option>${cats.map(c=>`<option ${f.c===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
  <div class="chips sd-chips">${[['','Tutto'],['E','Entrate'],['U','Uscite']].map(([v,l])=>`<button class="chip ${(f.t||'')===v?'on':''}" data-action="soc-led-filter" data-v="${v}">${l}</button>`).join('')}</div>
  <div class="sd-kpis sm">${socKpi('Entrate', eur(E), '', 'ok')}${socKpi('Uscite', eur(U), '', 'bad')}${socKpi('Saldo', eur(E-U), '', E-U<0?'bad':'')}</div>
  <div class="sd-cols"><div class="panel"><h2>Entrate per categoria</h2>${catHTML('E',E)}</div><div class="panel"><h2>Uscite per categoria</h2>${catHTML('U',U)}</div></div>
  <div class="panel sd-rows" style="margin-top:16px">${L.length?L.map(m=>`<button class="sd-row mv" data-action="${m.src==='q'?'soc-at':'soc-led-edit'}" data-id="${esc(m.src==='q'?m.atletaId:m.id)}">
      <span class="dt">${shortDate(m.data)}</span><span class="nm"><b>${esc(m.descrizione||m.categoria||'Movimento')}</b><small>${[m.categoria, m.controparte, m.metodo, m.documento].filter(Boolean).map(esc).join(' · ')}</small></span>
      <span class="am"><b class="${m.tipo==='E'?'sd-green':'sd-red'}">${m.tipo==='E'?'+':'−'} ${eur(m.importo)}</b></span></button>`).join(''):'<div class="empty">Nessun movimento. Gli incassi delle quote compaiono qui da soli; le altre entrate e le spese aggiungile con i pulsanti in alto.</div>'}</div>`;
}
function openLedger(id, tipo, draft){
  const D=socData(), m=draft?draft:id?clone(D.led.find(x=>x.id===id)):{id:null, tipo:tipo||'U', data:todayISO(), importo:'', categoria:'', descrizione:'', controparte:'', metodo:'', documento:'', squadra:'', note:''};
  if(!m) return; ui.ledDraft=m;
  const cats=socLines(m.tipo==='E'?'catE':'catU'), metodi=socLines('metodi'), people=[...D.staff.map(fullName)];
  openModal(`<div class="modal-box" style="max-width:600px"><form id="led-form" onsubmit="return false">
    <div class="modal-head"><h2 style="flex:1">${id?'Modifica movimento':m.tipo==='E'?'Nuova entrata':'Nuova spesa'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body">
      <div class="vseg" style="margin-bottom:12px"><button type="button" class="${m.tipo==='E'?'on':''}" data-action="led-tipo" data-v="E">Entrata</button><button type="button" class="${m.tipo==='U'?'on':''}" data-action="led-tipo" data-v="U">Uscita</button></div>
      <div class="grid g2">
        <label class="f">Data<input type="date" name="data" value="${esc(m.data)}"></label>
        <label class="f">Importo (€)<input type="text" name="importo" inputmode="decimal" value="${esc(moneyIn(m.importo))}" placeholder="0,00"></label>
        <label class="f">Categoria<input type="text" name="categoria" list="dl-led-cat" value="${esc(m.categoria)}" placeholder="Scegli o scrivi"><datalist id="dl-led-cat">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="f">Modalità<select name="metodo"><option value="">—</option>${[...new Set([...metodi, m.metodo].filter(Boolean))].map(x=>`<option ${m.metodo===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="f span2">Descrizione<input type="text" name="descrizione" value="${esc(m.descrizione)}" placeholder="${m.tipo==='E'?'Es. Sponsor maglie Pizzeria Da Mario':'Es. Affitto palestra ottobre'}"></label>
        <label class="f">${m.tipo==='E'?'Da chi':'A chi'}<input type="text" name="controparte" list="dl-led-cp" value="${esc(m.controparte)}"><datalist id="dl-led-cp">${[...new Set([...people, ...D.led.map(x=>x.controparte).filter(Boolean)])].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="f">N° documento<input type="text" name="documento" value="${esc(m.documento)}" placeholder="Fattura, ricevuta…"></label>
        ${teamMulti()?`<label class="f">Squadra<select name="squadra"><option value="">Tutta la società</option>${teamsRaw().map((t,i)=>`<option value="${t.id}" ${m.squadra===t.id?'selected':''}>${esc(teamLabel(t,i))}</option>`).join('')}</select></label>`:''}
        <label class="f ${teamMulti()?'':'span2'}">Note<input type="text" name="note" value="${esc(m.note)}"></label>
        ${m.tipo==='U'&&D.staff.length?`<label class="f">Pagamento a una persona dello staff<select name="staffId" id="led-staff"><option value="">— no —</option>${D.staff.map(x=>`<option value="${x.id}" ${m.staffId===x.id?'selected':''}>${esc(fullName(x))}${x.ruolo?' · '+esc(x.ruolo):''}</option>`).join('')}</select></label>
        <label class="f">Tipo di pagamento<select name="natura"><option value="compenso" ${m.natura!=='rimborso'?'selected':''}>Compenso o rimborso forfettario</option><option value="rimborso" ${m.natura==='rimborso'?'selected':''}>Rimborso di spese documentate</option></select></label>`:''}
      </div></div>
    <div class="modal-foot">${id?'<button type="button" class="btn danger" data-action="led-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="close-modal">Annulla</button>${id?'':'<button type="button" class="btn" data-action="led-save" data-again="1">Salva e aggiungi un altro</button>'}<button type="button" class="btn primary" data-action="led-save">Salva</button></div></form></div>`);
  setTimeout(()=>$('#led-form [name=importo]')?.focus(), 40);
}
async function socLedSave(again){
  const fd=new FormData($('#led-form')), m=ui.ledDraft;
  ['data','categoria','descrizione','controparte','metodo','documento','note','squadra','staffId','natura'].forEach(k=>m[k]=(fd.get(k)||'').toString().trim());
  if(m.tipo!=='U'){ m.staffId=''; m.natura=''; }
  if(m.staffId){ const p=socData().staff.find(x=>x.id===m.staffId); if(p && !m.controparte) m.controparte=fullName(p); if(!m.categoria) m.categoria='Rimborsi e compensi staff'; if(!m.natura) m.natura='compenso'; } else m.natura='';
  m.importo=money(fd.get('importo')); if(!m.importo){ alert("Inserisci l'importo."); return; } if(!m.data){ alert('Inserisci la data.'); return; }
  m.stagione=socSeasonOf(m.data); if(!m.id) m.id=newId('mv');
  try{ await socPut('ledger', m); }catch(e){ saveFail(e); return; }
  toast(m.tipo==='E'?'Entrata salvata':'Spesa salvata');
  if(again){ openLedger(null, m.tipo); } else closeModal();
  socRefreshBehind();
}

/* ---------------------------------------------------------------- scadenzario */
function socScadHTML(){
  const f=ui.sdk||'', A=socAgenda(365).filter(x=>!f||x.k===f);
  const G=[['Scadute',x=>x.n<0],['Entro 7 giorni',x=>x.n>=0&&x.n<=7],['Entro 30 giorni',x=>x.n>7&&x.n<=30],['Più avanti',x=>x.n>30]];
  const done=socData().dl.filter(d=>d.fatto).sort((a,b)=>(b.fattoIl||b.data).localeCompare(a.fattoIl||a.data)).slice(0,15);
  return `<div class="sd-quick"><button class="btn primary" data-action="soc-dl-new">📌 Nuova scadenza</button><button class="btn" data-action="soc-ics">📅 Esporta nel calendario</button></div>
  <div class="chips sd-chips">${[['','Tutto'],['societa','Società'],['quote','Quote'],['atleti','Atleti'],['staff','Staff']].map(([v,l])=>`<button class="chip ${f===v?'on':''}" data-action="soc-sdk" data-v="${v}">${l}</button>`).join('')}</div>
  ${A.length?G.map(([t,fn])=>{ const L=A.filter(fn); return L.length?`<div class="panel sd-grp"><h2>${t} <span class="muted">${L.length}</span></h2><div class="sd-list">${L.map(socAgRow).join('')}</div></div>`:''; }).join('')
    :'<div class="empty">Nessuna scadenza nei prossimi 12 mesi.<br>Aggiungi quelle della società (iscrizione al campionato, affitto palestra, assicurazione, assemblea…): quelle che si ripetono vengono riproposte da sole.</div>'}
  ${done.length&&(!f||f==='societa')?`<details class="panel sd-done"><summary><b>Fatte di recente</b></summary><div class="sd-list">${done.map(d=>`<div class="sd-ag done"><button class="m" data-action="soc-dl" data-id="${d.id}"><span class="ic">✓</span><span class="tx"><b>${esc(d.titolo)}</b><small>${esc(d.categoria||'')}</small></span><span class="dt">${shortDate(d.data)}<small>fatta${d.fattoIl?' il '+shortDate(d.fattoIl):''}</small></span></button></div>`).join('')}</div></details>`:''}`;
}
function openDeadline(id){
  const d=id?clone(socData().dl.find(x=>x.id===id)):{id:null, titolo:'', data:'', categoria:'', importo:'', ricorrenza:'', avviso:7, note:'', fatto:false};
  if(!d) return; ui.dlDraft=d;
  openModal(`<div class="modal-box" style="max-width:560px"><form id="dl-form" onsubmit="return false">
    <div class="modal-head"><h2 style="flex:1">${id?'Scadenza':'Nuova scadenza'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f span2">Cosa scade<input type="text" name="titolo" value="${esc(d.titolo)}" placeholder="Es. Iscrizione campionato PGS"></label>
      <label class="f">Data<input type="date" name="data" value="${esc(d.data)}"></label>
      <label class="f">Categoria<input type="text" name="categoria" list="dl-dl-cat" value="${esc(d.categoria)}"><datalist id="dl-dl-cat">${SOC_CAT_SCAD.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="f">Importo (€, se c'è da pagare)<input type="text" name="importo" inputmode="decimal" value="${esc(moneyIn(d.importo))}"></label>
      <label class="f">Si ripete<select name="ricorrenza">${SOC_RIC.map(([v,l])=>`<option value="${v}" ${d.ricorrenza===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label class="f span2">Note<textarea name="note" rows="2">${esc(d.note)}</textarea></label>
      ${id?`<label class="sw span2"><input type="checkbox" name="fatto" ${d.fatto?'checked':''}> Fatta</label>`:''}
    </div><p class="muted" style="font-size:12.5px;margin:10px 0 0">Quando segni come fatta una scadenza che si ripete, l'app crea da sola la prossima.</p></div>
    <div class="modal-foot">${id?'<button type="button" class="btn danger" data-action="dl-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="close-modal">Annulla</button><button type="button" class="btn primary" data-action="dl-save">Salva</button></div></form></div>`);
  setTimeout(()=>!id && $('#dl-form [name=titolo]')?.focus(), 40);
}
async function socDlSave(){
  const fd=new FormData($('#dl-form')), d=ui.dlDraft, was=!!d.fatto;
  ['titolo','data','categoria','ricorrenza','note'].forEach(k=>d[k]=(fd.get(k)||'').toString().trim());
  d.importo=(fd.get('importo')||'').toString().trim()===''?'':money(fd.get('importo')); d.fatto=!!fd.get('fatto');
  if(!d.titolo){ alert('Scrivi cosa scade.'); return; } if(!d.data){ alert('Inserisci la data.'); return; }
  if(!d.id) d.id=newId('dl');
  if(d.fatto && !was){ await socDlDone(d.id, d); closeModal(); return; }
  try{ await socPut('deadlines', d); }catch(e){ saveFail(e); return; }
  closeModal(); toast('Scadenza salvata'); socRefreshBehind();
}
async function socDlDone(id, draft){
  const d=draft||clone(socData().dl.find(x=>x.id===id)); if(!d) return;
  d.fatto=true; d.fattoIl=todayISO(); const items=[{c:'deadlines', r:d}];
  const mm=SOC_RIC_MESI[d.ricorrenza];
  if(mm) items.push({c:'deadlines', r:Object.assign({}, d, {id:newId('dl'), data:socAddMonths(d.data, mm), fatto:false, fattoIl:'', createdAt:Date.now(), updatedAt:Date.now()})});
  d.updatedAt=Date.now();
  try{ await socBulk(items); }catch(e){ saveFail(e); return; }
  toast(mm?'Fatto! Prossima scadenza: '+shortDate(items[1].r.data):'Segnata come fatta'); socRefreshBehind();
}
function socIcs(){
  const now=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z'), E=[];
  const esc2=s=>String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
  socAgenda(365).filter(x=>x.n>=0 && x.k!=='quote').forEach((x,i)=>{ const d=x.d.replace(/-/g,''), nx=toISO(new Date(parseISO(x.d).getTime()+864e5)).replace(/-/g,'');
    E.push(['BEGIN:VEVENT','UID:vd-scad-'+x.k+'-'+x.id+'-'+d+'@volleydesk','DTSTAMP:'+now,'DTSTART;VALUE=DATE:'+d,'DTEND;VALUE=DATE:'+nx,'SUMMARY:'+esc2(x.ic+' '+x.t+(x.s?' – '+x.s:'')),'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+esc2(x.t),'TRIGGER:-P3D','END:VALARM','END:VEVENT'].join('\r\n')); });
  if(!E.length){ toast('Nessuna scadenza futura da esportare'); return; }
  const txt=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Volleydesk//IT','CALSCALE:GREGORIAN','X-WR-CALNAME:'+esc2('Scadenze '+socName()),...E,'END:VCALENDAR'].join('\r\n')+'\r\n';
  socDownload('scadenze-'+todayISO()+'.ics', txt, 'text/calendar'); toast(`Esportate ${E.length} scadenze: apri il file per aggiungerle al calendario`);
}

/* ---------------------------------------------------------------- staff */
function socStaffHTML(){
  const L=socData().staff, td=todayISO();
  const pill=(iso,l)=>{ if(!iso) return ''; const n=daysTo(iso); return `<span class="sd-pill ${n<0?'p-bad':n<=30?'p-warn':''}">${l} ${n<0?'scaduta':shortDate(iso)}</span>`; };
  return `<div class="sd-quick"><button class="btn primary" data-action="soc-staff-new">＋ Persona dello staff</button>${L.length?'<button class="btn" data-action="soc-print-staff">🖨 Organigramma</button>':''}</div>
  ${L.length?`<div class="panel sd-rows">${L.map(x=>`<button class="sd-row ${x.attivo===false?'off':''}" data-action="soc-staff" data-id="${x.id}"><span class="nm"><b>${esc(fullName(x))}</b><small>${[x.ruolo, x.qualifica, x.attivo===false?'non più attivo':''].filter(Boolean).map(esc).join(' · ')}</small></span>
    <span class="pills">${pill(x.scadenzaTessera,'Tessera')}${pill(x.scadenzaVisita,'Visita')}${pill(x.scadenzaQualifica,'Qualifica')}${pill(x.scadenzaCasellario,'Casellario')}</span>
    <span class="am">${x.cellulare?`<small>${esc(x.cellulare)}</small>`:''}</span></button>`).join('')}</div>`
  :'<div class="empty">Qui vanno allenatori, dirigenti, segnapunti e volontari, con le loro scadenze (tessera, visita, brevetto, certificato del casellario per chi lavora con minori).</div>'}`;
}
function openStaff(id){
  const x=id?clone(socData().staff.find(s=>s.id===id)):{id:null, nome:'', cognome:'', ruolo:'', cellulare:'', email:'', codiceFiscale:'', tessera:'', qualifica:'', compenso:'', note:'', iban:'', scadenzaTessera:'', scadenzaVisita:'', scadenzaQualifica:'', scadenzaCasellario:'', attivo:true, squadre:[]};
  if(!x) return; ui.stDraft=x;
  const inp=(n,l,t,ph,cls)=>`<label class="f ${cls||''}">${l}<input type="${t||'text'}" name="${n}" value="${esc(x[n]||'')}" ${ph?`placeholder="${esc(ph)}"`:''}></label>`;
  openModal(`<div class="modal-box" style="max-width:720px"><form id="st-form" onsubmit="return false" autocomplete="off">
    <div class="modal-head"><h2 style="flex:1">${id?esc(fullName(x)):'Nuova persona dello staff'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body">
      <div class="atf"><h3>Dati</h3><div class="atf-g">${inp('nome','Nome')}${inp('cognome','Cognome')}<label class="f">Ruolo<input type="text" name="ruolo" list="dl-st-ruoli" value="${esc(x.ruolo)}"><datalist id="dl-st-ruoli">${SOC_RUOLI.map(r=>`<option value="${esc(r)}">`).join('')}</datalist></label>
        ${inp('cellulare','Cellulare','tel')}${inp('email','Email','email')}${inp('codiceFiscale','Codice fiscale')}</div></div>
      ${teamMulti()?`<div class="atf"><h3>Squadre che segue</h3><div class="at-teams">${teamsRaw().map((t,i)=>`<label class="sw"><input type="checkbox" name="sq" value="${t.id}" ${(x.squadre||[]).includes(t.id)?'checked':''}> ${esc(teamLabel(t,i))}</label>`).join('')}</div></div>`:''}
      <div class="atf"><h3>Tessere, abilitazioni e scadenze</h3><div class="atf-g">${inp('tessera','N° tessera')}${inp('scadenzaTessera','Scadenza tessera','date')}${inp('scadenzaVisita','Scadenza visita medica','date')}
        ${inp('qualifica','Qualifica / brevetto','text','Es. Allenatore 1° grado')}${inp('scadenzaQualifica','Scadenza qualifica','date')}${inp('scadenzaCasellario','Scadenza certificato casellario','date')}</div></div>
      <div class="atf"><h3>Rimborsi</h3><div class="atf-g">${inp('compenso','Rimborso / compenso concordato','text','Es. 150 € al mese')}${inp('iban','IBAN','text','','w2')}</div></div>
      <div class="atf"><h3>Note</h3><textarea name="note" rows="2" style="width:100%">${esc(x.note)}</textarea><label class="sw"><input type="checkbox" name="attivo" ${x.attivo!==false?'checked':''}> Attivo in questa stagione</label></div>
    </div>
    <div class="modal-foot">${id?'<button type="button" class="btn danger" data-action="st-del">Elimina</button>':''}<span style="flex:1"></span>${id&&x.cellulare?`<a class="btn wa" href="https://wa.me/${waNumber(x.cellulare)}" target="_blank" rel="noopener">WhatsApp</a>`:''}<button type="button" class="btn" data-action="close-modal">Annulla</button><button type="button" class="btn primary" data-action="st-save">Salva</button></div></form></div>`);
}
async function socStaffSave(){
  const fd=new FormData($('#st-form')), x=ui.stDraft;
  ['nome','cognome','ruolo','cellulare','email','codiceFiscale','tessera','scadenzaTessera','scadenzaVisita','qualifica','scadenzaQualifica','scadenzaCasellario','compenso','iban','note'].forEach(k=>x[k]=(fd.get(k)||'').toString().trim());
  x.codiceFiscale=x.codiceFiscale.toUpperCase(); x.attivo=!!fd.get('attivo'); if(teamMulti()) x.squadre=[...document.querySelectorAll('#st-form [name=sq]:checked')].map(i=>i.value);
  if(!x.nome && !x.cognome){ alert('Inserisci almeno il nome o il cognome.'); return; }
  if(!x.id) x.id=newId('st');
  try{ await socPut('staff', x); }catch(e){ saveFail(e); return; }
  closeModal(); toast('Salvato'); socRefreshBehind();
}

/* ---------------------------------------------------------------- magazzino */
const invOut = x => (x.consegne||[]).filter(c=>!c.restituito).reduce((s,c)=>s+(+c.quantita||1),0);
const invFree = x => (+x.quantita||0) - invOut(x);
function socInvHTML(){
  const L=socData().inv, f=ui.si||'';
  const cats=[...new Set(L.map(x=>x.categoria||'Altro'))];
  const V=L.filter(x=>!f||(x.categoria||'Altro')===f);
  return `<div class="sd-quick"><button class="btn primary" data-action="soc-inv-new">＋ Articolo</button></div>
  ${cats.length>1?`<div class="chips sd-chips"><button class="chip ${!f?'on':''}" data-action="soc-inv-f" data-v="">Tutto</button>${cats.map(c=>`<button class="chip ${f===c?'on':''}" data-action="soc-inv-f" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>`:''}
  ${V.length?`<div class="panel sd-rows">${V.map(x=>{ const free=invFree(x), low=x.sogliaMin!==''&&free<=+x.sogliaMin;
    return `<button class="sd-row" data-action="soc-inv" data-id="${x.id}"><span class="nm"><b>${esc(x.articolo)}${x.taglia?' · '+esc(x.taglia):''}</b><small>${[x.categoria, invOut(x)?invOut(x)+' consegnat'+(invOut(x)===1?'o':'i'):''].filter(Boolean).map(esc).join(' · ')}</small></span>
      <span class="am"><b class="${free<0||low?'sd-red':''}">${free}</b><small>disponibil${free===1?'e':'i'} su ${+x.quantita||0}</small></span></button>`; }).join('')}</div>`
  :'<div class="empty">Palloni, divise, borse, reti, kit di primo soccorso… Tieni il conto di quanti ne avete e a chi li avete consegnati.</div>'}`;
}
function openInv(id){
  const x=id?clone(socData().inv.find(i=>i.id===id)):{id:null, articolo:'', categoria:'', taglia:'', quantita:'', costo:'', sogliaMin:'', note:'', consegne:[]};
  if(!x) return; ui.invDraft=x; socInvRender();
}
function socInvRender(){
  const x=ui.invDraft, D=socData(), ats=D.at.filter(a=>a.iscritto).sort((a,b)=>fullName(a).localeCompare(fullName(b),'it'));
  const who=c=>c.atletaId?socAtName(c.atletaId):(c.a||'—');
  openModal(`<div class="modal-box" style="max-width:640px"><form id="inv-form" onsubmit="return false">
    <div class="modal-head"><h2 style="flex:1">${x.id?esc(x.articolo):'Nuovo articolo'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="grid g3">
      <label class="f" style="grid-column:span 2">Articolo<input type="text" name="articolo" value="${esc(x.articolo)}" placeholder="Es. Maglia gara blu"></label>
      <label class="f">Categoria<input type="text" name="categoria" list="dl-inv-cat" value="${esc(x.categoria)}"><datalist id="dl-inv-cat">${SOC_INV_CAT.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="f">Taglia / modello<input type="text" name="taglia" value="${esc(x.taglia)}"></label>
      <label class="f">Quanti ne avete<input type="number" name="quantita" min="0" value="${esc(x.quantita)}"></label>
      <label class="f">Avvisa sotto i<input type="number" name="sogliaMin" min="0" value="${esc(x.sogliaMin)}" placeholder="—"></label>
      <label class="f">Costo unitario (€)<input type="text" name="costo" inputmode="decimal" value="${esc(moneyIn(x.costo))}"></label>
      <label class="f" style="grid-column:span 2">Note<input type="text" name="note" value="${esc(x.note)}"></label>
    </div>
    <h3 class="sd-h3">Consegne</h3>
    ${(x.consegne||[]).length?`<div class="sd-cons">${x.consegne.map(c=>`<div class="${c.restituito?'off':''}"><span><b>${esc(who(c))}</b> · ${c.quantita||1} pz · ${shortDate(c.data)}${c.restituito?' · reso'+(c.resoIl?' il '+shortDate(c.resoIl):''):''}${c.note?' · '+esc(c.note):''}</span><span>${c.restituito?'':`<button type="button" class="btn sm" data-action="inv-reso" data-c="${c.id}">Reso</button>`}<button type="button" class="btn sm ghost" data-action="inv-cdel" data-c="${c.id}" title="Togli">✕</button></span></div>`).join('')}</div>`:'<p class="muted" style="margin:0 0 8px">Nessuna consegna.</p>'}
    <div class="sd-cadd"><select id="inv-at"><option value="">A chi lo consegni?</option>${ats.map(a=>`<option value="${a.id}">${esc(fullName(a))}</option>`).join('')}<option value="__altro">Un'altra persona…</option></select><input type="number" id="inv-q" min="1" value="1" title="Quanti"><button type="button" class="btn sm" data-action="inv-cadd">＋ Consegna</button></div>
    </div>
    <div class="modal-foot">${x.id?'<button type="button" class="btn danger" data-action="inv-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="close-modal">Annulla</button><button type="button" class="btn primary" data-action="inv-save">Salva</button></div></form></div>`);
}
function socInvRead(){ const fd=new FormData($('#inv-form')), x=ui.invDraft; ['articolo','categoria','taglia','note'].forEach(k=>x[k]=(fd.get(k)||'').toString().trim());
  x.quantita=(fd.get('quantita')||'').toString(); x.sogliaMin=(fd.get('sogliaMin')||'').toString(); x.costo=(fd.get('costo')||'').toString().trim()===''?'':money(fd.get('costo')); return x; }
async function socInvSave(){
  const x=socInvRead(); if(!x.articolo){ alert("Scrivi il nome dell'articolo."); return; }
  if(!x.id) x.id=newId('mg');
  try{ await socPut('inventory', x); }catch(e){ saveFail(e); return; }
  closeModal(); toast('Magazzino aggiornato'); socRefreshBehind();
}

/* ---------------------------------------------------------------- dati della società */
function socDatiHTML(){
  const c=socCfg(), r=socRaw();
  const inp=(k,l,ph,t,cls)=>`<label class="f ${cls||''}">${l}<input type="${t||'text'}" data-soc="${k}" value="${esc(c[k]||'')}" ${ph?`placeholder="${esc(ph)}"`:''}></label>`;
  const ta=(k,l,rows,help)=>`<label class="f span2">${l}<textarea data-soc="${k}" rows="${rows||4}">${esc(c[k]||'')}</textarea>${help?`<small class="muted" style="font-weight:400">${help}</small>`:''}</label>`;
  const P=c.pianiQuota||[];
  return `<p class="muted" style="margin-top:0">Questi dati compaiono su ricevute, attestazioni, rendiconti e solleciti. Si salvano da soli. <span id="soc-saved" class="sd-green"></span></p>
  <div class="panel"><h2>La società</h2><div class="grid g3">
    ${inp('ragioneSociale','Denominazione','Es. A.S.D. Polisportiva Corbetta','','span2')}${inp('forma','Forma','ASD, SSD, APS…')}
    ${inp('codiceFiscale','Codice fiscale')}${inp('partitaIva','Partita IVA (se c\'è)')}${inp('telefono','Telefono','','tel')}
    ${inp('indirizzo','Indirizzo della sede','','','span2')}${inp('citta','CAP e città')}
    ${inp('email','Email','','email')}${inp('pec','PEC','','email')}${inp('sito','Sito web')}
    ${inp('presidente','Presidente')}${inp('tesoriere','Tesoriere')}${inp('firma','Chi firma le ricevute','Es. Il tesoriere – Mario Rossi')}
  </div></div>
  <div class="panel"><h2>Pagamenti</h2><div class="grid g3">
    ${inp('iban','IBAN per i bonifici','IT…','','span2')}${inp('intestatarioIban','Intestato a')}
    ${inp('causale','Causale suggerita','','','span2')}
    <label class="f">La stagione inizia a<select data-soc="meseInizio">${SOC_MESI.map((m,i)=>`<option value="${i+1}" ${(+c.meseInizio||9)===i+1?'selected':''}>${cap(m)}</option>`).join('')}</select></label>
  </div><p class="muted" style="font-size:12.5px;margin:8px 0 0">Nella causale puoi usare {stagione} e {atleta}.</p></div>
  <div class="panel"><div class="sd-ph"><h2>Piani delle quote</h2><button class="btn sm primary" data-action="plan-new">＋ Nuovo piano</button></div>
    ${P.length?`<div class="sd-rows">${P.map(p=>`<button class="sd-row" data-action="plan-edit" data-id="${p.id}"><span class="nm"><b>${esc(p.nome)}</b><small>${p.rate.map(x=>`${esc(x.descrizione||'rata')} ${eur(money(x.importo))}${x.scadenza?' entro il '+shortDate(x.scadenza):''}`).join(' · ')}</small></span><span class="am"><b>${eur(p.rate.reduce((s,x)=>s+money(x.importo),0))}</b></span></button>`).join('')}</div>`
    :'<p class="muted" style="margin:0">Un piano è la quota con le sue rate, per esempio «Under 14: 280 € in due rate, entro il 15 ottobre e il 15 gennaio». Lo crei una volta e lo assegni a tutti gli atleti con «Assegna quote».</p>'}</div>
  <div class="panel"><h2>Ricevute</h2><div class="grid g2">
    <label class="sw span2"><input type="checkbox" data-soc="detrazione" ${c.detrazione?'checked':''}> Per i ragazzi tra 5 e 18 anni scrivi sulla ricevuta che è una spesa per attività sportiva dei figli (detrazione nel 730)</label>
    <label class="sw span2"><input type="checkbox" data-soc="bollo" ${c.bollo?'checked':''}> Sopra 77,47 € indica la marca da bollo da 2 €</label>
    ${ta('notaRicevuta','Testo in fondo alla ricevuta (facoltativo)',3,'Es. «Quota associativa fuori campo IVA ai sensi dell\'art. 4 DPR 633/72». Fatti dire dal commercialista la dicitura giusta per la tua società.')}
  </div></div>
  <div class="panel"><h2>Testo del sollecito</h2><div class="grid g2">${ta('sollecito','Messaggio per WhatsApp ed email',5,'Puoi usare: {nome} (di chi paga), {atleta}, {importo}, {descrizione}, {scadenza}, {societa}, {iban} (frase con IBAN e causale), {causale}.')}</div></div>
  <div class="panel"><h2>Elenchi</h2><div class="grid g3">
    <label class="f">Modalità di pagamento<textarea data-soc="metodi" rows="7">${esc(c.metodi)}</textarea></label>
    <label class="f">Categorie delle entrate<textarea data-soc="catE" rows="7">${esc(c.catE)}</textarea></label>
    <label class="f">Categorie delle uscite<textarea data-soc="catU" rows="7">${esc(c.catU)}</textarea></label>
  </div><p class="muted" style="font-size:12.5px;margin:8px 0 0">Una voce per riga.</p></div>
  ${Object.keys(r).length?'':'<p class="muted" style="font-size:13px">Suggerimento: compila almeno denominazione, codice fiscale e indirizzo, così le ricevute sono già pronte.</p>'}`;
}
function openPlan(id){
  const c=socCfg(), p=id?clone((c.pianiQuota||[]).find(x=>x.id===id)):{id:null, nome:'', voce:SOC_VOCI[0], rate:[{descrizione:'Prima rata', importo:'', scadenza:''},{descrizione:'Seconda rata', importo:'', scadenza:''}]};
  if(!p) return; ui.planDraft=p; socPlanRender();
}
function socPlanRender(){
  const p=ui.planDraft, tot=p.rate.reduce((s,x)=>s+money(x.importo),0);
  openModal(`<div class="modal-box" style="max-width:640px"><form id="plan-form" onsubmit="return false">
    <div class="modal-head"><h2 style="flex:1">${p.id?'Piano delle quote':'Nuovo piano delle quote'}</h2><button type="button" class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f">Nome del piano<input type="text" data-pl="nome" value="${esc(p.nome)}" placeholder="Es. Quota Under 14"></label>
      <label class="f">Voce<input type="text" data-pl="voce" list="dl-soc-voci3" value="${esc(p.voce)}"><datalist id="dl-soc-voci3">${SOC_VOCI.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></label></div>
      <h3 class="sd-h3">Rate</h3>
      <div class="sd-plan">${p.rate.map((x,i)=>`<div><input type="text" data-pr="${i}" data-k="descrizione" value="${esc(x.descrizione)}" placeholder="Descrizione"><input type="text" inputmode="decimal" data-pr="${i}" data-k="importo" value="${esc(x.importo)}" placeholder="€"><input type="date" data-pr="${i}" data-k="scadenza" value="${esc(x.scadenza)}"><button type="button" class="iconbtn" data-action="plan-rdel" data-i="${i}" title="Togli la rata" ${p.rate.length<2?'disabled':''}>✕</button></div>`).join('')}</div>
      <div class="actions" style="margin-top:8px"><button type="button" class="btn sm" data-action="plan-radd">＋ Rata</button><span style="flex:1"></span><span>Totale <b id="plan-tot">${eur(tot)}</b></span></div>
      <p class="muted" style="font-size:12.5px">Le date delle rate valgono per la stagione in cui assegni il piano: la stagione successiva aggiorna le date prima di riassegnarlo.</p></div>
    <div class="modal-foot">${p.id?'<button type="button" class="btn danger" data-action="plan-del">Elimina</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-action="close-modal">Annulla</button><button type="button" class="btn primary" data-action="plan-save">Salva</button></div></form></div>`);
}
async function socPlanSave(del){
  const p=ui.planDraft, c=socRaw(), L=(c.pianiQuota||[]).filter(x=>x.id!==p.id);
  if(!del){ p.nome=p.nome.trim(); if(!p.nome){ alert('Dai un nome al piano.'); return; } p.rate=p.rate.filter(x=>money(x.importo)>0); if(!p.rate.length){ alert('Inserisci almeno una rata con un importo.'); return; }
    if(!p.id) p.id=newId('pq'); L.push(p); }
  try{ await socCfgSet({pianiQuota:L}); }catch(e){ saveFail(e); return; }
  closeModal(); toast(del?'Piano eliminato':'Piano salvato'); socRefreshBehind();
}

/* ---------------------------------------------------------------- stampe */
function socHeadHTML(title, sub){
  const c=socCfg();
  return `<div class="rc-head">${db.settings.logo?`<img src="${db.settings.logo}" alt="">`:''}<div><b>${esc(c.ragioneSociale||socName())}</b><span>${[c.indirizzo, c.citta].filter(Boolean).map(esc).join(' – ')}</span><span>${[c.codiceFiscale?'C.F. '+c.codiceFiscale:'', c.partitaIva?'P. IVA '+c.partitaIva:''].filter(Boolean).map(esc).join(' · ')}</span><span>${[c.email, c.telefono].filter(Boolean).map(esc).join(' · ')}</span></div>
    <div class="t"><h1>${esc(title)}</h1>${sub?`<span>${sub}</span>`:''}</div></div>`;
}
function socPrintReceipt(pid, iid){
  const p=socData().pay.find(x=>x.id===pid), x=p&&(p.incassi||[]).find(i=>i.id===iid); if(!x) return;
  const c=socCfg(), a=socAt(p.atletaId)||{}, age=socAge(a, x.data), minor=age!==null && age>=5 && age<=18;
  const one=`<div class="rc">${socHeadHTML('Ricevuta', 'n. <b>'+esc(x.ricevuta||'—')+'</b> del '+shortDate(x.data))}
    <p class="rc-body">Si dichiara di aver ricevuto da <b>${esc(x.pagatoDa||fullName(a))}</b>${x.cfPagante?` (C.F. ${esc(x.cfPagante)})`:''}
    la somma di <b>${eur(x.importo)}</b> <i>(euro ${eurWords(x.importo)})</i>
    ${x.pagatoDa && x.pagatoDa.toLowerCase()!==[a.nome,a.cognome].filter(Boolean).join(' ').toLowerCase()?`per l'atleta <b>${esc([a.nome,a.cognome].filter(Boolean).join(' '))}</b>${a.dataNascita?`, nato/a il ${shortDate(a.dataNascita)}`:''}${a.luogoNascita?' a '+esc(a.luogoNascita):''}${a.codiceFiscale?` (C.F. ${esc(a.codiceFiscale)})`:''},`:''}
    a titolo di: <b>${esc(payDesc(p))}${p.stagione?' – stagione sportiva '+esc(p.stagione):''}</b>.</p>
    <p class="rc-body">Modalità di pagamento: <b>${esc(x.metodo||'—')}</b>.${x.note?' '+esc(x.note):''}</p>
    ${c.detrazione && minor?`<p class="rc-note">Spesa sostenuta per la pratica di attività sportiva dilettantistica di ragazzi tra 5 e 18 anni (art. 15, comma 1, lettera i-quinquies, TUIR).</p>`:''}
    ${c.notaRicevuta?`<p class="rc-note">${nl2br(c.notaRicevuta)}</p>`:''}
    <div class="rc-foot"><div>${c.bollo && x.importo>77.47?'<div class="rc-bollo">Marca da bollo<br>€ 2,00</div>':''}</div><div class="rc-sign">${esc(c.citta?c.citta.replace(/^\d{5}\s*/,'')+', ':'')}${shortDate(x.data)}<br><br>${esc(c.firma||'Il legale rappresentante')}<br><span>_____________________________</span></div></div></div>`;
  doPrint(`<div class="rc-page">${one}<div class="rc-cut">✂ - - - - - - - - - - copia per la società - - - - - - - - - -</div>${one}</div>`, 'Ricevuta '+(x.ricevuta||'').replace('/','-'));
}
function socPrintAtt(aid, year){
  const a=socAt(aid)||{}, c=socCfg(), L=[];
  socData().pay.filter(p=>p.atletaId===aid).forEach(p=>(p.incassi||[]).filter(x=>(x.data||'').startsWith(year)).forEach(x=>L.push({p,x})));
  L.sort((u,v)=>u.x.data.localeCompare(v.x.data)); const tot=r2(L.reduce((s,o)=>s+o.x.importo,0)), payer=socPayer(a);
  const trac=L.filter(o=>!/contant/i.test(o.x.metodo||'')), totT=r2(trac.reduce((s,o)=>s+o.x.importo,0));
  doPrint(`<div class="rc-page"><div class="rc">${socHeadHTML('Attestazione di pagamento', 'anno '+esc(year))}
    <p class="rc-body">Si attesta che <b>${esc(payer.nome||fullName(a))}</b>${payer.cf?` (C.F. ${esc(payer.cf)})`:''} ha versato a questa società, nell'anno ${esc(year)}, per l'attività sportiva di
    <b>${esc([a.nome,a.cognome].filter(Boolean).join(' '))}</b>${a.dataNascita?`, nato/a il ${shortDate(a.dataNascita)}`:''}${a.codiceFiscale?` (C.F. ${esc(a.codiceFiscale)})`:''}, le seguenti somme:</p>
    <table class="p-sched"><thead><tr><th>Data</th><th>Causale</th><th>Modalità</th><th>Ricevuta</th><th class="n">Importo</th></tr></thead>
    <tbody>${L.map(({p,x})=>`<tr><td>${shortDate(x.data)}</td><td>${esc(payDesc(p))}</td><td>${esc(x.metodo||'')}</td><td>${esc(x.ricevuta||'')}</td><td class="n">${eur(x.importo)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Totale</td><td class="n">${eur(tot)}</td></tr>${totT!==tot?`<tr><td colspan="4">di cui con pagamento tracciabile</td><td class="n">${eur(totT)}</td></tr>`:''}</tfoot></table>
    ${c.detrazione?`<p class="rc-note">Attestazione rilasciata su richiesta dell'interessato per gli usi consentiti dalla legge (detrazione delle spese per attività sportive dei ragazzi tra 5 e 18 anni, art. 15, comma 1, lettera i-quinquies, TUIR).</p>`:''}
    <div class="rc-foot"><div></div><div class="rc-sign">${shortDate(todayISO())}<br><br>${esc(c.firma||'Il legale rappresentante')}<br><span>_____________________________</span></div></div></div></div>`, 'Attestazione '+year+' '+fullName(a));
}
function socPrintEstratto(aid){
  const a=socAt(aid)||{}, P=socData().pay.filter(p=>p.atletaId===aid && !p.annullata).sort((x,y)=>(x.stagione+x.scadenza).localeCompare(y.stagione+y.scadenza)), acc=socAccount(aid, null);
  doPrint(`<div class="rc-page"><div class="rc">${socHeadHTML('Estratto conto', esc(fullName(a))+' · '+shortDate(todayISO()))}
    <table class="p-sched"><thead><tr><th>Stagione</th><th>Quota</th><th>Scadenza</th><th class="n">Importo</th><th class="n">Versato</th><th class="n">Da versare</th></tr></thead>
    <tbody>${P.map(p=>`<tr><td>${esc(p.stagione)}</td><td>${esc(payDesc(p))}${(p.incassi||[]).length?`<br><small>${p.incassi.map(x=>shortDate(x.data)+' '+eur(x.importo)+(x.ricevuta?' (ric. '+esc(x.ricevuta)+')':'')).join(' · ')}</small>`:''}</td><td>${shortDate(p.scadenza)}</td><td class="n">${eur(p.importo)}</td><td class="n">${eur(payPaid(p))}</td><td class="n">${eur(payDue(p))}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">Totale</td><td class="n">${eur(acc.dovuto)}</td><td class="n">${eur(acc.pagato)}</td><td class="n">${eur(acc.residuo)}</td></tr></tfoot></table>
    ${acc.residuo>0&&socCfg().iban?`<p class="rc-note">Per i pagamenti: bonifico sull'IBAN <b>${esc(socCfg().iban)}</b>${socCfg().intestatarioIban?' intestato a '+esc(socCfg().intestatarioIban):''}.</p>`:''}</div></div>`, 'Estratto conto '+fullName(a));
}
function socPrintQuote(){
  const season=socSeason(), L=socQuoteRows(season), tot=L.reduce((s,x)=>({d:s.d+x.acc.dovuto,p:s.p+x.acc.pagato,r:s.r+x.acc.residuo}),{d:0,p:0,r:0});
  doPrint(`<div class="rc-page wide">${socHeadHTML('Situazione quote', 'stagione '+esc(season)+' · '+shortDate(todayISO()))}
    <table class="p-sched"><thead><tr><th>Atleta</th>${teamMulti()?'<th>Squadra</th>':''}<th>Prossima scadenza</th><th class="n">Dovuto</th><th class="n">Versato</th><th class="n">Da versare</th><th>Stato</th></tr></thead>
    <tbody>${L.map(({a,acc})=>`<tr><td>${esc(fullName(a))}</td>${teamMulti()?`<td>${esc(socTeamOf(a))}</td>`:''}<td>${acc.next?shortDate(acc.next.scadenza):''}</td><td class="n">${eur(acc.dovuto)}</td><td class="n">${eur(acc.pagato)}</td><td class="n">${eur(acc.residuo)}</td><td>${acc.st==='nessuna'?'—':PAY_ST[acc.st][1]}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${teamMulti()?3:2}">Totale</td><td class="n">${eur(tot.d)}</td><td class="n">${eur(tot.p)}</td><td class="n">${eur(tot.r)}</td><td></td></tr></tfoot></table></div>`, 'Quote '+season.replace('/','-'));
}
function socPrintRend(){
  const season=socSeason(), M=socMovements(socSeasonRange(season)).sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  const grp=t=>{ const o={}; M.filter(m=>m.tipo===t).forEach(m=>o[m.categoria||'Senza categoria']=(o[m.categoria||'Senza categoria']||0)+m.importo); return Object.entries(o).sort((a,b)=>b[1]-a[1]); };
  const E=grp('E'), U=grp('U'), tE=r2(E.reduce((s,x)=>s+x[1],0)), tU=r2(U.reduce((s,x)=>s+x[1],0));
  const tbl=(L,t)=>`<table class="p-sched"><thead><tr><th>${t}</th><th class="n">Importo</th></tr></thead><tbody>${L.map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${eur(v)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Totale</td><td class="n">${eur(L.reduce((s,x)=>s+x[1],0))}</td></tr></tfoot></table>`;
  doPrint(`<div class="rc-page wide">${socHeadHTML('Rendiconto', 'stagione '+esc(season)+' · '+socSeasonRange(season).map(shortDate).join(' – '))}
    <div class="rc-2">${tbl(E,'Entrate')}${tbl(U,'Uscite')}</div>
    <p class="rc-body" style="font-size:12pt">Risultato della stagione: <b>${eur(tE-tU)}</b> ${tE-tU>=0?'(avanzo)':'(disavanzo)'}</p>
    <h3 style="margin-top:14pt">Movimenti</h3>
    <table class="p-sched"><thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th>Modalità</th><th class="n">Entrata</th><th class="n">Uscita</th></tr></thead>
    <tbody>${M.map(m=>`<tr><td>${shortDate(m.data)}</td><td>${esc(m.descrizione||'')}${m.controparte?' – '+esc(m.controparte):''}</td><td>${esc(m.categoria||'')}</td><td>${esc(m.metodo||'')}</td><td class="n">${m.tipo==='E'?eur(m.importo):''}</td><td class="n">${m.tipo==='U'?eur(m.importo):''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Totale</td><td class="n">${eur(tE)}</td><td class="n">${eur(tU)}</td></tr></tfoot></table></div>`, 'Rendiconto '+season.replace('/','-'));
}
function socPrintStaff(){
  const L=socData().staff.filter(x=>x.attivo!==false);
  doPrint(`<div class="rc-page wide">${socHeadHTML('Organigramma', 'stagione '+esc(socSeasonOf(todayISO())))}
    <table class="p-sched"><thead><tr><th>Nome</th><th>Ruolo</th><th>Qualifica</th><th>Cellulare</th><th>Email</th></tr></thead>
    <tbody>${L.map(x=>`<tr><td>${esc(fullName(x))}</td><td>${esc(x.ruolo||'')}</td><td>${esc(x.qualifica||'')}</td><td>${esc(x.cellulare||'')}</td><td>${esc(x.email||'')}</td></tr>`).join('')}</tbody></table></div>`, 'Organigramma');
}

/* ---------------------------------------------------------------- file CSV (si aprono con Excel) */
function socDownload(name, text, type){
  const blob=new Blob([text], {type:(type||'text/plain')+';charset=utf-8'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
function socCsv(name, head, rows){
  const cell=v=>{ v=v==null?'':String(v); return /[";\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const num=v=>String(r2(v)).replace('.', ',');
  socDownload(name, '\ufeff'+[head, ...rows].map(r=>r.map(v=>typeof v==='number'?num(v):cell(v)).join(';')).join('\r\n'), 'text/csv');
}
function socCsvQuote(){
  const season=socSeason(), rows=[];
  socData().pay.filter(p=>p.stagione===season).forEach(p=>{ const a=socAt(p.atletaId)||{};
    rows.push([fullName(a), socTeamOf(a), p.stagione, p.voce, payDesc(p), p.scadenza?shortDate(p.scadenza):'', p.importo, payPaid(p), payDue(p), PAY_ST[payState(p)][1], (p.incassi||[]).map(x=>x.ricevuta).filter(Boolean).join(' '), socPayer(a).nome, socPayer(a).tel]); });
  rows.sort((x,y)=>x[0].localeCompare(y[0],'it'));
  socCsv('quote-'+season.replace('/','-')+'.csv', ['Atleta','Squadra','Stagione','Voce','Descrizione','Scadenza','Importo','Versato','Da versare','Stato','Ricevute','Chi paga','Telefono'], rows);
}
function socCsvLed(){
  const season=socSeason(), M=socMovements(socSeasonRange(season)).sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  socCsv('prima-nota-'+season.replace('/','-')+'.csv', ['Data','Tipo','Categoria','Descrizione','Da / a chi','Modalità','Documento','Entrata','Uscita'],
    M.map(m=>[shortDate(m.data), m.tipo==='E'?'Entrata':'Uscita', m.categoria, m.descrizione, m.controparte, m.metodo, m.documento, m.tipo==='E'?m.importo:'', m.tipo==='U'?m.importo:'']));
}

/* ---------------------------------------------------------------- collegamenti col resto dell'app */
/* promemoria nella pagina iniziale */
function socHomeRem(){
  const R=[], season=socSeason(), D=socData(); if(!D.pay.length && !D.dl.length) return R;
  const scad=D.pay.filter(p=>payState(p)==='scaduta'), n=new Set(scad.map(p=>p.atletaId)).size;
  if(n) R.push(`<button class="red" data-action="soc-go" data-t="quote" data-f="scaduta">💶 ${n} atlet${n===1?'a':'i'} con quote scadute</button>`);
  const dl=socAgenda(7).filter(x=>x.k==='societa');
  if(dl.length) R.push(`<button class="${dl.some(x=>x.n<0)?'red':'ora'}" data-action="soc-go" data-t="scadenze">📌 ${dl.length===1?esc(dl[0].t)+' '+(dl[0].n<0?'scaduta':dl[0].n===0?'oggi':'tra '+dl[0].n+' g'):dl.length+' scadenze della società'}</button>`);
  void season; return R;
}
function socHomeTile(){
  const D=socData(), season=socSeason(), P=D.pay.filter(p=>p.stagione===season && !p.annullata), due=r2(P.reduce((s,p)=>s+payDue(p),0));
  return ['societa','Società','#0f766e', P.length?(due>0?`Da incassare ${eur(due)}`:'Quote tutte incassate ✓'):'Quote, pagamenti e scadenze'];
}
/* riquadro nel profilo dell'atleta */
function socAtTile(a){
  const acc=socAccount(a.id, socSeason()); if(acc.st==='nessuna') return '';
  const cls=acc.st==='pagata'?'ok':acc.scaduto?'bad':'warn';
  return `<div class="atp-t ${cls} go" data-action="soc-at" data-id="${a.id}"><div class="k">💶 Quote ${esc(socSeason())}</div><b>${acc.residuo>0?eur(acc.residuo):'In regola'}</b><small>${acc.residuo>0?(acc.scaduto?'scaduti '+eur(acc.scaduto):'da versare'):'versati '+eur(acc.pagato)}</small></div>`;
}
/* campi in più nella scheda dell'atleta */
const SOC_AT_TXT=['codiceFiscale','luogoNascita','indirizzo','email','genitore','cfGenitore','telGenitore','emailGenitore','tessera','scadenzaTessera'];
function socAtFormHTML(a){
  const v=k=>esc(a[k]||'');
  return `<div class="atf"><h3>Società: tesseramento e famiglia</h3><div class="atf-g">
      <label class="f">Codice fiscale<input type="text" name="codiceFiscale" value="${v('codiceFiscale')}" maxlength="16" style="text-transform:uppercase"></label>
      <label class="f">Luogo di nascita<input type="text" name="luogoNascita" value="${v('luogoNascita')}"></label>
      <label class="f">Email<input type="email" name="email" value="${v('email')}"></label>
      <label class="f w3">Indirizzo<input type="text" name="indirizzo" value="${v('indirizzo')}" placeholder="Via, numero, CAP, città"></label>
      <label class="f">Genitore / chi paga<input type="text" name="genitore" value="${v('genitore')}" placeholder="Nome e cognome"></label>
      <label class="f">C.F. del genitore<input type="text" name="cfGenitore" value="${v('cfGenitore')}" maxlength="16" style="text-transform:uppercase"></label>
      <label class="f">Cellulare del genitore<input type="tel" name="telGenitore" value="${v('telGenitore')}"></label>
      <label class="f">Email del genitore<input type="email" name="emailGenitore" value="${v('emailGenitore')}"></label>
      <label class="f">N° tessera<input type="text" name="tessera" value="${v('tessera')}"></label>
      <label class="f">Scadenza tessera<input type="date" name="scadenzaTessera" value="${v('scadenzaTessera')}"></label>
      <div class="f w3" style="display:flex;flex-wrap:wrap;gap:4px 22px"><label class="sw"><input type="checkbox" name="privacy" ${a.privacy?'checked':''}> Privacy firmata</label><label class="sw"><input type="checkbox" name="consensoFoto" ${a.consensoFoto?'checked':''}> Consenso a foto e video</label></div>
    </div></div>`;
}
function socAtFormRead(fd, a){
  const f=$('#at-form'), has=n=>!!(f && f.querySelector(`[name=${n}]`));   // solo i campi presenti (l'allenatore ne vede meno)
  SOC_AT_TXT.forEach(k=>{ if(has(k)) a[k]=(fd.get(k)??'').toString().trim(); });
  if(has('codiceFiscale')) a.codiceFiscale=a.codiceFiscale.toUpperCase(); if(has('cfGenitore')) a.cfGenitore=a.cfGenitore.toUpperCase();
  if(has('privacy')) a.privacy=fd.get('privacy')?'si':''; if(has('consensoFoto')) a.consensoFoto=fd.get('consensoFoto')?'si':'';
}
function socAtEdit(id){
  if(getAt(id)){ openAtModal(id); return; }
  const a=socAt(id); if(!a){ toast('Atleta non trovato'); return; }
  const L=teamsRaw(), t=L.find(x=>atTeams(a).includes(x.id));
  if(t && confirm(`${fullName(a)} è nella squadra «${t.squadra}». Passare a quella squadra per modificare la scheda?`)) teamSwitch(t.id).then(()=>openAtModal(id));
}
async function socLegacyCheck(){
  const box=$('#legacy-box'); if(!box) return;
  const L=await Store.legacyInfo(); if(!L){ box.remove(); return; }
  const c=L.counts; box.innerHTML=`<button type="button" class="choice" data-action="w-legacy"><span class="ic">🏐</span><span><b>Porto qui i dati di Volleysched</b><span class="muted" style="font-size:13.5px">In questo browser c'è l'archivio di Volleysched: ${[c.athletes?c.athletes+' atleti':'', c.exercises?c.exercises+' esercizi':'', c.sessions?c.sessions+' sessioni':'', c.matches?c.matches+' partite':''].filter(Boolean).join(', ')}. Lo copio in Volleydesk (Volleysched resta com'è).</span></span></button>`;
}

/* ---------------------------------------------------------------- eventi */
Object.assign(actions, {
  'soc-tab': b=>{ ui.socTab=b.dataset.t; if(ui.view!=='societa') go('societa'); else { render(); window.scrollTo(0,0); navSync(); } },
  'soc-go': b=>{ ui.socTab=b.dataset.t; if(b.dataset.f){ ui.sq=Object.assign(ui.sq||{}, {st:b.dataset.f}); } go('societa'); },
  'soc-fab': ()=>{ const t=ui.socTab||'panoramica'; if(t==='cassa') openLedger(null,'U'); else if(t==='scadenze') openDeadline(null); else if(t==='staff') openStaff(null); else if(t==='magazzino') openInv(null); else if(t==='dati') openPlan(null); else socPayPick(); },
  'soc-quote-filter': b=>{ ui.sq=Object.assign(ui.sq||{}, {st:b.dataset.v}); ui.socTab='quote'; render(); },
  'soc-at': b=>openSocAt(b.dataset.id),
  'soc-at-edit': b=>{ closeModal(); socAtEdit(b.dataset.id); },
  'soc-pay-pick': ()=>socPayPick(),
  'soc-pay-new': b=>openPayEdit(null, b.dataset.a),
  'soc-pay-edit': b=>openPayEdit(b.dataset.p),
  'soc-pay-save': ()=>socPaySave(),
  'soc-pay-del': async ()=>{ const p=ui.payDraft; if(!p || !p.id) return; if(!confirm((p.incassi||[]).length?`Su questa quota ci sono ${eur(payPaid(p))} già incassati: eliminandola spariscono anche quegli incassi. Continuare?`:'Eliminare questa quota?')) return;
    try{ await socDel('payments', p.id); }catch(e){ saveFail(e); return; } toast('Quota eliminata'); openSocAt(p.atletaId); socRefreshBehind(); },
  'soc-inc-new': b=>openIncasso(b.dataset.p),
  'soc-inc-edit': b=>openIncasso(b.dataset.p, b.dataset.i),
  'soc-inc-save': b=>socIncSave(!!b.dataset.print),
  'soc-inc-del': async ()=>{ const {pid,x}=ui.incDraft, p=clone(socData().pay.find(q=>q.id===pid)); if(!p || !confirm(`Eliminare l'incasso di ${eur(x.importo)}${x.ricevuta?' (ricevuta '+x.ricevuta+')':''}?`)) return;
    p.incassi=p.incassi.filter(i=>i.id!==x.id); try{ await socPut('payments', p); }catch(e){ saveFail(e); return; } toast('Incasso eliminato'); openSocAt(p.atletaId); socRefreshBehind(); },
  'soc-ric-next': ()=>{ const d=$('#inc-form [name=data]').value; $('#inc-ric').value=socNextReceipt(d); },
  'soc-rcpt': b=>socPrintReceipt(b.dataset.p, b.dataset.i),
  'soc-att': b=>{ const y=prompt('Attestazione dei pagamenti dell\'anno:', b.dataset.y); if(y && /^\d{4}$/.test(y.trim())) socPrintAtt(b.dataset.a, y.trim()); },
  'soc-estratto': b=>socPrintEstratto(b.dataset.a),
  'soc-assign': ()=>openAssign(),
  'asg-all': b=>{ const o=ui.asg; socData().at.filter(a=>!o.solo||a.iscritto).forEach(a=>o.sel[a.id]=b.dataset.v==='1'); socAssignRender(); },
  'asg-go': ()=>socAssignGo(),
  'soc-sol': ()=>openSolleciti(),
  'soc-sol-copy': b=>{ const a=socAt(b.dataset.a); if(a) copyText(socFill(socCfg().sollecito, a)); },
  'soc-csv-quote': ()=>socCsvQuote(),
  'soc-print-quote': ()=>socPrintQuote(),
  'soc-led-new': b=>openLedger(null, b.dataset.t),
  'soc-led-edit': b=>openLedger(b.dataset.id),
  'soc-led-filter': b=>{ ui.sl=Object.assign(ui.sl||{}, {t:b.dataset.v}); render(); },
  'led-tipo': b=>{ const fd=new FormData($('#led-form')), m=ui.ledDraft; ['data','categoria','descrizione','controparte','metodo','documento','note','squadra','staffId','natura'].forEach(k=>m[k]=(fd.get(k)||'').toString()); m.importo=money(fd.get('importo'))||''; if(m.tipo!==b.dataset.v) m.categoria=''; m.tipo=b.dataset.v; openLedger(m.id, m.tipo, m); },
  'led-save': b=>socLedSave(!!b.dataset.again),
  'led-del': async ()=>{ const m=ui.ledDraft; if(!m.id || !confirm('Eliminare questo movimento?')) return; try{ await socDel('ledger', m.id); }catch(e){ saveFail(e); return; } closeModal(); toast('Movimento eliminato'); socRefreshBehind(); },
  'soc-csv-led': ()=>socCsvLed(),
  'soc-print-rend': ()=>socPrintRend(),
  'soc-sdk': b=>{ ui.sdk=b.dataset.v; render(); },
  'soc-dl-new': ()=>openDeadline(null),
  'soc-dl': b=>openDeadline(b.dataset.id),
  'soc-dl-done': b=>socDlDone(b.dataset.id),
  'dl-save': ()=>socDlSave(),
  'dl-del': async ()=>{ const d=ui.dlDraft; if(!d.id || !confirm('Eliminare questa scadenza?')) return; try{ await socDel('deadlines', d.id); }catch(e){ saveFail(e); return; } closeModal(); toast('Scadenza eliminata'); socRefreshBehind(); },
  'soc-ics': ()=>socIcs(),
  'soc-staff-new': ()=>openStaff(null),
  'soc-staff': b=>openStaff(b.dataset.id),
  'st-save': ()=>socStaffSave(),
  'st-del': async ()=>{ const x=ui.stDraft; if(!x.id || !confirm(`Eliminare ${fullName(x)}?`)) return; try{ await socDel('staff', x.id); }catch(e){ saveFail(e); return; } closeModal(); toast('Eliminato'); socRefreshBehind(); },
  'soc-print-staff': ()=>socPrintStaff(),
  'soc-inv-new': ()=>openInv(null),
  'soc-inv': b=>openInv(b.dataset.id),
  'soc-inv-f': b=>{ ui.si=b.dataset.v; render(); },
  'inv-save': ()=>socInvSave(),
  'inv-del': async ()=>{ const x=ui.invDraft; if(!x.id || !confirm(`Eliminare «${x.articolo}» dal magazzino?`)) return; try{ await socDel('inventory', x.id); }catch(e){ saveFail(e); return; } closeModal(); toast('Eliminato'); socRefreshBehind(); },
  'inv-cadd': ()=>{ const x=socInvRead(), v=$('#inv-at').value, q=Math.max(1, parseInt($('#inv-q').value,10)||1); if(!v){ alert('Scegli a chi lo consegni.'); return; }
    let c={id:newId('cg'), data:todayISO(), quantita:q, restituito:false, atletaId:'', a:''}; if(v==='__altro'){ const n=(prompt('A chi lo consegni?')||'').trim(); if(!n) return; c.a=n; } else c.atletaId=v;
    x.consegne=[...(x.consegne||[]), c]; socInvRender(); },
  'inv-reso': b=>{ const x=socInvRead(); x.consegne=x.consegne.map(c=>c.id===b.dataset.c?Object.assign({}, c, {restituito:true, resoIl:todayISO()}):c); socInvRender(); },
  'inv-cdel': b=>{ const x=socInvRead(); x.consegne=x.consegne.filter(c=>c.id!==b.dataset.c); socInvRender(); },
  'plan-new': ()=>openPlan(null),
  'plan-edit': b=>openPlan(b.dataset.id),
  'plan-radd': ()=>{ ui.planDraft.rate.push({descrizione:'Rata '+(ui.planDraft.rate.length+1), importo:'', scadenza:''}); socPlanRender(); },
  'plan-rdel': b=>{ ui.planDraft.rate.splice(+b.dataset.i,1); socPlanRender(); },
  'plan-save': ()=>socPlanSave(false),
  'plan-del': ()=>{ if(confirm('Eliminare questo piano? Le quote già assegnate restano.')) socPlanSave(true); },
  'w-legacy': async ()=>{ try{ const r=await Store.importLegacy(); await Store.setMeta('avviato', true); await loadState(); toast(`Fatto: ${r.aggiunti} schede copiate da Volleysched`); go('home'); }catch(e){ alert(e.message||e); } }
});
function socPayPick(){
  const L=socData().at.filter(a=>a.iscritto).sort((a,b)=>fullName(a).localeCompare(fullName(b),'it'));
  openModal(`<div class="modal-box" style="max-width:480px"><div class="modal-head"><h2 style="flex:1">Chi ha pagato?</h2><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><div class="sbox" style="margin-bottom:10px">${EXI.search}<input type="search" id="soc-pick-q" placeholder="Cerca…" autofocus></div>
    <div class="sd-pick" id="soc-pick">${L.map(a=>{ const acc=socAccount(a.id, socSeason()); return `<button data-action="soc-at" data-id="${a.id}" data-n="${esc(fullName(a).toLowerCase()+' '+(a.genitore||'').toLowerCase())}"><span>${esc(fullName(a))}</span>${acc.residuo>0?`<b class="${acc.scaduto?'sd-red':''}">${eur(acc.residuo)}</b>`:acc.st==='pagata'?'<small class="sd-green">in regola</small>':''}</button>`; }).join('')||'<p class="muted">Nessun atleta iscritto.</p>'}</div></div></div>`);
  setTimeout(()=>$('#soc-pick-q')?.focus(), 40);
}
document.addEventListener('input', e=>{
  const t=e.target;
  if(t.id==='soc-q'){ ui.sq=Object.assign(ui.sq||{}, {q:t.value}); const L=socQuoteRows(socSeason()); $('#soc-rows').innerHTML=L.length?L.map(socQuoteRow).join(''):'<div class="empty">Nessun atleta con questi filtri.</div>'; return; }
  if(t.id==='soc-pick-q'){ const q=t.value.toLowerCase().trim(); $$('#soc-pick button').forEach(b=>b.classList.toggle('hidden', !!q && !b.dataset.n.includes(q))); return; }
  if(t.dataset.pr!==undefined){ ui.planDraft.rate[+t.dataset.pr][t.dataset.k]=t.value; const el=$('#plan-tot'); if(el) el.textContent=eur(ui.planDraft.rate.reduce((s,x)=>s+money(x.importo),0)); return; }
  if(t.dataset.pl){ ui.planDraft[t.dataset.pl]=t.value; return; }
  if(t.dataset.asg1){ ui.asg.one[t.dataset.asg1]=t.value; return; }
});
document.addEventListener('change', async e=>{
  const t=e.target;
  if(t.id==='soc-season'){ ui.socSeason=t.value; render(); return; }
  if(t.id==='soc-team'){ ui.sq=Object.assign(ui.sq||{}, {team:t.value}); render(); return; }
  if(t.id==='soc-sort'){ ui.sq=Object.assign(ui.sq||{}, {sort:t.value}); render(); return; }
  if(t.id==='soc-lm'){ ui.sl=Object.assign(ui.sl||{}, {m:t.value}); render(); return; }
  if(t.id==='soc-lc'){ ui.sl=Object.assign(ui.sl||{}, {c:t.value}); render(); return; }
  if(t.id==='soc-lq'){ ui.sl=Object.assign(ui.sl||{}, {q:t.value}); render(); return; }
  if(t.id==='sol-all'){ ui.solAll=t.checked; openSolleciti(); return; }
  if(t.id==='inc-metodo'){ const h=$('#inc-hint'); if(h) h.textContent=socIncHint(t.value); return; }
  if(t.dataset.asg){ const o=ui.asg, k=t.dataset.asg; o[k]=t.type==='checkbox'?t.checked:t.value; socAssignRender(); return; }
  if(t.dataset.asgat){ ui.asg.sel[t.dataset.asgat]=t.checked; socAssignRender(); return; }
  if(t.dataset.asg1){ ui.asg.one[t.dataset.asg1]=t.value; socAssignRender(); return; }
  if(t.dataset.soc){ const k=t.dataset.soc; let v=t.type==='checkbox'?t.checked:t.value; if(k==='meseInizio') v=+v; if(k==='iban') v=String(v).replace(/\s+/g,'').toUpperCase();
    try{ await socCfgSet({[k]:v}); const s=$('#soc-saved'); if(s){ s.textContent='✓ Salvato'; setTimeout(()=>{ if(s) s.textContent=''; },1500); } }catch(err){ saveFail(err); } }
});

/* icona, guida */
ICO.societa = SOC_ICON;
GUIDE.splice(1, 0,
['🏛','Società: quote, pagamenti e ricevute',`
<p>La pagina <b>Società</b> riguarda tutta la società, non solo la squadra che stai usando: vedi gli atleti di tutte le squadre.</p>
<ol><li>In <b>Dati società</b> inserisci denominazione, codice fiscale, indirizzo, IBAN e chi firma le ricevute.</li>
<li>Sempre lì crea un <b>piano delle quote</b>: per esempio «Quota Under 14», 280 € in due rate con le loro scadenze.</li>
<li>In <b>Quote</b> premi <b>📋 Assegna quote</b>, scegli il piano e gli atleti: l'app crea tutte le rate (puoi indicare uno sconto, per esempio per i fratelli).</li>
<li>Quando qualcuno paga: <b>💶 Registra un pagamento</b>, scegli l'atleta e premi <b>Incassa</b>. Il numero di ricevuta si assegna da solo (1/2026, 2/2026…) e puoi stamparla subito.</li></ol>
<p>Le rate non pagate dopo la scadenza diventano <b>scadute</b>: le vedi in rosso, nella home e in <b>📨 Solleciti</b>, che prepara il messaggio WhatsApp o l'email per il genitore con importo, scadenza e IBAN.</p>
<p>Nel conto di ogni atleta trovi anche l'<b>estratto conto</b> e l'<b>attestazione annuale</b> dei pagamenti, utile alle famiglie per la dichiarazione dei redditi. Per i ragazzi tra 5 e 18 anni la spesa è detraibile solo se pagata in modo tracciabile (bonifico, carta…): se scegli «Contanti» l'app te lo ricorda.</p>
<p>Per le ricevute servono i dati di chi paga: nella <b>scheda dell'atleta</b>, sezione «Società», inserisci codice fiscale, genitore e il suo codice fiscale. Le diciture fiscali (IVA, bollo) dipendono dalla tua società: falle verificare al commercialista e scrivile in <b>Dati società → Ricevute</b>.</p>`],
['📒','Prima nota, scadenzario, staff e magazzino',`
<p><b>Prima nota</b>: gli incassi delle quote compaiono da soli; le altre entrate (sponsor, feste, contributi) e le spese (palestra, arbitri, iscrizioni, materiale) le aggiungi con ➕ e ➖. Vedi i totali per categoria, il saldo della stagione, e puoi scaricare il file per Excel o stampare il <b>rendiconto</b> per l'assemblea.</p>
<p><b>Scadenzario</b>: un unico elenco con rate da incassare, visite mediche, tessere e documenti degli atleti, scadenze dello staff e quelle della società che inserisci tu (iscrizione al campionato, affitto, assicurazione, assemblea…). Se una scadenza si ripete, quando la segni fatta l'app crea la successiva. Con <b>📅 Esporta nel calendario</b> le porti nel calendario del telefono.</p>
<p><b>Staff</b>: allenatori, dirigenti e volontari con contatti, tessera, visita, qualifica e certificato del casellario (obbligatorio per chi lavora con i minori).</p>
<p><b>Magazzino</b>: palloni, divise e attrezzatura, con quanti ne avete e a chi li avete consegnati; quando tornano premi <b>Reso</b>.</p>
<p>La scheda <b>Panoramica</b> riassume tutto e, in <b>Da sistemare</b>, elenca chi non ha la visita, la privacy, il tesseramento o le quote.</p>`],
['🔐','Allenatori: ognuno vede solo la sua squadra',`
<p>Senza bisogno di un server: ogni squadra ha un suo archivio privato su GitHub e l'allenatore riceve un codice di accesso valido solo per quello. Non vede quote, cassa, staff, magazzino, le altre squadre, né codice fiscale, indirizzo, email e privacy degli atleti.</p>
<ol><li>Collega prima l'archivio della società (<b>Archivio → Sincronizzazione online</b>).</li>
<li>In <b>Società → Accessi</b> segui i passi: crei l'archivio della squadra, lo aggiungi al codice della segreteria, scrivi il nome accanto alla squadra e premi <b>Collega</b>.</li>
<li>Crei il codice dell'allenatore (solo per quell'archivio) e gli mandi le <b>Istruzioni per l'allenatore</b>; il codice a parte.</li></ol>
<p>Il dispositivo della segreteria fa da tramite: ogni volta che sincronizza aggiorna gli archivi delle squadre e riporta nell'archivio della società presenze, convocazioni, partite e note degli allenatori. Se un allenatore elimina un atleta che ha delle quote o è anche in un'altra squadra, per la società l'atleta resta (al massimo diventa «non iscritto»).</p>
<p>Per togliere l'accesso a un allenatore elimina il suo codice su GitHub.</p>`],
['🔄','Da Volleysched a Volleydesk',`
<p>Volleydesk è una app nuova e tiene i suoi dati separati da Volleysched, che puoi continuare a usare.</p>
<ul><li>Se le due app sono aperte nello stesso browser (stesso indirizzo internet), all'avvio Volleydesk propone <b>«Porto qui i dati di Volleysched»</b>: copia atleti, esercizi, sessioni, partite, presenze e note.</li>
<li>Altrimenti, in Volleysched scarica una copia completa (<b>Archivio → Scarica una copia → Tutto</b>) e in Volleydesk scegli <b>Importo un file</b>.</li>
<li>Per la sincronizzazione crea un archivio GitHub nuovo, <code>volleydesk-dati</code>: così le due app non si mescolano.</li></ul>`]);

/* ---------------------------------------------------------------- dati di prova (file demo)
   Le date della demo si spostano in avanti in base al giorno dell'importazione, così scadenze e
   pagamenti restano realistici; «Togli i dati di prova» toglie anche quote, cassa, staff ecc. */
const _socDemoShift = demoShift;
demoShift = function(d, base){
  _socDemoShift(d, base);
  const n=Math.round((parseISO(todayISO())-parseISO(base))/864e5); if(!n) return d;
  const sh=iso=>{ if(!iso || !/^\d{4}-\d\d-\d\d$/.test(iso)) return iso; const x=parseISO(iso); x.setDate(x.getDate()+n); return toISO(x); };
  const s0=socSeasonOf(base), s1=socSeasonOf(sh(base));
  (d.athletes||[]).forEach(a=>{ a.scadenzaTessera=sh(a.scadenzaTessera); (a.infortuni||[]).forEach(x=>{ x.dal=sh(x.dal); x.rientro=sh(x.rientro); }); });
  (d.payments||[]).forEach(p=>{ p.scadenza=sh(p.scadenza); if(p.stagione===s0) p.stagione=s1; (p.incassi||[]).forEach(x=>{ x.data=sh(x.data); x.ricevuta=String(x.ricevuta||'').replace(/\/\d{4}$/, '/'+String(x.data).slice(0,4)); }); });
  (d.ledger||[]).forEach(m=>{ m.data=sh(m.data); m.stagione=socSeasonOf(m.data); });
  (d.deadlines||[]).forEach(x=>{ x.data=sh(x.data); x.fattoIl=sh(x.fattoIl); });
  (d.staff||[]).forEach(x=>['scadenzaTessera','scadenzaVisita','scadenzaQualifica','scadenzaCasellario'].forEach(k=>{ x[k]=sh(x[k]); }));
  (d.inventory||[]).forEach(x=>(x.consegne||[]).forEach(c=>{ c.data=sh(c.data); c.resoIl=sh(c.resoIl); }));
  (d.venues||[]).forEach(v=>{ (v.turni||[]).forEach(t=>{ t.dal=sh(t.dal); t.al=sh(t.al); }); (v.chiusure||[]).forEach(c=>{ c.dal=sh(c.dal); c.al=sh(c.al); }); });
  try{ if(d.settings && d.settings.societa){ const o=JSON.parse(d.settings.societa); (o.pianiQuota||[]).forEach(p=>(p.rate||[]).forEach(r=>{ r.scadenza=sh(r.scadenza); }));
    if(o.preventivi && o.preventivi[s0] && s0!==s1){ o.preventivi[s1]=o.preventivi[s0]; delete o.preventivi[s0]; }
    d.settings.societa=JSON.stringify(o); } }catch(e){}
  return d;
};
const SOC_DEMO_COLS=['athletes','matches','trainings','notes','payments','ledger','deadlines','staff','inventory','venues'];
demoCount = function(){ return SOC_DEMO_COLS.reduce((n,c)=>n+Store.list(c).filter(isDemo).length, 0); };
demoClear = async function(){
  if(!confirm('Togliere tutti i dati di prova (atleti, partite, presenze, note, quote, cassa, scadenze, staff, magazzino e le squadre di prova)? Esercizi e sessioni restano.')) return;
  const dels=SOC_DEMO_COLS.flatMap(c=>Store.list(c).filter(isDemo).map(x=>({c, id:x.id})));
  try{
    await api('POST', '/api/multipli', {items:[], dels});
    const s=Store.getSettings(), body={};
    let L=[]; try{ L=JSON.parse(s.squadre||'[]'); }catch(e){}
    if(Array.isArray(L) && L.some(t=>String(t.id).startsWith('demo-'))){
      const keep=L.filter(t=>!String(t.id).startsWith('demo-'));
      body.squadre = keep.length>1 ? JSON.stringify(keep) : '';
      const base = keep[0] || {}; TEAM_FIELDS.forEach(k=>{ body[k]=base[k]||''; });
      await Store.setMeta('squadraAttiva', keep[0] ? keep[0].id : null);
    }
    if((body.squadra ?? s.squadra)==='Volley Demo') body.squadra='';
    try{ const camp=JSON.parse(body.campionati ?? s.campionati ?? '[]'); if(Array.isArray(camp)) body.campionati=JSON.stringify(camp.filter(c=>!/\(demo\)/.test(c))); }catch(e){}
    try{ if(JSON.parse(s.societa||'{}').ragioneSociale==='A.S.D. Volley Demo') body.societa=''; }catch(e){}
    if(Object.keys(body).length) await Store.api('PUT', '/api/impostazioni', body);
    SOCD=null; await loadState(); applyBrand(); render(); toast('Dati di prova tolti');
  }catch(e){ saveFail(e); }
};

/* ---------------------------------------------------------------- ripartire da zero (solo questo dispositivo) */
function resetBoxHTML(){
  return `<div class="demo-box"><span style="flex:1;min-width:200px">🗑 Vuoi <b>ripartire da zero</b> su questo dispositivo? Cancella tutti i dati che ci sono qui.</span><button class="btn sm danger" data-action="reset-open">Cancella tutto…</button></div>`;
}
function openReset(){
  const c=Sync.config(), coach=typeof isCoach==='function' && isCoach();
  openModal(`<div class="modal-box" style="max-width:580px"><div class="modal-head"><h2 style="flex:1">Cancellare tutto e ripartire da zero?</h2><button class="iconbtn" data-action="close-modal">✕</button></div>
    <div class="modal-body">
      <p style="margin-top:0">Su questo dispositivo vengono cancellati <b>tutti</b> i dati: esercizi, sessioni, atleti, partite, presenze, note, quote, pagamenti, prima nota, scadenze, staff, magazzino e impostazioni. L'app riparte dalla schermata di benvenuto.</p>
      <p>Restano solo la chiave di attivazione e il periodo di prova.</p>
      ${demoCount()?`<div class="warn">Se vuoi togliere solo i dati di prova, chiudi qui e usa <b>«Togli i dati di prova»</b>: esercizi e sessioni restano.</div>`:''}
      ${c?`<div class="warn">Questo dispositivo è collegato all'archivio online <b>${esc(c.owner)}/${esc(c.repo)}</b>: verrà scollegato, ma l'archivio online <b>resta com'è</b>${coach?' (è quello della squadra, lo gestisce la segreteria)':' e gli altri dispositivi non perdono nulla'}. ${coach?'':'Se vuoi ripartire da zero anche online, dopo collega un archivio nuovo e vuoto: quello vecchio ti resta come copia.'}</div>`:''}
      <p class="muted" style="font-size:13.5px">Prima, se vuoi, scarica una copia: potrai sempre reimportarla.</p>
      <label class="f"><span>Per confermare scrivi <b>CANCELLA</b></span><input type="text" id="reset-word" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    </div>
    <div class="modal-foot"><button class="btn" data-action="reset-backup">Scarica prima una copia</button><span style="flex:1"></span><button class="btn" data-action="close-modal">Annulla</button><button class="btn danger-fill" data-action="reset-go">Cancella tutto</button></div></div>`);
}
async function resetGo(){
  if(($('#reset-word').value||'').trim().toUpperCase()!=='CANCELLA'){ alert('Per confermare scrivi CANCELLA nella casella.'); $('#reset-word').focus(); return; }
  const btn=$('[data-action=reset-go]'); btn.disabled=true; btn.textContent='Cancello…';
  try{
    try{ const s=Store.getSettings(); localStorage.setItem('vd-keep', JSON.stringify({provaDal:s.provaDal||'', licenza:s.licenza||''})); }catch(e){}
    if(Sync.config()) await Sync.disconnect();
    await Store.wipe();
    try{ Object.keys(localStorage).filter(k=>k.startsWith('vd-') && !['vd-keep','vd-visto','vd-prova','vd-theme'].includes(k)).forEach(k=>localStorage.removeItem(k)); }catch(e){}
    location.reload();
  }catch(e){ alert('Non sono riuscito a cancellare tutto: '+(e.message||e)+'\n\nChiudi le altre schede di Volleydesk e riprova.'); btn.disabled=false; btn.textContent='Cancella tutto'; }
}
/* il periodo di prova e la chiave non si perdono ripartendo da zero */
licInit = async function(){
  let keep={}, prova=''; try{ keep=JSON.parse(localStorage.getItem('vd-keep')||'{}')||{}; prova=localStorage.getItem('vd-prova')||''; }catch(e){}
  let changed=false;
  if(!db.settings.provaDal){ db.settings.provaDal=[keep.provaDal, prova].filter(Boolean).sort()[0] || todayISO(); changed=true; }
  if(!db.settings.licenza && keep.licenza){ db.settings.licenza=keep.licenza; changed=true; }
  if(changed) await persist.settings().catch(()=>{});
  try{ const first=[prova, db.settings.provaDal].filter(Boolean).sort()[0]; localStorage.setItem('vd-prova', first); localStorage.removeItem('vd-keep'); }catch(e){}
  await licRefresh();
};
Object.assign(actions, {
  'reset-open': ()=>openReset(),
  'reset-backup': ()=>exportBackup(),
  'reset-go': ()=>resetGo()
});
