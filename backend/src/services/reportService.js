import { repo } from '../repositories/index.js';
import { renderReportPdf } from '../utils/pdf.js';
import { renderReportXlsx } from '../utils/excel.js';
import { financeService } from './financeService.js';
import { goodsService } from './goodsService.js';
import { goodsCheckService } from './goodsCheckService.js';
import { analyticsService } from './analyticsService.js';
import { attendanceService } from './attendanceService.js';
import { HttpError } from '../middleware/errorHandler.js';

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
    };
  },

  async income(params) {
    const data = await financeService.income({ period: params.period || 'daily' });
    return {
      title: `Income (${data.period})`,
      columns: [
        { key: 'key', label: 'Period' },
        { key: 'value', label: 'Income', align: 'right', format: money },
      ],
      rows: data.series,
      totals: { value: money(data.total) },
    };
  },

  async expenses(params) {
    const data = await financeService.expenses({ period: params.period || 'monthly' });
    return {
      title: `Expenses (${data.period})`,
      columns: [
        { key: 'key', label: 'Period' },
        { key: 'value', label: 'Expense', align: 'right', format: money },
      ],
      rows: data.series,
      totals: { value: money(data.total) },
    };
  },

  async pnl(params) {
    const p = await financeService.profit({ period: params.period || 'monthly' });
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
    };
  },

  async 'order-history'() {
    const orders = (await repo('orders').getAll()).sort((a, b) => b.orderDate - a.orderDate).slice(0, 200);
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
    };
  },
};

async function settingsMeta() {
  const s = (await repo('settings').getAll())[0] || {};
  return { restaurantName: s.restaurantName || 'Restaurant Management System', currency: s.currency || 'USD' };
}

export const reportService = {
  types: () => Object.keys(REPORTS),

  async build(type, params = {}) {
    const fn = REPORTS[type];
    if (!fn) throw new HttpError(404, `Unknown report type "${type}". Available: ${Object.keys(REPORTS).join(', ')}`);
    return fn(params);
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
