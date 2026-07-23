import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { hashPassword, sanitize } from '../utils/hash.js';
import { HttpError } from '../middleware/errorHandler.js';
import { secureStore } from '../repositories/secureStore.js';

const base = createCrudService('workers', { entityName: 'worker' });
const store = secureStore();

function normalizeUserRole(role) {
  return role === 'admin' ? 'ADMIN' : 'CASHIER';
}

export const workerService = {
  async list(filter, user) {
    const rows = await base.list(filter, user);
    return rows.map(sanitize);
  },

  async get(id, user) {
    return sanitize(await base.get(id, user));
  },

  /** Minimal {id, name} list of active cashiers — safe for non-admins (e.g. shift handover). */
  async cashiers(user) {
    const rows = await repo('workers').getAll({ role: 'cashier', restaurantId: user?.restaurantId });
    return rows.filter((w) => w.status !== 'inactive').map((w) => ({ id: w.id, name: w.name }));
  },

  async create(data, user) {
    const workers = await repo('workers').getAll({ restaurantId: user?.restaurantId });
    if (workers.some((w) => w.username === data.username)) {
      throw new HttpError(409, 'Username already exists');
    }
    const passwordHash = await hashPassword(data.password || 'password123');
    const { password, ...rest } = data;
    const created = await repo('workers').create({ ...rest, passwordHash, restaurantId: user?.restaurantId });

    // Mirror the worker as a user in the secure users table so they can log in.
    await store.create('users', {
      restaurantId: user?.restaurantId,
      username: created.username,
      passwordHash,
      role: normalizeUserRole(created.role),
      status: created.status === 'inactive' ? 'inactive' : 'active',
      legacyWorkerId: created.id,
    });

    return sanitize(created);
  },

  async update(id, patch, user) {
    const next = { ...patch };
    if (patch.password) {
      next.passwordHash = await hashPassword(patch.password);
    }
    const updated = await base.update(id, next, user);

    // Keep the corresponding user in sync.
    const existingUser = await store.findOne('users', { legacyWorkerId: id });
    if (existingUser) {
      const userPatch = {};
      if (patch.username) userPatch.username = patch.username;
      if (patch.role) userPatch.role = normalizeUserRole(patch.role);
      if (patch.status) userPatch.status = patch.status === 'inactive' ? 'inactive' : 'active';
      if (patch.password) userPatch.passwordHash = next.passwordHash;
      if (Object.keys(userPatch).length) await store.update('users', existingUser.id, userPatch);
    }

    return sanitize(updated);
  },

  async disable(id, user) {
    const before = await repo('workers').getById(id);
    if (!before) throw new HttpError(404, 'worker not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'worker not found');
    }
    const updated = await repo('workers').update(id, { status: 'inactive' });
    const existingUser = await store.findOne('users', { legacyWorkerId: id });
    if (existingUser) await store.update('users', existingUser.id, { status: 'inactive' });
    return sanitize(updated);
  },

  async remove(id, user) {
    const existingUser = await store.findOne('users', { legacyWorkerId: id });
    if (existingUser) await store.update('users', existingUser.id, { status: 'inactive' });
    return base.remove(id, user);
  },

  /** Activity summary for a single worker (orders created + revenue generated). */
  async activity(id, user) {
    const orders = await repo('orders').getAll({ cashierId: id, restaurantId: user?.restaurantId });
    return {
      ordersCreated: orders.length,
      revenueGenerated: orders.reduce((s, o) => s + (o.totalPrice || 0), 0),
    };
  },
};

export default workerService;
