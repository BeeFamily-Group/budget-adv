// Tempi della schermata gialla di caricamento: compare solo se i dati tardano, resta il tempo di finire la firma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splashTimer } from '../docs/js/splash.js';

// Orologio finto: i timer partono solo quando si fa avanzare il tempo.
function clock() {
  let t = 0, id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clearTimer: (i) => { timers.delete(i); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

function setup() {
  const c = clock();
  const calls = [];
  const s = splashTimer({
    show: () => calls.push(['show', c.now()]),
    hide: () => { calls.push(['hide', c.now()]); },
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  return { c, calls, s };
}

const flush = () => new Promise((r) => setImmediate(r));

test('dati pronti prima di 400 ms: la schermata non compare', async () => {
  const { c, calls, s } = setup();
  s.start();
  c.advance(300);
  await s.done();
  c.advance(5000);
  assert.deepEqual(calls, []);
});

test('dati lenti: compare a 400 ms e se ne va appena arrivano i dati', async () => {
  const { c, calls, s } = setup();
  s.start();
  c.advance(2000);
  const p = s.done();
  c.advance(0);
  await p;
  assert.deepEqual(calls, [['show', 400], ['hide', 2000]]);
});

test('dati arrivati poco dopo la soglia: resta visibile almeno 1,1 s', async () => {
  const { c, calls, s } = setup();
  s.start();
  c.advance(600);
  const p = s.done();
  c.advance(899);
  await flush();
  assert.deepEqual(calls, [['show', 400]]);
  c.advance(1);
  await p;
  assert.deepEqual(calls, [['show', 400], ['hide', 1500]]);
});

test('done chiamato due volte: la schermata si toglie una volta sola', async () => {
  const { c, calls, s } = setup();
  s.start();
  c.advance(3000);
  const p1 = s.done();
  const p2 = s.done();
  c.advance(0);
  await Promise.all([p1, p2]);
  assert.equal(calls.filter(([k]) => k === 'hide').length, 1);
});

test('done aspetta la fine dell\'uscita animata', async () => {
  const c = clock();
  let exited = false;
  const s = splashTimer({
    show: () => {},
    hide: () => new Promise((r) => c.setTimer(() => { exited = true; r(); }, 450)),
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  s.start();
  c.advance(3000);
  let resolved = false;
  const p = s.done().then(() => { resolved = true; });
  c.advance(0);
  await flush();
  assert.equal(resolved, false);
  c.advance(450);
  await p;
  assert.equal(exited, true);
});
