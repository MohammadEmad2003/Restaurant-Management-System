import { secureStore } from '../repositories/secureStore.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { newId, shortCode } from '../utils/ids.js';
import { HttpError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const store = secureStore();

const DEFAULTS = {
  offlineDays: 7,
  maximumDevices: 2,
  validationIntervalHours: 24,
  jwtExpiresInHours: 24,
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

export const licenseService = {
  async createLicense(restaurantId, overrides = {}) {
    const token = generateActivationToken();
    const license = await store.create('licenses', {
      restaurantId,
      activationTokenEncrypted: encrypt(token),
      expirationDate: overrides.expirationDate || licenseExpirationDate(overrides.days || DEFAULTS.licenseDays),
      offlineDays: overrides.offlineDays ?? DEFAULTS.offlineDays,
      maximumDevices: overrides.maximumDevices ?? DEFAULTS.maximumDevices,
      activeDevices: 0,
      validationIntervalHours: overrides.validationIntervalHours ?? DEFAULTS.validationIntervalHours,
      maxConcurrentCashierSessions: overrides.maxConcurrentCashierSessions ?? DEFAULTS.maxConcurrentCashierSessions,
      sessionTimeoutMinutes: overrides.sessionTimeoutMinutes ?? DEFAULTS.sessionTimeoutMinutes,
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
      status: 'active',
    });
    return { license: updated, expirationDate };
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

  async changeOfflineDays(restaurantId, days) {
    if (days < 0) throw new HttpError(400, 'Offline days cannot be negative');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { offlineDays: days });
  },

  async changeMaximumDevices(restaurantId, count) {
    if (count < 1) throw new HttpError(400, 'Maximum devices must be at least 1');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { maximumDevices: count });
  },

  async changeValidationInterval(restaurantId, hours) {
    if (hours < 1) throw new HttpError(400, 'Validation interval must be at least 1 hour');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { validationIntervalHours: hours });
  },

  async changeMaxConcurrentCashierSessions(restaurantId, count) {
    if (count < 1) throw new HttpError(400, 'Must allow at least 1 concurrent cashier session');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { maxConcurrentCashierSessions: count });
  },

  async changeSessionTimeoutMinutes(restaurantId, minutes) {
    if (minutes < 1) throw new HttpError(400, 'Session timeout must be at least 1 minute');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { sessionTimeoutMinutes: minutes });
  },

  async validateLicense(restaurantId) {
    const license = await this.getLicenseByRestaurant(restaurantId);
    if (!license) throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'revoked') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'suspended') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'expired' || new Date(license.expirationDate) < new Date()) {
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
