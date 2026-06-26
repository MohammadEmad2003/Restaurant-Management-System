import PDFDocument from 'pdfkit';

const BRAND = '#6d28d9';
const INK = '#1f2937';
const MUTED = '#6b7280';

/**
 * Render a branded tabular report to a PDF buffer.
 * @param {object} opts { title, subtitle, columns:[{key,label,align,format}], rows, totals, meta }
 */
export function renderReportPdf(opts) {
  const { title, subtitle, columns = [], rows = [], totals, meta = {} } = opts;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header band
    doc.rect(0, 0, doc.page.width, 90).fill(BRAND);
    doc.fillColor('#fff').fontSize(20).text(meta.restaurantName || 'Restaurant Management System', 40, 28);
    doc.fontSize(11).fillColor('#ede9fe').text(title || 'Report', 40, 56);
    doc.moveDown(2);

    doc.fillColor(MUTED).fontSize(9);
    const genLine = `Generated: ${new Date().toLocaleString()}`;
    doc.text(genLine, 40, 100);
    if (subtitle) doc.text(subtitle, 40, 112);

    let y = 140;

    // Column layout
    const usable = doc.page.width - 80;
    const colWidth = usable / columns.length;

    // Header row
    doc.rect(40, y, usable, 22).fill('#f3f4f6');
    doc.fillColor(INK).fontSize(10);
    columns.forEach((col, i) => {
      doc.text(col.label, 44 + i * colWidth, y + 6, { width: colWidth - 8, align: col.align || 'left' });
    });
    y += 26;

    // Data rows
    doc.fontSize(9.5);
    rows.forEach((row, idx) => {
      if (y > doc.page.height - 70) { doc.addPage(); y = 50; }
      if (idx % 2 === 0) doc.rect(40, y - 2, usable, 18).fill('#fafafa').fillColor(INK);
      doc.fillColor(INK);
      columns.forEach((col, i) => {
        const raw = row[col.key];
        const val = col.format ? col.format(raw, row) : raw;
        doc.text(String(val ?? ''), 44 + i * colWidth, y, { width: colWidth - 8, align: col.align || 'left' });
      });
      y += 18;
    });

    // Totals
    if (totals) {
      y += 6;
      doc.rect(40, y, usable, 24).fill(BRAND);
      doc.fillColor('#fff').fontSize(11);
      columns.forEach((col, i) => {
        if (totals[col.key] !== undefined) {
          doc.text(String(totals[col.key]), 44 + i * colWidth, y + 6, { width: colWidth - 8, align: col.align || 'left' });
        } else if (i === 0) {
          doc.text('TOTAL', 44, y + 6, { width: colWidth - 8 });
        }
      });
    }

    // Footer
    doc.fillColor(MUTED).fontSize(8)
      .text('Restaurant Management System — confidential', 40, doc.page.height - 50, { align: 'center', width: usable });

    doc.end();
  });
}

/** Render a printable order invoice/receipt PDF. */
export function renderInvoicePdf(order, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [300, 600], margin: 18 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(15).fillColor(INK).text(meta.restaurantName || 'Restaurant', { align: 'center' });
    doc.fontSize(9).fillColor(MUTED).text('Sales Receipt', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor(INK).fontSize(9);
    doc.text(`Invoice: ${order.invoiceNo || order.id}`);
    doc.text(`Date: ${new Date(order.orderDate || Date.now()).toLocaleString()}`);
    if (order.clientName) doc.text(`Customer: ${order.clientName}`);
    doc.moveTo(18, doc.y + 4).lineTo(282, doc.y + 4).stroke('#e5e7eb');
    doc.moveDown(0.6);

    (order.products || []).forEach((p) => {
      doc.fontSize(9.5).fillColor(INK).text(`${p.quantity} × ${p.name}`, { continued: true });
      doc.text(`${(p.quantity * p.unitPrice).toFixed(2)}`, { align: 'right' });
    });

    doc.moveTo(18, doc.y + 4).lineTo(282, doc.y + 4).stroke('#e5e7eb');
    doc.moveDown(0.6);
    doc.fontSize(13).fillColor(BRAND).text(`TOTAL: ${(order.totalPrice || 0).toFixed(2)} ${meta.currency || ''}`, { align: 'right' });
    doc.moveDown(1);
    doc.fontSize(9).fillColor(MUTED).text(`Payment: ${order.paymentMethod || 'cash'}`, { align: 'center' });
    doc.text('Thank you! • شكراً لزيارتكم', { align: 'center' });

    doc.end();
  });
}

export default { renderReportPdf, renderInvoicePdf };
