// Codice personale: si salva in questo browser e la web app restituisce il ruolo.
import { post } from './api.js';
import { store, render, esc } from './app.js';

const KEY = 'budget-adv-code';
const LABEL = { francesco: 'Francesco · Meta', marco: 'Marco · Google', ambra: 'Ambra · lettura' };

function saved() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
function save(code) { try { code ? localStorage.setItem(KEY, code) : localStorage.removeItem(KEY); } catch { /* niente */ } }

function paintButton() {
  const b = document.getElementById('who');
  b.textContent = store.role ? LABEL[store.role] : 'Accedi';
  b.classList.toggle('on', Boolean(store.role));
}

export async function restore() {
  const code = saved();
  if (!code) return paintButton();
  const r = await post('whoami', {}, code).catch(() => ({ ok: false }));
  store.code = r.ok ? code : null;
  store.role = r.ok ? r.role : null;
  if (!r.ok) save('');
  paintButton();
  render();
}

export function openLogin() {
  const d = document.getElementById('dialog');
  d.innerHTML = `<form class="dialog-card" id="loginForm">
      <h3>${store.role ? esc(LABEL[store.role]) : 'Accedi con il tuo codice'}</h3>
      ${store.role
        ? '<p class="small">Sei collegato su questo browser.</p><button class="btn" type="button" id="logout">Esci</button> <button class="btn" type="button" id="close">Chiudi</button>'
        : `<p class="small">Il codice serve solo per modificare: senza codice la pagina si legge comunque.</p>
           <input id="code" autocomplete="off" autocapitalize="characters" placeholder="es. FRA-XXXX-XXXX">
           <p class="small" id="err"></p>
           <button class="btn primary" type="submit">Entra</button> <button class="btn" type="button" id="close">Annulla</button>`}
    </form>`;
  d.hidden = false;
  const close = () => { d.hidden = true; d.innerHTML = ''; };
  d.querySelector('#close').addEventListener('click', close);
  const out = d.querySelector('#logout');
  if (out) out.addEventListener('click', () => { save(''); store.role = null; store.code = null; paintButton(); render(); close(); });
  d.querySelector('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = d.querySelector('#code').value.trim().toUpperCase();
    const r = await post('whoami', {}, code).catch(err => ({ ok: false, error: err.message }));
    if (!r.ok) { d.querySelector('#err').textContent = 'Codice non valido.'; return; }
    save(code);
    store.code = code;
    store.role = r.role;
    paintButton();
    render();
    close();
  });
  const input = d.querySelector('#code');
  if (input) input.focus();
}
