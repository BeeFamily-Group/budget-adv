/**
 * Rhythm · numeri Google Ads nella dashboard budget BeeFamily
 *
 * Script per l'account amministratore (MCC) Google Ads. Ogni notte legge, per ogni blocco Google dello Sheet
 * "_BUDGET CLIENTI 2027", lo speso del mese, le conversioni, il budget giornaliero e se le campagne sono attive,
 * e li manda alla dashboard come se Marco li inserisse a mano (stessa azione "saveGoogle", stesso codice).
 * Periodo: dal primo del mese a ieri, come i dati Meta. Il primo del mese chiude il mese prima.
 *
 * Prima volta: CONFIG.ANTEPRIMA = true, si esegue con "Anteprima" e si controlla il registro.
 * Se i numeri tornano: ANTEPRIMA = false e pianificazione giornaliera (es. ogni giorno alle 6).
 */

var CONFIG = {
  // Indirizzo della web app collegata allo Sheet (lo stesso della dashboard).
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzQ3mzDkRnf52_GlKfiaKnMk0mfN1biJzHMLTD3t4sox_BDxYBpJEDRip7EwaFp0HOZ/exec',
  // Il codice personale di Marco per la dashboard (quello che usa per accedere). Non va condiviso.
  CODICE: 'INCOLLA_QUI_IL_TUO_CODICE',
  // true: legge Google Ads e scrive nel registro cosa manderebbe, senza inviare niente.
  ANTEPRIMA: true,
  // Un blocco per ogni colonna Google dello Sheet. channel_id e title non vanno cambiati.
  // account: ID cliente Google Ads nel formato 123-456-7890 (vuoto = blocco saltato).
  // campagne: frammenti del nome delle campagne da contare (vuoto = tutte le campagne dell'account).
  // escludi: frammenti del nome delle campagne da non contare. Maiuscole e minuscole indifferenti.
  // Standard per gli account con due blocchi: etichetta all'inizio del nome della campagna,
  // [ESTERO], [BARCA] o [GAS]. Le campagne senza etichetta vanno nel blocco principale.
  BLOCCHI: [
    // Albatros ha due blocchi dall'11/11: Google e Google estero (da metà dicembre a febbraio), [ESTERO] nel nome.
    { channel_id: 'Albatros|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [], escludi: ['[estero]'] },
    { channel_id: 'Albatros|S', title: 'ESTERO GOOGLE ADS', account: '', campagne: ['[estero]'] },
    { channel_id: 'Arianna|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'B612|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Ciccio|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    // Cristallo ha due blocchi: Google Italia ed estero. Le campagne estere hanno [ESTERO] nel nome.
    { channel_id: 'Cristallo|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [], escludi: ['[estero]'] },
    { channel_id: 'Cristallo|S', title: 'ESTERO GOOGLE ADS', account: '', campagne: ['[estero]'] },
    { channel_id: 'DeltaBlu|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'El Cid|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Helios|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'H&V|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Mauritius|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Mexico|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Olimpic|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Rivamare|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    // Sardinia ha due blocchi: ville e barca (gommone). Le campagne del gommone hanno [BARCA] nel nome.
    { channel_id: 'Sardinia|A', title: 'BUDGET GOOGLE ADS · VILLE', account: '', campagne: [], escludi: ['[barca]'] },
    { channel_id: 'Sardinia|J', title: 'BUDGET GOOGLE ADS · BARCA', account: '', campagne: ['[barca]'] },
    { channel_id: 'Sogno|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    { channel_id: 'Teti|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [] },
    // Trieste ha due blocchi: Google e GAS. Le campagne GAS hanno [GAS] nel nome.
    { channel_id: 'Trieste|J', title: 'BUDGET GOOGLE ADS', account: '', campagne: [], escludi: ['[gas]'] },
    { channel_id: 'Trieste|S', title: 'GAS GOOGLE ADS', account: '', campagne: ['[gas]'] },
  ],
};

// ---------- Calcoli (provati in tests/google-ads-script.test.mjs) ----------

// Dal primo del mese di ieri a ieri. oggi = 'YYYY-MM-DD'.
function periodo(oggi) {
  var p = oggi.split('-').map(Number);
  var ieri = new Date(Date.UTC(p[0], p[1] - 1, p[2] - 1));
  var iso = function (d) { return d.toISOString().slice(0, 10); };
  return { da: iso(ieri).slice(0, 8) + '01', a: iso(ieri) };
}

function abbina(blocco, nome) {
  var n = String(nome).toLowerCase();
  var dentro = function (f) { return n.indexOf(String(f).toLowerCase()) !== -1; };
  if ((blocco.escludi || []).some(dentro)) return false;
  return !(blocco.campagne || []).length || blocco.campagne.some(dentro);
}

var tondo = function (x) { return Math.round(x * 100) / 100; };

// spesa: [{nome, costo €, conversioni}] del periodo; campagne: [{nome, attiva, budgetId, periodoBudget, budgetGiorno €}]
// non rimosse. Torna il carico per saveGoogle, o null se nessuna campagna dell'account è del blocco.
function riepilogo(blocco, spesa, campagne, data) {
  var s = spesa.filter(function (r) { return abbina(blocco, r.nome); });
  var c = campagne.filter(function (r) { return abbina(blocco, r.nome); });
  if (!s.length && !c.length) return null;
  var budgets = {};
  c.forEach(function (r) { if (r.attiva && r.periodoBudget === 'DAILY') budgets[r.budgetId] = r.budgetGiorno; });
  return {
    channel_id: blocco.channel_id,
    title: blocco.title,
    date: data,
    spent_mtd: tondo(s.reduce(function (a, r) { return a + r.costo; }, 0)),
    leads_mtd: Math.round(s.reduce(function (a, r) { return a + r.conversioni; }, 0)),
    daily_budget: tondo(Object.keys(budgets).reduce(function (a, k) { return a + budgets[k]; }, 0)),
    active: c.some(function (r) { return r.attiva; }),
  };
}

// Campagne dello stesso account contate da più di un blocco: vanno separate con campagne/escludi.
function sovrapposizioni(blocchi, nomi) {
  return nomi.filter(function (n) { return blocchi.filter(function (b) { return abbina(b, n); }).length > 1; });
}

function controllaConfig(blocchi) {
  var errori = [];
  var daConfigurare = [];
  var visti = {};
  blocchi.forEach(function (b) {
    if (!b.channel_id || !b.title) errori.push('blocco senza channel_id o title');
    if (visti[b.channel_id]) errori.push(b.channel_id + ' compare due volte');
    visti[b.channel_id] = true;
    if (!b.account) daConfigurare.push(b.channel_id);
    else if (!/^\d{3}-\d{3}-\d{4}$/.test(b.account)) errori.push(b.channel_id + ': account "' + b.account + '" non nel formato 123-456-7890');
  });
  return { errori: errori, daConfigurare: daConfigurare };
}

// ---------- Google Ads e invio (solo nell'account di Marco) ----------

function leggiSpesa(p) {
  var out = [];
  var rows = AdsApp.search("SELECT campaign.name, metrics.cost_micros, metrics.conversions FROM campaign " +
    "WHERE segments.date BETWEEN '" + p.da + "' AND '" + p.a + "'");
  while (rows.hasNext()) {
    var r = rows.next();
    out.push({ nome: r.campaign.name, costo: Number(r.metrics.costMicros || 0) / 1e6, conversioni: Number(r.metrics.conversions || 0) });
  }
  return out;
}

function leggiCampagne() {
  var out = [];
  var rows = AdsApp.search('SELECT campaign.name, campaign.status, campaign.serving_status, campaign_budget.resource_name, ' +
    "campaign_budget.period, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'");
  while (rows.hasNext()) {
    var r = rows.next();
    var b = r.campaignBudget || {};
    out.push({
      nome: r.campaign.name,
      attiva: r.campaign.status === 'ENABLED' && r.campaign.servingStatus === 'SERVING',
      budgetId: b.resourceName || r.campaign.name,
      periodoBudget: b.period || 'DAILY',
      budgetGiorno: Number(b.amountMicros || 0) / 1e6,
    });
  }
  return out;
}

function invia(carico) {
  var res = UrlFetchApp.fetch(CONFIG.WEB_APP_URL, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(Object.assign({}, carico, { action: 'saveGoogle', code: CONFIG.CODICE })),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: 'risposta non leggibile (' + res.getResponseCode() + ')' }; }
}

function main() {
  var cfg = controllaConfig(CONFIG.BLOCCHI);
  if (cfg.errori.length) throw new Error('Configurazione da sistemare: ' + cfg.errori.join(' · '));
  if (!CONFIG.ANTEPRIMA && CONFIG.CODICE === 'INCOLLA_QUI_IL_TUO_CODICE') throw new Error('Manca il codice personale in CONFIG.CODICE');
  if (cfg.daConfigurare.length) Logger.log('Blocchi saltati (account da inserire): ' + cfg.daConfigurare.join(', '));

  var p = periodo(Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd'));
  Logger.log('Periodo ' + p.da + ' → ' + p.a + (CONFIG.ANTEPRIMA ? ' · ANTEPRIMA: niente invii' : ''));

  var perAccount = {};
  CONFIG.BLOCCHI.filter(function (b) { return b.account; }).forEach(function (b) { (perAccount[b.account] = perAccount[b.account] || []).push(b); });
  var ids = Object.keys(perAccount);
  if (!ids.length) { Logger.log('Nessun account configurato.'); return; }

  var trovati = {};
  var it = AdsManagerApp.accounts().withIds(ids).get();
  while (it.hasNext()) {
    var acc = it.next();
    var id = acc.getCustomerId();
    trovati[id] = true;
    AdsManagerApp.select(acc);
    if (acc.getCurrencyCode() !== 'EUR') { Logger.log(id + ': valuta ' + acc.getCurrencyCode() + ', saltato'); continue; }
    var spesa = leggiSpesa(p);
    var campagne = leggiCampagne();
    var doppie = sovrapposizioni(perAccount[id], campagne.map(function (c) { return c.nome; }));
    if (doppie.length) Logger.log('ATTENZIONE ' + id + ': campagne contate in più blocchi: ' + doppie.join(', '));
    perAccount[id].forEach(function (b) {
      var carico = riepilogo(b, spesa, campagne, p.a);
      if (!carico) { Logger.log(b.channel_id + ': nessuna campagna abbinata in ' + id + ', niente invio (controlla campagne/escludi)'); return; }
      var riga = b.channel_id + ': speso ' + carico.spent_mtd + ' € · conversioni ' + carico.leads_mtd +
        ' · budget ' + carico.daily_budget + ' €/g · ' + (carico.active ? 'attivo' : 'fermo');
      if (CONFIG.ANTEPRIMA) { Logger.log('[anteprima] ' + riga); return; }
      var r = invia(carico);
      Logger.log((r.ok ? 'OK ' : 'ERRORE ') + riga + (r.ok ? (r.sheet && r.sheet !== 'aggiornato' ? ' (Sheet: ' + r.sheet + ')' : '') : ' → ' + r.error));
    });
  }
  ids.filter(function (i) { return !trovati[i]; }).forEach(function (i) { Logger.log(i + ': account non trovato sotto questo MCC'); });
}

if (typeof module !== 'undefined') {
  module.exports = { CONFIG: CONFIG, periodo: periodo, abbina: abbina, riepilogo: riepilogo, sovrapposizioni: sovrapposizioni, controllaConfig: controllaConfig };
}
