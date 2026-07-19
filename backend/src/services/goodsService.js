import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('goods', { entityName: 'good' });

export const goodsService = {
  ...base,

  /** Record a stock purchase → increases quantity + creates an expense. */
  async purchase(id, { quantity, unitPrice, supplier }, user) {
    const good = await repo('goods').getById(id);
    if (!good) throw new HttpError(404, 'good not found');
    const qty = Number(quantity);
    const price = Number(unitPrice ?? good.purchasePrice);
    const totalCost = +(qty * price).toFixed(2);

    const updated = await repo('goods').update(id, {
      quantityAvailable: +(good.quantityAvailable + qty).toFixed(3),
      purchasePrice: price,
    });
    await repo('purchases').create({
      goodId: id, quantity: qty, unitPrice: price, totalCost,
      supplier: supplier || '', date: new Date().toISOString().slice(0, 10),
    });
    await repo('expenses').create({
      type: 'purchase', amount: totalCost,
      description: `Purchase: ${qty}${good.unit} ${good.name}`,
      refId: id, date: new Date().toISOString().slice(0, 10),
    });
    await recordAudit(user, 'GOOD_PURCHASED', 'goods', id, { after: updated });
    return updated;
  },

  /** Goods at or below their minimum stock level. */
  async lowStock() {
    const rows = await repo('goods').getAll();
    return rows.filter((g) => g.quantityAvailable <= g.minimumStockLevel);
  },

  /** Total inventory value at purchase price. */
  async valuation() {
    const rows = await repo('goods').getAll();
    const items = rows.map((g) => ({
      id: g.id, name: g.name, unit: g.unit,
      quantity: g.quantityAvailable, unitPrice: g.purchasePrice,
      value: +(g.quantityAvailable * g.purchasePrice).toFixed(2),
    }));
    return { items, totalValue: +items.reduce((s, i) => s + i.value, 0).toFixed(2) };
  },
};

export default goodsService;
