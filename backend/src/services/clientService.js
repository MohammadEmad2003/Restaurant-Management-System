import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('clients', { entityName: 'client' });

export const clientService = {
  ...base,

  async search({ phone, name }) {
    const rows = await repo('clients').getAll();
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
    const phoneNumbers = [...new Set([...(client.phoneNumbers || []), phone])];
    return base.update(id, { phoneNumbers }, user);
  },

  async addAddress(id, address, user) {
    const client = await repo('clients').getById(id);
    if (!client) throw new HttpError(404, 'client not found');
    const addresses = [...(client.addresses || []), address];
    return base.update(id, { addresses }, user);
  },

  /** Full order history + spend for a customer. */
  async history(id) {
    const client = await repo('clients').getById(id);
    if (!client) throw new HttpError(404, 'client not found');
    const orders = (await repo('orders').getAll({ clientId: id }))
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
