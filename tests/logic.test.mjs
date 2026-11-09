import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const L = require('../apps-script/logic.js');
const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet_ciccio.json', import.meta.url)));
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('blocchi Ciccio', () => {
  assert.deepEqual(L.findBlocks(fx.values).map(b => [b.letter, b.kind]), [['A', 'meta'], ['J', 'google']]);
});

test('mesi e proposte', () => {
  const m = L.readMonths(fx.values, fx.bg, 1);
  assert.equal(m.length, 15);
  assert.equal(m[0].ym, '2026-10');
  assert.equal(m[1].ym, '2026-11');
  assert.equal(m[1].eur, 120);
  assert.equal(m[1].days, 30);
  assert.equal(m[1].proposal, false);
  assert.equal(m[3].proposal, true);   // gen 2027 in giallo
  assert.equal(m[0].eur, null);        // ottobre vuoto
});

test('anno precedente dalle righe 9-11 del tab', () => {
  assert.deepEqual(L.readPrevYear(fx.values, 1), { year: 2026, programmed: 40530, spent: 33453.75 });
  assert.deepEqual(L.readPrevYear(fx.values, 10), { year: 2026, programmed: 36110, spent: 26095.66 });
});

test('anno precedente: niente se le etichette non tornano', () => {
  const moved = [...fx.values.slice(0, 8), Array(25).fill(''), ...fx.values.slice(8)];
  assert.equal(L.readPrevYear(moved, 1), null);
  assert.equal(L.readPrevYear([], 1), null);
});

test('id canale', () => assert.equal(L.channelId('Color Perla Village', 'A'), 'Color Perla Village|A'));

test('cella del piano', () => {
  assert.deepEqual(L.planCell(fx.values, 1, '2026-12'), { row: 17, colDays: 2, colEur: 3, colSpend: 5 });
  assert.deepEqual(L.planCell(fx.values, 10, '2027-01'), { row: 18, colDays: 11, colEur: 12, colSpend: 14 });
});

test('cella sbagliata rifiutata (Review Focus 2)', () => {
  const shifted = [...fx.values.slice(0, 16), Array(25).fill(''), ...fx.values.slice(16)];
  assert.throws(() => L.planCell(shifted, 1, '2026-12'), /layout/);
});

test('ruolo dal codice', () => {
  const hashes = { francesco: sha('F-123'), marco: sha('M-456'), ambra: sha('A-789') };
  assert.equal(L.roleFromCode('M-456', hashes, sha), 'marco');
  assert.equal(L.roleFromCode('sbagliato', hashes, sha), null);
  assert.equal(L.roleFromCode('', hashes, sha), null);
});

test('ruoli', () => {
  assert.equal(L.canEditChannel('francesco', 'meta'), true);
  assert.equal(L.canEditChannel('francesco', 'google'), false);
  assert.equal(L.canEditChannel('marco', 'google'), true);
  assert.equal(L.canEditChannel('ambra', 'meta'), false);
  assert.equal(L.canWriteNote('ambra', 'ambra'), true);
  assert.equal(L.canWriteNote('ambra', 'marco'), false);
  assert.equal(L.canWriteNote(null, 'ambra'), false);
});

test('spesa effettiva non sovrascrive valori a mano', () => {
  assert.equal(L.spendWritable('', null), true);
  assert.equal(L.spendWritable(1380, 1380), true);
  assert.equal(L.spendWritable(1400, 1380), false);
  assert.equal(L.spendWritable(1400, null), false);
});

test('richieste Meta: conferma oltre 50% e sostituzione (Review Focus 5)', () => {
  const base = { channel_id: 'Ciccio|A', ym: '2026-11', current_budget: 60, role: 'francesco',
                 now: '2026-11-15T09:00:00Z', apply_from: '2026-11-15' };
  assert.deepEqual(L.newMetaRequest([], { ...base, eur: 154, confirm_big: false }), { error: 'needs_confirm' });
  const r1 = L.newMetaRequest([], { ...base, eur: 154, confirm_big: true });
  assert.equal(r1.request.status, 'pending');
  const r2 = L.newMetaRequest([r1.request], { ...base, eur: 120, confirm_big: true });
  assert.deepEqual(r2.superseded, [r1.request.id]);
  assert.deepEqual(L.newMetaRequest([], { ...base, role: 'marco', eur: 70 }), { error: 'forbidden' });
  assert.equal(L.newMetaRequest([], { ...base, eur: 80 }).request.status, 'pending');   // +33%: nessuna conferma
});

test('richiesta per mese futuro resta programmata', () => {
  const r = L.newMetaRequest([], { channel_id: 'Ciccio|A', ym: '2026-12', eur: 120, current_budget: 120,
    role: 'francesco', now: '2026-11-15T09:00:00Z', apply_from: '2026-12-01', confirm_big: false });
  assert.equal(r.request.status, 'scheduled');
  assert.equal(r.request.apply_from, '2026-12-01');
});

test('mese normalizzato anche se Google lo ha trasformato in data', () => {
  assert.equal(L.ymOf('2026-11'), '2026-11');
  assert.equal(L.ymOf(new Date(Date.UTC(2026, 10, 1))), '2026-11');
  assert.equal(L.ymOf('2026-11-01'), '2026-11');
  assert.equal(L.ymOf(''), '');
});


test('richieste da applicare', () => {
  const reqs = [
    { id: 'a', status: 'pending', apply_from: '2026-11-15' },
    { id: 'b', status: 'scheduled', apply_from: '2026-12-01' },
    { id: 'c', status: 'scheduled', apply_from: '2026-11-10' },
    { id: 'd', status: 'applied', apply_from: '2026-11-01' },
  ];
  assert.deepEqual(L.dueRequests(reqs, '2026-11-15').map(r => r.id), ['a', 'c']);
});

test('valori controllati dal server prima di scrivere (review I2)', () => {
  const v = L.validatePayload;
  assert.equal(v('savePlan', { ym: '2026-11', eur: 120 }), '');
  assert.equal(v('savePlan', { ym: '2026-11', days: 16, start_day: 16 }), '');
  assert.match(v('savePlan', { ym: '2026-11' }), /niente da salvare/);
  assert.match(v('savePlan', { ym: '2026-11', eur: -5 }), /€\/giorno/);
  assert.match(v('savePlan', { ym: '2026-11', eur: 'NaN' }), /€\/giorno/);
  assert.match(v('savePlan', { ym: '2026-11', days: 32 }), /giorni/);
  assert.match(v('savePlan', { ym: '2026-11', start_day: 0 }), /dal giorno/);
  assert.match(v('savePlan', { ym: '11/2026', eur: 10 }), /mese/);
  assert.equal(v('saveGoogle', { date: '2026-11-04', spent_mtd: 1234, leads_mtd: 12, daily_budget: 80 }), '');
  assert.match(v('saveGoogle', { date: '2026-11-04', spent_mtd: NaN, leads_mtd: 0, daily_budget: 0 }), /speso/);
  assert.match(v('saveGoogle', { date: '2026-11-04', spent_mtd: 10, leads_mtd: 1.5, daily_budget: 0 }), /lead/);
  assert.equal(v('metaRequest', { ym: '2026-12', eur: 130, apply_from: '2026-12-01' }), '');
  assert.match(v('metaRequest', { ym: '2026-12', eur: 0, apply_from: '2026-12-01' }), /Gestione inserzioni/);
  assert.match(v('metaRequest', { ym: '2026-12', eur: 130 }), /data/);
  assert.equal(v('writeSpend', { ym: '2026-11', value: 286.59 }), '');
  assert.match(v('writeSpend', { ym: '2026-11', value: -1 }), /speso/);
  assert.equal(v('saveNote', { ym: '2026-11', text: 'x' }), '');
});

test('il blocco si riconosce anche dal titolo: colonne spostate = nessuna scrittura (review I1)', () => {
  const block = { letter: 'J', title: 'ESTERO GOOGLE ADS' };
  assert.equal(L.titleMismatch(block, 'ESTERO GOOGLE ADS', 'Cristallo'), '');
  assert.equal(L.titleMismatch(block, ' estero  google ads ', 'Cristallo'), '');
  assert.match(L.titleMismatch(block, 'BUDGET GOOGLE ADS', 'Cristallo'), /Cristallo.*J.*ESTERO GOOGLE ADS.*Ricarica/);
  assert.match(L.titleMismatch(block, undefined, 'Cristallo'), /ricaricare/);
});

test('tetto di 1.000 €/g contro un codice rubato o un errore di battitura', () => {
  assert.match(L.validatePayload('metaRequest', { ym: '2026-12', eur: 1500, apply_from: '2026-12-01' }), /1\.000/);
  assert.match(L.validatePayload('savePlan', { ym: '2026-12', eur: 1001 }), /1\.000/);
  assert.equal(L.validatePayload('savePlan', { ym: '2026-12', eur: 1000 }), '');
});

test('stato in cache a pezzi: oltre 100 KB la cache funziona ancora', () => {
  const big = 'x'.repeat(250000);
  const parts = L.chunkText(big, 90000);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), big);
  assert.deepEqual(L.chunkText('', 90000), ['']);
});

test('bootstrap chiuso per sempre dopo la prima volta, anche senza hash', () => {
  assert.equal(L.bootstrapClosed({}), false);
  assert.equal(L.bootstrapClosed({ BOOTSTRAPPED: '1' }), true);
  assert.equal(L.bootstrapClosed({ HASH_marco: 'abc' }), true);
});

test('richiesta di un mese ormai finito: scaduta, mai applicata nel mese dopo', () => {
  const reqs = [
    { id: 'a', ym: '2026-10', status: 'pending', apply_from: '2026-10-31' },
    { id: 'b', ym: '2026-11', status: 'pending', apply_from: '2026-11-04' },
    { id: 'c', ym: '2026-12', status: 'scheduled', apply_from: '2026-12-01' },
    { id: 'd', ym: '2026-10', status: 'scheduled', apply_from: '2026-10-20' },
  ];
  assert.deepEqual(L.dueRequests(reqs, '2026-11-01').map(r => r.id), ['b']);
  assert.deepEqual(L.expiredRequests(reqs, '2026-11-01').map(r => r.id), ['a', 'd']);
});

test('esito di una richiesta sostituita durante la run: resta "sostituita"', () => {
  assert.equal(L.resultStatus('pending', 'applied'), 'applied');
  assert.equal(L.resultStatus('superseded', 'applied'), 'superseded');
  assert.equal(L.resultStatus('superseded', 'error'), 'superseded');
});

test('lo stato legge anche la Spesa Effettiva dello Sheet', () => {
  const grid = fx.values.map(r => r.slice());
  grid[15][4] = 1000;   // Novembre 2026, colonna Spesa Effettiva del blocco Meta
  const m = L.readMonths(grid, fx.bg, 1);
  assert.equal(m[1].sheet_spent, 1000);
  assert.equal(m[2].sheet_spent, null);
});

test('scrittura in blocco del piano: motivo, canale, titolo e regole del savePlan', () => {
  const ok = { reason: 'budget Ambra 09/11', items: [
    { channel_id: 'Ciccio|A', title: 'BUDGET FACEBOOK ADS', ym: '2027-01', eur: 127 },
    { channel_id: 'Ciccio|A', title: 'BUDGET FACEBOOK ADS', ym: '2026-11', days: 22, start_day: 9 },
  ] };
  assert.equal(L.validatePlanBatch(ok), '');
  assert.equal(L.validatePlanBatch({ ...ok, reason: '' }), 'manca il motivo');
  assert.equal(L.validatePlanBatch({ reason: 'x', items: [] }), 'nessuna voce');
  assert.match(L.validatePlanBatch({ reason: 'x', items: [{ channel_id: 'Ciccio|A', ym: '2027-01', eur: 1 }] }), /manca canale o titolo/);
  assert.match(L.validatePlanBatch({ reason: 'x', items: [{ ...ok.items[0], eur: 1500 }] }), /voce 1 \(Ciccio\|A 2027-01\): oltre 1\.000/);
  assert.match(L.validatePlanBatch({ reason: 'x', items: [ok.items[0], { ...ok.items[1], start_day: 40 }] }), /voce 2/);
  assert.match(L.validatePlanBatch({ reason: 'x', items: Array(401).fill(ok.items[0]) }), /troppe voci/);
});
