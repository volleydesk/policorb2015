"use strict";
/* ==================================================================
   Volleydesk – documenti allegati
   Certificati medici, privacy firmate, tessere, contratti, fatture,
   statuto, verbali… collegati a un atleta, a una persona dello staff,
   a un movimento di prima nota o alla società.
   - Le foto vengono ridotte (lato lungo 1800 px, JPEG) prima di salvarle;
     i PDF restano come sono (massimo 8 MB).
   - Il contenuto dei file sta in un archivio a parte del browser e, se
     collegato, nell'archivio PRIVATO della società su GitHub (cartella img/).
     Non va mai negli archivi delle squadre: gli allenatori non li vedono.
   ================================================================== */
const DOC_T = {
  certificato: ['🩺', 'Certificato medico', true], privacy: ['🔏', 'Privacy firmata', false], tessera: ['🎫', 'Tessera', true], documento: ['🪪', "Documento d'identità", true],
  fattura: ['🧾', 'Fattura', false], ricevuta: ['🧾', 'Ricevuta / scontrino', false], contratto: ['📝', 'Contratto / incarico', true], verbale: ['📋', 'Verbale', false],
  statuto: ['📜', 'Statuto / atto costitutivo', false], polizza: ['🛡', 'Polizza assicurativa', true], altro: ['📎', 'Altro', true]
};
const DOC_PER = { at: ['certificato', 'privacy', 'tessera', 'documento', 'altro'], st: ['certificato', 'contratto', 'tessera', 'documento', 'altro'], mv: ['fattura', 'ricevuta', 'contratto', 'altro'], soc: ['statuto', 'verbale', 'polizza', 'contratto', 'fattura', 'altro'] };
const DOC_MAX_PDF = 8 * 1024 * 1024;
const DOC_ZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
SOC_ROUTE.docs = 'documenti';
const docAll = () => Store.list('docs');
const docsOf = rif => docAll().filter(d => d.rif === rif).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
const docKb = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const docLabel = t => (DOC_T[t] || DOC_T.altro)[1];
const docIc = t => (DOC_T[t] || DOC_T.altro)[0];
function docOwner(rif){
  const [k, id] = rif.split(':');
  if(k === 'at'){ const a = socAt(id); return a ? fullName(a) : 'Atleta eliminato'; }
  if(k === 'st'){ const x = socData().staff.find(s => s.id === id); return x ? fullName(x) : 'Staff eliminato'; }
  if(k === 'mv'){ const m = socData().led.find(x => x.id === id); return m ? (m.descrizione || m.categoria || 'Movimento') + ' · ' + shortDate(m.data) : 'Movimento eliminato'; }
  return 'Società';
}
const docHidden = () => typeof isCoach === 'function' && isCoach();

/* ---------------------------------------------------------------- preparazione del file */
function docReadAsDataURL(f){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); }); }
async function docPrepare(f){
  if(/^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)){
    const url = await docReadAsDataURL(f);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Non riesco a leggere questa immagine (se è HEIC dell\'iPhone, scatta la foto dall\'app o salvala come JPEG).')); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
    const out = cv.toDataURL('image/jpeg', 0.82);
    return { url: out, mime: 'image/jpeg', nome: f.name.replace(/\.[^.]+$/, '') + '.jpg', size: Math.round((out.length - out.indexOf(',') - 1) * 3 / 4) };
  }
  if(f.type === 'application/pdf' || /\.pdf$/i.test(f.name)){
    if(f.size > DOC_MAX_PDF) throw new Error(`Il PDF è troppo grande (${docKb(f.size)}): il massimo è 8 MB. Prova a ridurlo o a fotografare le pagine.`);
    const url = (await docReadAsDataURL(f)).replace(/^data:[^;,]*/, 'data:application/pdf');
    return { url, mime: 'application/pdf', nome: f.name, size: f.size };
  }
  throw new Error('Si possono allegare foto (JPEG, PNG) e PDF.');
}
async function docRef(url, mime){
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(h)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('') + '.' + (mime === 'application/pdf' ? 'pdf' : 'jpg');
}
async function docData(d){
  const ref = String(d.file || '').replace(/^img:/, '');
  let url = await Store.getFile(ref);
  if(!url && Sync.config()){ url = await Sync.fetchDocFile(ref).catch(() => null); if(url) await Store.putFile(ref, url); }
  return url;
}
function docBlobUrl(url){ const i = url.indexOf(','), mime = url.slice(5, url.indexOf(';')), bin = atob(url.slice(i + 1)), u8 = new Uint8Array(bin.length); for(let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); return URL.createObjectURL(new Blob([u8], { type: mime })); }

/* ---------------------------------------------------------------- elenco e scheda */
function docListHTML(rif, opts){
  if(docHidden()) return '';
  const L = docsOf(rif), o = opts || {};
  return `<div class="doc-sec" data-docrif="${esc(rif)}">${o.title === false ? '' : `<h3 class="sd-h3">Documenti${L.length ? ' <span class="muted">' + L.length + '</span>' : ''}</h3>`}
    ${L.length ? `<div class="doc-list">${L.map(d => { const n = d.scadenza ? daysTo(d.scadenza) : null;
      return `<button type="button" data-action="doc-open" data-id="${d.id}"><span class="ic">${docIc(d.tipo)}</span><span class="tx"><b>${esc(d.titolo)}</b><small>${[docLabel(d.tipo) !== d.titolo ? docLabel(d.tipo) : '', d.data ? shortDate(d.data) : '', docKb(d.size || 0)].filter(Boolean).map(esc).join(' · ')}</small></span>${d.scadenza ? `<span class="sd-pill ${n < 0 ? 'p-bad' : n <= 30 ? 'p-warn' : ''}">${n < 0 ? 'scaduto' : 'fino al ' + shortDate(d.scadenza)}</span>` : ''}</button>`; }).join('')}</div>` : (o.empty || '')}
    <button type="button" class="btn sm" data-action="doc-add" data-rif="${esc(rif)}">📎 Allega un documento</button></div>`;
}
function docRefreshLists(){ document.querySelectorAll('.doc-sec[data-docrif]').forEach(el => { el.outerHTML = docListHTML(el.dataset.docrif); }); }
function openDocAdd(rif, tipo){
  const [k] = rif.split(':'), tipi = DOC_PER[k] || Object.keys(DOC_T);
  const t0 = tipo || tipi[0];
  const box = document.createElement('div'); box.className = 'doc-over'; box.id = 'doc-over';
  box.innerHTML = `<div class="modal-box" style="max-width:520px"><form id="doc-form" onsubmit="return false">
    <div class="modal-head"><div style="flex:1"><h2>Allega un documento</h2><div class="muted" style="font-size:13.5px">${esc(docOwner(rif))}</div></div><button type="button" class="iconbtn" data-action="doc-x">✕</button></div>
    <div class="modal-body"><div class="grid g2">
      <label class="f span2">File<input type="file" name="file" accept="image/*,application/pdf" id="doc-file"><small class="muted" style="font-weight:400">Foto (dal telefono puoi scattarla) o PDF. Le foto vengono ridotte per occupare poco spazio.</small></label>
      <label class="f">Tipo<select name="tipo" id="doc-tipo">${tipi.map(t => `<option value="${t}" ${t === t0 ? 'selected' : ''}>${docIc(t)} ${docLabel(t)}</option>`).join('')}</select></label>
      <label class="f">Data del documento<input type="date" name="data" value="${todayISO()}"></label>
      <label class="f span2">Titolo<input type="text" name="titolo" placeholder="${esc(docLabel(t0))}"></label>
      <label class="f ${(DOC_T[t0] || [])[2] ? '' : 'hidden'}" id="doc-scad">Valido fino al<input type="date" name="scadenza"></label>
      <label class="f span2">Note<input type="text" name="note"></label>
    </div>${k === 'at' ? '<p class="muted" style="font-size:12.5px;margin:10px 0 0">Il certificato medico è un dato sanitario: resta solo nell\'archivio privato della società, non arriva agli allenatori.</p>' : ''}</div>
    <div class="modal-foot"><span style="flex:1"></span><button type="button" class="btn" data-action="doc-x">Annulla</button><button type="button" class="btn primary" data-action="doc-save" data-rif="${esc(rif)}">Allega</button></div></form></div>`;
  document.body.appendChild(box);
}
async function docSave(rif){
  const f = $('#doc-form'), fd = new FormData(f), file = $('#doc-file').files[0];
  if(!file){ alert('Scegli il file da allegare.'); return; }
  const btn = f.querySelector('[data-action=doc-save]'); btn.disabled = true; btn.textContent = 'Preparo…';
  try{
    const P = await docPrepare(file), ref = await docRef(P.url, P.mime);
    await Store.putFile(ref, P.url);
    const tipo = fd.get('tipo'), d = { id: newId('dc'), rif, tipo, titolo: (fd.get('titolo') || '').toString().trim() || docLabel(tipo), file: 'img:' + ref, nome: P.nome, mime: P.mime, size: P.size,
      data: (fd.get('data') || '').toString(), scadenza: (DOC_T[tipo] || [])[2] ? (fd.get('scadenza') || '').toString() : '', note: (fd.get('note') || '').toString().trim() };
    const items = [{ c: 'docs', r: d }];
    /* un certificato o una tessera aggiornano anche la scadenza nella scheda */
    const [k, id] = rif.split(':'); let msg = '';
    if(d.scadenza && (k === 'at' || k === 'st')){
      const col = k === 'at' ? 'athletes' : 'staff', x = (k === 'at' ? socData().at : socData().staff).find(o => o.id === id);
      const fld = tipo === 'certificato' ? 'scadenzaVisita' : tipo === 'tessera' ? 'scadenzaTessera' : tipo === 'documento' && k === 'at' ? 'scadenzaDocumento' : null;
      if(x && fld && (!x[fld] || x[fld] < d.scadenza)){ const y = clone(x); y[fld] = d.scadenza; y.updatedAt = Date.now(); items.push({ c: col, r: y }); msg = ` · scadenza aggiornata al ${shortDate(d.scadenza)}`;
        /* se la scheda è aperta, si aggiorna anche lì (così salvandola non torna la data vecchia) */
        const inp = document.querySelector(`#at-form [name=${fld}], #st-form [name=${fld}]`); if(inp) inp.value = d.scadenza;
        if(k === 'at' && ui.atDraft && ui.atDraft.id === id) ui.atDraft[fld] = d.scadenza; if(k === 'st' && ui.stDraft && ui.stDraft.id === id) ui.stDraft[fld] = d.scadenza; }
    }
    await socBulk(items); await loadState();
    $('#doc-over')?.remove(); toast('Documento allegato' + msg); docRefreshLists();
    if(ui.view === 'societa' && ui.socTab === 'documenti') socRefreshBehind();
  }catch(e){ alert(e.message || e); btn.disabled = false; btn.textContent = 'Allega'; }
}
async function docOpen(id){
  const d = docAll().find(x => x.id === id); if(!d) return;
  const box = document.createElement('div'); box.className = 'doc-over'; box.id = 'doc-over';
  box.innerHTML = `<div class="modal-box doc-view"><div class="modal-head"><div style="flex:1;min-width:0"><h2>${docIc(d.tipo)} ${esc(d.titolo)}</h2><div class="muted" style="font-size:13.5px">${[docOwner(d.rif), docLabel(d.tipo), d.data ? shortDate(d.data) : '', d.scadenza ? 'valido fino al ' + shortDate(d.scadenza) : '', docKb(d.size || 0)].filter(Boolean).map(esc).join(' · ')}</div></div><button type="button" class="iconbtn" data-action="doc-x">✕</button></div>
    <div class="modal-body"><div class="doc-prev" id="doc-prev"><p class="muted">Apro il documento…</p></div>${d.note ? `<p style="margin:10px 0 0">${esc(d.note)}</p>` : ''}</div>
    <div class="modal-foot"><button type="button" class="btn danger" data-action="doc-del" data-id="${d.id}">Elimina</button><span style="flex:1"></span><a class="btn hidden" id="doc-dl" download="${esc(d.nome || d.titolo)}">⬇ Scarica</a><a class="btn hidden" id="doc-tab" target="_blank" rel="noopener">Apri a tutto schermo</a><button type="button" class="btn primary" data-action="doc-x">Chiudi</button></div></div>`;
  document.body.appendChild(box);
  const url = await docData(d), pv = $('#doc-prev'); if(!pv) return;
  if(!url){ pv.innerHTML = `<p class="sd-red">Il file non è su questo dispositivo${Sync.config() ? ' e non riesco a scaricarlo dall\'archivio online (controlla la connessione)' : ': è stato allegato su un altro dispositivo. Collega l\'archivio online per vederlo anche qui'}.</p>`; return; }
  const b = docBlobUrl(url); ui.docBlob = b;
  pv.innerHTML = d.mime === 'application/pdf' ? `<iframe src="${b}" title="${esc(d.titolo)}"></iframe>` : `<img src="${b}" alt="${esc(d.titolo)}">`;
  const dl = $('#doc-dl'), tb = $('#doc-tab'); dl.href = b; tb.href = b; dl.classList.remove('hidden'); tb.classList.remove('hidden');
}
async function docDelete(id){
  const d = docAll().find(x => x.id === id); if(!d || !confirm(`Eliminare «${d.titolo}»?`)) return;
  try{ await socDel('docs', id); }catch(e){ saveFail(e); return; }
  const ref = d.file.replace(/^img:/, ''); if(!docAll().some(x => x.file === d.file)) await Store.delFile(ref).catch(() => {});
  $('#doc-over')?.remove(); toast('Documento eliminato'); docRefreshLists(); if(ui.view === 'societa' && ui.socTab === 'documenti') socRefreshBehind();
}

/* ---------------------------------------------------------------- dove compaiono */
const _docAtModal = openAtModal;
openAtModal = function(id){
  _docAtModal(id); if(!id || docHidden()) return;
  const b = $('#at-form .modal-body'); if(b) b.insertAdjacentHTML('beforeend', `<div class="atf">${docListHTML('at:' + id)}</div>`);
};
const _docAtProfile = openAtProfile;
openAtProfile = function(id){
  _docAtProfile(id); if(docHidden()) return;
  const b = $('#modal .modal-body'); if(!b) return;
  b.insertAdjacentHTML('beforeend', docListHTML('at:' + id, { empty: '<p class="muted" style="margin:0 0 8px">Nessun documento allegato.</p>' }));
};
const _docStaff = openStaff;
openStaff = function(id){
  _docStaff(id); if(!id) return;
  const b = $('#st-form .modal-body'); if(b) b.insertAdjacentHTML('beforeend', `<div class="atf">${docListHTML('st:' + id)}</div>`);
};
const _docLedger = openLedger;
openLedger = function(id, tipo, draft){
  _docLedger(id, tipo, draft);
  const b = $('#led-form .modal-body'); if(!b) return;
  const mid = (draft && draft.id) || id;
  b.insertAdjacentHTML('beforeend', mid ? `<div style="margin-top:12px">${docListHTML('mv:' + mid)}</div>` : '<p class="muted" style="font-size:12.5px;margin:12px 0 0">📎 Dopo aver salvato potrai allegare la fattura o lo scontrino.</p>');
};
const _docCassa = socCassaHTML;
socCassaHTML = function(s){
  let h = _docCassa(s); const C = {};
  docAll().forEach(d => { if(d.rif.startsWith('mv:')){ const k = d.rif.slice(3); C[k] = (C[k] || 0) + 1; } });
  Object.keys(C).forEach(id => { h = h.replace(new RegExp(`(data-action="soc-led-edit" data-id="${id}">\\s*<span class="dt">)`), '$1<span class="doc-clip" title="Documento allegato">📎</span>'); });
  return h;
};
/* scadenze dei documenti della società nello scadenzario */
const _docAgenda = socAgenda;
socAgenda = function(horizon){
  const L = _docAgenda(horizon), lim = horizon === undefined ? 365 : horizon;
  docAll().filter(d => d.rif === 'soc' && d.scadenza).forEach(d => { const n = daysTo(d.scadenza); if(n === null || n > lim || n < -60) return;
    L.push({ d: d.scadenza, n, k: 'doc', ic: docIc(d.tipo), t: d.titolo, s: docLabel(d.tipo) + ' · da rinnovare', act: 'doc-open', id: d.id }); });
  return L.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
};
/* da sistemare: visita valida senza certificato allegato */
const _docChecks = socChecks;
socChecks = function(){
  const G = _docChecks(), td = todayISO(), D = socData();
  const L = D.at.filter(a => a.iscritto && a.scadenzaVisita && a.scadenzaVisita >= td && !docAll().some(d => d.rif === 'at:' + a.id && d.tipo === 'certificato'));
  if(L.length && docAll().some(d => d.tipo === 'certificato')) G.push({ t: 'Certificato medico non allegato', L: L.map(a => ({ a, s: 'visita fino al ' + shortDate(a.scadenzaVisita) })), hint: 'La data della visita c\'è, ma manca la copia del certificato.' });
  return G;
};

/* ---------------------------------------------------------------- scheda «Documenti» */
SOC_TABS.splice(SOC_TABS.findIndex(t => t[0] === 'magazzino') + 1, 0, ['documenti', 'Documenti']);
SOC_BODY.documenti = function(){
  const all = docAll(), f = ui.docF || '', q = (ui.docQ || '').toLowerCase().trim();
  const L = all.filter(d => (!f || (f === 'soc' ? d.rif === 'soc' : d.rif.startsWith(f + ':'))) && (!q || (d.titolo + ' ' + docOwner(d.rif) + ' ' + docLabel(d.tipo) + ' ' + (d.note || '')).toLowerCase().includes(q)));
  const tot = all.reduce((s, d) => s + (d.size || 0), 0), cnt = k => all.filter(d => k === 'soc' ? d.rif === 'soc' : d.rif.startsWith(k + ':')).length;
  const groups = [['soc', 'Società'], ['at', 'Atleti'], ['st', 'Staff'], ['mv', 'Prima nota']];
  return `<div class="sd-quick"><button class="btn primary" data-action="doc-add" data-rif="soc">📎 Documento della società</button>${all.length ? `<button class="btn" data-action="doc-zip">⬇ Scarica tutto (ZIP)</button>` : ''}</div>
  <p class="muted" style="margin-top:0;font-size:13.5px">${all.length} document${all.length === 1 ? 'o' : 'i'} · ${docKb(tot)}. I documenti di atleti, staff e movimenti si allegano dalle loro schede. Restano nell'archivio privato della società: gli allenatori non li vedono.</p>
  ${all.length ? `<div class="sd-filters"><div class="sbox">${EXI.search}<input type="search" id="doc-q" placeholder="Cerca…" value="${esc(ui.docQ || '')}"></div></div>
  <div class="chips sd-chips"><button class="chip ${!f ? 'on' : ''}" data-action="doc-f" data-v="">Tutti <span>${all.length}</span></button>${groups.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-action="doc-f" data-v="${k}">${l} <span>${cnt(k)}</span></button>`).join('')}</div>
  <div class="panel sd-rows">${L.length ? L.map(d => { const n = d.scadenza ? daysTo(d.scadenza) : null;
    return `<button class="sd-row doc-row" data-action="doc-open" data-id="${d.id}"><span class="nm"><b>${docIc(d.tipo)} ${esc(d.titolo)}</b><small>${esc(docOwner(d.rif))} · ${esc(docLabel(d.tipo))}${d.data ? ' · ' + shortDate(d.data) : ''}</small></span>
      <span class="pr"><small>${docKb(d.size || 0)}</small></span><span class="am">${d.scadenza ? `<span class="sd-pill ${n < 0 ? 'p-bad' : n <= 30 ? 'p-warn' : ''}">${n < 0 ? 'scaduto' : 'fino al ' + shortDate(d.scadenza)}</span>` : ''}</span></button>`; }).join('') : '<div class="empty">Nessun documento con questi filtri.</div>'}</div>`
  : `<div class="empty">Nessun documento allegato.<br>Qui trovi tutti i documenti: certificati medici e privacy firmate (dalla scheda dell'atleta), contratti e tessere dello staff, fatture e scontrini (dai movimenti di prima nota), statuto, verbali e polizze della società.</div>`}
`;
};
async function docZip(){
  const btn = $('[data-action=doc-zip]'); if(btn){ btn.disabled = true; btn.textContent = 'Preparo lo ZIP…'; }
  try{
    if(!window.JSZip) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = DOC_ZIP; s.onload = res; s.onerror = () => rej(new Error('Per creare lo ZIP serve la connessione a internet.')); document.head.appendChild(s); });
    const z = new JSZip(), clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'documento';
    const used = new Set(); let miss = 0;
    for(const d of docAll()){
      const url = await docData(d); if(!url){ miss++; continue; }
      const [k] = d.rif.split(':'), dir = k === 'at' ? 'Atleti/' + clean(docOwner(d.rif)) : k === 'st' ? 'Staff/' + clean(docOwner(d.rif)) : k === 'mv' ? 'Prima nota' : 'Società';
      let name = `${dir}/${d.data ? d.data + ' ' : ''}${clean(d.titolo)}.${d.mime === 'application/pdf' ? 'pdf' : 'jpg'}`, i = 2;
      while(used.has(name)) name = name.replace(/(\.\w+)$/, ` (${i++})$1`); used.add(name);
      z.file(name, url.slice(url.indexOf(',') + 1), { base64: true });
    }
    const blob = await z.generateAsync({ type: 'blob' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'documenti-' + todayISO() + '.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('ZIP scaricato' + (miss ? ` · ${miss} file non disponibili` : ''));
  }catch(e){ alert(e.message || e); }
  if(btn){ btn.disabled = false; btn.textContent = '⬇ Scarica tutto (ZIP)'; }
}

Object.assign(actions, {
  'doc-add': b => openDocAdd(b.dataset.rif),
  'doc-save': b => docSave(b.dataset.rif),
  'doc-open': b => docOpen(b.dataset.id),
  'doc-del': b => docDelete(b.dataset.id),
  'doc-x': () => { $('#doc-over')?.remove(); if(ui.docBlob){ URL.revokeObjectURL(ui.docBlob); ui.docBlob = null; } },
  'doc-f': b => { ui.docF = b.dataset.v; render(); },
  'doc-zip': () => docZip()
});
document.addEventListener('change', e => {
  const t = e.target;
  if(t.id === 'doc-tipo'){ const w = $('#doc-scad'); if(w) w.classList.toggle('hidden', !(DOC_T[t.value] || [])[2]); const ti = $('#doc-form [name=titolo]'); if(ti) ti.placeholder = docLabel(t.value); }
  if(t.id === 'doc-q'){ ui.docQ = t.value; render(); }
});
document.addEventListener('keydown', e => { if(e.key === 'Escape' && $('#doc-over')){ e.stopPropagation(); actions['doc-x'](); } }, true);

GUIDE.splice(5, 0, ['📎', 'Documenti allegati', `
<p>Puoi allegare foto o PDF: <b>certificati medici</b>, <b>privacy firmate</b> e tessere dalla scheda dell'atleta; contratti e tessere dalla scheda dello staff; <b>fatture e scontrini</b> dai movimenti di prima nota; statuto, verbali e polizze in <b>Società → Documenti</b>.</p>
<ul><li>Dal telefono puoi fotografare il documento: la foto viene ridotta per occupare poco spazio.</li>
<li>Allegando un certificato con la data di scadenza, la scheda dell'atleta si aggiorna da sola.</li>
<li>Le polizze e gli altri documenti della società con una scadenza compaiono nello scadenzario.</li>
<li>Con <b>Scarica tutto (ZIP)</b> hai tutti i file in cartelle, per esempio da consegnare alla federazione o conservare.</li></ul>
<p>I file restano nell'archivio privato della società su GitHub e non arrivano mai agli allenatori. Sono dati delicati, soprattutto i certificati medici dei minori: allega solo quello che serve.</p>`]);

/* file rimasti senza documento (per esempio dopo «Togli i dati di prova») */
async function docGc(){ const used = new Set(docAll().map(d => d.file.replace(/^img:/, ''))); for(const k of await Store.fileKeys()) if(!used.has(k)) await Store.delFile(k).catch(() => {}); }
const _docDemoClear = demoClear;
demoClear = async function(){
  await _docDemoClear();
  /* i documenti allegati a schede di prova (anche se aggiunti dopo) se ne vanno con loro */
  if(!Store.list('athletes').some(a => String(a.id).startsWith('demo-'))){
    const dels = docAll().filter(d => /:demo-/.test(d.rif)).map(d => ({ c: 'docs', id: d.id }));
    if(dels.length){ await api('POST', '/api/multipli', { items: [], dels }); await loadState(); render(); }
  }
  await docGc();
};
