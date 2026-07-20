import { secureStore } from '../repositories/secureStore.js';
import { newId } from '../utils/ids.js';

const store = secureStore();

export const sessionService = {
  async createSession({ jwtId, userId, userType, restaurantId, deviceId }) {
    return store.create('login_sessions', {
      jwtId,
      userId,
      userType,
      restaurantId,
      deviceId,
      loginTime: new Date().toISOString(),
      status: 'active',
    });
  },

  async expireSession(jwtId) {
    const session = await store.findOne('login_sessions', { jwtId });
    if (!session) return null;
    return store.update('login_sessions', session.id, { status: 'expired', logoutTime: new Date().toISOString() });
  },

  async logoutSession(jwtId) {
    const session = await store.findOne('login_sessions', { jwtId });
    if (!session) return null;
    return store.update('login_sessions', session.id, { status: 'logged_out', logoutTime: new Date().toISOString() });
  },

  async list(filter = {}) {
    const rows = await store.findAll('login_sessions', filter);
    return rows.sort((a, b) => new Date(b.loginTime) - new Date(a.loginTime));
  },

  async listByRestaurant(restaurantId) {
    return this.list({ restaurantId });
  },
};

export default sessionService;
