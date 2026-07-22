import { Router } from 'express';
import { auth, requireDeviceBound } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authService } from '../services/authService.js';
import { licenseService } from '../services/licenseService.js';
import { deviceService } from '../services/deviceService.js';
import { auditService } from '../services/auditService.js';
import { buildFingerprint } from '../utils/device.js';
import { getPublicKeySpkiBase64 } from '../utils/offlineLicenseCrypto.js';

const router = Router();
const h = asyncHandler;

// Unauthenticated by design — it's a public key, safe to expose. The frontend
// fetches it to verify offline-license signatures via Web Crypto.
router.get('/public-key', (req, res) => {
  res.json({ publicKey: getPublicKeySpkiBase64(), algorithm: 'ECDSA-P256-SHA256' });
});

router.post('/activate', h(async (req, res) => {
  const { username, password, token, deviceName, operatingSystem } = req.body;
  const fingerprint = req.headers['x-device-fingerprint'] || req.body.fingerprint || buildFingerprint(req);
  const result = await authService.activateRestaurantLicense({
    username,
    password,
    token,
    fingerprint,
    deviceName,
    operatingSystem,
    ipAddress: req.ip,
  });
  res.json(result);
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
