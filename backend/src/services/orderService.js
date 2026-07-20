import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';
import { shortCode } from '../utils/ids.js';
import { config } from '../config/index.js';
import { settingsService } from './settingsService.js';
import { evaluateLoyaltyReward } from './loyaltyEngine.js';

const today = () => new Date().toISOString().slice(0, 10);

async function priceLines(lines, user) {
  const products = await repo('products').getAll({ restaurantId: user?.restaurantId });
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
async function deductInventory(lines, user) {
  const [products, goods] = await Promise.all([
    repo('products').getAll({ restaurantId: user?.restaurantId }),
    repo('goods').getAll({ restaurantId: user?.restaurantId }),
  ]);
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
  list: (filter, user) => repo('orders').getAll({ ...filter, restaurantId: user?.restaurantId }),

  async get(id, user) {
    const o = await repo('orders').getById(id);
    if (!o) throw new HttpError(404, 'order not found');
    if (user?.restaurantId && o.restaurantId && o.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'order not found');
    }
    return o;
  },

  async create(data, user) {
    const { priced, total } = await priceLines(data.products || [], user);

    // Snapshot the customer's name + phone onto the order so the receipt and
    // history stay correct even if the client record later changes or is offline.
    let clientName = data.clientName || 'Walk-in';
    let clientPhone = data.clientPhone || null;
    let governorate = data.governorate || '';
    let area = data.area || '';
    if (data.clientId) {
      const client = await repo('clients').getById(data.clientId);
      if (client) {
        clientName = client.name || clientName;
        clientPhone = (client.phoneNumbers || [])[0] || clientPhone;
        governorate = governorate || client.governorate || '';
        area = area || client.area || '';
      }
    }

    // Delivery fee: applied to phone/delivery orders, waived for walk-ins. The
    // fee amount is controlled by the admin in Settings.
    const settings = await settingsService.get(user);
    const walkIn = !!data.walkIn;
    const isDelivery = !walkIn && (data.isDelivery ?? !!clientPhone);
    const deliveryFee = isDelivery ? +(settings.deliveryFee || 0) : 0;
    const grandTotal = +(total + deliveryFee).toFixed(2);

    const order = await repo('orders').create({
      ...data,
      clientName,
      clientPhone,
      governorate,
      area,
      deliveryAddress: data.deliveryAddress || '',
      deliveryPerson: data.deliveryPerson || '', // name of the delivery man, printed on the receipt
      walkIn,
      isDelivery,
      deliveryFee,
      subtotal: total,
      invoiceNo: shortCode('INV'),
      products: priced,
      totalPrice: grandTotal,
      cashierId: data.cashierId || user?.sub,
      cashierName: data.cashierName || user?.name || null,
      orderDate: data.orderDate || Date.now(),
      status: data.status || 'completed',
      restaurantId: user?.restaurantId,
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
    const lowStock = await deductInventory(order.products, user);
    // Note: completed orders are the source of truth for income — financeService
    // derives revenue directly from them, so no separate expense/income row is written here.
    // loyalty — automated engine evaluates order value, visit milestone, random reward
    if (order.clientId) {
      const settings = await settingsService.get(user);
      await evaluateLoyaltyReward(order, settings);
      // update totalSpent independently (engine handles points + visitCount)
      const client = await repo('clients').getById(order.clientId);
      if (client) {
        await repo('clients').update(client.id, {
          totalSpent: +((client.totalSpent || 0) + order.totalPrice).toFixed(2),
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
      restaurantId: user?.restaurantId,
    });
    return lowStock;
  },

  async update(id, patch, user) {
    const before = await repo('orders').getById(id);
    if (!before) throw new HttpError(404, 'order not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'order not found');
    }
    let next = { ...patch };
    if (patch.products) {
      const { priced, total } = await priceLines(patch.products, user);
      next.products = priced;
      next.totalPrice = total;
    }
    const updated = await repo('orders').update(id, { ...next, restaurantId: before.restaurantId });
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
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'order not found');
    }
    const updated = await repo('orders').update(id, { status: 'cancelled', restaurantId: before.restaurantId });
    await recordAudit(user, 'ORDER_CANCELLED', 'orders', id, { before, after: updated });
    return updated;
  },

  async setStatus(id, status, user) {
    return this.update(id, { status }, user);
  },
};

export default orderService;
