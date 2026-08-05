import { secureStore } from '../repositories/secureStore.js';
import { newId } from '../utils/ids.js';
import { HttpError } from '../middleware/errorHandler.js';
import { licenseService } from './licenseService.js';
import { generateDeviceSecret, hashDeviceSecret, validateDeviceSecret } from '../utils/deviceSecret.js';
import { getTrustedNow } from '../utils/trustedTime.js';

const store = secureStore();

export const deviceService = {
  // NOTE: the device/session concurrency limits checked here are only race-free
  // because the caller (authService.loginRestaurantUser) wraps this whole call
  // in withLock(restaurantId, ...) — do not call this outside that lock.
  async registerDevice({ restaurantId, userId, fingerprint, deviceName, operatingSystem, online = true }) {
    const license = await licenseService.requireLicense(restaurantId);

    // Existing device for this fingerprint should be re-used regardless of the
    // current active-device count so that re-login on a registered device works.
    const existing = await store.findOne('devices', { restaurantId, fingerprint });
    if (existing && existing.status === 'active') {
      await this.updateValidationTimestamp(existing.id, { online });
      // registerDevice() only runs on a fresh, just-verified username+password
      // login (never on ordinary token-based requests) — every such login
      // rotates the secret so the browsing context that just authenticated
      // always ends up with one that actually matches. Without this, a device
      // whose fingerprint is already secreted but whose storage lost the
      // secret (cleared localStorage, a different browser profile, a private
      // window) would log in "successfully" yet be permanently locked out of
      // every subsequent request with no recovery short of an admin resetting
      // the device.
      return this._issueSecret(existing);
    }
    if (existing) {
      if (existing.status === 'revoked') {
        throw new HttpError(403, 'This device has been revoked. Contact your administrator.');
      }
      await store.update('devices', existing.id, { status: 'active', userId });
      await this.updateValidationTimestamp(existing.id, { online });
      const reactivated = await store.findOne('devices', { id: existing.id });
      return this._issueSecret(reactivated);
    }

    await licenseService.refreshActiveDevices(restaurantId);
    const activeDevices = await store.findAll('devices', { restaurantId, status: 'active' });

    if (activeDevices.length >= license.maximumDevices) {
      // Deliberately does NOT say "license has expired"/anything expiration-
      // sounding — this is unrelated to the license's validity or dates, and
      // renewing/extending/regenerating the license does nothing to fix it
      // (a real support case: an admin kept renewing a perfectly valid,
      // non-expired license because this message read like a subscription
      // problem). The actual fix is either raising Max Devices for this
      // restaurant, or freeing a slot by deleting/resetting an existing
      // device — surfaced explicitly so it's obvious what to do next.
      throw new HttpError(403, `Device limit reached (${license.maximumDevices} device${license.maximumDevices === 1 ? '' : 's'} allowed). Ask your Super Admin to raise the device limit, or remove/reset an existing device to free a slot.`);
    }

    const device = await store.create('devices', {
      restaurantId,
      userId,
      deviceId: newId('DEV'),
      fingerprint,
      deviceName: deviceName || 'Unknown Device',
      operatingSystem: operatingSystem || 'Unknown',
      activationDate: new Date(getTrustedNow()).toISOString(),
      lastOnline: new Date(getTrustedNow()).toISOString(),
      lastOnlineValidationAt: new Date(getTrustedNow()).toISOString(),
      status: 'active',
    });
    await licenseService.refreshActiveDevices(restaurantId);
    return this._issueSecret(device);
  },

  /** Mints a fresh device-binding secret, stores only its hash, and returns
   * the plaintext once on the device object for the caller to relay to the
   * client — it is never persisted or returned again afterward. */
  async _issueSecret(device) {
    const secret = generateDeviceSecret();
    const updated = await store.update('devices', device.id, { deviceSecretHash: hashDeviceSecret(secret) });
    return { ...updated, plainDeviceSecret: secret };
  },

  validateDeviceSecret,

  async getDevice(id) {
    return store.findOne('devices', { id });
  },

  async findByFingerprint(restaurantId, fingerprint) {
    return store.findOne('devices', { restaurantId, fingerprint });
  },

  async listByRestaurant(restaurantId) {
    const rows = await store.findAll('devices', { restaurantId });
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async listByUser(userId) {
    const rows = await store.findAll('devices', { userId });
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async validateDevice(deviceId, fingerprint, restaurantId) {
    const device = await store.findOne('devices', { id: deviceId });
    if (!device) throw new HttpError(401, 'Device not registered');
    if (device.status === 'revoked') throw new HttpError(403, 'Device has been revoked');
    if (device.restaurantId !== restaurantId) throw new HttpError(401, 'Device restaurant mismatch');
    if (device.fingerprint !== fingerprint) throw new HttpError(401, 'Device fingerprint mismatch');
    return device;
  },

  async updateLastOnline(deviceId) {
    return store.update('devices', deviceId, { lastOnline: new Date(getTrustedNow()).toISOString() });
  },

  /**
   * `lastOnlineValidationAt` is the anchor the monthly online-validation
   * requirement is measured from — it must only ever advance when this
   * device genuinely reached the licensing backend while online. A login or
   * heartbeat that merely succeeded against locally-cached data (because the
   * device is actually offline right now) still touches `lastOnline` for
   * general bookkeeping, but must NOT push this timestamp forward, or a
   * device could stay disconnected from the internet indefinitely while
   * repeated offline-only logins kept silently renewing its own monthly
   * deadline forever.
   */
  async updateValidationTimestamp(deviceId, { online = true } = {}) {
    const patch = { lastOnline: new Date(getTrustedNow()).toISOString() };
    if (online) patch.lastOnlineValidationAt = new Date(getTrustedNow()).toISOString();
    return store.update('devices', deviceId, patch);
  },

  async deleteDevice(deviceId, restaurantId) {
    const device = await store.findOne('devices', { id: deviceId });
    if (!device) throw new HttpError(404, 'Device not found');
    if (device.restaurantId !== restaurantId) throw new HttpError(403, 'Device does not belong to this restaurant');
    await store.update('devices', deviceId, { status: 'revoked' });
    await licenseService.refreshActiveDevices(restaurantId);
    return { ok: true };
  },

  async resetDevice(deviceId, restaurantId) {
    const device = await store.findOne('devices', { id: deviceId });
    if (!device) throw new HttpError(404, 'Device not found');
    if (device.restaurantId !== restaurantId) throw new HttpError(403, 'Device does not belong to this restaurant');
    await store.update('devices', deviceId, { status: 'reset' });
    await licenseService.refreshActiveDevices(restaurantId);
    return { ok: true };
  },
};

export default deviceService;
