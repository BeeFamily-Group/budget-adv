// Chiamate alla web app Apps Script e caricamento di meta.json. Con ?demo usa i dati di prova.
import { WEB_APP_URL } from '../config.js';

const DEMO = new URLSearchParams(location.search).has('demo');

export function isDemo() { return DEMO; }

export async function getState() {
  const url = DEMO ? 'data/demo-state.json' : `${WEB_APP_URL}?action=state`;
  const r = await fetch(url, { cache: 'no-store' });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'stato non disponibile');
  return data;
}

export async function getMeta() {
  const r = await fetch(DEMO ? 'data/demo-meta.json' : 'data/meta.json', { cache: 'no-store' });
  if (!r.ok) return { as_of: null, accounts: {}, campaigns: [], daily: [] };
  return r.json();
}

// POST in text/plain: niente preflight CORS verso Apps Script.
export async function post(action, payload, code) {
  if (DEMO) return { ok: false, error: 'modalità demo: niente salvataggi' };
  const r = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, action, code }),
  });
  return r.json();
}
