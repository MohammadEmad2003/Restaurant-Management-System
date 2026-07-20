import { repo } from '../repositories/index.js';
import { logger } from '../utils/logger.js';

// The PDF (pdfkit + fontkit) and Excel (exceljs) renderers cost ~800ms to load.
// They are pulled in lazily on the first report request so they never sit on the
// server's boot path — reports are an occasional, admin-only operation.
const loadPdf = () => import('../utils/pdf.js');
const loadHtmlReport = () => import('../utils/htmlReport.js');
const loadExcel = () => import('../utils/excel.js');
import { financeService } from './financeService.js';
import { goodsService } from './goodsService.js';
import { goodsCheckService } from './goodsCheckService.js';
import { analyticsService } from './analyticsService.js';
import { attendanceService } from './attendanceService.js';
import { salaryService } from './salaryService.js';
import { settingsService } from './settingsService.js';
import { HttpError } from '../middleware/errorHandler.js';

const shortLabel = (s) => String(s || '').split('—')[0].trim();

const money = (v) => `${Number(v || 0).toFixed(2)}`;

/**
 * Report registry. Each entry returns { title, columns, rows, totals }.
 * Used by both the PDF and Excel renderers so output stays consistent.
 * Every report is filtered by the authenticated user's restaurantId.
 */
const REPORTS = {
  async attendance(params, user) {
    const rows = await attendanceService.monthlyReport({ month: params.month }, user);
    return {
      title: 'Attendance & Working Hours',
      titleAr: 'الحضور وساعات العمل',
      columns: [
        { key: 'workerName', label: 'Employee', labelAr: 'الموظف' },
        { key: 'days', label: 'Days', labelAr: 'الأيام', align: 'right' },
        { key: 'totalHours', label: 'Hours', labelAr: 'الساعات', align: 'right' },
        { key: 'overtime', label: 'Overtime', labelAr: 'ساعات إضافية', align: 'right' },
      ],
      rows,
      totals: {
        totalHours: rows.reduce((s, r) => s + r.totalHours, 0).toFixed(2),
        overtime: rows.reduce((s, r) => s + r.overtime, 0).toFixed(2),
      },
      chart: { title: 'Hours by Employee', data: rows.slice(0, 8).map((r) => ({ label: shortLabel(r.workerName), value: r.totalHours })) },
    };
  },

  async income(params, user) {
    const data = await financeService.income({ period: params.period || 'daily', from: params.from, to: params.to }, user);
    return {
      title: `Income (${data.period})`,
      titleAr: `الإيرادات (${data.period})`,
      columns: [
        { key: 'key', label: 'Period', labelAr: 'الفترة' },
        { key: 'value', label: 'Income', labelAr: 'الإيرادات', align: 'right', format: money },
      ],
      rows: data.series,
      totals: { value: money(data.total) },
      chart: { title: 'Income', data: data.series.slice(-10).map((s) => ({ label: s.key, value: s.value })) },
    };
  },

  async expenses(params, user) {
    const data = await financeService.expenses({ period: params.period || 'monthly', from: params.from, to: params.to }, user);
    return {
      title: `Expenses (${data.period})`,
      titleAr: `المصروفات (${data.period})`,
      columns: [
        { key: 'key', label: 'Period', labelAr: 'الفترة' },
        { key: 'value', label: 'Expense', labelAr: 'المصروفات', align: 'right', format: money },
      ],
      rows: data.series,
      totals: { value: money(data.total) },
      chart: { title: 'Expenses', data: data.series.slice(-10).map((s) => ({ label: s.key, value: s.value })) },
    };
  },

  async pnl(params, user) {
    const p = await financeService.profit({ period: params.period || 'monthly', from: params.from, to: params.to }, user);
    return {
      title: 'Profit & Loss',
      titleAr: 'الرصيد',
      columns: [
        { key: 'metric', label: 'Metric', labelAr: 'المؤشر' },
        { key: 'value', label: 'Amount', labelAr: 'المبلغ', align: 'right' },
      ],
      rows: [
        { metric: 'Revenue — الإيرادات', value: money(p.revenue) },
        { metric: 'Expenses — المصروفات', value: money(p.expenses) },
        { metric: 'Net Profit — صافي الربح', value: money(p.netProfit) },
        { metric: 'Profit Margin — هامش الربح', value: `${p.profitMargin}%` },
      ],
    };
  },

  async stock(params, user) {
    const goods = await repo('goods').getAll({ restaurantId: user?.restaurantId });
    return {
      title: 'Current Stock',
      titleAr: 'المخزون الحالي',
      columns: [
        { key: 'name', label: 'Item', labelAr: 'الصنف' },
        { key: 'quantityAvailable', label: 'Qty', labelAr: 'الكمية', align: 'right' },
        { key: 'unit', label: 'Unit', labelAr: 'الوحدة' },
        { key: 'minimumStockLevel', label: 'Min', labelAr: 'الأدنى', align: 'right' },
        { key: 'value', label: 'Value', labelAr: 'القيمة', align: 'right', format: money },
      ],
      rows: goods.map((g) => ({ ...g, value: g.quantityAvailable * g.purchasePrice })),
      totals: { value: money(goods.reduce((s, g) => s + g.quantityAvailable * g.purchasePrice, 0)) },
      chart: {
        title: 'Top Stock Value',
        data: goods.map((g) => ({ label: shortLabel(g.name), value: +(g.quantityAvailable * g.purchasePrice).toFixed(2) }))
          .sort((a, b) => b.value - a.value).slice(0, 8),
      },
    };
  },

  async 'low-stock'(params, user) {
    const rows = await goodsService.lowStock(user);
    return {
      title: 'Low Stock Alerts',
      titleAr: 'تنبيهات المخزون المنخفض',
      columns: [
        { key: 'name', label: 'Item', labelAr: 'الصنف' },
        { key: 'quantityAvailable', label: 'Remaining', labelAr: 'المتبقي', align: 'right' },
        { key: 'minimumStockLevel', label: 'Minimum', labelAr: 'الأدنى', align: 'right' },
        { key: 'unit', label: 'Unit', labelAr: 'الوحدة' },
      ],
      rows,
    };
  },

  async waste(params, user) {
    const data = await goodsCheckService.wasteReport({ from: params.from, to: params.to }, user);
    return {
      title: 'Waste / Loss Report',
      titleAr: 'تقرير الهدر/الخسائر',
      columns: [
        { key: 'name', label: 'Ingredient', labelAr: 'المكون' },
        { key: 'totalLoss', label: 'Qty Lost', labelAr: 'الكمية المفقودة', align: 'right' },
        { key: 'lossValue', label: 'Value Lost', labelAr: 'القيمة المفقودة', align: 'right', format: money },
        { key: 'checks', label: 'Checks', labelAr: 'الفحوصات', align: 'right' },
      ],
      rows: data.items,
      totals: { lossValue: money(data.totalLossValue) },
      chart: { title: 'Top Waste by Value', data: (data.items || []).slice(0, 8).map((i) => ({ label: shortLabel(i.name), value: +(i.lossValue || 0).toFixed(2) })) },
    };
  },

  async 'product-performance'(params, user) {
    const sales = await analyticsService.sales(user);
    return {
      title: 'Product Performance',
      titleAr: 'أداء المنتجات',
      columns: [
        { key: 'name', label: 'Product', labelAr: 'المنتج' },
        { key: 'qty', label: 'Sold', labelAr: 'المباع', align: 'right' },
        { key: 'revenue', label: 'Revenue', labelAr: 'الإيرادات', align: 'right', format: money },
      ],
      rows: sales.bestSelling,
      totals: { revenue: money(sales.bestSelling.reduce((s, r) => s + r.revenue, 0)) },
      chart: { title: 'Revenue by Product', data: sales.bestSelling.slice(0, 8).map((r) => ({ label: shortLabel(r.name), value: +(r.revenue || 0).toFixed(2) })) },
    };
  },

  async 'order-history'(params, user) {
    const fromTs = params.from ? new Date(params.from).getTime() : -Infinity;
    const toTs = params.to ? new Date(params.to).getTime() + 864e5 : Infinity;
    const orders = (await repo('orders').getAll({ restaurantId: user?.restaurantId }))
      .filter((o) => (o.orderDate || 0) >= fromTs && (o.orderDate || 0) < toTs)
      .sort((a, b) => b.orderDate - a.orderDate).slice(0, 200);
    return {
      title: 'Order History',
      titleAr: 'سجل الطلبات',
      columns: [
        { key: 'invoiceNo', label: 'Invoice', labelAr: 'الفاتورة' },
        { key: 'orderDate', label: 'Date', labelAr: 'التاريخ', format: (v) => new Date(v).toLocaleDateString() },
        { key: 'itemCount', label: 'Items', labelAr: 'العناصر', align: 'right' },
        { key: 'status', label: 'Status', labelAr: 'الحالة' },
        { key: 'totalPrice', label: 'Total', labelAr: 'الإجمالي', align: 'right', format: money },
      ],
      rows: orders.map((o) => ({ ...o, itemCount: (o.products || []).length })),
      totals: { totalPrice: money(orders.reduce((s, o) => s + (o.totalPrice || 0), 0)) },
    };
  },

  async 'customer-spending'(params, user) {
    const clients = (await repo('clients').getAll({ restaurantId: user?.restaurantId })).sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
    return {
      title: 'Customer Spending',
      titleAr: 'إنفاق العملاء',
      columns: [
        { key: 'name', label: 'Customer', labelAr: 'العميل' },
        { key: 'visitCount', label: 'Visits', labelAr: 'الزيارات', align: 'right' },
        { key: 'loyaltyPoints', label: 'Points', labelAr: 'النقاط', align: 'right' },
        { key: 'totalSpent', label: 'Total Spent', labelAr: 'إجمالي الإنفاق', align: 'right', format: money },
      ],
      rows: clients,
      totals: { totalSpent: money(clients.reduce((s, c) => s + (c.totalSpent || 0), 0)) },
      chart: { title: 'Top Customers by Spend', data: clients.slice(0, 8).map((c) => ({ label: shortLabel(c.name), value: +(c.totalSpent || 0).toFixed(2) })) },
    };
  },

  async salary(params, user) {
    const month = params.month || new Date().toISOString().slice(0, 7);
    const rows = await repo('salaries').getAll({ month, restaurantId: user?.restaurantId });
    return {
      title: `Salary Report (${month})`,
      titleAr: `تقرير الرواتب (${month})`,
      columns: [
        { key: 'workerName', label: 'Employee', labelAr: 'الموظف' },
        { key: 'baseSalary', label: 'Base', labelAr: 'الأساسية', align: 'right', format: money },
        { key: 'overtimePay', label: 'Overtime', labelAr: 'ساعات إضافية', align: 'right', format: money },
        { key: 'netPay', label: 'Net Pay', labelAr: 'صافي الراتب', align: 'right', format: money },
        { key: 'paid', label: 'Paid', labelAr: 'مدفوعة', format: (v) => (v ? 'Yes — نعم' : 'No — لا') },
      ],
      rows,
      totals: { netPay: money(rows.reduce((s, r) => s + (r.netPay || 0), 0)) },
      chart: { title: 'Net Pay by Employee', data: rows.slice(0, 8).map((r) => ({ label: shortLabel(r.workerName), value: +(r.netPay || 0).toFixed(2) })) },
    };
  },

  async 'worker-performance'(params, user) {
    const data = await analyticsService.workers(user);
    return {
      title: 'Worker Performance',
      titleAr: 'أداء العمال',
      columns: [
        { key: 'name', label: 'Employee', labelAr: 'الموظف' },
        { key: 'hours', label: 'Hours', labelAr: 'الساعات', align: 'right' },
        { key: 'orders', label: 'Orders', labelAr: 'الطلبات', align: 'right' },
      ],
      rows: data.productivity,
      chart: { title: 'Orders Handled', data: data.productivity.slice(0, 8).map((r) => ({ label: shortLabel(r.name), value: r.orders })) },
    };
  },

  async 'sales-by-location'(params, user) {
    const rows = await analyticsService.byLocation({ from: params.from, to: params.to }, user);
    return {
      title: 'Sales by Location',
      titleAr: 'المبيعات حسب الموقع',
      columns: [
        { key: 'name', label: 'Location', labelAr: 'الموقع' },
        { key: 'orders', label: 'Orders', labelAr: 'الطلبات', align: 'right' },
        { key: 'revenue', label: 'Revenue', labelAr: 'الإيرادات', align: 'right', format: money },
        { key: 'profit', label: 'Gross Profit', labelAr: 'إجمالي الربح', align: 'right', format: money },
      ],
      rows,
      totals: {
        orders: rows.reduce((s, r) => s + r.orders, 0),
        revenue: money(rows.reduce((s, r) => s + r.revenue, 0)),
        profit: money(rows.reduce((s, r) => s + r.profit, 0)),
      },
      chart: { title: 'Revenue by Location', data: rows.map((r) => ({ label: shortLabel(r.name), value: r.revenue })) },
    };
  },

  async reservations(params, user) {
    const rows = (await repo('reservations').getAll({ restaurantId: user?.restaurantId })).sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0)).slice(0, 200);
    return {
      title: 'Reservations',
      titleAr: 'الحجوزات',
      columns: [
        { key: 'clientName', label: 'Customer', labelAr: 'العميل' },
        { key: 'dateTime', label: 'Date', labelAr: 'التاريخ', format: (v) => (v ? new Date(v).toLocaleString() : '—') },
        { key: 'partySize', label: 'Party', labelAr: 'العدد', align: 'right' },
        { key: 'tableId', label: 'Table', labelAr: 'الطاولة' },
        { key: 'status', label: 'Status', labelAr: 'الحالة' },
      ],
      rows,
    };
  },

  async loyalty(params, user) {
    const clients = (await repo('clients').getAll({ restaurantId: user?.restaurantId })).filter((c) => (c.loyaltyPoints || 0) > 0)
      .sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0));
    return {
      title: 'Loyalty Points',
      titleAr: 'نقاط الولاء',
      columns: [
        { key: 'name', label: 'Customer', labelAr: 'العميل' },
        { key: 'loyaltyPoints', label: 'Points', labelAr: 'النقاط', align: 'right' },
        { key: 'visitCount', label: 'Visits', labelAr: 'الزيارات', align: 'right' },
        { key: 'totalSpent', label: 'Total Spent', labelAr: 'إجمالي الإنفاق', align: 'right', format: money },
      ],
      rows: clients,
      totals: { loyaltyPoints: clients.reduce((s, c) => s + (c.loyaltyPoints || 0), 0) },
      chart: { title: 'Top Loyalty', data: clients.slice(0, 8).map((c) => ({ label: shortLabel(c.name), value: c.loyaltyPoints || 0 })) },
    };
  },

  async purchases(params, user) {
    const rows = (await repo('purchases').getAll({ restaurantId: user?.restaurantId })).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 200);
    const goods = await repo('goods').getAll({ restaurantId: user?.restaurantId });
    const nameById = Object.fromEntries(goods.map((g) => [g.id, g.name]));
    return {
      title: 'Purchase History',
      titleAr: 'سجل المشتريات',
      columns: [
        { key: 'goodId', label: 'Item', labelAr: 'الصنف', format: (v) => nameById[v] || v },
        { key: 'quantity', label: 'Qty', labelAr: 'الكمية', align: 'right' },
        { key: 'unitPrice', label: 'Unit Price', labelAr: 'سعر الوحدة', align: 'right', format: money },
        { key: 'totalCost', label: 'Total', labelAr: 'الإجمالي', align: 'right', format: money },
        { key: 'supplier', label: 'Supplier', labelAr: 'المورد' },
        { key: 'date', label: 'Date', labelAr: 'التاريخ' },
      ],
      rows,
      totals: { totalCost: money(rows.reduce((s, p) => s + (p.totalCost || 0), 0)) },
    };
  },
};

/** Bundles: several report sections combined into ONE PDF / ONE Excel file. Every report
 *  is reached through one of these combined bundles (no separate per-report downloads). */
const BUNDLES = {
  workers: { title: 'Workers — Full Report', titleAr: 'العمال — تقرير شامل', types: ['worker-performance', 'attendance', 'salary'] },
  inventory: { title: 'Inventory — Full Report', titleAr: 'المخزون — تقرير شامل', types: ['stock', 'low-stock', 'waste', 'purchases'] },
  financial: { title: 'Financial — Full Report', titleAr: 'المالية — تقرير شامل', types: ['income', 'expenses', 'pnl', 'sales-by-location'] },
  sales: { title: 'Sales & Customers — Full Report', titleAr: 'المبيعات والعملاء — تقرير شامل', types: ['product-performance', 'order-history', 'customer-spending', 'loyalty', 'reservations'] },
};

async function settingsMeta(user) {
  const s = await settingsService.get(user);
  return { restaurantName: s.restaurantName || 'Restaurant Management System', currency: s.currency || 'USD' };
}

export const reportService = {
  types: () => Object.keys(REPORTS),
  bundles: () => Object.keys(BUNDLES),

  async build(type, params = {}, user) {
    const fn = REPORTS[type];
    if (!fn) throw new HttpError(404, `Unknown report type "${type}". Available: ${Object.keys(REPORTS).join(', ')}`);
    return fn(params, user);
  },

  /** Build a multi-section bundle (e.g. all workers reports in one). */
  async buildBundle(name, params = {}, user) {
    const def = BUNDLES[name];
    if (!def) throw new HttpError(404, `Unknown bundle "${name}". Available: ${Object.keys(BUNDLES).join(', ')}`);
    const isAr = params.lang === 'ar';
    const sections = [];
    for (const type of def.types) {
      const spec = await this.build(type, params, user);
      sections.push({ title: (isAr && spec.titleAr) ? spec.titleAr : spec.title, columns: spec.columns, rows: spec.rows, totals: spec.totals, chart: spec.chart });
    }
    return { title: isAr ? def.titleAr : def.title, titleAr: def.titleAr, sections };
  },

  async bundlePdf(name, params = {}, user) {
    const { title, titleAr, sections } = await this.buildBundle(name, params, user);
    const meta = await settingsMeta(user);
    // SOTA: render via headless Chromium (proper Arabic shaping, bidi, RTL tables, font
    // fallback). Falls back to the pdfkit renderer if puppeteer isn't installed yet.
    const { renderReportPdfHtml, isPuppeteerMissing } = await loadHtmlReport();
    try {
      return await renderReportPdfHtml({ title, meta, sections, lang: params.lang, filename: params.filename });
    } catch (err) {
      logger.warn(isPuppeteerMissing(err)
        ? 'puppeteer not installed — using pdfkit for the report PDF. Run `npm install puppeteer` (in backend/) for the best Arabic/RTL output.'
        : `Chromium PDF render failed (${err.message}) — using pdfkit fallback. Ensure Chromium/system libs are installed.`);
      const { renderMultiReportPdf } = await loadPdf();
      return renderMultiReportPdf({ title, titleAr, meta, sections, lang: params.lang, filename: params.filename });
    }
  },

  async bundleXlsx(name, params = {}, user) {
    const { title, titleAr, sections } = await this.buildBundle(name, params, user);
    const { renderMultiReportXlsx } = await loadExcel();
    return renderMultiReportXlsx({ title, titleAr, sections, lang: params.lang, filename: params.filename });
  },

  async pdf(type, params = {}, user) {
    const spec = await this.build(type, params, user);
    const meta = await settingsMeta(user);
    const isAr = params.lang === 'ar';
    const subtitle = params.from ? `${isAr ? 'الفترة' : 'Range'}: ${params.from} → ${params.to || (isAr ? 'الآن' : 'now')}` : '';
    const title = isAr ? (spec.titleAr || spec.title) : spec.title;
    // SOTA HTML→PDF (Chromium) with a graceful fallback to pdfkit if puppeteer is absent.
    const { renderReportPdfHtml, isPuppeteerMissing } = await loadHtmlReport();
    try {
      const sections = [{ title: '', columns: spec.columns, rows: spec.rows, totals: spec.totals, chart: spec.chart }];
      return await renderReportPdfHtml({ title, subtitle, meta, sections, lang: params.lang, filename: params.filename });
    } catch (err) {
      logger.warn(isPuppeteerMissing(err)
        ? 'puppeteer not installed — using pdfkit for the report PDF. Run `npm install puppeteer` (in backend/) for the best Arabic/RTL output.'
        : `Chromium PDF render failed (${err.message}) — using pdfkit fallback. Ensure Chromium/system libs are installed.`);
      const { renderReportPdf } = await loadPdf();
      return renderReportPdf({ ...spec, meta, subtitle, lang: params.lang, filename: params.filename });
    }
  },

  async xlsx(type, params = {}, user) {
    const spec = await this.build(type, params, user);
    const { renderReportXlsx } = await loadExcel();
    return renderReportXlsx({ ...spec, sheetName: type, lang: params.lang, filename: params.filename });
  },
};

export default reportService;
