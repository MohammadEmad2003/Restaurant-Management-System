import { secureStore } from '../repositories/secureStore.js';
import { hashPassword } from '../utils/hash.js';
import { licenseService } from './licenseService.js';
import { sessionService } from './sessionService.js';
import { newId } from '../utils/ids.js';
import { HttpError } from '../middleware/errorHandler.js';

const store = secureStore();

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
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
    return this.getRestaurant(id);
  },

  async deleteRestaurant(id) {
    await store.update('restaurants', id, { status: 'deleted' });
    return { ok: true };
  },

  async createRestaurantUser(restaurantId, { username, password, role, status = 'active' }) {
    // Multiple users may intentionally share a username within one restaurant,
    // disambiguated at login by device binding (see authService's userIdHint) —
    // no uniqueness check here by design.
    return store.create('users', {
      restaurantId,
      username,
      passwordHash: await hashPassword(password),
      role,
      status,
    });
  },

  async listRestaurantUsers(restaurantId) {
    const rows = await store.findAll('users', { restaurantId });
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateRestaurantUser(userId, patch) {
    const user = await store.findOne('users', { id: userId });
    if (!user) throw new HttpError(404, 'User not found');
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

  async suspendRestaurantUser(userId) {
    const user = await store.update('users', userId, { status: 'suspended' });
    await sessionService.expireAllForUser(userId);
    return user;
  },

  async activateRestaurantUser(userId) {
    return store.update('users', userId, { status: 'active' });
  },

  async deleteRestaurantUser(userId) {
    const user = await store.update('users', userId, { status: 'inactive' });
    await sessionService.expireAllForUser(userId);
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
