import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';

const base = createCrudService('branches', { entityName: 'branch' });

export const branchService = {
  ...base,

  /** Compare revenue, orders and expenses per branch. */
  async compare() {
    const [branches, orders, expenses] = await Promise.all([
      repo('branches').getAll(), repo('orders').getAll(), repo('expenses').getAll(),
    ]);
    return branches.map((b) => {
      const bOrders = orders.filter((o) => o.branchId === b.id && o.status === 'completed');
      const revenue = +bOrders.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2);
      const exp = +expenses.filter((e) => e.branchId === b.id).reduce((s, e) => s + (e.amount || 0), 0).toFixed(2);
      return {
        branchId: b.id, name: b.name,
        revenue, orders: bOrders.length, expenses: exp,
        profit: +(revenue - exp).toFixed(2),
      };
    });
  },
};

export default branchService;
