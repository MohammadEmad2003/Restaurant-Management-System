import { Router } from 'express';
import multer from 'multer';

import { auth, signToken } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { rbac } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';

import { authService } from '../services/authService.js';
import { workerService } from '../services/workerService.js';
import { attendanceService } from '../services/attendanceService.js';
import { clientService } from '../services/clientService.js';
import { productService } from '../services/productService.js';
import { goodsService } from '../services/goodsService.js';
import { orderService } from '../services/orderService.js';
import { goodsCheckService } from '../services/goodsCheckService.js';
import { financeService } from '../services/financeService.js';
import { analyticsService } from '../services/analyticsService.js';
import { reportService } from '../services/reportService.js';
import { importService } from '../services/importService.js';
import { reservationService } from '../services/reservationService.js';
import { kdsService } from '../services/kdsService.js';
import { loyaltyService } from '../services/loyaltyService.js';
import { shiftService } from '../services/shiftService.js';
import { locationService } from '../services/locationService.js';
import { salaryService } from '../services/salaryService.js';
import { createCrudService } from '../services/baseService.js';
import { syncEngine } from '../sync/syncEngine.js';
import { repo } from '../repositories/index.js';
import { renderInvoicePdf } from '../utils/pdf.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const h = asyncHandler;

/* ─────────────────────── FEATURE FLAGS ─────────────────── */
// Public so the frontend can gate the navbar (per-customer feature tiers).
router.get('/features', (req, res) => res.json(config.features));

/* ───────────────────────── AUTH ───────────────────────── */
router.post('/auth/login', h(async (req, res) => {
  const { username, password } = req.body;
  res.json(await authService.login(username, password));
}));
router.get('/auth/me', auth, h(async (req, res) => res.json(await authService.me(req.user.sub))));
router.post('/auth/logout', auth, (req, res) => res.json({ ok: true }));

/* ──────────────────────── WORKERS ──────────────────────── */
router.get('/workers', auth, rbac('admin'), h(async (req, res) => res.json(await workerService.list(req.query))));
router.get('/workers/:id', auth, rbac('admin'), h(async (req, res) => res.json(await workerService.get(req.params.id))));
router.get('/workers/:id/activity', auth, h(async (req, res) => res.json(await workerService.activity(req.params.id))));
router.post('/workers', auth, rbac('admin'), validateBody('workers'), h(async (req, res) => res.status(201).json(await workerService.create(req.body, req.user))));
router.put('/workers/:id', auth, rbac('admin'), validateBody('workers', { partial: true }), h(async (req, res) => res.json(await workerService.update(req.params.id, req.body, req.user))));
router.patch('/workers/:id/disable', auth, rbac('admin'), h(async (req, res) => res.json(await workerService.disable(req.params.id, req.user))));
router.delete('/workers/:id', auth, rbac('admin'), h(async (req, res) => res.json(await workerService.remove(req.params.id, req.user))));

/* ─────────────────────── ATTENDANCE ────────────────────── */
// Kiosk: any signed-in device lets a worker clock in/out with their own credentials.
router.post('/attendance/check', auth, h(async (req, res) => res.json(await attendanceService.markByCredentials(req.body.username, req.body.password))));
router.post('/attendance/clock-in', auth, h(async (req, res) => res.json(await attendanceService.clockIn(req.body.workerId || req.user.sub, req.user))));
router.post('/attendance/clock-out', auth, h(async (req, res) => res.json(await attendanceService.clockOut(req.body.workerId || req.user.sub, req.user))));
router.get('/attendance', auth, rbac('admin'), h(async (req, res) => res.json(await attendanceService.list(req.query))));
router.get('/attendance/reports/monthly', auth, rbac('admin'), h(async (req, res) => res.json(await attendanceService.monthlyReport(req.query))));
router.post('/attendance/absences', auth, rbac('admin'), h(async (req, res) => res.json(await attendanceService.markAbsences(req.body, req.user))));
router.post('/attendance/overtime/bulk', auth, rbac('admin'), h(async (req, res) => res.json(await attendanceService.bulkOvertime(req.body, req.user))));
router.patch('/attendance/:id/excuse', auth, rbac('admin'), h(async (req, res) => res.json(await attendanceService.setExcuse(req.params.id, req.body, req.user))));
router.patch('/attendance/:id/overtime', auth, rbac('admin'), h(async (req, res) => res.json(await attendanceService.setOvertime(req.params.id, req.body, req.user))));

/* ───────────────────────── CLIENTS ─────────────────────── */
router.get('/clients', auth, h(async (req, res) => res.json(await clientService.list(req.query))));
router.get('/clients/search', auth, h(async (req, res) => res.json(await clientService.search(req.query))));
router.get('/clients/:id', auth, h(async (req, res) => res.json(await clientService.get(req.params.id))));
router.get('/clients/:id/history', auth, h(async (req, res) => res.json(await clientService.history(req.params.id))));
router.post('/clients', auth, validateBody('clients'), h(async (req, res) => res.status(201).json(await clientService.create(req.body, req.user))));
router.put('/clients/:id', auth, validateBody('clients', { partial: true }), h(async (req, res) => res.json(await clientService.update(req.params.id, req.body, req.user))));
router.post('/clients/:id/phones', auth, h(async (req, res) => res.json(await clientService.addPhone(req.params.id, req.body.phone, req.user))));
router.post('/clients/:id/addresses', auth, h(async (req, res) => res.json(await clientService.addAddress(req.params.id, req.body.address, req.user))));

/* ───────────────────────── PRODUCTS ────────────────────── */
router.get('/products', auth, h(async (req, res) => res.json(await productService.list(req.query))));
router.get('/products/:id', auth, h(async (req, res) => res.json(await productService.get(req.params.id))));
router.get('/products/:id/cost', auth, h(async (req, res) => res.json(await productService.cost(req.params.id))));
router.post('/products', auth, rbac('admin'), validateBody('products'), h(async (req, res) => res.status(201).json(await productService.create(req.body, req.user))));
router.put('/products/:id', auth, rbac('admin'), validateBody('products', { partial: true }), h(async (req, res) => res.json(await productService.update(req.params.id, req.body, req.user))));
router.delete('/products/:id', auth, rbac('admin'), h(async (req, res) => res.json(await productService.remove(req.params.id, req.user))));

/* ─────────────────── GOODS / INVENTORY ─────────────────── */
router.get('/goods', auth, h(async (req, res) => res.json(await goodsService.list(req.query))));
router.get('/goods/alerts/low-stock', auth, h(async (req, res) => res.json(await goodsService.lowStock())));
router.get('/goods/valuation', auth, rbac('admin'), h(async (req, res) => res.json(await goodsService.valuation())));
router.get('/goods/:id', auth, h(async (req, res) => res.json(await goodsService.get(req.params.id))));
router.post('/goods', auth, rbac('admin'), validateBody('goods'), h(async (req, res) => res.status(201).json(await goodsService.create(req.body, req.user))));
router.put('/goods/:id', auth, rbac('admin'), validateBody('goods', { partial: true }), h(async (req, res) => res.json(await goodsService.update(req.params.id, req.body, req.user))));
router.post('/goods/:id/purchase', auth, rbac('admin'), h(async (req, res) => res.json(await goodsService.purchase(req.params.id, req.body, req.user))));
router.delete('/goods/:id', auth, rbac('admin'), h(async (req, res) => res.json(await goodsService.remove(req.params.id, req.user))));

/* ──────────────── GOODS CHECK / WASTE ──────────────────── */
router.get('/goods-checks', auth, rbac('admin'), h(async (req, res) => res.json(await goodsCheckService.list(req.query))));
router.post('/goods-checks', auth, rbac('admin'), h(async (req, res) => res.status(201).json(await goodsCheckService.create(req.body, req.user))));
router.get('/goods-checks/reports/waste', auth, rbac('admin'), h(async (req, res) => res.json(await goodsCheckService.wasteReport(req.query))));

/* ───────────────────────── ORDERS ──────────────────────── */
router.get('/orders', auth, h(async (req, res) => res.json(await orderService.list(req.query))));
router.get('/orders/:id', auth, h(async (req, res) => res.json(await orderService.get(req.params.id))));
router.post('/orders', auth, validateBody('orders'), h(async (req, res) => res.status(201).json(await orderService.create(req.body, req.user))));
router.put('/orders/:id', auth, h(async (req, res) => res.json(await orderService.update(req.params.id, req.body, req.user))));
router.patch('/orders/:id/cancel', auth, h(async (req, res) => res.json(await orderService.cancel(req.params.id, req.user))));
router.patch('/orders/:id/status', auth, h(async (req, res) => res.json(await orderService.setStatus(req.params.id, req.body.status, req.user))));
router.get('/orders/:id/invoice.pdf', auth, h(async (req, res) => {
  const order = await orderService.get(req.params.id);
  const settings = (await repo('settings').getAll())[0] || {};
  const pdf = await renderInvoicePdf(order, settings);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${order.invoiceNo || order.id}.pdf"` });
  res.send(pdf);
}));

/* ───────────────────────── FINANCE ─────────────────────── */
router.get('/finance/income', auth, rbac('admin'), h(async (req, res) => res.json(await financeService.income(req.query))));
router.get('/finance/expenses', auth, rbac('admin'), h(async (req, res) => res.json(await financeService.expenses(req.query))));
router.get('/finance/profit', auth, rbac('admin'), h(async (req, res) => res.json(await financeService.profit(req.query))));
router.get('/finance/cashflow', auth, rbac('admin'), h(async (req, res) => res.json(await financeService.cashflow(req.query))));
const expenseSvc = createCrudService('expenses', { entityName: 'expense' });
router.post('/expenses', auth, rbac('admin'), validateBody('expenses'), h(async (req, res) => res.status(201).json(await expenseSvc.create(req.body, req.user))));

/* ──────────────── SALARIES (admin) ─────────────────────── */
router.get('/salaries', auth, rbac('admin'), h(async (req, res) => res.json(await salaryService.list(req.query))));
router.get('/salaries/preview', auth, rbac('admin'), h(async (req, res) => res.json(await salaryService.preview(req.query))));
router.post('/salaries/generate', auth, rbac('admin'), h(async (req, res) => res.json(await salaryService.generate(req.body, req.user))));
router.post('/salaries/run', auth, rbac('admin'), h(async (req, res) => res.json(await salaryService.runMonthly(req.body, req.user))));
router.patch('/salaries/:id/adjust', auth, rbac('admin'), h(async (req, res) => res.json(await salaryService.adjust(req.params.id, req.body, req.user))));
router.patch('/salaries/:id/pay', auth, rbac('admin'), h(async (req, res) => res.json(await salaryService.markPaid(req.params.id, req.user))));

/* ──────────────────────── ANALYTICS ────────────────────── */
router.get('/analytics/dashboard', auth, rbac('admin'), h(async (req, res) => res.json(await analyticsService.dashboard())));
router.get('/analytics/sales', auth, rbac('admin'), h(async (req, res) => res.json(await analyticsService.sales())));
router.get('/analytics/inventory', auth, rbac('admin'), h(async (req, res) => res.json(await analyticsService.inventory())));
router.get('/analytics/workers', auth, rbac('admin'), h(async (req, res) => res.json(await analyticsService.workers())));
router.get('/analytics/customers', auth, rbac('admin'), h(async (req, res) => res.json(await analyticsService.customers())));
router.get('/analytics/locations', auth, rbac('admin'), h(async (req, res) => res.json(await analyticsService.byLocation(req.query))));

/* ──────────────────────── REPORTS ──────────────────────── */
router.get('/reports', auth, rbac('admin'), (req, res) => res.json({ types: reportService.types(), bundles: reportService.bundles() }));
// Combined multi-section bundles (must be declared before the generic :type routes).
router.get('/reports/bundle/:name.pdf', auth, rbac('admin'), h(async (req, res) => {
  const pdf = await reportService.bundlePdf(req.params.name, req.query);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${req.params.name}-report.pdf"` });
  res.send(pdf);
}));
router.get('/reports/bundle/:name.xlsx', auth, rbac('admin'), h(async (req, res) => {
  const xlsx = await reportService.bundleXlsx(req.params.name, req.query);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${req.params.name}-report.xlsx"` });
  res.send(Buffer.from(xlsx));
}));
router.get('/reports/:type.pdf', auth, rbac('admin'), h(async (req, res) => {
  const pdf = await reportService.pdf(req.params.type, req.query);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${req.params.type}.pdf"` });
  res.send(pdf);
}));
router.get('/reports/:type.xlsx', auth, rbac('admin'), h(async (req, res) => {
  const xlsx = await reportService.xlsx(req.params.type, req.query);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${req.params.type}.xlsx"` });
  res.send(Buffer.from(xlsx));
}));

/* ──────────────────────── IMPORT ───────────────────────── */
router.post('/import/:entity/validate', auth, rbac('admin'), upload.single('file'), h(async (req, res) => res.json(await importService.validateFile(req.params.entity, req.file.buffer))));
router.post('/import/:entity', auth, rbac('admin'), upload.single('file'), h(async (req, res) => res.json(await importService.importFile(req.params.entity, req.file.buffer, req.user))));

/* ────────────────────── RESERVATIONS ───────────────────── */
router.get('/reservations', auth, h(async (req, res) => res.json(await reservationService.list(req.query))));
router.get('/reservations/calendar', auth, h(async (req, res) => res.json(await reservationService.calendar(req.query))));
router.post('/reservations', auth, validateBody('reservations'), h(async (req, res) => res.status(201).json(await reservationService.create(req.body, req.user))));
router.put('/reservations/:id', auth, h(async (req, res) => res.json(await reservationService.update(req.params.id, req.body, req.user))));
router.patch('/reservations/:id/no-show', auth, h(async (req, res) => res.json(await reservationService.markNoShow(req.params.id, req.user))));

/* ─────────────────────────── KDS ───────────────────────── */
router.get('/kds/tickets', auth, h(async (req, res) => res.json(await kdsService.tickets())));
router.patch('/kds/tickets/:id/status', auth, h(async (req, res) => res.json(await kdsService.setStatus(req.params.id, req.body.status, req.user))));

/* ──────────────────────── LOYALTY ──────────────────────── */
router.get('/loyalty/:clientId', auth, h(async (req, res) => res.json(await loyaltyService.get(req.params.clientId))));
router.post('/loyalty/:clientId/redeem', auth, h(async (req, res) => res.json(await loyaltyService.redeem(req.params.clientId, Number(req.body.points), req.user))));

/* ──────────────────── SCHEDULING / SHIFTS ──────────────── */
router.get('/shifts', auth, rbac('admin'), h(async (req, res) => res.json(await shiftService.list(req.query))));
router.get('/shifts/weekly', auth, rbac('admin'), h(async (req, res) => res.json(await shiftService.weekly())));
router.get('/shifts/forecast', auth, rbac('admin'), h(async (req, res) => res.json(await shiftService.forecast())));
router.post('/shifts', auth, rbac('admin'), validateBody('shifts'), h(async (req, res) => res.status(201).json(await shiftService.create(req.body, req.user))));
router.put('/shifts/:id', auth, rbac('admin'), h(async (req, res) => res.json(await shiftService.update(req.params.id, req.body, req.user))));
router.delete('/shifts/:id', auth, rbac('admin'), h(async (req, res) => res.json(await shiftService.remove(req.params.id, req.user))));

/* ──────────────────────── LOCATIONS ────────────────────── */
// Admin-managed governorates + areas used for customer profiling & profit-by-area.
router.get('/locations', auth, h(async (req, res) => res.json(await locationService.list(req.query))));
router.get('/locations/tree', auth, h(async (req, res) => res.json(await locationService.tree())));
router.post('/locations', auth, rbac('admin'), validateBody('locations'), h(async (req, res) => res.status(201).json(await locationService.create(req.body, req.user))));
router.delete('/locations/:id', auth, rbac('admin'), h(async (req, res) => res.json(await locationService.remove(req.params.id, req.user))));

/* ──────────────────────── AUDIT LOGS ───────────────────── */
router.get('/audit-logs', auth, rbac('admin'), h(async (req, res) => {
  let logs = await repo('auditLogs').getAll();
  const { userId, entityType, from, to } = req.query;
  if (userId) logs = logs.filter((l) => l.userId === userId);
  if (entityType) logs = logs.filter((l) => l.entityType === entityType);
  if (from) logs = logs.filter((l) => l.timestamp >= new Date(from).getTime());
  if (to) logs = logs.filter((l) => l.timestamp <= new Date(to).getTime());
  res.json(logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 500));
}));

/* ──────────────────────── SETTINGS ─────────────────────── */
router.get('/settings', auth, h(async (req, res) => res.json((await repo('settings').getAll())[0] || {})));
router.put('/settings', auth, rbac('admin'), h(async (req, res) => {
  const current = (await repo('settings').getAll())[0];
  const saved = current ? await repo('settings').update(current.id, req.body) : await repo('settings').create(req.body);
  res.json(saved);
}));

/* ───────────────────────── SYNC ────────────────────────── */
router.get('/sync/status', auth, (req, res) => res.json(syncEngine.status()));
router.post('/sync/flush', auth, rbac('admin'), h(async (req, res) => res.json(await syncEngine.flush())));

export default router;
