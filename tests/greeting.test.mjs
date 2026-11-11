// Saluto sulla schermata gialla (richiesta di Francesco dell'11/11): fascia oraria italiana + nome di chi è collegato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greeting, romeHour, rememberedName, rememberRole } from '../docs/js/greeting.js';

test('fasce orarie con il nome', () => {
  assert.deepEqual(greeting(0, 'AMBRA'), { text: "Hey AMBRA, che ci fai qui a quest'ora?", emoji: '🦉' });
  assert.deepEqual(greeting(6, 'AMBRA'), { text: "Hey AMBRA, che ci fai qui a quest'ora?", emoji: '🦉' });
  assert.deepEqual(greeting(7, 'MARCO'), { text: 'Buongiorno MARCO!', emoji: '☕' });
  assert.deepEqual(greeting(11, 'MARCO'), { text: 'Buongiorno MARCO!', emoji: '☕' });
  assert.deepEqual(greeting(12, 'FRANCESCO'), { text: "How you doin' FRANCESCO!", emoji: '😎' });
  assert.deepEqual(greeting(17, 'FRANCESCO'), { text: "How you doin' FRANCESCO!", emoji: '😎' });
  assert.deepEqual(greeting(18, 'AMBRA'), { text: 'No STOP AMBRA', emoji: '🛑' });
  assert.deepEqual(greeting(23, 'AMBRA'), { text: 'No STOP AMBRA', emoji: '🛑' });
});

test('senza login: stesso messaggio senza nome', () => {
  assert.equal(greeting(3, '').text, "Hey, che ci fai qui a quest'ora?");
  assert.equal(greeting(9, '').text, 'Buongiorno!');
  assert.equal(greeting(15, '').text, "How you doin'?");
  assert.equal(greeting(21, '').text, 'No STOP!');
});

test('ora italiana, anche con l\'ora legale', () => {
  assert.equal(romeHour(new Date('2026-11-11T23:30:00Z')), 0);  // inverno, UTC+1
  assert.equal(romeHour(new Date('2026-11-11T05:59:00Z')), 6);
  assert.equal(romeHour(new Date('2026-07-01T05:30:00Z')), 7);  // estate, UTC+2
});

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('nome solo se nel browser c\'è ancora il codice', () => {
  assert.equal(rememberedName(fakeStorage({ 'budget-adv-code': 'X', 'budget-adv-role': 'ambra' })), 'AMBRA');
  assert.equal(rememberedName(fakeStorage({ 'budget-adv-role': 'ambra' })), '');
  assert.equal(rememberedName(fakeStorage({ 'budget-adv-code': 'X', 'budget-adv-role': 'sconosciuto' })), '');
  assert.equal(rememberedName(fakeStorage()), '');
  assert.equal(rememberedName(null), '');
});

test('rememberRole salva il ruolo e lo toglie all\'uscita', () => {
  const s = fakeStorage({ 'budget-adv-code': 'X' });
  rememberRole(s, 'marco');
  assert.equal(rememberedName(s), 'MARCO');
  rememberRole(s, null);
  assert.equal(s.getItem('budget-adv-role'), null);
});

test('storage che lancia errori (navigazione privata): nessun nome, nessun errore', () => {
  const broken = { getItem() { throw new Error('bloccato'); }, setItem() { throw new Error('bloccato'); }, removeItem() { throw new Error('bloccato'); } };
  assert.equal(rememberedName(broken), '');
  assert.doesNotThrow(() => rememberRole(broken, 'ambra'));
});
