import { parseXlsx } from '../utils/excel.js';
import { validate } from '../models/index.js';
import { repo } from '../repositories/index.js';
import { hashPassword } from '../utils/hash.js';
import { HttpError } from '../middleware/errorHandler.js';

const COLLECTIONS = { products: 'products', goods: 'goods', clients: 'clients', workers: 'workers' };

/** Coerce a spreadsheet row into the entity shape. */
function shape(entity, row) {
  const r = { ...row };
  if (entity === 'clients') {
    r.phoneNumbers = String(row.phoneNumbers || row.phone || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    r.addresses = String(row.addresses || row.address || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  if (entity === 'products') {
    r.price = Number(row.price);
    r.ingredients = []; // recipes linked separately in the UI
  }
  if (entity === 'goods') {
    r.quantityAvailable = Number(row.quantityAvailable || 0);
    r.purchasePrice = Number(row.purchasePrice || 0);
    r.minimumStockLevel = Number(row.minimumStockLevel || 0);
  }
  if (entity === 'workers') {
    r.salary = Number(row.salary || 0);
    r.role = (row.role || 'cashier').toLowerCase();
  }
  return r;
}

export const importService = {
  async validateFile(entity, buffer) {
    if (!COLLECTIONS[entity]) throw new HttpError(400, `Cannot import "${entity}"`);
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
      if (entity === 'workers') {
        data = { ...data, passwordHash: await hashPassword(data.password || 'password123') };
        delete data.password;
      }
      created.push(await repo(COLLECTIONS[entity]).create(data));
    }
    return { imported: created.length, skipped: validation.invalid, ...validation };
  },
};

export default importService;
