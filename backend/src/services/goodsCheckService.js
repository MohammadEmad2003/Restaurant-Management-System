import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { shortCode } from '../utils/ids.js';
import { withLock } from '../utils/lock.js';

export const goodsCheckService = {
  list: (filter, user) => repo('goodsChecks').getAll({ ...filter, restaurantId: user?.restaurantId }),

  /** Submit a physical count → compute loss, adjust inventory to actual. */
  async create(data, user) {
    const good = await repo('goods').getById(data.goodId);
    if (!good) throw new HttpError(404, 'good not found');
    if (user?.restaurantId && good.restaurantId && good.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'good not found');
    }
    const expectedQuantity = good.quantityAvailable;
    const actualQuantity = Number(data.actualQuantity);
    // Without this, a blank/non-numeric physical-count entry (no
    // validateBody schema covers this route) silently sets
    // quantityAvailable to NaN — permanently breaking that item's low-stock
    // alert (`NaN <= x` is always false), the same class of bug already
    // fixed for goodsService.purchase() but left unfixed here.
    if (!Number.isFinite(actualQuantity) || actualQuantity < 0) {
      throw new HttpError(400, 'actualQuantity must be a non-negative number');
    }
    const difference = +(expectedQuantity - actualQuantity).toFixed(3);

    const check = await repo('goodsChecks').create({
      ...data,
      auditId: shortCode('AUD'),
      expectedQuantity,
      actualQuantity,
      difference,
      lossValue: +(Math.max(0, difference) * (good.purchasePrice || 0)).toFixed(2),
      checkedBy: user?.sub || null,
      date: data.date || new Date().toISOString().slice(0, 10),
      restaurantId: user?.restaurantId,
    });
    // Locked and re-set from the value just counted (not adjusted from a
    // re-read) — a physical count is an authoritative correction, but it
    // must still be serialized against a concurrent order's deduction on
    // the same good so neither write is silently lost (the same race
    // already fixed for deductInventory, applied here too).
    await withLock(`inventory-${good.id}`, () => repo('goods').update(good.id, { quantityAvailable: actualQuantity }));
    return check;
  },

  /** Waste report across a date range, optionally filtered by reason. */
  async wasteReport({ from, to, reason } = {}, user) {
    let checks = await repo('goodsChecks').getAll({ restaurantId: user?.restaurantId });
    if (from) checks = checks.filter((c) => c.date >= from);
    if (to) checks = checks.filter((c) => c.date <= to);
    if (reason) checks = checks.filter((c) => c.reason === reason);
    const goods = await repo('goods').getAll({ restaurantId: user?.restaurantId });
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
