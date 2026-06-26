import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('products', { entityName: 'product' });

/** Cost of a product = sum(ingredient qty × good purchase price per unit). */
async function computeCost(product) {
  const goods = await repo('goods').getAll();
  const goodById = Object.fromEntries(goods.map((g) => [g.id, g]));
  let cost = 0;
  const breakdown = [];
  for (const ing of product.ingredients || []) {
    const good = goodById[ing.goodId];
    if (!good) continue;
    const lineCost = +(ing.quantityRequired * (good.purchasePrice || 0)).toFixed(3);
    cost += lineCost;
    breakdown.push({
      goodId: good.id, name: good.name, unit: good.unit,
      quantityRequired: ing.quantityRequired, unitPrice: good.purchasePrice, lineCost,
    });
  }
  cost = +cost.toFixed(2);
  const profit = +(product.price - cost).toFixed(2);
  const margin = product.price ? +((profit / product.price) * 100).toFixed(1) : 0;
  return { cost, price: product.price, profit, margin, breakdown };
}

export const productService = {
  ...base,

  async list(filter) {
    const products = await base.list(filter);
    // attach cost/profit for convenient display
    return Promise.all(
      products.map(async (p) => ({ ...p, ...(await computeCost(p)) })),
    );
  },

  async cost(id) {
    const product = await repo('products').getById(id);
    if (!product) throw new HttpError(404, 'product not found');
    return { product: { id: product.id, name: product.name }, ...(await computeCost(product)) };
  },

  computeCost,
};

export default productService;
