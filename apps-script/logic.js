// Logica pura della web app: layout dello Sheet, ruoli, regole di scrittura, richieste Meta.
// Nessuna API di Apps Script qui dentro: cosi' gira anche in Node per i test.

var LAYOUT = { titleRow: 13, firstRow: 15, count: 15, firstYm: '2026-10' };
var MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto',
            'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
var PROPOSAL_BG = '#fff2cc';
var BIG_CHANGE = 0.5;
var MAX_EUR_DAY = 1000;   // tetto per canale: il piano 2027 arriva a 150 €/g

function monthsList() {
  var parts = LAYOUT.firstYm.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var out = [];
  for (var k = 0; k < LAYOUT.count; k++) {
    out.push(y + '-' + (m < 10 ? '0' : '') + m);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function monthLabel(ym) {
  var parts = ym.split('-');
  return MESI[Number(parts[1]) - 1] + ' ' + parts[0];
}

function colLetter(col) {
  var s = '';
  while (col > 0) {
    var r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function findBlocks(grid) {
  var row = grid[LAYOUT.titleRow - 1] || [];
  var out = [];
  for (var c = 0; c < row.length; c++) {
    var v = row[c];
    if (typeof v === 'string' && v.indexOf('metodo di pagamento') !== -1) {
      out.push({
        col: c + 1,
        letter: colLetter(c + 1),
        kind: /FACEBOOK/i.test(v) ? 'meta' : 'google',
        title: v.split(' - metodo')[0].trim(),
      });
    }
  }
  return out;
}

function readMonths(grid, bg, col) {
  var yms = monthsList();
  return yms.map(function (ym, k) {
    var r = LAYOUT.firstRow + k - 1;
    var row = grid[r] || [];
    var bgRow = (bg && bg[r]) || [];
    return {
      ym: ym,
      days: num(row[col]),
      eur: num(row[col + 1]),
      proposal: String(bgRow[col + 1] || '').toLowerCase() === PROPOSAL_BG,
    };
  });
}

function channelId(tab, letter) {
  return tab + '|' + letter;
}

// Cella del mese ym per il blocco che inizia alla colonna col (1-based). Rifiuta se l'etichetta non torna.
function planCell(grid, col, ym) {
  var k = monthsList().indexOf(ym);
  if (k === -1) throw new Error('layout: mese fuori periodo ' + ym);
  var row = LAYOUT.firstRow + k;
  var label = String((grid[row - 1] || [])[col - 1] || '').trim();
  if (label !== monthLabel(ym)) throw new Error('layout: attesa "' + monthLabel(ym) + '" in riga ' + row + ', trovato "' + label + '"');
  return { row: row, colDays: col + 1, colEur: col + 2, colSpend: col + 4 };
}

function roleFromCode(code, hashes, hasher) {
  if (!code) return null;
  var h = hasher(String(code).trim());
  var roles = Object.keys(hashes);
  for (var i = 0; i < roles.length; i++) {
    if (hashes[roles[i]] && hashes[roles[i]] === h) return roles[i];
  }
  return null;
}

function canEditChannel(role, kind) {
  return (role === 'francesco' && kind === 'meta') || (role === 'marco' && kind === 'google');
}

function canWriteNote(role, author) {
  return Boolean(role) && role === author;
}

// La routine scrive la Spesa Effettiva solo se la cella e' vuota o contiene l'ultimo valore scritto da lei.
function spendWritable(cellValue, lastRoutineValue) {
  if (cellValue === '' || cellValue === null || cellValue === undefined) return true;
  return lastRoutineValue !== null && lastRoutineValue !== undefined && Number(cellValue) === Number(lastRoutineValue);
}

function newMetaRequest(existing, req) {
  if (req.role !== 'francesco') return { error: 'forbidden' };
  if (req.current_budget > 0 && Math.abs(req.eur / req.current_budget - 1) > BIG_CHANGE && !req.confirm_big) {
    return { error: 'needs_confirm' };
  }
  var today = String(req.now).slice(0, 10);
  var request = {
    id: 'r-' + Date.parse(req.now) + '-' + Math.random().toString(36).slice(2, 6),
    channel_id: req.channel_id,
    ym: req.ym,
    eur: req.eur,
    current_budget: req.current_budget,
    apply_from: req.apply_from,
    created_by: req.role,
    created_at: req.now,
    status: req.apply_from > today ? 'scheduled' : 'pending',
    result: '',
  };
  var superseded = (existing || []).filter(function (p) {
    return p.channel_id === req.channel_id && p.ym === req.ym && (p.status === 'pending' || p.status === 'scheduled');
  }).map(function (p) { return p.id; });
  return { request: request, superseded: superseded };
}

// Google Sheets trasforma "2026-11" in una data: qui torna sempre 'YYYY-MM'.
function ymOf(v) {
  if (v instanceof Date) {
    var m = v.getUTCMonth() + 1;
    return v.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m;
  }
  return String(v || '').slice(0, 7);
}

// CacheService di Apps Script accetta valori fino a 100 KB.

function requestYm(r) { return String(r.ym || r.apply_from || '').slice(0, 7); }

// Da applicare: in attesa, o programmate arrivate alla data. Mai una richiesta di un mese gia' finito.
function dueRequests(requests, today) {
  var ym = String(today).slice(0, 7);
  return (requests || []).filter(function (r) {
    if (requestYm(r) < ym) return false;
    return r.status === 'pending' || (r.status === 'scheduled' && r.apply_from <= today);
  });
}

// Richieste ancora aperte di un mese gia' finito: vanno segnate come scadute.
function expiredRequests(requests, today) {
  var ym = String(today).slice(0, 7);
  return (requests || []).filter(function (r) {
    return (r.status === 'pending' || r.status === 'scheduled') && requestYm(r) < ym;
  });
}

// Esito scritto dalla routine: una richiesta sostituita nel frattempo resta "superseded".
function resultStatus(current, incoming) {
  return current === 'superseded' ? 'superseded' : incoming;
}

// Lo stato supera i 100 KB di una voce di cache: si salva a pezzi.
function chunkText(str, size) {
  var out = [];
  for (var i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out.length ? out : [''];
}

// Il bootstrap vale una volta sola: dopo resta chiuso anche se qualcuno svuota gli hash.
function bootstrapClosed(props) {
  props = props || {};
  return Boolean(props.BOOTSTRAPPED || props.HASH_francesco || props.HASH_marco || props.HASH_ambra || props.HASH_routine);
}

// Controllo dei valori prima di scrivere nello Sheet: '' se va bene, altrimenti il motivo.
var YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
var DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function given(v) { return v !== undefined && v !== null && v !== ''; }
function isAmount(v) { return given(v) && isFinite(Number(v)) && Number(v) >= 0; }
function isIntIn(v, lo, hi) { var n = Number(v); return given(v) && Math.floor(n) === n && n >= lo && n <= hi; }

function validatePayload(action, b) {
  b = b || {};
  if (action === 'savePlan') {
    if (!YM_RE.test(String(b.ym))) return 'mese non valido';
    if (!given(b.eur) && !given(b.days) && !given(b.start_day)) return 'niente da salvare';
    if (given(b.eur) && !isAmount(b.eur)) return '€/giorno non valido';
    if (given(b.eur) && Number(b.eur) > MAX_EUR_DAY) return 'oltre 1.000 €/g: se serve davvero, scrivilo direttamente nello Sheet';
    if (given(b.days) && !isIntIn(b.days, 0, 31)) return 'giorni non validi (da 0 a 31)';
    if (given(b.start_day) && !isIntIn(b.start_day, 1, 31)) return 'dal giorno non valido (da 1 a 31)';
  }
  if (action === 'saveGoogle') {
    if (!DATE_RE.test(String(b.date))) return 'data non valida';
    if (!isAmount(b.spent_mtd)) return 'speso del mese non valido';
    if (!isIntIn(b.leads_mtd, 0, 1e6)) return 'lead non validi';
    if (!isAmount(b.daily_budget)) return '€/giorno non valido';
  }
  if (action === 'metaRequest') {
    if (!YM_RE.test(String(b.ym))) return 'mese non valido';
    if (!isAmount(b.eur) || Number(b.eur) <= 0) return 'per spegnere le campagne usa Gestione inserzioni: qui il €/giorno deve essere maggiore di 0';
    if (Number(b.eur) > MAX_EUR_DAY) return 'oltre 1.000 €/g: se serve davvero, cambialo da Gestione inserzioni';
    if (!DATE_RE.test(String(b.apply_from))) return 'data di partenza mancante';
  }
  if (action === 'writeSpend') {
    if (!YM_RE.test(String(b.ym))) return 'mese non valido';
    if (!isAmount(b.value)) return 'speso non valido';
  }
  return '';
}

// Il canale si identifica da tab e lettera di colonna; il titolo del blocco conferma che è ancora lo stesso.
function titleMismatch(block, sent, tab) {
  if (sent === undefined || sent === null || sent === '') return 'pagina da ricaricare: manca il nome del blocco';
  var norm = function (t) { return String(t).replace(/\s+/g, ' ').trim().toUpperCase(); };
  if (norm(block.title) === norm(sent)) return '';
  return 'lo Sheet è cambiato: nel tab ' + tab + ' la colonna ' + block.letter + ' ora è "' + block.title + '". Ricarica la pagina.';
}

if (typeof module !== 'undefined') {
  module.exports = {
    LAYOUT: LAYOUT, monthsList: monthsList, monthLabel: monthLabel, colLetter: colLetter,
    findBlocks: findBlocks, readMonths: readMonths, channelId: channelId, planCell: planCell,
    roleFromCode: roleFromCode, canEditChannel: canEditChannel, canWriteNote: canWriteNote,
    spendWritable: spendWritable, newMetaRequest: newMetaRequest, validatePayload: validatePayload, titleMismatch: titleMismatch, dueRequests: dueRequests, expiredRequests: expiredRequests, resultStatus: resultStatus,
    chunkText: chunkText, bootstrapClosed: bootstrapClosed, ymOf: ymOf,
  };
}
