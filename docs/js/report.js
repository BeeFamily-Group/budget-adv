// Report mensile per il cliente in PDF: speso del mese, programmato del mese dopo, speso sul totale del piano.
// Niente altro (deciso con Ambra il 09/11/2026). Grafica del sito consulenzaperhotel.it: blu notte, giallo,
// font Outfit, logo in testa e nel piede con i dati della società. jsPDF, font e logo si caricano solo al clic.
import { fmtEur } from './calc.js';
import { monthLong } from './months.js';
import { channelLabel } from './viewmodel.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const LOGO_URL = 'img/beefamily-logo.png';   // 250×59, già ritagliato sul marchio
// Outfit statico (TrueType) da Google Fonts: se non arriva, il report esce in Helvetica.
const FONT_URLS = {
  regular: 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC1C4E.ttf',
  semibold: 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4e6yC4E.ttf',
  extrabold: 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4bCyC4E.ttf',
};

// Come nel piede del sito.
export const COMPANY = {
  name: 'Bee Family — Stigma Consulting srl',
  address: 'Strada di Paderna, 2 · 47895 Fiorina (Rep. di San Marino)',
  contacts: 'Tel +39 0549 978423 · WhatsApp +39 351 988 2182',
  site: 'consulenzaperhotel.it',
};

let loading = null;

function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.crossOrigin = 'anonymous';
      s.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('libreria PDF non caricata')));
      s.onerror = () => { loading = null; reject(new Error('libreria PDF non raggiungibile, riprova')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const base64Of = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

let assetsLoading = null;
// Logo (data URL) e font (base64): ciò che non arriva resta null e il report usa il ripiego.
function loadAssets() {
  if (!assetsLoading) {
    const get = (url) => fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))));
    const logo = get(LOGO_URL).then(b => `data:image/png;base64,${base64Of(b)}`).catch(() => null);
    const fonts = Promise.all(Object.entries(FONT_URLS).map(([k, u]) => get(u).then(b => [k, base64Of(b)])))
      .then(Object.fromEntries).catch(() => null);
    assetsLoading = Promise.all([logo, fonts]).then(([l, f]) => ({ logo: l, fonts: f }));
  }
  return assetsLoading;
}

// Colori del sito
const NIGHT = [1, 13, 26];        // #010D1A
const NIGHT_2 = [28, 48, 71];     // binario della barra sul blu
const YEL = [255, 196, 0];        // #FFC400
const INK = [1, 13, 26];
const BODY = [63, 82, 102];
const MUTED = [110, 128, 145];
const LIGHT = [201, 214, 225];    // testo chiaro del sito
const DIM = [129, 149, 163];      // #8195A3
const SOFT = [243, 246, 249];
const WHITE = [255, 255, 255];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

export function reportFileName(r) {
  const tab = String(r.tab).replace(/&/g, 'e').replace(/[\\/:*?"<>|]/g, '-');
  return `Report ADV ${tab} - ${cap(monthLong(r.month.ym))}.pdf`;
}

export function reportPdf(r, JsPDF, today, assets = {}) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const X = 18;
  const CW = W - X * 2;
  const logo = assets.logo || null;
  const fonts = assets.fonts || null;
  if (fonts) {
    for (const [style, b64] of Object.entries(fonts)) {
      const file = `Outfit-${style}.ttf`;
      doc.addFileToVFS(file, b64);
      doc.addFont(file, 'Outfit', style);
    }
  }
  const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const font = (style, size) => {   // style: regular | semibold | extrabold
    if (fonts) doc.setFont('Outfit', style); else doc.setFont('helvetica', style === 'regular' ? 'normal' : 'bold');
    doc.setFontSize(size);
  };
  const eyebrow = (text, x, y, c) => {   // etichetta maiuscola spaziata, come sul sito
    color(c); font('semibold', 8); doc.setCharSpace(0.5); doc.text(text.toUpperCase(), x, y); doc.setCharSpace(0);
  };

  // Testata blu notte con il logo
  fill(NIGHT); doc.rect(0, 0, W, 44, 'F');
  fill(YEL); doc.rect(0, 44, W, 1.2, 'F');
  if (logo) doc.addImage(logo, 'PNG', X, 19, 52, 12.3);
  else { color(WHITE); font('extrabold', 20); doc.text('BeeFamily', X, 25); }
  color(YEL); font('semibold', 8); doc.text('REPORT INVESTIMENTO PUBBLICITARIO', W - X, 16, { align: 'right' });
  color(WHITE); font('extrabold', 20); doc.text(cap(monthLong(r.month.ym)), W - X, 27, { align: 'right' });
  color(LIGHT); font('regular', 9);
  doc.text(r.month.inProgress ? `mese in corso · dati al ${dmy(r.asOf)}` : 'mese concluso', W - X, 34, { align: 'right' });

  // Struttura
  eyebrow('Struttura', X, 59, MUTED);
  color(INK); font('extrabold', 26); doc.text(String(r.tab), X, 70);
  fill(YEL); doc.rect(X, 74, 16, 1.4, 'F');

  // Riquadri chiari con il filetto giallo a sinistra
  const card = (y, h, label) => {
    fill(SOFT); doc.roundedRect(X, y, CW, h, 3, 3, 'F');
    fill(YEL); doc.rect(X, y + 6, 1.6, h - 12, 'F');
    eyebrow(label, X + 9, y + 11, MUTED);
  };
  const big = (y, text, small, c = INK, cs = MUTED) => {
    color(c); font('extrabold', 28); doc.text(text, X + 9, y);
    if (small) {
      const w = doc.getTextWidth(text);
      color(cs); font('regular', 11); doc.text(small, X + 9 + w + 3, y);
    }
  };
  const line = (y, text, c = BODY, size = 10) => { color(c); font('regular', size); doc.text(text, X + 9, y); };

  // 1. Investimento del mese
  let y = 82;
  const h1 = r.month.inProgress ? 50 : 44;
  card(y, h1, `Investimento di ${monthLong(r.month.ym)}`);
  big(y + 27, fmtEur(r.month.spent));
  line(y + 37, r.month.programmed > 0 ? `su ${fmtEur(r.month.programmed)} programmati nel mese` : 'nessun investimento programmato nel mese');
  if (r.month.inProgress) line(y + 44, `il mese è ancora in corso: dato aggiornato al ${dmy(r.asOf)}`, MUTED, 8);

  // 2. Programmazione del mese dopo
  y += h1 + 7;
  if (r.next) {
    const lines = [];
    if (!(r.next.programmed > 0)) lines.push('nessun investimento programmato');
    else if (r.next.perDay !== null) lines.push(`${fmtEur(r.next.perDay)} al giorno per ${r.next.days} giorni`);
    else r.next.channels.forEach(c => lines.push(`${channelLabel(c.title)}: ${fmtEur(c.eur)} al giorno per ${c.days} giorni`));
    const h = 40 + lines.length * 6;
    card(y, h, `Programmazione di ${monthLong(r.next.ym)}`);
    big(y + 27, fmtEur(r.next.programmed));
    lines.forEach((t, k) => line(y + 37 + k * 6, t));
    y += h + 7;
  }

  // 3. Avanzamento sul budget complessivo: riquadro blu notte, barra gialla
  const t = r.total;
  fill(NIGHT); doc.roundedRect(X, y, CW, 60, 3, 3, 'F');
  eyebrow('Avanzamento sul budget complessivo', X + 9, y + 11, YEL);
  color(LIGHT); font('regular', 9); doc.text(`da ${monthLong(r.from)} a ${monthLong(r.to)}`, X + 9, y + 18);
  big(y + 34, fmtEur(t.spent), `investiti su ${fmtEur(t.programmed)}`, WHITE, LIGHT);
  const bx = X + 9;
  const bw = CW - 18;
  fill(NIGHT_2); doc.roundedRect(bx, y + 41, bw, 4, 2, 2, 'F');
  const share = t.programmed > 0 ? Math.min(t.spent / t.programmed, 1) : 0;
  if (share > 0) { fill(YEL); doc.roundedRect(bx, y + 41, Math.max(bw * share, 4), 4, 2, 2, 'F'); }
  color(LIGHT); font('regular', 10);
  doc.text(`${t.pct === null ? '—' : `${t.pct}%`} del budget complessivo · restano ${fmtEur(Math.max(t.remaining, 0))}`, X + 9, y + 53);

  // Piede come sul sito: logo e dati della società
  fill(NIGHT); doc.rect(0, 274, W, 23, 'F');
  if (logo) doc.addImage(logo, 'PNG', X, 281.5, 34, 8);
  else { color(WHITE); font('extrabold', 12); doc.text('BeeFamily', X, 287); }
  color(LIGHT); font('regular', 7);
  doc.text(`${COMPANY.name} · ${COMPANY.address}`, W - X, 281, { align: 'right' });
  doc.text(`${COMPANY.contacts} · ${COMPANY.site}`, W - X, 285.5, { align: 'right' });
  color(DIM);
  doc.text(`Report generato il ${dmy(today)} · dati aggiornati al ${dmy(r.asOf)}`, W - X, 290, { align: 'right' });
  return doc;
}

export async function downloadReport(r) {
  const [JsPDF, assets] = await Promise.all([loadJsPdf(), loadAssets()]);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  reportPdf(r, JsPDF, today, assets).save(reportFileName(r));
}

export { loadJsPdf };
