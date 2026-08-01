import { secureStore } from '../repositories/secureStore.js';
import { repo } from '../repositories/index.js';
import { hashPassword } from '../utils/hash.js';
import { licenseService } from './licenseService.js';
import { sessionService } from './sessionService.js';
import { newId } from '../utils/ids.js';
import { HttpError } from '../middleware/errorHandler.js';

const store = secureStore();

/** Username must be unique across every restaurant, not just within one —
 * case-insensitive/trimmed, excluding a given user id (for edits) and any
 * already-deleted-equivalent rows there is no concept of here (users are
 * never soft-deleted the way clients/restaurants are, only suspended). */
async function assertUsernameAvailable(username, excludeUserId) {
  const target = (username || '').trim().toLowerCase();
  const all = await store.findAll('users');
  const dup = all.some((u) => u.id !== excludeUserId && (u.username || '').trim().toLowerCase() === target);
  if (dup) throw new HttpError(409, 'This username is already taken by another restaurant\'s account');
}

export const superAdminService = {
  async createSuperAdmin({ username, password, status = 'active' }) {
    const existing = await store.findOne('super_admins', { username });
    if (existing) throw new HttpError(409, 'Username already exists');
    return store.create('super_admins', {
      username,
      passwordHash: await hashPassword(password),
      status,
    });
  },

  async findSuperAdminByUsername(username) {
    return store.findOne('super_admins', { username });
  },

  async listSuperAdmins() {
    return store.findAll('super_admins');
  },

  async createRestaurant({ restaurantName, adminUsername, adminPassword, adminOverrides = {}, licenseOverrides = {} }) {
    const name = (restaurantName || '').trim();
    const all = await store.findAll('restaurants');
    const dup = all.some((r) => r.status !== 'deleted' && r.restaurantName.trim().toLowerCase() === name.toLowerCase());
    if (dup) throw new HttpError(409, 'A restaurant with this name already exists');
    await assertUsernameAvailable(adminUsername);
    const restaurant = await store.create('restaurants', { restaurantName: name, status: 'active' });
    const { license, token } = await licenseService.createLicense(restaurant.id, licenseOverrides);
    const admin = await store.create('users', {
      restaurantId: restaurant.id,
      username: adminUsername,
      passwordHash: await hashPassword(adminPassword),
      role: 'ADMIN',
      status: 'active',
      ...adminOverrides,
    });
    return { restaurant, admin, license, activationToken: token };
  },

  async listRestaurants() {
    const rows = await store.findAll('restaurants');
    return rows.filter((r) => r.status !== 'deleted').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getRestaurant(id) {
    return store.findOne('restaurants', { id });
  },

  async updateRestaurant(id, patch) {
    return store.update('restaurants', id, patch);
  },

  async suspendRestaurant(id) {
    await store.update('restaurants', id, { status: 'suspended' });
    await licenseService.suspendLicense(id);
    // Suspension must take effect immediately for anyone already logged in —
    // otherwise every device with a still-valid JWT keeps working normally
    // until it naturally expires, since auth() never re-checks restaurant/
    // license status per-request (only the session's own status).
    await sessionService.terminateAllSessionsForRestaurant(id);
    return this.getRestaurant(id);
  },

  async deleteRestaurant(id) {
    // Deleting a restaurant must be at least as restrictive as suspending
    // it — previously this only flipped `status` (which merely hid it from
    // listRestaurants()) while every existing user could still log in fully,
    // since login only ever checked for 'suspended', never 'deleted', and
    // the license/sessions were left completely untouched.
    await store.update('restaurants', id, { status: 'deleted' });
    await licenseService.suspendLicense(id);
    await sessionService.terminateAllSessionsForRestaurant(id);
    return { ok: true };
  },

  /**
   * Create a real, login-capable application user (Admin or Cashier). Only
   * the Super Admin ever calls this — it's the sole path that grants app
   * login access, keeping it structurally distinct from workerService.create
   * (which only ever creates non-login employee records).
   *
   * A CASHIER additionally gets a linked `workers` record auto-created here
   * (`appUserId` pointing back to this user), so the restaurant's Admin can
   * immediately manage their employee-side info (salary/attendance/cash
   * advances) — without a separate, duplicate Worker having to be created by
   * hand, and without the Admin ever gaining the ability to edit this
   * account's own username/password/role (workerService.update() blocks
   * exactly those fields for a linked worker — see isLinkedAccount()).
   */
  async createRestaurantUser(restaurantId, { username, password, role, name, status = 'active' }) {
    // Username must be unique across every restaurant's accounts, not just
    // within this one.
    await assertUsernameAvailable(username);
    const user = await store.create('users', {
      restaurantId,
      username,
      passwordHash: await hashPassword(password),
      role,
      status,
    });

    if ((role || '').toUpperCase() === 'CASHIER') {
      await repo('workers').create({
        name: name || username,
        username,
        role: 'cashier',
        status: status === 'inactive' ? 'inactive' : 'active',
        restaurantId,
        appUserId: user.id,
      });
    }

    return user;
  },

  async listRestaurantUsers(restaurantId) {
    const rows = await store.findAll('users', { restaurantId });
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateRestaurantUser(userId, patch) {
    const user = await store.findOne('users', { id: userId });
    if (!user) throw new HttpError(404, 'User not found');
    if (patch.username && patch.username.trim().toLowerCase() !== (user.username || '').trim().toLowerCase()) {
      await assertUsernameAvailable(patch.username, userId);
    }
    const updates = { ...patch };
    const isPasswordChange = !!updates.password;
    if (updates.password) {
      updates.passwordHash = await hashPassword(updates.password);
      delete updates.password;
    }
    const updated = await store.update('users', userId, updates);
    // A password reset invalidates any existing session — otherwise a stolen/
    // shared old session would keep working after the credential change.
    if (isPasswordChange) await sessionService.expireAllForUser(userId);
    return updated;
  },

  /** Mirror a login account's status onto its linked employee record (if
   * any), purely so the Workers/Employees view doesn't keep showing a
   * suspended/deleted Cashier as active — never the other direction, and
   * never touching username/password/role (see workerService.isLinkedAccount). */
  async _mirrorStatusToLinkedWorker(userId, status) {
    const rows = await repo('workers').getAll({});
    const linked = rows.find((w) => w.appUserId === userId);
    if (linked) await repo('workers').update(linked.id, { status });
  },

  async suspendRestaurantUser(userId) {
    const user = await store.update('users', userId, { status: 'suspended' });
    await sessionService.expireAllForUser(userId);
    await this._mirrorStatusToLinkedWorker(userId, 'inactive');
    return user;
  },

  async activateRestaurantUser(userId) {
    const user = await store.update('users', userId, { status: 'active' });
    await this._mirrorStatusToLinkedWorker(userId, 'active');
    return user;
  },

  async deleteRestaurantUser(userId) {
    const user = await store.update('users', userId, { status: 'inactive' });
    await sessionService.expireAllForUser(userId);
    await this._mirrorStatusToLinkedWorker(userId, 'inactive');
    return user;
  },

  async getLicense(id) {
    return store.findOne('licenses', { id });
  },

  async getLicenseByRestaurant(restaurantId) {
    return licenseService.getLicenseByRestaurant(restaurantId);
  },
};

export default superAdminService;
