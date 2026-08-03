import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { settingsService } from './settingsService.js';
import { evaluateLoyaltyReward } from './loyaltyEngine.js';
import { withLock } from '../utils/lock.js';
import { secureStore } from '../repositories/secureStore.js';
import { cashLedgerService } from './cashLedgerService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { businessDayService } from './businessDayService.js';

const store = secureStore();
const today = () => new Date().toISOString().slice(0, 10);

// The JWT payload carries only sub/restaurantId/role (no display name), so
// "Created By" on an order/pending-payment must be resolved from the users
// table itself when the caller doesn't pass one explicitly.
async function resolveCashierName(user) {
  if (!user?.sub) return null;
  const record = await store.findOne('users', { id: user.sub });
  // Prefer the actual display name (mirrored from the worker record) —
  // falling back straight to username showed e.g. "cash1" instead of
  // "Cashier One" on every order/receipt/pending-payment.
  return record?.name || record?.username || null;
}

async function priceLines(lines, user) {
  // An empty product list is a legitimate order (e.g. a delivery-only charge
  // with no line items tracked) — only validate the lines that do exist.
  if (!Array.isArray(lines)) throw new HttpError(400, 'products must be an array');
  const products = await repo('products').getAll({ restaurantId: user?.restaurantId });
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  let total = 0;
  const priced = lines.map((l) => {
    const product = byId[l.productId];
    if (!product) throw new HttpError(400, `Unknown product ${l.productId}`);
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(400, `Invalid quantity for ${product.name}`);
    }
    // The unit price always comes from the product's own current price —
    // never trusted from the client — so a crafted request can't set an
    // arbitrary or negative price/quantity that would then flow straight
    // into the Cash Ledger, the customer's totalSpent, and inventory
    // deduction (a negative quantity would ADD stock back instead of
    // deducting it). No real flow in this app ever needs a per-order custom
    // price — the POS always adds items at the product's current price.
    const unitPrice = product.price;
    total += unitPrice * quantity;
    return { productId: l.productId, name: product.name, quantity, unitPrice };
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
    if (!goods.some((g) => g.id === goodId)) continue;
    // Locked, and the current quantity re-read INSIDE the lock rather than
    // trusting the `goods` snapshot fetched above — two orders deducting the
    // same ingredient at nearly the same instant (a normal lunch-rush
    // scenario with multiple POS terminals) would otherwise both read the
    // same stale `quantityAvailable` and the second write would silently
    // clobber the first ("lost update"), overselling stock with no error.
    // Floored at 0 so a recipe/order asking for more than is physically in
    // stock can never leave the record silently negative.
    const updated = await withLock(`inventory-${goodId}`, async () => {
      const fresh = await repo('goods').getById(goodId);
      if (!fresh) return null;
      const newQty = Math.max(0, +(fresh.quantityAvailable - qty).toFixed(3));
      return repo('goods').update(goodId, { quantityAvailable: newQty });
    });
    if (updated && updated.quantityAvailable <= updated.minimumStockLevel) {
      lowStock.push({ goodId, name: updated.name, remaining: updated.quantityAvailable });
    }
  }
  return lowStock;
}

export const orderService = {
  /** Every order the caller's restaurant has ever placed, optionally narrowed
   * by an inclusive from/to date range (matched against `orderDate`) and/or a
   * free-text search across order number, invoice number, and customer name —
   * this is what backs full order history browsing (not just the last few
   * orders), available to Cashier and Admin alike; there is no time-based or
   * shift-based restriction on which orders a Cashier can see. */
  async list({ dateFrom, dateTo, q, ...rest } = {}, user) {
    let rows = await repo('orders').getAll({ ...rest, restaurantId: user?.restaurantId });
    if (dateFrom) rows = rows.filter((o) => (o.orderDate || 0) >= new Date(dateFrom).getTime());
    // `dateTo` is a date-only "YYYY-MM-DD" string — without the +86399999ms
    // end-of-day offset, an order placed later that same day would be
    // wrongly excluded (the classic UTC-midnight range bug).
    if (dateTo) rows = rows.filter((o) => (o.orderDate || 0) <= new Date(dateTo).getTime() + 86399999);
    if (q) {
      const term = q.toLowerCase();
      rows = rows.filter((o) =>
        (o.orderNumber || '').toLowerCase().includes(term) ||
        (o.invoiceNo || '').toLowerCase().includes(term) ||
        (o.id || '').toLowerCase().includes(term) ||
        (o.clientName || '').toLowerCase().includes(term));
    }
    return rows.sort((a, b) => (b.orderDate || 0) - (a.orderDate || 0));
  },

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

    // Delivery fee: applied to phone/delivery orders, waived for walk-ins. The
    // fee amount is controlled by the admin in Settings.
    const settings = await settingsService.get(user);
    const walkIn = !!data.walkIn;
    const isDelivery = !walkIn && (data.isDelivery ?? !!clientPhone);
    const deliveryFee = isDelivery ? +(settings.deliveryFee || 0) : 0;

    // Any delivery-collection order carries an explicit paymentTiming that
    // alone decides paymentStatus — whether it's a REGISTERED delivery agent
    // (deliveryAgentId set) or a manual/free-text courier (isDelivery true,
    // no registered agent): both represent the exact same "someone else is
    // holding the cash until collected" scenario and must go through the
    // exact same collection decision, never one bypassing it. PAID_NOW means
    // the frontend has already gated order creation behind an explicit
    // "money received" confirmation (see Orders.jsx), so by the time this
    // runs the order genuinely is paid. END_OF_DAY and UNPAID_PRINTED both
    // mean the money hasn't been handed back yet — the order is real but the
    // payment is only "expected", never conflated with money actually being
    // in the drawer. They're kept as distinct values (not collapsed into one)
    // because they represent different business intent even though both
    // resolve to the same paymentStatus today. A non-delivery order (walk-in,
    // dine-in) keeps today's implicit "paid" — there is nothing to collect.
    const isDeliveryCollection = isDelivery || !!data.deliveryAgentId;
    const paymentTiming = isDeliveryCollection
      ? (['PAID_NOW', 'UNPAID_PRINTED'].includes(data.paymentTiming) ? data.paymentTiming : 'END_OF_DAY')
      : null;
    const paymentStatus = isDeliveryCollection
      ? (paymentTiming === 'PAID_NOW' ? 'paid' : 'pending')
      : 'paid';
    const grandTotal = +(total + deliveryFee).toFixed(2);

    // Sequential, human-readable, business-day-scoped order number — "T-001",
    // "T-002"… for takeaway/walk-in orders, "D-001", "D-002"… for any
    // delivery-collection order (registered agent or manual/free-text
    // courier), two completely independent sequences that both reset when
    // the first cashier shift of a new business day opens (see
    // businessDayService). `invoiceNo` is kept as the same value — it is not
    // a separate identifier, just the existing field name every receipt/
    // pending-payment/report already reads — so this sequential number shows
    // up everywhere the old random code used to, with no other call site
    // needing to change. The database primary key (`id`, e.g. "ORD-9f3a2b")
    // is untouched and remains the stable, non-human-facing identifier.
    const orderNumber = await businessDayService.nextOrderNumber(user?.restaurantId, isDeliveryCollection);

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
      orderNumber,
      invoiceNo: orderNumber,
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
      // Both the loyalty engine (loyaltyPoints/visitCount) and the totalSpent
      // update below read-then-write the same client record without any
      // atomicity of their own — two orders completing for the same client
      // within milliseconds of each other (two POS terminals serving the
      // same walk-in/loyalty customer) would otherwise both read the same
      // stale snapshot and the second write silently clobbers the first,
      // losing whichever update ran first. Serialize per-client the same way
      // deductInventory already serializes per-good.
      await withLock(`client-${order.clientId}`, async () => {
        await evaluateLoyaltyReward(order, settings, user);
        // update totalSpent independently (engine handles points + visitCount)
        const client = await repo('clients').getById(order.clientId);
        if (client && client.restaurantId === user?.restaurantId) {
          await repo('clients').update(client.id, {
            totalSpent: +((client.totalSpent || 0) + order.totalPrice).toFixed(2),
          });
        }
      });
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
    return withLock(`order-settle-${id}`, async () => {
      const before = await repo('orders').getById(id);
      if (!before) throw new HttpError(404, 'order not found');
      if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
        throw new HttpError(404, 'order not found');
      }
      if (before.status === 'cancelled') return before;
      const cancelled = await repo('orders').update(id, { status: 'cancelled', restaurantId: before.restaurantId });
      // If the order had already been counted as real cash (a normal paid
      // sale, a PAID_NOW delivery order, or a settled pending payment), that
      // money must be reversed out of the Restaurant Cash Ledger — otherwise
      // the Cash Drawer would keep counting cash for an order that no longer
      // exists. Sharing the same lock key as markPaid/settlement prevents a
      // cancel and a concurrent settlement from ever racing on this order.
      if (before.paymentStatus === 'paid') {
        const contribution = await cashLedgerService.contributionFor(before.restaurantId, id);
        if (contribution) {
          await cashLedgerService.record({
            restaurantId: before.restaurantId,
            amount: -contribution,
            transactionType: 'ORDER_CANCELLED_REVERSAL',
            orderId: id,
            createdByUserId: user?.sub,
          });
        }
      }
      return cancelled;
    });
  },

  async setStatus(id, status, user) {
    return this.update(id, { status }, user);
  },

  /** Delivery-collection orders (registered agent OR manual/free-text
   * courier), with optional agent/date/search/status filters — backs the
   * Pending Payments page. Defaults to the pending queue; pass
   * `status: 'paid'` or `'all'` to also see recently-settled orders (e.g. an
   * end-of-day audit view) without a second, duplicate endpoint. */
  async listPendingPayments({ agentId, dateFrom, dateTo, q, status = 'pending' } = {}, user) {
    let rows = await repo('orders').getAll({ restaurantId: user?.restaurantId });
    // This page is specifically the delivery-collection queue — a plain
    // walk-in/dine-in order (paymentTiming null) is never financially
    // "pending" and has no business here. A manual/free-text courier order
    // (no registered agent, but still a delivery collection) belongs here
    // exactly the same as a registered-agent order — see create()'s
    // isDeliveryCollection gate, which is the only thing that ever sets
    // paymentTiming in the first place.
    rows = rows.filter((o) => !!o.paymentTiming);
    // A cancelled order was never actually collected and never will be — it
    // must never appear as something still owed, regardless of whatever its
    // paymentStatus/paymentTiming happen to still say.
    rows = rows.filter((o) => o.status !== 'cancelled');
    if (status !== 'all') rows = rows.filter((o) => (o.paymentStatus || 'paid') === status);
    if (agentId) rows = rows.filter((o) => o.deliveryAgentId === agentId);
    if (dateFrom) rows = rows.filter((o) => (o.orderDate || 0) >= new Date(dateFrom).getTime());
    // dateTo is a date-only string ("YYYY-MM-DD"), which parses as that day's
    // UTC midnight — without the +23:59:59.999 offset, an order placed any
    // time after midnight on the end date itself would be wrongly excluded,
    // making the end date effectively never included in the range.
    if (dateTo) rows = rows.filter((o) => (o.orderDate || 0) <= new Date(dateTo).getTime() + 86399999);
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
      if (before.status === 'cancelled') {
        throw new HttpError(409, 'This order was cancelled and cannot be settled');
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
