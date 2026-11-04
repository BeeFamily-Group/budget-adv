// Schermata principale: mesi, schede per struttura, campagne da assegnare.
import { getState, getMeta, isDemo } from './api.js';
import { buildCards, unassigned, channelLabel, stateLabel, staleAccounts } from './viewmodel.js';
import { fmtEur } from './calc.js';
import { SHEET_LABEL } from '../config.js';

export const store = { state: null, meta: null, ym: null, asOf: null, onlyOff: false, role: null, code: null };

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
export const monthShort = (ym) => `${MESI[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

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
    </div>
    <div class="small">Ultimi 7 giorni rispetto ai 7 prima · solo Meta</div>`;
}

export function barHtml(c) {
  const fill = c.programmed > 0 ? Math.min(c.spent / c.programmed, 1) * 100 : (c.spent > 0 ? 100 : 0);
  const mark = c.programmed > 0 ? Math.min(c.expected / c.programmed, 1) * 100 : null;
  return `<div class="bar"><i class="${c.state}" style="width:${fill.toFixed(1)}%"></i>${mark === null ? '' : `<b style="left:${mark.toFixed(1)}%"></b>`}</div>`;
}

function channelHtml(c) {
  let right = '';
  if (c.kind === 'meta') right = c.perDay !== null && c.programmed > 0 ? `serve ${fmtEur(c.perDay)}/g` : '';
  else right = c.updatedOn ? `Marco ${ddmm(c.updatedOn)}` : 'Marco: da inserire';
  const flags = [];
  if (c.dataStaleSince) flags.push(`dati fermi al ${ddmm(c.dataStaleSince)}`);
  if (c.kind === 'google' && c.stale && c.programmed > 0) flags.push('Google non aggiornato da più di 7 giorni');
  return `<div>
      <div class="ch-row"><span>${esc(channelLabel(c.title))} <b>${fmtEur(c.spent)}</b> / ${fmtEur(c.programmed)}</span><span>${esc(right)}</span></div>
      ${barHtml(c)}
      ${flags.map(f => `<div class="warn">${esc(f)}</div>`).join('')}
    </div>`;
}

function cardHtml(card) {
  const main = card.channels.find(c => c.state === card.overall) || card.channels[0];
  const chip = main ? `<span class="chip ${card.overall}">${esc(stateLabel(card.overall, main.pct))}</span>` : '';
  return `<button class="card" type="button" data-tab="${esc(card.tab)}" aria-label="Apri ${esc(card.name)}">
      <div class="card-head"><h3>${esc(card.name)}</h3>${chip}</div>
      ${card.channels.map(channelHtml).join('')}
      ${kpiHtml(card.kpi7)}
      ${card.caveat ? `<div class="caveat">${esc(card.caveat)}</div>` : ''}
    </button>`;
}

export function render() {
  const { state, meta, ym, asOf } = store;
  const yms = state.structures[0]?.channels[0]?.months.map(m => m.ym) || [];
  $('months').innerHTML = yms.map(y => `<button type="button" data-ym="${y}" aria-pressed="${y === ym}">${monthShort(y)}</button>`).join('');
  $('freshness').textContent = `Meta aggiornato al ${ddmm(asOf)} · Google inserito da Marco${isDemo() ? ' · DATI DI PROVA' : (SHEET_LABEL ? ` · ${SHEET_LABEL}` : '')}`;

  const stale = staleAccounts(state, meta);
  $('banners').innerHTML = stale.length
    ? `<div class="banner">Dati Meta fermi per ${stale.map(a => `<b>${esc(a.name)}</b> (ultimo dato ${ddmm(a.last_ok)})`).join(', ')}.</div>`
    : '';

  const cards = buildCards(state, meta, ym, asOf);
  const off = cards.filter(c => c.overall === 'under' || c.overall === 'over');
  const shown = store.onlyOff ? off : cards;
  $('count').textContent = `${cards.length} strutture · ${off.length} fuori ritmo`;
  $('cards').innerHTML = shown.length ? shown.map(cardHtml).join('') : '<p class="empty">Nessuna struttura fuori ritmo in questo mese.</p>';

  const un = unassigned(state, meta, ym, asOf);
  $('unassigned').innerHTML = un.length
    ? `<div class="box"><h2>Campagne da assegnare</h2>
        <p class="small">Hanno speso in questo mese ma non sono collegate a nessuna struttura: correggi il tab MAPPA dello Sheet.</p>
        <table class="t"><tr><th>Campagna</th><th>Account</th><th>Speso</th></tr>
        ${un.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.account_id)}</td><td>${fmtEur(u.spent)}</td></tr>`).join('')}</table></div>`
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
  const [state, meta] = await Promise.all([getState(), getMeta()]);
  store.state = state;
  store.meta = meta;
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
  $('onlyOff').addEventListener('change', (e) => { store.onlyOff = e.target.checked; render(); });
  $('cards').addEventListener('click', (e) => {
    const b = e.target.closest('.card');
    if (b) openDetail(b.dataset.tab);
  });
  $('who').addEventListener('click', async () => {
    try { (await import('./auth.js')).openLogin(); } catch (e) { console.error(e); }
  });
  reload()
    .then(() => import('./auth.js').then(m => m.restore()))
    .catch((e) => { $('freshness').textContent = `Errore nel caricamento: ${e.message}`; });
}

init();
