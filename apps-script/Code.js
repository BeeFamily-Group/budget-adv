// Web app collegata allo Sheet "_BUDGET CLIENTI 2027": legge lo stato e scrive cella per cella.
// La logica sta in logic.js; qui solo l'adattatore verso SpreadsheetApp.

var SERVICE_TABS = {
  NOTE: ['ts', 'tab', 'ym', 'author', 'text'],
  GOOGLE: ['ts', 'channel_id', 'date', 'spent_mtd', 'leads_mtd', 'daily_budget', 'active', 'author'],
  'RICHIESTE META': ['id', 'channel_id', 'ym', 'eur', 'current_budget', 'apply_from', 'created_by', 'created_at', 'status', 'result', 'updated_at'],
  MAPPA: ['account_id', 'campaign_id', 'campaign_name', 'channel_id'],
  GIORNI: ['channel_id', 'ym', 'start_day'],
  LOG: ['ts', 'who', 'action', 'cell', 'before', 'after'],
};
var ROLES = ['francesco', 'marco', 'ambra', 'routine'];

function sha256(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function hashes() {
  var p = PropertiesService.getScriptProperties();
  var out = {};
  ROLES.forEach(function (r) { out[r] = p.getProperty('HASH_' + r); });
  return out;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nowIso() { return new Date().toISOString(); }

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SERVICE_TABS).forEach(function (name) {
    if (!ss.getSheetByName(name)) {
      var sh = ss.insertSheet(name, ss.getSheets().length);
      sh.getRange(1, 1, 1, SERVICE_TABS[name].length).setValues([SERVICE_TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
}

function clientSheets() {
  return SpreadsheetApp.getActive().getSheets().filter(function (sh) { return !SERVICE_TABS[sh.getName()]; });
}

function rows(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var head = SERVICE_TABS[name];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, k) {
      var v = r[k];
      if (v instanceof Date) v = Utilities.formatDate(v, 'Europe/Rome', h === 'ym' ? 'yyyy-MM' : 'yyyy-MM-dd');
      o[h] = h === 'ym' ? ymOf(v) : v;
    });
    return o;
  });
}

function strip(list) {
  return list.map(function (o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; }); return c; });
}

function sheetGrid(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var range = sh.getRange(1, 1, LAYOUT.firstRow + LAYOUT.count, lastCol);
  return { values: range.getValues(), bg: range.getBackgrounds() };
}

function buildState() {
  var structures = clientSheets().map(function (sh) {
    var g = sheetGrid(sh);
    return {
      tab: sh.getName(),
      channels: findBlocks(g.values).map(function (b) {
        return { id: channelId(sh.getName(), b.letter), kind: b.kind, title: b.title, months: readMonths(g.values, g.bg, b.col) };
      }),
    };
  }).filter(function (s) { return s.channels.length > 0; });
  return {
    ok: true,
    generated_at: nowIso(),
    structures: structures,
    notes: strip(rows('NOTE')),
    google: strip(rows('GOOGLE')),
    requests: strip(rows('RICHIESTE META')),
    mapping: strip(rows('MAPPA')),
    days: strip(rows('GIORNI')),
  };
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'state';
  if (action === 'state') return json(buildState());
  return json({ ok: false, error: 'azione sconosciuta' });
}

function log(who, action, cell, before, after) {
  SpreadsheetApp.getActive().getSheetByName('LOG').appendRow([nowIso(), who, action, cell, before, after]);
}

// Ultimo valore scritto dal sistema (routine o modulo Google) in una cella: serve a non sovrascrivere i valori a mano.
function lastSystemWrite(cellA1) {
  var log_ = rows('LOG');
  for (var i = log_.length - 1; i >= 0; i--) {
    if (log_[i].cell === cellA1 && (log_[i].action === 'writeSpend' || log_[i].action === 'saveGoogle')) return log_[i].after;
  }
  return null;
}

function locateChannel(channel_id) {
  var parts = String(channel_id).split('|');
  var sh = SpreadsheetApp.getActive().getSheetByName(parts[0]);
  if (!sh) throw new Error('struttura sconosciuta: ' + parts[0]);
  var g = sheetGrid(sh);
  var block = findBlocks(g.values).filter(function (b) { return b.letter === parts[1]; })[0];
  if (!block) throw new Error('canale sconosciuto: ' + channel_id);
  return { sheet: sh, values: g.values, block: block };
}

function writeSpendCell(who, action, channel_id, ym, value) {
  var loc = locateChannel(channel_id);
  var cell = planCell(loc.values, loc.block.col, ym);
  var range = loc.sheet.getRange(cell.row, cell.colSpend);
  var a1 = loc.sheet.getName() + '!' + range.getA1Notation();
  var before = range.getValue();
  if (!spendWritable(before, lastSystemWrite(a1))) return { ok: true, skipped: 'valore inserito a mano' };
  range.setValue(Math.round(Number(value) * 100) / 100);
  log(who, action, a1, before, value);
  return { ok: true };
}

function updateRow(name, rowIndex, patch) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var head = SERVICE_TABS[name];
  Object.keys(patch).forEach(function (k) {
    var c = head.indexOf(k);
    if (c !== -1) sh.getRange(rowIndex, c + 1).setValue(patch[k]);
  });
}

var USER_ACTIONS = {
  whoami: function (role) { return { ok: true, role: role }; },

  saveNote: function (role, b) {
    if (!canWriteNote(role, role)) return { ok: false, error: 'forbidden' };
    SpreadsheetApp.getActive().getSheetByName('NOTE').appendRow([nowIso(), b.tab, "'" + b.ym, role, String(b.text || '').slice(0, 2000)]);
    return { ok: true };
  },

  savePlan: function (role, b) {
    var loc = locateChannel(b.channel_id);
    if (!canEditChannel(role, loc.block.kind)) return { ok: false, error: 'forbidden' };
    var cell = planCell(loc.values, loc.block.col, b.ym);
    var eurRange = loc.sheet.getRange(cell.row, cell.colEur);
    var a1 = loc.sheet.getName() + '!' + eurRange.getA1Notation();
    log(role, 'savePlan', a1, eurRange.getValue(), b.eur);
    eurRange.setValue(Number(b.eur)).setBackground(null);
    if (b.days !== undefined && b.days !== null) {
      var dRange = loc.sheet.getRange(cell.row, cell.colDays);
      log(role, 'savePlan', loc.sheet.getName() + '!' + dRange.getA1Notation(), dRange.getValue(), b.days);
      dRange.setValue(Number(b.days));
    }
    if (b.start_day !== undefined && b.start_day !== null) {
      var giorni = rows('GIORNI').filter(function (r) { return r.channel_id === b.channel_id && r.ym === b.ym; })[0];
      if (giorni) updateRow('GIORNI', giorni._row, { start_day: b.start_day });
      else SpreadsheetApp.getActive().getSheetByName('GIORNI').appendRow([b.channel_id, "'" + b.ym, b.start_day]);
    }
    return { ok: true };
  },

  saveGoogle: function (role, b) {
    var loc = locateChannel(b.channel_id);
    if (role !== 'marco' || loc.block.kind !== 'google') return { ok: false, error: 'forbidden' };
    SpreadsheetApp.getActive().getSheetByName('GOOGLE').appendRow(
      [nowIso(), b.channel_id, "'" + b.date, Number(b.spent_mtd), Number(b.leads_mtd || 0), Number(b.daily_budget || 0), Boolean(b.active), role]);
    var res = writeSpendCell(role, 'saveGoogle', b.channel_id, String(b.date).slice(0, 7), b.spent_mtd);
    return { ok: true, sheet: res.skipped || 'aggiornato' };
  },

  metaRequest: function (role, b) {
    var loc = locateChannel(b.channel_id);
    if (loc.block.kind !== 'meta') return { ok: false, error: 'forbidden' };
    var existing = rows('RICHIESTE META');
    var r = newMetaRequest(existing, {
      channel_id: b.channel_id, ym: b.ym, eur: Number(b.eur), current_budget: Number(b.current_budget || 0),
      confirm_big: Boolean(b.confirm_big), role: role, now: nowIso(), apply_from: b.apply_from,
    });
    if (r.error) return { ok: false, error: r.error };
    existing.forEach(function (p) {
      if (r.superseded.indexOf(p.id) !== -1) updateRow('RICHIESTE META', p._row, { status: 'superseded', updated_at: nowIso() });
    });
    var q = r.request;
    SpreadsheetApp.getActive().getSheetByName('RICHIESTE META').appendRow(
      [q.id, q.channel_id, "'" + q.ym, q.eur, q.current_budget, "'" + q.apply_from, q.created_by, q.created_at, q.status, '', q.created_at]);
    log(role, 'metaRequest', q.channel_id + ' ' + q.ym, q.current_budget, q.eur);
    return { ok: true, request: q };
  },
};

var ROUTINE_ACTIONS = {
  pendingRequests: function (b) {
    return { ok: true, requests: strip(dueRequests(rows('RICHIESTE META'), String(b.now || nowIso()).slice(0, 10))) };
  },
  requestResult: function (b) {
    var row = rows('RICHIESTE META').filter(function (r) { return r.id === b.id; })[0];
    if (!row) return { ok: false, error: 'richiesta sconosciuta' };
    updateRow('RICHIESTE META', row._row, { status: b.status, result: b.result, updated_at: nowIso() });
    return { ok: true };
  },
  writeSpend: function (b) { return writeSpendCell('routine', 'writeSpend', b.channel_id, b.ym, b.value); },
  upsertMapping: function (b) {
    var sh = SpreadsheetApp.getActive().getSheetByName('MAPPA');
    var known = {};
    rows('MAPPA').forEach(function (r) { known[String(r.campaign_id)] = true; });
    var added = 0;
    (b.rows || []).forEach(function (r) {
      if (known[String(r.campaign_id)]) return;
      sh.appendRow(["'" + r.account_id, "'" + r.campaign_id, r.campaign_name, r.channel_id || '']);
      known[String(r.campaign_id)] = true;
      added++;
    });
    return { ok: true, added: added };
  },
};

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'json non valido' }); }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var h = hashes();
    if (body.action === 'bootstrap') {
      // Una sola volta: salva gli hash dei codici e crea i tab di servizio. Poi resta chiuso.
      if (h.francesco) return json({ ok: false, error: 'gia configurato' });
      var p = PropertiesService.getScriptProperties();
      ROLES.forEach(function (r) { if (body.hashes && body.hashes[r]) p.setProperty('HASH_' + r, body.hashes[r]); });
      setup();
      return json({ ok: true });
    }
    if (body.routine_key) {
      if (!h.routine || sha256(String(body.routine_key)) !== h.routine) return json({ ok: false, error: 'chiave non valida' });
      var ra = ROUTINE_ACTIONS[body.action];
      return json(ra ? ra(body) : { ok: false, error: 'azione sconosciuta' });
    }
    var userHashes = { francesco: h.francesco, marco: h.marco, ambra: h.ambra };
    var role = roleFromCode(body.code, userHashes, sha256);
    if (!role) return json({ ok: false, error: 'codice non valido' });
    var ua = USER_ACTIONS[body.action];
    return json(ua ? ua(role, body) : { ok: false, error: 'azione sconosciuta' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
