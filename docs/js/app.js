// Schermata principale: ricerca, mesi, andamento, schede per struttura, campagne da assegnare.
import { getState, getMeta, getStorico, isDemo } from './api.js';
import { buildCards, unassigned, channelLabel, stateLabel, staleAccounts, staleText, macLate, trendDaily, matchQuery } from './viewmodel.js';
import { fmtEur } from './calc.js';
import { icon } from './icons.js';
import { mountTrend } from './trend.js';
import { SHEET_LABEL } from '../config.js';

export const store = { state: null, meta: null, storico: null, ym: null, asOf: null, today: null, q: '', onlyOff: false, role: null, code: null };

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
import { monthShort, monthLong } from './months.js';
export { monthShort, monthLong };
export const toneOf = (state) => ({ ok: 'good', under: 'amber', over: 'bad', early: 'bad' }[state] || 'neutral');

export function pctHtml(v, goodWhenUp) {
  if (v === null || v === undefined) return '<span class="neutral">—</span>';
  const cls = goodWhenUp === null ? 'neutral' : (v === 0 ? 'neutral' : ((v > 0) === goodWhenUp ? 'good' : 'bad'));
  return `<span class="${cls}">${v > 0 ? '+' : ''}${v}%</span>`;
}

export function kpiHtml(k) {
  if (!k) return '';
  const cpl = k.cur.cpl === null ? '—' : `${k.cur.cpl.toFixed(2).replace('.', ',')} €`;
  return `<div class="kpis">
      <div class="kpi"><div class="l">Spesa 7 gg</div><div class="v">${fmtEur(k.cur.spend)}</div><div class="d">${pctHtml(k.pct.spend, null)}</div></div>
      <div class="kpi"><div class="l">Lead 7 gg</div><div class="v">${k.cur.leads}</div><div class="d">${pctHtml(k.pct.leads, true)}</div></div>
      <div class="kpi"><div class="l">Costo per lead</div><div class="v">${cpl}</div><div class="d">${pctHtml(k.pct.cpl, false)}</div></div>
    </div>`;
}

export function barHtml(c) {
  const fill = c.programmed > 0 ? Math.min(c.spent / c.programmed, 1) * 100 : (c.spent > 0 ? 100 : 0);
  const mark = c.programmed > 0 && c.expected > 0 ? Math.min(c.expected / c.programmed, 1) * 100 : null;
  return `<div class="bar" aria-hidden="true"><i class="${c.state}" style="width:${fill.toFixed(1)}%"></i>${mark === null ? '' : `<b style="left:${mark.toFixed(1)}%" title="dove dovresti essere oggi"></b>`}</div>`;
}

function channelHtml(c) {
  const close = c.perDay !== null && c.programmed > 0 && c.remaining > 0 ? `servono ${fmtEur(c.perDay)}/g` : '';
  const foot = c.kind === 'meta' ? close
    : (c.updatedOn ? [close, `Marco ${ddmm(c.updatedOn)}`].filter(Boolean).join(' · ') : 'Marco: numeri da inserire');
  const flags = [];
  if (c.dataStaleSince) flags.push(`Dati Meta ${staleText(c.dataStaleSince)}`);
  if (c.kind === 'google' && c.updatedOn && c.stale && c.programmed > 0) flags.push('Google non aggiornato da più di 7 giorni');
  if (c.sheetMismatch !== null && c.sheetMismatch !== undefined) flags.push(`Nello Sheet ${fmtEur(c.sheetMismatch)}: diverso dallo speso`);
  return `<div class="ch">
      <div class="ch-top"><span class="plat ${c.kind}"><i></i>${esc(channelLabel(c.title))}</span>
        <span class="ch-num"><b>${fmtEur(c.spent)}</b> di ${fmtEur(c.programmed)}</span></div>
      ${barHtml(c)}
      <div class="ch-foot"><span>${esc(foot)}</span><span class="${toneOf(c.state)}">${esc(stateLabel(c.state, c.pct))}</span></div>
      ${flags.map(f => `<div class="warn">${icon('alert', 13)}${esc(f)}</div>`).join('')}
    </div>`;
}

function cardHtml(card) {
  const main = card.channels.find(c => c.state === card.overall) || card.channels[0];
  const chip = main ? `<span class="chip ${card.overall}">${esc(stateLabel(card.overall, main.pct))}</span>` : '';
  return `<button class="card" type="button" data-tab="${esc(card.tab)}" aria-label="Apri ${esc(card.name)}">
      <div class="card-head"><h3>${esc(card.name)}</h3><span class="right">${chip}<span class="go">${icon('arrowRight', 16)}</span></span></div>
      ${card.proposals.length ? `<div class="card-prop">Da confermare: ${card.proposals.map(monthShort).join(' e ')}</div>` : ''}
      ${card.channels.map(channelHtml).join('')}
      ${card.kpi7 ? `${kpiHtml(card.kpi7)}<div class="card-foot"><span>Ultimi 7 giorni rispetto ai 7 prima · solo Meta</span></div>` : ''}
    </button>`;
}

function bannersHtml(state, meta) {
  const out = [];
  const late = macLate(meta.as_of, store.today);
  if (late === null || late > 0) {
    out.push(`<b>Dati Meta ${meta.as_of ? `fermi al ${ddmm(meta.as_of)}` : 'non ancora arrivati'}.</b> La routine notturna non è partita, di solito perché il Mac di Francesco era spento: si aggiorna da sola alla prima notte con il Mac acceso, e le modifiche Meta restano in attesa.`);
  }
  const stale = staleAccounts(state, meta);
  if (stale.length) {
    out.push(`<b>Dati Meta non aggiornati</b> per ${stale.map(a => `${esc(a.name)} (${a.last_ok ? `ultimo dato ${ddmm(a.last_ok)}` : 'mai letti'})`).join(', ')}: la dashboard tiene l'ultimo dato buono.`);
  }
  const skipped = state.skipped_tabs || [];
  if (skipped.length) {
    out.push(`<b>Blocchi budget non trovati</b> nello Sheet per ${skipped.map(t => esc(t)).join(', ')}: la riga dei titoli (riga 13) è stata spostata? Finché non si sistema, queste strutture non compaiono qui.`);
  }
  return out.map(t => `<div class="banner" role="status">${icon('alert', 16)}<span>${t}</span></div>`).join('');
}

export function render() {
  const { state, meta, ym, asOf } = store;
  const yms = state.structures[0]?.channels[0]?.months.map(m => m.ym) || [];
  const nowYm = (store.today || asOf).slice(0, 7);
  $('months').innerHTML = yms.map(y => `<button type="button" data-ym="${y}" aria-pressed="${y === ym}"${y === nowYm ? ' class="now" title="mese in corso"' : ''}>${monthShort(y)}</button>`).join('');
  $('freshness').textContent = `Meta aggiornato al ${ddmm(asOf)} · Google da Marco${isDemo() ? ' · DATI DI PROVA' : (SHEET_LABEL ? ` · ${SHEET_LABEL}` : '')}`;
  $('banners').innerHTML = bannersHtml(state, meta);

  const cards = buildCards(state, meta, ym, asOf, store.today);
  const offOf = (c) => c.overall === 'under' || c.overall === 'over' || c.overall === 'early';
  const found = cards.filter(c => matchQuery(c.name, store.q));
  const shown = store.onlyOff ? found.filter(offOf) : found;
  const off = cards.filter(offOf).length;
  $('offCount').textContent = off ? String(off) : '';
  $('onlyOff').setAttribute('aria-pressed', String(store.onlyOff));
  $('count').textContent = `${monthLong(ym)} · ${shown.length === cards.length ? `${cards.length} strutture` : `${shown.length} di ${cards.length} strutture`} · ${off} fuori ritmo`;

  let empty = '';
  if (!shown.length) {
    empty = store.q
      ? `<div class="empty">Nessuna struttura per «${esc(store.q)}»${store.onlyOff ? ' fuori ritmo' : ''}. <button class="pill" type="button" data-clear>${icon('x', 14)}Azzera la ricerca</button></div>`
      : '<p class="empty">Nessuna struttura fuori ritmo in questo mese.</p>';
  }
  $('cards').innerHTML = shown.length ? shown.map(cardHtml).join('') : empty;
  $('cards').setAttribute('aria-busy', 'false');

  const scope = shown.length === cards.length ? `tutte le ${cards.length} strutture`
    : (shown.length === 1 ? shown[0].name : `${shown.length} strutture filtrate`);
  mountTrend($('overview'), { daily: trendDaily(state, meta, shown.map(c => c.tab), asOf), scope, key: 'home' });

  const un = unassigned(state, meta, ym, asOf);
  $('unassigned').innerHTML = un.length
    ? `<div class="box"><div class="box-head"><div><h2>Campagne da assegnare</h2>
        <p class="small">Hanno speso a ${monthLong(ym)} ma non sono collegate a nessuna struttura: correggi il tab MAPPA dello Sheet.</p></div></div>
        <div class="scroll-x"><table class="t"><thead><tr><th>Campagna</th><th>Account</th><th>Speso</th></tr></thead>
        <tbody>${un.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.account_id)}</td><td>${fmtEur(u.spent)}</td></tr>`).join('')}</tbody></table></div></div>`
    : '';
}

async function openDetail(tab) {
  try {
    const m = await import('./detail.js');
    m.openDetail(tab);
  } catch (e) {
    console.error(e);
  }
}

export async function reload() {
  const [state, meta, storico] = await Promise.all([getState(), getMeta(), store.storico ? store.storico : getStorico()]);
  store.state = state;
  store.meta = meta;
  store.storico = storico;
  store.today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  store.asOf = meta.as_of || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  store.ym = store.ym || store.asOf.slice(0, 7);
  render();
}

function init() {
  $('months').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ym]');
    if (!b) return;
    store.ym = b.dataset.ym;
    render();
  });
  $('onlyOff').addEventListener('click', () => { store.onlyOff = !store.onlyOff; render(); });
  $('q').addEventListener('input', (e) => { store.q = e.target.value; render(); });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.value) { e.target.value = ''; store.q = ''; render(); }
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing && $('detail').hidden && $('dialog').hidden) { e.preventDefault(); $('q').focus(); }
  });
  $('cards').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { $('q').value = ''; store.q = ''; render(); $('q').focus(); return; }
    const b = e.target.closest('.card');
    if (b) openDetail(b.dataset.tab);
  });
  $('who').addEventListener('click', async () => {
    try { (await import('./auth.js')).openLogin(); } catch (e) { console.error(e); }
  });
  document.body.classList.add('first-paint');
  reload()
    .then(() => { setTimeout(() => document.body.classList.remove('first-paint'), 700); return import('./auth.js').then(m => m.restore()); })
    .catch((e) => { $('freshness').textContent = `Errore nel caricamento: ${e.message}`; $('count').textContent = 'Dati non disponibili: riprova tra poco.'; });
}

init();
