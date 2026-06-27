import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';

const base = createCrudService('locations', { entityName: 'location' });

export const locationService = {
  ...base,

  /** Governorate → [areas], for cascading dropdowns. */
  async tree() {
    const rows = await repo('locations').getAll();
    const tree = {};
    for (const r of rows) {
      const g = (r.governorate || '').trim();
      if (!g) continue;
      (tree[g] ||= new Set());
      if (r.area) tree[g].add(r.area.trim());
    }
    return Object.fromEntries(
      Object.entries(tree)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([g, set]) => [g, [...set].sort((a, b) => a.localeCompare(b))]),
    );
  },
};

export default locationService;
