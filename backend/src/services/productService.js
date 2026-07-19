import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('products', { entityName: 'product' });

/**
 * Cost of a product = sum(ingredient qty × good purchase price per unit).
 * Pass a pre-built `goodById` map when costing many products so we don't refetch
 * the whole goods collection per product (that N+1 made the products page slow).
 */
async function computeCost(product, goodById) {
  if (!goodById) {
    const goods = await repo('goods').getAll();
    goodById = Object.fromEntries(goods.map((g) => [g.id, g]));
  }
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
    // Fetch goods once, then cost every product against the same map.
    const goods = await repo('goods').getAll();
    const goodById = Object.fromEntries(goods.map((g) => [g.id, g]));
    return products.map((p) => ({ ...p, ...computeCostSync(p, goodById) }));
  },

  async cost(id) {
    const product = await repo('products').getById(id);
    if (!product) throw new HttpError(404, 'product not found');
    return { product: { id: product.id, name: product.name }, ...(await computeCost(product)) };
  },

  // Create/update return the product with cost/profit/margin already computed so
  // the UI can show correct numbers immediately without a second round-trip.
  async create(data, user) {
    const created = await base.create(data, user);
    return { ...created, ...(await computeCost(created)) };
  },

  async update(id, patch, user) {
    const updated = await base.update(id, patch, user);
    return { ...updated, ...(await computeCost(updated)) };
  },

  computeCost,
};

/** Synchronous cost computation against a pre-built goods map (see list()). */
function computeCostSync(product, goodById) {
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

export default productService;
