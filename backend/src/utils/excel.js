import ExcelJS from 'exceljs';

/** Pass-through for Arabic text — Excel handles its own RTL layout internally.
 *  bidi-js reordering was removed because it reversed character order, producing
 *  garbled text in the generated spreadsheet cells. */
export function processArabicText(text) {
  return text;
}

/** Build an .xlsx buffer from columns + rows.
 * @param {object} opts { sheetName, title, titleAr, columns:[{key,label,labelAr,width,format}], rows, totals, lang, filename }
 */
export async function renderReportXlsx(opts) {
  const { sheetName = 'Report', title, titleAr, columns = [], rows = [], totals, lang, filename: givenFilename } = opts;
  const isAr = lang === 'ar';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurant Management System';
  const ws = wb.addWorksheet(sheetName);

  let headerRowIdx = 1;
  const displayTitle = isAr ? titleAr : title;
  if (displayTitle) {
    ws.mergeCells(1, 1, 1, columns.length);
    const c = ws.getCell(1, 1);
    c.value = isAr ? processArabicText(displayTitle) : displayTitle;
    c.font = { size: 14, bold: true, color: { argb: 'FF6D28D9' } };
    headerRowIdx = 2;
    ws.addRow([]);
  }

  ws.columns = columns.map((col) => ({ key: col.key, width: col.width || 18 }));
  const header = ws.getRow(headerRowIdx);
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    const label = isAr ? (col.labelAr || col.label) : col.label;
    cell.value = isAr ? processArabicText(label) : label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
    cell.alignment = { vertical: 'middle', horizontal: isAr ? 'right' : (col.align || 'left') };
  });
  header.commit();

  rows.forEach((row) => {
    const values = columns.map((col) => {
      let val = col.format ? col.format(row[col.key], row) : row[col.key];
      if (isAr && typeof val === 'string') val = processArabicText(val);
      return val;
    });
    ws.addRow(values);
  });

  if (totals) {
    const totalLabel = isAr ? 'الإجمالي' : 'TOTAL';
    const totalRow = ws.addRow(columns.map((col) => (col.key in totals ? totals[col.key] : (columns.indexOf(col) === 0 ? totalLabel : ''))));
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = (isAr ? titleAr : title || 'report')?.replace(/[^\w\u0600-\u06FF\- ]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'report';
  return { buffer: buf, filename: givenFilename || `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

/** Build a multi-sheet .xlsx — one worksheet per section. */
export async function renderMultiReportXlsx({ sections = [], title, titleAr, lang, filename: givenFilename }) {
  const isAr = lang === 'ar';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurant Management System';
  for (const sec of sections) {
    const safeName = String(isAr ? (sec.titleAr || sec.title) : (sec.title || 'Sheet')).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(safeName || 'Sheet');
    const columns = sec.columns || [];
    ws.columns = columns.map((col) => ({ key: col.key, width: col.width || 18 }));
    const header = ws.getRow(1);
    columns.forEach((col, i) => {
      const cell = header.getCell(i + 1);
      const label = isAr ? (col.labelAr || col.label) : col.label;
      cell.value = isAr ? processArabicText(label) : label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
      cell.alignment = { vertical: 'middle', horizontal: isAr ? 'right' : (col.align || 'left') };
    });
    header.commit();
    (sec.rows || []).forEach((row) => {
      const values = columns.map((col) => {
        let val = col.format ? col.format(row[col.key], row) : row[col.key];
        if (isAr && typeof val === 'string') val = processArabicText(val);
        return val;
      });
      ws.addRow(values);
    });
    if (sec.totals) {
      const totalLabel = isAr ? processArabicText('الإجمالي') : 'TOTAL';
      const totalRow = ws.addRow(columns.map((col, i) => (col.key in sec.totals ? sec.totals[col.key] : (i === 0 ? totalLabel : ''))));
      totalRow.font = { bold: true };
      totalRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }; });
    }
  }
  if (!sections.length) wb.addWorksheet('Empty');
  const buf = await wb.xlsx.writeBuffer();
  const safe = (isAr ? titleAr : title || 'report')?.replace(/[^\w\u0600-\u06FF\- ]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'report';
  return { buffer: buf, filename: givenFilename || `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

/** Parse an uploaded .xlsx buffer into an array of row objects keyed by header. */
export async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value || '').trim(); });
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const obj = {};
    row.eachCell((cell, col) => { if (headers[col]) obj[headers[col]] = cell.value; });
    if (Object.keys(obj).length) rows.push(obj);
  });
  return rows;
}

export default { renderReportXlsx, renderMultiReportXlsx, parseXlsx };
