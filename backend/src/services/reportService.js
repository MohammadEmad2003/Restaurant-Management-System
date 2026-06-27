import { repo } from '../repositories/index.js';
import { renderReportPdf, renderMultiReportPdf } from '../utils/pdf.js';
import { renderReportXlsx, renderMultiReportXlsx } from '../utils/excel.js';
import { financeService } from './financeService.js';
import { goodsService } from './goodsService.js';
import { goodsCheckService } from './goodsCheckService.js';
import { analyticsService } from './analyticsService.js';
import { attendanceService } from './attendanceService.js';
import { salaryService } from './salaryService.js';
import { HttpError } from '../middleware/errorHandler.js';

const shortLabel = (s) => String(s || '').split('—')[0].trim();

const money = (v) => `${Number(v || 0).toFixed(2)}`;

/**
 * Report registry. Each entry returns { title, columns, rows, totals }.
 * Used by both the PDF and Excel renderers so output stays consistent.
 */
const REPORTS = {
  async attendance(params) {
    const rows = await attendanceService.monthlyReport({ month: params.month });
    return {
      title: 'Attendance & Working Hours',
      columns: [
        { key: 'workerName', label: 'Employee' },
        { key: 'days', label: 'Days', align: 'right' },
        { key: 'totalHours', label: 'Hours', align: 'right' },
        { key: 'overtime', label: 'Overtime', align: 'right' },
      ],
      rows,
      totals: {
        totalHours: rows.reduce((s, r) => s + r.totalHours, 0).toFixed(2),
        overtime: rows.reduce((s, r) => s + r.overtime, 0).toFixed(2),
      },
      chart: { title: 'Hours by Employee', data: rows.slice(0, 8).map((r) => ({ label: shortLabel(r.workerName), value: r.totalHours })) },
    };
  },

  async income(params) {
    const data = await financeService.income({ period: params.period || 'daily', from: params.from, to: params.to });
    return {
      title: `Income (${data.period})`,
      columns: [
        { key: 'key', label: 'Period' },
        { key: 'value', label: 'Income', align: 'right', format: money },
      ],
      rows: data.series,
      totals: { value: money(data.total) },
      chart: { title: 'Income', data: data.series.slice(-10).map((s) => ({ label: s.key, value: s.value })) },
    };
  },

  async expenses(params) {
    const data = await financeService.expenses({ period: params.period || 'monthly', from: params.from, to: params.to });
    return {
      title: `Expenses (${data.period})`,
      columns: [
        { key: 'key', label: 'Period' },
        { key: 'value', label: 'Expense', align: 'right', format: money },
      ],
      rows: data.series,
      totals: { value: money(data.total) },
      chart: { title: 'Expenses', data: data.series.slice(-10).map((s) => ({ label: s.key, value: s.value })) },
    };
  },

  async pnl(params) {
    const p = await financeService.profit({ period: params.period || 'monthly', from: params.from, to: params.to });
    return {
      title: 'Profit & Loss',
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Amount', align: 'right' },
      ],
      rows: [
        { metric: 'Revenue', value: money(p.revenue) },
        { metric: 'Expenses', value: money(p.expenses) },
        { metric: 'Net Profit', value: money(p.netProfit) },
        { metric: 'Profit Margin', value: `${p.profitMargin}%` },
      ],
    };
  },

  async stock() {
    const goods = await repo('goods').getAll();
    return {
      title: 'Current Stock',
      columns: [
        { key: 'name', label: 'Item' },
        { key: 'quantityAvailable', label: 'Qty', align: 'right' },
        { key: 'unit', label: 'Unit' },
        { key: 'minimumStockLevel', label: 'Min', align: 'right' },
        { key: 'value', label: 'Value', align: 'right', format: money },
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

  async 'low-stock'() {
    const rows = await goodsService.lowStock();
    return {
      title: 'Low Stock Alerts',
      columns: [
        { key: 'name', label: 'Item' },
        { key: 'quantityAvailable', label: 'Remaining', align: 'right' },
        { key: 'minimumStockLevel', label: 'Minimum', align: 'right' },
        { key: 'unit', label: 'Unit' },
      ],
      rows,
    };
  },

  async waste(params) {
    const data = await goodsCheckService.wasteReport({ from: params.from, to: params.to });
    return {
      title: 'Waste / Loss Report',
      columns: [
        { key: 'name', label: 'Ingredient' },
        { key: 'totalLoss', label: 'Qty Lost', align: 'right' },
        { key: 'lossValue', label: 'Value Lost', align: 'right', format: money },
        { key: 'checks', label: 'Checks', align: 'right' },
      ],
      rows: data.items,
      totals: { lossValue: money(data.totalLossValue) },
      chart: { title: 'Top Waste by Value', data: (data.items || []).slice(0, 8).map((i) => ({ label: shortLabel(i.name), value: +(i.lossValue || 0).toFixed(2) })) },
    };
  },

  async 'product-performance'() {
    const sales = await analyticsService.sales();
    return {
      title: 'Product Performance',
      columns: [
        { key: 'name', label: 'Product' },
        { key: 'qty', label: 'Sold', align: 'right' },
        { key: 'revenue', label: 'Revenue', align: 'right', format: money },
      ],
      rows: sales.bestSelling,
      totals: { revenue: money(sales.bestSelling.reduce((s, r) => s + r.revenue, 0)) },
      chart: { title: 'Revenue by Product', data: sales.bestSelling.slice(0, 8).map((r) => ({ label: shortLabel(r.name), value: +(r.revenue || 0).toFixed(2) })) },
    };
  },

  async 'order-history'(params) {
    const fromTs = params.from ? new Date(params.from).getTime() : -Infinity;
    const toTs = params.to ? new Date(params.to).getTime() + 864e5 : Infinity;
    const orders = (await repo('orders').getAll())
      .filter((o) => (o.orderDate || 0) >= fromTs && (o.orderDate || 0) < toTs)
      .sort((a, b) => b.orderDate - a.orderDate).slice(0, 200);
    return {
      title: 'Order History',
      columns: [
        { key: 'invoiceNo', label: 'Invoice' },
        { key: 'orderDate', label: 'Date', format: (v) => new Date(v).toLocaleDateString() },
        { key: 'itemCount', label: 'Items', align: 'right' },
        { key: 'status', label: 'Status' },
        { key: 'totalPrice', label: 'Total', align: 'right', format: money },
      ],
      rows: orders.map((o) => ({ ...o, itemCount: (o.products || []).length })),
      totals: { totalPrice: money(orders.reduce((s, o) => s + (o.totalPrice || 0), 0)) },
    };
  },

  async 'customer-spending'() {
    const clients = (await repo('clients').getAll()).sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
    return {
      title: 'Customer Spending',
      columns: [
        { key: 'name', label: 'Customer' },
        { key: 'visitCount', label: 'Visits', align: 'right' },
        { key: 'loyaltyPoints', label: 'Points', align: 'right' },
        { key: 'totalSpent', label: 'Total Spent', align: 'right', format: money },
      ],
      rows: clients,
      totals: { totalSpent: money(clients.reduce((s, c) => s + (c.totalSpent || 0), 0)) },
      chart: { title: 'Top Customers by Spend', data: clients.slice(0, 8).map((c) => ({ label: shortLabel(c.name), value: +(c.totalSpent || 0).toFixed(2) })) },
    };
  },

  async salary(params) {
    const month = params.month || new Date().toISOString().slice(0, 7);
    const rows = await repo('salaries').getAll({ month });
    return {
      title: `Salary Report (${month})`,
      columns: [
        { key: 'workerName', label: 'Employee' },
        { key: 'baseSalary', label: 'Base', align: 'right', format: money },
        { key: 'overtimePay', label: 'Overtime', align: 'right', format: money },
        { key: 'netPay', label: 'Net Pay', align: 'right', format: money },
        { key: 'paid', label: 'Paid', format: (v) => (v ? 'Yes' : 'No') },
      ],
      rows,
      totals: { netPay: money(rows.reduce((s, r) => s + (r.netPay || 0), 0)) },
      chart: { title: 'Net Pay by Employee', data: rows.slice(0, 8).map((r) => ({ label: shortLabel(r.workerName), value: +(r.netPay || 0).toFixed(2) })) },
    };
  },

  async 'worker-performance'() {
    const data = await analyticsService.workers();
    return {
      title: 'Worker Performance',
      columns: [
        { key: 'name', label: 'Employee' },
        { key: 'hours', label: 'Hours', align: 'right' },
        { key: 'orders', label: 'Orders', align: 'right' },
      ],
      rows: data.productivity,
      chart: { title: 'Orders Handled', data: data.productivity.slice(0, 8).map((r) => ({ label: shortLabel(r.name), value: r.orders })) },
    };
  },

  async 'sales-by-location'(params) {
    const rows = await analyticsService.byLocation({ from: params.from, to: params.to });
    return {
      title: 'Sales by Location',
      columns: [
        { key: 'name', label: 'Location' },
        { key: 'orders', label: 'Orders', align: 'right' },
        { key: 'revenue', label: 'Revenue', align: 'right', format: money },
        { key: 'profit', label: 'Gross Profit', align: 'right', format: money },
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

  async reservations() {
    const rows = (await repo('reservations').getAll()).sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0)).slice(0, 200);
    return {
      title: 'Reservations',
      columns: [
        { key: 'clientName', label: 'Customer' },
        { key: 'dateTime', label: 'Date', format: (v) => (v ? new Date(v).toLocaleString() : '—') },
        { key: 'partySize', label: 'Party', align: 'right' },
        { key: 'tableId', label: 'Table' },
        { key: 'status', label: 'Status' },
      ],
      rows,
    };
  },

  async loyalty() {
    const clients = (await repo('clients').getAll()).filter((c) => (c.loyaltyPoints || 0) > 0)
      .sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0));
    return {
      title: 'Loyalty Points',
      columns: [
        { key: 'name', label: 'Customer' },
        { key: 'loyaltyPoints', label: 'Points', align: 'right' },
        { key: 'visitCount', label: 'Visits', align: 'right' },
        { key: 'totalSpent', label: 'Total Spent', align: 'right', format: money },
      ],
      rows: clients,
      totals: { loyaltyPoints: clients.reduce((s, c) => s + (c.loyaltyPoints || 0), 0) },
      chart: { title: 'Top Loyalty', data: clients.slice(0, 8).map((c) => ({ label: shortLabel(c.name), value: c.loyaltyPoints || 0 })) },
    };
  },

  async purchases() {
    const rows = (await repo('purchases').getAll()).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 200);
    const goods = await repo('goods').getAll();
    const nameById = Object.fromEntries(goods.map((g) => [g.id, g.name]));
    return {
      title: 'Purchase History',
      columns: [
        { key: 'goodId', label: 'Item', format: (v) => nameById[v] || v },
        { key: 'quantity', label: 'Qty', align: 'right' },
        { key: 'unitPrice', label: 'Unit Price', align: 'right', format: money },
        { key: 'totalCost', label: 'Total', align: 'right', format: money },
        { key: 'supplier', label: 'Supplier' },
        { key: 'date', label: 'Date' },
      ],
      rows,
      totals: { totalCost: money(rows.reduce((s, p) => s + (p.totalCost || 0), 0)) },
    };
  },
};

/** Bundles: several report sections combined into one PDF / one Excel file. */
const BUNDLES = {
  workers: { title: 'Workers — Full Report', types: ['worker-performance', 'attendance', 'salary'] },
  inventory: { title: 'Inventory — Full Report', types: ['stock', 'low-stock', 'waste', 'purchases'] },
};

async function settingsMeta() {
  const s = (await repo('settings').getAll())[0] || {};
  return { restaurantName: s.restaurantName || 'Restaurant Management System', currency: s.currency || 'USD' };
}

export const reportService = {
  types: () => Object.keys(REPORTS),
  bundles: () => Object.keys(BUNDLES),

  async build(type, params = {}) {
    const fn = REPORTS[type];
    if (!fn) throw new HttpError(404, `Unknown report type "${type}". Available: ${Object.keys(REPORTS).join(', ')}`);
    return fn(params);
  },

  /** Build a multi-section bundle (e.g. all workers reports in one). */
  async buildBundle(name, params = {}) {
    const def = BUNDLES[name];
    if (!def) throw new HttpError(404, `Unknown bundle "${name}". Available: ${Object.keys(BUNDLES).join(', ')}`);
    const sections = [];
    for (const type of def.types) {
      const spec = await this.build(type, params);
      sections.push({ title: spec.title, columns: spec.columns, rows: spec.rows, totals: spec.totals, chart: spec.chart });
    }
    return { title: def.title, sections };
  },

  async bundlePdf(name, params = {}) {
    const { title, sections } = await this.buildBundle(name, params);
    const meta = await settingsMeta();
    return renderMultiReportPdf({ title, meta, sections });
  },

  async bundleXlsx(name, params = {}) {
    const { sections } = await this.buildBundle(name, params);
    return renderMultiReportXlsx({ sections });
  },

  async pdf(type, params = {}) {
    const spec = await this.build(type, params);
    const meta = await settingsMeta();
    return renderReportPdf({ ...spec, meta, subtitle: params.from ? `Range: ${params.from} → ${params.to || 'now'}` : '' });
  },

  async xlsx(type, params = {}) {
    const spec = await this.build(type, params);
    return renderReportXlsx({ ...spec, sheetName: type });
  },
};

export default reportService;
