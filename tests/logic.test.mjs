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

test('chi scrive il piano: titolare del canale o proposta di Ambra sui mesi futuri', () => {
  assert.equal(L.planWriteMode('francesco', 'meta', '2026-12', '2026-11'), 'owner');
  assert.equal(L.planWriteMode('marco', 'google', '2026-11', '2026-11'), 'owner');
  assert.equal(L.planWriteMode('francesco', 'google', '2026-12', '2026-11'), null);
  assert.equal(L.planWriteMode('ambra', 'meta', '2026-12', '2026-11'), 'proposal');
  assert.equal(L.planWriteMode('ambra', 'google', '2027-03', '2026-11'), 'proposal');
  assert.equal(L.planWriteMode('ambra', 'meta', '2026-11', '2026-11'), null);   // mese in corso: si usa la nota
  assert.equal(L.planWriteMode('ambra', 'meta', '2026-10', '2026-11'), null);
  assert.equal(L.planWriteMode(null, 'meta', '2026-12', '2026-11'), null);
});

test('nota automatica della proposta: canale, prima e dopo', () => {
  const was = { eur: 25, days: 31, start_day: 1 };
  assert.equal(L.proposalNote('BUDGET FACEBOOK ADS', was, { eur: 30 }), 'Proposta Meta: 25 → 30 €/g');
  assert.equal(L.proposalNote('BUDGET FACEBOOK ADS ESTERO', was, { eur: 30 }), 'Proposta Meta estero: 25 → 30 €/g');
  assert.equal(L.proposalNote('BUDGET GOOGLE ADS', was, { days: 15, start_day: 16 }), 'Proposta Google: giorni 31 → 15, dal 16');
  assert.equal(L.proposalNote('BUDGET FACEBOOK ADS', was, { eur: 30, days: 15, start_day: 16 }),
               'Proposta Meta: 25 → 30 €/g, giorni 31 → 15, dal 16');
  assert.equal(L.proposalNote('BUDGET FACEBOOK ADS', { eur: null, days: 31, start_day: 1 }, { eur: 30 }), 'Proposta Meta: — → 30 €/g');
  assert.equal(L.proposalNote('BUDGET FACEBOOK ADS', was, { eur: 25, days: 31 }), '');
});

test('conferma di una proposta: mese e €/giorno visti da chi conferma', () => {
  assert.equal(L.validatePayload('confirmPlan', { ym: '2027-01', eur: 30 }), '');
  assert.equal(L.validatePayload('confirmPlan', { ym: '2027-01', eur: 0 }), '');
  assert.equal(L.validatePayload('confirmPlan', { ym: '2027-01' }), '€/giorno non valido');
  assert.equal(L.validatePayload('confirmPlan', { ym: '2027-13', eur: 30 }), 'mese non valido');
});

// Blocco nuovo in un tab cliente (azione di routine addBlock, 11/11: Albatros Google estero).
test('lettere di colonna → numero', () => {
  assert.equal(L.colIndex('A'), 1);
  assert.equal(L.colIndex('S'), 19);
  assert.equal(L.colIndex('AA'), 27);
  assert.equal(L.colLetter(L.colIndex('AB')), 'AB');
});

test('blocco nuovo: griglia dalla riga 9 alla 32, mesi interi, formule sulle colonne nuove', () => {
  const g = L.newBlockGrid(19, 'ESTERO GOOGLE ADS', { year: 2026, programmed: 4500, spent: 4589 });   // S = 19
  assert.equal(g.length, 24);
  assert.ok(g.every(r => r.length === 7));
  assert.deepEqual(g[0], ['', 2026, 2027, '', '', '', '']);                                   // riga 9
  assert.deepEqual(g[1], ['Programmato', 4500, '=V30', '', '', '', '']);
  assert.deepEqual(g[2], ['Investito', 4589, '=W30', '', '', '', '']);
  assert.deepEqual(g[3], ['', '', '', '', '', '', '']);
  assert.deepEqual(g[4], ['ESTERO GOOGLE ADS - metodo di pagamento:', '', '', '', '', '', '']);  // riga 13
  assert.deepEqual(g[5], ['Mese', 'Giorni', '€ / Giorno', '€ Programmati', 'Spesa Effettiva', 'Δ (Spesa - Prog.)', 'Note']);
  assert.deepEqual(g[6], ['Ottobre 2026', 31, '', '=U15*T15', '', '=IF(W15="","",W15-V15)', '']);   // riga 15
  assert.deepEqual(g[10].slice(0, 2), ['Febbraio 2027', 28]);
  assert.deepEqual(g[20].slice(0, 4), ['Dicembre 2027', 31, '', '=U29*T29']);
  assert.deepEqual(g[21], ['TOTALE', '', '', '=SUM(V15:V29)', '=SUM(W15:W29)', '=W30-V30', '']);
  assert.deepEqual(g[22], ['di cui ott–dic 2026', '', '', '=SUM(V15:V17)', '=SUM(W15:W17)', '', '']);
  assert.deepEqual(g[23], ['di cui gen–dic 2027', '', '', '=SUM(V18:V29)', '=SUM(W18:W29)', '', '']);
  // la dashboard ritrova il blocco e l'anno precedente
  const grid = Array.from({ length: 32 }, () => Array(25).fill(''));
  g.forEach((row, i) => row.forEach((v, j) => { grid[8 + i][18 + j] = v; }));
  assert.deepEqual(L.findBlocks(grid).map(b => [b.letter, b.kind, b.title]), [['S', 'google', 'ESTERO GOOGLE ADS']]);
  assert.deepEqual(L.readPrevYear(grid, 19), { year: 2026, programmed: 4500, spent: 4589 });
});

test('blocco nuovo senza anno precedente: niente confronto', () => {
  const g = L.newBlockGrid(19, 'ESTERO GOOGLE ADS');
  assert.deepEqual(g[0], ['', '', '', '', '', '', '']);
  assert.deepEqual(g[1], ['Programmato', '', '=V30', '', '', '', '']);
});

test('totale in testa al tab: il blocco nuovo si aggiunge una volta sola', () => {
  assert.equal(L.extendTotal('=D30+M30', 'V30'), '=D30+M30+V30');
  assert.equal(L.extendTotal('=D30+M30+V30', 'V30'), '=D30+M30+V30');
  assert.throws(() => L.extendTotal('', 'V30'), /formula/);
  assert.throws(() => L.extendTotal(84220, 'V30'), /formula/);
});

test('controlli di addBlock', () => {
  const ok = { reason: 'Albatros estero', tab: 'Albatros', from_letter: 'J', to_letter: 'S', title: 'ESTERO GOOGLE ADS',
               prev: { year: 2026, programmed: 4500, spent: 4589 } };
  assert.equal(L.validateAddBlock(ok), '');
  assert.equal(L.validateAddBlock({ ...ok, prev: undefined }), '');
  assert.match(L.validateAddBlock({ ...ok, reason: '' }), /motivo/);
  assert.match(L.validateAddBlock({ ...ok, tab: '' }), /tab/);
  assert.match(L.validateAddBlock({ ...ok, to_letter: 's1' }), /colonna/);
  assert.match(L.validateAddBlock({ ...ok, from_letter: '' }), /colonna/);
  assert.match(L.validateAddBlock({ ...ok, title: 'ESTERO' }), /GOOGLE ADS/);
  assert.match(L.validateAddBlock({ ...ok, title: 'ESTERO GOOGLE ADS - metodo di pagamento:' }), /titolo/);
  assert.match(L.validateAddBlock({ ...ok, prev: { year: 26, programmed: 1, spent: 1 } }), /anno/);
  assert.match(L.validateAddBlock({ ...ok, prev: { year: 2026, programmed: -1, spent: 1 } }), /importo/);
});

test('etichetta del mese: testo uguale o data dello stesso mese (lo Sheet può convertire "Dicembre 2026" in data)', () => {
  assert.equal(L.labelMatches('Dicembre 2026', '2026-12'), true);
  assert.equal(L.labelMatches(' Dicembre 2026 ', '2026-12'), true);
  assert.equal(L.labelMatches(new Date(Date.UTC(2026, 11, 1, 8)), '2026-12'), true);    // mezzanotte di un fuso a ovest
  assert.equal(L.labelMatches(new Date(Date.UTC(2026, 10, 30, 23)), '2026-12'), true);  // mezzanotte a Roma
  assert.equal(L.labelMatches(new Date(Date.UTC(2026, 10, 15)), '2026-12'), false);
  assert.equal(L.labelMatches('Novembre 2026', '2026-12'), false);
  assert.equal(L.labelMatches('', '2026-12'), false);
  assert.equal(L.labelMatches(null, '2026-12'), false);
});

// ChatGPT Ads (11/11): terzo canale, per Color Holiday - Chatgpt ADS. Si riconosce dal titolo del blocco.
test('canale ChatGPT: riconosciuto dal titolo, lo gestisce Francesco, etichetta ChatGPT', () => {
  const grid = Array.from({ length: 32 }, () => []);
  grid[12][0] = 'BUDGET CHATGPT ADS - metodo di pagamento:';
  assert.deepEqual(L.findBlocks(grid).map(b => [b.letter, b.kind, b.title]), [['A', 'chatgpt', 'BUDGET CHATGPT ADS']]);
  assert.equal(L.canEditChannel('francesco', 'chatgpt'), true);
  assert.equal(L.canEditChannel('marco', 'chatgpt'), false);
  assert.equal(L.planWriteMode('ambra', 'chatgpt', '2026-12', '2026-11'), 'proposal');
  assert.equal(L.channelShort('BUDGET CHATGPT ADS'), 'ChatGPT');
  assert.equal(L.channelShort('BUDGET FACEBOOK ADS'), 'Meta');
  assert.equal(L.channelShort('ESTERO GOOGLE ADS'), 'Google estero');
  const ok = { reason: 'r', tab: 'T', from_letter: 'A', to_letter: 'J', title: 'BUDGET CHATGPT ADS' };
  assert.equal(L.validateAddBlock(ok), '');
});

test('validateAddTab: controlli prima di creare un tab cliente nuovo', () => {
  const ok = { reason: 'ChatGPT Ads Color', model_tab: 'Color Alexandra Plaza', tab: 'Color Holiday - Chatgpt ADS',
    header_title: 'ANNO 2027 · Color Holiday · ChatGPT ADS', header_note: 'nota', block_title: 'BUDGET CHATGPT ADS' };
  assert.equal(L.validateAddTab(ok), '');
  assert.equal(L.validateAddTab({ ...ok, header_note: undefined }), '');
  assert.match(L.validateAddTab({ ...ok, reason: '' }), /motivo/);
  assert.match(L.validateAddTab({ ...ok, model_tab: '' }), /modello/);
  assert.match(L.validateAddTab({ ...ok, tab: '  ' }), /nome del tab/);
  assert.match(L.validateAddTab({ ...ok, tab: 'x'.repeat(61) }), /nome del tab/);
  assert.match(L.validateAddTab({ ...ok, tab: 'Rete|ChatGPT' }), /nome del tab/);
  assert.match(L.validateAddTab({ ...ok, header_title: '' }), /titolo/);
  assert.match(L.validateAddTab({ ...ok, block_title: 'BUDGET TIKTOK' }), /ADS/);
});
