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
