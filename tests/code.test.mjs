// Banco di prova della web app: Code.js + logic.js girano su uno Sheet finto in memoria (tab Ciccio dal fixture),
// così le scritture vere (valori, giallo, note, GIORNI, LOG) si controllano senza toccare lo Sheet vero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet_ciccio.json', import.meta.url)));
const src = (f) => readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));   // oggetti nati nella sandbox: stesso contenuto, altro prototipo
const letter = (c) => { let s = ''; while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); } return s; };

class FakeSheet {
  constructor(name, values = [], bg = []) {
    this.name = name;
    this.values = values.map(r => r.slice());
    this.bg = values.map((r, i) => r.map((_, j) => (bg[i] && bg[i][j]) || '#ffffff'));
    this.formulas = {};
    this.widths = {};
  }
  getColumnWidth(c) { return this.widths[c] || 100; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  getName() { return this.name; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return Math.max(0, ...this.values.map(r => r.length)); }
  cell(r, c) {
    while (this.values.length < r) { this.values.push([]); this.bg.push([]); }
    const row = this.values[r - 1];
    while (row.length < c) { row.push(''); this.bg[r - 1].push('#ffffff'); }
  }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const grid = (f) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { sh.cell(r + i, c + j); return f(r + i - 1, c + j - 1); }));
    return {
      getValue: () => { sh.cell(r, c); return sh.values[r - 1][c - 1]; },
      setValue: function (v) { sh.cell(r, c); sh.values[r - 1][c - 1] = v; return this; },
      setBackground: function (v) { grid((i, j) => { sh.bg[i][j] = v; }); return this; },
      getFormula: () => sh.formulas[`${r},${c}`] || '',
      setFormula: function (f) { sh.cell(r, c); sh.formulas[`${r},${c}`] = f; sh.values[r - 1][c - 1] = f; return this; },
      // solo PASTE_FORMAT: nel finto il formato è il colore di sfondo
      copyTo: function (dest, type) {
        if (type !== 'PASTE_FORMAT') throw new Error('copyTo finto: solo PASTE_FORMAT');
        grid((i, j) => { dest._sheet.cell(dest._r + i - (r - 1), dest._c + j - (c - 1)); dest._sheet.bg[dest._r - 1 + i - (r - 1)][dest._c - 1 + j - (c - 1)] = sh.bg[i][j]; });
      },
      _sheet: sh, _r: r, _c: c,
      getBackground: () => { sh.cell(r, c); return sh.bg[r - 1][c - 1]; },
      getValues: () => grid((i, j) => sh.values[i][j]),
      setValues: function (vals) { vals.forEach((row, i) => row.forEach((v, j) => { sh.cell(r + i, c + j); sh.values[r + i - 1][c + j - 1] = v; })); return this; },
      getBackgrounds: () => grid((i, j) => sh.bg[i][j]),
      getA1Notation: () => `${letter(c)}${r}`,
    };
  }
  appendRow(arr) { this.values.push(arr.slice()); this.bg.push(arr.map(() => '#ffffff')); }
}

function setupApp() {
  const head = (cols) => [cols];
  const sheets = {
    Ciccio: new FakeSheet('Ciccio', fx.values, fx.bg),
    NOTE: new FakeSheet('NOTE', head(['ts', 'tab', 'ym', 'author', 'text'])),
    GIORNI: new FakeSheet('GIORNI', head(['channel_id', 'ym', 'start_day'])),
    LOG: new FakeSheet('LOG', head(['ts', 'who', 'action', 'cell', 'before', 'after'])),
    GOOGLE: new FakeSheet('GOOGLE', head(['ts', 'channel_id', 'date', 'spent_mtd', 'leads_mtd', 'daily_budget', 'active', 'author'])),
  };
  const ctx = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => sheets[n] || null, getSheets: () => Object.values(sheets) }),
                      CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT' } },
    Utilities: { formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM' ? '2026-11' : '2026-11-09') },
  };
  vm.createContext(ctx);
  vm.runInContext(src('logic.js') + '\n' + src('Code.js'), ctx);
  return { app: ctx, sheets };
}

const META = { channel_id: 'Ciccio|A', title: 'BUDGET FACEBOOK ADS' };
const GOOGLE = { channel_id: 'Ciccio|J', title: 'BUDGET GOOGLE ADS' };
const DEC = 17;   // riga di Dicembre 2026 (15 = Ottobre, 16 = Novembre)

test('web app: la proposta di Ambra scrive il valore, colora di giallo e lascia la nota', () => {
  const { app, sheets } = setupApp();
  const before = sheets.Ciccio.getRange(DEC, 3).getValue();   // colonna C = €/giorno del blocco Meta
  const r = app.USER_ACTIONS.savePlan('ambra', { ...META, ym: '2026-12', eur: 130 });
  assert.deepEqual(plain(r), { ok: true, proposal: true });
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getValue(), 130);
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getBackground(), '#fff2cc');
  const note = sheets.NOTE.values.at(-1);
  assert.deepEqual(plain(note.slice(1)), ['Ciccio', "'2026-12", 'ambra', `'Proposta Meta: ${before} → 130 €/g`]);
  assert.equal(sheets.LOG.values.at(-1)[2], 'proposePlan');
});

test('web app: Ambra non scrive il mese in corso', () => {
  const { app, sheets } = setupApp();
  const r = app.USER_ACTIONS.savePlan('ambra', { ...META, ym: '2026-11', eur: 130 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Asana/);
  assert.equal(sheets.NOTE.values.length, 1);
});

test('web app: proposta di soli giorni su Google, giallo anche sul €/giorno', () => {
  const { app, sheets } = setupApp();
  const row = 15 + 4;   // Febbraio 2027
  sheets.Ciccio.getRange(row, 12).setBackground(null);   // nel fixture il 2027 è già giallo: si parte da una cella confermata
  const r = app.USER_ACTIONS.savePlan('ambra', { ...GOOGLE, ym: '2027-02', days: 14, start_day: 15 });
  assert.equal(r.ok, true);
  assert.equal(sheets.Ciccio.getRange(row, 11).getValue(), 14);           // colonna K = Giorni del blocco J
  assert.equal(sheets.Ciccio.getRange(row, 12).getBackground(), '#fff2cc'); // colonna L = €/giorno
  assert.deepEqual(plain(sheets.GIORNI.values.at(-1)), ['Ciccio|J', "'2027-02", 15]);
  assert.match(sheets.NOTE.values.at(-1)[4], /^'Proposta Google: giorni \d+ → 14, dal 15$/);
});

test('web app: stessa cifra di prima, nessuna proposta e nessuna nota', () => {
  const { app, sheets } = setupApp();
  const same = sheets.Ciccio.getRange(DEC, 3).getValue();
  const r = app.USER_ACTIONS.savePlan('ambra', { ...META, ym: '2026-12', eur: same });
  assert.deepEqual(plain(r), { ok: true, unchanged: true });
  assert.equal(sheets.NOTE.values.length, 1);
  assert.notEqual(sheets.Ciccio.getRange(DEC, 3).getBackground(), '#fff2cc');
});

test('web app: conferma del titolare, solo se la proposta è ancora quella vista', () => {
  const { app, sheets } = setupApp();
  app.USER_ACTIONS.savePlan('ambra', { ...META, ym: '2026-12', eur: 130 });
  assert.deepEqual(plain(app.USER_ACTIONS.confirmPlan('marco', { ...META, ym: '2026-12', eur: 130 })), { ok: false, error: 'forbidden' });
  const stale = app.USER_ACTIONS.confirmPlan('francesco', { ...META, ym: '2026-12', eur: 125 });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /cambiata/);
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getBackground(), '#fff2cc');
  assert.deepEqual(plain(app.USER_ACTIONS.confirmPlan('francesco', { ...META, ym: '2026-12', eur: 130 })), { ok: true });
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getBackground(), null);
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getValue(), 130);
  assert.deepEqual(plain(sheets.LOG.values.at(-1).slice(1)), ['francesco', 'confirmPlan', 'Ciccio!C17', 'proposta', 130]);
});

test('web app: il titolare che riscrive la cifra toglie il giallo come prima', () => {
  const { app, sheets } = setupApp();
  app.USER_ACTIONS.savePlan('ambra', { ...META, ym: '2026-12', eur: 130 });
  assert.deepEqual(plain(app.USER_ACTIONS.savePlan('francesco', { ...META, ym: '2026-12', eur: 140 })), { ok: true });
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getBackground(), null);
  assert.equal(sheets.Ciccio.getRange(DEC, 3).getValue(), 140);
});

const G = { channel_id: 'Ciccio|J', title: 'BUDGET GOOGLE ADS' };
const googleRows = (sheets) => sheets.GOOGLE.values.slice(1).map(r => [r[1], r[2], r[3]]);

test('web app: numeri Google, una riga per blocco e mese (lo script li manda ogni notte)', () => {
  const { app, sheets } = setupApp();
  const send = (date, spent) => app.USER_ACTIONS.saveGoogle('marco', { ...G, date, spent_mtd: spent, leads_mtd: 3, daily_budget: 40, active: true });
  assert.equal(send('2026-11-07', 300).ok, true);
  assert.equal(send('2026-11-08', 340).ok, true);           // stesso mese: aggiorna la riga
  assert.deepEqual(plain(googleRows(sheets)), [['Ciccio|J', "'2026-11-08", 340]]);
  assert.equal(send('2026-10-31', 1380).ok, true);          // altro mese: riga nuova
  assert.equal(sheets.GOOGLE.values.length, 3);
  const old = send('2026-11-05', 200);                       // dato più vecchio di quello salvato: resta il più recente
  assert.equal(old.ok, true);
  assert.equal(old.sheet, 'già presente un dato più recente');
  assert.deepEqual(plain(googleRows(sheets))[0], ['Ciccio|J', "'2026-11-08", 340]);
});

// Blocco nuovo (Albatros Google estero, 11/11): qui sul tab Ciccio del fixture, che ha le colonne S-Y vuote.
const EST = { reason: 'Ciccio estero (prova)', tab: 'Ciccio', from_letter: 'J', to_letter: 'S', title: 'ESTERO GOOGLE ADS',
              prev: { year: 2026, programmed: 4500, spent: 4589 } };
const withTotals = (sheets) => { sheets.Ciccio.getRange(4, 5).setFormula('=D30+M30'); sheets.Ciccio.getRange(5, 5).setFormula('=E30+N30'); };

test('web app: addBlock crea un blocco Google nuovo che la dashboard legge subito', () => {
  const { app, sheets } = setupApp();
  withTotals(sheets);
  sheets.Ciccio.setColumnWidth(12, 95);
  sheets.Ciccio.getRange(14, 10).setBackground('#e6b8af');
  assert.deepEqual(plain(app.ROUTINE_ACTIONS.addBlock(EST)), { ok: true, channel_id: 'Ciccio|S' });
  const ch = plain(app.buildState()).structures.find(s => s.tab === 'Ciccio').channels.find(c => c.id === 'Ciccio|S');
  assert.equal(ch.kind, 'google');
  assert.equal(ch.title, 'ESTERO GOOGLE ADS');
  assert.deepEqual(ch.prev, { year: 2026, programmed: 4500, spent: 4589 });
  assert.ok(ch.months.every(m => m.eur === null && m.sheet_spent === null && !m.proposal));   // il giallo del modello non passa
  assert.equal(ch.months[4].days, 28);                                                     // febbraio 2027
  assert.equal(sheets.Ciccio.getRange(4, 5).getFormula(), '=D30+M30+V30');
  assert.equal(sheets.Ciccio.getRange(5, 5).getFormula(), '=E30+N30+W30');
  assert.equal(sheets.Ciccio.getColumnWidth(21), 95);                                      // U come L
  assert.equal(sheets.Ciccio.getRange(14, 19).getBackground(), '#e6b8af');                 // formato del modello
  const log = sheets.LOG.values[sheets.LOG.values.length - 1];
  assert.deepEqual(plain([log[1], log[2], log[3], log[5]]), ['routine · Ciccio estero (prova)', 'addBlock', 'Ciccio!S13', 'ESTERO GOOGLE ADS']);
  // poi i mesi si scrivono come sempre
  const pb = app.ROUTINE_ACTIONS.planBatch({ reason: 'prova', items: [
    { channel_id: 'Ciccio|S', title: 'ESTERO GOOGLE ADS', ym: '2026-12', eur: 60, days: 17, start_day: 15 }] });
  assert.deepEqual(plain(pb), { ok: true, written: 1 });
  assert.equal(sheets.Ciccio.getRange(DEC, 21).getValue(), 60);
  assert.equal(sheets.Ciccio.getRange(DEC, 20).getValue(), 17);
});

test('web app: addBlock non scrive niente se qualcosa non torna', () => {
  const { app, sheets } = setupApp();
  withTotals(sheets);
  assert.match(app.ROUTINE_ACTIONS.addBlock({ ...EST, from_letter: 'S' }).error, /nessun blocco/);
  assert.match(app.ROUTINE_ACTIONS.addBlock({ ...EST, to_letter: 'J' }).error, /già un blocco/);
  assert.match(app.ROUTINE_ACTIONS.addBlock({ ...EST, tab: 'LOG' }).error, /tab/);
  assert.match(app.ROUTINE_ACTIONS.addBlock({ ...EST, title: 'ESTERO' }).error, /GOOGLE ADS/);
  sheets.Ciccio.getRange(20, 23).setValue('nota a mano');
  assert.match(app.ROUTINE_ACTIONS.addBlock(EST).error, /non sono vuote/);
  sheets.Ciccio.getRange(20, 23).setValue('');
  sheets.Ciccio.getRange(4, 5).setFormula('');                                             // totale scritto a mano, senza formula
  assert.match(app.ROUTINE_ACTIONS.addBlock(EST).error, /formula/);
  assert.equal(sheets.Ciccio.getRange(13, 19).getValue(), '');
  assert.equal(sheets.Ciccio.getRange(5, 5).getFormula(), '=E30+N30');
  assert.equal(sheets.LOG.values.length, 1);
});
