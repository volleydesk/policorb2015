"use strict";
/* ==================================================================
   Volleydesk – menu a tendina per cambiare squadra
   Una striscia sopra ogni pagina (Atleti, Presenze, Partite, Società…)
   con la squadra in uso: cambiandola si resta sulla stessa pagina.
   ================================================================== */
const TEAM_BAR_HIDE = ['live', 'referto', 'allena', 'benvenuto', 'guida'];
/* pagine che appartengono a una sola partita/allenamento: cambiando squadra si torna all'elenco */
const TEAM_BAR_BACK = { partita: 'partite', pgs: 'partite' };

function renderTeamBar(){
  let bar = $('#team-bar');
  if(!bar){
    bar = document.createElement('div'); bar.id = 'team-bar'; bar.className = 'team-bar hidden';
    $('#app').before(bar);
    bar.addEventListener('change', e => { if(e.target.id === 'team-sel') teamQuickSwitch(e.target.value); });
  }
  const show = teamMulti() && !(typeof isCoach === 'function' && isCoach()) && !TEAM_BAR_HIDE.includes(ui.view) && !licLocked();
  bar.classList.toggle('hidden', !show);
  if(!show){ bar.innerHTML = ''; return; }
  const cur = teamCur(), L = teamsRaw();
  const note = ui.view === 'societa' ? '<span class="tb-note">La sezione Società vale per tutte le squadre</span>'
    : ['esercizi', 'esercizio', 'sessioni', 'sessione'].includes(ui.view) ? '<span class="tb-note">Esercizi e sessioni sono in comune</span>' : '';
  bar.innerHTML = `<label class="tb"><span>Squadra</span><select id="team-sel" aria-label="Squadra in uso">${L.map((t,i)=>`<option value="${esc(t.id)}" ${t.id===cur?'selected':''}>${esc(teamLabel(t,i))}</option>`).join('')}<option value="__new">＋ Nuova squadra…</option></select></label>${note}`;
}
async function teamQuickSwitch(id){
  if(id === '__new'){ renderTeamBar(); teamAdd(); return; }
  if(id === teamCur()) return;
  if(ui.dirty && !confirm('Ci sono modifiche non salvate. Cambiare squadra senza salvare?')){ renderTeamBar(); return; }
  ui.dirty = false;
  if(typeof flushPending === 'function') flushPending();
  await Store.setMeta('squadraAttiva', id); await loadState(); applyBrand();
  const v = TEAM_BAR_BACK[ui.view] || ui.view;
  ui.matchId = null; NAV.stack = [];
  if(v !== ui.view) go(v); else { closeModal(); render(); }
  toast('Squadra: ' + (db.settings.squadra || ''));
}
const _tbRender = render;
render = function(){ _tbRender(); renderTeamBar(); };
