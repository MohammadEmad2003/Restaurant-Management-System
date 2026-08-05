import { Router } from 'express';
import { auth, requireDeviceBound } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { authService } from '../services/authService.js';
import { licenseService } from '../services/licenseService.js';
import { deviceService } from '../services/deviceService.js';
import { hardwareBindingService } from '../services/hardwareBindingService.js';
import { buildFingerprint } from '../utils/device.js';
import { getPublicKeySpkiBase64 } from '../utils/offlineLicenseCrypto.js';
import { config } from '../config/index.js';

const router = Router();
const h = asyncHandler;

// Unauthenticated by design — it's a public key, safe to expose. The frontend
// fetches it to verify offline-license signatures via Web Crypto.
router.get('/public-key', (req, res) => {
  res.json({ publicKey: getPublicKeySpkiBase64(), algorithm: 'ECDSA-P256-SHA256' });
});

// Same protection as /auth/login and /auth/login/superadmin — without it,
// an attacker who knows/guesses a restaurant admin's username could hammer
// this route with unlimited attempts to brute-force the password and/or the
// activation token, with no lockout or throttling at all.
router.post('/activate', authRateLimit(), h(async (req, res) => {
  const { username, password, token, deviceName, operatingSystem, hardwareComponents } = req.body;
  const fingerprint = req.headers['x-device-fingerprint'] || req.body.fingerprint || buildFingerprint(req);
  const result = await authService.activateRestaurantLicense({
    username,
    password,
    token,
    fingerprint,
    deviceName,
    operatingSystem,
    hardwareComponents,
    ipAddress: req.ip,
  });
  res.json(result);
}));

/**
 * Central-authority-only: verifies (username+password, independently of
 * whatever a caller already checked locally) + redeems the activation token
 * + binds/verifies hardware — see config.isLicenseAuthority's own comment
 * for why this exact split exists. A non-authority instance has no
 * meaningful implementation of this (it would just be re-proxying to
 * itself), so it's a plain 404 there rather than silently no-op-ing.
 */
router.post('/authority/activate', authRateLimit(), h(async (req, res) => {
  if (!config.isLicenseAuthority) throw new HttpError(404, 'Not available on this instance');
  const { username, password, token } = req.body;
  const result = await authService.activateLicenseCentrally({ username, password, token });
  res.json(result);
}));

/**
 * Central-authority-only: binds (first contact) or verifies (every contact
 * after) ONE specific device's hardware identity. Kept separate from
 * /authority/activate because binding is inherently per-device — a
 * restaurant can run several devices under one license (maximumDevices
 * defaults to 2), so it can only happen once a real device id exists, i.e.
 * after the caller's own local login/registration has already run.
 */
router.post('/authority/bind-hardware', authRateLimit(), h(async (req, res) => {
  if (!config.isLicenseAuthority) throw new HttpError(404, 'Not available on this instance');
  const { restaurantId, deviceId, hardwareComponents } = req.body;
  if (!restaurantId || !deviceId || !hardwareComponents) {
    throw new HttpError(400, 'restaurantId, deviceId and hardwareComponents are required');
  }
  const binding = await hardwareBindingService.verifyOrBind({ restaurantId, deviceId, components: hardwareComponents });
  res.json({ ok: true, status: binding.status });
}));

/**
 * Central-authority-only: an already-authenticated device's periodic
 * (online-heartbeat-driven) hardware re-check. Per product decision,
 * matching is EXACT — any mismatch is reported as a 409 with which
 * component(s) changed (never the raw serials) rather than silently
 * re-binding, so the caller (the device's own local backend) can react by
 * suspending itself locally pending a Super Admin-approved reset.
 */
router.post('/authority/revalidate', authRateLimit(), h(async (req, res) => {
  if (!config.isLicenseAuthority) throw new HttpError(404, 'Not available on this instance');
  const { restaurantId, deviceId, hardwareComponents } = req.body;
  if (!restaurantId || !deviceId || !hardwareComponents) {
    throw new HttpError(400, 'restaurantId, deviceId and hardwareComponents are required');
  }
  await hardwareBindingService.verifyOrBind({ restaurantId, deviceId, components: hardwareComponents });
  res.json({ ok: true });
}));

router.get('/status', auth, requireDeviceBound, h(async (req, res) => {
  const license = await licenseService.getLicenseByRestaurant(req.user.restaurantId);
  res.json({
    status: license.status,
    expirationDate: license.expirationDate,
    validationIntervalHours: license.validationIntervalHours,
    maximumDevices: license.maximumDevices,
    activeDevices: license.activeDevices,
    offlineDays: license.offlineDays,
  });
}));

router.get('/my-devices', auth, requireDeviceBound, h(async (req, res) => {
  const devices = await deviceService.listByRestaurant(req.user.restaurantId);
  res.json(devices);
}));

router.delete('/my-devices/:deviceId', auth, requireDeviceBound, rbac('ADMIN'), h(async (req, res) => {
  res.json(await deviceService.deleteDevice(req.params.deviceId, req.user.restaurantId));
}));

export default router;
