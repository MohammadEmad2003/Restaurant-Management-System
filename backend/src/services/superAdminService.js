import { secureStore } from '../repositories/secureStore.js';
import { hashPassword } from '../utils/hash.js';
import { licenseService } from './licenseService.js';
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
    const restaurant = await store.create('restaurants', { restaurantName, status: 'active' });
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
    const existing = await store.findOne('users', { restaurantId, username });
    if (existing) throw new HttpError(409, 'Username already exists in this restaurant');
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
    if (updates.password) {
      updates.passwordHash = await hashPassword(updates.password);
      delete updates.password;
    }
    return store.update('users', userId, updates);
  },

  async suspendRestaurantUser(userId) {
    return store.update('users', userId, { status: 'suspended' });
  },

  async deleteRestaurantUser(userId) {
    return store.update('users', userId, { status: 'inactive' });
  },

  async getLicense(id) {
    return store.findOne('licenses', { id });
  },

  async getLicenseByRestaurant(restaurantId) {
    return licenseService.getLicenseByRestaurant(restaurantId);
  },
};

export default superAdminService;
