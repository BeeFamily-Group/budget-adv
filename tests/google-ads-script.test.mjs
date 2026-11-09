// Script Google Ads di Marco (google-ads/rhythm-google-ads.js): qui si provano le parti di calcolo,
// la lettura da Google Ads e l'invio girano solo nel suo account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../google-ads/rhythm-google-ads.js');
const L = require('../apps-script/logic.js');

test('periodo: dal primo del mese di ieri a ieri (come i dati Meta)', () => {
  assert.deepEqual(S.periodo('2026-11-09'), { da: '2026-11-01', a: '2026-11-08' });
  assert.deepEqual(S.periodo('2026-12-01'), { da: '2026-11-01', a: '2026-11-30' });   // il primo del mese chiude il mese prima
  assert.deepEqual(S.periodo('2027-01-01'), { da: '2026-12-01', a: '2026-12-31' });
  assert.deepEqual(S.periodo('2028-03-01'), { da: '2028-02-01', a: '2028-02-29' });
});

test('abbinamento campagna → blocco: frammenti del nome, esclusioni, maiuscole indifferenti', () => {
  assert.equal(S.abbina({ campagne: [] }, 'Qualsiasi'), true);
  assert.equal(S.abbina({ campagne: ['estero'] }, 'Cristallo ESTERO DE'), true);
  assert.equal(S.abbina({ campagne: ['estero'] }, 'Cristallo Search IT'), false);
  assert.equal(S.abbina({ campagne: [], escludi: ['estero'] }, 'Cristallo Estero DE'), false);
  assert.equal(S.abbina({ campagne: ['ville', 'villa'] }, 'Sardinia Villa Bianca'), true);
});

const SPESA = [
  { nome: 'Albatros Search IT', costo: 120.456, conversioni: 3.4 },
  { nome: 'Albatros PMax IT', costo: 30, conversioni: 0.7 },
  { nome: 'Albatros Estero DE', costo: 50, conversioni: 1.2 },
];
const CAMPAGNE = [
  { nome: 'Albatros Search IT', attiva: true, budgetId: 'b1', periodoBudget: 'DAILY', budgetGiorno: 30 },
  { nome: 'Albatros PMax IT', attiva: true, budgetId: 'b1', periodoBudget: 'DAILY', budgetGiorno: 30 },   // budget condiviso: una volta sola
  { nome: 'Albatros Brand IT', attiva: false, budgetId: 'b2', periodoBudget: 'DAILY', budgetGiorno: 10 },
  { nome: 'Albatros Estero DE', attiva: true, budgetId: 'b3', periodoBudget: 'DAILY', budgetGiorno: 20 },
];
const BLOCCO = { channel_id: 'Albatros|J', title: 'BUDGET GOOGLE ADS', account: '123-456-7890', campagne: [], escludi: ['estero'] };

test('riepilogo del blocco: speso del mese, lead, €/giorno attivo e stato', () => {
  assert.deepEqual(S.riepilogo(BLOCCO, SPESA, CAMPAGNE, '2026-11-08'), {
    channel_id: 'Albatros|J', title: 'BUDGET GOOGLE ADS', date: '2026-11-08',
    spent_mtd: 150.46, leads_mtd: 4, daily_budget: 30, active: true,
  });
});

test('riepilogo: campagne tutte in pausa = zero e non attivo; nessuna campagna abbinata = niente invio', () => {
  const ferme = CAMPAGNE.map(c => ({ ...c, attiva: false }));
  assert.deepEqual(S.riepilogo(BLOCCO, [], ferme, '2026-11-08'), {
    channel_id: 'Albatros|J', title: 'BUDGET GOOGLE ADS', date: '2026-11-08',
    spent_mtd: 0, leads_mtd: 0, daily_budget: 0, active: false,
  });
  assert.equal(S.riepilogo({ ...BLOCCO, campagne: ['inesistente'] }, SPESA, CAMPAGNE, '2026-11-08'), null);
});

test('riepilogo: un budget a periodo (non giornaliero) non entra nel €/giorno', () => {
  const r = S.riepilogo(BLOCCO, [], [{ nome: 'Albatros X', attiva: true, budgetId: 'b9', periodoBudget: 'CUSTOM_PERIOD', budgetGiorno: 0 }], '2026-11-08');
  assert.equal(r.daily_budget, 0);
  assert.equal(r.active, true);
});

test('il riepilogo passa i controlli della web app (saveGoogle)', () => {
  const r = S.riepilogo(BLOCCO, SPESA, CAMPAGNE, '2026-11-08');
  assert.equal(L.validatePayload('saveGoogle', r), '');
});

test('campagne contate in due blocchi dello stesso account', () => {
  const blocchi = [
    { channel_id: 'Cristallo|J', campagne: [] },
    { channel_id: 'Cristallo|S', campagne: ['estero'] },
  ];
  assert.deepEqual(S.sovrapposizioni(blocchi, ['Cristallo Search', 'Cristallo Estero DE']), ['Cristallo Estero DE']);
  assert.deepEqual(S.sovrapposizioni([{ ...blocchi[0], escludi: ['estero'] }, blocchi[1]], ['Cristallo Search', 'Cristallo Estero DE']), []);
});

test('controllo della configurazione', () => {
  const ok = S.controllaConfig([{ channel_id: 'A|J', title: 'BUDGET GOOGLE ADS', account: '123-456-7890', campagne: [] },
                                 { channel_id: 'B|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] }]);
  assert.deepEqual(ok, { errori: [], daConfigurare: ['B|J'] });
  const bad = S.controllaConfig([{ channel_id: 'A|J', title: 'X', account: '1234567890', campagne: [] },
                                  { channel_id: 'A|J', title: 'X', account: '123-456-7890', campagne: [] }]);
  assert.equal(bad.errori.length, 2);
});

test('la configurazione precompilata copre i 20 blocchi Google dello Sheet, account da inserire', () => {
  const blocchi = S.CONFIG.BLOCCHI;
  assert.equal(blocchi.length, 20);
  assert.equal(new Set(blocchi.map(b => b.channel_id)).size, 20);
  assert.ok(blocchi.every(b => b.account === ''));
  assert.equal(S.CONFIG.ANTEPRIMA, true);
  assert.equal(S.CONFIG.CODICE, 'INCOLLA_QUI_IL_TUO_CODICE');
});

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Giro completo con Google Ads, registro e invio finti: un account con due blocchi (Cristallo Google ed estero).
test('giro completo: legge l\'account, separa i blocchi e invia a saveGoogle con il codice', () => {
  const src = readFileSync(new URL('../google-ads/rhythm-google-ads.js', import.meta.url), 'utf8');
  const sent = [];
  const logs = [];
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const account = { getCustomerId: () => '111-222-3333', getCurrencyCode: () => 'EUR' };
  const ctx = {
    Logger: { log: (m) => logs.push(String(m)) },
    Utilities: { formatDate: () => '2026-11-09' },
    AdsManagerApp: { accounts: () => ({ withIds: (ids) => ({ get: () => iter(ids.includes('111-222-3333') ? [account] : []) }) }), select: () => {} },
    AdsApp: { search: (q) => iter(q.includes('segments.date')
      ? [{ campaign: { name: 'Cristallo Search IT' }, metrics: { costMicros: '120500000', conversions: 4.4 } },
         { campaign: { name: 'Cristallo Estero DE' }, metrics: { costMicros: '80000000', conversions: 1 } }]
      : [{ campaign: { name: 'Cristallo Search IT', status: 'ENABLED', servingStatus: 'SERVING' }, campaignBudget: { resourceName: 'b1', period: 'DAILY', amountMicros: '15000000' } },
         { campaign: { name: 'Cristallo Estero DE', status: 'ENABLED', servingStatus: 'SERVING' }, campaignBudget: { resourceName: 'b2', period: 'DAILY', amountMicros: '10000000' } }]) },
    UrlFetchApp: { fetch: (url, opt) => { sent.push(JSON.parse(opt.payload)); return { getContentText: () => '{"ok":true,"sheet":"aggiornato"}', getResponseCode: () => 200 }; } },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext("CONFIG.ANTEPRIMA = false; CONFIG.CODICE = 'MAR-PROVA'; CONFIG.BLOCCHI.forEach(function (b) { if (b.channel_id.indexOf('Cristallo') === 0) b.account = '111-222-3333'; });", ctx);
  vm.runInContext('main()', ctx);
  const plain = JSON.parse(JSON.stringify(sent));
  assert.deepEqual(plain, [
    { channel_id: 'Cristallo|J', title: 'BUDGET GOOGLE ADS', date: '2026-11-08', spent_mtd: 120.5, leads_mtd: 4, daily_budget: 15, active: true, action: 'saveGoogle', code: 'MAR-PROVA' },
    { channel_id: 'Cristallo|S', title: 'ESTERO GOOGLE ADS', date: '2026-11-08', spent_mtd: 80, leads_mtd: 1, daily_budget: 10, active: true, action: 'saveGoogle', code: 'MAR-PROVA' },
  ]);
  assert.ok(logs.some(l => l.startsWith('Periodo 2026-11-01 → 2026-11-08')));
  assert.ok(!logs.some(l => l.startsWith('ATTENZIONE')));
});
