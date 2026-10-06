"use strict";
/* ==================================================================
   Volleydesk – promemoria automatici via email (senza server)
   Un'azione programmata di GitHub, nell'archivio privato della società,
   gira ogni mattina: legge dati.json e manda le email (rate in arrivo,
   rate scadute, visite mediche, riepilogo settimanale alla segreteria).
   Qui si configura, si vede l'anteprima di oggi e si installa con un tocco.
   ================================================================== */
const PROM_DEF = { attivo: true, prima: 3, scadute: true, ogni: 7, max: 3, visite: true, visiteGiorni: 15, riepilogo: true, giornoRiepilogo: 1, emailSegreteria: '', firma: '' };
const PROM_FILES = [['promemoria/promemoria.py', 'promemoria/promemoria.py'], ['promemoria/volleydesk-promemoria.yml', '.github/workflows/volleydesk-promemoria.yml']];
function promCfg(){ let v = {}; try{ v = JSON.parse((db.settings && db.settings.promemoria) || '{}') || {}; }catch(e){} return Object.assign({}, PROM_DEF, v); }
async function promSet(patch){ let v = {}; try{ v = JSON.parse(db.settings.promemoria || '{}') || {}; }catch(e){} Object.assign(v, patch); db.settings.promemoria = JSON.stringify(v); await persist.settings(); }

/* stessa logica di promemoria.py, per l'anteprima */
function promValida(m){ m = String(m || '').trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) && !/@esempio\.it$|\.example$|@example\./i.test(m) ? m : ''; }
function promPayer(a){ const age = ageOf(a); if((age !== null && age < 18) || a.genitore) return { nome: a.genitore || [a.nome, a.cognome].join(' '), email: promValida(a.emailGenitore) || promValida(a.email) };
  return { nome: [a.nome, a.cognome].join(' '), email: promValida(a.email) || promValida(a.emailGenitore) }; }
function promCompute(reg){
  const cfg = promCfg(), inv = (reg && reg.inviati) || {}, td = todayISO(), out = [], skip = [];
  const at = new Map(Store.list('athletes').map(a => [a.id, a]));
  const per = new Map();
  Store.list('payments').forEach(p => {
    if(p.annullata || String(p.id).startsWith('demo-')) return;
    const due = payDue(p); if(due <= 0 || !p.scadenza) return;
    const gg = daysTo(p.scadenza), kp = `pre:${p.id}:${p.scadenza}`, ks = `sca:${p.id}`; let tipo = null;
    if(cfg.prima && gg >= 0 && gg <= +cfg.prima && !inv[kp]) tipo = 'pre';
    else if(cfg.scadute && gg < 0){ const st = inv[ks] || []; if(st.length < +cfg.max && (!st.length || -daysTo(st[st.length - 1]) >= +cfg.ogni)) tipo = 'sca'; }
    if(tipo){ if(!per.has(p.atletaId)) per.set(p.atletaId, []); per.get(p.atletaId).push({ tipo, p, due }); }
  });
  per.forEach((L, aid) => { const a = at.get(aid); if(!a) return; const pr = promPayer(a), nm = [a.nome, a.cognome].join(' ');
    if(!pr.email){ skip.push(`${fullName(a)}: ${L.length} rat${L.length === 1 ? 'a' : 'e'} da ricordare, ma manca l'email`); return; }
    out.push({ a: pr.email, t: L.some(x => x.tipo === 'sca') ? `Promemoria: quota di ${nm} da versare` : `Quota di ${nm} in scadenza`, s: L.map(x => `${payDesc(x.p)} ${eur(x.due)}${x.tipo === 'sca' ? ' (scaduta)' : ' (scade il ' + shortDate(x.p.scadenza) + ')'}`).join(' · ') }); });
  if(cfg.visite) at.forEach(a => { if(!a.iscritto || !a.scadenzaVisita || String(a.id).startsWith('demo-')) return; const gg = daysTo(a.scadenzaVisita);
    if(gg > +cfg.visiteGiorni || gg < -30 || inv[`vis:${a.id}:${a.scadenzaVisita}`]) return; const pr = promPayer(a);
    if(!pr.email){ skip.push(`${fullName(a)}: visita medica ${gg < 0 ? 'scaduta' : 'in scadenza'}, ma manca l'email`); return; }
    out.push({ a: pr.email, t: `Visita medica di ${[a.nome, a.cognome].join(' ')} ${gg < 0 ? 'scaduta' : 'in scadenza'}`, s: (gg < 0 ? 'scaduta il ' : 'scade il ') + shortDate(a.scadenzaVisita) }); });
  const seg = promValida(cfg.emailSegreteria) || promValida(socCfg().email), dow = (new Date().getDay() || 7);
  if(cfg.riepilogo && seg && dow === +cfg.giornoRiepilogo) out.push({ a: seg, t: 'Riepilogo settimanale – ' + socName(), s: 'rate scadute, scadenze della società, visite e staff' });
  return { out, skip, seg };
}

/* ---------------------------------------------------------------- scheda «Promemoria» */
SOC_TABS.splice(SOC_TABS.findIndex(t => t[0] === 'dati'), 0, ['promemoria', 'Promemoria']);
const _promViewSocieta = viewSocieta;
viewSocieta = function(){
  if(ui.socTab !== 'promemoria') return _promViewSocieta();
  if(!ui.promStato && Sync.config() && !ui.promLoading) promLoad();
  const html = _promViewSocieta.call(null);
  return html.replace(/(<\/nav>)[\s\S]*(<\/section>)$/, `$1${promHTML()}$2`);
};
async function promLoad(){
  ui.promLoading = true;
  try{
    const [py, reg] = await Promise.all([Sync.getFile('promemoria/promemoria.py'), Sync.getFile('promemoria/registro.json')]);
    const yml = await Sync.getFile('.github/workflows/volleydesk-promemoria.yml');
    let r = null; try{ r = reg ? JSON.parse(reg.text) : null; }catch(e){}
    ui.promStato = { ok: true, py: py ? (/versione:\s*(\d+)/.exec(py.text) || [])[1] || '?' : null, yml: !!yml, reg: r };
  }catch(e){ ui.promStato = { ok: false, err: e.message || String(e) }; }
  ui.promLoading = false;
  if(ui.view === 'societa' && ui.socTab === 'promemoria'){ const y = window.scrollY; render(); window.scrollTo(0, y); }
}
function promHTML(){
  const c = promCfg(), S = ui.promStato, sync = Sync.config(), P = promCompute(S && S.reg);
  const inst = S && S.ok && S.py && S.yml, repo = sync ? `https://github.com/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}` : '';
  const num = (k, l, min, max) => `<label class="f">${l}<input type="number" min="${min}" max="${max}" data-prom="${k}" value="${esc(c[k])}"></label>`;
  const chk = (k, l) => `<label class="sw"><input type="checkbox" data-prom="${k}" ${c[k] ? 'checked' : ''}> ${l}</label>`;
  const last = S && S.reg && S.reg.ultimi ? S.reg.ultimi.slice(-12).reverse() : [];
  return `<div class="panel"><h2>Promemoria automatici via email</h2>
    <p style="margin-top:0">Ogni mattina GitHub controlla i dati della società e manda da solo le email: alle famiglie per le <b>rate in arrivo</b> e quelle <b>scadute</b>, e per le <b>visite mediche</b> in scadenza; alla segreteria un <b>riepilogo settimanale</b>. Funziona anche se nessuno apre l'app; ognuno riceve ogni avviso una volta sola.</p>
    ${!sync ? `<div class="warn">Prima collega l'archivio della società in <a href="#" data-nav="impostazioni">Archivio → Sincronizzazione online</a>.</div>`
      : !S ? '<p class="muted">Controllo l\'archivio…</p>'
      : !S.ok ? `<div class="warn">Non riesco a leggere l'archivio: ${esc(S.err)}</div>`
      : inst ? `<div class="prom-st ok"><b>✓ Installati</b> nell'archivio <span class="mono">${esc(sync.owner)}/${esc(sync.repo)}</span>${S.reg && S.reg.ultimaEsecuzione ? ' · ultimo invio ' + esc(new Date(S.reg.ultimaEsecuzione).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : ' · non hanno ancora inviato nulla'}${S.py !== '1' ? '' : ''}<span style="flex:1"></span><a class="btn sm" href="${repo}/actions" target="_blank" rel="noopener">Esecuzioni su GitHub</a><button class="btn sm" data-action="prom-install">Aggiorna i file</button></div>`
      : `<div class="prom-st"><b>Non ancora installati.</b><span style="flex:1"></span><button class="btn primary" data-action="prom-install">Installa nell'archivio su GitHub</button></div>`}
  </div>
  <div class="panel"><h2>Cosa mandare</h2><div class="grid g3">
    <div class="f span2">${chk('attivo', '<b>Promemoria attivi</b>')}</div><div></div>
    ${chk('prima', 'Avvisa prima della scadenza di una rata')}${num('prima', 'Quanti giorni prima', 1, 30)}<div></div>
    ${chk('scadute', 'Sollecita le rate scadute')}${num('ogni', 'Ripeti ogni (giorni)', 1, 60)}${num('max', 'Al massimo (volte)', 1, 10)}
    ${chk('visite', 'Avvisa per le visite mediche')}${num('visiteGiorni', 'Quanti giorni prima', 1, 60)}<div></div>
    ${chk('riepilogo', 'Riepilogo settimanale alla segreteria')}<label class="f">Giorno<select data-prom="giornoRiepilogo">${['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'].map((g, i) => `<option value="${i + 1}" ${+c.giornoRiepilogo === i + 1 ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    <label class="f">Email della segreteria<input type="email" data-prom="emailSegreteria" value="${esc(c.emailSegreteria || socCfg().email || '')}"></label>
    <label class="f span2">Firma in fondo alle email<input type="text" data-prom="firma" value="${esc(c.firma)}" placeholder="${esc(socCfg().firma || 'La segreteria di ' + socName())}"></label>
  </div><p class="muted" style="font-size:12.5px;margin:8px 0 0">Le email vanno al genitore per i minorenni (o a chi paga) e all'atleta per gli adulti: servono gli indirizzi nella scheda dell'atleta. Le risposte arrivano all'email della segreteria. Le modifiche valgono dalla prossima sincronizzazione.</p></div>
  <div class="panel"><h2>Anteprima: cosa partirebbe oggi</h2>
    ${P.out.length ? `<div class="sd-list">${P.out.map(m => `<div class="prom-m"><b>${esc(m.t)}</b><small>a ${esc(m.a)} · ${esc(m.s)}</small></div>`).join('')}</div>` : '<p class="muted" style="margin:0">Oggi nessuna email.</p>'}
    ${P.skip.length ? `<details style="margin-top:10px"><summary class="sd-red" style="cursor:pointer;font-weight:700">${P.skip.length === 1 ? '1 avviso' : P.skip.length + ' avvisi'} senza indirizzo email</summary><ul class="prom-skip">${P.skip.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
    ${!c.attivo ? '<p class="sd-red" style="margin:8px 0 0">I promemoria sono disattivati: non parte niente.</p>' : ''}</div>
  ${last.length ? `<div class="panel"><h2>Ultimi invii</h2><div class="sd-list">${last.map(m => `<div class="prom-m"><b>${esc(m.oggetto)}</b><small>${shortDate(m.data)} · a ${esc(m.a)}</small></div>`).join('')}</div></div>` : ''}
  <div class="panel"><h2>Come si attiva (una volta sola, dal computer)</h2>
    <ol class="steps">
      <li><b>Permesso per installare</b>: apri <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">i tuoi codici di accesso</a>, scegli quello di Volleydesk → <b>Edit</b> → Permissions → aggiungi <b>Workflows: Read and write</b> → «Update». Poi premi <b>Installa</b> qui sopra.</li>
      <li><b>Casella di posta che spedisce</b>: va bene un Gmail della società. Attiva la verifica in due passaggi e crea una <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">password per le app</a> (16 lettere).</li>
      <li><b>Dai a GitHub i dati della casella</b>: ${repo ? `<a href="${repo}/settings/secrets/actions" target="_blank" rel="noopener">impostazioni segrete dell'archivio</a>` : 'nell\'archivio dati, Settings → Secrets and variables → Actions'} → «New repository secret»: <code>SMTP_USER</code> = l'indirizzo Gmail, <code>SMTP_PASSWORD</code> = la password per le app. Con un altro provider aggiungi anche <code>SMTP_HOST</code> e <code>SMTP_PORT</code>.</li>
      <li><b>Prova</b>: ${repo ? `<a href="${repo}/actions" target="_blank" rel="noopener">pagina Actions</a>` : 'pagina Actions dell\'archivio'} → «Promemoria Volleydesk» → <b>Run workflow</b> con «Prova» spuntato: tutte le email di oggi arrivano solo alla segreteria, con [PROVA] nell'oggetto.</li>
    </ol>
    <p class="muted" style="font-size:12.5px;margin-bottom:0">GitHub esegue l'azione gratis (sono pochi secondi al giorno, ben dentro i minuti inclusi negli account gratuiti). Per fermare tutto togli la spunta «Promemoria attivi» oppure disattiva l'azione dalla pagina Actions.</p></div>`;
}
async function promInstall(){
  if(!Sync.config()){ alert("Prima collega l'archivio della società."); return; }
  const btn = $('[data-action=prom-install]'); if(btn){ btn.disabled = true; btn.textContent = 'Installo…'; }
  try{
    for(const [src, dst] of PROM_FILES){
      const r = await fetch(src + '?fresh=' + Date.now(), { cache: 'no-store' }).catch(() => null) || await caches.match(src, { ignoreSearch: true });
      if(!r || !r.ok) throw new Error('Non trovo il file ' + src + ' dell\'app. Controlla la connessione.');
      await Sync.putFile(dst, await r.text(), 'Promemoria automatici di Volleydesk');
    }
    ui.promStato = null; toast('Promemoria installati'); Sync.run();
  }catch(e){
    const perm = e.status === 403 || e.status === 404 || /workflow/i.test(e.message || '');
    alert('Installazione non riuscita.\n\n' + (perm ? 'Il codice di accesso non ha il permesso di creare le azioni di GitHub: aggiungi «Workflows: Read and write» al codice (passo 1 delle istruzioni) e riprova.' : (e.message || e)));
  }
  if(btn){ btn.disabled = false; } render();
}
Object.assign(actions, { 'prom-install': () => promInstall() });
document.addEventListener('change', async e => {
  const t = e.target; if(!t.dataset.prom) return;
  const k = t.dataset.prom; let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(+t.min || 0, Math.min(+t.max || 99, parseInt(t.value, 10) || 0)) : t.value.trim();
  if(t.type === 'checkbox' && k === 'prima') v = t.checked ? (promCfg().prima || 3) : 0;
  await promSet({ [k]: k === 'giornoRiepilogo' ? +v : v });
  const y = window.scrollY; render(); window.scrollTo(0, y);
});

/* guida */
GUIDE.splice(4, 0,
['📥','Importare da Excel o CSV',`
<p>Se hai già gli atleti (o le quote, o la prima nota) in un foglio di calcolo: in <b>Atleti</b>, <b>Società → Quote</b> o <b>Società → Prima nota</b> premi <b>📥 Importa</b>.</p>
<ol><li>Scegli il file (.xlsx, .xls o .csv) oppure copia le righe da Excel e incollale.</li>
<li>L'app riconosce le colonne dai titoli (Cognome, Nome, Data di nascita, Codice fiscale, Genitore…): controlla gli abbinamenti e correggi dove serve.</li>
<li>Guarda l'anteprima (nuovi, da aggiornare, righe scartate e perché) e premi <b>Importa</b>.</li></ol>
<p>Gli atleti già presenti vengono riconosciuti dal codice fiscale o da nome e cognome e solo completati, senza cancellare niente. Dal codice fiscale l'app ricava sesso e data di nascita se mancano. Con <b>Scarica un modello</b> hai un file già pronto da compilare.</p>`],
['📝','Iscrizioni online delle famiglie',`
<p>In <b>Società → Iscrizioni online</b> premi <b>Prepara il modulo</b> e manda il link alle famiglie (WhatsApp, email, sito).</p>
<ol><li>La famiglia compila il modulo dal telefono: dati dell'atleta, genitore, consensi privacy e foto, firma.</li>
<li>Premendo <b>Invia con WhatsApp</b> (o email) ti arriva un messaggio con un codice <code>VDI1-…</code>: i dati sono cifrati e solo la tua app li legge.</li>
<li>Copia il messaggio, incollalo in <b>Iscrizioni ricevute</b> e premi <b>Leggi</b>: con un tocco l'atleta entra in anagrafica (o aggiorni la sua scheda) e, se vuoi, gli assegni subito la quota.</li></ol>
<p>Non serve nessun server: il modulo è una pagina dell'app e i dati passano solo dal telefono della famiglia al tuo. Il certificato medico va consegnato a parte.</p>`],
['📧','Promemoria automatici via email',`
<p>In <b>Società → Promemoria</b> scegli cosa mandare: avviso qualche giorno prima della scadenza di una rata, solleciti per le rate scadute (ogni quanti giorni e quante volte), avvisi per le visite mediche e un riepilogo settimanale per la segreteria.</p>
<p>Le email le manda GitHub ogni mattina, anche se nessuno apre l'app. Per attivarle (una volta sola) segui i quattro passi scritti in quella pagina: permesso per installare, una casella Gmail della società con la «password per le app», i dati della casella nei «secrets» dell'archivio, e una prova.</p>
<p>L'<b>anteprima</b> mostra cosa partirebbe oggi e chi non riceverà nulla perché manca l'email.</p>`]);
