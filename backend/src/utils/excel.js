import ExcelJS from 'exceljs';

/**
 * Build an .xlsx buffer from columns + rows.
 * @param {object} opts { sheetName, title, columns:[{key,label,width,format}], rows, totals }
 */
export async function renderReportXlsx(opts) {
  const { sheetName = 'Report', title, columns = [], rows = [], totals } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurant Management System';
  const ws = wb.addWorksheet(sheetName);

  let headerRowIdx = 1;
  if (title) {
    ws.mergeCells(1, 1, 1, columns.length);
    const c = ws.getCell(1, 1);
    c.value = title;
    c.font = { size: 14, bold: true, color: { argb: 'FF6D28D9' } };
    headerRowIdx = 2;
    ws.addRow([]);
  }

  ws.columns = columns.map((col) => ({ key: col.key, width: col.width || 18 }));
  const header = ws.getRow(headerRowIdx);
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
  });
  header.commit();

  rows.forEach((row) => {
    const values = columns.map((col) => (col.format ? col.format(row[col.key], row) : row[col.key]));
    ws.addRow(values);
  });

  if (totals) {
    const totalRow = ws.addRow(columns.map((col) => (col.key in totals ? totals[col.key] : (columns.indexOf(col) === 0 ? 'TOTAL' : ''))));
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    });
  }

  return wb.xlsx.writeBuffer();
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

export default { renderReportXlsx, parseXlsx };
