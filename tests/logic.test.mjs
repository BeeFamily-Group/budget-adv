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

test('richieste da applicare', () => {
  const reqs = [
    { id: 'a', status: 'pending', apply_from: '2026-11-15' },
    { id: 'b', status: 'scheduled', apply_from: '2026-12-01' },
    { id: 'c', status: 'scheduled', apply_from: '2026-11-10' },
    { id: 'd', status: 'applied', apply_from: '2026-11-01' },
  ];
  assert.deepEqual(L.dueRequests(reqs, '2026-11-15').map(r => r.id), ['a', 'c']);
});
