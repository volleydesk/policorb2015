#!/usr/bin/env python3
# versione: 1
"""Volleydesk – promemoria automatici via email.

Gira su GitHub (azione programmata nell'archivio privato dei dati, una volta al giorno).
Legge dati.json, decide quali email mandare e le invia con il server di posta configurato
nei «secrets» dell'archivio. Tiene traccia di cosa ha già mandato in promemoria/registro.json,
così nessuno riceve due volte lo stesso avviso.

Secrets (Settings → Secrets and variables → Actions):
  SMTP_USER, SMTP_PASSWORD   obbligatori (per Gmail: indirizzo e «password per le app»)
  SMTP_HOST, SMTP_PORT       facoltativi (predefiniti: smtp.gmail.com, 465)
  MAIL_FROM                  facoltativo (predefinito: SMTP_USER)
Variabili d'ambiente per le prove: DRY_RUN=1 (stampa senza inviare), PROVA=1 (manda tutto alla segreteria).
"""
import json, os, re, smtplib, ssl, sys
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

try:
    from zoneinfo import ZoneInfo
    OGGI = datetime.now(ZoneInfo('Europe/Rome')).date()
except Exception:
    OGGI = date.today()
if os.environ.get('OGGI'):
    OGGI = date.fromisoformat(os.environ['OGGI'])

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.dirname(QUI)
DATI = os.environ.get('DATI', os.path.join(RADICE, 'dati.json'))
REGISTRO = os.environ.get('REGISTRO', os.path.join(QUI, 'registro.json'))
DRY = os.environ.get('DRY_RUN', '') not in ('', '0', 'false')
PROVA = os.environ.get('PROVA', '') not in ('', '0', 'false')

DEF = {'attivo': True, 'prima': 3, 'scadute': True, 'ogni': 7, 'max': 3, 'visite': True, 'visiteGiorni': 15,
       'riepilogo': True, 'giornoRiepilogo': 1, 'emailSegreteria': '', 'firma': ''}


def jload(s, d):
    try:
        v = json.loads(s) if isinstance(s, str) and s else d
        return v if isinstance(v, type(d)) else d
    except Exception:
        return d


def gd(iso):
    try:
        return date.fromisoformat(iso) if iso and re.match(r'^\d{4}-\d\d-\d\d$', iso) else None
    except ValueError:
        return None


def it(d):
    return d.strftime('%d/%m/%Y') if d else ''


def eur(n):
    s = f'{abs(n):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return ('-' if n < 0 else '') + s + ' €'


def r2(n):
    return round((n or 0) * 100) / 100


def eta(a):
    b = gd(a.get('dataNascita'))
    if not b:
        return None
    y = OGGI.year - b.year - ((OGGI.month, OGGI.day) < (b.month, b.day))
    return y


def valida(mail):
    mail = (mail or '').strip()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', mail):
        return ''
    if re.search(r'@esempio\.it$|\.example$|@example\.', mail, re.I):   # indirizzi dei dati di prova
        return ''
    return mail


def chi_paga(a):
    minore = (eta(a) or 99) < 18
    if minore or a.get('genitore'):
        return {'nome': a.get('genitore') or (a.get('nome', '') + ' ' + a.get('cognome', '')).strip(),
                'email': valida(a.get('emailGenitore')) or valida(a.get('email'))}
    return {'nome': (a.get('nome', '') + ' ' + a.get('cognome', '')).strip(), 'email': valida(a.get('email')) or valida(a.get('emailGenitore'))}


def calcola(doc, reg, cfg):
    """Restituisce l'elenco delle email da mandare oggi: [{a, oggetto, testo, chiavi:[...]}]."""
    C = doc.get('collections', {})
    S = (doc.get('settings') or {}).get('values') or {}
    soc = jload(S.get('societa'), {})
    nome_soc = soc.get('ragioneSociale') or S.get('squadra') or 'la società'
    firma = cfg.get('firma') or soc.get('firma') or ('La segreteria di ' + nome_soc)
    inviati = reg.get('inviati', {})
    atleti = {a['id']: a for a in C.get('athletes', []) if a.get('id')}
    out = []

    def gia(k):
        return k in inviati

    def iban_txt(stagione, atleta):
        if not soc.get('iban'):
            return ''
        caus = (soc.get('causale') or 'Quota {stagione} – {atleta}').replace('{stagione}', stagione or '').replace('{atleta}', atleta)
        return (f"\nPuoi pagare con bonifico sull'IBAN {soc['iban']}"
                + (f" intestato a {soc['intestatarioIban']}" if soc.get('intestatarioIban') else '') + f", causale «{caus}».")

    # ---- quote: rate in arrivo e rate scadute, una email per atleta
    per_atleta = {}
    for p in C.get('payments', []):
        if p.get('annullata') or str(p.get('id', '')).startswith('demo-'):
            continue
        dovuto = r2(p.get('importo', 0) - sum(float(x.get('importo') or 0) for x in p.get('incassi', [])))
        sc = gd(p.get('scadenza'))
        if dovuto <= 0.004 or not sc:
            continue
        gg = (sc - OGGI).days
        k_pre, k_sca = f"pre:{p['id']}:{p['scadenza']}", f"sca:{p['id']}"
        tipo = None
        if cfg.get('prima') and 0 <= gg <= int(cfg['prima']) and not gia(k_pre):
            tipo = 'pre'
        elif cfg.get('scadute') and gg < 0:
            st = inviati.get(k_sca, [])
            if len(st) < int(cfg.get('max') or 3) and (not st or (OGGI - date.fromisoformat(st[-1])).days >= int(cfg.get('ogni') or 7)):
                tipo = 'sca'
        if tipo:
            per_atleta.setdefault(p.get('atletaId'), []).append((tipo, p, dovuto, sc, k_pre if tipo == 'pre' else k_sca))
    for aid, L in per_atleta.items():
        a = atleti.get(aid)
        if not a:
            continue
        cp = chi_paga(a)
        if not cp['email']:
            continue
        nome_at = (a.get('nome', '') + ' ' + a.get('cognome', '')).strip()
        scadute = [x for x in L if x[0] == 'sca']
        righe = '\n'.join(f"  • {x[1].get('descrizione') or x[1].get('voce') or 'Quota'}: {eur(x[2])}, "
                          + (f"scaduta il {it(x[3])}" if x[0] == 'sca' else f"scadenza {it(x[3])}") for x in L)
        tot = r2(sum(x[2] for x in L))
        if scadute:
            ogg = f"Promemoria: quota di {nome_at} da versare"
            intro = f"ti ricordiamo che per {nome_at} risultano ancora da versare:"
        else:
            ogg = f"Quota di {nome_at} in scadenza"
            intro = f"ti ricordiamo le prossime scadenze per {nome_at}:"
        testo = (f"Ciao {cp['nome'].split(' ')[0] if cp['nome'] else ''},\n{intro}\n{righe}\n\nTotale: {eur(tot)}."
                 + iban_txt(L[0][1].get('stagione'), nome_at)
                 + "\nSe hai già pagato, non considerare questo messaggio.\n\nGrazie,\n" + firma)
        out.append({'a': cp['email'], 'oggetto': ogg, 'testo': testo, 'chiavi': [x[4] for x in L]})

    # ---- visite mediche in scadenza o scadute (un solo avviso per data di scadenza)
    if cfg.get('visite'):
        for a in atleti.values():
            if not a.get('iscritto') or str(a.get('id', '')).startswith('demo-'):
                continue
            sv = gd(a.get('scadenzaVisita'))
            if not sv:
                continue
            gg = (sv - OGGI).days
            k = f"vis:{a['id']}:{a['scadenzaVisita']}"
            if gg > int(cfg.get('visiteGiorni') or 15) or gia(k) or gg < -30:
                continue
            cp = chi_paga(a)
            if not cp['email']:
                continue
            nome_at = (a.get('nome', '') + ' ' + a.get('cognome', '')).strip()
            frase = f"la visita medica di {nome_at} è scaduta il {it(sv)}" if gg < 0 else f"la visita medica di {nome_at} scade il {it(sv)}"
            out.append({'a': cp['email'], 'oggetto': f"Visita medica di {nome_at}" + (' scaduta' if gg < 0 else ' in scadenza'),
                        'testo': f"Ciao {cp['nome'].split(' ')[0] if cp['nome'] else ''},\n{frase}.\nSenza un certificato valido non può allenarsi né giocare: "
                                 f"quando hai il nuovo certificato consegnalo alla società.\n\nGrazie,\n{firma}", 'chiavi': [k]})

    # ---- riepilogo settimanale alla segreteria
    seg = valida(cfg.get('emailSegreteria')) or valida(soc.get('email'))
    sett = OGGI.isocalendar()
    k_rie = f"rie:{sett[0]}-{sett[1]:02d}"
    if cfg.get('riepilogo') and seg and OGGI.isoweekday() == int(cfg.get('giornoRiepilogo') or 1) and not gia(k_rie):
        righe = []
        scad, tot = [], 0
        for p in C.get('payments', []):
            if p.get('annullata'):
                continue
            dov = r2(p.get('importo', 0) - sum(float(x.get('importo') or 0) for x in p.get('incassi', [])))
            sc = gd(p.get('scadenza'))
            if dov > 0.004 and sc and sc < OGGI:
                a = atleti.get(p.get('atletaId'), {})
                scad.append(f"  • {a.get('cognome', '')} {a.get('nome', '')}: {p.get('descrizione') or 'quota'} {eur(dov)} (dal {it(sc)})")
                tot += dov
        righe.append(f"Rate scadute: {len(scad)} per {eur(r2(tot))}" + (':\n' + '\n'.join(sorted(scad)[:40]) if scad else '.'))
        prossime = []
        for d in C.get('deadlines', []):
            dd = gd(d.get('data'))
            if not d.get('fatto') and dd and (dd - OGGI).days <= 14:
                prossime.append((dd, f"  • {it(dd)} – {d.get('titolo', '')}" + (f" ({eur(float(d['importo']))})" if d.get('importo') not in ('', None) else '') + (' – SCADUTA' if dd < OGGI else '')))
        righe.append('Scadenze della società nei prossimi 14 giorni' + (':\n' + '\n'.join(x[1] for x in sorted(prossime)) if prossime else ': nessuna.'))
        vis = []
        for a in atleti.values():
            sv = gd(a.get('scadenzaVisita'))
            if a.get('iscritto') and (not sv or (sv - OGGI).days <= 30):
                vis.append(f"  • {a.get('cognome', '')} {a.get('nome', '')}: " + ('manca la data' if not sv else ('scaduta il ' if sv < OGGI else 'scade il ') + it(sv)))
        righe.append('Visite mediche da sistemare' + (':\n' + '\n'.join(sorted(vis)[:40]) if vis else ': nessuna.'))
        st = []
        for x in C.get('staff', []):
            if x.get('attivo') is False:
                continue
            for k, l in [('scadenzaTessera', 'tessera'), ('scadenzaVisita', 'visita medica'), ('scadenzaQualifica', 'qualifica'), ('scadenzaCasellario', 'certificato del casellario')]:
                d0 = gd(x.get(k))
                if d0 and (d0 - OGGI).days <= 30:
                    st.append(f"  • {x.get('cognome', '')} {x.get('nome', '')}: {l} {'scaduta il' if d0 < OGGI else 'scade il'} {it(d0)}")
        if st:
            righe.append('Staff:\n' + '\n'.join(st))
        out.append({'a': seg, 'oggetto': f"Riepilogo settimanale – {nome_soc}", 'testo': f"Riepilogo del {it(OGGI)}\n\n" + '\n\n'.join(righe) + "\n\n— Volleydesk", 'chiavi': [k_rie]})
    return out, seg, nome_soc


def invia(msgs, mittente_nome, seg):
    host = os.environ.get('SMTP_HOST') or 'smtp.gmail.com'
    port = int(os.environ.get('SMTP_PORT') or 465)
    user, pwd = os.environ.get('SMTP_USER', ''), os.environ.get('SMTP_PASSWORD', '')
    mitt = os.environ.get('MAIL_FROM') or user
    if not user or not pwd:
        sys.exit('Mancano i secrets SMTP_USER e SMTP_PASSWORD: aggiungili nelle impostazioni dell\'archivio (Secrets and variables → Actions).')
    ctx = ssl.create_default_context()
    srv = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) if port == 465 else smtplib.SMTP(host, port, timeout=30)
    if port != 465:
        srv.starttls(context=ctx)
    srv.login(user, pwd)
    ok = []
    for m in msgs:
        e = EmailMessage()
        e['From'] = formataddr((mittente_nome, mitt))
        e['To'] = m['a']
        if seg and m['a'] != seg:
            e['Reply-To'] = seg
        e['Subject'] = m['oggetto']
        e['Message-ID'] = make_msgid(domain='volleydesk')
        e.set_content(m['testo'])
        try:
            srv.send_message(e)
            ok.append(m)
        except Exception as ex:
            print('Non inviata a', m['a'], '-', ex)
    srv.quit()
    return ok


def main():
    if not os.path.exists(DATI):
        print('dati.json non trovato: niente da fare.')
        return
    doc = json.load(open(DATI, encoding='utf-8'))
    S = (doc.get('settings') or {}).get('values') or {}
    cfg = dict(DEF, **jload(S.get('promemoria'), {}))
    if not cfg.get('attivo'):
        print('Promemoria disattivati nelle impostazioni di Volleydesk.')
        return
    reg = jload(open(REGISTRO, encoding='utf-8').read(), {}) if os.path.exists(REGISTRO) else {}
    reg.setdefault('inviati', {})
    msgs, seg, nome_soc = calcola(doc, reg, cfg)
    if PROVA:
        if not seg:
            sys.exit("Per la prova serve l'email della segreteria (Volleydesk → Società → Promemoria).")
        msgs = [dict(m, a=seg, oggetto='[PROVA] ' + m['oggetto'] + ' → ' + m['a']) for m in msgs] or \
               [{'a': seg, 'oggetto': '[PROVA] Promemoria Volleydesk', 'testo': 'Funziona! Oggi non ci sono promemoria da inviare.', 'chiavi': []}]
    print(f"{OGGI}: {len(msgs)} email da inviare")
    for m in msgs:
        print(' -', m['a'], '|', m['oggetto'])
    if DRY:
        for m in msgs:
            print('\n=== ' + m['a'] + ' | ' + m['oggetto'] + '\n' + m['testo'])
        return
    ok = invia(msgs, nome_soc, seg) if msgs else []
    if PROVA:
        print('Prova completata: nessun registro aggiornato.')
        return
    for m in ok:
        for k in m['chiavi']:
            reg['inviati'].setdefault(k, []).append(OGGI.isoformat())
        reg.setdefault('ultimi', []).append({'data': OGGI.isoformat(), 'a': m['a'], 'oggetto': m['oggetto']})
    reg['ultimi'] = reg.get('ultimi', [])[-200:]
    reg['ultimaEsecuzione'] = datetime.now().isoformat(timespec='minutes')
    # le chiavi più vecchie di un anno non servono più
    lim = (OGGI - timedelta(days=400)).isoformat()
    reg['inviati'] = {k: v for k, v in reg['inviati'].items() if v and v[-1] >= lim}
    with open(REGISTRO, 'w', encoding='utf-8') as f:
        json.dump(reg, f, ensure_ascii=False, indent=1)
    print(f'Inviate {len(ok)} email.')


if __name__ == '__main__':
    main()
