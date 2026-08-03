import { validate } from '../models/index.js';
import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';

const COLLECTIONS = { products: 'products', goods: 'goods', clients: 'clients', workers: 'workers' };

/**
 * Passes a numeric cell through UN-coerced (only substituting `fallback` for
 * a genuinely empty cell) so `validate()`'s own number-coercion + NaN check
 * (models/index.js) actually runs on it. Pre-coercing with `Number(...)`
 * here — the previous behavior — turns a blank/non-numeric cell (e.g. a
 * "TBD" price) into `NaN` *before* validation ever sees it; since
 * `typeof NaN === 'number'` in JS, validate()'s `typeof !== 'number'` guard
 * then never fires, and the NaN silently passes as "valid", corrupting every
 * downstream total that touches that price/quantity/salary.
 */
function numberOrRaw(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

/** Coerce a spreadsheet row into the entity shape. */
function shape(entity, row) {
  const r = { ...row };
  if (entity === 'clients') {
    r.phoneNumbers = String(row.phoneNumbers || row.phone || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    r.addresses = String(row.addresses || row.address || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  if (entity === 'products') {
    r.price = numberOrRaw(row.price, undefined);
    r.ingredients = []; // recipes linked separately in the UI
  }
  if (entity === 'goods') {
    r.quantityAvailable = numberOrRaw(row.quantityAvailable, 0);
    r.purchasePrice = numberOrRaw(row.purchasePrice, 0);
    r.minimumStockLevel = numberOrRaw(row.minimumStockLevel, 0);
  }
  if (entity === 'workers') {
    r.salary = numberOrRaw(row.salary, 0);
    r.role = (row.role || 'cashier').toLowerCase();
  }
  return r;
}

export const importService = {
  async validateFile(entity, buffer) {
    if (!COLLECTIONS[entity]) throw new HttpError(400, `Cannot import "${entity}"`);
    const { parseXlsx } = await import('../utils/excel.js'); // exceljs is heavy — load only on import
    const rows = await parseXlsx(buffer);
    const results = rows.map((row, i) => {
      const shaped = shape(entity, row);
      const { valid, errors } = validate(COLLECTIONS[entity], shaped);
      return { row: i + 2, valid, errors, data: shaped };
    });
    return {
      total: results.length,
      valid: results.filter((r) => r.valid).length,
      invalid: results.filter((r) => !r.valid).length,
      results,
    };
  },

  async importFile(entity, buffer, user) {
    const validation = await this.validateFile(entity, buffer);
    const valid = validation.results.filter((r) => r.valid);
    const created = [];
    for (const r of valid) {
      let data = r.data;
      // Imported Workers are employee records only — same as
      // workerService.create(), no `password`/credential is ever stored or
      // usable for login. Only real Cashier accounts (created by the Super
      // Admin) can authenticate; a bulk-imported worker never can.
      if (entity === 'workers') {
        data = { ...data };
        delete data.password;
      }
      const record = await repo(COLLECTIONS[entity]).create({ ...data, restaurantId: user?.restaurantId });
      created.push(record);
    }
    return { imported: created.length, skipped: validation.invalid, ...validation };
  },
};

export default importService;
