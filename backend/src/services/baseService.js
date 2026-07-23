import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * Factory producing a standard CRUD service over a collection. Domain
 * services compose or extend this.
 */
export function createCrudService(collection, { entityName } = {}) {
  const name = entityName || collection;
  return {
    repo: () => repo(collection),
    list: (filter, user) => repo(collection).getAll({ ...filter, restaurantId: user?.restaurantId }),
    get: async (id, user) => {
      const r = await repo(collection).getById(id);
      if (!r) throw new HttpError(404, `${name} not found`);
      if (user?.restaurantId && r.restaurantId && r.restaurantId !== user.restaurantId) {
        throw new HttpError(404, `${name} not found`);
      }
      return r;
    },
    create: async (data, user) => {
      return repo(collection).create({ ...data, restaurantId: user?.restaurantId });
    },
    update: async (id, patch, user) => {
      const before = await repo(collection).getById(id);
      if (!before) throw new HttpError(404, `${name} not found`);
      if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
        throw new HttpError(404, `${name} not found`);
      }
      return repo(collection).update(id, { ...patch, restaurantId: before.restaurantId || user?.restaurantId });
    },
    remove: async (id, user) => {
      const before = await repo(collection).getById(id);
      if (!before) throw new HttpError(404, `${name} not found`);
      if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
        throw new HttpError(404, `${name} not found`);
      }
      await repo(collection).remove(id);
      return { ok: true };
    },
  };
}

export default createCrudService;
