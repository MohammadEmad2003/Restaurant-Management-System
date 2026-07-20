import { secureStore } from '../repositories/secureStore.js';
import { newId } from '../utils/ids.js';
import { HttpError } from '../middleware/errorHandler.js';
import { licenseService } from './licenseService.js';

const store = secureStore();

export const deviceService = {
  async registerDevice({ restaurantId, userId, fingerprint, deviceName, operatingSystem }) {
    const license = await licenseService.requireLicense(restaurantId);

    // Existing device for this fingerprint should be re-used regardless of the
    // current active-device count so that re-login on a registered device works.
    const existing = await store.findOne('devices', { restaurantId, fingerprint });
    if (existing && existing.status === 'active') {
      await this.updateValidationTimestamp(existing.id);
      return existing;
    }
    if (existing) {
      await store.update('devices', existing.id, { status: 'active', userId });
      await this.updateValidationTimestamp(existing.id);
      return store.findOne('devices', { id: existing.id });
    }

    await licenseService.refreshActiveDevices(restaurantId);
    const activeDevices = await store.findAll('devices', { restaurantId, status: 'active' });

    if (activeDevices.length >= license.maximumDevices) {
      throw new HttpError(403, 'Maximum device limit reached for this restaurant license');
    }

    const device = await store.create('devices', {
      restaurantId,
      userId,
      deviceId: newId('DEV'),
      fingerprint,
      deviceName: deviceName || 'Unknown Device',
      operatingSystem: operatingSystem || 'Unknown',
      activationDate: new Date().toISOString(),
      lastOnline: new Date().toISOString(),
      lastOnlineValidationAt: new Date().toISOString(),
      status: 'active',
    });
    await licenseService.refreshActiveDevices(restaurantId);
    return device;
  },

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

  async validateDevice(deviceId, fingerprint, restaurantId) {
    const device = await store.findOne('devices', { id: deviceId });
    if (!device) throw new HttpError(401, 'Device not registered');
    if (device.status === 'revoked') throw new HttpError(403, 'Device has been revoked');
    if (device.restaurantId !== restaurantId) throw new HttpError(401, 'Device restaurant mismatch');
    if (device.fingerprint !== fingerprint) throw new HttpError(401, 'Device fingerprint mismatch');
    return device;
  },

  async updateLastOnline(deviceId) {
    return store.update('devices', deviceId, { lastOnline: new Date().toISOString() });
  },

  async updateValidationTimestamp(deviceId) {
    return store.update('devices', deviceId, {
      lastOnline: new Date().toISOString(),
      lastOnlineValidationAt: new Date().toISOString(),
    });
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
