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
import { hardwareBindingService } from './hardwareBindingService.js';
import { licenseAuthorityClient } from './licenseAuthorityClient.js';
import { buildFingerprint, classifyDeviceType } from '../utils/device.js';
import { withLock } from '../utils/lock.js';
import { signOfflinePayload } from '../utils/offlineLicenseCrypto.js';
import { connectivity } from '../sync/connectivity.js';
import { isSupabaseConfigured } from '../config/index.js';
import { getTrustedNow } from '../utils/trustedTime.js';

const store = secureStore();

// A calendar month has no single fixed length (28-31 days) — a plain 30-day
// window is used instead, so "at least once a month" is enforced consistently
// regardless of which month a device's last online validation fell in.
const MONTHLY_VALIDATION_MS = 30 * 24 * 60 * 60 * 1000;

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
    // A restaurant may intentionally have several users sharing one username,
    // disambiguated by which device each was bound to (see Users doc/Part 9) —
    // if this exact device is already bound to one specific user among the
    // remaining candidates, prefer that user deterministically.
    const userIdHint = knownDevice?.userId;

    const allUsers = await store.findAll('users');
    let candidates = allUsers.filter((u) => u.username === username);
    if (restaurantIdHint && candidates.some((u) => u.restaurantId === restaurantIdHint)) {
      candidates = candidates.filter((u) => u.restaurantId === restaurantIdHint);
    }
    if (userIdHint && candidates.some((u) => u.id === userIdHint)) {
      candidates = candidates.filter((u) => u.id === userIdHint);
    }

    let user = null;
    for (const candidate of candidates) {
      const ok = await verifyPassword(password, candidate.passwordHash || '');
      if (ok) { user = candidate; break; }
    }
    if (!user) throw new HttpError(401, 'Invalid credentials');
    if (['inactive', 'suspended'].includes(user.status)) throw new HttpError(403, 'Account disabled');

    const restaurant = await store.findOne('restaurants', { id: user.restaurantId });
    if (!restaurant || restaurant.status === 'suspended' || restaurant.status === 'deleted') {
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
    const isExpired = license.status === 'expired' || (license.status === 'active' && new Date(license.expirationDate).getTime() < getTrustedNow());

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

      // Only a genuinely online contact counts toward the monthly
      // online-validation requirement — a login that only succeeded against
      // locally-cached data (because this device is actually offline right
      // now) must not silently renew it (see deviceService.updateValidationTimestamp).
      const online = connectivity.isOnline;
      const registeredDevice = await deviceService.registerDevice({
        restaurantId: user.restaurantId,
        userId: user.id,
        fingerprint,
        deviceName: normalizedDeviceName,
        operatingSystem: normalizedOS,
        online,
      });

      // updateValidationTimestamp's return is a fresh read of the stored row —
      // it never carries `plainDeviceSecret`, which only ever exists as an
      // in-memory, never-persisted field on whatever _issueSecret() itself
      // returned (see its own comment). Losing it here would silently return
      // deviceSecret: null on every login, leaving the client with no secret
      // to send on every subsequent request — which requireDeviceBound then
      // rejects outright (a device with a real stored hash but no secret ever
      // supplied fails, not passes) — a broken app immediately after a
      // successful-looking login, not a login failure itself.
      //
      // CRITICAL: build a NEW object here — never mutate `validatedDevice`
      // in place. secureStore's local-JSON layer returns a LIVE reference
      // into its own in-memory cached row (see localUpdate in
      // repositories/secureStore.js: `rows[idx] = {...}; return rows[idx];`)
      // — assigning onto it directly used to permanently pollute that
      // cached row with a `plainDeviceSecret` field. Every later write to
      // that same device (e.g. the next login's fresh secret rotation)
      // would then spread the polluted row and try to sync a
      // `plain_device_secret` column to Postgres that doesn't exist,
      // silently failing (treated as a non-retryable data error) — so the
      // real secret rotation never reached Postgres while the client
      // believed it had, permanently desyncing the two and 401ing every
      // request immediately after the very next login.
      const validatedDeviceRow = await deviceService.updateValidationTimestamp(registeredDevice.id, { online });
      const validatedDevice = validatedDeviceRow ? { ...validatedDeviceRow, plainDeviceSecret: registeredDevice.plainDeviceSecret } : null;

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

      return { device: validatedDevice || registeredDevice, token: newToken, jwtId: newJwtId };
    });

    const offlineLicense = this.generateOfflineLicense({
      restaurantId: user.restaurantId,
      licenseId: license.id,
      deviceId: device.id,
      fingerprint,
      expirationDate: license.expirationDate,
      offlineDays: license.offlineDays,
      validationIntervalHours: license.validationIntervalHours,
      monthlyValidationDeadline: this.computeMonthlyValidationDeadline(device.lastOnlineValidationAt),
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

  async activateRestaurantLicense({ username, password, token, fingerprint, deviceName, operatingSystem, ipAddress, hardwareComponents }) {
    // Same disambiguation-only hints as loginRestaurantUser — must not exclude
    // a legitimate user in a different restaurant (see comment there).
    const allDevices = await store.findAll('devices');
    const knownDevice = allDevices.find((d) => d.fingerprint === fingerprint && d.status === 'active');
    const restaurantIdHint = knownDevice?.restaurantId;
    const userIdHint = knownDevice?.userId;
    const allUsers = await store.findAll('users');
    let candidates = allUsers.filter((u) => u.username === username);
    if (restaurantIdHint && candidates.some((u) => u.restaurantId === restaurantIdHint)) {
      candidates = candidates.filter((u) => u.restaurantId === restaurantIdHint);
    }
    if (userIdHint && candidates.some((u) => u.id === userIdHint)) {
      candidates = candidates.filter((u) => u.id === userIdHint);
    }
    let user = null;
    for (const candidate of candidates) {
      const ok = await verifyPassword(password, candidate.passwordHash || '');
      if (ok) { user = candidate; break; }
    }
    if (!user) throw new HttpError(401, 'Invalid credentials');
    if (normalizeRole(user.role) !== 'ADMIN') throw new HttpError(403, 'Only restaurant admins can activate licenses');

    // First-time activation must happen with a genuine, live connection to
    // Supabase — this is the one moment the app insists on being online;
    // every other operation afterward (including running fully offline
    // indefinitely) is unaffected. A stale cached `connectivity.online` flag
    // is not good enough here, so this always re-probes right now rather
    // than trusting whatever the background sync loop last observed.
    if (isSupabaseConfigured()) {
      const online = await connectivity.check();
      if (!online) {
        throw new HttpError(503, 'An internet connection is required to activate for the first time. Please connect to the internet and try again.');
      }
    }

    // The actual token-redemption WRITE happens in exactly one place — see
    // config.isLicenseAuthority's own comment. On a packaged desktop install
    // (the common case), this is a real HTTPS call to the centrally-hosted
    // authority with no local fallback: that's what makes "activation
    // requires the internet" a structural fact rather than something
    // defeated by editing local files or spoofing connectivity.
    if (config.isLicenseAuthority) {
      await licenseService.activateLicense(user.restaurantId, token);
    } else {
      await licenseAuthorityClient.activate({ username, password, token });
    }

    const result = await this.loginRestaurantUser({
      username,
      password,
      fingerprint,
      deviceName,
      operatingSystem,
      ipAddress,
    });

    // Hardware binding happens AFTER login, not before — it needs a real
    // device id (a restaurant can run several devices under one license,
    // maximumDevices defaults to 2, so binding must be per-DEVICE, never a
    // single restaurant-wide identity that a second legitimate machine would
    // immediately collide with). loginRestaurantUser just created/reused
    // this device's row, so result.device.id is guaranteed to exist.
    if (hardwareComponents && result.device?.id) {
      if (config.isLicenseAuthority) {
        await hardwareBindingService.verifyOrBind({ restaurantId: user.restaurantId, deviceId: result.device.id, components: hardwareComponents });
      } else {
        await licenseAuthorityClient.bindHardware({ restaurantId: user.restaurantId, deviceId: result.device.id, hardwareComponents });
      }
    }

    return result;
  },

  /**
   * The License Authority's own side of activation (see
   * config.isLicenseAuthority) — called either locally (this instance IS
   * the authority) or over HTTPS by a non-authority instance's
   * activateRestaurantLicense above. Deliberately independent of whatever
   * the caller already checked: verifies credentials AND redeems the token
   * AND binds hardware itself, since the caller could in principle be
   * compromised or bypassed entirely (someone hitting this endpoint
   * directly). Returns license status only — no JWT/device/offline-license;
   * those are minted locally by whichever instance the user is actually
   * running against (loginRestaurantUser), which is the one whose
   * JWT_SECRET that install's own requests will be verified against.
   */
  async activateLicenseCentrally({ username, password, token }) {
    const allUsers = await store.findAll('users');
    const candidates = allUsers.filter((u) => u.username === username);
    let user = null;
    for (const candidate of candidates) {
      const ok = await verifyPassword(password, candidate.passwordHash || '');
      if (ok) { user = candidate; break; }
    }
    if (!user) throw new HttpError(401, 'Invalid credentials');
    if (normalizeRole(user.role) !== 'ADMIN') throw new HttpError(403, 'Only restaurant admins can activate licenses');

    // Hardware binding happens separately, per-device, once a device id
    // exists (see activateRestaurantLicense's own comment on why it can't
    // happen here) — this call only redeems the token and flips the license.
    await licenseService.activateLicense(user.restaurantId, token);
    const license = await licenseService.getLicenseByRestaurant(user.restaurantId);
    return {
      activated: true,
      restaurantId: user.restaurantId,
      license: { status: license.status, expirationDate: license.expirationDate },
    };
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
  /**
   * The monthly deadline is always derived from the DEVICE's own
   * `lastOnlineValidationAt` — the timestamp of its last genuinely-online
   * contact with the licensing backend (see
   * deviceService.updateValidationTimestamp) — never from "now". Deriving it
   * from "now" on every call would let a device stuck fully offline keep
   * renewing its own deadline forever through purely local logins, since
   * login/heartbeat both still nominally "succeed" offline against
   * locally-cached data (by design, for continuity). Anchoring to the last
   * CONFIRMED-online timestamp instead means the deadline stops moving the
   * moment true connectivity is lost, and only a real reconnect can push it
   * forward again.
   */
  computeMonthlyValidationDeadline(lastOnlineValidationAt) {
    const base = lastOnlineValidationAt ? new Date(lastOnlineValidationAt).getTime() : getTrustedNow();
    return new Date(base + MONTHLY_VALIDATION_MS).toISOString();
  },

  generateOfflineLicense({ restaurantId, licenseId, deviceId, fingerprint, expirationDate, offlineDays, validationIntervalHours, monthlyValidationDeadline }) {
    const validatedAt = new Date(getTrustedNow());
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
      // Hard, non-configurable backstop: both Admin and Cashier must complete
      // a successful ONLINE validation (a fresh login, or any heartbeat while
      // actually online — both call this same function) at least once every
      // calendar month, independent of whatever offlineDays a restaurant's
      // license is configured with — this can only ever be tightened by that
      // setting, never loosened past 30 days.
      monthlyValidationDeadline: monthlyValidationDeadline || this.computeMonthlyValidationDeadline(null),
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
