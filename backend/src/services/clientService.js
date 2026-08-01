import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('clients', { entityName: 'client' });

/** Digits-only comparison so "010 1234 5678" and "01012345678" match. */
const normalizePhone = (p) => String(p || '').replace(/\D/g, '');

const notDeleted = (rows) => rows.filter((c) => c.status !== 'deleted');

export const clientService = {
  ...base,

  async list(filter, user) {
    return notDeleted(await base.list(filter, user));
  },

  /** Create a client, but if one with the same phone already exists in this
   * restaurant, return the existing record instead of creating a duplicate. */
  async create(data, user) {
    const phone = (data.phoneNumbers || [])[0];
    if (phone) {
      const existing = await this._findByPhone(phone, user);
      if (existing) return existing;
    }
    return base.create(data, user);
  },

  /** Look up a single client by phone number within the caller's restaurant —
   * used by the POS to decide whether to load an existing customer or offer
   * to create a new one. */
  async lookupByPhone(phone, user) {
    if (!phone) return null;
    return this._findByPhone(phone, user);
  },

  async _findByPhone(phone, user) {
    const target = normalizePhone(phone);
    if (!target) return null;
    const rows = notDeleted(await repo('clients').getAll({ restaurantId: user?.restaurantId }));
    return rows.find((c) => (c.phoneNumbers || []).some((p) => normalizePhone(p) === target)) || null;
  },

  /** Soft delete — orders keep referencing this clientId for history, the
   * record just stops showing up in lists/search/lookup. */
  async remove(id, user) {
    const before = await repo('clients').getById(id);
    if (!before) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    await repo('clients').update(id, { status: 'deleted' });
    return { ok: true };
  },

  async search({ phone, name } = {}, user) {
    const rows = notDeleted(await repo('clients').getAll({ restaurantId: user?.restaurantId }));
    return rows.filter((c) => {
      const phoneMatch = phone
        ? (c.phoneNumbers || []).some((p) => String(p).includes(phone))
        : true;
      const nameMatch = name ? (c.name || '').toLowerCase().includes(name.toLowerCase()) : true;
      return phoneMatch && nameMatch;
    });
  },

  async addPhone(id, phone, user) {
    const client = await repo('clients').getById(id);
    if (!client) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && client.restaurantId && client.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    const phoneNumbers = [...new Set([...(client.phoneNumbers || []), phone])];
    return base.update(id, { phoneNumbers }, user);
  },

  async addAddress(id, address, user) {
    const client = await repo('clients').getById(id);
    if (!client) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && client.restaurantId && client.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    const addresses = [...(client.addresses || []), address];
    return base.update(id, { addresses }, user);
  },

  /** Advanced filter: city, visit count range, total spent range, sort. */
  async filter({ city, minVisits, maxVisits, minSpent, maxSpent, sortBy } = {}, user) {
    let rows = notDeleted(await repo('clients').getAll({ restaurantId: user?.restaurantId }));
    if (city) rows = rows.filter((c) => c.city === city);
    if (minVisits != null) rows = rows.filter((c) => (c.visitCount || 0) >= Number(minVisits));
    if (maxVisits != null) rows = rows.filter((c) => (c.visitCount || 0) <= Number(maxVisits));
    if (minSpent != null) rows = rows.filter((c) => (c.totalSpent || 0) >= Number(minSpent));
    if (maxSpent != null) rows = rows.filter((c) => (c.totalSpent || 0) <= Number(maxSpent));
    if (sortBy === 'name') rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'totalSpent') rows.sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
    else if (sortBy === 'visitCount') rows.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
    return rows;
  },

  /** Full order history + spend + complaints + pending-payment exposure for
   * a customer — everything the detail view needs, derived from data that
   * already exists elsewhere (never invented), in one call. */
  async history(id, user) {
    const client = await repo('clients').getById(id);
    if (!client) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && client.restaurantId && client.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    const orders = (await repo('orders').getAll({ clientId: id, restaurantId: user?.restaurantId }))
      .sort((a, b) => (b.orderDate || 0) - (a.orderDate || 0));
    const pendingOrders = orders.filter((o) => o.status !== 'cancelled' && (o.paymentStatus || 'paid') === 'pending');
    const complaints = (await repo('complaints').getAll({ clientId: id, restaurantId: user?.restaurantId }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Most-ordered product — by total quantity across every non-cancelled
    // order, using whatever the order snapshotted at the time (product name/
    // id), so it stays correct even if the product is later renamed/deleted.
    const qtyByProduct = {};
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      for (const line of o.products || []) {
        const key = line.productId || line.name;
        if (!key) continue;
        if (!qtyByProduct[key]) qtyByProduct[key] = { productId: line.productId, name: line.name, quantity: 0 };
        qtyByProduct[key].quantity += line.quantity || 0;
      }
    }
    const topProduct = Object.values(qtyByProduct).sort((a, b) => b.quantity - a.quantity)[0] || null;

    return {
      client,
      orders,
      totalSpent: orders.reduce((s, o) => s + (o.totalPrice || 0), 0),
      orderCount: orders.length,
      lastOrderDate: orders[0]?.orderDate || null,
      topProduct,
      pendingPayments: { count: pendingOrders.length, total: +pendingOrders.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2) },
      complaints,
    };
  },
};

export default clientService;
