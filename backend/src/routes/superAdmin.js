import { Router } from 'express';
import { auth, requireDeviceBound } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/rbac.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { superAdminService } from '../services/superAdminService.js';
import { licenseService } from '../services/licenseService.js';
import { deviceService } from '../services/deviceService.js';
import { sessionService } from '../services/sessionService.js';
import { auditService } from '../services/auditService.js';
import { auditMiddleware } from '../middleware/audit.js';

const router = Router();
const h = asyncHandler;

router.use(auth);
router.use(requireSuperAdmin);
router.use(auditMiddleware);

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
router.delete('/users/:userId', h(async (req, res) => { await superAdminService.deleteRestaurantUser(req.params.userId); res.status(204).end(); }));

/* ───────────── LICENSES ───────────── */
router.get('/licenses/:restaurantId', h(async (req, res) => {
  const license = await superAdminService.getLicenseByRestaurant(req.params.restaurantId);
  const token = await licenseService.getActivationToken(req.params.restaurantId);
  res.json({ ...license, activationToken: token });
}));
router.post('/licenses/:restaurantId/regenerate-token', h(async (req, res) => {
  const { token } = await licenseService.regenerateActivationToken(req.params.restaurantId);
  res.json({ activationToken: token });
}));
router.post('/licenses/:restaurantId/renew', h(async (req, res) => res.json(await licenseService.renewLicense(req.params.restaurantId, req.body.days))));
router.post('/licenses/:restaurantId/extend', h(async (req, res) => res.json(await licenseService.extendLicense(req.params.restaurantId, req.body.days))));
router.post('/licenses/:restaurantId/reduce', h(async (req, res) => res.json(await licenseService.reduceLicenseDuration(req.params.restaurantId, req.body.days))));
router.patch('/licenses/:restaurantId/suspend', h(async (req, res) => res.json(await licenseService.suspendLicense(req.params.restaurantId))));
router.patch('/licenses/:restaurantId/revoke', h(async (req, res) => res.json(await licenseService.revokeLicense(req.params.restaurantId))));
router.patch('/licenses/:restaurantId/offline-days', h(async (req, res) => res.json(await licenseService.changeOfflineDays(req.params.restaurantId, req.body.days))));
router.patch('/licenses/:restaurantId/max-devices', h(async (req, res) => res.json(await licenseService.changeMaximumDevices(req.params.restaurantId, req.body.count))));
router.patch('/licenses/:restaurantId/validation-interval', h(async (req, res) => res.json(await licenseService.changeValidationInterval(req.params.restaurantId, req.body.hours))));

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
router.get('/audit-logs', h(async (req, res) => res.json(await auditService.list(req.query))));
router.get('/restaurants/:id/audit-logs', h(async (req, res) => res.json(await auditService.listByRestaurant(req.params.id))));

export default router;
