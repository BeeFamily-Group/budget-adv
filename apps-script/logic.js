// Logica pura della web app: layout dello Sheet, ruoli, regole di scrittura, richieste Meta.
// Nessuna API di Apps Script qui dentro: cosi' gira anche in Node per i test.

var LAYOUT = { titleRow: 13, firstRow: 15, count: 15, firstYm: '2026-10' };
var MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto',
            'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
var PROPOSAL_BG = '#fff2cc';
var BIG_CHANGE = 0.5;

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

function dueRequests(requests, today) {
  return (requests || []).filter(function (r) {
    return r.status === 'pending' || (r.status === 'scheduled' && r.apply_from <= today);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    LAYOUT: LAYOUT, monthsList: monthsList, monthLabel: monthLabel, colLetter: colLetter,
    findBlocks: findBlocks, readMonths: readMonths, channelId: channelId, planCell: planCell,
    roleFromCode: roleFromCode, canEditChannel: canEditChannel, canWriteNote: canWriteNote,
    spendWritable: spendWritable, newMetaRequest: newMetaRequest, dueRequests: dueRequests,
  };
}
