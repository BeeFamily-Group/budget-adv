// Calcoli della dashboard: ritmo di spesa, giorni attivi, avviso piano/Meta, chiusura mese, 7 giorni.
// Tutte le date sono stringhe 'YYYY-MM-DD' (o 'YYYY-MM' per il mese) e si trattano in UTC.

const DAY_MS = 86400000;

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d || 1);
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const hasBudget = (m) => Boolean(m && m.eur > 0 && m.days > 0);

// Finestra dei giorni attivi del mese i. Mese di partenza (prima senza budget, dopo sì):
// ultimi N giorni; altrimenti i primi N. start_day (tab GIORNI) vince su tutto.
export function activeWindow(months, i) {
  const m = months[i];
  const dim = daysInMonth(m.ym);
  const days = Math.min(m.days > 0 ? m.days : dim, dim);
  let startDay = 1;
  if (m.start_day) {
    startDay = m.start_day;
  } else if (days < dim && !hasBudget(months[i - 1]) && hasBudget(months[i + 1])) {
    startDay = dim - days + 1;
  }
  return { startDay, days, daysInMonth: dim };
}

// Giorni attivi del mese trascorsi fino ad asOf compreso.
export function elapsedActiveDays(win, ym, asOf) {
  const monthStart = parseDate(`${ym}-01`);
  const monthEnd = monthStart + (win.daysInMonth - 1) * DAY_MS;
  const t = parseDate(asOf);
  if (t < monthStart) return 0;
  if (t > monthEnd) return win.days;
  const day = new Date(t).getUTCDate();
  return Math.min(Math.max(day - win.startDay + 1, 0), win.days);
}

export function expectedToDate(programmed, elapsed, total) {
  return total > 0 ? (programmed * elapsed) / total : 0;
}

export function pacing(spent, expected, tol = 0.10) {
  if (!(expected > 0)) return { state: spent > 0 ? 'over' : 'none', pct: null };
  const ratio = spent / expected;
  const pct = Math.round((ratio - 1) * 100);
  if (Math.abs(ratio - 1) <= tol) return { state: 'ok', pct };
  return { state: ratio < 1 ? 'under' : 'over', pct };
}

export function perDayToClose(programmed, spent, remaining) {
  if (!(remaining > 0)) return null;
  return Math.ceil(Math.max(programmed - spent, 0) / remaining);
}

export function projection(spent, dailyBudget, remaining) {
  return spent + dailyBudget * Math.max(remaining, 0);
}

export function alertValues({ programmed, spent, metaDailyBudget, remaining, activeDays }) {
  const projected = projection(spent, metaDailyBudget, remaining);
  return {
    x: perDayToClose(programmed, spent, remaining),
    y: activeDays > 0 ? Math.round(projected / activeDays) : null,
    projected,
    gap: projected - programmed,
  };
}

// delta > 0 = sforato, delta < 0 = residuo. Il suggerimento ridistribuisce la differenza sul mese dopo.
export function closeSuggestion({ programmed, spent, nextProgrammed, nextDays, nextEur }) {
  const delta = Math.round(spent - programmed);
  if (delta === 0) return { delta, newEur: null, advice: 'none' };
  if (!(nextDays > 0)) return { delta, newEur: null, advice: delta > 0 ? 'extra_or_notify' : 'carry' };
  const newEur = Math.round((nextProgrammed - delta) / nextDays);
  if (newEur < 0.5 * nextEur) return { delta, newEur, advice: 'extra_or_notify' };
  return { delta, newEur, advice: delta > 0 ? 'recover' : 'carry' };
}

const round2 = (n) => Math.round(n * 100) / 100;
const pctChange = (cur, prev) => (prev > 0 && cur !== null ? Math.round((cur / prev - 1) * 100) : null);

function sumWindow(daily, fromMs, toMs) {
  let spend = 0;
  let leads = 0;
  for (const r of daily) {
    const t = parseDate(r.date);
    if (t >= fromMs && t <= toMs) {
      spend += r.spend || 0;
      leads += r.leads || 0;
    }
  }
  return { spend: round2(spend), leads, cpl: leads > 0 ? round2(spend / leads) : null };
}

// Ultimi 7 giorni fino ad asOf compreso contro i 7 precedenti.
export function kpis7(daily, asOf) {
  const end = parseDate(asOf);
  const cur = sumWindow(daily, end - 6 * DAY_MS, end);
  const prev = sumWindow(daily, end - 13 * DAY_MS, end - 7 * DAY_MS);
  return {
    cur,
    prev,
    pct: {
      spend: pctChange(cur.spend, prev.spend),
      leads: pctChange(cur.leads, prev.leads),
      cpl: pctChange(cur.cpl, prev.cpl),
    },
  };
}

export function googleStale(lastDate, asOf, maxDays = 7) {
  if (!lastDate) return true;
  return (parseDate(asOf) - parseDate(lastDate)) / DAY_MS > maxDays;
}

export function fmtEur(n) {
  const v = Math.round(n);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 ? '-' : ''}${s} €`;
}

export { isoDate, parseDate };
