/**
 * SOTA Arabic/RTL report PDFs via headless Chromium (Puppeteer).
 *
 * A real browser engine (HarfBuzz + the CSS bidi/RTL engine) handles Arabic glyph shaping,
 * the bidirectional algorithm, RTL tables (`dir="rtl"` auto-reverses columns) and per-glyph
 * font fallback — the three things pdfkit cannot do on its own. The Arabic font is embedded
 * as a base64 @font-face so the document is fully self-contained/offline; Latin glyphs the
 * Arabic font lacks fall back to a system sans automatically, so mixed content never "tofu"s.
 *
 * Puppeteer is imported lazily; if it isn't installed the caller falls back to the pdfkit
 * renderer, so the server still runs. Install with: `npm install puppeteer` (in backend/).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ---- Palette (matches the app brand) ---- */
const BRAND = '#6d28d9';
const BRAND_SOFT = '#f3f0ff';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const STRIPE = '#faf9fe';

/** Base64 of the bundled Arabic font, embedded as @font-face (cached after first read). */
let _fontB64 = null;
function arabicFontBase64() {
  if (_fontB64 == null) {
    _fontB64 = readFileSync(join(__dirname, '..', '..', 'fonts', 'NotoSansArabic-Regular.ttf')).toString('base64');
  }
  return _fontB64;
}

/* Bilingual "English — Arabic" splitters (same convention as pdf.js). */
const latinSide = (s) => { s = String(s ?? ''); const i = s.indexOf('—'); return i >= 0 ? (s.slice(0, i).trim() || s) : s; };
const arabicSide = (s) => { s = String(s ?? ''); const i = s.indexOf('—'); return i >= 0 ? (s.slice(i + 1).trim() || s) : s; };

/** HTML-escape untrusted data before it goes into the template. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtNum(v) {
  const n = Number(v || 0);
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(+n.toFixed(2));
}

/* ---------- Browser lifecycle (lazy, reused across requests) ---------- */
let _browserPromise = null;
async function getBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      if (b && b.connected !== false && (typeof b.isConnected !== 'function' || b.isConnected())) return b;
    } catch { /* fall through and relaunch */ }
    _browserPromise = null;
  }
  _browserPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = (await import('puppeteer')).default;
    } catch {
      const err = new Error('PUPPETEER_MISSING');
      err.code = 'PUPPETEER_MISSING';
      throw err;
    }
    return puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  })();
  return _browserPromise;
}

/** True when the failure is simply that puppeteer isn't installed yet. */
export function isPuppeteerMissing(err) {
  return err && (err.code === 'PUPPETEER_MISSING' || /Cannot find (module|package) 'puppeteer'/.test(err.message || ''));
}

/** Render an HTML string to a PDF Buffer via headless Chromium. */
async function htmlToPdf(html, { lang } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready'); // ensure the embedded font is applied before printing
    const isAr = lang === 'ar';
    const footerTemplate = `
      <div style="width:100%;font-size:8px;color:${MUTED};padding:0 12mm;display:flex;justify-content:space-between;direction:${isAr ? 'rtl' : 'ltr'};font-family:sans-serif;">
        <span>${isAr ? 'سري' : 'Confidential'}</span>
        <span>${isAr ? 'صفحة' : 'Page'} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`;
    const out = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
      margin: { top: '12mm', bottom: '16mm', left: '10mm', right: '10mm' },
    });
    // puppeteer ≥23 returns a Uint8Array; Express res.send() needs a Buffer.
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } finally {
    await page.close().catch(() => {});
  }
}

/* ---------- HTML template ---------- */
function barChartSvg(chart, isAr) {
  const data = (chart.data || []).slice(0, 16);
  if (!data.length) return '';
  const W = 760, H = 170, pad = 20, labelH = 30;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value) || 0));
  const n = data.length;
  const slot = (W - pad * 2) / n;
  const barW = Math.min(46, slot * 0.6);
  const plotH = H - labelH - 16;
  let bars = '';
  data.forEach((d, i) => {
    const h = (Math.abs(d.value || 0) / max) * plotH;
    const x = pad + slot * i + (slot - barW) / 2;
    const y = 16 + plotH - h;
    const col = d.value < 0 ? '#ef4444' : (chart.color || BRAND);
    const rawLbl = isAr ? arabicSide(String(d.label)) : latinSide(String(d.label));
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" fill="${col}"/>`;
    bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="9" text-anchor="middle" fill="${INK}">${esc(fmtNum(d.value))}</text>`;
    bars += `<text x="${(pad + slot * i + slot / 2).toFixed(1)}" y="${(16 + plotH + 13).toFixed(1)}" font-size="9" text-anchor="middle" fill="${MUTED}">${esc(rawLbl)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${16 + plotH}" x2="${W - pad}" y2="${16 + plotH}" stroke="${LINE}" stroke-width="1"/>${bars}</svg>`;
}

function tableHtml(section, isAr) {
  const columns = section.columns || [];
  const cellText = (val) => esc(isAr ? arabicSide(String(val ?? '')) : latinSide(String(val ?? '')));
  const colLabel = (col) => esc(isAr ? (col.labelAr || col.label) : col.label);
  const alignClass = (col) => (col.align === 'right' ? 'num' : '');

  const head = `<tr>${columns.map((c) => `<th class="${alignClass(c)}">${colLabel(c)}</th>`).join('')}</tr>`;
  const body = (section.rows || []).length
    ? (section.rows || []).map((row) => `<tr>${columns.map((c) => {
        const val = c.format ? c.format(row[c.key], row) : row[c.key];
        return `<td class="${alignClass(c)}">${cellText(val)}</td>`;
      }).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${columns.length}">${isAr ? 'لا توجد بيانات لهذا التقرير.' : 'No data for this report.'}</td></tr>`;

  let foot = '';
  if (section.totals) {
    let labelPlaced = false;
    foot = `<tr class="totals">${columns.map((c) => {
      if (section.totals[c.key] !== undefined) return `<td class="${alignClass(c)}">${esc(section.totals[c.key])}</td>`;
      if (!labelPlaced) { labelPlaced = true; return `<td>${isAr ? 'المجموع' : 'TOTAL'}</td>`; }
      return '<td></td>';
    }).join('')}</tr>`;
  }
  return `<table><thead>${head}</thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>`;
}

function buildReportHtml({ title, subtitle, meta = {}, sections = [], lang }) {
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const rName = isAr ? (arabicSide(meta.restaurantName) || 'نظام إدارة المطعم') : (latinSide(meta.restaurantName) || 'Restaurant Management System');
  const genLabel = isAr ? 'تم الإنشاء' : 'Generated';
  const stamp = new Date().toLocaleString(isAr ? 'ar-EG' : 'en-GB');
  const initial = esc(rName.trim().charAt(0).toUpperCase());

  const sectionsHtml = sections.map((sec) => `
    <section class="report-section">
      ${sec.title ? `<h2>${esc(isAr ? arabicSide(sec.title) : latinSide(sec.title))}</h2>` : ''}
      ${sec.chart && sec.chart.data && sec.chart.data.length ? barChartSvg(sec.chart, isAr) : ''}
      ${tableHtml(sec, isAr)}
    </section>`).join('');

  return `<!doctype html>
<html dir="${dir}" lang="${isAr ? 'ar' : 'en'}">
<head>
<meta charset="utf-8"/>
<style>
  @font-face {
    font-family: 'NotoArabicEmbedded';
    src: url(data:font/ttf;base64,${arabicFontBase64()}) format('truetype');
    font-weight: normal; font-style: normal; font-display: block;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'NotoArabicEmbedded', 'DejaVu Sans', 'Segoe UI', Arial, sans-serif;
    color: ${INK}; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .header {
    background: ${BRAND}; color: #fff; padding: 14px 16px; border-radius: 10px;
    display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
  }
  .logo { width: 42px; height: 42px; border-radius: 10px; background: #fff; color: ${BRAND};
    display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; flex-shrink: 0; }
  .header .name { font-size: 17px; font-weight: 800; }
  .header .title { font-size: 12px; color: #e9d5ff; margin-top: 2px; }
  .meta { color: ${MUTED}; font-size: 9px; margin-bottom: 14px; }
  .report-section { margin-bottom: 18px; page-break-inside: auto; }
  .report-section h2 { color: ${BRAND}; font-size: 13px; margin: 0 0 8px; }
  .chart { width: 100%; height: 150px; margin-bottom: 10px; }
  svg text { font-family: 'NotoArabicEmbedded', 'DejaVu Sans', Arial, sans-serif; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  thead th {
    background: ${BRAND_SOFT}; color: ${BRAND}; font-weight: 700; text-align: start;
    padding: 7px 8px; border-bottom: 1px solid ${LINE};
  }
  tbody td { padding: 6px 8px; border-bottom: 1px solid ${LINE}; text-align: start; }
  tbody tr:nth-child(even) td { background: ${STRIPE}; }
  th.num, td.num { text-align: end; }
  td.empty { text-align: center; color: ${MUTED}; font-style: italic; padding: 14px; }
  tfoot .totals td { background: ${BRAND}; color: #fff; font-weight: 700; padding: 8px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo">${initial}</div>
    <div>
      <div class="name">${esc(rName)}</div>
      <div class="title">${esc(title || (isAr ? 'تقرير' : 'Report'))}</div>
    </div>
  </div>
  <div class="meta">${genLabel}: ${esc(stamp)}${subtitle ? ` &middot; ${esc(subtitle)}` : ''}</div>
  ${sectionsHtml}
</body>
</html>`;
}

/** Build a safe download filename (mirrors the pdfkit renderer's convention). */
function makeFilename(title, given) {
  if (given) return given;
  const safe = String(title || 'report').replace(/[^\w؀-ۿ\- ]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'report';
  return `${safe}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

/**
 * Render a report (single spec wrapped as one section, or a multi-section bundle) to a PDF
 * Buffer via headless Chromium. Returns { buffer, filename } to match the pdfkit renderers.
 * Throws an error with code 'PUPPETEER_MISSING' if puppeteer isn't installed.
 */
export async function renderReportPdfHtml({ title, subtitle, meta = {}, sections = [], lang, filename }) {
  const html = buildReportHtml({ title, subtitle, meta, sections, lang });
  const buffer = await htmlToPdf(html, { lang });
  return { buffer, filename: makeFilename(title, filename) };
}

/** Optional: build the HTML without rendering (handy for previewing in a browser). */
export function reportHtml(opts) {
  return buildReportHtml(opts);
}

export default { renderReportPdfHtml, isPuppeteerMissing, reportHtml };
