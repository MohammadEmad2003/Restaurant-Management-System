import { Router } from 'express';
import multer from 'multer';

import { auth, requireDeviceBound, requireActiveLicense } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { rbac } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authRateLimit } from '../middleware/rateLimit.js';

import { authService } from '../services/authService.js';
import { sessionService } from '../services/sessionService.js';
import { deviceService } from '../services/deviceService.js';
import { licenseService } from '../services/licenseService.js';
import { buildFingerprint } from '../utils/device.js';
import { connectivity } from '../sync/connectivity.js';
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
import { deliveryAgentService } from '../services/deliveryAgentService.js';
import { pettyCashService } from '../services/pettyCashService.js';
import { rentService } from '../services/rentService.js';
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
    // Raw header, not the client-reported deviceName/operatingSystem, since
    // those are spoofable — the device-type restriction relies on this.
    userAgent: req.headers['user-agent'],
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
// Keeps a session's lastSeenAt fresh so sessionSweep doesn't release its
// concurrent-cashier-session slot while the client is still actively in use.
// Also re-validates the device online and refreshes its offline license, so a
// long-lived session's rolling-validation window keeps rolling forward instead
// of only refreshing at the (rare) next full login.
// requireDeviceBound is essential here, not just auth: without it, a device
// that's been revoked or a session that's been terminated by a Super Admin
// could keep calling this endpoint forever with its still-cryptographically-
// valid old JWT, and keep receiving a freshly-signed offline license that
// extends its own rolling-validation/monthly-deadline windows — completely
// undermining the revocation. requireDeviceBound already no-ops for
// type:'super_admin' tokens, so this is safe for both token kinds.
router.post('/auth/heartbeat', auth, requireDeviceBound, requireActiveLicense, h(async (req, res) => {
  if (req.user?.jti) await sessionService.heartbeat(req.user.jti);

  let offlineLicense = null;
  if (req.user?.type === 'user' && req.user.deviceId && req.user.restaurantId) {
    // Only a genuinely online heartbeat counts toward the monthly
    // online-validation requirement — see deviceService.updateValidationTimestamp.
    const device = await deviceService.updateValidationTimestamp(req.user.deviceId, { online: connectivity.isOnline });
    const license = await licenseService.getLicenseByRestaurant(req.user.restaurantId);
    if (license) {
      offlineLicense = authService.generateOfflineLicense({
        restaurantId: req.user.restaurantId,
        licenseId: license.id,
        deviceId: req.user.deviceId,
        fingerprint: req.user.fingerprint,
        expirationDate: license.expirationDate,
        offlineDays: license.offlineDays,
        validationIntervalHours: license.validationIntervalHours,
        monthlyValidationDeadline: authService.computeMonthlyValidationDeadline(device?.lastOnlineValidationAt),
      });
    }
  }
  res.json({ ok: true, offlineLicense });
}));

/* ───────────── SUPER ADMIN & LICENSE MOUNTS ───────────── */
router.use('/superadmin', superAdminRoutes);
router.use('/license', licenseRoutes);

// All remaining restaurant routes require a device-bound token AND an
// active (non-expired/revoked/suspended) license, re-checked on every
// single request — not just at login (see requireActiveLicense's own
// comment in middleware/auth.js for why this matters).
router.use(auth, requireDeviceBound, requireActiveLicense);

/* ──────────────────────── WORKERS ──────────────────────── */
router.get('/workers', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.list(req.query, req.user))));
// Cashier-only minimal list (id + name) — accessible to cashiers for shift handover.
// Declared BEFORE '/workers/:id' so ":id" doesn't capture "cashiers".
router.get('/workers/cashiers', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await workerService.cashiers(req.user))));
// Minimal roster (id + name only, no salary) for both roles — e.g. the Cash
// Advance form's worker picker, which a Cashier must be able to use without
// ever receiving salary data over the wire.
router.get('/workers/roster', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await workerService.roster(req.user))));
router.get('/workers/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.get(req.params.id, req.user))));
// `:id` here is actually a cashierId (users.sub — see workerService.activity,
// which filters orders by cashierId), and Dashboard.jsx uses this for a
// Cashier to see their OWN revenue/orders-created stats — so this can't be
// Admin-only, but a Cashier must not be able to pass an arbitrary OTHER
// cashier's id and see their revenue too.
router.get('/workers/:id/activity', auth, h(async (req, res) => {
  if (req.user?.role?.toUpperCase() !== 'ADMIN' && req.params.id !== req.user?.sub) {
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  }
  res.json(await workerService.activity(req.params.id, req.user));
}));
router.post('/workers', auth, rbac('ADMIN'), validateBody('workers'), h(async (req, res) => res.status(201).json(await workerService.create(req.body, req.user))));
router.put('/workers/:id', auth, rbac('ADMIN'), validateBody('workers', { partial: true }), h(async (req, res) => res.json(await workerService.update(req.params.id, req.body, req.user))));
router.patch('/workers/:id/disable', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.disable(req.params.id, req.user))));
router.patch('/workers/:id/reactivate', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.reactivate(req.params.id, req.user))));
router.delete('/workers/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await workerService.remove(req.params.id, req.user))));

/* ─────────────────────── ATTENDANCE ────────────────────── */
// Kiosk: any signed-in device lets a worker clock in/out with their own credentials.
// Rate-limited like /auth/login — any authenticated device (even a
// low-privilege cashier/chef token) could otherwise repeatedly guess other
// workers' username/password pairs against this single kiosk-style route
// with no lockout at all.
router.post('/attendance/check', auth, authRateLimit(), h(async (req, res) => res.json(await attendanceService.markByCredentials(req.body.username, req.body.password, req.user))));
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
router.get('/clients/lookup', auth, h(async (req, res) => res.json(await clientService.lookupByPhone(req.query.phone, req.user))));
router.get('/clients/:id', auth, h(async (req, res) => res.json(await clientService.get(req.params.id, req.user))));
router.get('/clients/:id/history', auth, h(async (req, res) => res.json(await clientService.history(req.params.id, req.user))));
router.post('/clients', auth, validateBody('clients'), h(async (req, res) => res.status(201).json(await clientService.create(req.body, req.user))));
router.put('/clients/:id', auth, validateBody('clients', { partial: true }), h(async (req, res) => res.json(await clientService.update(req.params.id, req.body, req.user))));
router.delete('/clients/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await clientService.remove(req.params.id, req.user))));
router.post('/clients/:id/phones', auth, h(async (req, res) => res.json(await clientService.addPhone(req.params.id, req.body.phone, req.user))));
router.post('/clients/:id/addresses', auth, h(async (req, res) => res.json(await clientService.addAddress(req.params.id, req.body.address, req.user))));

/* ──────────────────── DELIVERY AGENTS ──────────────────── */
router.get('/delivery-agents', auth, h(async (req, res) => res.json(await deliveryAgentService.list(req.query, req.user))));
router.post('/delivery-agents', auth, rbac('ADMIN'), h(async (req, res) => res.status(201).json(await deliveryAgentService.create(req.body, req.user))));
router.put('/delivery-agents/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await deliveryAgentService.update(req.params.id, req.body, req.user))));
router.delete('/delivery-agents/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await deliveryAgentService.remove(req.params.id, req.user))));

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
router.get('/orders/pending-payments', auth, h(async (req, res) => res.json(await orderService.listPendingPayments(req.query, req.user))));
router.patch('/orders/bulk-mark-paid', auth, h(async (req, res) => res.json(await orderService.bulkMarkPaid(req.body, req.user))));
router.get('/orders/:id', auth, h(async (req, res) => res.json(await orderService.get(req.params.id, req.user))));
router.post('/orders', auth, validateBody('orders'), h(async (req, res) => res.status(201).json(await orderService.create(req.body, req.user))));
router.put('/orders/:id', auth, h(async (req, res) => res.json(await orderService.update(req.params.id, req.body, req.user))));
router.patch('/orders/:id/cancel', auth, h(async (req, res) => res.json(await orderService.cancel(req.params.id, req.user))));
router.patch('/orders/:id/status', auth, h(async (req, res) => res.json(await orderService.setStatus(req.params.id, req.body.status, req.user))));
router.patch('/orders/:id/mark-paid', auth, h(async (req, res) => res.json(await orderService.markPaid(req.params.id, req.user))));
router.get('/orders/:id/invoice.pdf', auth, h(async (req, res) => {
  const order = await orderService.get(req.params.id, req.user);
  const settings = (await repo('settings').getAll({ restaurantId: req.user?.restaurantId }))[0] || {};
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
const pettyCashSvc = pettyCashService;
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
const rentsSvc = rentService;
router.get('/rents', auth, h(async (req, res) => res.json(await rentsSvc.list(req.query, req.user))));
router.post('/rents', auth, rbac('ADMIN'), validateBody('rents'), h(async (req, res) => {
  return res.status(201).json(await rentsSvc.create(req.body, req.user));
}));
router.patch('/rents/:id', auth, rbac('ADMIN'), validateBody('rents', { partial: true }), h(async (req, res) => res.json(await rentsSvc.update(req.params.id, req.body, req.user))));
router.delete('/rents/:id', auth, rbac('ADMIN'), h(async (req, res) => { await rentsSvc.remove(req.params.id, req.user); res.status(204).end(); }));
router.patch('/rents/:id/pay', auth, rbac('ADMIN'), h(async (req, res) => {
  return res.json(await rentsSvc.pay(req.params.id, req.body, req.user));
}));
router.patch('/rents/:id/unpay', auth, rbac('ADMIN'), h(async (req, res) => {
  return res.json(await rentsSvc.markUnpaid(req.params.id, req.user));
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
router.patch('/cash-advances/:id/withdraw', auth, h(async (req, res) => res.json(await cashAdvanceService.withdraw(req.params.id, req.user))));
router.patch('/cash-advances/:id/return', auth, h(async (req, res) => res.json(await cashAdvanceService.returnAdvance(req.params.id, req.user))));
router.delete('/cash-advances/:id', auth, rbac('ADMIN'), h(async (req, res) => { await cashAdvanceService.remove(req.params.id, req.user); res.status(204).end(); }));
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
// Cashier-operated, but an Admin can also open/close/hand over a till (e.g.
// covering the till themselves, or initiating a handover) — both roles share
// the exact same flow and endpoints; only ADMIN/CASHIER are meaningful here
// (there is no till for a chef, etc.).
router.get('/cashier-shifts/current', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await cashierShiftService.current(req.user))));
// Restaurant-wide authoritative cash-drawer total — open to any authenticated
// restaurant role (ADMIN and CASHIER both need the same number in POS/Dashboard);
// already scoped to req.user.restaurantId internally, so no cross-tenant exposure.
router.get('/cashier-shifts/current-all', auth, h(async (req, res) => res.json(await cashierShiftService.currentAll(req.user))));
router.get('/cashier-shifts', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await cashierShiftService.list(req.query, req.user))));
router.get('/cashier-shifts/:id/analytics', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await cashierShiftService.shiftAnalytics(req.params.id, req.user))));
router.get('/cashier-shifts/:id/analytics.pdf', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => {
  const { buffer, filename } = await reportService.cashierShiftPdf(req.params.id, req.query, req.user);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(filename || `shift-analytics-${req.params.id}.pdf`) });
  res.send(buffer);
}));
router.post('/cashier-shifts/open', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.status(201).json(await cashierShiftService.open(req.user, req.body))));
router.post('/cashier-shifts/:id/close', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await cashierShiftService.close(req.params.id, req.user, req.body))));
router.patch('/cashier-shifts/:id/reopen', auth, rbac('ADMIN', 'CASHIER'), h(async (req, res) => res.json(await cashierShiftService.reopen(req.params.id, req.user))));

/* ──────────────────────── LOCATIONS ────────────────────── */
// Admin-managed cities + areas used for customer profiling & profit-by-area.
router.get('/locations', auth, h(async (req, res) => res.json(await locationService.list(req.query, req.user))));
router.get('/locations/tree', auth, h(async (req, res) => res.json(await locationService.tree(req.user))));
router.post('/locations', auth, rbac('ADMIN'), validateBody('locations'), h(async (req, res) => res.status(201).json(await locationService.create(req.body, req.user))));
router.delete('/locations/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await locationService.remove(req.params.id, req.user))));

/* ──────────────────────── SETTINGS ─────────────────────── */
router.get('/settings', auth, h(async (req, res) => res.json(await settingsService.get(req.user))));
router.put('/settings', auth, rbac('ADMIN'), h(async (req, res) => res.json(await settingsService.update(req.body, req.user))));

/* ──────────────────── COMPLAINTS ───────────────────── */
const complaintsService = createCrudService('complaints', { entityName: 'complaint' });
router.get('/complaints', auth, h(async (req, res) => res.json(await complaintsService.list(req.query, req.user))));
router.get('/complaints/:id', auth, h(async (req, res) => res.json(await complaintsService.get(req.params.id, req.user))));
// Cashier can file a complaint (e.g. from an order they can see) but never
// edit/resolve/delete one — those stay Admin-only actions.
router.post('/complaints', auth, rbac('ADMIN', 'CASHIER'), validateBody('complaints'), h(async (req, res) => res.status(201).json(await complaintsService.create(req.body, req.user))));
router.put('/complaints/:id', auth, rbac('ADMIN'), validateBody('complaints', { partial: true }), h(async (req, res) => res.json(await complaintsService.update(req.params.id, req.body, req.user))));
router.delete('/complaints/:id', auth, rbac('ADMIN'), h(async (req, res) => res.json(await complaintsService.remove(req.params.id, req.user))));

/* ───────────────────────── SYNC ────────────────────────── */
router.get('/sync/status', auth, (req, res) => res.json(syncEngine.status()));
router.post('/sync/flush', auth, rbac('ADMIN'), h(async (req, res) => res.json(await syncEngine.flush())));

export default router;
