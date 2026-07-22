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
import { buildFingerprint, classifyDeviceType } from '../utils/device.js';
import { withLock } from '../utils/lock.js';
import { signOfflinePayload } from '../utils/offlineLicenseCrypto.js';

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
  async loginRestaurantUser({ username, password, fingerprint, deviceName, operatingSystem, userAgent, ipAddress }) {
    // Try to identify the restaurant from a previously registered device —
    // this is ONLY a disambiguation hint for when multiple restaurants share
    // the same username on the same device; it must never exclude a
    // legitimate user in a DIFFERENT restaurant when the hinted restaurant
    // has no matching username at all (e.g. a brand-new user just created
    // for another restaurant, logging in from a browser that previously
    // logged into a different restaurant).
    const allDevices = await store.findAll('devices');
    const knownDevice = allDevices.find((d) => d.fingerprint === fingerprint && d.status === 'active');
    const restaurantIdHint = knownDevice?.restaurantId;

    const allUsers = await store.findAll('users');
    let candidates = allUsers.filter((u) => u.username === username);
    if (restaurantIdHint && candidates.some((u) => u.restaurantId === restaurantIdHint)) {
      candidates = candidates.filter((u) => u.restaurantId === restaurantIdHint);
    }

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

    // CASHIERs are hardware-restricted to desktop/laptop. The raw User-Agent
    // header is the only trustworthy signal here — deviceName/operatingSystem
    // are client-reported and spoofable.
    if (role === 'CASHIER' && classifyDeviceType(userAgent) !== 'desktop') {
      throw new HttpError(403, 'This account can only be used from a desktop or laptop computer.');
    }

    // A license still marked 'active' but past its expirationDate hasn't been
    // flipped to 'expired' yet (that only happens inside validateLicense) — check
    // the date directly so an admin is sent to the activation screen on the very
    // first login after it lapses, instead of a hard rejection followed only later
    // by the activation screen once something else has triggered the flip.
    const isExpired = license.status === 'expired' || (license.status === 'active' && new Date(license.expirationDate) < new Date());

    // ADMIN can log in even when the license was never activated, or has expired,
    // but only receives a flag telling the frontend to show the activation screen.
    // No JWT yet. CASHIERs never see this screen — they depend entirely on the
    // admin's license and are hard-rejected below via validateLicense instead.
    if (role === 'ADMIN' && (license.status === 'inactive' || isExpired)) {
      return {
        token: null,
        user: { id: user.id, username: user.username, role: 'admin', restaurantId: user.restaurantId, restaurantName: restaurant.restaurantName },
        device: null,
        license: { status: license.status, expirationDate: license.expirationDate },
        offlineLicense: null,
        requiresActivation: true,
      };
    }

    // Every remaining case (ADMIN with a valid license, or any CASHIER) must have
    // an active, non-expired, non-revoked/suspended license — single call, shared
    // by both roles (previously CASHIER also hit this redundantly above).
    license = await licenseService.validateLicense(user.restaurantId);

    // Cashier-session-count-then-create and device-count-then-create are both
    // check-then-act sequences racing other simultaneous logins for the SAME
    // restaurant — serialize them per-restaurant so two concurrent logins can't
    // both pass a check that only one of them should have passed.
    const { device, token } = await withLock(user.restaurantId, async () => {
      // Cashier sessions are capped per-restaurant by the license's configurable
      // concurrency limit; check before minting a new session/device slot. The
      // logging-in user's own existing session(s) are excluded from the count —
      // re-authenticating as yourself (lost token, refreshed tab, same device)
      // must not consume an additional slot against your own limit.
      if (role === 'CASHIER') {
        const activeCashierSessions = await sessionService.countActiveCashierSessions(user.restaurantId, user.id);
        if (activeCashierSessions >= (license.maxConcurrentCashierSessions ?? 1)) {
          throw new HttpError(403, 'The maximum number of active cashier sessions has been reached.');
        }
        // Supersede any of this user's own stale active sessions so re-login
        // doesn't leave orphaned rows counted against future concurrency checks.
        await sessionService.expireAllForUser(user.id);
      }

      const registeredDevice = await deviceService.registerDevice({
        restaurantId: user.restaurantId,
        userId: user.id,
        fingerprint,
        deviceName: normalizedDeviceName,
        operatingSystem: normalizedOS,
      });

      await deviceService.updateValidationTimestamp(registeredDevice.id);

      const newJwtId = randomUUID();
      const tokenPayload = {
        sub: user.id,
        restaurantId: user.restaurantId,
        role: role,
        deviceId: registeredDevice.id,
        fingerprint,
        jti: newJwtId,
        iat: Date.now(),
        type: 'user',
      };
      const newToken = signAuthToken(tokenPayload);

      await sessionService.createSession({
        jwtId: newJwtId,
        userId: user.id,
        userType: 'user',
        role,
        restaurantId: user.restaurantId,
        deviceId: registeredDevice.id,
      });

      return { device: registeredDevice, token: newToken, jwtId: newJwtId };
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
      validationIntervalHours: license.validationIntervalHours,
    });

    return {
      token,
      // Present only when registerDevice minted a fresh one (new device, or a
      // legacy device authenticating for the first time since this feature
      // shipped) — never re-sent once a device already has one, and never
      // stored server-side beyond its hash.
      deviceSecret: device.plainDeviceSecret || null,
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
      // Always false here — the requiresActivation branch above already
      // returned earlier for the only case where this would be true.
      requiresActivation: false,
    };
  },

  async activateRestaurantLicense({ username, password, token, fingerprint, deviceName, operatingSystem, ipAddress }) {
    // Same disambiguation-only hint as loginRestaurantUser — must not exclude
    // a legitimate user in a different restaurant (see comment there).
    const allDevices = await store.findAll('devices');
    const knownDevice = allDevices.find((d) => d.fingerprint === fingerprint && d.status === 'active');
    const restaurantIdHint = knownDevice?.restaurantId;
    const allUsers = await store.findAll('users');
    let candidates = allUsers.filter((u) => u.username === username);
    if (restaurantIdHint && candidates.some((u) => u.restaurantId === restaurantIdHint)) {
      candidates = candidates.filter((u) => u.restaurantId === restaurantIdHint);
    }
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

  /**
   * Builds a tamper-evident, asymmetrically-signed offline license. The
   * client verifies `signature` against `payload` using the backend's public
   * key (GET /license/public-key) — a symmetric HMAC can't be safely ported
   * to the browser without exposing the secret, which would let anyone forge
   * their own license. `validatedAt`/`validationIntervalHours` encode the
   * rolling-validation window: within the interval, the client trusts this
   * license outright; past it (but before offlineExpiration), the frontend
   * requires reconnecting to get a fresh online validation rather than
   * silently continuing to trust a stale one.
   */
  generateOfflineLicense({ restaurantId, licenseId, deviceId, fingerprint, expirationDate, offlineDays, validationIntervalHours }) {
    const validatedAt = new Date();
    const offlineUntil = new Date(validatedAt);
    offlineUntil.setDate(offlineUntil.getDate() + offlineDays);
    const payload = {
      restaurantId,
      licenseId,
      deviceId,
      fingerprint,
      expirationDate,
      validatedAt: validatedAt.toISOString(),
      validationIntervalHours: validationIntervalHours ?? 24,
      offlineExpiration: offlineUntil.toISOString(),
    };
    // Sent alongside the object so the client verifies the signature against
    // this EXACT string, never re-serializing the object itself (which could
    // silently disagree on key order/whitespace between environments).
    const payloadString = JSON.stringify(payload);
    return {
      ...payload,
      payload: payloadString,
      signature: signOfflinePayload(payloadString),
    };
  },
};

export default authService;
