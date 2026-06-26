import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * Factory producing a standard CRUD service over a collection, with audit
 * logging baked in. Domain services compose or extend this.
 */
export function createCrudService(collection, { entityName } = {}) {
  const name = entityName || collection;
  return {
    repo: () => repo(collection),
    list: (filter) => repo(collection).getAll(filter),
    get: async (id) => {
      const r = await repo(collection).getById(id);
      if (!r) throw new HttpError(404, `${name} not found`);
      return r;
    },
    create: async (data, user) => {
      const created = await repo(collection).create(data);
      await recordAudit(user, `${name.toUpperCase()}_CREATED`, collection, created.id, { after: created });
      return created;
    },
    update: async (id, patch, user) => {
      const before = await repo(collection).getById(id);
      if (!before) throw new HttpError(404, `${name} not found`);
      const updated = await repo(collection).update(id, patch);
      await recordAudit(user, `${name.toUpperCase()}_UPDATED`, collection, id, { before, after: updated });
      return updated;
    },
    remove: async (id, user) => {
      const before = await repo(collection).getById(id);
      if (!before) throw new HttpError(404, `${name} not found`);
      await repo(collection).remove(id);
      await recordAudit(user, `${name.toUpperCase()}_DELETED`, collection, id, { before });
      return { ok: true };
    },
  };
}

export default createCrudService;
