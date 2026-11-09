// Report PDF per il cliente: struttura in stile sito BeeFamily (logo, font Outfit, piede con i dati della società).
// jsPDF è sostituito da un registratore di chiamate: si controlla cosa viene disegnato, non i pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPdf, reportFileName, COMPANY } from '../docs/js/report.js';

function recorder() {
  const calls = [];
  class FakePdf {
    constructor(opts) { calls.push(['new', opts]); }
  }
  const handler = {
    get(target, prop) {
      if (prop === 'getTextWidth') return (t) => String(t).length * 2;
      if (prop === 'calls') return calls;
      return (...args) => { calls.push([prop, ...args]); return proxy; };
    },
  };
  const proxy = new Proxy({}, handler);
  function JsPDF(opts) { calls.push(['new', opts]); return proxy; }
  return { JsPDF, calls };
}

const r = {
  tab: 'El Cid', asOf: '2026-11-08', from: '2026-10', to: '2027-12',
  month: { ym: '2026-11', programmed: 880, spent: 0, inProgress: true },
  next: { ym: '2026-12', programmed: 1240, perDay: 40, days: 31, channels: [] },
  total: { programmed: 34976, spent: 0, remaining: 34976, pct: 0 },
};
const LOGO = 'data:image/png;base64,AAAA';
const FONTS = { regular: 'UkVH', semibold: 'U0VNSQ==', extrabold: 'RVhUUkE=' };
const texts = (calls) => calls.filter(c => c[0] === 'text').map(c => String(c[1]));

test('report: logo del sito in testa e nel piede', () => {
  const { JsPDF, calls } = recorder();
  reportPdf(r, JsPDF, '2026-11-09', { logo: LOGO });
  const imgs = calls.filter(c => c[0] === 'addImage');
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every(c => c[1] === LOGO && c[2] === 'PNG'));
});

test('report: senza logo il marchio resta scritto', () => {
  const { JsPDF, calls } = recorder();
  reportPdf(r, JsPDF, '2026-11-09', {});
  assert.equal(calls.filter(c => c[0] === 'addImage').length, 0);
  assert.ok(texts(calls).includes('BeeFamily'));
});

test('report: con i font Outfit li registra e li usa, senza resta Helvetica', () => {
  const withFonts = recorder();
  reportPdf(r, withFonts.JsPDF, '2026-11-09', { fonts: FONTS });
  assert.equal(withFonts.calls.filter(c => c[0] === 'addFileToVFS').length, 3);
  assert.ok(withFonts.calls.some(c => c[0] === 'addFont' && c[2] === 'Outfit'));
  assert.ok(withFonts.calls.filter(c => c[0] === 'setFont').every(c => c[1] === 'Outfit'));
  const plain = recorder();
  reportPdf(r, plain.JsPDF, '2026-11-09', {});
  assert.ok(plain.calls.filter(c => c[0] === 'setFont').every(c => c[1] === 'helvetica'));
});

test('report: piede con i dati della società come sul sito', () => {
  const { JsPDF, calls } = recorder();
  reportPdf(r, JsPDF, '2026-11-09', {});
  const all = texts(calls).join(' | ');
  assert.match(all, /Stigma Consulting srl/);
  assert.match(all, /consulenzaperhotel\.it/);
  assert.match(all, /09\/11\/2026/);
  assert.match(COMPANY.address, /Fiorina/);
});

test('report: le tre cose decise con Ambra, niente altro', () => {
  const { JsPDF, calls } = recorder();
  reportPdf(r, JsPDF, '2026-11-09', {});
  const all = texts(calls).join(' | ');
  assert.match(all, /INVESTIMENTO DI NOVEMBRE 2026/);
  assert.match(all, /PROGRAMMAZIONE DI DICEMBRE 2026/);
  assert.match(all, /AVANZAMENTO SUL BUDGET COMPLESSIVO/);
  assert.match(all, /40 € al giorno per 31 giorni/);
});

test('report: nome del file', () => {
  assert.equal(reportFileName({ ...r, tab: 'H&V' }), 'Report ADV HeV - Novembre 2026.pdf');
  assert.equal(reportFileName({ ...r, name: 'El Cid Campeador Family Hotel' }), 'Report ADV El Cid Campeador Family Hotel - Novembre 2026.pdf');
});

test('report: nome reale e località della struttura', () => {
  const { JsPDF, calls } = recorder();
  reportPdf({ ...r, name: 'El Cid Campeador Family Hotel', place: 'Milano Marittima' }, JsPDF, '2026-11-09', {});
  const all = texts(calls);
  assert.ok(all.includes('El Cid Campeador Family Hotel'));
  assert.ok(all.includes('Milano Marittima'));
  assert.ok(!all.includes('El Cid'));
});
