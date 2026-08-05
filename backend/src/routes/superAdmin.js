import { Router } from 'express';
import { auth, requireDeviceBound } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { superAdminService } from '../services/superAdminService.js';
import { licenseService } from '../services/licenseService.js';
import { deviceService } from '../services/deviceService.js';
import { hardwareBindingService } from '../services/hardwareBindingService.js';
import { sessionService } from '../services/sessionService.js';

const router = Router();
const h = asyncHandler;

router.use(auth);
router.use(requireSuperAdmin);

/* ───────────── RESTAURANTS ───────────── */
router.get('/restaurants', h(async (req, res) => res.json(await superAdminService.listRestaurants())));
router.post('/restaurants', h(async (req, res) => {
  const { restaurantName, adminUsername, adminPassword, license } = req.body;
  const result = await superAdminService.createRestaurant({
    restaurantName,
    adminUsername,
    adminPassword,
    licenseOverrides: license,
  });
  res.status(201).json({
    restaurant: result.restaurant,
    admin: { ...result.admin, password: undefined },
    license: { ...result.license, activationTokenEncrypted: undefined },
    activationToken: result.activationToken,
  });
}));
router.get('/restaurants/:id', h(async (req, res) => res.json(await superAdminService.getRestaurant(req.params.id))));
router.put('/restaurants/:id', h(async (req, res) => res.json(await superAdminService.updateRestaurant(req.params.id, req.body))));
router.patch('/restaurants/:id/suspend', h(async (req, res) => res.json(await superAdminService.suspendRestaurant(req.params.id))));
router.delete('/restaurants/:id', h(async (req, res) => { await superAdminService.deleteRestaurant(req.params.id); res.status(204).end(); }));

/* ───────────── RESTAURANT USERS ───────────── */
router.get('/restaurants/:id/users', h(async (req, res) => res.json(await superAdminService.listRestaurantUsers(req.params.id))));
router.post('/restaurants/:id/users', h(async (req, res) => {
  const user = await superAdminService.createRestaurantUser(req.params.id, req.body);
  res.status(201).json({ ...user, passwordHash: undefined });
}));
router.patch('/users/:userId', h(async (req, res) => {
  const user = await superAdminService.updateRestaurantUser(req.params.userId, req.body);
  res.json({ ...user, passwordHash: undefined });
}));
router.patch('/users/:userId/suspend', h(async (req, res) => res.json(await superAdminService.suspendRestaurantUser(req.params.userId))));
router.patch('/users/:userId/activate', h(async (req, res) => res.json(await superAdminService.activateRestaurantUser(req.params.userId))));
router.delete('/users/:userId', h(async (req, res) => { await superAdminService.deleteRestaurantUser(req.params.userId); res.status(204).end(); }));
router.get('/users/:userId/devices', h(async (req, res) => res.json(await deviceService.listByUser(req.params.userId))));

/* ───────────── LICENSES ───────────── */
router.get('/licenses/:restaurantId', h(async (req, res) => {
  const license = await superAdminService.getLicenseByRestaurant(req.params.restaurantId);
  // No plaintext token here — unlike the old design, the plaintext is never
  // stored anywhere after issuance (see licenseService.issueActivationToken),
  // so there is nothing left to read back. Status only (issued/expires/used).
  const activationTokenStatus = await licenseService.getActivationTokenStatus(req.params.restaurantId);
  res.json({ ...license, activationTokenStatus });
}));
router.post('/licenses/:restaurantId/regenerate-token', h(async (req, res) => {
  const { token, expiresAt } = await licenseService.regenerateActivationToken(req.params.restaurantId, {
    ttlHours: req.body?.ttlHours,
    issuedBy: req.user?.sub || req.user?.username || null,
  });
  // The ONLY moment this plaintext ever exists again after issuance — shown
  // once in the Super Admin UI, exactly like a device secret.
  res.json({ activationToken: token, expiresAt });
}));
router.post('/licenses/:restaurantId/renew', h(async (req, res) => res.json(await licenseService.renewLicense(req.params.restaurantId, req.body.days))));
router.post('/licenses/:restaurantId/extend', h(async (req, res) => res.json(await licenseService.extendLicense(req.params.restaurantId, req.body.days))));
router.post('/licenses/:restaurantId/reduce', h(async (req, res) => res.json(await licenseService.reduceLicenseDuration(req.params.restaurantId, req.body.days))));
router.patch('/licenses/:restaurantId/suspend', h(async (req, res) => res.json(await licenseService.suspendLicense(req.params.restaurantId))));
router.patch('/licenses/:restaurantId/revoke', h(async (req, res) => res.json(await licenseService.revokeLicense(req.params.restaurantId))));
router.post('/licenses/:restaurantId/set-forever', h(async (req, res) => res.json(await licenseService.setLicenseForever(req.params.restaurantId))));
router.patch('/licenses/:restaurantId/max-devices', h(async (req, res) => res.json(await licenseService.changeMaximumDevices(req.params.restaurantId, req.body.count))));
router.patch('/licenses/:restaurantId/max-concurrent-cashiers', h(async (req, res) => res.json(await licenseService.changeMaxConcurrentCashierSessions(req.params.restaurantId, req.body.count))));

/* ───────────── HARDWARE BINDINGS ─────────────
 * Per product decision, hardware matching is EXACT — any change (disk swap,
 * motherboard replacement, firmware rewriting SMBIOS) flips a binding to
 * 'pending_reset' rather than silently re-binding. This is the queue an
 * operator works from to tell a routine repair apart from a possible clone:
 * changedComponents ["disk"] alone reads very differently from
 * ["board","systemUuid","cpu"] all changing at once. */
router.get('/hardware-resets', h(async (req, res) => {
  const restaurants = await superAdminService.listRestaurants();
  const results = [];
  for (const r of restaurants) {
    const pending = await hardwareBindingService.listPendingReset(r.id);
    for (const p of pending) results.push({ ...p, restaurantName: r.restaurantName });
  }
  res.json(results);
}));
router.post('/restaurants/:id/devices/:deviceId/approve-hardware-reset', h(async (req, res) => {
  res.json(await hardwareBindingService.approveReset(req.params.id, req.params.deviceId));
}));

/* ───────────── DEVICES ───────────── */
router.get('/restaurants/:id/devices', h(async (req, res) => res.json(await deviceService.listByRestaurant(req.params.id))));
router.delete('/devices/:deviceId', h(async (req, res) => {
  const device = await deviceService.getDevice(req.params.deviceId);
  if (!device) throw new HttpError(404, 'Device not found');
  res.json(await deviceService.deleteDevice(req.params.deviceId, device.restaurantId));
}));
router.patch('/devices/:deviceId/reset', h(async (req, res) => {
  const device = await deviceService.getDevice(req.params.deviceId);
  if (!device) throw new HttpError(404, 'Device not found');
  res.json(await deviceService.resetDevice(req.params.deviceId, device.restaurantId));
}));

/* ───────────── MONITORING ───────────── */
router.get('/sessions', h(async (req, res) => res.json(await sessionService.list())));
router.get('/restaurants/:id/sessions', h(async (req, res) => res.json(await sessionService.listByRestaurant(req.params.id))));
router.get('/restaurants/:id/sessions/active', h(async (req, res) => res.json(await sessionService.list({ restaurantId: req.params.id, status: 'active' }))));
router.patch('/sessions/:sessionId/terminate', h(async (req, res) => res.json(await sessionService.terminateSession(req.params.sessionId))));
router.post('/restaurants/:id/force-logout-cashiers', h(async (req, res) => res.json(await sessionService.terminateAllCashierSessions(req.params.id))));

export default router;
