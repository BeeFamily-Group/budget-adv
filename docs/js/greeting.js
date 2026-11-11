// Saluto sulla schermata gialla (richiesta di Francesco dell'11/11): cambia con l'ora italiana e, se nel browser
// c'è ancora il codice, usa il nome di chi è collegato. Il ruolo si salva al login (mai il codice in chiaro qui):
// la web app lo verifica poi in restore(), e se il codice non vale più ruolo e nome spariscono.

export const NAMES = { francesco: 'FRANCESCO', marco: 'MARCO', ambra: 'AMBRA' };
const CODE_KEY = 'budget-adv-code';   // lo stesso di auth.js
const ROLE_KEY = 'budget-adv-role';

// Notte 0–7, mattina 7–12, pomeriggio 12–18 (comprende 17–18, che nelle fasce di Francesco mancava), sera 18–24.
export function greeting(hour, name) {
  const n = name ? ` ${name}` : '';
  if (hour < 7) return { text: name ? `Hey ${name}, che ci fai qui a quest'ora?` : "Hey, che ci fai qui a quest'ora?", emoji: '🦉' };
  if (hour < 12) return { text: `Buongiorno${n}!`, emoji: '☕' };
  if (hour < 18) return { text: name ? `How you doin'${n}!` : "How you doin'?", emoji: '😎' };
  return { text: name ? `No STOP${n}` : 'No STOP!', emoji: '🛑' };
}

export function romeHour(date = new Date()) {
  const h = new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Rome' }).format(date);
  return Number(h) % 24;
}

export function rememberedName(storage) {
  try {
    if (!storage || !storage.getItem(CODE_KEY)) return '';
    return NAMES[storage.getItem(ROLE_KEY)] || '';
  } catch {
    return '';
  }
}

export function rememberRole(storage, role) {
  try {
    if (role) storage.setItem(ROLE_KEY, role);
    else storage.removeItem(ROLE_KEY);
  } catch { /* navigazione privata o archivio bloccato: niente nome, nessun errore */ }
}
