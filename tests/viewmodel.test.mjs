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

test('nota fissa sulle schede Color', () => {
  assert.match(card('Color Perla Village').caveat, /Lead Color gonfiati/);
  assert.equal(card('Ciccio').caveat, null);
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
                   { editMeta: false, editGoogle: false, note: true });
  assert.deepEqual(buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', 'marco').can,
                   { editMeta: false, editGoogle: true, note: true });
  assert.deepEqual(buildDetail(withReq, meta, 'Ciccio', '2026-11', '2026-11-14', null).can,
                   { editMeta: false, editGoogle: false, note: false });
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
