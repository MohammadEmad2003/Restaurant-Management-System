import { repo } from '../repositories/index.js';
import { verifyPassword, sanitize } from '../utils/hash.js';
import { signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { PERMISSIONS } from '../config/permissions.js';

export const authService = {
  async login(username, password) {
    const workers = await repo('workers').getAll();
    const worker = workers.find((w) => w.username === username);
    if (!worker) throw new HttpError(401, 'Invalid credentials');
    if (worker.status === 'inactive') throw new HttpError(403, 'Account disabled');

    const ok = await verifyPassword(password, worker.passwordHash || '');
    if (!ok) throw new HttpError(401, 'Invalid credentials');

    const token = signToken({ sub: worker.id, role: worker.role, name: worker.name });
    return {
      token,
      user: { ...sanitize(worker), permissions: PERMISSIONS[worker.role] || [] },
    };
  },

  async me(userId) {
    const worker = await repo('workers').getById(userId);
    if (!worker) throw new HttpError(404, 'User not found');
    return { ...sanitize(worker), permissions: PERMISSIONS[worker.role] || [] };
  },
};

export default authService;
