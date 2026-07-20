import { Router } from 'express';
import multer from 'multer';

import { auth, requireDeviceBound } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { rbac } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authRateLimit } from '../middleware/rateLimit.js';

import { authService } from '../services/authService.js';
import { sessionService } from '../services/sessionService.js';
import { buildFingerprint } from '../utils/device.js';
import superAdminRoutes from './superAdmin.js';
import licenseRoutes from './license.js';
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
import { cashAdvanceService } from '../services/cashAdvanceService.js';
import { cashierShiftService } from '../services/cashierShiftService.js';
import { supplierService } from '../services/supplierService.js';
import { settingsService } from '../services/settingsService.js';
import { createCrudService } from '../services/baseService.js';
import { auditService } from '../services/auditService.js';
import { syncEngine } from '../sync/syncEngine.js';
import { repo } from '../repositories/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const h = asyncHandler;

/**
 * Build a valid Content-Disposition header. HTTP header values must be ASCII, so a non-ASCII
 * (e.g. Arabic) filename is sent via RFC 5987 `filename*` (UTF-8, percent-encoded) with an
 * ASCII-sanitised `filename` fallback. Without this, Arabic report names throw
 * "Invalid character in header content".
 */
function contentDisposition(name, disposition = 'inline') {
  const safe = String(name || 'file');
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '') || 'file';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/* ─────────────────────── FEATURE FLAGS ─────────────────── */
// Public so the frontend can gate the navbar (per-customer feature tiers).
router.get('/features', (req, res) => res.json(config.features));

/* ───────────────────────── AUTH ───────────────────────── */
router.post('/auth/login', authRateLimit(), h(async (req, res) => {
  const { username, password, fingerprint, deviceName, operatingSystem } = req.body;
  const fp = fingerprint || req.headers['x-device-fingerprint'] || buildFingerprint(req);
  const result = await authService.loginRestaurantUser({
    username,
    password,
    fingerprint: fp,
    deviceName,
    operatingSystem,
    ipAddress: req.ip,
  });
  res.json(result);
}));

router.post('/auth/login/superadmin', authRateLimit(), h(async (req, res) => {
  const { username, password } = req.body;
  const result = await authService.loginSuperAdmin({ username, password, ipAddress: req.ip });
  res.json(result);
}));

router.get('/auth/me', auth, h(async (req, res) => res.json(await authService.me(req.user.sub, req.user.type))));
router.post('/auth/logout', auth, h(async (req, res) => {
  if (req.user?.jti) await sessionService.logoutSession(req.user.jti);
  res.json({ ok: true });
}));

/* ───────────── SUPER ADMIN & LICENSE MOUNTS ───────────── */
router.use('/superadmin', superAdminRoutes);
router.use('/license', licenseRoutes);

// All remaining restaurant routes require a device-bound token.
router.use(auth, requireDeviceBound);

/* ──────────────────────── WORKERS ──────────────────────── */
router.get('/workers', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.list(req.query, req.user))));
// Cashier-only minimal list (id + name) — accessible to cashiers for shift handover.
// Declared BEFORE '/workers/:id' so ":id" doesn't capture "cashiers".
router.get('/workers/cashiers', auth, rbac('CASHIER'), h(async (req, res) => res.json(await workerService.cashiers(req.user))));
router.get('/workers/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.get(req.params.id, req.user))));
router.get('/workers/:id/activity', auth, h(async (req, res) => res.json(await workerService.activity(req.params.id, req.user))));
router.post('/workers', auth, rbac('ADMIN'), validateBody('workers'), h(async (req, res) => res.status(201).json(await workerService.create(req.body, req.user))));
router.put('/workers/:id', auth, rbac('ADMIN'), validateBody('workers', { partial: true }), h(async (req, res) => res.json(await workerService.update(req.params.id, req.body, req.user))));
router.patch('/workers/:id/disable', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.disable(req.params.id, req.user))));
router.delete('/workers/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.remove(req.params.id, req.user))));

/* ─────────────────────── ATTENDANCE ────────────────────── */
// Kiosk: any signed-in device lets a worker clock in/out with their own credentials.
router.post('/attendance/check', auth, h(async (req, res) => res.json(await attendanceService.markByCredentials(req.body.username, req.body.password, req.user))));
router.post('/attendance/clock-in', auth, h(async (req, res) => {
  const workerId = req.body.workerId || await attendanceService.resolveWorkerId(req.user.sub);
  res.json(await attendanceService.clockIn(workerId, req.user));
}));
router.post('/attendance/clock-out', auth, h(async (req, res) => {
  const workerId = req.body.workerId || await attendanceService.resolveWorkerId(req.user.sub);
  res.json(await attendanceService.clockOut(workerId, req.user));
}));
router.get('/attendance', auth, rbac('ADMIN'), h(async (req, res) => res.json(await attendanceService.list(req.query, req.user))));
router.get('/attendance/reports/monthly', auth, rbac('ADMIN'), h(async (req, res) => res.json(await attendanceService.monthlyReport(req.query, req.user))));
router.post('/attendance/absences', auth, rbac('ADMIN'), h(async (req, res) => res.json(await attendanceService.markAbsences(req.body, req.user))));
router.post('/attendance/overtime/bulk', auth, rbac('ADMIN'), h(async (req, res) => res.json(await attendanceService.bulkOvertime(req.body, req.user))));
router.patch('/attendance/:id/excuse', auth, rbac('ADMIN'), h(async (req, res) => res.json(await attendanceService.setExcuse(req.params.id, req.body, req.user))));
router.patch('/attendance/:id/overtime', auth, rbac('ADMIN'), h(async (req, res) => res.json(await attendanceService.setOvertime(req.params.id, req.body, req.user))));

/* ───────────────────────── CLIENTS ─────────────────────── */
router.get('/clients', auth, h(async (req, res) => res.json(await clientService.list(req.query, req.user))));
router.get('/clients/search', auth, h(async (req, res) => res.json(await clientService.search(req.query, req.user))));
router.get('/clients/filter', auth, h(async (req, res) => res.json(await clientService.filter(req.query, req.user))));
router.get('/clients/:id', auth, h(async (req, res) => res.json(await clientService.get(req.params.id, req.user))));
router.get('/clients/:id/history', auth, h(async (req, res) => res.json(await clientService.history(req.params.id, req.user))));
router.post('/clients', auth, validateBody('clients'), h(async (req, res) => res.status(201).json(await clientService.create(req.body, req.user))));
router.put('/clients/:id', auth, validateBody('clients', { partial: true }), h(async (req, res) => res.json(await clientService.update(req.params.id, req.body, req.user))));
router.post('/clients/:id/phones', auth, h(async (req, res) => res.json(await clientService.addPhone(req.params.id, req.body.phone, req.user))));
router.post('/clients/:id/addresses', auth, h(async (req, res) => res.json(await clientService.addAddress(req.params.id, req.body.address, req.user))));

/* ───────────────────────── PRODUCTS ────────────────────── */
router.get('/products', auth, h(async (req, res) => res.json(await productService.list(req.query, req.user))));
router.get('/products/:id', auth, h(async (req, res) => res.json(await productService.get(req.params.id, req.user))));
router.get('/products/:id/cost', auth, h(async (req, res) => res.json(await productService.cost(req.params.id, req.user))));
router.post('/products', auth, rbac('ADMIN'), validateBody('products'), h(async (req, res) => res.status(201).json(await productService.create(req.body, req.user))));
router.put('/products/:id', auth, rbac('ADMIN'), validateBody('products', { partial: true }), h(async (req, res) => res.json(await productService.update(req.params.id, req.body, req.user))));
router.delete('/products/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await productService.remove(req.params.id, req.user))));

/* ─────────────────── GOODS / INVENTORY ─────────────────── */
router.get('/goods', auth, h(async (req, res) => res.json(await goodsService.list(req.query, req.user))));
router.get('/goods/alerts/low-stock', auth, h(async (req, res) => res.json(await goodsService.lowStock(req.user))));
router.get('/goods/valuation', auth, rbac('ADMIN'), h(async (req, res) => res.json(await goodsService.valuation(req.user))));
router.get('/goods/:id', auth, h(async (req, res) => res.json(await goodsService.get(req.params.id, req.user))));
router.post('/goods', auth, rbac('ADMIN'), validateBody('goods'), h(async (req, res) => res.status(201).json(await goodsService.create(req.body, req.user))));
router.put('/goods/:id', auth, rbac('ADMIN'), validateBody('goods', { partial: true }), h(async (req, res) => res.json(await goodsService.update(req.params.id, req.body, req.user))));
router.post('/goods/:id/purchase', auth, rbac('ADMIN'), h(async (req, res) => res.json(await goodsService.purchase(req.params.id, req.body, req.user))));
router.delete('/goods/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await goodsService.remove(req.params.id, req.user))));

/* ──────────────── GOODS CHECK / WASTE ──────────────────── */
router.get('/goods-checks', auth, rbac('ADMIN'), h(async (req, res) => res.json(await goodsCheckService.list(req.query, req.user))));
router.post('/goods-checks', auth, rbac('ADMIN'), h(async (req, res) => res.status(201).json(await goodsCheckService.create(req.body, req.user))));
router.get('/goods-checks/reports/waste', auth, rbac('ADMIN'), h(async (req, res) => res.json(await goodsCheckService.wasteReport(req.query, req.user))));

/* ───────────────────────── ORDERS ──────────────────────── */
router.get('/orders', auth, h(async (req, res) => res.json(await orderService.list(req.query, req.user))));
router.get('/orders/:id', auth, h(async (req, res) => res.json(await orderService.get(req.params.id, req.user))));
router.post('/orders', auth, validateBody('orders'), h(async (req, res) => res.status(201).json(await orderService.create(req.body, req.user))));
router.put('/orders/:id', auth, h(async (req, res) => res.json(await orderService.update(req.params.id, req.body, req.user))));
router.patch('/orders/:id/cancel', auth, h(async (req, res) => res.json(await orderService.cancel(req.params.id, req.user))));
router.patch('/orders/:id/status', auth, h(async (req, res) => res.json(await orderService.setStatus(req.params.id, req.body.status, req.user))));
router.get('/orders/:id/invoice.pdf', auth, h(async (req, res) => {
  const order = await orderService.get(req.params.id, req.user);
  const settings = (await repo('settings').getAll())[0] || {};
  const { renderInvoicePdf, renderInvoicePdfAr } = await import('../utils/pdf.js');
  const pdf = req.query.lang === 'ar' ? await renderInvoicePdfAr(order, settings) : await renderInvoicePdf(order, settings);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(`${order.invoiceNo || order.id}.pdf`) });
  res.send(pdf);
}));

/* ───────────────────────── FINANCE ─────────────────────── */
router.get('/finance/income', auth, rbac('ADMIN'), h(async (req, res) => res.json(await financeService.income(req.query, req.user))));
router.get('/finance/expenses', auth, rbac('ADMIN'), h(async (req, res) => res.json(await financeService.expenses(req.query, req.user))));
router.get('/finance/profit', auth, rbac('ADMIN'), h(async (req, res) => res.json(await financeService.profit(req.query, req.user))));
router.get('/finance/cashflow', auth, rbac('ADMIN'), h(async (req, res) => res.json(await financeService.cashflow(req.query, req.user))));
const expenseSvc = createCrudService('expenses', { entityName: 'expense' });
router.post('/expenses', auth, rbac('ADMIN'), validateBody('expenses'), h(async (req, res) => res.status(201).json(await expenseSvc.create(req.body, req.user))));

/* ──────────────── SALARIES (admin) ─────────────────────── */
router.get('/salaries', auth, rbac('ADMIN'), h(async (req, res) => res.json(await salaryService.list(req.query, req.user))));
router.get('/salaries/preview', auth, rbac('ADMIN'), h(async (req, res) => res.json(await salaryService.preview(req.query, req.user))));
router.post('/salaries/generate', auth, rbac('ADMIN'), h(async (req, res) => res.json(await salaryService.generate(req.body, req.user))));
router.post('/salaries/run', auth, rbac('ADMIN'), h(async (req, res) => res.json(await salaryService.runMonthly(req.body, req.user))));
router.patch('/salaries/:id/adjust', auth, rbac('ADMIN'), h(async (req, res) => res.json(await salaryService.adjust(req.params.id, req.body, req.user))));
router.patch('/salaries/:id/pay', auth, rbac('ADMIN'), h(async (req, res) => res.json(await salaryService.markPaid(req.params.id, req.user))));

/* ──────────────────── PETTY CASH ──────────────────────── */
const pettyCashSvc = createCrudService('expenses', { entityName: 'petty_cash' });
// Petty cash shares the `expenses` collection, so list only the petty-cash rows.
router.get('/petty-cash', auth, h(async (req, res) => res.json(await pettyCashSvc.list({ ...req.query, type: 'petty_cash' }, req.user))));
router.post('/petty-cash', auth, (req, res, next) => {
  // Stamp type/paidBy before validation so validateBody sees a complete expense.
  req.body = { ...req.body, type: 'petty_cash', paidBy: req.body.paidBy || req.user?.name || req.user?.uid || req.user?.id };
  next();
}, validateBody('expenses'), h(async (req, res) => res.status(201).json(await pettyCashSvc.create(req.body, req.user))));
router.patch('/petty-cash/:id', auth, rbac('ADMIN'), validateBody('expenses', { partial: true }), h(async (req, res) => res.json(await pettyCashSvc.update(req.params.id, req.body, req.user))));
router.delete('/petty-cash/:id', auth, rbac('ADMIN'), h(async (req, res) => { await pettyCashSvc.remove(req.params.id, req.user); res.status(204).end(); }));

/* ──────────────────────── RENTS ────────────────────────── */
const rentsSvc = createCrudService('rents', { entityName: 'rent' });
router.get('/rents', auth, h(async (req, res) => res.json(await rentsSvc.list(req.query, req.user))));
router.post('/rents', auth, rbac('ADMIN'), validateBody('rents'), h(async (req, res) => {
  return res.status(201).json(await rentsSvc.create(req.body, req.user));
}));
router.patch('/rents/:id', auth, rbac('ADMIN'), validateBody('rents', { partial: true }), h(async (req, res) => res.json(await rentsSvc.update(req.params.id, req.body, req.user))));
router.delete('/rents/:id', auth, rbac('ADMIN'), h(async (req, res) => { await rentsSvc.remove(req.params.id, req.user); res.status(204).end(); }));
router.patch('/rents/:id/pay', auth, rbac('ADMIN'), h(async (req, res) => {
  const { paymentMethod = 'cash', receiptUrl } = req.body;
  return res.json(await rentsSvc.update(req.params.id, { status: 'paid', paidDate: new Date().toISOString(), paymentMethod, receiptUrl }, req.user));
}));
router.get('/rents/upcoming', auth, h(async (req, res) => {
  const rents = await rentsSvc.list({ status: ['upcoming', 'overdue'] }, req.user);
  const now = Date.now();
  const upcoming = rents.filter(r => new Date(r.dueDate).getTime() < now + 30 * 24 * 60 * 60 * 1000);
  return res.json(upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
}));

/* ──────────────────── CASH ADVANCES ───────────────────── */
router.get('/cash-advances', auth, h(async (req, res) => res.json(await cashAdvanceService.list(req.query, req.user))));
router.post('/cash-advances', auth, validateBody('cashAdvances'), h(async (req, res) => res.status(201).json(await cashAdvanceService.create(req.body, req.user))));
router.patch('/cash-advances/:id', auth, validateBody('cashAdvances', { partial: true }), h(async (req, res) => res.json(await cashAdvanceService.update(req.params.id, req.body, req.user))));
router.delete('/cash-advances/:id', auth, h(async (req, res) => { await cashAdvanceService.remove(req.params.id, req.user); res.status(204).end(); }));
router.get('/cash-advances/pending/:workerId', auth, h(async (req, res) => res.json(await cashAdvanceService.getPendingByWorker(req.params.workerId, req.user))));

/* ──────────────────── SUPPLIERS ───────────────────── */
router.get('/suppliers', auth, h(async (req, res) => res.json(await supplierService.list(req.query, req.user))));
router.post('/suppliers', auth, rbac('ADMIN'), validateBody('suppliers'), h(async (req, res) => res.status(201).json(await supplierService.create(req.body, req.user))));
router.get('/suppliers/:id', auth, h(async (req, res) => res.json(await supplierService.get(req.params.id, req.user))));
router.put('/suppliers/:id', auth, rbac('ADMIN'), validateBody('suppliers'), h(async (req, res) => res.json(await supplierService.update(req.params.id, req.body, req.user))));
router.delete('/suppliers/:id', auth, rbac('ADMIN'), h(async (req, res) => { await supplierService.remove(req.params.id, req.user); res.status(204).end(); }));

/* ──────────────────────── ANALYTICS ────────────────────── */
router.get('/analytics/dashboard', auth, rbac('ADMIN'), h(async (req, res) => res.json(await analyticsService.dashboard(req.user))));
router.get('/analytics/sales', auth, rbac('ADMIN'), h(async (req, res) => res.json(await analyticsService.sales(req.user))));
router.get('/analytics/inventory', auth, rbac('ADMIN'), h(async (req, res) => res.json(await analyticsService.inventory(req.user))));
router.get('/analytics/workers', auth, rbac('ADMIN'), h(async (req, res) => res.json(await analyticsService.workers(req.user))));
router.get('/analytics/customers', auth, rbac('ADMIN'), h(async (req, res) => res.json(await analyticsService.customers(req.user))));
router.get('/analytics/locations', auth, rbac('ADMIN'), h(async (req, res) => res.json(await analyticsService.byLocation(req.query, req.user))));

/* ──────────────────────── REPORTS ──────────────────────── */
router.get('/reports', auth, rbac('ADMIN'), (req, res) => res.json({ types: reportService.types(), bundles: reportService.bundles() }));
// Combined multi-section bundles (must be declared before the generic :type routes).
router.get('/reports/bundle/:name.pdf', auth, rbac('ADMIN'), h(async (req, res) => {
  const { buffer, filename } = await reportService.bundlePdf(req.params.name, req.query, req.user);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(filename || `${req.params.name}-report.pdf`) });
  res.send(buffer);
}));
router.get('/reports/bundle/:name.xlsx', auth, rbac('ADMIN'), h(async (req, res) => {
  const { buffer, filename } = await reportService.bundleXlsx(req.params.name, req.query, req.user);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': contentDisposition(filename || `${req.params.name}-report.xlsx`, 'attachment') });
  res.send(buffer);
}));
router.get('/reports/:type.pdf', auth, rbac('ADMIN'), h(async (req, res) => {
  const { buffer, filename } = await reportService.pdf(req.params.type, req.query, req.user);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(filename || `${req.params.type}.pdf`) });
  res.send(buffer);
}));
router.get('/reports/:type.xlsx', auth, rbac('ADMIN'), h(async (req, res) => {
  const { buffer, filename } = await reportService.xlsx(req.params.type, req.query, req.user);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': contentDisposition(filename || `${req.params.type}.xlsx`, 'attachment') });
  res.send(buffer);
}));

/* ──────────────────────── IMPORT ───────────────────────── */
router.post('/import/:entity/validate', auth, rbac('ADMIN'), upload.single('file'), h(async (req, res) => res.json(await importService.validateFile(req.params.entity, req.file.buffer))));
router.post('/import/:entity', auth, rbac('ADMIN'), upload.single('file'), h(async (req, res) => res.json(await importService.importFile(req.params.entity, req.file.buffer, req.user))));

/* ────────────────────── RESERVATIONS ───────────────────── */
router.get('/reservations', auth, h(async (req, res) => res.json(await reservationService.list(req.query, req.user))));
router.get('/reservations/calendar', auth, h(async (req, res) => res.json(await reservationService.calendar(req.query, req.user))));
router.post('/reservations', auth, validateBody('reservations'), h(async (req, res) => res.status(201).json(await reservationService.create(req.body, req.user))));
router.put('/reservations/:id', auth, h(async (req, res) => res.json(await reservationService.update(req.params.id, req.body, req.user))));
router.patch('/reservations/:id/no-show', auth, h(async (req, res) => res.json(await reservationService.markNoShow(req.params.id, req.user))));

/* ─────────────────────────── KDS ───────────────────────── */
router.get('/kds/tickets', auth, h(async (req, res) => res.json(await kdsService.tickets(req.user))));
router.patch('/kds/tickets/:id/status', auth, h(async (req, res) => res.json(await kdsService.setStatus(req.params.id, req.body.status, req.user))));

/* ──────────────────────── LOYALTY ──────────────────────── */
router.get('/loyalty/:clientId', auth, h(async (req, res) => res.json(await loyaltyService.get(req.params.clientId, req.user))));
router.post('/loyalty/:clientId/redeem', auth, h(async (req, res) => res.json(await loyaltyService.redeem(req.params.clientId, Number(req.body.points), req.user))));

/* ──────────────────── SCHEDULING / SHIFTS ──────────────── */
router.get('/shifts', auth, rbac('ADMIN'), h(async (req, res) => res.json(await shiftService.list(req.query, req.user))));
router.get('/shifts/weekly', auth, rbac('ADMIN'), h(async (req, res) => res.json(await shiftService.weekly(req.user))));
router.get('/shifts/forecast', auth, rbac('ADMIN'), h(async (req, res) => res.json(await shiftService.forecast(req.user))));
router.post('/shifts', auth, rbac('ADMIN'), validateBody('shifts'), h(async (req, res) => res.status(201).json(await shiftService.create(req.body, req.user))));
router.put('/shifts/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await shiftService.update(req.params.id, req.body, req.user))));
router.delete('/shifts/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await shiftService.remove(req.params.id, req.user))));

/* ──────────────── CASHIER CASH-DRAWER SHIFTS ───────────── */
// Cashier-operated: open a till, reconcile counted vs expected cash, hand over to next cashier.
router.get('/cashier-shifts/current', auth, rbac('CASHIER'), h(async (req, res) => res.json(await cashierShiftService.current(req.user))));
router.get('/cashier-shifts', auth, rbac('CASHIER'), h(async (req, res) => res.json(await cashierShiftService.list(req.query, req.user))));
router.post('/cashier-shifts/open', auth, rbac('CASHIER'), h(async (req, res) => res.status(201).json(await cashierShiftService.open(req.user, req.body))));
router.post('/cashier-shifts/:id/close', auth, rbac('CASHIER'), h(async (req, res) => res.json(await cashierShiftService.close(req.params.id, req.user, req.body))));

/* ──────────────────────── LOCATIONS ────────────────────── */
// Admin-managed governorates + areas used for customer profiling & profit-by-area.
router.get('/locations', auth, h(async (req, res) => res.json(await locationService.list(req.query, req.user))));
router.get('/locations/tree', auth, h(async (req, res) => res.json(await locationService.tree(req.user))));
router.post('/locations', auth, rbac('ADMIN'), validateBody('locations'), h(async (req, res) => res.status(201).json(await locationService.create(req.body, req.user))));
router.delete('/locations/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await locationService.remove(req.params.id, req.user))));

/* ──────────────────────── AUDIT LOGS ───────────────────── */
router.get('/audit-logs', auth, rbac('ADMIN'), h(async (req, res) => {
  const logs = await auditService.listByRestaurant(req.user.restaurantId);
  res.json(logs.slice(0, 500));
}));

/* ──────────────────────── SETTINGS ─────────────────────── */
router.get('/settings', auth, h(async (req, res) => res.json(await settingsService.get(req.user))));
router.put('/settings', auth, rbac('ADMIN'), h(async (req, res) => {
  const current = (await repo('settings').getAll({ restaurantId: req.user?.restaurantId }))[0];
  const saved = current ? await repo('settings').update(current.id, { ...req.body, restaurantId: req.user?.restaurantId }) : await repo('settings').create({ ...req.body, restaurantId: req.user?.restaurantId });
  res.json(saved);
}));

/* ──────────────────── COMPLAINTS ───────────────────── */
const complaintsService = createCrudService('complaints', { entityName: 'complaint' });
router.get('/complaints', auth, h(async (req, res) => res.json(await complaintsService.list(req.query, req.user))));
router.get('/complaints/:id', auth, h(async (req, res) => res.json(await complaintsService.get(req.params.id, req.user))));
router.post('/complaints', auth, rbac('ADMIN'), validateBody('complaints'), h(async (req, res) => res.status(201).json(await complaintsService.create(req.body, req.user))));
router.put('/complaints/:id', auth, rbac('ADMIN'), validateBody('complaints', { partial: true }), h(async (req, res) => res.json(await complaintsService.update(req.params.id, req.body, req.user))));
router.delete('/complaints/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await complaintsService.remove(req.params.id, req.user))));

/* ───────────────────────── SYNC ────────────────────────── */
router.get('/sync/status', auth, (req, res) => res.json(syncEngine.status()));
router.post('/sync/flush', auth, rbac('ADMIN'), h(async (req, res) => res.json(await syncEngine.flush())));

export default router;
