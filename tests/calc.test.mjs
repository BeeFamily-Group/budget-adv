import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWindow, elapsedActiveDays, expectedToDate, pacing, perDayToClose, projection,
  alertValues, closeSuggestion, kpis7, googleStale, fmtEur,
} from '../docs/js/calc.js';

// Ciccio, novembre 2026, dati al 14/11 (esempio approvato nella spec)
test('expected/pacing/perDay Ciccio', () => {
  assert.equal(expectedToDate(3600, 14, 30), 1680);
  assert.deepEqual(pacing(1140, 1680), { state: 'under', pct: -32 });
  assert.equal(perDayToClose(3600, 1140, 16), 154);
  assert.equal(projection(1140, 60, 16), 2100);
  assert.deepEqual(
    alertValues({ programmed: 3600, spent: 1140, metaDailyBudget: 60, remaining: 16, activeDays: 30 }),
    { x: 154, y: 70, projected: 2100, gap: -1500 },
  );
});

test('pacing in linea entro 10%', () => assert.equal(pacing(1050, 960).state, 'ok'));   // +9%

test('pacing sopra oltre 10%', () => assert.deepEqual(pacing(980, 750), { state: 'over', pct: 31 }));

test('pacing senza programmato', () => assert.equal(pacing(0, 0).state, 'none'));

test('activeWindow regole giorni', () => {
  const m = (ym, days, eur) => ({ ym, days, eur, start_day: null });
  // Color ottobre 2026: primo mese, 11 giorni -> ultimi 11 (dal 21)
  assert.deepEqual(activeWindow([m('2026-10', 11, 50), m('2026-11', 30, 50)], 0), { startDay: 21, days: 11, daysInMonth: 31 });
  // Sogno gen 2027: dic vuoto, feb pieno -> ultimi 10 (dal 22)
  assert.equal(activeWindow([m('2026-12', 31, null), m('2027-01', 10, 20), m('2027-02', 28, 20)], 1).startDay, 22);
  // Cirillo ago 2027: lug pieno, set vuoto -> primi 15
  assert.equal(activeWindow([m('2027-07', 31, 30), m('2027-08', 15, 30), m('2027-09', 30, null)], 1).startDay, 1);
  // override da tab GIORNI
  assert.equal(activeWindow([{ ym: '2026-12', days: 16, eur: 20, start_day: 10 }], 0).startDay, 10);
});

test('giorni attivi trascorsi', () => {
  const win = { startDay: 21, days: 11, daysInMonth: 31 };
  assert.equal(elapsedActiveDays(win, '2026-10', '2026-10-20'), 0);
  assert.equal(elapsedActiveDays(win, '2026-10', '2026-10-25'), 5);
  assert.equal(elapsedActiveDays(win, '2026-10', '2026-11-03'), 11);   // mese finito
  assert.equal(elapsedActiveDays(win, '2026-10', '2026-09-30'), 0);    // mese non iniziato
});

test('primo giorno e fine mese senza divisioni per zero', () => {
  assert.equal(expectedToDate(600, 0, 30), 0);
  assert.equal(expectedToDate(0, 0, 0), 0);
  assert.equal(perDayToClose(600, 600, 0), null);
});

test('chiusura mese', () => {
  assert.deepEqual(
    closeSuggestion({ programmed: 1240, spent: 1380, nextProgrammed: 2400, nextDays: 30, nextEur: 80 }),
    { delta: 140, newEur: 75, advice: 'recover' },
  );
  const carry = closeSuggestion({ programmed: 1000, spent: 800, nextProgrammed: 600, nextDays: 30, nextEur: 20 });
  assert.deepEqual(carry, { delta: -200, newEur: 27, advice: 'carry' });
  assert.equal(
    closeSuggestion({ programmed: 1000, spent: 1400, nextProgrammed: 600, nextDays: 30, nextEur: 20 }).advice,
    'extra_or_notify',
  );
  assert.equal(closeSuggestion({ programmed: 500, spent: 500, nextProgrammed: 600, nextDays: 30, nextEur: 20 }).advice, 'none');
});

test('kpi 7 giorni', () => {
  const d = (day, spend, leads) => ({ date: `2026-11-${String(day).padStart(2, '0')}`, spend, leads });
  const daily = [1, 2, 3, 4, 5, 6, 7].map(n => d(n, 60, 12))
    .concat([13, 12, 13, 12, 13, 12, 12].map((l, k) => d(8 + k, 60, l)));
  const k = kpis7(daily, '2026-11-14');
  assert.deepEqual(k.cur, { spend: 420, leads: 87, cpl: 4.83 });
  assert.deepEqual(k.prev, { spend: 420, leads: 84, cpl: 5 });
  assert.deepEqual(k.pct, { spend: 0, leads: 4, cpl: -3 });
});

test('google fermo dopo 7 giorni', () => {
  assert.equal(googleStale('2026-11-07', '2026-11-15'), true);
  assert.equal(googleStale('2026-11-08', '2026-11-15'), false);
  assert.equal(googleStale(null, '2026-11-15'), true);
});

test('formato euro', () => {
  assert.equal(fmtEur(1234.4), '1.234 €');
  assert.equal(fmtEur(-1500), '-1.500 €');
  assert.equal(fmtEur(70), '70 €');
});
