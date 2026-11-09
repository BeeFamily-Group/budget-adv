// Report mensile per il cliente in PDF: speso del mese, programmato del mese dopo, speso sul totale del piano.
// Niente altro (deciso con Ambra il 09/11/2026). jsPDF si carica da cdnjs solo al primo clic.
import { fmtEur } from './calc.js';
import { monthLong } from './app.js';
import { channelLabel } from './viewmodel.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
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

const NAVY = [30, 42, 91];
const INK = [15, 22, 51];
const MUTED = [102, 107, 128];
const LINE = [232, 229, 222];
const CREAM = [250, 247, 242];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

export function reportFileName(r) {
  const tab = String(r.tab).replace(/&/g, 'e').replace(/[\\/:*?"<>|]/g, '-');
  return `Report ADV ${tab} - ${cap(monthLong(r.month.ym))}.pdf`;
}

export function reportPdf(r, JsPDF, today) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const X = 18;
  const CW = W - X * 2;
  const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

  // Intestazione
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 34, 'F');
  color([255, 255, 255]);
  font('bold', 18); doc.text('BeeFamily', X, 16);
  font('normal', 10); doc.text('Report investimento pubblicitario', X, 24);
  font('bold', 12); doc.text(cap(monthLong(r.month.ym)), W - X, 16, { align: 'right' });
  font('normal', 9); doc.text(r.month.inProgress ? `mese in corso · dati al ${dmy(r.asOf)}` : 'mese concluso', W - X, 24, { align: 'right' });

  color(INK);
  font('bold', 24); doc.text(String(r.tab), X, 52);

  const card = (y, h, label) => {
    doc.setFillColor(...CREAM);
    doc.setDrawColor(...LINE);
    doc.roundedRect(X, y, CW, h, 3, 3, 'FD');
    color(MUTED); font('bold', 9); doc.text(label.toUpperCase(), X + 8, y + 11);
  };
  const big = (y, text, small) => {
    color(INK); font('bold', 28); doc.text(text, X + 8, y);
    if (small) {
      const w = doc.getTextWidth(text);
      color(MUTED); font('normal', 11); doc.text(small, X + 8 + w + 3, y);
    }
  };
  const line = (y, text, c = MUTED, size = 10) => { color(c); font('normal', size); doc.text(text, X + 8, y); };

  // 1. Investimento del mese
  let y = 62;
  const h1 = r.month.inProgress ? 52 : 46;
  card(y, h1, `Investimento di ${monthLong(r.month.ym)}`);
  big(y + 28, fmtEur(r.month.spent));
  line(y + 38, r.month.programmed > 0 ? `su ${fmtEur(r.month.programmed)} programmati nel mese` : 'nessun investimento programmato nel mese');
  if (r.month.inProgress) line(y + 44, `il mese è ancora in corso: dato aggiornato al ${dmy(r.asOf)}`, MUTED, 8);

  // 2. Programmazione del mese dopo
  y += h1 + 8;
  if (r.next) {
    const lines = [];
    if (!(r.next.programmed > 0)) lines.push('nessun investimento programmato');
    else if (r.next.perDay !== null) lines.push(`${fmtEur(r.next.perDay)} al giorno per ${r.next.days} giorni`);
    else r.next.channels.forEach(c => lines.push(`${channelLabel(c.title)}: ${fmtEur(c.eur)} al giorno per ${c.days} giorni`));
    const h = 40 + lines.length * 6;
    card(y, h, `Programmazione di ${monthLong(r.next.ym)}`);
    big(y + 28, fmtEur(r.next.programmed));
    lines.forEach((t, k) => line(y + 38 + k * 6, t));
    y += h + 8;
  }

  // 3. Avanzamento sul budget complessivo
  const t = r.total;
  card(y, 58, 'Avanzamento sul budget complessivo');
  line(y + 17, `da ${monthLong(r.from)} a ${monthLong(r.to)}`, MUTED, 9);
  big(y + 33, fmtEur(t.spent), `investiti su ${fmtEur(t.programmed)}`);
  const bx = X + 8;
  const bw = CW - 16;
  doc.setFillColor(...LINE);
  doc.roundedRect(bx, y + 39, bw, 4, 2, 2, 'F');
  const share = t.programmed > 0 ? Math.min(t.spent / t.programmed, 1) : 0;
  if (share > 0) { doc.setFillColor(...NAVY); doc.roundedRect(bx, y + 39, Math.max(bw * share, 4), 4, 2, 2, 'F'); }
  line(y + 51, `${t.pct === null ? '—' : `${t.pct}%`} del budget complessivo · restano ${fmtEur(Math.max(t.remaining, 0))}`);

  // Piede
  doc.setDrawColor(...LINE);
  doc.line(X, 280, W - X, 280);
  color(MUTED); font('normal', 8);
  doc.text(`BeeFamily · report generato il ${dmy(today)}`, X, 286);
  doc.text(`Dati aggiornati al ${dmy(r.asOf)}`, W - X, 286, { align: 'right' });
  return doc;
}

export async function downloadReport(r) {
  const JsPDF = await loadJsPdf();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  reportPdf(r, JsPDF, today).save(reportFileName(r));
}

export { loadJsPdf };
