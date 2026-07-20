import { repo } from '../repositories/index.js';

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
};

export default settingsService;
