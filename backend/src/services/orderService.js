import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';
import { shortCode } from '../utils/ids.js';
import { config } from '../config/index.js';

const today = () => new Date().toISOString().slice(0, 10);

async function priceLines(lines) {
  const products = await repo('products').getAll();
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  let total = 0;
  const priced = lines.map((l) => {
    const product = byId[l.productId];
    if (!product) throw new HttpError(400, `Unknown product ${l.productId}`);
    const unitPrice = l.unitPrice ?? product.price;
    total += unitPrice * l.quantity;
    return { productId: l.productId, name: product.name, quantity: l.quantity, unitPrice };
  });
  return { priced, total: +total.toFixed(2) };
}

/** Deduct each product's recipe ingredients from inventory. */
async function deductInventory(lines) {
  const [products, goods] = await Promise.all([repo('products').getAll(), repo('goods').getAll()]);
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  const need = {}; // goodId → qty
  for (const l of lines) {
    const product = productById[l.productId];
    for (const ing of product.ingredients || []) {
      need[ing.goodId] = (need[ing.goodId] || 0) + ing.quantityRequired * l.quantity;
    }
  }
  const lowStock = [];
  for (const [goodId, qty] of Object.entries(need)) {
    const good = goods.find((g) => g.id === goodId);
    if (!good) continue;
    const newQty = +(good.quantityAvailable - qty).toFixed(3);
    await repo('goods').update(goodId, { quantityAvailable: newQty });
    if (newQty <= good.minimumStockLevel) lowStock.push({ goodId, name: good.name, remaining: newQty });
  }
  return lowStock;
}

export const orderService = {
  list: (filter) => repo('orders').getAll(filter),

  async get(id) {
    const o = await repo('orders').getById(id);
    if (!o) throw new HttpError(404, 'order not found');
    return o;
  },

  async create(data, user) {
    const { priced, total } = await priceLines(data.products || []);
    const order = await repo('orders').create({
      ...data,
      invoiceNo: shortCode('INV'),
      products: priced,
      totalPrice: total,
      cashierId: data.cashierId || user?.sub,
      orderDate: data.orderDate || Date.now(),
      status: data.status || 'completed',
    });

    let lowStock = [];
    if (order.status === 'completed') {
      lowStock = await this._onComplete(order, user);
    }
    await recordAudit(user, 'ORDER_CREATED', 'orders', order.id, { after: order });
    return { ...order, lowStock };
  },

  /** Side effects when an order becomes completed. */
  async _onComplete(order, user) {
    const lowStock = await deductInventory(order.products);
    // record income
    await repo('expenses'); // ensure collection touched
    // loyalty + client rollups
    if (order.clientId) {
      const client = await repo('clients').getById(order.clientId);
      if (client) {
        const points = Math.floor((order.totalPrice || 0) * (config.loyaltyRate || 0.1));
        await repo('clients').update(client.id, {
          totalSpent: +((client.totalSpent || 0) + order.totalPrice).toFixed(2),
          visitCount: (client.visitCount || 0) + 1,
          loyaltyPoints: (client.loyaltyPoints || 0) + points,
        });
        await repo('loyaltyTx').create({
          clientId: client.id, points, type: 'earn',
          orderId: order.id, date: today(),
        });
      }
    }
    // kitchen ticket
    await repo('kdsTickets').create({
      orderId: order.id,
      invoiceNo: order.invoiceNo,
      items: order.products.map((p) => ({ name: p.name, quantity: p.quantity })),
      status: 'new',
      priority: 'normal',
      startedAt: Date.now(),
    });
    return lowStock;
  },

  async update(id, patch, user) {
    const before = await repo('orders').getById(id);
    if (!before) throw new HttpError(404, 'order not found');
    let next = { ...patch };
    if (patch.products) {
      const { priced, total } = await priceLines(patch.products);
      next.products = priced;
      next.totalPrice = total;
    }
    const updated = await repo('orders').update(id, next);
    // transition into completed
    if (before.status !== 'completed' && updated.status === 'completed') {
      await this._onComplete(updated, user);
    }
    await recordAudit(user, 'ORDER_UPDATED', 'orders', id, { before, after: updated });
    return updated;
  },

  async cancel(id, user) {
    const before = await repo('orders').getById(id);
    if (!before) throw new HttpError(404, 'order not found');
    const updated = await repo('orders').update(id, { status: 'cancelled' });
    await recordAudit(user, 'ORDER_CANCELLED', 'orders', id, { before, after: updated });
    return updated;
  },

  async setStatus(id, status, user) {
    return this.update(id, { status }, user);
  },
};

export default orderService;
