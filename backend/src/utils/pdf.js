import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARABIC_FONT = join(__dirname, '..', '..', 'fonts', 'NotoSansArabic-Regular.ttf');

/** Pass-through for Arabic text — fontkit (inside pdfkit) handles both glyph shaping
 *  (via OpenType GSUB tables) AND visual layout when the font supports it.
 *  bidi-js reordering was removed because it produced visual-order text that broke
 *  fontkit's contextual glyph selection, causing disconnected letters and tofu boxes. */
export function processArabicText(text) {
  return text;
}

/**
 * OpenType features that enable Arabic contextual joining + ligatures. fontkit shapes
 * and bidi-reorders Arabic correctly on its own; passing an explicit (truthy) feature
 * list also forces pdfkit to shape the whole string at once — its word-splitting path
 * otherwise drops fontkit's RTL direction on multi-word text. So Arabic joins AND orders
 * correctly with this list.
 */
const AR_FEATURES = ['init', 'medi', 'fina', 'isol', 'rlig', 'liga', 'calt', 'ccmp', 'mark', 'mkmk', 'kern'];

/** True when the string contains any Arabic-script character (incl. presentation forms). */
function hasArabic(s) {
  return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(String(s ?? ''));
}

/** Timestamp "YYYY-MM-DD HH:MM" using only glyphs the Arabic font covers (digits, hyphen,
 *  colon) — safe to concatenate with Arabic text in a single draw without tofu. */
function safeStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Reduce a string for the Arabic-only font: keep the Arabic side of each "English — Arabic"
 * segment and swap punctuation the font lacks (·, •, /, …) for covered equivalents so mixed
 * data cells render cleanly. Strings with no Arabic are returned unchanged — they get drawn
 * with Helvetica (which covers Latin, digits and all punctuation) by `textArabic`.
 */
function arReduce(s) {
  s = String(s ?? '');
  if (!hasArabic(s)) return s;                                 // pure Latin/number → Helvetica handles it
  s = s.replace(/[A-Za-z][A-Za-z0-9 .,'&()\-]*—\s*/g, '');     // drop the English half of "English — Arabic"
  s = s.replace(/…/g, '...').replace(/[—·•*+/]/g, '-').replace(/[()]/g, ' '); // punctuation the Arabic font lacks
  s = s.replace(/[A-Za-z]+/g, ' ');                            // any remaining Latin can't render on the Arabic font
  return s.replace(/\s{2,}/g, ' ').replace(/(^[\s-]+)|([\s-]+$)/g, '').trim() || String(s ?? '');
}

/**
 * Draw a line of text inside an Arabic document, choosing the font by script.
 * NotoSansArabic has NO Latin letters / em-dash / slash / @ / parenthesis glyphs, so a
 * string containing Latin letters (English names, codes like "INV-12", an English brand
 * name) renders as tofu boxes if drawn with it. Such strings are drawn with Helvetica
 * instead; Arabic text — and plain digits/punctuation, which the Arabic font does cover —
 * keeps the Arabic font with joining features enabled. Callers set size/color beforehand.
 */
function textArabic(doc, str, x, y, opts = {}) {
  const s = String(str ?? '');
  // No Arabic → Helvetica renders Latin, digits and punctuation (/, %, …, ·) cleanly.
  // The Arabic font only covers Arabic + digits + a little punctuation, so it must not
  // receive Latin/number/date/percent-only strings (they'd come out as tofu boxes).
  if (!hasArabic(s)) return doc.font('Helvetica').text(s, x, y, opts);
  // Arabic string: strip any English bilingual halves + swap punctuation the font lacks.
  return doc.text(arReduce(s), x, y, { features: AR_FEATURES, ...opts });
}

/* ---- Palette ---- */
const BRAND = '#6d28d9';
const BRAND_SOFT = '#f3f0ff';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const STRIPE = '#faf9fe';

/** Bilingual data is stored as "English — Arabic", but the built-in Helvetica
 *  font cannot render Arabic glyphs (they'd come out as garbage). Keep the Latin
 *  side for PDFs; the web UI still shows both. */
function latin(s) {
  s = String(s ?? '');
  const i = s.indexOf('—');
  return i >= 0 ? s.slice(0, i).trim() || s : s;
}

/** Extract the Arabic side of a bilingual "English — Arabic" string. */
function arabic(s) {
  s = String(s ?? '');
  const i = s.indexOf('—');
  return i >= 0 ? s.slice(i + 1).trim() || s : s;
}

/** Read the Arabic font file (cached after first call). */
let _arabicFontBuf = null;
function getArabicFontBuffer() {
  if (!_arabicFontBuf) _arabicFontBuf = readFileSync(ARABIC_FONT);
  return _arabicFontBuf;
}

/** Register the Arabic font on a pdfkit document. Returns 'NotoSansArabic'. */
function registerArabicFont(doc) {
  doc.registerFont('NotoSansArabic', getArabicFontBuffer());
  return 'NotoSansArabic';
}

/** Truncate a string with an ellipsis so it fits `width` on a single line.
 *  Caller must set the active font + size before calling.
 *  Arabic text should already be processed by the caller — this function only truncates. */
function clip(doc, str, width) {
  str = String(str ?? '-');
  if (doc.widthOfString(str) <= width) return str;
  const ell = '...'; // ASCII (the Arabic font lacks the … glyph)
  while (str.length > 1 && doc.widthOfString(str + ell) > width) str = str.slice(0, -1);
  return str.trim() + ell;
}

/**
 * Greedy word-wrap into physical lines. Each returned line is meant to be drawn as ONE shaped
 * string (with `lineBreak:false`) so Arabic keeps its correct RTL word order — pdfkit's own line
 * wrapper splits on spaces and drops fontkit's RTL direction. Widths are measured with the active
 * font, so the caller MUST set `doc.font()`+`fontSize()` before calling. Never exceeds `maxLines`
 * (the last line is truncated with an ASCII ellipsis, which the Arabic font can render). */
function wrapLines(doc, str, width, maxLines = 2) {
  str = String(str ?? '').replace(/\s+/g, ' ').trim();
  if (!str) return ['-'];
  if (doc.widthOfString(str) <= width) return [str];
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const cand = line ? `${line} ${word}` : word;
    if (doc.widthOfString(cand) <= width) { line = cand; continue; }
    if (line) lines.push(line);
    // Hard-break a single token that is itself wider than the column.
    let w = word;
    while (doc.widthOfString(w) > width && w.length > 1) {
      let chunk = w;
      while (chunk.length > 1 && doc.widthOfString(chunk) > width) chunk = chunk.slice(0, -1);
      lines.push(chunk); w = w.slice(chunk.length);
    }
    line = w;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const ell = '...'; // ASCII — the Arabic font covers '.', not '…'
  let last = kept[maxLines - 1];
  while (last.length > 1 && doc.widthOfString(last + ell) > width) last = last.slice(0, -1);
  kept[maxLines - 1] = last.trim() + ell;
  return kept;
}

/** Compact number formatting for chart labels. */
function fmtNum(v) {
  const n = Number(v || 0);
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(+n.toFixed(2));
}

/**
 * Draw a simple vector bar chart. `data` = [{label, value}]. Returns the new y.
 * Auto-paginates if there isn't room.
 */
function drawBarChart(doc, { title, data = [], color = BRAND, lang }, y) {
  const isAr = lang === 'ar';
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const H = 150;       // plot height
  const labelH = 26;   // room for x labels
  if (y + H + 50 > doc.page.height - 60) { doc.addPage(); y = 50; }
  if (title) {
    const boldFont = isAr ? 'NotoSansArabic' : 'Helvetica-Bold';
    doc.font(boldFont).fontSize(11).fillColor(INK);
    if (isAr) textArabic(doc, title, left, y); else doc.text(title, left, y);
    y += 18;
  }
  const bottom = y + H;
  const chartLeft = left + 8;
  const chartRight = left + usable - 8;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value) || 0));
  const n = data.length || 1;
  const slot = (chartRight - chartLeft) / n;
  const barW = Math.min(52, slot * 0.6);

  doc.save().strokeColor(LINE).lineWidth(1).moveTo(chartLeft, bottom).lineTo(chartRight, bottom).stroke().restore();
  data.forEach((d, i) => {
    const h = (Math.abs(d.value || 0) / max) * (H - labelH);
    const cx = chartLeft + slot * i + slot / 2;
    const bx = cx - barW / 2;
    const by = bottom - h;
    doc.save().fillColor(d.value < 0 ? '#ef4444' : color).roundedRect(bx, by, barW, Math.max(1, h), 3).fill().restore();
    const boldFont = isAr ? 'NotoSansArabic' : 'Helvetica-Bold';
    const regFont = isAr ? 'NotoSansArabic' : 'Helvetica';
    doc.font(boldFont).fontSize(7.5).fillColor(INK)
      .text(fmtNum(d.value), bx - 8, by - 11, { width: barW + 16, align: 'center', lineBreak: false });
    const lbl = isAr ? arReduce(String(d.label)) : latin(String(d.label));
    doc.font(regFont).fontSize(7.5).fillColor(MUTED);
    const clippedLbl = clip(doc, lbl, slot - 4);
    if (isAr) textArabic(doc, clippedLbl, chartLeft + slot * i + 2, bottom + 5, { width: slot - 4, align: 'center', lineBreak: false });
    else doc.text(clippedLbl, chartLeft + slot * i + 2, bottom + 5, { width: slot - 4, align: 'center', lineBreak: false });
  });
  return bottom + labelH + 8;
}

/**
 * Render a branded tabular report to a PDF buffer.
 * @param {object} opts { title, subtitle, columns:[{key,label,align,format,weight}], rows, totals, meta, chart }
 */
export function renderReportPdf(opts) {
  const { title, titleAr, subtitle, columns = [], rows = [], totals, meta = {}, chart, lang, filename: givenFilename } = opts;
  const isAr = lang === 'ar';
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      const safe = (isAr ? titleAr : title || 'report')?.replace(/[^\w\u0600-\u06FF\- ]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'report';
      resolve({ buffer: buf, filename: givenFilename || `${safe}_${new Date().toISOString().slice(0, 10)}.pdf` });
    });
    doc.on('error', reject);

    // Register Arabic font if needed
    if (isAr) registerArabicFont(doc);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const ROW_H = 22;

    // Font helpers: switch between Helvetica (Latin) and NotoSansArabic (Arabic)
    const boldFont = isAr ? 'NotoSansArabic' : 'Helvetica-Bold';
    const regFont = isAr ? 'NotoSansArabic' : 'Helvetica';
    const obliqueFont = isAr ? 'NotoSansArabic' : 'Helvetica-Oblique';
    // For Arabic, align text right (RTL); for Latin, keep left
    const headerAlign = isAr ? 'right' : 'left';

    /* ---- Header band ---- */
    doc.save();
    doc.rect(0, 0, doc.page.width, 96).fill(BRAND);
    // logo chip
    doc.roundedRect(left, 26, 44, 44, 11).fill('#ffffff');
    const rName = isAr ? (arReduce(meta.restaurantName) || 'نظام إدارة المطعم') : (latin(meta.restaurantName) || 'Restaurant Management System');
    // Logo initial: use a Latin font when the initial isn't Arabic (the Arabic font has no Latin glyphs).
    const logoCh = rName.trim().charAt(0).toUpperCase();
    doc.fillColor(BRAND).fontSize(22).font(hasArabic(logoCh) ? boldFont : 'Helvetica-Bold')
      .text(logoCh, left, 37, { width: 44, align: 'center' });
    doc.fillColor('#ffffff').font(boldFont).fontSize(18);
    if (isAr) textArabic(doc, rName, left + 58, 32, { width: usable - 58, lineBreak: false });
    else doc.text(rName, left + 58, 32, { width: usable - 58, lineBreak: false });
    doc.font(regFont).fontSize(11).fillColor('#e9d5ff');
    if (isAr) textArabic(doc, titleAr || title || 'تقرير', left + 58, 56, { width: usable - 58, align: headerAlign });
    else doc.text(title || 'Report', left + 58, 56, { width: usable - 58, align: headerAlign });
    doc.restore();

    /* ---- Meta line ---- */
    let y = 116;
    doc.font(regFont).fontSize(9).fillColor(MUTED);
    if (isAr) {
      textArabic(doc, `تم الإنشاء: ${safeStamp()}`, left, y, { align: 'right' });
    } else {
      doc.text(`Generated ${new Date().toLocaleString()}`, left, y);
    }
    if (subtitle) { y += 13; if (isAr) textArabic(doc, subtitle, left, y, { align: 'right' }); else doc.text(subtitle, left, y, { align: 'left' }); }
    y += 24;

    /* ---- Optional chart ---- */
    if (chart && chart.data && chart.data.length) y = drawBarChart(doc, { ...chart, lang }, y) + 6;

    /* ---- Column geometry (weighted; first/text columns get more room) ---- */
    const weights = columns.map((c, i) => c.weight || (i === 0 ? 2 : c.align === 'right' ? 1 : 1.2));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const colX = [];
    const colW = [];
    let acc = left;
    weights.forEach((w) => {
      const width = (w / wsum) * usable;
      colX.push(acc); colW.push(width); acc += width;
    });
    const PAD = 8;

    // Resolve column label: use labelAr for Arabic, otherwise label
    const colLabel = (col) => isAr ? (col.labelAr || col.label) : col.label;
    // Resolve cell value: use arabic() for bilingual data in Arabic mode, latin() for Latin mode
    const cellText = (val) => isAr ? arReduce(String(val ?? '')) : latin(String(val ?? ''));

    const drawHeaderRow = () => {
      doc.save();
      doc.roundedRect(left, y, usable, ROW_H, 5).fill(BRAND_SOFT);
      doc.restore();
      doc.font(boldFont).fontSize(9).fillColor(BRAND);
      columns.forEach((col, i) => {
        const txt = clip(doc, String(colLabel(col)), colW[i] - PAD * 2);
        if (isAr) textArabic(doc, txt, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
        else doc.text(txt, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
      });
      y += ROW_H + 2;
    };

    drawHeaderRow();

    /* ---- Data rows ---- */
    doc.font(regFont).fontSize(9.5);
    rows.forEach((row, idx) => {
      if (y + ROW_H > doc.page.height - 60) {
        doc.addPage();
        y = 50;
        drawHeaderRow();
        doc.font(regFont).fontSize(9.5);
      }
      if (idx % 2 === 1) {
        doc.save();
        doc.rect(left, y, usable, ROW_H).fill(STRIPE);
        doc.restore();
      }
      doc.fillColor(INK);
      columns.forEach((col, i) => {
        const raw = row[col.key];
        const val = col.format ? col.format(raw, row) : raw;
        const txt = clip(doc, cellText(val), colW[i] - PAD * 2);
        if (isAr) textArabic(doc, txt, colX[i] + PAD, y + 6, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
        else doc.text(txt, colX[i] + PAD, y + 6, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
      });
      // subtle row separator
      doc.save();
      doc.strokeColor(LINE).lineWidth(0.5)
        .moveTo(left, y + ROW_H).lineTo(left + usable, y + ROW_H).stroke();
      doc.restore();
      y += ROW_H;
    });

    if (rows.length === 0) {
      doc.fillColor(MUTED).font(obliqueFont).fontSize(10);
      if (isAr) textArabic(doc, 'لا توجد بيانات لهذا التقرير.', left, y + 10, { width: usable, align: 'center' });
      else doc.text('No data for this report.', left, y + 10, { width: usable, align: 'center' });
      y += 30;
    }

    /* ---- Totals ---- */
    if (totals) {
      y += 8;
      if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = 50; }
      doc.save();
      doc.roundedRect(left, y, usable, ROW_H + 2, 5).fill(BRAND);
      doc.restore();
      doc.font(boldFont).fontSize(10).fillColor('#ffffff');
      let labelPlaced = false;
      columns.forEach((col, i) => {
        if (totals[col.key] !== undefined) {
          const txt = clip(doc, totals[col.key], colW[i] - PAD * 2);
          if (isAr) textArabic(doc, txt, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
          else doc.text(txt, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
        } else if (!labelPlaced) {
          labelPlaced = true;
          if (isAr) textArabic(doc, 'المجموع', colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, lineBreak: false });
          else doc.text('TOTAL', colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, lineBreak: false });
        }
      });
    }

    /* ---- Footer + page numbers (every page) ---- */
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      // Keep the footer above the bottom margin, otherwise pdfkit auto-adds a page.
      const fy = doc.page.height - 58;
      doc.save();
      doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, fy).lineTo(left + usable, fy).stroke();
      doc.restore();
      doc.font(regFont).fontSize(8).fillColor(MUTED);
      if (isAr) {
        // Confidential marker only — the brand name may be Latin and would tofu on the Arabic font.
        textArabic(doc, 'سري', left, fy + 8, { width: usable / 2, align: 'right', lineBreak: false });
        textArabic(doc, `صفحة ${p + 1} من ${range.count}`, left + usable / 2, fy + 8, { width: usable / 2, align: 'left', lineBreak: false });
      } else {
        const fname = clip(doc, `${latin(meta.restaurantName) || 'Restaurant Management System'} — confidential`, usable / 2 - 6);
        doc.text(fname, left, fy + 8, { width: usable / 2, align: 'left', lineBreak: false });
        doc.text(`Page ${p + 1} of ${range.count}`, left + usable / 2, fy + 8, { width: usable / 2, align: 'right', lineBreak: false });
      }
    }

    doc.end();
  });
}

/**
 * Render several report tables (each with an optional chart) into ONE PDF.
 * @param {object} opts { title, titleAr, subtitle, meta, sections:[{title, columns, rows, totals, chart}], lang, filename }
 */
export function renderMultiReportPdf({ title, titleAr, subtitle, meta = {}, sections = [], lang, filename: givenFilename }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      const isAr = lang === 'ar';
      const safe = (isAr ? titleAr : title || 'report')?.replace(/[^\w\u0600-\u06FF\- ]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'report';
      resolve({ buffer: buf, filename: givenFilename || `${safe}_${new Date().toISOString().slice(0, 10)}.pdf` });
    });
    doc.on('error', reject);

    const isAr = lang === 'ar';
    let boldFont = 'Helvetica-Bold';
    let regFont = 'Helvetica';
    let obliqueFont = 'Helvetica-Oblique';
    if (isAr) {
      registerArabicFont(doc);
      boldFont = 'NotoSansArabic';
      regFont = 'NotoSansArabic';
      obliqueFont = 'NotoSansArabic';
    }

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const ROW_H = 22; const PAD = 8;

    // header band
    doc.save();
    doc.rect(0, 0, doc.page.width, 96).fill(BRAND);
    doc.roundedRect(left, 26, 44, 44, 11).fill('#ffffff');
    const logoCh = (isAr ? (meta.restaurantName || 'ن') : (latin(meta.restaurantName) || 'R')).trim().charAt(0).toUpperCase();
    doc.fillColor(BRAND).fontSize(22).font(hasArabic(logoCh) ? boldFont : 'Helvetica-Bold')
      .text(logoCh, left, 37, { width: 44, align: 'center' });
    if (isAr) {
      doc.fillColor('#ffffff').font(boldFont).fontSize(18);
      textArabic(doc, arReduce(meta.restaurantName) || 'نظام إدارة المطعم', left + 58, 32, { width: usable - 58, lineBreak: false });
    } else {
      doc.fillColor('#ffffff').font(boldFont).fontSize(18)
        .text(latin(meta.restaurantName) || 'Restaurant Management System', left + 58, 32, { width: usable - 58, lineBreak: false });
    }
    if (isAr) {
      doc.font(regFont).fontSize(11).fillColor('#e9d5ff');
      textArabic(doc, title || 'تقرير', left + 58, 56, { width: usable - 58, lineBreak: false });
    } else {
      doc.font(regFont).fontSize(11).fillColor('#e9d5ff').text(title || 'Report', left + 58, 56, { width: usable - 58, lineBreak: false });
    }
    doc.restore();

    let y = 116;
    if (isAr) {
      doc.font(regFont).fontSize(9).fillColor(MUTED);
      textArabic(doc, `تم الإنشاء: ${safeStamp()}`, left, y, { align: 'right' });
    } else {
      doc.font(regFont).fontSize(9).fillColor(MUTED).text(`Generated ${new Date().toLocaleString()}`, left, y);
    }
    if (subtitle) { y += 13; if (isAr) { doc.font(regFont); textArabic(doc, subtitle, left, y, { align: 'right' }); } else { doc.text(subtitle, left, y, { align: 'left' }); } }
    y += 24;

    const colLabel = (col) => isAr ? (col.labelAr || col.label) : col.label;
    const cellText = (val) => isAr ? arReduce(String(val ?? '')) : latin(String(val ?? ''));

    const table = (columns, rows, totals) => {
      const weights = columns.map((c, i) => c.weight || (i === 0 ? 2 : c.align === 'right' ? 1 : 1.2));
      const wsum = weights.reduce((a, b) => a + b, 0);
      const colX = []; const colW = []; let acc = left;
      weights.forEach((w) => { const width = (w / wsum) * usable; colX.push(acc); colW.push(width); acc += width; });
      const headerRow = () => {
        doc.save().roundedRect(left, y, usable, ROW_H, 5).fill(BRAND_SOFT).restore();
        doc.font(boldFont).fontSize(9).fillColor(BRAND);
        columns.forEach((col, i) => {
          const t = clip(doc, String(colLabel(col)), colW[i] - PAD * 2);
          if (isAr) { doc.font(boldFont); textArabic(doc, t, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }); }
          else { doc.text(t, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }); }
        });
        y += ROW_H + 2;
      };
      headerRow();
      doc.font(regFont).fontSize(9.5);
      rows.forEach((row, idx) => {
        if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = 50; headerRow(); doc.font(regFont).fontSize(9.5); }
        if (idx % 2 === 1) doc.save().rect(left, y, usable, ROW_H).fill(STRIPE).restore();
        doc.fillColor(INK);
        columns.forEach((col, i) => {
          const val = col.format ? col.format(row[col.key], row) : row[col.key];
          const t = clip(doc, cellText(val), colW[i] - PAD * 2);
          if (isAr) { doc.font(regFont).fontSize(9.5); textArabic(doc, t, colX[i] + PAD, y + 6, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }); }
          else { doc.text(t, colX[i] + PAD, y + 6, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }); }
        });
        doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, y + ROW_H).lineTo(left + usable, y + ROW_H).stroke().restore();
        y += ROW_H;
      });
      if (!rows.length) {
        if (isAr) { doc.fillColor(MUTED).font(obliqueFont).fontSize(10); textArabic(doc, 'لا توجد بيانات لهذا التقرير.', left, y + 8, { width: usable, align: 'center' }); }
        else { doc.fillColor(MUTED).font(obliqueFont).fontSize(10).text('No data for this report.', left, y + 8, { width: usable, align: 'center' }); }
        y += 28;
      }
      if (totals) {
        y += 6; if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = 50; }
        doc.save().roundedRect(left, y, usable, ROW_H + 2, 5).fill(BRAND).restore();
        doc.font(boldFont).fontSize(10).fillColor('#ffffff'); let labelPlaced = false;
        columns.forEach((col, i) => {
          if (totals[col.key] !== undefined) {
            const t = clip(doc, totals[col.key], colW[i] - PAD * 2);
            if (isAr) { doc.font(boldFont).fillColor('#ffffff'); textArabic(doc, t, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }); }
            else { doc.text(t, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }); }
          } else if (!labelPlaced) {
            labelPlaced = true;
            if (isAr) { doc.font(boldFont).fillColor('#ffffff'); textArabic(doc, 'المجموع', colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, lineBreak: false }); }
            else { doc.text('TOTAL', colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, lineBreak: false }); }
          }
        });
        y += ROW_H + 2;
      }
    };

    sections.forEach((sec, idx) => {
      if (y + 90 > doc.page.height - 60) { doc.addPage(); y = 50; } else if (idx > 0) y += 12;
      if (isAr) { doc.font(boldFont).fontSize(13).fillColor(BRAND); textArabic(doc, sec.title || '', left, y); } else { doc.font(boldFont).fontSize(13).fillColor(BRAND).text(sec.title || '', left, y); } y += 20;
      if (sec.chart && sec.chart.data && sec.chart.data.length) y = drawBarChart(doc, { ...sec.chart, lang }, y) + 6;
      table(sec.columns || [], sec.rows || [], sec.totals);
    });

    // footers
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      const fy = doc.page.height - 58;
      doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, fy).lineTo(left + usable, fy).stroke().restore();
      doc.font(regFont).fontSize(8).fillColor(MUTED);
      if (isAr) {
        // Confidential marker only — the brand name may be Latin and would tofu on the Arabic font.
        textArabic(doc, 'سري', left, fy + 8, { width: usable / 2, align: 'right', lineBreak: false });
        doc.font(regFont).fillColor(MUTED);
        textArabic(doc, `صفحة ${p + 1} من ${range.count}`, left + usable / 2, fy + 8, { width: usable / 2, align: 'left', lineBreak: false });
      } else {
        doc.text(clip(doc, `${latin(meta.restaurantName) || 'Restaurant Management System'} — confidential`, usable / 2 - 6), left, fy + 8, { width: usable / 2, align: 'left', lineBreak: false });
        doc.text(`Page ${p + 1} of ${range.count}`, left + usable / 2, fy + 8, { width: usable / 2, align: 'right', lineBreak: false });
      }
    }
    doc.end();
  });
}

/** Render a printable order invoice / thermal receipt PDF. */
export function renderInvoicePdf(order, meta = {}) {
  return new Promise((resolve, reject) => {
    const W = 300;
    const M = 16;
    const doc = new PDFDocument({ size: [W, 800], margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = M;
    const cw = W - M * 2; // content width
    const cur = meta.currency || '';
    const fmt = (n) => Number(n || 0).toFixed(2);

    const divider = (dashed = false) => {
      doc.moveDown(0.4);
      doc.save().strokeColor(LINE).lineWidth(0.7);
      if (dashed) doc.dash(2, { space: 2 });
      doc.moveTo(left, doc.y).lineTo(left + cw, doc.y).stroke().undash();
      doc.restore();
      doc.moveDown(0.4);
    };

    // Two-column key/value line with the value right-aligned.
    const kv = (label, value) => {
      const yy = doc.y;
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label, left, yy, { width: cw * 0.4 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
        .text(String(value), left + cw * 0.4, yy, { width: cw * 0.6, align: 'right' });
      doc.y = Math.max(doc.y, yy + 12);
    };

    /* ---- Header ---- */
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
      .text(latin(meta.restaurantName) || 'Restaurant', left, doc.y, { width: cw, align: 'center' });
    if (meta.address) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(meta.address, { width: cw, align: 'center' });
    if (meta.phone) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(meta.phone, { width: cw, align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND)
      .text('SALES RECEIPT', { width: cw, align: 'center', characterSpacing: 2 });

    divider();

    /* ---- Order meta ---- */
    kv('Invoice', order.invoiceNo || order.id || '—');
    kv('Date', new Date(order.orderDate || Date.now()).toLocaleString());
    if (order.clientName) kv('Customer', latin(order.clientName));
    if (order.clientPhone) kv('Phone', order.clientPhone);
    if (order.area || order.governorate) kv('Location', latin([order.area, order.governorate].filter(Boolean).join(' / ')));
    if (order.deliveryAddress) kv('Deliver to', latin(order.deliveryAddress));
    if (order.deliveryPerson) kv('Delivery', latin(order.deliveryPerson));
    if (order.cashierName) kv('Cashier', latin(order.cashierName));

    divider();

    /* ---- Items table header (QTY | ITEM | PRICE | TOTAL) ---- */
    const qtyW = 22;
    const unitW = 46;
    const totalW = 50;
    const GAP = 5;
    const nameW = cw - qtyW - unitW - totalW - GAP * 3;
    const nameX = left + qtyW + GAP;
    const unitX = nameX + nameW + GAP;
    const totalX = unitX + unitW + GAP;
    const hy = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
    doc.text('QTY', left, hy, { width: qtyW });
    doc.text('ITEM', nameX, hy, { width: nameW });
    doc.text('PRICE', unitX, hy, { width: unitW, align: 'right' });
    doc.text('TOTAL', totalX, hy, { width: totalW, align: 'right' });
    doc.y = hy + 12;
    doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, doc.y).lineTo(left + cw, doc.y).stroke().restore();
    doc.moveDown(0.3);

    /* ---- Items (one row per item — unit price is its own column) ---- */
    const ITEM_SIZE = 10.5;
    const NAME_LINE_H = ITEM_SIZE + 3;
    const ROW_GAP = 9; // breathing room between items
    let subtotal = 0;
    (order.products || []).forEach((p) => {
      const lineTotal = (p.quantity || 0) * (p.unitPrice || 0);
      subtotal += lineTotal;
      if (doc.y + 40 > doc.page.height - M) doc.addPage(); // paginate long orders
      const yy = doc.y;
      doc.font('Helvetica-Bold').fontSize(ITEM_SIZE).fillColor(INK).text(String(p.quantity || 0), left, yy, { width: qtyW });
      // Item name — wraps onto further lines (never truncated silently) instead of overflowing.
      doc.font('Helvetica').fontSize(ITEM_SIZE).fillColor(INK);
      const nameLines = wrapLines(doc, latin(p.name) || '-', nameW, 3);
      nameLines.forEach((ln, i) => doc.text(ln, nameX, yy + i * NAME_LINE_H, { width: nameW, lineBreak: false }));
      // Unit price and line total, right-aligned to the item's first line.
      doc.font('Helvetica').fontSize(ITEM_SIZE).fillColor(INK)
        .text(fmt(p.unitPrice), unitX, yy, { width: unitW, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(ITEM_SIZE).fillColor(INK)
        .text(fmt(lineTotal), totalX, yy, { width: totalW, align: 'right' });
      doc.y = yy + nameLines.length * NAME_LINE_H + ROW_GAP;
    });

    divider();

    /* ---- Totals ---- */
    const totalLine = (label, value, opts = {}) => {
      const yy = doc.y;
      const big = opts.big;
      doc.font(big ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 11 : 9)
        .fillColor(big ? BRAND : MUTED).text(label, left, yy, { width: cw * 0.5 });
      doc.font('Helvetica-Bold').fontSize(big ? 13 : 9).fillColor(big ? BRAND : INK)
        .text(`${value} ${cur}`.trim(), left + cw * 0.5, yy, { width: cw * 0.5, align: 'right' });
      doc.y = Math.max(doc.y, yy + (big ? 18 : 13));
    };

    const total = order.totalPrice != null ? order.totalPrice : subtotal;
    const hasExtras = order.discount || order.tax || order.deliveryFee;
    if (hasExtras) totalLine('Subtotal', fmt(subtotal));
    if (order.discount) totalLine('Discount', `-${fmt(order.discount)}`);
    if (order.tax) totalLine('Tax', fmt(order.tax));
    if (order.deliveryFee) totalLine('Delivery', fmt(order.deliveryFee));
    totalLine('TOTAL', fmt(total), { big: true });

    doc.moveDown(0.4);
    kv('Payment', (order.paymentMethod || 'cash').toUpperCase());

    divider(true);

    /* ---- Footer ---- */
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text('Thank you for your visit!', left, doc.y, { width: cw, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Powered by Restaurant Management System', { width: cw, align: 'center' });

    // Trim the page to the content height for a tidy thermal slip.
    doc.end();
  });
}

/** Render an Arabic (RTL) printable order invoice / thermal receipt PDF. */
export function renderInvoicePdfAr(order, meta = {}) {
  return new Promise((resolve, reject) => {
    const W = 300;
    const M = 16;
    const doc = new PDFDocument({ size: [W, 800], margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Register Arabic font
    const AR = registerArabicFont(doc); // 'NotoSansArabic'
    doc.font(AR);

    const left = M;
    const cw = W - M * 2; // content width
    const cur = meta.currency || '';
    const fmt = (n) => Number(n || 0).toFixed(2);

    /**
     * NotoSansArabic's ascender metric (~1374/1000 em) is far taller than Helvetica's (~718/1000
     * em) — the extra headroom Arabic fonts reserve for stacked diacritics. pdfkit positions each
     * line's baseline at `y + ascender`, so Arabic text drawn at the same nominal y as Helvetica
     * text renders visibly lower. Shift Arabic draws up by the ascender delta (scaled to the active
     * font size) so Arabic text sits where Helvetica would, instead of hanging low in its row.
     */
    const HELV_ASCENDER = doc.font('Helvetica')._font.ascender;
    const AR_ASCENDER = doc.font(AR)._font.ascender;
    const arYShift = (size) => ((AR_ASCENDER - HELV_ASCENDER) / 1000) * size;

    /**
     * Draw a value choosing the font by script: Arabic text keeps the Arabic font (with
     * joining features, shifted up to correct its taller ascender); Latin/code text (invoice
     * numbers, English names, "@") uses Helvetica so the Arabic font's missing Latin glyphs
     * don't render as tofu boxes. The caller sets fontSize + fillColor before calling.
     */
    const draw = (str, x, y, opts = {}, bold = false) => {
      const s = String(str ?? '');
      if (hasArabic(s)) doc.font(AR).text(s, x, y - arYShift(doc._fontSize), { features: AR_FEATURES, ...opts });
      else doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(s, x, y, opts);
    };
    /** Arabic side of a bilingual "English — Arabic" value (falls back to the whole string). */
    const ar = (s) => arReduce(s);

    /**
     * Draw text into a fixed-width cell as one or more RTL-safe lines and return the height used.
     * Each physical line is drawn with `lineBreak:false` (so Arabic keeps its word order); the font
     * is chosen by script (Arabic → NotoSansArabic + joining features + ascender correction,
     * everything else → Helvetica so digits/codes/"@" never tofu). Nothing can spill past `w` —
     * long text wraps then truncates. The returned height is unaffected by the visual shift, so
     * row-flow math (`doc.y += ...`) stays correct.
     */
    const cell = (str, x, y, w, align = 'right', { bold = false, size = 9, color = INK, maxLines = 2 } = {}) => {
      const s = String(str ?? '');
      const isAr = hasArabic(s);
      doc.font(isAr ? AR : (bold ? 'Helvetica-Bold' : 'Helvetica')).fontSize(size).fillColor(color);
      const extra = isAr ? { features: AR_FEATURES } : {};
      const drawY = isAr ? y - arYShift(size) : y;
      const lh = size + 2.5;
      const lines = wrapLines(doc, isAr ? arReduce(s) : s, w, maxLines);
      lines.forEach((ln, i) => doc.text(ln, x, drawY + i * lh, { width: w, align, lineBreak: false, ...extra }));
      return lines.length * lh;
    };

    const divider = (dashed = false) => {
      doc.moveDown(0.4);
      doc.save().strokeColor(LINE).lineWidth(0.7);
      if (dashed) doc.dash(2, { space: 2 });
      doc.moveTo(left, doc.y).lineTo(left + cw, doc.y).stroke().undash();
      doc.restore();
      doc.moveDown(0.4);
    };

    // RTL key/value: Arabic label on the RIGHT (right-aligned), value on the LEFT (left-aligned).
    const kv = (label, value) => {
      const yy = doc.y;
      const vH = cell(String(value), left, yy, cw * 0.58, 'left', { size: 8.5, bold: true });
      const lH = cell(label, left + cw * 0.6, yy, cw * 0.4, 'right', { size: 8.5, color: MUTED });
      doc.y = yy + Math.max(vH, lH, 12);
    };

    /* ---- Header ---- */
    doc.fontSize(16).fillColor(INK);
    draw(ar(meta.restaurantName) || 'نظام إدارة المطعم', left, doc.y, { width: cw, align: 'center' }, true);
    if (meta.address) { doc.fontSize(8).fillColor(MUTED); draw(ar(meta.address), left, doc.y, { width: cw, align: 'center' }); }
    if (meta.phone) { doc.fontSize(8).fillColor(MUTED); draw(ar(String(meta.phone)), left, doc.y, { width: cw, align: 'center' }); }
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(BRAND);
    draw('إيصال مبيعات', left, doc.y, { width: cw, align: 'center' });

    divider();

    /* ---- Order meta (Arabic labels) ---- */
    kv('فاتورة', order.invoiceNo || order.id || '—');
    // Latin digits + slashes so the date renders cleanly with Helvetica (the Arabic font lacks "/").
    kv('تاريخ', new Date(order.orderDate || Date.now()).toLocaleString('en-GB'));
    // "Walk-in" is a system default (English) — show the Arabic term on the Arabic receipt.
    const clientAr = (order.walkIn || /walk[\s-]?in/i.test(String(order.clientName || ''))) ? 'زبون عابر' : ar(order.clientName);
    if (order.clientName || order.walkIn) kv('عميل', clientAr);
    if (order.clientPhone) kv('هاتف', order.clientPhone);
    if (order.area || order.governorate) kv('موقع', [ar(order.area), ar(order.governorate)].filter(Boolean).join(' - '));
    if (order.deliveryAddress) kv('عنوان التوصيل', ar(order.deliveryAddress));
    if (order.deliveryPerson) kv('مندوب التوصيل', ar(order.deliveryPerson));
    if (order.cashierName) kv('كاشير', ar(order.cashierName));

    divider();

    /* ---- Items table header (RTL, left→right on the page: TOTAL | PRICE | ITEM | QTY) ---- */
    // Four non-overlapping columns. In RTL: total leftmost, then unit price, then item, qty rightmost.
    const GAP = 5;
    const totalW = 50;
    const unitW = 42;
    const qtyW = 24;
    const nameW = cw - totalW - unitW - qtyW - GAP * 3;
    const totalX = left;                                    // leftmost column
    const unitX = totalX + totalW + GAP;                    // unit price column
    const nameX = unitX + unitW + GAP;                       // item name column
    const qtyX = nameX + nameW + GAP;                        // rightmost column
    const hy = doc.y;
    cell('المجموع', totalX, hy, totalW, 'left', { size: 7.5, color: MUTED });
    cell('السعر', unitX, hy, unitW, 'right', { size: 7.5, color: MUTED });
    cell('صنف', nameX, hy, nameW, 'right', { size: 7.5, color: MUTED });
    cell('كمية', qtyX, hy, qtyW, 'right', { size: 7.5, color: MUTED });
    doc.y = hy + 13;
    doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, doc.y).lineTo(left + cw, doc.y).stroke().restore();
    doc.moveDown(0.3);

    /* ---- Items (RTL layout, one row per item — unit price is its own column) ---- */
    const ITEM_SIZE = 10.5;
    const ROW_GAP = 9; // breathing room between items
    let subtotal = 0;
    (order.products || []).forEach((p) => {
      const lineTotal = (p.quantity || 0) * (p.unitPrice || 0);
      subtotal += lineTotal;
      if (doc.y + 40 > doc.page.height - M) doc.addPage(); // paginate long orders
      const yy = doc.y;
      // Item name (Arabic) — right-aligned, wraps onto further lines if long.
      const nameH = cell(ar(p.name) || '-', nameX, yy, nameW, 'right', { size: ITEM_SIZE, maxLines: 3 });
      // Quantity (rightmost), unit price, and line total (leftmost) — all aligned to the first line.
      cell(String(p.quantity || 0), qtyX, yy, qtyW, 'right', { size: ITEM_SIZE, bold: true });
      cell(fmt(p.unitPrice), unitX, yy, unitW, 'right', { size: ITEM_SIZE });
      cell(fmt(lineTotal), totalX, yy, totalW, 'left', { size: ITEM_SIZE, bold: true });
      doc.y = yy + nameH + ROW_GAP;
    });

    divider();

    /* ---- Totals (RTL: label on the right, value on the left) ---- */
    const totalLine = (label, value, opts = {}) => {
      const yy = doc.y;
      const big = opts.big;
      const vH = cell(`${value} ${cur}`.trim(), left, yy, cw * 0.5, 'left', { size: big ? 13 : 9, bold: true, color: big ? BRAND : INK });
      const lH = cell(label, left + cw * 0.5, yy, cw * 0.5, 'right', { size: big ? 11 : 9, color: big ? BRAND : MUTED });
      doc.y = yy + Math.max(vH, lH, big ? 18 : 13);
    };

    const total = order.totalPrice != null ? order.totalPrice : subtotal;
    const hasExtras = order.discount || order.tax || order.deliveryFee;
    if (hasExtras) totalLine('المجموع الفرعي', fmt(subtotal));
    if (order.discount) totalLine('خصم', `-${fmt(order.discount)}`);
    if (order.tax) totalLine('ضريبة', fmt(order.tax));
    if (order.deliveryFee) totalLine('توصيل', fmt(order.deliveryFee));
    totalLine('الإجمالي', fmt(total), { big: true });

    doc.moveDown(0.4);
    // Payment method → Arabic label (the raw enum is English and would tofu in the Arabic font).
    const payAr = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة' };
    kv('طريقة الدفع', payAr[order.paymentMethod] || order.paymentMethod || 'نقدي');

    divider(true);

    /* ---- Footer ---- */
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(INK);
    draw('شكراً لزيارتكم!', left, doc.y, { width: cw, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Powered by Restaurant Management System', left, doc.y, { width: cw, align: 'center' });

    doc.end();
  });
}

export default { renderReportPdf, renderMultiReportPdf, renderInvoicePdf };
