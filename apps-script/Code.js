// Web app collegata allo Sheet "_BUDGET CLIENTI 2027": legge lo stato e scrive cella per cella.
// La logica sta in logic.js; qui solo l'adattatore verso SpreadsheetApp.

var SERVICE_TABS = {
  NOTE: ['ts', 'tab', 'ym', 'author', 'text'],
  GOOGLE: ['ts', 'channel_id', 'date', 'spent_mtd', 'leads_mtd', 'daily_budget', 'active', 'author'],
  'RICHIESTE META': ['id', 'channel_id', 'ym', 'eur', 'current_budget', 'apply_from', 'created_by', 'created_at', 'status', 'result', 'updated_at'],
  MAPPA: ['account_id', 'campaign_id', 'campaign_name', 'channel_id', 'channel_title'],
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
function todayRome() { return Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd'); }

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

// Intestazione aggiornata quando un tab di servizio guadagna una colonna (MAPPA: channel_title).
function ensureHeader(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var head = SERVICE_TABS[name];
  if (sh.getRange(1, head.length).getValue() !== head[head.length - 1]) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  }
  return sh;
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
  var skipped = [];
  var structures = clientSheets().map(function (sh) {
    var g = sheetGrid(sh);
    return {
      tab: sh.getName(),
      channels: findBlocks(g.values).map(function (b) {
        return { id: channelId(sh.getName(), b.letter), kind: b.kind, title: b.title, months: readMonths(g.values, g.bg, b.col) };
      }),
    };
  }).filter(function (s) {
    if (!s.channels.length) skipped.push(s.tab);   // tab cliente senza blocchi riconosciuti: riga dei titoli spostata?
    return s.channels.length > 0;
  });
  return {
    ok: true,
    generated_at: nowIso(),
    structures: structures,
    skipped_tabs: skipped,
    notes: strip(rows('NOTE')),
    google: strip(rows('GOOGLE')),
    requests: strip(rows('RICHIESTE META')),
    mapping: strip(rows('MAPPA')),
    days: strip(rows('GIORNI')),
  };
}

var CACHE_SECONDS = 300;   // le modifiche fatte a mano nello Sheet compaiono entro 5 minuti
var CACHE_CHUNK = 90000;   // una voce di cache tiene al massimo 100 KB

// Ogni scrittura incrementa la versione: la cache di una versione vecchia non viene piu' letta,
// e una lettura iniziata prima di una scrittura non la rimette in cache.
function stateVersion() { return PropertiesService.getScriptProperties().getProperty('STATE_VER') || '0'; }
function bumpStateVersion() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('STATE_VER', String(Number(p.getProperty('STATE_VER') || 0) + 1));
}

function cachedStateText() {
  var cache = CacheService.getScriptCache();
  var ver = stateVersion();
  var key = 'state-' + ver;
  var n = Number(cache.get(key + '-n') || 0);
  if (n > 0) {
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '-' + i);
    var got = cache.getAll(keys);
    if (keys.every(function (k) { return typeof got[k] === 'string'; })) return keys.map(function (k) { return got[k]; }).join('');
  }
  var text = JSON.stringify(buildState());
  var parts = chunkText(text, CACHE_CHUNK);
  if (parts.length <= 20 && stateVersion() === ver) {
    var obj = {};
    parts.forEach(function (part, j) { obj[key + '-' + j] = part; });
    cache.putAll(obj, CACHE_SECONDS);
    cache.put(key + '-n', String(parts.length), CACHE_SECONDS);
  }
  return text;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'state';
  if (action === 'state') {
    if (e.parameter.fresh) bumpStateVersion();
    return ContentService.createTextOutput(cachedStateText()).setMimeType(ContentService.MimeType.JSON);
  }
  return json({ ok: false, error: 'azione sconosciuta' });
}

function log(who, action, cell, before, after) {
  SpreadsheetApp.getActive().getSheetByName('LOG').appendRow([nowIso(), who, action, cell, before, after]);
}

// Ultimo valore scritto dal sistema (routine o modulo Google) in una cella: serve a non sovrascrivere i valori a mano.
// Il LOG si legge una volta sola per richiesta.
var SYS_WRITES = null;
function lastSystemWrite(cellA1) {
  if (!SYS_WRITES) {
    SYS_WRITES = {};
    rows('LOG').forEach(function (r) {
      if (r.action === 'writeSpend' || r.action === 'saveGoogle') SYS_WRITES[r.cell] = r.after;
    });
  }
  return Object.prototype.hasOwnProperty.call(SYS_WRITES, cellA1) ? SYS_WRITES[cellA1] : null;
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

// Come locateChannel, ma solo se il blocco ha ancora il titolo che ha visto chi scrive (colonne spostate = nessuna scrittura).
function locateChecked(channel_id, title) {
  var loc = locateChannel(channel_id);
  var bad = titleMismatch(loc.block, title, loc.sheet.getName());
  if (bad) throw new Error(bad);
  return loc;
}

function writeSpendCell(who, action, channel_id, title, ym, value) {
  var loc = locateChecked(channel_id, title);
  var cell = planCell(loc.values, loc.block.col, ym);
  var range = loc.sheet.getRange(cell.row, cell.colSpend);
  var a1 = loc.sheet.getName() + '!' + range.getA1Notation();
  var before = range.getValue();
  var rounded = Math.round(Number(value) * 100) / 100;
  if (before !== '' && Number(before) === rounded) return { ok: true, unchanged: true };   // niente riga di LOG inutile
  if (!spendWritable(before, lastSystemWrite(a1))) return { ok: true, skipped: 'valore inserito a mano' };
  range.setValue(rounded);
  log(who, action, a1, before, rounded);
  if (SYS_WRITES) SYS_WRITES[a1] = rounded;
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
    SpreadsheetApp.getActive().getSheetByName('NOTE').appendRow([nowIso(), b.tab, "'" + b.ym, role, "'" + String(b.text || '').slice(0, 2000)]);
    return { ok: true };
  },

  savePlan: function (role, b) {
    var loc = locateChecked(b.channel_id, b.title);
    if (!canEditChannel(role, loc.block.kind)) return { ok: false, error: 'forbidden' };
    var cell = planCell(loc.values, loc.block.col, b.ym);
    var eurRange = loc.sheet.getRange(cell.row, cell.colEur);
    if (b.eur !== undefined && b.eur !== null && b.eur !== '') {
      log(role, 'savePlan', loc.sheet.getName() + '!' + eurRange.getA1Notation(), eurRange.getValue(), Number(b.eur));
      eurRange.setValue(Number(b.eur)).setBackground(null);
    }
    if (b.days !== undefined && b.days !== null && b.days !== '') {
      var dRange = loc.sheet.getRange(cell.row, cell.colDays);
      log(role, 'savePlan', loc.sheet.getName() + '!' + dRange.getA1Notation(), dRange.getValue(), b.days);
      dRange.setValue(Number(b.days));
    }
    if (b.start_day !== undefined && b.start_day !== null && b.start_day !== '') {
      var giorni = rows('GIORNI').filter(function (r) { return r.channel_id === b.channel_id && r.ym === b.ym; })[0];
      if (giorni) updateRow('GIORNI', giorni._row, { start_day: b.start_day });
      else SpreadsheetApp.getActive().getSheetByName('GIORNI').appendRow([b.channel_id, "'" + b.ym, b.start_day]);
    }
    return { ok: true };
  },

  saveGoogle: function (role, b) {
    var loc = locateChecked(b.channel_id, b.title);
    if (role !== 'marco' || loc.block.kind !== 'google') return { ok: false, error: 'forbidden' };
    SpreadsheetApp.getActive().getSheetByName('GOOGLE').appendRow(
      [nowIso(), b.channel_id, "'" + b.date, Number(b.spent_mtd), Number(b.leads_mtd || 0), Number(b.daily_budget || 0), Boolean(b.active), role]);
    var res = writeSpendCell(role, 'saveGoogle', b.channel_id, b.title, String(b.date).slice(0, 7), b.spent_mtd);
    return { ok: true, sheet: res.skipped || 'aggiornato' };
  },

  metaRequest: function (role, b) {
    var loc = locateChecked(b.channel_id, b.title);
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
    var today = String(b.now || todayRome()).slice(0, 10);
    var all = rows('RICHIESTE META');
    expiredRequests(all, today).forEach(function (r) {
      updateRow('RICHIESTE META', r._row, { status: 'expired', result: "'mese finito prima che la modifica fosse applicata", updated_at: nowIso() });
    });
    return { ok: true, requests: strip(dueRequests(all, today)) };
  },
  requestResult: function (b) {
    var row = rows('RICHIESTE META').filter(function (r) { return r.id === b.id; })[0];
    if (!row) return { ok: false, error: 'richiesta sconosciuta' };
    var prefix = row.status === 'superseded' ? '(sostituita nel frattempo) ' : '';
    updateRow('RICHIESTE META', row._row, { status: resultStatus(row.status, b.status),
      result: "'" + prefix + String(b.result || '').slice(0, 1000), updated_at: nowIso() });
    return { ok: true };
  },
  writeSpend: function (b) {
    var bad = validatePayload('writeSpend', b);
    return bad ? { ok: false, error: bad } : writeSpendCell('routine', 'writeSpend', b.channel_id, b.title, b.ym, b.value);
  },
  writeSpendBatch: function (b) {
    var out = { ok: true, written: 0, unchanged: 0, skipped: [], errors: [] };
    (b.items || []).forEach(function (it) {
      try {
        var bad = validatePayload('writeSpend', it);
        if (bad) throw new Error(bad);
        var r = writeSpendCell('routine', 'writeSpend', it.channel_id, it.title, it.ym, it.value);
        if (r.skipped) out.skipped.push(it.channel_id + ' ' + it.ym);
        else if (r.unchanged) out.unchanged++;
        else out.written++;
      } catch (err) {
        out.errors.push(it.channel_id + ' ' + it.ym + ': ' + err.message);
      }
    });
    return out;
  },
  rotateCodes: function (b) {
    var p = PropertiesService.getScriptProperties();
    var changed = [];
    ROLES.forEach(function (r) {
      var hh = b.hashes && b.hashes[r];
      if (hh && /^[0-9a-f]{64}$/.test(hh)) { p.setProperty('HASH_' + r, hh); changed.push(r); }
    });
    p.setProperty('BOOTSTRAPPED', '1');
    if (changed.length) log('routine', 'rotateCodes', changed.join(','), '', '');
    return { ok: true, changed: changed };
  },

  upsertMapping: function (b) {
    var sh = ensureHeader('MAPPA');
    var known = {};
    rows('MAPPA').forEach(function (r) { known[String(r.campaign_id)] = r; });
    var added = 0;
    var titled = 0;
    (b.rows || []).forEach(function (r) {
      var k = known[String(r.campaign_id)];
      if (k) {   // riga gia' presente: si aggiunge solo il titolo mancante, se il canale e' lo stesso
        if (!k.channel_title && r.channel_title && k.channel_id === r.channel_id) {
          updateRow('MAPPA', k._row, { channel_title: "'" + r.channel_title });
          titled++;
        }
        return;
      }
      sh.appendRow(["'" + r.account_id, "'" + r.campaign_id, "'" + String(r.campaign_name || ''), r.channel_id || '',
                    "'" + String(r.channel_title || '')]);
      known[String(r.campaign_id)] = r;
      added++;
    });
    return { ok: true, added: added, titled: titled };
  },
};

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'json non valido' }); }
  var lock = LockService.getScriptLock();
  try {
    var props = PropertiesService.getScriptProperties();
    if (body.action === 'bootstrap') {
      // Una sola volta: salva gli hash dei codici e crea i tab di servizio. Poi resta chiuso per sempre.
      if (!lock.tryLock(20000)) return json({ ok: false, error: 'occupato, riprova tra un minuto' });
      if (bootstrapClosed(props.getProperties())) return json({ ok: false, error: 'gia configurato' });
      ROLES.forEach(function (r) { if (body.hashes && body.hashes[r]) props.setProperty('HASH_' + r, body.hashes[r]); });
      props.setProperty('BOOTSTRAPPED', '1');
      setup();
      return json({ ok: true });
    }
    var h = hashes();
    var role = null;
    var actions;
    if (body.routine_key) {
      if (!h.routine || sha256(String(body.routine_key)) !== h.routine) return json({ ok: false, error: 'chiave non valida' });
      actions = ROUTINE_ACTIONS;
    } else {
      role = roleFromCode(body.code, { francesco: h.francesco, marco: h.marco, ambra: h.ambra }, sha256);
      if (!role) return json({ ok: false, error: 'codice non valido' });
      if (body.action === 'whoami') return json({ ok: true, role: role });   // nessun lock: solo il confronto del codice
      var bad = validatePayload(body.action, body);
      if (bad) return json({ ok: false, error: bad });
      actions = USER_ACTIONS;
    }
    var fn = actions[body.action];
    if (!fn) return json({ ok: false, error: 'azione sconosciuta' });
    if (!lock.tryLock(20000)) return json({ ok: false, error: 'lo Sheet è occupato da un altro salvataggio: riprova tra un minuto' });
    var out = body.routine_key ? fn(body) : fn(role, body);
    SpreadsheetApp.flush();
    bumpStateVersion();   // dopo la scrittura: la prossima lettura vede i dati nuovi
    return json(out);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
