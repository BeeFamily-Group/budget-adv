// Andamento Spesa / Lead / Costo per lead: tre grafici piccoli con lo stesso asse dei tempi.
// Mai due scale sullo stesso grafico: ogni misura ha il suo. Il passaggio del mouse (o le frecce da tastiera)
// segna lo stesso giorno su tutti e tre e mostra i tre valori insieme.
import { trendSeries, fmtEur } from './calc.js';
import { icon } from './icons.js';

const SERIES = [
  { key: 'spend', label: 'Spesa', kind: 'bar', color: 'var(--c-spend)' },
  { key: 'leads', label: 'Lead', kind: 'bar', color: 'var(--c-leads)' },
  { key: 'cpl', label: 'Costo per lead', kind: 'line', color: 'var(--c-cpl)' },
];
const MEM = {};   // Giorni/Settimane e Grafico/Tabella restano scelti anche quando la sezione si ridisegna
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const eur2 = (v) => (v === null || v === undefined ? '—'
  : `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const int = (v) => Math.round(v).toLocaleString('it-IT');
const FMT = { spend: (v) => fmtEur(v), leads: int, cpl: eur2 };
const short = (d) => `${Number(d.slice(8, 10))} ${MESI[Number(d.slice(5, 7)) - 1]}`;
const dayName = (d) => GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()];

function compact(v) {
  if (v >= 1000) return `${(v / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}K`;
  return v.toLocaleString('it-IT', { maximumFractionDigits: v < 10 ? 1 : 0 });
}
const axis = (k, v) => (k === 'leads' ? compact(v) : `${compact(v)} €`);

// massimo "rotondo" dell'asse; per i lead solo numeri interi a metà asse
function niceMax(v, integer) {
  if (!(v > 0)) return integer ? 2 : 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  let m = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  if (integer) m = Math.max(2, Math.ceil(m / 2) * 2);
  return m;
}

function ticks(n, k) {
  if (n <= k) return [...Array(n).keys()];
  return [...new Set(Array.from({ length: k }, (_, j) => Math.round((j * (n - 1)) / (k - 1))))];
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function periodLabel(p, mode) {
  if (mode === 'day') return `${dayName(p.from)} ${short(p.from)}`;
  return `${short(p.from)} – ${short(p.to)}${p.partial ? ' (settimana a metà)' : ''}`;
}

function tableHtml(pts, mode) {
  const rows = pts.map(p => `<tr><td>${esc(periodLabel(p, mode))}</td><td>${fmtEur(p.spend)}</td><td>${int(p.leads)}</td><td>${eur2(p.cpl)}</td></tr>`).join('');
  return `<div class="table-wrap"><table class="t">
      <thead><tr><th>${mode === 'day' ? 'Giorno' : 'Settimana'}</th><th>Spesa</th><th>Lead</th><th>Costo per lead${mode === 'day' ? ' (7 gg)' : ''}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function draw(fig, st) {
  const s = SERIES.find(x => x.key === fig.dataset.k);
  const plot = fig.querySelector('.plot');
  const pts = st.pts;
  const W = Math.max(220, Math.round(plot.clientWidth));
  const H = 132; const L = 46; const R = 10; const T = 10; const B = 24;
  const iw = W - L - R; const ih = H - T - B; const n = pts.length; const band = iw / n;
  const val = (p) => p[s.key];
  const plan = s.key === 'spend' ? st.planPts : null;
  const max = niceMax(Math.max(0, ...pts.map(p => val(p) ?? 0), ...(plan ? plan.map(v => v || 0) : [])), s.key === 'leads');
  const x = (i) => L + band * (i + 0.5);
  const y = (v) => T + ih - (v / max) * ih;
  const hv = st.hover;
  let g = '';
  for (const t of [0, max / 2, max]) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`
      + `<text class="ytick" x="${L - 8}" y="${(y(t) + 4).toFixed(1)}">${axis(s.key, t)}</text>`;
  }
  if (s.kind === 'bar') {
    const bw = Math.max(1.5, Math.min(24, band - 2));
    pts.forEach((p, i) => {
      const v = val(p) || 0;
      if (v <= 0) return;
      const h = Math.max(1.5, (v / max) * ih);
      const x0 = x(i) - bw / 2; const y0 = T + ih - h; const r = Math.min(4, bw / 2, h);
      const cls = `bar${p.partial ? ' partial' : ''}${hv === null ? '' : (i === hv ? ' on' : ' off')}`;
      g += `<path class="${cls}" style="fill:${s.color}" d="M${x0.toFixed(1)},${T + ih}V${(y0 + r).toFixed(1)}Q${x0.toFixed(1)},${y0.toFixed(1)} ${(x0 + r).toFixed(1)},${y0.toFixed(1)}H${(x0 + bw - r).toFixed(1)}Q${(x0 + bw).toFixed(1)},${y0.toFixed(1)} ${(x0 + bw).toFixed(1)},${(y0 + r).toFixed(1)}V${T + ih}Z"/>`;
    });
  } else {
    let d = ''; let pen = false;
    pts.forEach((p, i) => {
      const v = val(p);
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    g += `<path class="line" style="stroke:${s.color}" d="${d}"/>`;
    let at = hv !== null && val(pts[hv]) !== null ? hv : null;
    if (at === null) for (let i = n - 1; i >= 0; i--) if (val(pts[i]) !== null) { at = i; break; }
    if (at !== null) g += `<circle class="dot" style="fill:${s.color}" cx="${x(at).toFixed(1)}" cy="${y(val(pts[at])).toFixed(1)}" r="4"/>`;
  }
  if (plan) {
    let d = '';
    plan.forEach((v, i) => {
      if (!(v > 0)) return;
      const a = x(i) - band / 2; const b = x(i) + band / 2;
      const prev = i > 0 && plan[i - 1] > 0;
      d += `${prev ? 'L' : 'M'}${a.toFixed(1)},${y(v).toFixed(1)}H${b.toFixed(1)}`;
    });
    if (d) g += `<path class="plan" d="${d}"/>`;
  }
  ticks(n, Math.max(2, Math.min(7, Math.floor(iw / 72)))).forEach(i => {
    const anchor = n > 1 && i === 0 ? 'start' : (n > 1 && i === n - 1 ? 'end' : 'middle');
    const xx = anchor === 'start' ? x(i) - Math.min(band / 2, 6) : (anchor === 'end' ? x(i) + Math.min(band / 2, 6) : x(i));
    g += `<text class="xtick" x="${xx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${short(pts[i].from)}</text>`;
  });
  if (hv !== null) g += `<line class="cross" x1="${x(hv).toFixed(1)}" x2="${x(hv).toFixed(1)}" y1="${T}" y2="${T + ih}"/>`;
  plot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}</svg>`;
  plot.__geo = { L, band, n, x };
}

function tooltip(root, fig, st) {
  root.querySelectorAll('.tip').forEach(t => { if (t.parentElement !== fig) t.hidden = true; });
  const tip = fig && fig.querySelector('.tip');
  if (!tip) return;
  if (st.hover === null) { tip.hidden = true; return; }
  const p = st.pts[st.hover];
  tip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'tip-h';
  head.textContent = periodLabel(p, st.mode);
  tip.append(head);
  for (const s of SERIES) {
    const row = document.createElement('div');
    row.className = 'tip-r';
    const key = document.createElement('i');
    key.style.background = s.color;
    const v = document.createElement('b');
    v.textContent = FMT[s.key](p[s.key]);
    const l = document.createElement('span');
    l.textContent = s.key === 'cpl' && st.mode === 'day' ? `${s.label} (7 gg)` : s.label;
    row.append(key, v, l);
    tip.append(row);
  }
  const plan = st.planPts && st.planPts[st.hover];
  if (plan > 0) {
    const r = document.createElement('div');
    r.className = 'tip-n';
    r.textContent = `Piano Meta: ${fmtEur(plan)}`;
    tip.append(r);
  }
  tip.hidden = false;
  const plot = fig.querySelector('.plot');
  const cx = plot.offsetLeft + plot.__geo.x(st.hover);
  const w = tip.offsetWidth;
  const left = cx + 14 + w > fig.clientWidth ? cx - 14 - w : cx + 14;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${plot.offsetTop + 2}px`;
}

function drawAll(root, fig) {
  const st = root.__trend;
  if (!st.pts || !st.pts.length || st.view !== 'chart') return;
  root.querySelectorAll('figure.spark').forEach(f => draw(f, st));
  tooltip(root, fig || root.querySelector('figure.spark:focus') || st.lastFig, st);
}

function render(root) {
  const st = root.__trend;
  const pts = trendSeries(st.daily, st.mode);
  st.pts = pts;
  st.planPts = st.plan ? pts.map(p => {
    let sum = 0; let any = false;
    for (let t = Date.parse(`${p.from}T00:00:00Z`); t <= Date.parse(`${p.to}T00:00:00Z`); t += 86400000) {
      const v = st.plan(new Date(t).toISOString().slice(0, 10));
      if (v !== null && v !== undefined) { sum += v; any = true; }
    }
    return any ? sum : null;
  }) : null;
  if (st.hover !== null && st.hover >= pts.length) st.hover = null;
  const tot = pts.reduce((a, p) => ({ spend: a.spend + p.spend, leads: a.leads + p.leads }), { spend: 0, leads: 0 });
  const head = { spend: fmtEur(tot.spend), leads: int(tot.leads), cpl: tot.leads > 0 ? eur2(tot.spend / tot.leads) : '—' };
  const note = {
    spend: st.planPts ? 'nel periodo · tratteggio = piano Meta' : 'nel periodo',
    leads: 'nel periodo',
    cpl: st.mode === 'day' ? 'nel periodo · linea: media 7 giorni' : 'nel periodo · linea: per settimana',
  };
  const range = pts.length ? `${short(pts[0].from)} – ${short(pts[pts.length - 1].to)}` : '';
  const body = !pts.length
    ? `<p class="empty">${icon('chart', 18)} Nessuna spesa Meta nel periodo per ${esc(st.scope)}.</p>`
    : st.view === 'table' ? tableHtml(pts, st.mode)
      : `<div class="seg metric-tabs" role="group" aria-label="Misura">${SERIES.map(s => `<button type="button" data-metric="${s.key}" aria-pressed="${s.key === st.metric}">${s.key === 'cpl' ? 'Costo per lead' : s.label}</button>`).join('')}</div>
      <div class="trend-grid">${SERIES.map(s => `
        <figure class="spark${s.key === st.metric ? ' is-active' : ''}" data-k="${s.key}" tabindex="0" aria-label="${s.label} ${st.mode === 'day' ? 'giorno per giorno' : 'settimana per settimana'}: usa le frecce per leggere i valori">
          <figcaption><span class="lbl"><i class="key key-${s.kind}" style="--c:${s.color}"></i>${s.label}</span>
            <b class="val">${head[s.key]}</b><span class="note">${note[s.key]}</span></figcaption>
          <div class="plot"></div>
          <div class="tip" role="status" hidden></div>
        </figure>`).join('')}</div>`;
  root.innerHTML = `
    <div class="trend-head">
      <div><h2 class="h2">Andamento</h2><p class="sub">Solo Meta · ${esc(st.scope)}${range ? ` · ${range}` : ''}</p></div>
      <div class="trend-ctrl">
        <div class="seg" role="group" aria-label="Raggruppa per">
          <button type="button" data-mode="day" aria-pressed="${st.mode === 'day'}">Giorni</button>
          <button type="button" data-mode="week" aria-pressed="${st.mode === 'week'}">Settimane</button>
        </div>
        <button type="button" class="pill" data-view aria-pressed="${st.view === 'table'}">${icon(st.view === 'table' ? 'chart' : 'table', 14)}${st.view === 'table' ? 'Grafico' : 'Tabella'}</button>
      </div>
    </div>${body}`;
  drawAll(root);
}

function setHover(root, i, fig) {
  const st = root.__trend;
  if (st.hover === i && st.lastFig === fig) return;
  st.hover = i;
  st.lastFig = fig || null;
  drawAll(root, fig);
}

function remember(st) { if (st.key) MEM[st.key] = { mode: st.mode, view: st.view, metric: st.metric }; }

function wire(root) {
  root.addEventListener('click', (e) => {
    const st = root.__trend;
    const k = e.target.closest('[data-metric]');
    if (k) { st.metric = k.dataset.metric; st.hover = null; remember(st); render(root); return; }
    const m = e.target.closest('[data-mode]');
    if (m) { st.mode = m.dataset.mode; st.hover = null; remember(st); render(root); return; }
    if (e.target.closest('[data-view]')) { st.view = st.view === 'table' ? 'chart' : 'table'; st.hover = null; remember(st); render(root); }
  });
  root.addEventListener('pointermove', (e) => {
    const fig = e.target.closest('figure.spark');
    const geo = fig && fig.querySelector('.plot').__geo;
    if (!geo) return;
    const px = e.clientX - fig.querySelector('.plot').getBoundingClientRect().left;
    const i = Math.floor((px - geo.L) / geo.band);
    setHover(root, i >= 0 && i < geo.n ? i : null, fig);
  });
  root.addEventListener('pointerleave', () => setHover(root, null, null));
  root.addEventListener('keydown', (e) => {
    const fig = e.target.closest('figure.spark');
    if (!fig) return;
    const st = root.__trend;
    const n = st.pts.length;
    const cur = st.hover === null ? n - 1 : st.hover;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 }[e.key];
    if (e.key === 'Escape') { setHover(root, null, null); return; }
    if (next === undefined) return;
    e.preventDefault();
    setHover(root, Math.max(0, Math.min(n - 1, st.hover === null ? n - 1 : next)), fig);
  });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) setHover(root, null, null); });
  let lastW = 0;
  new ResizeObserver(() => {
    const w = root.clientWidth;
    if (Math.abs(w - lastW) < 2) return;
    lastW = w;
    drawAll(root);
  }).observe(root);
}

// daily: [{date, spend, leads}] · plan: funzione data -> €/g del piano Meta (o null) · scope: di chi sono i dati
export function mountTrend(root, { daily, plan = null, scope = '', key = '' }) {
  if (!root.__trend) { root.__trend = { mode: 'day', view: 'chart', metric: 'spend', hover: null, key, ...(MEM[key] || {}) }; wire(root); }
  Object.assign(root.__trend, { daily, plan, scope, hover: null });
  render(root);
}
