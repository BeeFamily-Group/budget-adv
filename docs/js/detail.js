// Dettaglio di una struttura: canali, risultati, piano mese per mese, chiusura, note.
import { buildDetail, channelLabel, stateLabel, channelView, applyFrom } from './viewmodel.js';
import { fmtEur } from './calc.js';
import { store, esc, ddmm, monthShort, kpiHtml, barHtml, reload } from './app.js';
import { post } from './api.js';

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

function chartSvg(c) {
  if (!c.daily || !c.daily.length) return '<p class="small">Nessuna spesa nel mese.</p>';
  const days = c.win.daysInMonth;
  const max = Math.max(c.eur || 0, ...c.daily.map(d => d.spend)) * 1.15 || 1;
  const W = 300; const H = 80; const bw = W / days;
  const bars = c.daily.map(d => {
    const i = Number(d.date.slice(8, 10)) - 1;
    const h = (d.spend / max) * H;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(bw - 2, 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#93c5fd"><title>${ddmm(d.date)}: ${fmtEur(d.spend)}</title></rect>`;
  }).join('');
  const y = c.eur ? H - (c.eur / max) * H : null;
  const line = y === null ? '' : `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#111827" stroke-dasharray="4 3" stroke-width="1.2"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Spesa giorno per giorno">${bars}${line}</svg>
    <div class="small">Spesa giorno per giorno · linea tratteggiata = piano (${fmtEur(c.eur || 0)}/g)</div>`;
}

function channelBox(c, d) {
  const label = channelLabel(c.title);
  const yesterday = c.kind === 'meta' ? (c.daily.find(x => x.date === store.asOf) || { spend: 0 }).spend : null;
  const rows = [];
  if (c.kind === 'meta') {
    rows.push(['Ieri', fmtEur(yesterday)]);
    rows.push(['Impostato su Meta oggi', `${fmtEur(c.dailyBudget)}/g · ${c.activeCampaigns} ${c.activeCampaigns === 1 ? 'campagna attiva' : 'campagne attive'}`]);
  } else {
    rows.push(['Aggiornato', c.updatedOn ? `${ddmm(c.updatedOn)} da Marco` : 'mai']);
    if (c.dailyBudget !== null) rows.push(['Impostato su Google', `${fmtEur(c.dailyBudget)}/g · ${c.activeCampaigns ? 'attive' : 'ferme'}`]);
    if (c.leadsMtd !== null) rows.push(['Lead del mese', String(c.leadsMtd)]);
  }
  rows.push(['Piano €/giorno', `${fmtEur(c.eur || 0)} × ${c.days || 0} gg`]);
  if (c.perDay !== null && c.programmed > 0) rows.push(['Per chiudere il mese servono', `${fmtEur(c.perDay)}/g`]);
  if (c.dataStaleSince) rows.push(['Dati Meta', `fermi al ${ddmm(c.dataStaleSince)}`]);

  let alert = '';
  if (c.alert) {
    const gap = c.alert.gap;
    alert = `<div class="alert">Su Meta sono impostati ${fmtEur(c.dailyBudget)}/g, il piano dice ${fmtEur(c.eur)}/g.
      A questo ritmo il mese chiude a <b>${fmtEur(c.alert.projected)}</b> (${gap > 0 ? '+' : ''}${fmtEur(gap)}).
      ${d.can.editMeta ? `<br><button class="btn primary" data-act="toMeta" data-id="${esc(c.id)}" data-eur="${c.alert.x}">Porta Meta a ${fmtEur(c.alert.x)}/g</button>
        <button class="btn" data-act="lowerPlan" data-id="${esc(c.id)}" data-eur="${c.alert.y}">Abbassa il piano a ${fmtEur(c.alert.y)}/g</button>` : ''}</div>`;
  }
  let googleForm = '';
  if (c.kind === 'google' && d.can.editGoogle && d.ym === store.asOf.slice(0, 7)) {
    googleForm = `<form class="form" data-act="google" data-id="${esc(c.id)}">
        <label>Speso del mese a oggi (€)<input name="spent_mtd" inputmode="decimal" required value="${c.updatedOn ? c.spent : ''}"></label>
        <label>Lead del mese<input name="leads_mtd" inputmode="numeric" value="${c.leadsMtd ?? ''}"></label>
        <label>Budget giornaliero (€)<input name="daily_budget" inputmode="decimal" value="${c.dailyBudget ?? ''}"></label>
        <label>Campagne<select name="active"><option value="1">attive</option><option value="0" ${c.activeCampaigns === 0 ? 'selected' : ''}>ferme</option></select></label>
        <div><button class="btn primary" type="submit">Aggiorna i numeri Google</button></div>
      </form>`;
  }
  return `<div class="box">
      <h2><span>${esc(label)} · ${c.kind === 'meta' ? 'automatico' : 'da Marco'}</span> <span class="chip ${c.state}">${esc(stateLabel(c.state, c.pct))}</span></h2>
      <div class="big">${fmtEur(c.spent)} <small>di ${fmtEur(c.programmed)}</small></div>
      ${barHtml(c)}
      ${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      ${alert}
      ${c.kind === 'meta' ? chartSvg(c) : ''}
      ${googleForm}
    </div>`;
}

function resultsBox(d) {
  const m = d.results.month;
  const cpl = (s, l) => (l > 0 ? `${(s / l).toFixed(2).replace('.', ',')} €` : '—');
  return `<div class="box"><h2>Risultati</h2>
      <table class="t"><tr><th>Questo mese</th><th>Spesa</th><th>Lead</th><th>Costo per lead</th></tr>
        <tr><td>Meta</td><td>${fmtEur(m.meta.spend)}</td><td>${m.meta.leads}</td><td>${cpl(m.meta.spend, m.meta.leads)}</td></tr>
        <tr><td>Google (da Marco)</td><td>${fmtEur(m.google.spend)}</td><td>${m.google.leads}</td><td>${cpl(m.google.spend, m.google.leads)}</td></tr>
        <tr><td><b>Totale</b></td><td><b>${fmtEur(m.total.spend)}</b></td><td><b>${m.total.leads}</b></td><td><b>${cpl(m.total.spend, m.total.leads)}</b></td></tr>
      </table>
      <div style="margin-top:10px">${kpiHtml(d.results.last7)}</div></div>`;
}

function planBox(d) {
  const current = store.asOf.slice(0, 7);
  const chans = d.plan[0].channels;
  const head = chans.map(c => `<th>${esc(channelLabel(c.title))} €/g</th><th>Progr.</th>`).join('');
  const body = d.plan.map(p => {
    const editable = p.ym >= current;
    const cells = p.channels.map(c => {
      const mine = (c.kind === 'meta' && d.can.editMeta) || (c.kind === 'google' && d.can.editGoogle);
      const val = c.eur ?? '';
      const input = editable && mine
        ? `<input class="edit${c.proposal ? ' proposal' : ''}" data-act="plan" data-id="${esc(c.id)}" data-ym="${p.ym}" data-old="${val}" value="${val}" inputmode="decimal" aria-label="${esc(channelLabel(c.title))} ${p.ym}">`
        : `<span${c.proposal ? ' title="proposta da confermare" style="background:var(--proposal);padding:0 4px;border-radius:4px"' : ''}>${val === '' ? '—' : fmtEur(val)}</span>`;
      return `<td>${input}</td><td>${fmtEur(c.programmed)}</td>`;
    }).join('');
    const status = p.channels.map(c => c.requestStatus).filter(Boolean).join(' · ');
    return `<tr${p.ym === d.ym ? ' style="font-weight:600"' : ''}><td>${monthShort(p.ym)}</td>${cells}<td class="status">${esc(status)}</td></tr>`;
  }).join('');
  return `<div class="box"><h2>Piano mese per mese</h2>
      <p class="small">In giallo le proposte da confermare. ${d.can.editMeta || d.can.editGoogle ? 'Modifica il €/giorno e premi Invio: va nello Sheet' + (d.can.editMeta ? ' e, per Meta, anche sulle campagne (mese in corso al prossimo giro orario, mesi futuri dal primo giorno attivo).' : '.') : ''}</p>
      <div style="overflow-x:auto"><table class="t"><tr><th>Mese</th>${head}<th>Stato</th></tr>${body}</table></div></div>`;
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
    return `<div class="kv"><span>${esc(channelLabel(c.title))}: programmato ${fmtEur(c.programmed)} · speso ${fmtEur(c.spent)}</span><b>${esc(what)}</b></div>
      <div class="small">${esc(sugg)} La decisione va nelle note di chi la prende.</div>`;
  }).join('');
  return `<div class="box"><h2>Chiusura di ${monthShort(d.closing.prevYm)}</h2>${rows}</div>`;
}

function notesBox(d) {
  const cols = AUTHORS.map(([who, label]) => {
    const items = d.notes[who].map(n => `<div class="note"><time>${ddmm(n.ts.slice(0, 10))}</time>${esc(n.text)}</div>`).join('') || '<p class="small">Nessuna nota.</p>';
    const editor = store.role === who
      ? `<form data-act="note"><textarea name="text" maxlength="2000" placeholder="Scrivi una nota per ${monthShort(d.ym)}"></textarea><button class="btn primary" type="submit">Salva nota</button></form>`
      : '';
    return `<div class="note-col"><h3>${esc(label)}</h3>${items}${editor}</div>`;
  }).join('');
  return `<div class="box"><h2>Note di ${monthShort(d.ym)}</h2><div class="notes">${cols}</div></div>`;
}

function paint() {
  const d = buildDetail(store.state, store.meta, currentTab, store.ym, store.asOf, store.role);
  const ro = store.role === 'ambra' ? '<span class="ro">Sola lettura · Ambra</span>' : '';
  $d().innerHTML = `<div class="detail-head"><button class="back" type="button" data-act="back">← Indietro</button>
      <h2>${esc(currentTab)} · ${monthShort(store.ym)}</h2>${ro}</div>
    <div class="detail-body">
      <div class="grid2">${d.channels.map(c => channelBox(c, d)).join('')}</div>
      ${resultsBox(d)}${planBox(d)}${closingBox(d)}${notesBox(d)}
      ${currentTab.startsWith('Color ') ? '<p class="small">Lead Color gonfiati: arrivano a coppie (doppio invio browser + server).</p>' : ''}
    </div>`;
}

async function refreshAfter(msg) {
  await reload();
  paint();
  toast(msg);
}

function channelOf(id) {
  return store.state.structures.find(s => s.tab === currentTab).channels.find(c => c.id === id);
}

async function sendMetaRequest(id, ym, eur) {
  const ch = channelOf(id);
  const now = channelView(store.state, store.meta, ch, store.asOf.slice(0, 7), store.asOf);
  const target = channelView(store.state, store.meta, ch, ym, store.asOf);
  const current = now ? now.dailyBudget : 0;
  const big = current > 0 && Math.abs(eur / current - 1) > 0.5;
  if (big) {
    const ok = await confirmDialog('Variazione grande su Meta',
      `Il budget su Meta passa da <b>${fmtEur(current)}/g</b> a <b>${fmtEur(eur)}/g</b> (${eur > current ? '+' : ''}${Math.round((eur / current - 1) * 100)}%). Confermi?`, 'Confermo');
    if (!ok) return { ok: false, error: 'annullato' };
  }
  return post('metaRequest', { channel_id: id, ym, eur, current_budget: current, confirm_big: big,
    apply_from: applyFrom(target.win, ym, todayRome()) }, store.code);
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'FORM' || b.tagName === 'INPUT') return;
  if (b.dataset.act === 'back') { $d().hidden = true; document.body.style.overflow = ''; return; }
  b.disabled = true;
  try {
    if (b.dataset.act === 'toMeta') {
      const r = await sendMetaRequest(b.dataset.id, store.ym, Number(b.dataset.eur));
      if (r.ok) await refreshAfter('Richiesta inviata: Meta si aggiorna al prossimo giro orario.');
      else if (r.error !== 'annullato') toast(`Non salvato: ${r.error}`);
    }
    if (b.dataset.act === 'lowerPlan') {
      const r = await post('savePlan', { channel_id: b.dataset.id, ym: store.ym, eur: Number(b.dataset.eur) }, store.code);
      if (r.ok) await refreshAfter('Piano aggiornato nello Sheet.'); else toast(`Non salvato: ${r.error}`);
    }
  } finally { b.disabled = false; }
}

async function onKey(e) {
  const i = e.target;
  if (e.key !== 'Enter' || i.dataset.act !== 'plan') return;
  e.preventDefault();
  const eur = Number(String(i.value).replace(',', '.'));
  if (!(eur >= 0) || String(i.value).trim() === '' || String(eur) === i.dataset.old) return;
  i.disabled = true;
  const ch = channelOf(i.dataset.id);
  const r = await post('savePlan', { channel_id: i.dataset.id, ym: i.dataset.ym, eur }, store.code);
  if (!r.ok) { toast(`Non salvato: ${r.error}`); i.disabled = false; return; }
  if (ch.kind === 'meta') {
    const q = await sendMetaRequest(i.dataset.id, i.dataset.ym, eur);
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
    const num = (v) => Number(String(v || '0').replace(',', '.'));
    r = await post('saveGoogle', { channel_id: f.dataset.id, date: todayRome().slice(0, 7) === store.ym ? todayRome() : `${store.ym}-28`,
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
