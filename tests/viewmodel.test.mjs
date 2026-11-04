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
