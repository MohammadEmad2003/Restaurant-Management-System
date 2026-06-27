import PDFDocument from 'pdfkit';

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

/** Truncate a string with an ellipsis so it fits `width` on a single line.
 *  Caller must set the active font + size before calling. */
function clip(doc, str, width) {
  str = String(str ?? '—');
  if (doc.widthOfString(str) <= width) return str;
  const ell = '…';
  while (str.length > 1 && doc.widthOfString(str + ell) > width) str = str.slice(0, -1);
  return str.trim() + ell;
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
function drawBarChart(doc, { title, data = [], color = BRAND }, y) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const H = 150;       // plot height
  const labelH = 26;   // room for x labels
  if (y + H + 50 > doc.page.height - 60) { doc.addPage(); y = 50; }
  if (title) { doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(title, left, y); y += 18; }
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
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK)
      .text(fmtNum(d.value), bx - 8, by - 11, { width: barW + 16, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(clip(doc, latin(String(d.label)), slot - 4), chartLeft + slot * i + 2, bottom + 5, { width: slot - 4, align: 'center', lineBreak: false });
  });
  return bottom + labelH + 8;
}

/**
 * Render a branded tabular report to a PDF buffer.
 * @param {object} opts { title, subtitle, columns:[{key,label,align,format,weight}], rows, totals, meta, chart }
 */
export function renderReportPdf(opts) {
  const { title, subtitle, columns = [], rows = [], totals, meta = {}, chart } = opts;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const ROW_H = 22;

    /* ---- Header band ---- */
    doc.save();
    doc.rect(0, 0, doc.page.width, 96).fill(BRAND);
    // logo chip
    doc.roundedRect(left, 26, 44, 44, 11).fill('#ffffff');
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(22)
      .text((meta.restaurantName || 'R').trim().charAt(0).toUpperCase(), left, 37, { width: 44, align: 'center' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
      .text(latin(meta.restaurantName) || 'Restaurant Management System', left + 58, 32, { width: usable - 58, lineBreak: false });
    doc.font('Helvetica').fontSize(11).fillColor('#e9d5ff')
      .text(title || 'Report', left + 58, 56, { width: usable - 58 });
    doc.restore();

    /* ---- Meta line ---- */
    let y = 116;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(`Generated ${new Date().toLocaleString()}`, left, y);
    if (subtitle) { y += 13; doc.text(subtitle, left, y); }
    y += 24;

    /* ---- Optional chart ---- */
    if (chart && chart.data && chart.data.length) y = drawBarChart(doc, chart, y) + 6;

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

    const drawHeaderRow = () => {
      doc.save();
      doc.roundedRect(left, y, usable, ROW_H, 5).fill(BRAND_SOFT);
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND);
      columns.forEach((col, i) => {
        const txt = clip(doc, String(col.label).toUpperCase(), colW[i] - PAD * 2);
        doc.text(txt, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
      });
      y += ROW_H + 2;
    };

    drawHeaderRow();

    /* ---- Data rows ---- */
    doc.font('Helvetica').fontSize(9.5);
    rows.forEach((row, idx) => {
      if (y + ROW_H > doc.page.height - 60) {
        doc.addPage();
        y = 50;
        drawHeaderRow();
        doc.font('Helvetica').fontSize(9.5);
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
        const txt = clip(doc, latin(val), colW[i] - PAD * 2);
        doc.text(txt, colX[i] + PAD, y + 6, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
      });
      // subtle row separator
      doc.save();
      doc.strokeColor(LINE).lineWidth(0.5)
        .moveTo(left, y + ROW_H).lineTo(left + usable, y + ROW_H).stroke();
      doc.restore();
      y += ROW_H;
    });

    if (rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10)
        .text('No data for this report.', left, y + 10, { width: usable, align: 'center' });
      y += 30;
    }

    /* ---- Totals ---- */
    if (totals) {
      y += 8;
      if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = 50; }
      doc.save();
      doc.roundedRect(left, y, usable, ROW_H + 2, 5).fill(BRAND);
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
      let labelPlaced = false;
      columns.forEach((col, i) => {
        if (totals[col.key] !== undefined) {
          const txt = clip(doc, totals[col.key], colW[i] - PAD * 2);
          doc.text(txt, colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
        } else if (!labelPlaced) {
          labelPlaced = true;
          doc.text('TOTAL', colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, lineBreak: false });
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
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      const fname = clip(doc, `${latin(meta.restaurantName) || 'Restaurant Management System'} — confidential`, usable / 2 - 6);
      doc.text(fname, left, fy + 8, { width: usable / 2, align: 'left', lineBreak: false });
      doc.text(`Page ${p + 1} of ${range.count}`, left + usable / 2, fy + 8, { width: usable / 2, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}

/**
 * Render several report tables (each with an optional chart) into ONE PDF.
 * @param {object} opts { title, subtitle, meta, sections:[{title, columns, rows, totals, chart}] }
 */
export function renderMultiReportPdf({ title, subtitle, meta = {}, sections = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const ROW_H = 22; const PAD = 8;

    // header band
    doc.save();
    doc.rect(0, 0, doc.page.width, 96).fill(BRAND);
    doc.roundedRect(left, 26, 44, 44, 11).fill('#ffffff');
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(22)
      .text((latin(meta.restaurantName) || 'R').trim().charAt(0).toUpperCase(), left, 37, { width: 44, align: 'center' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
      .text(latin(meta.restaurantName) || 'Restaurant Management System', left + 58, 32, { width: usable - 58, lineBreak: false });
    doc.font('Helvetica').fontSize(11).fillColor('#e9d5ff').text(title || 'Report', left + 58, 56, { width: usable - 58, lineBreak: false });
    doc.restore();

    let y = 116;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Generated ${new Date().toLocaleString()}`, left, y);
    if (subtitle) { y += 13; doc.text(subtitle, left, y); }
    y += 24;

    const table = (columns, rows, totals) => {
      const weights = columns.map((c, i) => c.weight || (i === 0 ? 2 : c.align === 'right' ? 1 : 1.2));
      const wsum = weights.reduce((a, b) => a + b, 0);
      const colX = []; const colW = []; let acc = left;
      weights.forEach((w) => { const width = (w / wsum) * usable; colX.push(acc); colW.push(width); acc += width; });
      const headerRow = () => {
        doc.save().roundedRect(left, y, usable, ROW_H, 5).fill(BRAND_SOFT).restore();
        doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND);
        columns.forEach((col, i) => doc.text(clip(doc, String(col.label).toUpperCase(), colW[i] - PAD * 2), colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false }));
        y += ROW_H + 2;
      };
      headerRow();
      doc.font('Helvetica').fontSize(9.5);
      rows.forEach((row, idx) => {
        if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = 50; headerRow(); doc.font('Helvetica').fontSize(9.5); }
        if (idx % 2 === 1) doc.save().rect(left, y, usable, ROW_H).fill(STRIPE).restore();
        doc.fillColor(INK);
        columns.forEach((col, i) => {
          const val = col.format ? col.format(row[col.key], row) : row[col.key];
          doc.text(clip(doc, latin(val), colW[i] - PAD * 2), colX[i] + PAD, y + 6, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
        });
        doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, y + ROW_H).lineTo(left + usable, y + ROW_H).stroke().restore();
        y += ROW_H;
      });
      if (!rows.length) { doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10).text('No data.', left, y + 8, { width: usable, align: 'center' }); y += 28; }
      if (totals) {
        y += 6; if (y + ROW_H > doc.page.height - 60) { doc.addPage(); y = 50; }
        doc.save().roundedRect(left, y, usable, ROW_H + 2, 5).fill(BRAND).restore();
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff'); let labelPlaced = false;
        columns.forEach((col, i) => {
          if (totals[col.key] !== undefined) doc.text(clip(doc, totals[col.key], colW[i] - PAD * 2), colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, align: col.align || 'left', lineBreak: false });
          else if (!labelPlaced) { labelPlaced = true; doc.text('TOTAL', colX[i] + PAD, y + 7, { width: colW[i] - PAD * 2, lineBreak: false }); }
        });
        y += ROW_H + 2;
      }
    };

    sections.forEach((sec, idx) => {
      if (y + 90 > doc.page.height - 60) { doc.addPage(); y = 50; } else if (idx > 0) y += 12;
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(sec.title || '', left, y); y += 20;
      if (sec.chart && sec.chart.data && sec.chart.data.length) y = drawBarChart(doc, sec.chart, y) + 6;
      table(sec.columns || [], sec.rows || [], sec.totals);
    });

    // footers
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      const fy = doc.page.height - 58;
      doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, fy).lineTo(left + usable, fy).stroke().restore();
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      doc.text(clip(doc, `${latin(meta.restaurantName) || 'Restaurant Management System'} — confidential`, usable / 2 - 6), left, fy + 8, { width: usable / 2, align: 'left', lineBreak: false });
      doc.text(`Page ${p + 1} of ${range.count}`, left + usable / 2, fy + 8, { width: usable / 2, align: 'right', lineBreak: false });
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
    if (order.cashierName) kv('Cashier', latin(order.cashierName));

    divider();

    /* ---- Items table header ---- */
    const qtyW = 26;
    const priceW = 64;
    const nameW = cw - qtyW - priceW - 8;
    const hy = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
    doc.text('QTY', left, hy, { width: qtyW });
    doc.text('ITEM', left + qtyW + 4, hy, { width: nameW });
    doc.text('TOTAL', left + qtyW + 4 + nameW + 4, hy, { width: priceW, align: 'right' });
    doc.y = hy + 12;
    doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(left, doc.y).lineTo(left + cw, doc.y).stroke().restore();
    doc.moveDown(0.3);

    /* ---- Items ---- */
    let subtotal = 0;
    (order.products || []).forEach((p) => {
      const lineTotal = (p.quantity || 0) * (p.unitPrice || 0);
      subtotal += lineTotal;
      const yy = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(String(p.quantity || 0), left, yy, { width: qtyW });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(latin(p.name) || '', left + qtyW + 4, yy, { width: nameW });
      const nameBottom = doc.y;
      // unit price hint under the name
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`@ ${fmt(p.unitPrice)}`, left + qtyW + 4, nameBottom, { width: nameW });
      const afterLeft = doc.y;
      // line total right-aligned to the item's top baseline
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
        .text(fmt(lineTotal), left + qtyW + 4 + nameW + 4, yy, { width: priceW, align: 'right' });
      doc.y = Math.max(afterLeft, yy + 14) + 3;
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

export default { renderReportPdf, renderMultiReportPdf, renderInvoicePdf };
