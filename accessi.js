"use strict";
/* ==================================================================
   Volleydesk – accessi per ruolo, senza server
   - La SEGRETERIA collega l'archivio della società (tutti i dati) e, per
     ogni squadra, un archivio privato a parte. Il suo dispositivo copia in
     ciascuno solo le schede di quella squadra, senza quote né dati sensibili,
     e riporta nell'archivio della società le modifiche degli allenatori.
   - L'ALLENATORE collega solo l'archivio della sua squadra, con un codice
     di accesso valido unicamente per quello: GitHub gli impedisce di aprire
     gli altri. La sua app non mostra la sezione Società.
   ================================================================== */

/* campi dell'atleta che restano solo alla segreteria */
const ACC_HIDDEN = ['codiceFiscale', 'cfGenitore', 'indirizzo', 'luogoNascita', 'email', 'emailGenitore', 'privacy'];
/* impostazioni che ogni archivio di squadra riceve */
const ACC_SET_EXTRA = ['licenza', 'provaDal', 'noteGenerali'];

const accAmbito = () => Store.getMeta('ambito') || null;
const isCoach = () => (accAmbito() || {}).tipo === 'squadra';
function accRaw(){ try{ const v=JSON.parse((db.settings && db.settings.accessi) || '{}'); return v && typeof v==='object' ? v : {}; }catch(e){ return {}; } }
async function accSet(id, val){ const v=accRaw(); if(val) v[id||'_']=val; else delete v[id||'_']; db.settings.accessi=JSON.stringify(v); await persist.settings(); }
/* le squadre della società: con una squadra sola l'identificativo è '' */
function accTeams(){ const L=teamsRaw(); return L.length ? L.map((t,i)=>({id:t.id, nome:teamLabel(t,i)})) : [{id:'', nome:db.settings.squadra||'La squadra'}]; }
function accStoreSettings(){ return Store.getSettings(); }
function accTeamSettings(id){
  const s=accStoreSettings(), o={};
  let L=[]; try{ L=JSON.parse(s.squadre||'[]'); }catch(e){}
  const t=Array.isArray(L) && L.length>1 ? L.find(x=>x.id===id) : null;
  TEAM_FIELDS.forEach(k=>{ o[k]=t ? (t[k]||'') : (s[k]||''); });
  ACC_SET_EXTRA.forEach(k=>{ o[k]=s[k]||''; });
  if(t && !o.squadra) o.squadra=accTeams().find(x=>x.id===id)?.nome||'';
  return o;
}

/* ---------------------------------------------------------------- regole per la sincronizzazione (usate da sync.js) */
Sync.setHub({
  teams(){
    if(isCoach()) return [];
    const A=accRaw();
    return accTeams().map(t=>Object.assign({}, t, A[t.id||'_']||{})).filter(t=>t.repo);
  },
  belongs(c, r, id){
    if(c==='exercises' || c==='sessions') return true;
    if(c==='athletes') return !r.cestino && atTeams(r).includes(id);   // chi è nel cestino esce dalla squadra
    return recTeam(r)===id;
  },
  strip(c, r){
    const o=Object.assign({}, r); delete o._m;
    if(c==='athletes') ACC_HIDDEN.forEach(k=>delete o[k]);
    return o;
  },
  adopt(c, r, local, id){
    const o=Object.assign({}, local||{}, r);
    if(c==='athletes'){
      if(local){ ACC_HIDDEN.forEach(k=>{ o[k]=local[k]; }); o.squadre=local.squadre||[]; }
      else o.squadre = id ? [id] : [];
    } else if(['matches','trainings','notes'].includes(c) && id) o.squadra=id;
    o._m=r._m;
    return o;
  },
  /* l'allenatore ha eliminato una scheda: un atleta resta alla società se è anche in un'altra squadra o ha delle quote */
  coachDelete(c, l, id){
    if(c!=='athletes') return null;
    const teams=atTeams(l).filter(x=>x!==id), hasPay=Store.list('payments').some(p=>p.atletaId===l.id);
    if(teams.length && teamsRaw().length) return Object.assign({}, l, {squadre:teams, _m:Store.stamp()});
    if(hasPay) return Object.assign({}, l, {iscritto:false, _m:Store.stamp()});
    return null;
  },
  teamSettings: id => accTeamSettings(id),
  settingsKey: id => { const o=accTeamSettings(id); return Object.keys(o).map(k=>k+'='+String(o[k]).length+':'+String(o[k]).slice(0,40)).join('|'); },
  async setTeamSettings(id, patch){
    const s=accStoreSettings(), body={};
    let L=[]; try{ L=JSON.parse(s.squadre||'[]'); }catch(e){}
    const multi=Array.isArray(L) && L.length>1, t=multi ? L.find(x=>x.id===id) : null;
    for(const [k,v] of Object.entries(patch)){
      if(TEAM_FIELDS.includes(k) && t) t[k]=v; else body[k]=v;
    }
    if(t) body.squadre=JSON.stringify(L);
    await Store.api('PUT', '/api/impostazioni', body);
    if(typeof refreshFromRemote==='function') refreshFromRemote();
  }
});

/* ---------------------------------------------------------------- modalità allenatore */
const _accTeamPanel = teamPanelHTML;
teamPanelHTML = function(){
  if(!isCoach()) return _accTeamPanel();
  const a=accAmbito();
  return `<div class="panel" id="team-panel"><h2>Archivio della squadra</h2>
    <p style="margin-top:0;font-size:14px">Questo dispositivo è collegato all'archivio della squadra <b>${esc(a.nome||'')}</b>, gestito dalla segreteria della società. Vedi gli atleti, le partite, le presenze e le note di questa squadra; quote, pagamenti e dati personali come codice fiscale e indirizzo restano alla segreteria.</p>
    <p class="muted" style="font-size:13px;margin-bottom:0">Le tue modifiche arrivano alla società quando la segreteria apre Volleydesk.</p></div>`;
};
const _accSyncPanel = syncPanelHTML;
syncPanelHTML = function(){
  let h=_accSyncPanel();
  if(isCoach()) h=h.replace('nel tuo archivio privato su GitHub', 'nell\'archivio della squadra <b>«'+esc((accAmbito()||{}).nome||'')+'»</b> su GitHub').replace(/quelle fatte sull'altro dispositivo arrivano/, 'quelle della segreteria e degli altri tuoi dispositivi arrivano');
  if(!isCoach() && Sync.config()){
    const T=accTeams(), A=accRaw(), S=Sync.teamStatus(), on=T.filter(t=>(A[t.id||'_']||{}).repo);
    if(on.length) h=h.replace('<div class="sync-box" id="sync-status">', `<div class="acc-mini">${on.map(t=>accStatusHTML(t, S[t.id], A[t.id||'_'])).join('')}<button class="btn sm ghost" data-action="soc-tab" data-t="accessi">Accessi →</button></div><div class="sync-box" id="sync-status">`);
  }
  return h;
};
function accStatusHTML(t, st, cfgT, noName){
  const s=st||{}, ic=s.status==='ok'?'✓':s.status==='syncing'?'↻':s.status==='error'?'⚠':s.status==='offline'?'⏸':'•';
  const cls=s.status==='error'?'bad':s.status==='ok'?'ok':'';
  const txt=s.status==='ok'?'aggiornato '+fmtAgo(s.at):s.status==='syncing'?'in aggiornamento…':s.status==='error'?(s.msg||'errore'):s.status==='offline'?'senza connessione':'in attesa';
  return `<span class="acc-st ${cls}" title="${esc(cfgT?((cfgT.owner?cfgT.owner+'/':'')+cfgT.repo):'')}"><b>${ic}${noName?'':' '+esc(t.nome)}</b> <small>${esc(txt)}</small></span>`;
}
Sync.onStatus(()=>{ const el=$('#acc-list'); if(el && ui.view==='societa' && ui.socTab==='accessi' && !$('#acc-list input:focus')) el.innerHTML=accListHTML(); });

/* ---------------------------------------------------------------- scheda «Accessi» nella sezione Società */
SOC_TABS.push(['accessi','Accessi']);
const _accViewSocieta = viewSocieta;
viewSocieta = function(){
  if(isCoach()){ setTimeout(()=>go('home'), 0); return ''; }
  if(ui.socTab!=='accessi') return _accViewSocieta();
  const html=_accViewSocieta.call(null);   // intestazione e schede; il corpo lo sostituiamo
  return html.replace(/(<\/nav>)[\s\S]*(<\/section>)$/, `$1${accHTML()}$2`);
};
function accHTML(){
  const c=Sync.config(), me=(Store.getMeta('syncCfg')||{}).owner||'';
  return `<div class="panel"><h2>Un archivio per ogni squadra</h2>
    <p style="margin-top:0">Ogni allenatore collega la sua app solo all'archivio della propria squadra, con un codice di accesso che vale soltanto lì. Vede atleti, partite, presenze e note della sua squadra, ed esercizi e sessioni comuni. <b>Non vede</b> quote, cassa, scadenze della società, staff, magazzino, le altre squadre, né codice fiscale, indirizzo, email e privacy degli atleti.</p>
    <p class="muted" style="font-size:13.5px;margin-bottom:0">Questo dispositivo fa da tramite: ogni volta che sincronizza aggiorna gli archivi delle squadre e riporta qui le modifiche degli allenatori. Se la segreteria usa più dispositivi, vanno bene tutti.</p></div>
  ${!c?`<div class="warn">Prima collega l'archivio della società in <a href="#" data-nav="impostazioni">Archivio → Sincronizzazione online</a>.</div>`:''}
  <div class="panel"><h2>Squadre</h2><div id="acc-list">${accListHTML()}</div></div>
  <div class="panel"><h2>Come si prepara (una volta per squadra, dal computer)</h2>
    <ol class="steps">
      <li>Su GitHub crea un archivio nuovo e vuoto: <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>, per esempio <code>volleydesk-u14</code>, <b>Private</b>.</li>
      <li>Dai accesso anche al codice della segreteria: apri <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a>, scegli il codice che usi in Volleydesk → <b>Edit</b> → Repository access → aggiungi il nuovo archivio → «Update».</li>
      <li>Qui sopra scrivi il nome dell'archivio accanto alla squadra e premi <b>Collega</b>.</li>
      <li>Crea il codice per l'allenatore: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">nuovo codice</a> · Nome: <code>Volleydesk – allenatore U14</code> · Repository access: <b>Only select repositories</b> → <b>solo</b> l'archivio della squadra · Permissions → <b>Contents: Read and write</b> · «Generate token».</li>
      <li>Premi <b>Istruzioni per l'allenatore</b> e mandagli il messaggio; il codice mandaglielo a parte (meglio a voce o con un messaggio che poi cancelli).</li>
    </ol>
    <p class="muted" style="font-size:13px;margin-bottom:0">Per togliere l'accesso a un allenatore elimina il suo codice da <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a>: da quel momento la sua app non riceve né invia più nulla. Gli allenatori non hanno bisogno di un account GitHub.</p></div>`;
}
function accListHTML(){
  const A=accRaw(), S=Sync.teamStatus(), me=(Store.getMeta('syncCfg')||{}).owner||'';
  return accTeams().map(t=>{ const k=t.id||'_', cf=A[k]||{}, st=S[t.id];
    return `<div class="acc-row" data-team="${esc(k)}"><div class="nm"><b>${esc(t.nome)}</b>${cf.repo?accStatusHTML(t, st, cf, true):'<small class="muted">nessun archivio: l\'allenatore non ha accesso</small>'}</div>
      <label class="f">Archivio della squadra<span class="sd-inl"><input type="text" data-acc="${esc(k)}" value="${esc(cf.repo?((cf.owner&&cf.owner!==me?cf.owner+'/':'')+cf.repo):'')}" placeholder="es. volleydesk-${esc(accSlug(t.nome))}" autocapitalize="off" spellcheck="false"></span></label>
      <div class="actions">${cf.repo?`<button class="btn sm" data-action="acc-msg" data-team="${esc(k)}">Istruzioni per l'allenatore</button><button class="btn sm danger" data-action="acc-off" data-team="${esc(k)}">Scollega</button>`:''}<button class="btn sm primary" data-action="acc-save" data-team="${esc(k)}">${cf.repo?'Salva':'Collega'}</button></div></div>`; }).join('');
}
const accSlug = s => String(s||'squadra').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30) || 'squadra';
async function accSave(k){
  const inp=document.querySelector(`[data-acc="${CSS.escape(k)}"]`); let v=(inp&&inp.value||'').trim().replace(/^https?:\/\/github\.com\//,'').replace(/\.git$/,'').replace(/\/$/,'');
  const id=k==='_'?'':k, t=accTeams().find(x=>x.id===id); if(!t) return;
  if(!v){ alert("Scrivi il nome dell'archivio della squadra."); return; }
  if(!Sync.config()){ alert("Prima collega l'archivio della società (Archivio → Sincronizzazione online)."); return; }
  const parts=v.split('/'), val=parts.length>1?{owner:parts[0], repo:parts[1]}:{repo:parts[0]};
  const btn=document.querySelector(`[data-action=acc-save][data-team="${CSS.escape(k)}"]`); if(btn){ btn.disabled=true; btn.textContent='Controllo…'; }
  try{ await Sync.checkTeamRepo(Object.assign({id, nome:t.nome}, val)); }
  catch(e){ alert('Non riesco a usare questo archivio.\n\n'+(e.message||e)+(e.status===404?"\n\nControlla il nome e di aver aggiunto l'archivio al codice di accesso della segreteria (passo 2 qui sotto).":'')); if(btn){ btn.disabled=false; btn.textContent='Collega'; } return; }
  await accSet(id, val); toast('Archivio collegato: lo preparo adesso'); render(); Sync.run();
}
function accCoachMsg(k){
  const id=k==='_'?'':k, t=accTeams().find(x=>x.id===id), cf=accRaw()[k]||{}, owner=cf.owner||(Store.getMeta('syncCfg')||{}).owner||'';
  const url=location.href.split('#')[0].split('?')[0];
  return `Ciao! Per la squadra ${t?t.nome:''} usiamo Volleydesk: presenze, convocazioni, partite e sessioni di allenamento.\n\n1. Apri ${url} (sul telefono puoi aggiungerla alla schermata Home).\n2. Scegli «Collego il mio archivio online» (oppure Archivio → Sincronizzazione online).\n3. Scrivi:\n   • Nome utente GitHub: ${owner}\n   • Nome dell'archivio dati: ${cf.repo||''}\n   • Codice di accesso: te lo mando a parte\n4. Premi «Collega».\n\nVedrai solo i dati della tua squadra. Le modifiche arrivano alla società in automatico.`;
}
Object.assign(actions, {
  'acc-save': b=>accSave(b.dataset.team),
  'acc-off': async b=>{ const k=b.dataset.team, id=k==='_'?'':k; if(!confirm("Scollegare l'archivio di questa squadra? L'archivio su GitHub resta com'è, ma non verrà più aggiornato. Per togliere l'accesso all'allenatore elimina anche il suo codice su GitHub.")) return;
    await accSet(id, null); await Store.setMeta('teamSync:'+id, null); toast('Archivio scollegato'); render(); },
  'acc-msg': b=>{ const txt=accCoachMsg(b.dataset.team);
    openModal(`<div class="modal-box" style="max-width:560px"><div class="modal-head"><h2 style="flex:1">Istruzioni per l'allenatore</h2><button class="iconbtn" data-action="close-modal">✕</button></div>
      <div class="modal-body"><textarea id="acc-txt" rows="13" style="width:100%">${esc(txt)}</textarea><p class="muted" style="font-size:12.5px;margin-bottom:0">Il codice di accesso non è nel messaggio: mandalo a parte.</p></div>
      <div class="modal-foot"><span style="flex:1"></span><button class="btn" data-action="acc-copy">Copia</button><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a></div></div>`); },
  'acc-copy': ()=>copyText($('#acc-txt').value)
});

/* nasconde la sezione Società sul dispositivo dell'allenatore */
const _accSocHomeTile = socHomeTile, _accSocHomeRem = socHomeRem, _accSocAtForm = socAtFormHTML;
socHomeTile = function(){ return isCoach() ? null : _accSocHomeTile(); };
socHomeRem = function(){ return isCoach() ? [] : _accSocHomeRem(); };
socAtFormHTML = function(a){
  if(!isCoach()) return _accSocAtForm(a);
  const v=k=>esc(a[k]||'');
  return `<div class="atf"><h3>Famiglia e tesseramento</h3><div class="atf-g">
      <label class="f">Genitore<input type="text" name="genitore" value="${v('genitore')}"></label>
      <label class="f">Cellulare del genitore<input type="tel" name="telGenitore" value="${v('telGenitore')}"></label>
      <label class="f">N° tessera<input type="text" name="tessera" value="${v('tessera')}"></label>
      <label class="f">Scadenza tessera<input type="date" name="scadenzaTessera" value="${v('scadenzaTessera')}"></label>
      <div class="f w3"><label class="sw"><input type="checkbox" name="consensoFoto" ${a.consensoFoto?'checked':''}> Consenso a foto e video</label></div></div></div>`;
};
