import { secureStore } from '../repositories/secureStore.js';

const store = secureStore();

export const auditService = {
  async log({ userId, restaurantId, action, deviceId, ipAddress, metadata = {} }) {
    return store.create('audit_logs', {
      userId,
      restaurantId,
      action,
      deviceId,
      ipAddress,
      metadata,
      timestamp: new Date().toISOString(),
    });
  },

  async list(filter = {}) {
    const rows = await store.findAll('audit_logs', filter);
    return rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  async listByRestaurant(restaurantId) {
    return this.list({ restaurantId });
  },
};

export default auditService;
