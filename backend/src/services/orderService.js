import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { shortCode } from '../utils/ids.js';
import { config } from '../config/index.js';
import { settingsService } from './settingsService.js';
import { evaluateLoyaltyReward } from './loyaltyEngine.js';
import { withLock } from '../utils/lock.js';
import { secureStore } from '../repositories/secureStore.js';
import { cashLedgerService } from './cashLedgerService.js';
import { cashierShiftService } from './cashierShiftService.js';

const store = secureStore();
const today = () => new Date().toISOString().slice(0, 10);

// The JWT payload carries only sub/restaurantId/role (no display name), so
// "Created By" on an order/pending-payment must be resolved from the users
// table itself when the caller doesn't pass one explicitly.
async function resolveCashierName(user) {
  if (!user?.sub) return null;
  const record = await store.findOne('users', { id: user.sub });
  return record?.username || null;
}

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
    let city = data.city || '';
    let area = data.area || '';
    if (data.clientId) {
      const client = await repo('clients').getById(data.clientId);
      if (client && client.restaurantId !== user?.restaurantId) {
        throw new HttpError(400, 'Invalid client');
      }
      if (client) {
        clientName = client.name || clientName;
        clientPhone = (client.phoneNumbers || [])[0] || clientPhone;
        city = city || client.city || '';
        area = area || client.area || '';
      }
    }

    // A registered delivery agent (as opposed to the free-text deliveryPerson
    // name) must belong to the same restaurant — the same IDOR guard as clientId.
    let deliveryAgentName = '';
    if (data.deliveryAgentId) {
      const agent = await repo('deliveryAgents').getById(data.deliveryAgentId);
      if (!agent || agent.restaurantId !== user?.restaurantId) {
        throw new HttpError(400, 'Invalid delivery agent');
      }
      deliveryAgentName = agent.name;
    }
    // Delivery-agent orders carry an explicit paymentTiming that alone decides
    // paymentStatus — PAID_NOW means the frontend has already gated order
    // creation behind an explicit "money received" confirmation (see
    // Orders.jsx), so by the time this runs the order genuinely is paid.
    // END_OF_DAY and UNPAID_PRINTED both mean the agent hasn't handed the cash
    // back yet — the order is real but the payment is only "expected", never
    // conflated with money actually being in the drawer. They're kept as
    // distinct values (not collapsed into one) because they represent
    // different business intent even though both resolve to the same
    // paymentStatus today. Every other order (no agent) keeps today's
    // implicit "paid".
    const paymentTiming = data.deliveryAgentId
      ? (['PAID_NOW', 'UNPAID_PRINTED'].includes(data.paymentTiming) ? data.paymentTiming : 'END_OF_DAY')
      : null;
    const paymentStatus = data.deliveryAgentId
      ? (paymentTiming === 'PAID_NOW' ? 'paid' : 'pending')
      : 'paid';

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
      city,
      area,
      deliveryAddress: data.deliveryAddress || '',
      deliveryPerson: data.deliveryPerson || '', // name of the delivery man, printed on the receipt
      deliveryAgentId: data.deliveryAgentId || null,
      deliveryAgentName,
      paymentStatus,
      paymentTiming,
      paidAt: paymentStatus === 'paid' ? new Date().toISOString() : null,
      walkIn,
      isDelivery,
      deliveryFee,
      subtotal: total,
      invoiceNo: shortCode('INV'),
      products: priced,
      totalPrice: grandTotal,
      cashierId: data.cashierId || user?.sub,
      cashierName: data.cashierName || await resolveCashierName(user),
      orderDate: data.orderDate || Date.now(),
      status: data.status || 'completed',
      restaurantId: user?.restaurantId,
    });

    // Real cash received at the moment of order creation (a normal paid cash
    // order, or a delivery-agent order marked Paid Now) — record it in the
    // Restaurant Cash Ledger immediately. END_OF_DAY/UNPAID_PRINTED orders are
    // still pending, so no ledger entry exists for them until they're
    // actually settled later (see markPaid). cashierShiftId is an optional
    // attribution, never a precondition — the cashier need not have an open
    // shift for this cash to count toward the Restaurant's balance.
    if (order.paymentStatus === 'paid' && order.status !== 'cancelled' && (order.paymentMethod || 'cash') === 'cash') {
      const openShift = await cashierShiftService.openShiftFor(order.cashierId, user);
      await cashLedgerService.record({
        restaurantId: user?.restaurantId,
        amount: order.totalPrice,
        transactionType: order.deliveryAgentId ? 'DELIVERY_AGENT_PAID_NOW' : 'CASH_SALE',
        orderId: order.id,
        cashierShiftId: openShift?.id || null,
        createdByUserId: order.cashierId,
      });
    }

    let lowStock = [];
    if (order.status === 'completed') {
      lowStock = await this._onComplete(order, user);
    }
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
      await evaluateLoyaltyReward(order, settings, user);
      // update totalSpent independently (engine handles points + visitCount)
      const client = await repo('clients').getById(order.clientId);
      if (client && client.restaurantId === user?.restaurantId) {
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
    return updated;
  },

  async cancel(id, user) {
    const before = await repo('orders').getById(id);
    if (!before) throw new HttpError(404, 'order not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'order not found');
    }
    return repo('orders').update(id, { status: 'cancelled', restaurantId: before.restaurantId });
  },

  async setStatus(id, status, user) {
    return this.update(id, { status }, user);
  },

  /** Delivery-agent orders, with optional agent/date/search/status filters —
   * backs the Pending Payments page. Defaults to the pending queue; pass
   * `status: 'paid'` or `'all'` to also see recently-settled agent orders
   * (e.g. an end-of-day audit view) without a second, duplicate endpoint. */
  async listPendingPayments({ agentId, dateFrom, dateTo, q, status = 'pending' } = {}, user) {
    let rows = await repo('orders').getAll({ restaurantId: user?.restaurantId });
    // This page is specifically the delivery-agent payment queue — a normal
    // order (no agent) is never financially "pending" and has no business here.
    rows = rows.filter((o) => !!o.deliveryAgentId);
    if (status !== 'all') rows = rows.filter((o) => (o.paymentStatus || 'paid') === status);
    if (agentId) rows = rows.filter((o) => o.deliveryAgentId === agentId);
    if (dateFrom) rows = rows.filter((o) => (o.orderDate || 0) >= new Date(dateFrom).getTime());
    if (dateTo) rows = rows.filter((o) => (o.orderDate || 0) <= new Date(dateTo).getTime());
    if (q) {
      const term = q.toLowerCase();
      rows = rows.filter((o) =>
        (o.invoiceNo || '').toLowerCase().includes(term) ||
        (o.id || '').toLowerCase().includes(term) ||
        (o.clientName || '').toLowerCase().includes(term));
    }
    return rows.sort((a, b) => (b.orderDate || 0) - (a.orderDate || 0));
  },

  /**
   * Settle a single pending order. Locked per-order and re-checks
   * `paymentStatus === 'pending'` right before flipping it, so two concurrent
   * settle attempts (double-click, two tabs, two staff members) can never both
   * succeed — the loser gets a clean 409 instead of silently re-stamping
   * `paidAt` and letting the same cash get counted twice by the drawer.
   */
  async markPaid(id, user) {
    return withLock(`order-settle-${id}`, async () => {
      const before = await repo('orders').getById(id);
      if (!before) throw new HttpError(404, 'order not found');
      if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
        throw new HttpError(404, 'order not found');
      }
      if ((before.paymentStatus || 'paid') !== 'pending') {
        throw new HttpError(409, 'This order has already been settled');
      }
      const settled = await repo('orders').update(id, {
        paymentStatus: 'paid',
        paidAt: new Date().toISOString(),
        restaurantId: before.restaurantId,
      });
      // Real cash is received exactly now — this is the single, lock-guarded
      // place a pending order can ever transition to paid, so this runs
      // exactly once no matter how many concurrent settlement attempts race
      // here. The settling cashier need not have an open shift of their own
      // for this cash to count toward the Restaurant's balance.
      if ((before.paymentMethod || 'cash') === 'cash') {
        const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
        await cashLedgerService.record({
          restaurantId: before.restaurantId,
          amount: before.totalPrice,
          transactionType: 'PENDING_PAYMENT_SETTLEMENT',
          orderId: id,
          cashierShiftId: openShift?.id || null,
          createdByUserId: user?.sub,
        });
      }
      return settled;
    });
  },

  /** Settle many pending orders at once — either an explicit list of order ids,
   * or every pending order for one delivery agent. Idempotent: an order
   * already settled by someone else in the meantime is silently skipped
   * (not double-counted, not treated as a failure of the whole batch). */
  async bulkMarkPaid({ orderIds, agentId } = {}, user) {
    let targets;
    if (Array.isArray(orderIds) && orderIds.length) {
      targets = orderIds;
    } else if (agentId) {
      const pending = await this.listPendingPayments({ agentId, status: 'pending' }, user);
      targets = pending.map((o) => o.id);
    } else {
      throw new HttpError(400, 'Provide orderIds or agentId');
    }
    const settled = [];
    let skipped = 0;
    for (const id of targets) {
      try {
        settled.push(await this.markPaid(id, user));
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) { skipped += 1; continue; }
        throw err;
      }
    }
    return { settled: settled.length, skipped, orders: settled };
  },
};

export default orderService;
