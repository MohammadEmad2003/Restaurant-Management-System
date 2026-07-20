import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('clients', { entityName: 'client' });

export const clientService = {
  ...base,

  async search({ phone, name } = {}, user) {
    const rows = await repo('clients').getAll({ restaurantId: user?.restaurantId });
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

  /** Advanced filter: governorate, visit count range, total spent range, sort. */
  async filter({ governorate, minVisits, maxVisits, minSpent, maxSpent, sortBy } = {}, user) {
    let rows = await repo('clients').getAll({ restaurantId: user?.restaurantId });
    if (governorate) rows = rows.filter((c) => c.governatorate === governorate);
    if (minVisits != null) rows = rows.filter((c) => (c.visitCount || 0) >= Number(minVisits));
    if (maxVisits != null) rows = rows.filter((c) => (c.visitCount || 0) <= Number(maxVisits));
    if (minSpent != null) rows = rows.filter((c) => (c.totalSpent || 0) >= Number(minSpent));
    if (maxSpent != null) rows = rows.filter((c) => (c.totalSpent || 0) <= Number(maxSpent));
    if (sortBy === 'name') rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'totalSpent') rows.sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
    else if (sortBy === 'visitCount') rows.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
    return rows;
  },

  /** Full order history + spend for a customer. */
  async history(id, user) {
    const client = await repo('clients').getById(id);
    if (!client) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && client.restaurantId && client.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    const orders = (await repo('orders').getAll({ clientId: id, restaurantId: user?.restaurantId }))
      .sort((a, b) => (b.orderDate || 0) - (a.orderDate || 0));
    return {
      client,
      orders,
      totalSpent: orders.reduce((s, o) => s + (o.totalPrice || 0), 0),
      orderCount: orders.length,
    };
  },
};

export default clientService;
