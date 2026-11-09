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
  }
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
      setBackground: function (v) { sh.cell(r, c); sh.bg[r - 1][c - 1] = v; return this; },
      getBackground: () => { sh.cell(r, c); return sh.bg[r - 1][c - 1]; },
      getValues: () => grid((i, j) => sh.values[i][j]),
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
  };
  const ctx = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => sheets[n] || null, getSheets: () => Object.values(sheets) }) },
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
