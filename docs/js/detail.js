// Dettaglio di una struttura: canali, risultati, piano mese per mese, chiusura, note.
import { buildDetail, channelLabel, stateLabel, channelView, applyFrom, staleText, trendDaily } from './viewmodel.js';
import { fmtEur, parseEur } from './calc.js';
import { store, esc, ddmm, monthShort, monthLong, kpiHtml, barHtml, reload, render as renderHome } from './app.js';
import { post } from './api.js';
import { icon } from './icons.js';
import { mountTrend } from './trend.js';

const AUTHORS = [['francesco', 'Francesco · Meta'], ['marco', 'Marco · Google'], ['ambra', 'Ambra']];
const $d = () => document.getElementById('detail');
let currentTab = null;
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function confirmDialog(title, body, okLabel) {
  return new Promise((resolve) => {
    const d = document.getElementById('dialog');
    d.innerHTML = `<div class="dialog-card"><h3>${esc(title)}</h3><p>${body}</p>
      <button class="btn primary" id="ok">${esc(okLabel)}</button> <button class="btn" id="no">Annulla</button></div>`;
    d.hidden = false;
    const done = (v) => { d.hidden = true; d.innerHTML = ''; resolve(v); };
    d.querySelector('#ok').addEventListener('click', () => done(true));
    d.querySelector('#no').addEventListener('click', () => done(false));
  });
}

// Giorni attivi e "dal giorno" di un canale in un mese. Risolve {days, start_day} con i soli campi cambiati, o null.
function daysDialog(c, ym) {
  return new Promise((resolve) => {
    const d = document.getElementById('dialog');
    const dim = c.win.daysInMonth;
    d.innerHTML = `<form class="dialog-card" id="daysForm">
        <h3>${esc(channelLabel(c.title))} · ${monthShort(ym)}</h3>
        <p class="small">Giorni attivi: quanti giorni del mese gira il budget (il programmato è €/giorno × giorni). Dal giorno: il primo giorno attivo.</p>
        ${c.requestStale ? '<p class="small"><b>La richiesta Meta di questo mese ha una data vecchia: Salva la ricrea con quella giusta.</b></p>' : ''}
        <label class="small">Giorni attivi <input id="dDays" type="number" min="0" max="${dim}" step="1" inputmode="numeric" value="${c.days ?? dim}"></label>
        <label class="small">Dal giorno <input id="dStart" type="number" min="1" max="${dim}" step="1" inputmode="numeric" value="${c.win.startDay}"></label>
        <p class="small" id="dErr"></p>
        <button class="btn primary" type="submit">Salva</button> <button class="btn" type="button" id="no">Annulla</button></form>`;
    d.hidden = false;
    daysDialog.saved = false;
    const done = (v) => { d.hidden = true; d.innerHTML = ''; resolve(v); };
    d.querySelector('#no').addEventListener('click', () => done(null));
    d.querySelector('#daysForm').addEventListener('submit', (e) => {
      daysDialog.saved = true;
      e.preventDefault();
      const days = Number(d.querySelector('#dDays').value);
      const start = Number(d.querySelector('#dStart').value);
      const err = d.querySelector('#dErr');
      if (!Number.isInteger(days) || days < 0 || days > dim) { err.textContent = `Giorni attivi: da 0 a ${dim}.`; return; }
      if (!Number.isInteger(start) || start < 1 || start > dim) { err.textContent = `Dal giorno: da 1 a ${dim}.`; return; }
      if (days > 0 && start + days - 1 > dim) { err.textContent = `Dal ${start} restano ${dim - start + 1} giorni nel mese.`; return; }
      const out = {};
      if (days !== c.days) out.days = days;
      if (start !== c.win.startDay) out.start_day = start;
      done(Object.keys(out).length ? out : null);
    });
  });
}

function daysLabel(win) {
  return `${win.days} gg${win.startDay !== 1 ? ` · dal ${win.startDay}` : ''}`;
}

const eur2 = (v) => (v === null || v === undefined ? '—' : `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

function channelBox(c, d) {
  const label = channelLabel(c.title);
  const yesterday = c.kind === 'meta' ? (c.daily.find(x => x.date === store.asOf) || { spend: 0 }).spend : null;
  const rows = [];
  if (c.kind === 'meta') {
    rows.push(['Ieri', c.dataStaleSince ? '— (dati fermi)' : fmtEur(yesterday)]);
    rows.push(['Impostato su Meta oggi', `${fmtEur(c.dailyBudget)}/g · ${c.activeCampaigns} ${c.activeCampaigns === 1 ? 'campagna attiva' : 'campagne attive'}`]);
  } else {
    rows.push(['Aggiornato', c.updatedOn ? `${ddmm(c.updatedOn)} da Marco` : 'mai']);
    if (c.dailyBudget !== null) rows.push(['Impostato su Google', `${fmtEur(c.dailyBudget)}/g · ${c.activeCampaigns ? 'attive' : 'ferme'}`]);
    if (c.leadsMtd !== null) rows.push(['Lead del mese', String(c.leadsMtd)]);
  }
  rows.push(['Piano', `${fmtEur(c.eur || 0)}/g × ${c.days || 0} giorni`]);
  if (c.perDay !== null && c.programmed > 0 && c.remaining > 0) rows.push(['Per chiudere il mese servono', `${fmtEur(c.perDay)}/g`]);
  if (c.dataStaleSince) rows.push(['Dati Meta', staleText(c.dataStaleSince)]);
  if (c.sheetMismatch !== null && c.sheetMismatch !== undefined) {
    rows.push(['Spesa Effettiva nello Sheet', `${fmtEur(c.sheetMismatch)} · diversa da ${fmtEur(c.spent)} (inserita a mano?)`]);
  }

  let alert = '';
  if (c.alert) {
    const gap = c.alert.gap;
    alert = `<div class="alert">Su Meta sono impostati <b>${fmtEur(c.dailyBudget)}/g</b>, il piano dice <b>${fmtEur(c.eur)}/g</b>.
      A questo ritmo il mese chiude a <b>${fmtEur(c.alert.projected)}</b> (${gap > 0 ? '+' : ''}${fmtEur(gap)}).
      ${d.can.editMeta ? `<div class="acts"><button class="btn primary" data-act="toMeta" data-id="${esc(c.id)}" data-eur="${c.alert.x}">Porta Meta a ${fmtEur(c.alert.x)}/g</button>
        <button class="btn" data-act="lowerPlan" data-id="${esc(c.id)}" data-eur="${c.alert.y}">Abbassa il piano a ${fmtEur(c.alert.y)}/g</button></div>` : ''}</div>`;
  }
  let googleForm = '';
  if (c.kind === 'google' && d.can.editGoogle && d.ym === todayRome().slice(0, 7)) {
    googleForm = `<form class="form" data-act="google" data-id="${esc(c.id)}">
        <label>Speso del mese a oggi (€)<input name="spent_mtd" inputmode="decimal" required value="${c.updatedOn ? c.spent : ''}"></label>
        <label>Lead del mese<input name="leads_mtd" inputmode="numeric" value="${c.leadsMtd ?? ''}"></label>
        <label>Budget giornaliero (€)<input name="daily_budget" inputmode="decimal" value="${c.dailyBudget ?? ''}"></label>
        <label>Campagne<select name="active"><option value="1">attive</option><option value="0" ${c.activeCampaigns === 0 ? 'selected' : ''}>ferme</option></select></label>
        <button class="btn primary" type="submit">Aggiorna i numeri Google</button>
      </form>`;
  }
  return `<div class="box">
      <div class="box-head"><span class="plat ${c.kind}"><i></i>${esc(label)} · ${c.kind === 'meta' ? 'automatico' : 'da Marco'}</span>
        <span class="chip ${c.state}">${esc(stateLabel(c.state, c.pct))}</span></div>
      <div class="big">${fmtEur(c.spent)} <small>di ${fmtEur(c.programmed)} programmati</small></div>
      ${barHtml(c)}
      <div class="kvs">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      ${alert}
      ${googleForm}
    </div>`;
}

function tilesHtml(d) {
  const t = d.results.month.total;
  const prog = d.channels.reduce((a, c) => a + (c.programmed || 0), 0);
  const pct = prog > 0 ? Math.round((t.spend / prog) * 100) : null;
  return `<div class="tiles">
      <div class="tile"><div class="l">Speso nel mese</div><div class="v">${fmtEur(t.spend)}</div><div class="d">${pct === null ? 'Meta + Google' : `${pct}% del programmato`}</div></div>
      <div class="tile"><div class="l">Programmato</div><div class="v">${fmtEur(prog)}</div><div class="d">${d.channels.map(c => channelLabel(c.title)).join(' + ')}</div></div>
      <div class="tile"><div class="l">Lead nel mese</div><div class="v">${t.leads.toLocaleString('it-IT')}</div><div class="d">Meta + Google</div></div>
      <div class="tile"><div class="l">Costo per lead</div><div class="v">${eur2(t.cpl)}</div><div class="d">nel mese</div></div>
    </div>`;
}

function resultsBox(d) {
  const m = d.results.month;
  const cpl = (sp, l) => (l > 0 ? eur2(sp / l) : '—');
  return `<div class="box"><div class="box-head"><div><h2>Risultati di ${monthLong(d.ym)}</h2><p class="small">Google con i numeri inseriti da Marco.</p></div></div>
      <div class="scroll-x"><table class="t"><thead><tr><th>Canale</th><th>Spesa</th><th>Lead</th><th>Costo per lead</th></tr></thead><tbody>
        <tr><td><span class="plat meta"><i></i>Meta</span></td><td>${fmtEur(m.meta.spend)}</td><td>${m.meta.leads}</td><td>${cpl(m.meta.spend, m.meta.leads)}</td></tr>
        <tr><td><span class="plat google"><i></i>Google</span></td><td>${fmtEur(m.google.spend)}</td><td>${m.google.leads}</td><td>${cpl(m.google.spend, m.google.leads)}</td></tr>
        <tr><td><b>Totale</b></td><td><b>${fmtEur(m.total.spend)}</b></td><td><b>${m.total.leads}</b></td><td><b>${cpl(m.total.spend, m.total.leads)}</b></td></tr>
      </tbody></table></div>
      ${d.results.last7 ? `<div style="margin-top:14px">${kpiHtml(d.results.last7)}<p class="small" style="margin:8px 0 0">Ultimi 7 giorni rispetto ai 7 prima · solo Meta</p></div>` : ''}</div>`;
}

// % dello speso sul programmato: colorata solo a mese chiuso (a metà mese sarebbe sempre "sotto")
function pctTone(c, ym, nowYm) {
  if (c.spentPct === null || ym >= nowYm) return '';
  if (c.spentPct > 105) return 'over';
  return c.spentPct < 95 ? 'under' : 'ok';
}

function planBox(d) {
  const current = store.asOf.slice(0, 7);
  const nowYm = todayRome().slice(0, 7);
  const chans = d.plan[0].channels;
  const head1 = chans.map((c, k) => `<th colspan="3" class="grp${k ? ' sep' : ''}"><span class="plat ${c.kind}"><i></i>${esc(channelLabel(c.title))}</span></th>`).join('');
  const head2 = chans.map((c, k) => `<th${k ? ' class="sep"' : ''}>€/giorno</th><th>Programmato</th><th>Speso</th>`).join('');
  const body = d.plan.map(p => {
    const editable = p.ym >= current;
    const rowCls = p.ym === nowYm ? 'cur' : (p.ym > nowYm ? 'future' : 'past');
    const cells = p.channels.map((c, k) => {
      const mine = (c.kind === 'meta' && d.can.editMeta) || (c.kind === 'google' && d.can.editGoogle);
      const val = c.eur ?? '';
      const input = editable && mine
        ? `<input class="edit${c.proposal ? ' proposal' : ''}" data-act="plan" data-id="${esc(c.id)}" data-ym="${p.ym}" data-old="${val}" value="${val}" inputmode="decimal" aria-label="${esc(channelLabel(c.title))} €/giorno ${monthShort(p.ym)}">`
        : (val === '' ? '<span class="dash">—</span>' : `<span${c.proposal ? ' class="prop" title="proposta da confermare"' : ''}>${fmtEur(val)}</span>`);
      const partial = c.win.days < c.win.daysInMonth || c.win.startDay !== 1;
      const days = editable && mine
        ? `<button class="days-btn" type="button" data-act="days" data-id="${esc(c.id)}" data-ym="${p.ym}" aria-label="Giorni attivi ${esc(channelLabel(c.title))} ${monthShort(p.ym)}">${daysLabel(c.win)}</button>`
        : (partial ? `<span class="days-txt">${daysLabel(c.win)}</span>` : '');
      const spent = c.spent === null ? '<span class="dash">—</span>'
        : `<span class="spent">${fmtEur(c.spent)}</span>${c.spentPct === null ? '' : `<span class="pct ${pctTone(c, p.ym, nowYm)}">${c.spentPct}%</span>`}`;
      return `<td${k ? ' class="sep"' : ''}>${input}${days}</td><td>${c.programmed ? fmtEur(c.programmed) : '<span class="dash">—</span>'}</td><td>${spent}</td>`;
    }).join('');
    const status = p.channels.map(c => c.requestStatus).filter(Boolean).join(' · ');
    return `<tr class="${rowCls}"><td>${monthShort(p.ym)}</td>${cells}<td class="status">${esc(status)}</td></tr>`;
  }).join('');
  const how = d.can.editMeta || d.can.editGoogle
    ? `Modifica il €/giorno e premi Invio, oppure tocca i giorni: va nello Sheet${d.can.editMeta ? ' e, per Meta, anche sulle campagne (mese in corso al prossimo giro orario, mesi futuri dal primo giorno attivo)' : ''}.`
    : 'Speso: Meta dai dati giornalieri, Google dai numeri di Marco; per i mesi più vecchi vale la Spesa Effettiva dello Sheet.';
  return `<div class="box"><div class="box-head"><div><h2>Piano mese per mese</h2><p class="small">${how}</p></div></div>
      <div class="legend-row"><span><i class="prop" style="width:16px;height:12px;padding:0"></i>proposta da confermare</span><span>% = speso sul programmato · colorata a mese chiuso</span></div>
      <div class="scroll-x"><table class="t plan"><thead><tr><th rowspan="2">Mese</th>${head1}<th rowspan="2" class="status-h">Stato</th></tr><tr>${head2}</tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
}

function closingBox(d) {
  if (!d.closing || !d.closing.channels.length) return '';
  const adv = { recover: 'recuperare', carry: 'spostare il residuo', extra_or_notify: 'chiedere extra budget o avvisare la struttura', none: 'niente da fare' };
  const rows = d.closing.channels.map(c => {
    const s = c.suggestion;
    const what = c.delta > 0 ? `sforato di ${fmtEur(c.delta)}` : (c.delta < 0 ? `residuo di ${fmtEur(-c.delta)}` : 'in pari');
    const sugg = s.newEur !== null && s.advice !== 'extra_or_notify'
      ? `Suggerimento: ${adv[s.advice]} a ${monthShort(d.ym)} portando ${channelLabel(c.title)} a ${fmtEur(s.newEur)}/g.`
      : `Suggerimento: ${adv[s.advice]}.`;
    return `<div class="kv"><span><span class="plat ${c.kind}"><i></i>${esc(channelLabel(c.title))}</span> · programmato ${fmtEur(c.programmed)} · speso ${fmtEur(c.spent)}</span><b class="${c.delta > 0 ? 'bad' : (c.delta < 0 ? 'amber' : 'good')}">${esc(what)}</b></div>
      <p class="small" style="margin:4px 0 10px">${esc(sugg)} La decisione va nelle note di chi la prende.</p>`;
  }).join('');
  return `<div class="box"><div class="box-head"><h2>Chiusura di ${monthLong(d.closing.prevYm)}</h2></div>${rows}</div>`;
}

function notesBox(d) {
  const cols = AUTHORS.map(([who, label]) => {
    const items = d.notes[who].map(n => `<div class="note"><time>${ddmm(n.ts.slice(0, 10))}</time>${esc(n.text)}</div>`).join('') || '<p class="small">Nessuna nota.</p>';
    const editor = store.role === who
      ? `<form data-act="note"><textarea name="text" maxlength="2000" placeholder="Scrivi una nota per ${monthShort(d.ym)}"></textarea><button class="btn primary" type="submit">Salva nota</button></form>`
      : '';
    return `<div class="note-col"><h3>${esc(label)}</h3>${items}${editor}</div>`;
  }).join('');
  return `<div class="box"><div class="box-head"><h2>Note di ${monthLong(d.ym)}</h2></div><div class="notes">${cols}</div></div>`;
}

const yms = () => store.state.structures[0]?.channels[0]?.months.map(m => m.ym) || [];

// Piano Meta di un giorno: somma dei €/g dei blocchi Meta attivi quel giorno (finestra "dal giorno" + giorni)
function planFor(d) {
  const byYm = new Map(d.plan.map(p => [p.ym, p.channels.filter(c => c.kind === 'meta')]));
  return (date) => {
    const chans = byYm.get(date.slice(0, 7));
    if (!chans || !chans.length) return null;
    const day = Number(date.slice(8, 10));
    return chans.reduce((a, c) => a + (day >= c.win.startDay && day < c.win.startDay + c.win.days ? (c.eur || 0) : 0), 0);
  };
}

function paint() {
  const d = buildDetail(store.state, store.meta, currentTab, store.ym, store.asOf, store.role, todayRome());
  const list = yms();
  const i = list.indexOf(store.ym);
  const ro = store.role === 'ambra' ? `<span class="ro">${icon('lock', 13)}Sola lettura</span>` : '';
  $d().innerHTML = `<div class="detail-head">
      <button class="back" type="button" data-act="back">${icon('arrowLeft', 16)}Strutture</button>
      <span class="crumbs">Strutture › <b>${esc(currentTab)}</b></span>
      <div class="month-nav"><button type="button" data-act="prevMonth" aria-label="Mese prima"${i <= 0 ? ' disabled' : ''}>${icon('chevronLeft', 16)}</button>
        <span>${monthShort(store.ym)}</span>
        <button type="button" data-act="nextMonth" aria-label="Mese dopo"${i >= list.length - 1 ? ' disabled' : ''}>${icon('chevronRight', 16)}</button></div>
      ${ro}</div>
    <div class="detail-body">
      <header class="dh"><h1>${esc(currentTab)}</h1><p class="sub">${monthLong(store.ym)} · Meta aggiornato al ${ddmm(store.asOf)} · Google da Marco</p></header>
      ${tilesHtml(d)}
      <div class="grid2">${d.channels.map(c => channelBox(c, d)).join('')}</div>
      <section class="panel trend" id="dtrend" aria-label="Andamento"></section>
      ${resultsBox(d)}${planBox(d)}${closingBox(d)}${notesBox(d)}
    </div>`;
  mountTrend(document.getElementById('dtrend'), {
    daily: trendDaily(store.state, store.meta, [currentTab], store.asOf), plan: planFor(d), scope: currentTab, key: 'detail',
  });
}

async function refreshAfter(msg) {
  await reload();
  paint();
  toast(msg);
}

function channelOf(id) {
  return store.state.structures.find(s => s.tab === currentTab).channels.find(c => c.id === id);
}

// Ogni scrittura porta il titolo del blocco: se nello Sheet le colonne si sono spostate, la web app rifiuta.
const titleOf = (id) => channelOf(id).title;

// Variazione Meta oltre il 50%: la seconda conferma arriva PRIMA di qualsiasi scrittura. null = annullato.
async function metaCheck(id, eur) {
  const now = channelView(store.state, store.meta, channelOf(id), store.asOf.slice(0, 7), store.asOf);
  const current = now ? now.dailyBudget : 0;
  const big = current > 0 && Math.abs(eur / current - 1) > 0.5;
  if (big) {
    const ok = await confirmDialog('Variazione grande su Meta',
      `Il budget su Meta passa da <b>${fmtEur(current)}/g</b> a <b>${fmtEur(eur)}/g</b> (${eur > current ? '+' : ''}${Math.round((eur / current - 1) * 100)}%). Confermi?`, 'Confermo');
    if (!ok) return null;
  }
  return { current, big };
}

function sendMetaRequest(id, ym, eur, check) {
  const target = channelView(store.state, store.meta, channelOf(id), ym, store.asOf);
  return post('metaRequest', { channel_id: id, title: titleOf(id), ym, eur, current_budget: check.current, confirm_big: check.big,
    apply_from: applyFrom(target.win, ym, todayRome()) }, store.code);
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'FORM' || b.tagName === 'INPUT') return;
  if (b.dataset.act === 'back') { $d().hidden = true; document.body.style.overflow = ''; renderHome(); return; }
  if (b.dataset.act === 'prevMonth' || b.dataset.act === 'nextMonth') {
    const list = yms();
    const j = list.indexOf(store.ym) + (b.dataset.act === 'prevMonth' ? -1 : 1);
    if (j >= 0 && j < list.length) { store.ym = list[j]; paint(); }
    return;
  }
  b.disabled = true;
  try {
    if (b.dataset.act === 'toMeta') {
      const eur = Number(b.dataset.eur);
      const check = await metaCheck(b.dataset.id, eur);
      if (check) {
        const r = await sendMetaRequest(b.dataset.id, store.ym, eur, check);
        if (r.ok) await refreshAfter('Richiesta inviata: Meta si aggiorna al prossimo giro orario.');
        else toast(`Non salvato: ${r.error}`);
      }
    }
    if (b.dataset.act === 'days') {
      const dd = buildDetail(store.state, store.meta, currentTab, store.ym, store.asOf, store.role, todayRome());
      const c = dd.plan.find(p => p.ym === b.dataset.ym).channels.find(x => x.id === b.dataset.id);
      const change = await daysDialog(c, b.dataset.ym);
      if (change || (change === null && c.requestStale && daysDialog.saved)) {
        let msg = '';
        if (change) {
          const r = await post('savePlan', { channel_id: c.id, title: titleOf(c.id), ym: b.dataset.ym, ...change }, store.code);
          if (!r.ok) { toast(`Non salvato: ${r.error}`); return; }
          msg = 'Giorni salvati nello Sheet.';
        }
        if (c.openRequest) {   // la richiesta Meta del mese riparte dal nuovo primo giorno attivo
          await reload();
          const q = await sendMetaRequest(c.id, b.dataset.ym, Number(c.openRequest.eur),
            { current: Number(c.openRequest.current_budget || 0), big: true });
          msg += q.ok ? ' Richiesta Meta aggiornata alla nuova data.' : ` Richiesta Meta non aggiornata (${q.error}).`;
          msg = msg.trim();
        }
        await refreshAfter(msg);
      }
    }
    if (b.dataset.act === 'lowerPlan') {
      const r = await post('savePlan', { channel_id: b.dataset.id, title: titleOf(b.dataset.id), ym: store.ym, eur: Number(b.dataset.eur) }, store.code);
      if (r.ok) await refreshAfter('Piano aggiornato nello Sheet.'); else toast(`Non salvato: ${r.error}`);
    }
  } finally { b.disabled = false; }
}

async function onKey(e) {
  const i = e.target;
  if (e.key !== 'Enter' || i.dataset.act !== 'plan') return;
  e.preventDefault();
  const eur = parseEur(i.value);
  if (!(eur >= 0)) { toast('Importo non valido: scrivi per esempio 120 oppure 1.200'); return; }
  if (String(eur) === i.dataset.old) return;
  const ch = channelOf(i.dataset.id);
  const check = ch.kind === 'meta' ? await metaCheck(i.dataset.id, eur) : null;
  if (ch.kind === 'meta' && !check) { i.value = i.dataset.old; return; }   // annullato: nulla è stato scritto
  i.disabled = true;
  const r = await post('savePlan', { channel_id: i.dataset.id, title: titleOf(i.dataset.id), ym: i.dataset.ym, eur }, store.code);
  if (!r.ok) { toast(`Non salvato: ${r.error}`); i.disabled = false; return; }
  if (ch.kind === 'meta') {
    const q = await sendMetaRequest(i.dataset.id, i.dataset.ym, eur, check);
    await refreshAfter(q.ok ? 'Piano salvato e richiesta Meta creata.' : `Piano salvato; richiesta Meta non creata (${q.error}).`);
  } else {
    await refreshAfter('Piano salvato nello Sheet.');
  }
}

async function onSubmit(e) {
  const f = e.target.closest('form[data-act]');
  if (!f) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f).entries());
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  let r;
  if (f.dataset.act === 'note') {
    if (!data.text.trim()) { btn.disabled = false; return; }
    r = await post('saveNote', { tab: currentTab, ym: store.ym, text: data.text.trim() }, store.code);
    if (r.ok) await refreshAfter('Nota salvata.');
  }
  if (f.dataset.act === 'google') {
    const num = (v) => (String(v ?? '').trim() === '' ? 0 : parseEur(v));
    r = await post('saveGoogle', { channel_id: f.dataset.id, title: titleOf(f.dataset.id), date: todayRome().slice(0, 7) === store.ym ? todayRome() : `${store.ym}-28`,
      spent_mtd: num(data.spent_mtd), leads_mtd: num(data.leads_mtd), daily_budget: num(data.daily_budget), active: data.active === '1' }, store.code);
    if (r.ok) await refreshAfter(r.sheet === 'aggiornato' ? 'Numeri Google salvati anche nello Sheet.' : 'Numeri Google salvati (nello Sheet c\'era un valore a mano, non toccato).');
  }
  if (r && !r.ok) toast(`Non salvato: ${r.error}`);
  btn.disabled = false;
}

export function openDetail(tab) {
  currentTab = tab;
  paint();
  const d = $d();
  d.hidden = false;
  d.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (!d.dataset.wired) {
    d.addEventListener('click', onClick);
    d.addEventListener('keydown', onKey);
    d.addEventListener('submit', onSubmit);
    d.dataset.wired = '1';
  }
}
