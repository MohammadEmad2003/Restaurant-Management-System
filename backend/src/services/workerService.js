import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { hashPassword, sanitize } from '../utils/hash.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('workers', { entityName: 'worker' });

export const workerService = {
  async list(filter) {
    const rows = await base.list(filter);
    return rows.map(sanitize);
  },

  async get(id) {
    return sanitize(await base.get(id));
  },

  async create(data, user) {
    const workers = await repo('workers').getAll();
    if (workers.some((w) => w.username === data.username)) {
      throw new HttpError(409, 'Username already exists');
    }
    const passwordHash = await hashPassword(data.password || 'password123');
    const { password, ...rest } = data;
    const created = await repo('workers').create({ ...rest, passwordHash });
    await recordAudit(user, 'WORKER_CREATED', 'workers', created.id, { after: sanitize(created) });
    return sanitize(created);
  },

  async update(id, patch, user) {
    const next = { ...patch };
    if (patch.password) {
      next.passwordHash = await hashPassword(patch.password);
      delete next.password;
    }
    const updated = await base.update(id, next, user);
    return sanitize(updated);
  },

  async disable(id, user) {
    const updated = await repo('workers').update(id, { status: 'inactive' });
    if (!updated) throw new HttpError(404, 'worker not found');
    await recordAudit(user, 'WORKER_DISABLED', 'workers', id, { after: sanitize(updated) });
    return sanitize(updated);
  },

  remove: base.remove,

  /** Activity log for a single worker (orders created + audit entries). */
  async activity(id) {
    const [orders, logs] = await Promise.all([
      repo('orders').getAll({ cashierId: id }),
      repo('auditLogs').getAll({ userId: id }),
    ]);
    return {
      ordersCreated: orders.length,
      revenueGenerated: orders.reduce((s, o) => s + (o.totalPrice || 0), 0),
      recentActions: logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50),
    };
  },
};

export default workerService;
