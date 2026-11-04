// Dallo stato della web app e da meta.json ai dati che la pagina disegna.
import {
  activeWindow, elapsedActiveDays, expectedToDate, pacing, perDayToClose, kpis7, googleStale, alertValues, closeSuggestion,
} from './calc.js';

export function channelLabel(title) {
  const t = String(title).toUpperCase();
  const base = t.includes('FACEBOOK') ? 'Meta' : 'Google';
  if (t.includes('ITALIA')) return `${base} Italia`;
  if (t.includes('ESTERO')) return `${base} estero`;
  if (t.includes('GAS')) return `${base} GAS`;
  if (t.includes('VILLE')) return `${base} ville`;
  if (t.includes('BARCA')) return `${base} barca`;
  return base;
}

export function stateLabel(state, pct) {
  if (state === 'ok') return 'in linea';
  if (state === 'nodata') return 'numeri da inserire';
  if (state === 'notyet') return 'non ancora iniziato';
  if (state === 'early') return 'spesa prima dei giorni attivi';
  if (state === 'under') return `sotto −${Math.abs(pct)}%`;
  if (state === 'over') return pct === null ? 'spesa senza budget' : `sopra +${pct}%`;
  return 'nessun budget';
}

export const COLOR_CAVEAT ='Lead Color gonfiati: arrivano a coppie (doppio invio browser + server)';
const RANK = { over: 3, early: 3, under: 2, ok: 1, nodata: 0.6, notyet: 0.5, none: 0 };
const round2 = (n) => Math.round(n * 100) / 100;

// Una riga MAPPA vale per il canale se ha il suo id e, quando c'è, lo stesso titolo del blocco (righe vecchie senza titolo: valgono).
function rowMatches(r, ch) {
  const id = typeof ch === 'string' ? ch : ch.id;
  const title = typeof ch === 'string' ? null : ch.title;
  return r.channel_id === id && (!r.channel_title || !title || r.channel_title === title);
}

function mappedIds(mapping, ch) {
  return new Set(mapping.filter(r => rowMatches(r, ch)).map(r => String(r.campaign_id)));
}

export function metaSpent(meta, mapping, ch, ym, asOf) {
  const ids = mappedIds(mapping, ch);
  const byDate = new Map();
  for (const r of meta.daily) {
    if (!ids.has(String(r.campaign_id)) || !r.date.startsWith(ym) || r.date > asOf) continue;
    const cur = byDate.get(r.date) || { date: r.date, spend: 0, leads: 0 };
    cur.spend = round2(cur.spend + r.spend);
    cur.leads += r.leads;
    byDate.set(r.date, cur);
  }
  const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const active = meta.campaigns.filter(c => ids.has(String(c.id)) && c.status === 'ACTIVE');
  return {
    spent: round2(daily.reduce((s, d) => s + d.spend, 0)),
    dailyBudget: round2(active.reduce((s, c) => s + (c.daily_budget || 0), 0)),
    activeCampaigns: active.length,
    daily,
  };
}

function latestGoogle(google, channelId, ym) {
  return google
    .filter(g => g.channel_id === channelId && String(g.date).startsWith(ym))
    .sort((a, b) => (String(a.date) + a.ts).localeCompare(String(b.date) + b.ts))
    .pop() || null;
}

function staleSince(meta, mapping, ch) {
  const ids = mappedIds(mapping, ch);
  const accs = new Set(meta.campaigns.filter(c => ids.has(String(c.id))).map(c => c.account_id));
  const dates = [...accs].map(a => meta.accounts[a]).filter(a => a && !a.ok).map(a => a.last_ok || 'mai');
  if (!dates.length) return null;
  return dates.includes('mai') ? 'mai' : dates.sort()[0];
}

// Testo per un canale o un account con i dati Meta fermi: 'mai' (o null) = mai letto.
export function staleText(since) {
  return !since || since === 'mai' ? 'mai letti' : `fermi al ${ddmm(since)}`;
}

// Mac spento: di quanti giorni i dati Meta sono indietro rispetto a ieri (0 = in orario, null = nessun dato).
export function macLate(asOf, today) {
  if (!asOf) return null;
  const day = 86400000;
  const late = Math.round((Date.parse(today) - day - Date.parse(asOf)) / day);
  return late > 0 ? late : 0;
}

function withOverrides(state, ch) {
  return ch.months.map(m => {
    const o = state.days.find(d => d.channel_id === ch.id && d.ym === m.ym);
    return { ...m, start_day: o ? Number(o.start_day) : null };
  });
}

export function channelView(state, meta, ch, ym, asOf, today = asOf) {
  const months = withOverrides(state, ch);
  const i = months.findIndex(m => m.ym === ym);
  if (i === -1) return null;
  const m = months[i];
  const win = activeWindow(months, i);
  const programmed = (m.eur || 0) * (m.days || 0);
  let spent = 0;
  let spentAsOf = asOf;
  let extra;
  let g = null;
  if (ch.kind === 'meta') {
    const s = metaSpent(meta, state.mapping, ch, ym, asOf);
    spent = s.spent;
    extra = { dailyBudget: s.dailyBudget, activeCampaigns: s.activeCampaigns, daily: s.daily,
              updatedOn: null, stale: false, dataStaleSince: staleSince(meta, state.mapping, ch) };
  } else {
    g = latestGoogle(state.google, ch.id, ym);
    spent = g ? Number(g.spent_mtd) : 0;
    spentAsOf = g ? String(g.date) : null;
    extra = { dailyBudget: g ? Number(g.daily_budget) : null, activeCampaigns: g ? (g.active ? 1 : 0) : null,
              leadsMtd: g ? Number(g.leads_mtd) : null, daily: [], updatedOn: g ? String(g.date) : null,
              stale: googleStale(g && String(g.date), today), dataStaleSince: null };
  }
  const elapsed = spentAsOf ? elapsedActiveDays(win, ym, spentAsOf) : 0;
  const expected = expectedToDate(programmed, elapsed, win.days);
  let pace;
  if (programmed === 0 && spent === 0) pace = { state: 'none', pct: null };
  else if (ch.kind === 'google' && !g && programmed > 0 && ym <= today.slice(0, 7)) pace = { state: 'nodata', pct: null };
  else if (programmed > 0 && !(expected > 0)) pace = { state: spent > 0 ? 'early' : 'notyet', pct: null };
  else pace = pacing(spent, expected);
  // Spesa Effettiva dello Sheet diversa da quella calcolata (inserita a mano, per esempio dalle fatture)
  const sheet = m.sheet_spent;
  const sheetMismatch = sheet !== null && sheet !== undefined && ym <= today.slice(0, 7)
    && Math.abs(sheet - spent) > Math.max(5, spent * 0.02) ? sheet : null;
  return {
    id: ch.id, kind: ch.kind, title: ch.title, eur: m.eur, days: m.days, proposal: m.proposal, win,
    programmed, spent, expected, state: pace.state, pct: pace.pct, sheetMismatch,
    perDay: perDayToClose(programmed, spent, win.days - elapsed), remaining: win.days - elapsed,
    ...extra,
  };
}

export function buildCards(state, meta, ym, asOf, today = asOf) {
  return state.structures.map(s => {
    const channels = s.channels.map(ch => channelView(state, meta, ch, ym, asOf, today)).filter(Boolean);
    // I 7 giorni guardano anche a fine mese precedente: si usa il giornaliero completo, non solo il mese scelto.
    const allDaily = new Map();
    for (const ch of s.channels.filter(c => c.kind === 'meta')) {
      const ids = mappedIds(state.mapping, ch);
      for (const r of meta.daily) {
        if (!ids.has(String(r.campaign_id)) || r.date > asOf) continue;
        const cur = allDaily.get(r.date) || { date: r.date, spend: 0, leads: 0 };
        cur.spend = round2(cur.spend + r.spend);
        cur.leads += r.leads;
        allDaily.set(r.date, cur);
      }
    }
    const hasMeta = s.channels.some(c => c.kind === 'meta');
    const overall = channels.reduce((acc, c) => (RANK[c.state] > RANK[acc] ? c.state : acc), 'none');
    return {
      tab: s.tab,
      name: s.tab,
      overall,
      channels,
      kpi7: hasMeta ? kpis7([...allDaily.values()], asOf) : null,
      caveat: s.tab.startsWith('Color ') ? COLOR_CAVEAT : null,
    };
  });
}

export function unassigned(state, meta, ym, asOf) {
  // assegnata = la sua riga MAPPA punta a un blocco che esiste ancora con lo stesso titolo (tab rinominato o colonne spostate: no)
  const channels = state.structures.flatMap(s => s.channels);
  const assigned = new Set(state.mapping.filter(r => channels.some(ch => rowMatches(r, ch))).map(r => String(r.campaign_id)));
  const spent = new Map();
  for (const r of meta.daily) {
    if (assigned.has(String(r.campaign_id)) || !r.date.startsWith(ym) || r.date > asOf || !(r.spend > 0)) continue;
    spent.set(String(r.campaign_id), round2((spent.get(String(r.campaign_id)) || 0) + r.spend));
  }
  return [...spent.entries()].map(([id, value]) => {
    const c = meta.campaigns.find(x => String(x.id) === id) || {};
    return { campaign_id: id, name: c.name || id, account_id: c.account_id || '', spent: value };
  });
}

// Data da cui applicare su Meta una modifica: oggi per il mese in corso, primo giorno attivo per un mese futuro.
export function applyFrom(win, ym, today) {
  const first = `${ym}-${String(win.startDay).padStart(2, '0')}`;
  if (ym === today.slice(0, 7)) return first > today ? first : today;   // mese in corso: da oggi, ma mai prima del primo giorno attivo
  return first;
}

const ddmm = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '');

// Richiesta Meta ancora da applicare (in attesa o programmata) per canale e mese, oppure null.
function openRequest(state, channelId, ym) {
  return state.requests
    .filter(q => q.channel_id === channelId && q.ym === ym && (q.status === 'pending' || q.status === 'scheduled'))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .pop() || null;
}

function requestStatus(state, channelId, ym) {
  const r = state.requests
    .filter(q => q.channel_id === channelId && q.ym === ym && q.status !== 'superseded')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .pop();
  if (!r) return '';
  if (r.status === 'pending') return `in attesa: ${r.eur} €/g`;
  if (r.status === 'scheduled') return `su Meta dal ${ddmm(r.apply_from)}`;
  if (r.status === 'applied') return `applicato il ${ddmm(r.updated_at || r.created_at)}`;
  if (r.status === 'error') return `errore: ${r.result}`;
  if (r.status === 'expired') return 'scaduta: il mese è finito prima di applicarla';
  return r.status;
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function buildDetail(state, meta, tab, ym, asOf, role, today = asOf) {
  const s = state.structures.find(x => x.tab === tab);
  const currentYm = asOf.slice(0, 7);
  const channels = s.channels.map(ch => {
    const v = channelView(state, meta, ch, ym, asOf, today);
    let alert = null;
    if (v && meta.as_of && ch.kind === 'meta' && ym === currentYm && v.programmed > 0 && v.remaining > 0 && v.eur > 0
        && Math.abs(v.dailyBudget - v.eur) / v.eur > 0.10) {
      alert = alertValues({ programmed: v.programmed, spent: v.spent, metaDailyBudget: v.dailyBudget,
                            remaining: v.remaining, activeDays: v.win.days });
    }
    return { ...v, alert, applyFrom: v ? applyFrom(v.win, ym, asOf.slice(0, 10)) : null };
  });

  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
  const metaCh = channels.filter(c => c.kind === 'meta');
  const googleCh = channels.filter(c => c.kind === 'google');
  const metaM = { spend: Math.round(sum(metaCh, c => c.spent) * 100) / 100, leads: sum(metaCh, c => sum(c.daily, d => d.leads)) };
  const googleM = { spend: sum(googleCh, c => c.spent), leads: sum(googleCh, c => c.leadsMtd) };
  const total = { spend: metaM.spend + googleM.spend, leads: metaM.leads + googleM.leads };
  total.cpl = total.leads > 0 ? Math.round((total.spend / total.leads) * 100) / 100 : null;

  const yms = s.channels[0].months.map(m => m.ym);
  const plan = yms.map(y => ({
    ym: y,
    channels: s.channels.map(ch => {
      const months = withOverrides(state, ch);
      const k = months.findIndex(x => x.ym === y);
      const m = months[k];
      const row = { id: ch.id, kind: ch.kind, title: ch.title, eur: m.eur, days: m.days, proposal: m.proposal,
               programmed: (m.eur || 0) * (m.days || 0), requestStatus: ch.kind === 'meta' ? requestStatus(state, ch.id, y) : '',
               win: activeWindow(months, k), startDayCustom: Boolean(m.start_day),
               openRequest: ch.kind === 'meta' ? openRequest(state, ch.id, y) : null };
      // richiesta programmata con una data che non torna piu' con Giorni / "dal giorno" (cambiati anche a mano nello Sheet)
      const q = row.openRequest;
      const due = q && q.status === 'scheduled' ? applyFrom(row.win, y, asOf.slice(0, 10)) : null;
      row.requestStale = Boolean(due && q.apply_from !== due);
      if (row.requestStale) row.requestStatus += ` · data da aggiornare: ora dal ${ddmm(due)}`;
      return row;
    }),
  }));

  let closing = null;
  const prevYm = prevMonth(ym);
  if (yms.includes(prevYm)) {
    const lastDay = `${prevYm}-31`;
    const rows = s.channels.map((ch, k) => {
      const p = channelView(state, meta, ch, prevYm, lastDay < asOf ? lastDay : asOf);
      const n = channels[k];
      if (!p || (p.programmed === 0 && p.spent === 0)) return null;
      return { id: ch.id, kind: ch.kind, title: ch.title, programmed: p.programmed, spent: p.spent,
               delta: Math.round(p.spent - p.programmed),
               suggestion: closeSuggestion({ programmed: p.programmed, spent: p.spent, nextProgrammed: n.programmed,
                                             nextDays: n.days || 0, nextEur: n.eur || 0 }) };
    }).filter(Boolean);
    closing = { prevYm, channels: rows };
  }

  const notes = { francesco: [], marco: [], ambra: [] };
  for (const n of state.notes.filter(x => x.tab === tab && x.ym === ym).sort((a, b) => b.ts.localeCompare(a.ts))) {
    if (notes[n.author]) notes[n.author].push(n);
  }

  return {
    tab, ym, channels, plan, closing, notes,
    results: { month: { meta: metaM, google: googleM, total }, last7: buildCards({ ...state, structures: [s] }, meta, ym, asOf, today)[0].kpi7 },
    can: { editMeta: role === 'francesco', editGoogle: role === 'marco', note: Boolean(role) },
  };
}

// Account Meta non letti, solo se hanno campagne collegate a una scheda (es. Sardinia ha solo Google: niente avviso).
export function staleAccounts(state, meta) {
  // l'account e' collegato a una scheda dal roster (meta.accounts[id].tab); senza roster, dalla MAPPA
  const metaTabs = new Set(state.structures.filter(s => s.channels.some(c => c.kind === 'meta')).map(s => s.tab));
  const tabOf = new Map();
  for (const r of state.mapping) {
    if (!r.channel_id) continue;
    const c = meta.campaigns.find(x => String(x.id) === String(r.campaign_id));
    const acc = c ? c.account_id : String(r.account_id);
    if (!tabOf.has(acc)) tabOf.set(acc, r.channel_id.split('|')[0]);
  }
  const nameOf = (id, a) => {
    if (a.tab === 'COLOR') return [...metaTabs].some(t => t.startsWith('Color ')) ? 'Color Holiday' : null;
    if (a.tab) return metaTabs.has(a.tab) ? a.tab : null;
    return tabOf.get(id) || null;
  };
  return Object.entries(meta.accounts || {})
    .filter(([, a]) => !a.ok)
    .map(([id, a]) => ({ account_id: id, name: nameOf(id, a), last_ok: a.last_ok }))
    .filter(x => x.name)
    .sort((x, y) => x.name.localeCompare(y.name));
}
