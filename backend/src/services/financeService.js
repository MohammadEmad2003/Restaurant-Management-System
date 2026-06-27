import { repo } from '../repositories/index.js';

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
const monthKey = (ts) => new Date(ts).toISOString().slice(0, 7);

function periodKey(ts, period) {
  const d = new Date(ts);
  if (period === 'daily') return dayKey(ts);
  if (period === 'monthly') return monthKey(ts);
  if (period === 'annual') return String(d.getFullYear());
  if (period === 'weekly') {
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return dayKey(ts);
}

async function completedOrders() {
  return (await repo('orders').getAll()).filter((o) => o.status === 'completed');
}

/** Build a [from, to) millisecond window from optional YYYY-MM-DD bounds. */
function range({ from, to } = {}) {
  return {
    fromTs: from ? new Date(from).getTime() : -Infinity,
    toTs: to ? new Date(to).getTime() + 864e5 : Infinity, // inclusive of the "to" day
  };
}

export const financeService = {
  async income({ period = 'daily', from, to } = {}) {
    const orders = await completedOrders();
    const { fromTs, toTs } = range({ from, to });
    const buckets = {};
    for (const o of orders) {
      const ts = o.orderDate || o.createdAt;
      if (!(ts >= fromTs && ts < toTs)) continue;
      const k = periodKey(ts, period);
      buckets[k] = +((buckets[k] || 0) + (o.totalPrice || 0)).toFixed(2);
    }
    const series = Object.entries(buckets).map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
    return { period, total: +series.reduce((s, x) => s + x.value, 0).toFixed(2), series };
  },

  async expenses({ period = 'daily', from, to } = {}) {
    const rows = await repo('expenses').getAll();
    const { fromTs, toTs } = range({ from, to });
    const buckets = {};
    const byType = {};
    for (const e of rows) {
      const ts = e.date ? new Date(e.date).getTime() : e.createdAt;
      if (!(ts >= fromTs && ts < toTs)) continue;
      const k = periodKey(ts, period);
      buckets[k] = +((buckets[k] || 0) + (e.amount || 0)).toFixed(2);
      byType[e.type] = +((byType[e.type] || 0) + (e.amount || 0)).toFixed(2);
    }
    const series = Object.entries(buckets).map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
    return { period, total: +series.reduce((s, x) => s + x.value, 0).toFixed(2), byType, series };
  },

  async profit({ period = 'monthly', from, to } = {}) {
    const [inc, exp] = await Promise.all([this.income({ period, from, to }), this.expenses({ period, from, to })]);
    const net = +(inc.total - exp.total).toFixed(2);
    const margin = inc.total ? +((net / inc.total) * 100).toFixed(1) : 0;
    return { period, revenue: inc.total, expenses: exp.total, netProfit: net, profitMargin: margin };
  },

  async cashflow({ period = 'monthly', from, to } = {}) {
    const [inc, exp] = await Promise.all([this.income({ period, from, to }), this.expenses({ period, from, to })]);
    const keys = [...new Set([...inc.series.map((s) => s.key), ...exp.series.map((s) => s.key)])].sort();
    const incMap = Object.fromEntries(inc.series.map((s) => [s.key, s.value]));
    const expMap = Object.fromEntries(exp.series.map((s) => [s.key, s.value]));
    return {
      period,
      series: keys.map((key) => ({
        key, inflow: incMap[key] || 0, outflow: expMap[key] || 0,
        net: +((incMap[key] || 0) - (expMap[key] || 0)).toFixed(2),
      })),
    };
  },
};

export default financeService;
