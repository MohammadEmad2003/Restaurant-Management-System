import { secureStore } from '../repositories/secureStore.js';
import { HttpError } from '../middleware/errorHandler.js';

const store = secureStore();

export const sessionService = {
  async createSession({ jwtId, userId, userType, restaurantId, deviceId, role }) {
    const now = new Date().toISOString();
    return store.create('login_sessions', {
      jwtId,
      userId,
      userType,
      role: role || null,
      restaurantId,
      deviceId,
      loginTime: now,
      lastSeenAt: now,
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

  /** Called from the heartbeat endpoint so an active session isn't swept as idle. */
  async heartbeat(jwtId) {
    const session = await store.findOne('login_sessions', { jwtId });
    if (!session) throw new HttpError(401, 'Session not found');
    return store.update('login_sessions', session.id, { lastSeenAt: new Date().toISOString() });
  },

  async getByJwtId(jwtId) {
    return store.findOne('login_sessions', { jwtId });
  },

  async countActiveCashierSessions(restaurantId, excludeUserId) {
    const rows = await store.findAll('login_sessions', { restaurantId, role: 'CASHIER', status: 'active' });
    return rows.filter((r) => r.userId !== excludeUserId).length;
  },

  /**
   * Releases abandoned cashier/user slots left behind by a crashed app, lost
   * power, or a closed tab that never hit /auth/logout. Runs on a timer
   * (see src/sessions/sessionSweep.js) rather than per-request, so the
   * per-restaurant timeout is read once per sweep tick, not per API call.
   */
  async sweepExpiredSessions() {
    const [sessions, licenses] = await Promise.all([
      store.findAll('login_sessions', { status: 'active' }),
      store.findAll('licenses'),
    ]);
    const timeoutByRestaurant = Object.fromEntries(licenses.map((l) => [l.restaurantId, l.sessionTimeoutMinutes ?? 30]));
    const now = Date.now();
    let expired = 0;
    for (const session of sessions) {
      const timeoutMinutes = timeoutByRestaurant[session.restaurantId] ?? 30;
      const lastSeen = new Date(session.lastSeenAt || session.loginTime).getTime();
      if (now - lastSeen > timeoutMinutes * 60000) {
        await store.update('login_sessions', session.id, { status: 'expired', logoutTime: new Date().toISOString() });
        expired += 1;
      }
    }
    return { expired };
  },

  async terminateSession(sessionId) {
    return store.update('login_sessions', sessionId, { status: 'revoked', logoutTime: new Date().toISOString() });
  },

  async terminateAllCashierSessions(restaurantId) {
    const rows = await store.findAll('login_sessions', { restaurantId, role: 'CASHIER', status: 'active' });
    await Promise.all(rows.map((r) => store.update('login_sessions', r.id, { status: 'revoked', logoutTime: new Date().toISOString() })));
    return { terminated: rows.length };
  },

  /** Terminates every active session for a restaurant, Admins included — used
   * when a restaurant is suspended/deleted, since at that point nobody should
   * keep working regardless of role (unlike terminateAllCashierSessions,
   * which deliberately only targets cashiers for the "force logout cashiers"
   * admin action). */
  async terminateAllSessionsForRestaurant(restaurantId) {
    const rows = await store.findAll('login_sessions', { restaurantId, status: 'active' });
    await Promise.all(rows.map((r) => store.update('login_sessions', r.id, { status: 'revoked', logoutTime: new Date().toISOString() })));
    return { terminated: rows.length };
  },

  /** Bulk-invalidates a suspended user's active sessions so the Sessions tab
   * reflects it immediately; a still-valid JWT can keep working until it
   * naturally expires (bounded by the 24h JWT lifetime + the sweep above) —
   * an accepted tradeoff rather than adding a per-request session lookup to
   * the stateless auth() middleware. */
  async expireAllForUser(userId) {
    const rows = await store.findAll('login_sessions', { userId, status: 'active' });
    await Promise.all(rows.map((r) => store.update('login_sessions', r.id, { status: 'expired', logoutTime: new Date().toISOString() })));
    return { expired: rows.length };
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
