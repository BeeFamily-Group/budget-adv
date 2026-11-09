import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCards, metaSpent, unassigned, channelLabel, stateLabel } from '../docs/js/viewmodel.js';

test('etichette dei canali', () => {
  assert.equal(channelLabel('BUDGET FACEBOOK ADS'), 'Meta');
  assert.equal(channelLabel('BUDGET FACEBOOK ADS ITALIA'), 'Meta Italia');
  assert.equal(channelLabel('BUDGET FACEBOOK ADS ESTERO'), 'Meta estero');
  assert.equal(channelLabel('BUDGET GOOGLE ADS'), 'Google');
  assert.equal(channelLabel('ESTERO GOOGLE ADS'), 'Google estero');
  assert.equal(channelLabel('GAS GOOGLE ADS'), 'Google GAS');
  assert.equal(channelLabel('BUDGET GOOGLE ADS · VILLE'), 'Google ville');
});

test('etichette dello stato', () => {
  assert.equal(stateLabel('ok', 3), 'in linea');
  assert.equal(stateLabel('under', -32), 'sotto −32%');
  assert.equal(stateLabel('over', 31), 'sopra +31%');
  assert.equal(stateLabel('none', null), 'nessun budget');
});

const state = JSON.parse(readFileSync(new URL('./fixtures/state.json', import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('./fixtures/meta.json', import.meta.url)));
const cards = buildCards(state, meta, '2026-11', '2026-11-14');
const card = (tab) => cards.find(c => c.tab === tab);

test('speso Meta di un canale', () => {
  const s = metaSpent(meta, state.mapping, 'Ciccio|A', '2026-11', '2026-11-14');
  assert.equal(s.spent, 1140);
  assert.equal(s.dailyBudget, 60);
  assert.equal(s.activeCampaigns, 1);
  assert.equal(s.daily.length, 14);
});

test('scheda Ciccio: Meta sotto, Google in linea (esempio della spec)', () => {
  const [m, g] = card('Ciccio').channels;
  assert.equal(m.kind, 'meta');
  assert.equal(m.programmed, 3600);
  assert.equal(m.spent, 1140);
  assert.equal(m.state, 'under');
  assert.equal(m.pct, -32);
  assert.equal(m.perDay, 154);
  assert.equal(g.kind, 'google');
  assert.equal(g.spent, 1050);
  assert.equal(g.updatedOn, '2026-11-12');
  assert.equal(g.stale, false);
  assert.equal(g.state, 'ok');
  assert.equal(card('Ciccio').overall, 'under');
});

test('google: conta solo l\'aggiornamento del mese giusto', () => {
  const oct = buildCards(state, meta, '2026-10', '2026-10-31').find(c => c.tab === 'Ciccio');
  assert.equal(oct.channels[1].spent, 1380);
});

test('kpi 7 giorni solo Meta', () => {
  const k = card('Ciccio').kpi7;
  assert.equal(k.cur.spend, 420);
  assert.equal(k.prev.spend, 720);
  assert.equal(k.pct.spend, -42);
});

test('nessuna nota fissa sulle schede Color (tolta su richiesta di Francesco)', () => {
  assert.equal('caveat' in card('Color Perla Village'), false);
});

test('account non letto: dati fermi al giorno prima (Review Focus 1)', () => {
  assert.equal(card('B612').channels[0].dataStaleSince, '2026-11-13');
  assert.equal(card('Ciccio').channels[0].dataStaleSince, null);
});

test('campagne non assegnate fuori dalle schede ma elencate', () => {
  assert.equal(card('Color Perla Village').channels[0].spent, 700);
  assert.deepEqual(unassigned(state, meta, '2026-11', '2026-11-14'),
    [{ campaign_id: 'x9', name: 'Color Flex Pay - Rete', account_id: '1576344015714351', spent: 30 }]);
});

import { buildDetail, applyFrom } from '../docs/js/viewmodel.js';

const withReq = {
  ...state,
  requests: [{ id: 'r1', channel_id: 'Ciccio|A', ym: '2026-12', eur: 130, current_budget: 60, apply_from: '2026-12-01',
               created_by: 'francesco', created_at: '2026-11-14T10:00:00Z', status: 'scheduled', result: '', updated_at: '' }],
  notes: [{ ts: '2026-11-13T09:00:00Z', tab: 'Ciccio', ym: '2026-11', author: 'ambra', text: 'Il cliente chiede i ponti' },
          { ts: '2026-10-02T09:00:00Z', tab: 'Ciccio', ym: '2026-10', author: 'marco', text: 'ottobre' }],
};

test('dettaglio Ciccio: avviso piano/Meta (esempio della spec)', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  const m = d.channels.find(c => c.kind === 'meta');
  assert.deepEqual(m.alert, { x: 154, y: 70, projected: 2100, gap: -1500 });
  assert.equal(d.channels.find(c => c.kind === 'google').alert, null);
});

test('dettaglio: chiusura del mese precedente', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'ambra');
  assert.equal(d.closing.prevYm, '2026-10');
  const g = d.closing.channels.find(c => c.kind === 'google');
  assert.equal(g.delta, 140);
  assert.deepEqual(g.suggestion, { delta: 140, newEur: 75, advice: 'recover' });
  assert.equal(d.closing.channels.some(c => c.kind === 'meta'), false);   // ottobre Meta vuoto
});

test('dettaglio: permessi per ruolo', () => {
  assert.deepEqual(buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'ambra').can,
                   { editMeta: false, editGoogle: false, note: true, propose: true });
  assert.deepEqual(buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'marco').can,
                   { editMeta: false, editGoogle: true, note: true, propose: false });
  assert.deepEqual(buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', null).can,
                   { editMeta: false, editGoogle: false, note: false, propose: false });
});

test('home: proposte da confermare nel mese scelto e in quello dopo', () => {
  // nel fixture Ciccio Meta ha gennaio 2027 in giallo, dicembre no
  const dec = buildCards(state, meta, '2026-12', '2026-11-14').find(c => c.tab === 'Ciccio');
  assert.deepEqual(dec.proposals, ['2027-01']);
  const nov = buildCards(state, meta, '2026-11', '2026-11-14').find(c => c.tab === 'Ciccio');
  assert.deepEqual(nov.proposals, []);
});

test('dettaglio: stato della richiesta Meta nel piano', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  const dec = d.plan.find(p => p.ym === '2026-12').channels.find(c => c.kind === 'meta');
  assert.equal(dec.requestStatus, 'su Meta dal 01/12');
  assert.equal(d.plan.length, 15);
});

test('dettaglio: note del mese per autore', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  assert.equal(d.notes.ambra.length, 1);
  assert.equal(d.notes.marco.length, 0);
});

test('dettaglio: risultati del mese', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', null);
  assert.deepEqual(d.results.month, { meta: { spend: 1140, leads: 228 }, google: { spend: 1050, leads: 64 },
                                      total: { spend: 2190, leads: 292, cpl: 7.5 } });
});

test('data di applicazione di una modifica Meta', () => {
  assert.equal(applyFrom({ startDay: 1 }, '2026-12', '2026-11-15'), '2026-12-01');
  assert.equal(applyFrom({ startDay: 21 }, '2026-12', '2026-11-15'), '2026-12-21');
  assert.equal(applyFrom({ startDay: 1 }, '2026-11', '2026-11-15'), '2026-11-15');
});

test('nessun avviso piano/Meta se i dati Meta non ci sono ancora', () => {
  const empty = { as_of: null, accounts: {}, campaigns: [], daily: [] };
  const d = buildDetail(withReq, empty, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  assert.equal(d.channels.find(c => c.kind === 'meta').alert, null);
});

import { staleAccounts } from '../docs/js/viewmodel.js';

test('avviso dati fermi solo per account collegati a una scheda', () => {
  const m2 = { ...meta, accounts: { ...meta.accounts, '608324351982441': { ok: false, error: 'not enabled', last_ok: null } } };
  assert.deepEqual(staleAccounts(state, m2), [{ account_id: '433491253104777', name: 'B612', last_ok: '2026-11-13' }]);
});

test('piano mese per mese: giorni attivi e "dal giorno" per ogni canale (review I6)', () => {
  const st = { ...withReq, days: [{ channel_id: 'Ciccio|A', ym: '2026-12', start_day: 16 }] };
  const d = buildDetail(st, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  const nov = d.plan.find(p => p.ym === '2026-11').channels.find(c => c.kind === 'meta');
  assert.deepEqual(nov.win, { startDay: 1, days: 30, daysInMonth: 30 });
  assert.equal(nov.startDayCustom, false);
  const dec = d.plan.find(p => p.ym === '2026-12').channels.find(c => c.kind === 'meta');
  assert.equal(dec.win.startDay, 16);
  assert.equal(dec.win.days, 16);
  assert.equal(dec.startDayCustom, true);
  const req = d.plan.find(p => p.ym === '2026-12').channels.find(c => c.kind === 'meta').openRequest;
  assert.equal(req.id, 'r1');
});

test('mappa con il titolo del blocco: righe che non tornano finiscono in "da assegnare" (review I1)', () => {
  const st = { ...state, mapping: [
    { account_id: '421004342260012', campaign_id: 's27', campaign_name: 'SUMMER_2027', channel_id: 'Ciccio|A', channel_title: 'BUDGET FACEBOOK ADS ESTERO' },
    { account_id: '433491253104777', campaign_id: 'b1', campaign_name: 'Mercatini', channel_id: 'B612 vecchio|A', channel_title: 'BUDGET FACEBOOK ADS' },
    { account_id: '1576344015714351', campaign_id: 'p1', campaign_name: 'Perla Village - Estate 2027', channel_id: 'Color Perla Village|A', channel_title: 'BUDGET FACEBOOK ADS' },
  ] };
  const ciccio = st.structures.find(s => s.tab === 'Ciccio').channels[0];
  assert.equal(metaSpent(meta, st.mapping, ciccio, '2026-11', '2026-11-14').spent, 0);
  const perla = st.structures.find(s => s.tab === 'Color Perla Village').channels[0];
  assert.equal(metaSpent(meta, st.mapping, perla, '2026-11', '2026-11-14').spent, 700);
  const ids = unassigned(st, meta, '2026-11', '2026-11-14').map(u => u.campaign_id).sort();
  assert.deepEqual(ids, ['b1', 's27', 'x9']);
});

test('mese in corso con "dal giorno" più avanti: la modifica parte da quel giorno, non da oggi', () => {
  assert.equal(applyFrom({ startDay: 20 }, '2026-11', '2026-11-15'), '2026-11-20');
  assert.equal(applyFrom({ startDay: 10 }, '2026-11', '2026-11-15'), '2026-11-15');
});

test('richiesta programmata con la data che non torna più con i giorni dello Sheet', () => {
  const st = { ...withReq, days: [{ channel_id: 'Ciccio|A', ym: '2026-12', start_day: 10 }] };
  const d = buildDetail(st, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  const dec = d.plan.find(p => p.ym === '2026-12').channels.find(c => c.kind === 'meta');
  assert.match(dec.requestStatus, /su Meta dal 01\/12 · data da aggiornare: ora dal 10\/12/);
  const ok = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco')
    .plan.find(p => p.ym === '2026-12').channels.find(c => c.kind === 'meta');
  assert.equal(ok.requestStatus, 'su Meta dal 01/12');
});

test('richiesta scaduta: il mese è finito prima di applicarla', () => {
  const st = { ...withReq, requests: [{ ...withReq.requests[0], ym: '2026-10', status: 'expired' }] };
  const d = buildDetail(st, meta, 'Ciccio', '2026-11', '2026-11-14', 'francesco');
  const oct = d.plan.find(p => p.ym === '2026-10').channels.find(c => c.kind === 'meta');
  assert.equal(oct.requestStatus, 'scaduta: il mese è finito prima di applicarla');
});

import { staleText, macLate } from '../docs/js/viewmodel.js';

test('account collegato dal roster: avviso anche senza campagne nella mappa, "mai letti" se non è mai riuscito', () => {
  const m2 = { ...meta, accounts: {
    ...meta.accounts,
    '433491253104777': { ok: false, error: 'x', last_ok: null, tab: 'B612' },
    '1576344015714351': { ok: false, error: 'x', last_ok: '2026-11-12', tab: 'COLOR' },
    '608324351982441': { ok: false, error: 'not enabled', last_ok: null, tab: 'Sardinia' },
  } };
  const st = { ...state, mapping: [] };
  assert.deepEqual(staleAccounts(st, m2), [
    { account_id: '433491253104777', name: 'B612', last_ok: null },
    { account_id: '1576344015714351', name: 'Color Holiday', last_ok: '2026-11-12' },
  ]);
  assert.equal(staleText(null), 'mai letti');
  assert.equal(staleText('2026-11-12'), 'fermi al 12/11');
  const card = buildCards(state, m2, '2026-11', '2026-11-14').find(c => c.tab === 'B612');
  assert.equal(card.channels[0].dataStaleSince, 'mai');
});

test('Mac spento: giorni di ritardo dei dati Meta rispetto a ieri', () => {
  assert.equal(macLate('2026-11-13', '2026-11-14'), 0);
  assert.equal(macLate('2026-11-10', '2026-11-14'), 3);
  assert.equal(macLate(null, '2026-11-14'), null);
});

test('Google fermo si misura da oggi, non dalla data dei dati Meta', () => {
  const card = (today) => buildCards(state, meta, '2026-11', '2026-11-14', today).find(c => c.tab === 'Ciccio');
  assert.equal(card('2026-11-15').channels[1].stale, false);
  assert.equal(card('2026-11-25').channels[1].stale, true);
});

const withMonth = (st, tab, kind, ym, patch) => ({ ...st, structures: st.structures.map(s => s.tab !== tab ? s : {
  ...s, channels: s.channels.map(c => c.kind !== kind ? c : { ...c, months: c.months.map(m => m.ym === ym ? { ...m, ...patch } : m) }),
}) });

test('Spesa Effettiva dello Sheet diversa dallo speso calcolato: si segnala', () => {
  const diff = withMonth(state, 'Ciccio', 'meta', '2026-11', { sheet_spent: 1000 });
  assert.equal(buildCards(diff, meta, '2026-11', '2026-11-14').find(c => c.tab === 'Ciccio').channels[0].sheetMismatch, 1000);
  const same = withMonth(state, 'Ciccio', 'meta', '2026-11', { sheet_spent: 1142 });
  assert.equal(buildCards(same, meta, '2026-11', '2026-11-14').find(c => c.tab === 'Ciccio').channels[0].sheetMismatch, null);
});

test('etichette giuste: Google senza numeri, mese non iniziato, spesa prima dei giorni attivi', () => {
  const noGoogle = { ...state, google: [] };
  const g = buildCards(noGoogle, meta, '2026-11', '2026-11-14').find(c => c.tab === 'Ciccio').channels[1];
  assert.equal(g.state, 'nodata');
  assert.equal(stateLabel(g.state, g.pct), 'numeri da inserire');
  const dec = buildCards(state, meta, '2026-12', '2026-11-14').find(c => c.tab === 'Ciccio').channels[0];
  assert.equal(stateLabel(dec.state, dec.pct), 'non ancora iniziato');
  const late = { ...state, days: [{ channel_id: 'Ciccio|A', ym: '2026-11', start_day: 20 }] };
  const early = buildCards(late, meta, '2026-11', '2026-11-14').find(c => c.tab === 'Ciccio').channels[0];
  assert.equal(stateLabel(early.state, early.pct), 'spesa prima dei giorni attivi');
});

test('scheda di un mese futuro: "non ancora iniziato", non "nessun budget"', () => {
  const c = buildCards(state, meta, '2026-12', '2026-11-14').find(x => x.tab === 'Ciccio');
  assert.equal(c.overall, 'notyet');
  const g = buildCards({ ...state, google: [] }, meta, '2026-11', '2026-11-14').find(x => x.tab === 'Ciccio');
  assert.equal(g.overall, 'under');   // un canale fuori ritmo resta più importante di "numeri da inserire"
});

import { trendDaily, matchQuery } from '../docs/js/viewmodel.js';
import { trendSeries } from '../docs/js/calc.js';

test('andamento: spesa e lead per giorno delle strutture scelte, giorni vuoti a zero', () => {
  const d = trendDaily(state, meta, ['Ciccio'], '2026-11-14');
  assert.equal(d.length, 14);
  assert.equal(d[0].date, '2026-11-01');
  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  assert.equal(sum(d, 'spend'), sum(meta.daily.filter(r => r.campaign_id === 's27'), 'spend'));
  const all = trendDaily(state, meta, state.structures.map(s => s.tab), '2026-11-14');
  const assigned = meta.daily.filter(r => r.campaign_id !== 'x9' && r.date <= '2026-11-14');
  assert.equal(Math.round(sum(all, 'spend')), Math.round(sum(assigned, 'spend')));   // la Flex Pay non assegnata resta fuori
  const holes = trendDaily(state, { ...meta, daily: [{ campaign_id: 's27', date: '2026-11-01', spend: 10, leads: 1 },
    { campaign_id: 's27', date: '2026-11-04', spend: 20, leads: 0 }] }, ['Ciccio'], '2026-11-05');
  assert.deepEqual(holes.map(r => [r.date.slice(8), r.spend]), [['01', 10], ['02', 0], ['03', 0], ['04', 20], ['05', 0]]);
  assert.deepEqual(trendDaily(state, { ...meta, daily: [] }, ['Ciccio'], '2026-11-05'), []);
});

test('serie per giorno: costo per lead sulla media mobile di 7 giorni', () => {
  const daily = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, spend: 10, leads: i === 0 ? 0 : 1 }));
  const s = trendSeries(daily, 'day');
  assert.equal(s.length, 10);
  assert.equal(s[0].cpl, null);
  assert.equal(s[1].cpl, 20);          // 20 € e 1 lead nei giorni 1-2
  assert.equal(s[7].cpl, 10);          // giorni 2-8: 70 € e 7 lead
  assert.equal(s[7].label, '08/11');
});

test('serie per settimana: da lunedì a domenica, le settimane a metà sono segnate', () => {
  const daily = [];
  for (let d = 1; d <= 14; d++) daily.push({ date: `2026-11-${String(d).padStart(2, '0')}`, spend: 10, leads: 2 });
  const w = trendSeries(daily, 'week');
  assert.deepEqual(w.map(x => [x.from, x.to, x.spend, x.leads, x.partial]), [
    ['2026-11-01', '2026-11-01', 10, 2, true],
    ['2026-11-02', '2026-11-08', 70, 14, false],
    ['2026-11-09', '2026-11-14', 60, 12, true],
  ]);
  assert.equal(w[1].cpl, 5);
});

test('piano mese per mese: lo speso reale accanto al programmato', () => {
  const st = withMonth(withReq, 'Ciccio', 'meta', '2026-10', { sheet_spent: 500 });
  const d = buildDetail(st, meta, 'Ciccio', '2026-11', '2026-11-14', 'ambra', '2026-11-15');
  const ch = (ym, kind) => d.plan.find(p => p.ym === ym).channels.find(c => c.kind === kind);
  assert.equal(ch('2026-11', 'meta').spent, 1140);
  assert.equal(ch('2026-11', 'meta').spentPct, 32);
  assert.equal(ch('2026-11', 'google').spent, 1050);
  assert.equal(ch('2026-10', 'google').spent, 1380);
  assert.equal(ch('2026-10', 'meta').spent, 500);      // fuori dai dati Meta: vale la Spesa Effettiva dello Sheet
  assert.equal(ch('2026-12', 'meta').spent, null);     // mese futuro
});

test('ricerca: senza accenti e maiuscole, parole in qualsiasi ordine', () => {
  assert.equal(matchQuery('Città del Mare', 'citta'), true);
  assert.equal(matchQuery('Color Perla Village', 'perla col'), true);
  assert.equal(matchQuery('Ciccio', 'perla'), false);
  assert.equal(matchQuery('Ciccio', '  '), true);
});

// ---- Novità della call con Ambra del 09/11/2026 ----
import { planTotals, prevYearTotals, buildReport } from '../docs/js/viewmodel.js';

test('totale del piano: programmato e speso a oggi per canale e in tutto', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', null, '2026-11-14');
  const t = planTotals(d.plan);
  assert.equal(t.from, '2026-10');
  assert.equal(t.to, '2027-12');
  assert.deepEqual(t.channels.map(c => [c.kind, c.programmed, c.spent]), [['meta', 7320, 1140], ['google', 6120, 2430]]);
  assert.deepEqual(t.total, { programmed: 13440, spent: 3570, remaining: 9870, pct: 27 });
  assert.deepEqual(d.totals, t);
});

test('totale del piano fino a un mese: speso solo dei mesi fino a quello compreso', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', null, '2026-11-14');
  assert.equal(planTotals(d.plan, '2026-10').total.spent, 1380);
});

test('note accanto a ogni mese del piano', () => {
  const d = buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', null, '2026-11-14');
  assert.deepEqual(d.plan.find(p => p.ym === '2026-11').notes.map(n => n.author), ['ambra']);
  assert.deepEqual(d.plan.find(p => p.ym === '2026-10').notes.map(n => n.author), ['marco']);
  assert.equal(d.plan.find(p => p.ym === '2026-12').notes.length, 0);
});

const withPrev = {
  ...withReq,
  structures: withReq.structures.map(s => (s.tab !== 'Ciccio' ? s : {
    ...s,
    channels: s.channels.map(c => ({ ...c, prev: c.kind === 'meta'
      ? { year: 2026, programmed: 40530, spent: 33453.75 } : { year: 2026, programmed: 36110, spent: 26095.66 } })),
  })),
};

test('anno precedente: totali per canale dallo Sheet', () => {
  const p = prevYearTotals(withPrev.structures.find(s => s.tab === 'Ciccio'));
  assert.equal(p.year, 2026);
  assert.deepEqual(p.channels.map(c => [c.kind, c.programmed, c.spent]), [['meta', 40530, 33453.75], ['google', 36110, 26095.66]]);
  assert.deepEqual(p.total, { programmed: 76640, spent: 59549.41, pct: 78 });
  assert.equal(buildDetail(withPrev, meta, 'Ciccio', '2026-11', '2026-11-14', null, '2026-11-14').prev.total.spent, 59549.41);
});

test('anno precedente assente: niente riquadro', () => {
  assert.equal(prevYearTotals(withReq.structures.find(s => s.tab === 'Ciccio')), null);
  const zero = { tab: 'X', channels: [{ id: 'X|A', kind: 'meta', title: 'BUDGET FACEBOOK ADS', prev: { year: 2026, programmed: 0, spent: 0 } }] };
  assert.equal(prevYearTotals(zero), null);
});

test('report di un mese chiuso: speso, mese dopo e avanzamento sul totale', () => {
  const r = buildReport(withReq, meta, 'Ciccio', '2026-10', '2026-11-14', '2026-11-14');
  assert.deepEqual(r.month, { ym: '2026-10', programmed: 1240, spent: 1380, inProgress: false });
  assert.deepEqual(r.next, { ym: '2026-11', programmed: 6000, perDay: 200, days: 30,
                             channels: [{ kind: 'meta', title: 'BUDGET FACEBOOK ADS', eur: 120, days: 30, programmed: 3600 },
                                        { kind: 'google', title: 'BUDGET GOOGLE ADS', eur: 80, days: 30, programmed: 2400 }] });
  assert.deepEqual(r.total, { programmed: 13440, spent: 1380, remaining: 12060, pct: 10 });
  assert.deepEqual([r.from, r.to], ['2026-10', '2027-12']);
});

test('report del mese in corso: speso a oggi', () => {
  const r = buildReport(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', '2026-11-14');
  assert.deepEqual(r.month, { ym: '2026-11', programmed: 6000, spent: 2190, inProgress: true });
  assert.equal(r.next.programmed, 3720 + 2480);
  assert.equal(r.next.perDay, 200);
  assert.equal(r.total.spent, 3570);
});

test('report: canali con giorni diversi nel mese dopo, niente €/giorno unico', () => {
  const st = { ...withReq, days: [{ channel_id: 'Ciccio|J', ym: '2026-12', start_day: 1 }],
    structures: withReq.structures.map(s => (s.tab !== 'Ciccio' ? s : { ...s, channels: s.channels.map(c => (c.kind !== 'google' ? c
      : { ...c, months: c.months.map(m => (m.ym === '2026-12' ? { ...m, days: 15 } : m)) })) })) };
  const r = buildReport(st, meta, 'Ciccio', '2026-11', '2026-11-14', '2026-11-14');
  assert.equal(r.next.perDay, null);
  assert.equal(r.next.days, null);
  assert.deepEqual(r.next.channels.map(c => [c.eur, c.days]), [[120, 31], [80, 15]]);
  assert.equal(r.next.programmed, 3720 + 1200);
});

test('report dell\'ultimo mese del piano: nessun mese dopo', () => {
  assert.equal(buildReport(withReq, meta, 'Ciccio', '2027-12', '2026-11-14', '2026-11-14').next, null);
});

import { prevMonthly } from '../docs/js/viewmodel.js';

test('anno precedente mese per mese: somma dei canali della struttura e quota sull\'anno', () => {
  const storico = { tabs: { Ciccio: {
    'BUDGET FACEBOOK ADS': { '2026-01': { programmed: 100, spent: 300 }, '2026-02': { programmed: 100, spent: 100 } },
    'BUDGET GOOGLE ADS': { '2026-01': { programmed: 50, spent: 100 }, '2026-03': { programmed: 0, spent: null } },
    'ALTRO BLOCCO': { '2026-01': { programmed: 999, spent: 999 } },
  } } };
  const s = withReq.structures.find(x => x.tab === 'Ciccio');
  assert.deepEqual(prevMonthly(storico, s), [
    { ym: '2026-01', spent: 400, share: 80 },
    { ym: '2026-02', spent: 100, share: 20 },
    { ym: '2026-03', spent: 0, share: 0 },
  ]);
  assert.deepEqual(prevMonthly(storico, s, '2026-02'), [{ ym: '2026-01', spent: 400, share: 100 }]);
  assert.equal(prevMonthly(null, s), null);
  assert.equal(prevMonthly({ tabs: {} }, s), null);
});
