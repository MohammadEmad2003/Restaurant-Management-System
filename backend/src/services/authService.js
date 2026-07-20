import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { secureStore } from '../repositories/secureStore.js';
import { verifyPassword, sanitize } from '../utils/hash.js';
import { config } from '../config/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { PERMISSIONS } from '../config/permissions.js';
import { licenseService } from './licenseService.js';
import { deviceService } from './deviceService.js';
import { sessionService } from './sessionService.js';
import { auditService } from './auditService.js';
import { encrypt, signPayload } from '../utils/crypto.js';
import { buildFingerprint } from '../utils/device.js';

const store = secureStore();

export function signAuthToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.jwtExpiresInHours || 24}h` });
}

export async function verifyAuthToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function normalizeRole(role) {
  return role?.toUpperCase?.();
}

export const authService = {
  async loginRestaurantUser({ username, password, fingerprint, deviceName, operatingSystem, ipAddress }) {
    // Try to identify the restaurant from a previously registered device.
    const allDevices = await store.findAll('devices');
    const knownDevice = allDevices.find((d) => d.fingerprint === fingerprint && d.status === 'active');
    const restaurantIdHint = knownDevice?.restaurantId;

    let users = await store.findAll('users');
    if (restaurantIdHint) {
      users = users.filter((u) => u.restaurantId === restaurantIdHint);
    }

    // Find the user by username. If multiple restaurants share the same username,
    // verify the password against each candidate and pick the matching one.
    const candidates = users.filter((u) => u.username === username);
    let user = null;
    for (const candidate of candidates) {
      const ok = await verifyPassword(password, candidate.passwordHash || '');
      if (ok) { user = candidate; break; }
    }
    if (!user) throw new HttpError(401, 'Invalid credentials');
    if (['inactive', 'suspended'].includes(user.status)) throw new HttpError(403, 'Account disabled');

    const restaurant = await store.findOne('restaurants', { id: user.restaurantId });
    if (!restaurant || restaurant.status === 'suspended') {
      throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    }

    // Load license without validating it yet — admin may need to activate it.
    let license = await licenseService.getLicenseByRestaurant(user.restaurantId);
    if (!license) {
      throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    }

    const role = normalizeRole(user.role);
    const normalizedDeviceName = deviceName || 'Unknown Device';
    const normalizedOS = operatingSystem || 'Unknown';

    // CASHIERs are never allowed to see or enter activation tokens. They are
    // blocked until the admin has activated the restaurant license.
    if (role === 'CASHIER') {
      await licenseService.validateLicense(user.restaurantId); // will throw if invalid
    }

    // ADMIN can log in even when the license is inactive, but they only receive
    // a flag telling the frontend to show the activation screen. No JWT yet.
    if (role === 'ADMIN' && license.status === 'inactive') {
      return {
        token: null,
        user: { id: user.id, username: user.username, role: 'admin', restaurantId: user.restaurantId, restaurantName: restaurant.restaurantName },
        device: null,
        license: { status: license.status, expirationDate: license.expirationDate },
        offlineLicense: null,
        requiresActivation: true,
      };
    }

    // For every other case the license must be valid (active, not expired, not revoked/suspended).
    await licenseService.validateLicense(user.restaurantId);

    const device = await deviceService.registerDevice({
      restaurantId: user.restaurantId,
      userId: user.id,
      fingerprint,
      deviceName: normalizedDeviceName,
      operatingSystem: normalizedOS,
    });

    await deviceService.updateValidationTimestamp(device.id);

    const jwtId = randomUUID();
    const tokenPayload = {
      sub: user.id,
      restaurantId: user.restaurantId,
      role: role,
      deviceId: device.id,
      fingerprint,
      jti: jwtId,
      iat: Date.now(),
      type: 'user',
    };
    const token = signAuthToken(tokenPayload);

    await sessionService.createSession({
      jwtId,
      userId: user.id,
      userType: 'user',
      restaurantId: user.restaurantId,
      deviceId: device.id,
    });

    await auditService.log({
      userId: user.id,
      restaurantId: user.restaurantId,
      action: 'USER_LOGIN',
      deviceId: device.id,
      ipAddress,
    });

    const offlineLicense = this.generateOfflineLicense({
      restaurantId: user.restaurantId,
      licenseId: license.id,
      deviceId: device.id,
      fingerprint,
      expirationDate: license.expirationDate,
      offlineDays: license.offlineDays,
    });

    return {
      token,
      user: {
        ...sanitize(user),
        role: role.toLowerCase(),
        permissions: PERMISSIONS[role.toLowerCase()] || [],
        restaurantId: user.restaurantId,
        restaurantName: restaurant.restaurantName,
      },
      device: sanitize(device),
      license: {
        status: license.status,
        expirationDate: license.expirationDate,
        validationIntervalHours: license.validationIntervalHours,
      },
      offlineLicense,
      requiresActivation: role === 'ADMIN' && license.status === 'inactive',
    };
  },

  async activateRestaurantLicense({ username, password, token, fingerprint, deviceName, operatingSystem, ipAddress }) {
    const allDevices = await store.findAll('devices');
    const knownDevice = allDevices.find((d) => d.fingerprint === fingerprint && d.status === 'active');
    let users = await store.findAll('users');
    if (knownDevice?.restaurantId) {
      users = users.filter((u) => u.restaurantId === knownDevice.restaurantId);
    }
    const candidates = users.filter((u) => u.username === username);
    let user = null;
    for (const candidate of candidates) {
      const ok = await verifyPassword(password, candidate.passwordHash || '');
      if (ok) { user = candidate; break; }
    }
    if (!user) throw new HttpError(401, 'Invalid credentials');
    if (normalizeRole(user.role) !== 'ADMIN') throw new HttpError(403, 'Only restaurant admins can activate licenses');

    const license = await licenseService.activateLicense(user.restaurantId, token);
    return this.loginRestaurantUser({
      username,
      password,
      fingerprint,
      deviceName,
      operatingSystem,
      ipAddress,
    });
  },

  async loginSuperAdmin({ username, password, ipAddress }) {
    const admin = await store.findOne('super_admins', { username });
    if (!admin) throw new HttpError(401, 'Invalid credentials');
    if (['inactive', 'suspended'].includes(admin.status)) throw new HttpError(403, 'Account disabled');
    const ok = await verifyPassword(password, admin.passwordHash || '');
    if (!ok) throw new HttpError(401, 'Invalid credentials');

    const jwtId = randomUUID();
    const tokenPayload = {
      sub: admin.id,
      role: 'SUPER_ADMIN',
      jti: jwtId,
      iat: Date.now(),
      type: 'super_admin',
    };
    const token = signAuthToken(tokenPayload);

    await sessionService.createSession({
      jwtId,
      userId: admin.id,
      userType: 'super_admin',
      deviceId: null,
      restaurantId: null,
    });

    await auditService.log({
      userId: admin.id,
      action: 'SUPER_ADMIN_LOGIN',
      ipAddress,
    });

    return {
      token,
      user: { ...sanitize(admin), role: 'super_admin', permissions: ['*'] },
    };
  },

  async me(userId, type) {
    if (type === 'super_admin') {
      const admin = await store.findOne('super_admins', { id: userId });
      if (!admin) throw new HttpError(404, 'User not found');
      return { ...sanitize(admin), role: 'SUPER_ADMIN', permissions: ['*'] };
    }
    const user = await store.findOne('users', { id: userId });
    if (!user) throw new HttpError(404, 'User not found');
    const role = normalizeRole(user.role);
    return { ...sanitize(user), role: role.toLowerCase(), permissions: PERMISSIONS[role.toLowerCase()] || [] };
  },

  generateOfflineLicense({ restaurantId, licenseId, deviceId, fingerprint, expirationDate, offlineDays }) {
    const offlineUntil = new Date();
    offlineUntil.setDate(offlineUntil.getDate() + offlineDays);
    const payload = {
      restaurantId,
      licenseId,
      deviceId,
      fingerprint,
      expirationDate,
      offlineExpiration: offlineUntil.toISOString(),
    };
    return {
      ...payload,
      signature: signPayload(payload),
      encrypted: encrypt(JSON.stringify(payload)),
    };
  },
};

export default authService;
