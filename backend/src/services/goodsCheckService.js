import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

export const goodsCheckService = {
  list: (filter) => repo('goodsChecks').getAll(filter),

  /** Submit a physical count → compute loss, adjust inventory to actual. */
  async create(data, user) {
    const good = await repo('goods').getById(data.goodId);
    if (!good) throw new HttpError(404, 'good not found');
    const expectedQuantity = good.quantityAvailable;
    const actualQuantity = Number(data.actualQuantity);
    const difference = +(expectedQuantity - actualQuantity).toFixed(3); // positive = loss

    const check = await repo('goodsChecks').create({
      ...data,
      expectedQuantity,
      actualQuantity,
      difference,
      lossValue: +(Math.max(0, difference) * (good.purchasePrice || 0)).toFixed(2),
      checkedBy: user?.sub || null,
      date: data.date || new Date().toISOString().slice(0, 10),
    });
    // adjust system stock to the counted reality
    await repo('goods').update(good.id, { quantityAvailable: actualQuantity });
    await recordAudit(user, 'GOODS_CHECKED', 'goodsChecks', check.id, { after: check });
    return check;
  },

  /** Waste report across a date range. */
  async wasteReport({ from, to } = {}) {
    let checks = await repo('goodsChecks').getAll();
    if (from) checks = checks.filter((c) => c.date >= from);
    if (to) checks = checks.filter((c) => c.date <= to);
    const goods = await repo('goods').getAll();
    const byGood = {};
    let totalLossValue = 0;
    for (const c of checks) {
      const loss = Math.max(0, c.difference || 0);
      const g = (byGood[c.goodId] ||= {
        goodId: c.goodId,
        name: goods.find((x) => x.id === c.goodId)?.name || c.goodId,
        totalLoss: 0, lossValue: 0, checks: 0,
      });
      g.totalLoss += loss;
      g.lossValue += c.lossValue || 0;
      g.checks += 1;
      totalLossValue += c.lossValue || 0;
    }
    const items = Object.values(byGood).sort((a, b) => b.lossValue - a.lossValue);
    return {
      items,
      totalLossValue: +totalLossValue.toFixed(2),
      mostWasted: items[0]?.name || null,
    };
  },
};

export default goodsCheckService;
