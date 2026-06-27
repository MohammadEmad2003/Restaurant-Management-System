import { repo } from '../repositories/index.js';

const DEFAULTS = {
  currency: 'EGP',
  taxRate: 0,
  loyaltyRate: 0.1,
  deliveryFee: 0,          // flat delivery fee added to phone/delivery orders
  lateDeductionPerMin: 0,  // salary deduction per late minute
  overtimeMultiplier: 1.5, // overtime pay = hourlyRate × this
};

export const settingsService = {
  async get() {
    const s = (await repo('settings').getAll())[0] || {};
    return { ...DEFAULTS, ...s };
  },
};

export default settingsService;
