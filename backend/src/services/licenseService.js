import { secureStore } from '../repositories/secureStore.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { newId, shortCode } from '../utils/ids.js';
import { HttpError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { getTrustedNow } from '../utils/trustedTime.js';

const store = secureStore();

/** Coerces + validates a license numeric setting. A plain `value < min` check
 * silently passes for non-numeric input (`NaN < 1` is `false` in JS), which
 * previously let e.g. `offlineDays: "abc"` be stored — then crashed every
 * login for that restaurant with a RangeError the next time an offline
 * license was generated (`new Date().setDate(x + NaN)` → Invalid Date →
 * `.toISOString()` throws), and silently disabled the max-devices/max-
 * concurrent-cashier-sessions caps (`n >= "abc"` is always false). */
function requireFiniteNumber(value, min, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) {
    throw new HttpError(400, `${label} must be a number ${min > 0 ? `of at least ${min}` : 'that is not negative'}`);
  }
  return n;
}

// Note: JWT lifetime is a global setting (config.jwtExpiresInHours), not
// per-restaurant — it intentionally has no entry here. Session timeout and
// validation interval are no longer independently configurable from the
// Super Admin UI (removed per product decision) — they still exist as
// stored fields (the idle-session sweep and the offline-license rolling-
// validation tier both still read them) but always use these fixed
// defaults now, for every restaurant.
const DEFAULTS = {
  maximumDevices: 2,
  validationIntervalHours: 24,
  licenseDays: 30,
  maxConcurrentCashierSessions: 1,
  sessionTimeoutMinutes: 30,
};

export function generateActivationToken() {
  return `${shortCode('ACT')}-${shortCode('TKN')}-${shortCode('KEY')}`;
}

export function licenseExpirationDate(days = DEFAULTS.licenseDays, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Sentinel "never expires" date — functionally forever without needing a
 * separate boolean flag threaded through every expiration check in the app;
 * anything comparing against `new Date()` just never trips. Exported so the
 * frontend can recognise it and show "Never Expires" instead of a raw date. */
export const FOREVER_DATE = '9999-12-31T23:59:59.999Z';

export const licenseService = {
  async createLicense(restaurantId, overrides = {}) {
    const token = generateActivationToken();
    const days = overrides.days || DEFAULTS.licenseDays;
    const license = await store.create('licenses', {
      restaurantId,
      activationTokenEncrypted: encrypt(token),
      expirationDate: overrides.expirationDate || licenseExpirationDate(days),
      // Offline access is merged with the license's own duration — a
      // device may work offline for as long as the license itself is
      // valid for, not a separately-configured shorter/longer window.
      offlineDays: days,
      maximumDevices: overrides.maximumDevices ?? DEFAULTS.maximumDevices,
      activeDevices: 0,
      validationIntervalHours: DEFAULTS.validationIntervalHours,
      maxConcurrentCashierSessions: overrides.maxConcurrentCashierSessions ?? DEFAULTS.maxConcurrentCashierSessions,
      sessionTimeoutMinutes: DEFAULTS.sessionTimeoutMinutes,
      status: 'inactive',
    });
    return { license, token };
  },

  async getLicenseByRestaurant(restaurantId) {
    return store.findOne('licenses', { restaurantId });
  },

  async requireLicense(restaurantId) {
    const license = await this.getLicenseByRestaurant(restaurantId);
    if (!license) throw new HttpError(404, 'License not found');
    return license;
  },

  async getActivationToken(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    return decrypt(license.activationTokenEncrypted);
  },

  async regenerateActivationToken(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    const token = generateActivationToken();
    await store.update('licenses', license.id, {
      activationTokenEncrypted: encrypt(token),
      status: 'inactive',
    });
    return { token, license };
  },

  async activateLicense(restaurantId, token) {
    const license = await this.requireLicense(restaurantId);
    const currentToken = decrypt(license.activationTokenEncrypted);
    if (currentToken !== token) throw new HttpError(400, 'Invalid activation token');
    if (license.status === 'revoked') throw new HttpError(403, 'License has been revoked');
    if (license.status === 'suspended') throw new HttpError(403, 'License is suspended');

    // Activation always grants a fresh expiration window from now — this is
    // what lets a restaurant re-activate after its previous period lapsed
    // (super admin regenerates the token, admin re-enters it here), so the
    // stale/past expirationDate on an 'expired' license must NOT block this;
    // it's exactly the case this method exists to resolve.
    const updated = await store.update('licenses', license.id, {
      status: 'active',
      expirationDate: licenseExpirationDate(),
      updatedAt: Date.now(),
    });
    return updated;
  },

  async renewLicense(restaurantId, days = DEFAULTS.licenseDays) {
    const license = await this.requireLicense(restaurantId);
    const expirationDate = licenseExpirationDate(days);
    const updated = await store.update('licenses', license.id, {
      expirationDate,
      offlineDays: days, // kept merged with the license's own duration, same as at creation
      status: 'active',
    });
    return { license: updated, expirationDate };
  },

  /** Sets the license to never expire (see FOREVER_DATE) and makes sure it's
   * active. Still a real, revocable/suspendable license — only the
   * expiration check itself is neutralized. */
  async setLicenseForever(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    const updated = await store.update('licenses', license.id, {
      expirationDate: FOREVER_DATE,
      status: 'active',
    });
    return { license: updated, expirationDate: FOREVER_DATE };
  },

  async extendLicense(restaurantId, days) {
    if (!days || days <= 0) throw new HttpError(400, 'Extension days must be positive');
    const license = await this.requireLicense(restaurantId);
    const current = new Date(license.expirationDate);
    current.setDate(current.getDate() + days);
    const updated = await store.update('licenses', license.id, { expirationDate: current.toISOString() });
    return { license: updated, expirationDate: current.toISOString() };
  },

  async reduceLicenseDuration(restaurantId, days) {
    if (!days || days <= 0) throw new HttpError(400, 'Reduction days must be positive');
    const license = await this.requireLicense(restaurantId);
    const current = new Date(license.expirationDate);
    current.setDate(current.getDate() - days);
    const updated = await store.update('licenses', license.id, { expirationDate: current.toISOString() });
    return { license: updated, expirationDate: current.toISOString() };
  },

  async suspendLicense(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { status: 'suspended' });
  },

  async revokeLicense(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { status: 'revoked' });
  },

  async changeMaximumDevices(restaurantId, count) {
    const n = requireFiniteNumber(count, 1, 'Maximum devices');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { maximumDevices: n });
  },

  async changeMaxConcurrentCashierSessions(restaurantId, count) {
    const n = requireFiniteNumber(count, 1, 'Concurrent cashier sessions');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { maxConcurrentCashierSessions: n });
  },

  async validateLicense(restaurantId) {
    const license = await this.getLicenseByRestaurant(restaurantId);
    if (!license) throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'revoked') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'suspended') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    // getTrustedNow() (not `new Date()`) — this backend runs on the same
    // machine as the user, so a plain clock comparison is trivially defeated
    // by winding the OS date backward. See utils/trustedTime.js.
    if (license.status === 'expired' || new Date(license.expirationDate).getTime() < getTrustedNow()) {
      await store.update('licenses', license.id, { status: 'expired' });
      throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    }
    if (license.status !== 'active') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    return license;
  },

  async refreshActiveDevices(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    const activeDevices = await store.findAll('devices', { restaurantId, status: 'active' });
    return store.update('licenses', license.id, { activeDevices: activeDevices.length });
  },
};

export default licenseService;
