import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';

// Bounds for the numeric settings that feed directly into money/business
// calculations elsewhere (order totals, payroll, loyalty) — this route
// previously had no validation at all, so e.g. a negative deliveryFee would
// silently discount every delivery order, or a loyaltyRandomChance outside
// 0-1 would break the "random reward" probability check at order time.
const NUMERIC_BOUNDS = {
  taxRate: { min: 0 },
  loyaltyRate: { min: 0 },
  deliveryFee: { min: 0 },
  lateDeductionPerMin: { min: 0 },
  overtimeMultiplier: { min: 0 },
  posFontSize: { min: 1 },
  loyaltyMinOrderValue: { min: 0 },
  loyaltyVisitThreshold: { min: 0 },
  loyaltyBonusPoints: { min: 0 },
  loyaltyRandomChance: { min: 0, max: 1 },
  loyaltyRandomPoints: { min: 0 },
};

const DEFAULTS = {
  currency: 'EGP',
  taxRate: 0,
  loyaltyRate: 0.1,
  deliveryFee: 0,
  lateDeductionPerMin: 0,
  overtimeMultiplier: 1.5,
  posFontSize: 14,
  posFontFamily: 'inherit',
  loyaltyMinOrderValue: 0,
  loyaltyVisitThreshold: 5,
  loyaltyBonusPoints: 50,
  loyaltyRandomChance: 0,
  loyaltyRandomPoints: 25,
};

export const settingsService = {
  async get(user) {
    let rows = await repo('settings').getAll({ restaurantId: user?.restaurantId });
    if (!rows.length && user?.restaurantId) {
      const created = await repo('settings').create({ restaurantId: user.restaurantId, ...DEFAULTS });
      rows = [created];
    }
    const s = rows[0] || {};
    return { ...DEFAULTS, ...s };
  },

  async update(patch, user) {
    const sanitized = { ...patch };
    for (const [key, { min, max }] of Object.entries(NUMERIC_BOUNDS)) {
      if (sanitized[key] === undefined) continue;
      const n = Number(sanitized[key]);
      if (!Number.isFinite(n) || n < min || (max !== undefined && n > max)) {
        throw new HttpError(400, `${key} must be a number ${max !== undefined ? `between ${min} and ${max}` : `of at least ${min}`}`);
      }
      sanitized[key] = n;
    }
    const current = (await repo('settings').getAll({ restaurantId: user?.restaurantId }))[0];
    return current
      ? repo('settings').update(current.id, { ...sanitized, restaurantId: user?.restaurantId })
      : repo('settings').create({ ...sanitized, restaurantId: user?.restaurantId });
  },
};

export default settingsService;
