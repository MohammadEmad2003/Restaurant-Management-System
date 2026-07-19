import { repo } from '../repositories/index.js';
import { financeService } from './financeService.js';
import { goodsService } from './goodsService.js';
import { goodsCheckService } from './goodsCheckService.js';

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

export const analyticsService = {
  async sales() {
    const orders = (await repo('orders').getAll()).filter((o) => o.status === 'completed');
    const today = dayKey(Date.now());
    const last7 = Date.now() - 7 * 864e5;
    const last30 = Date.now() - 30 * 864e5;

    const sum = (arr) => +arr.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2);
    const daily = sum(orders.filter((o) => dayKey(o.orderDate) === today));
    const weekly = sum(orders.filter((o) => o.orderDate >= last7));
    const monthly = sum(orders.filter((o) => o.orderDate >= last30));

    // product ranking
    const productQty = {};
    for (const o of orders) {
      for (const p of o.products || []) {
        const e = (productQty[p.productId] ||= { productId: p.productId, name: p.name, qty: 0, revenue: 0 });
        e.qty += p.quantity;
        e.revenue += p.quantity * p.unitPrice;
      }
    }
    const ranked = Object.values(productQty).sort((a, b) => b.qty - a.qty);
    return {
      daily, weekly, monthly,
      orderCount: orders.length,
      avgOrderValue: orders.length ? +(monthly / orders.filter((o) => o.orderDate >= last30).length || 0).toFixed(2) : 0,
      bestSelling: ranked.slice(0, 5),
      worstSelling: ranked.slice(-5).reverse(),
      trend: this._trend(orders),
    };
  },

  _trend(orders) {
    const buckets = {};
    for (let i = 13; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 864e5);
      buckets[k] = 0;
    }
    for (const o of orders) {
      const k = dayKey(o.orderDate);
      if (k in buckets) buckets[k] += o.totalPrice || 0;
    }
    return Object.entries(buckets).map(([key, value]) => ({ key, value: +value.toFixed(2) }));
  },

  async inventory() {
    const [valuation, low, waste] = await Promise.all([
      goodsService.valuation(),
      goodsService.lowStock(),
      goodsCheckService.wasteReport({}),
    ]);
    return {
      inventoryValue: valuation.totalValue,
      lowStockCount: low.length,
      lowStockItems: low.map((g) => ({ id: g.id, name: g.name, remaining: g.quantityAvailable, min: g.minimumStockLevel })),
      wasteValue: waste.totalLossValue,
      mostWasted: waste.mostWasted,
    };
  },

  async workers() {
    const [workers, attendance, orders] = await Promise.all([
      repo('workers').getAll(), repo('attendance').getAll(), repo('orders').getAll(),
    ]);
    const active = workers.filter((w) => w.status === 'active').length;
    const hoursByWorker = {};
    for (const a of attendance) hoursByWorker[a.workerId] = (hoursByWorker[a.workerId] || 0) + (a.totalHours || 0);
    const ordersByCashier = {};
    for (const o of orders) ordersByCashier[o.cashierId] = (ordersByCashier[o.cashierId] || 0) + 1;
    return {
      totalWorkers: workers.length,
      activeWorkers: active,
      productivity: workers.map((w) => ({
        workerId: w.id, name: w.name,
        hours: +(hoursByWorker[w.id] || 0).toFixed(1),
        orders: ordersByCashier[w.id] || 0,
      })).sort((a, b) => b.orders - a.orders),
    };
  },

  /**
   * Revenue, order count and gross profit grouped by the customer's location
   * (governorate · area). Orders snapshot the location at checkout; older orders
   * fall back to the linked client record. `from`/`to` bound the date range.
   */
  async byLocation({ from, to } = {}) {
    const [orders, products, goods, clients] = await Promise.all([
      repo('orders').getAll(), repo('products').getAll(), repo('goods').getAll(), repo('clients').getAll(),
    ]);
    const goodById = Object.fromEntries(goods.map((g) => [g.id, g]));
    const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
    const costByProduct = {};
    for (const p of products) {
      costByProduct[p.id] = (p.ingredients || []).reduce(
        (s, ing) => s + (ing.quantityRequired || 0) * (goodById[ing.goodId]?.purchasePrice || 0), 0);
    }
    const fromTs = from ? new Date(from).getTime() : -Infinity;
    const toTs = to ? new Date(to).getTime() + 864e5 : Infinity;
    const byArea = {};
    for (const o of orders.filter((x) => x.status === 'completed')) {
      if (!(o.orderDate >= fromTs && o.orderDate < toTs)) continue;
      const client = o.clientId ? clientById[o.clientId] : null;
      const governorate = o.governorate || client?.governorate || '';
      const area = o.area || client?.area || '';
      const name = area ? `${governorate ? governorate + ' · ' : ''}${area}` : (governorate || 'Walk-in / Unknown');
      const key = name;
      const b = (byArea[key] ||= { name, governorate, area, orders: 0, revenue: 0, profit: 0 });
      b.orders += 1;
      b.revenue += o.totalPrice || 0;
      for (const line of o.products || []) {
        b.profit += (line.unitPrice - (costByProduct[line.productId] || 0)) * line.quantity;
      }
    }
    return Object.values(byArea)
      .map((b) => ({ ...b, revenue: +b.revenue.toFixed(2), profit: +b.profit.toFixed(2) }))
      .sort((a, b) => b.revenue - a.revenue);
  },

  async customers() {
    const clients = await repo('clients').getAll();
    const top = [...clients].sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0)).slice(0, 5);
    const returning = clients.filter((c) => (c.visitCount || 0) > 1).length;
    return {
      totalCustomers: clients.length,
      returningCustomers: returning,
      retentionRate: clients.length ? +((returning / clients.length) * 100).toFixed(1) : 0,
      topCustomers: top.map((c) => ({ id: c.id, name: c.name, totalSpent: c.totalSpent, visits: c.visitCount })),
    };
  },

  /** Everything the admin dashboard needs in one call. */
  async dashboard() {
    const [sales, finance, inventory, workers, customers, locations] = await Promise.all([
      this.sales(),
      financeService.profit({ period: 'monthly' }),
      this.inventory(),
      this.workers(),
      this.customers(),
      this.byLocation(),
    ]);
    return { sales, finance, inventory, workers, customers, locations, generatedAt: Date.now() };
  },
};

export default analyticsService;
