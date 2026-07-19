import { repo } from '../repositories/index.js';

const DEFAULTS = {
  currency: 'EGP',
  taxRate: 0,
  loyaltyRate: 0.1,              // points per currency unit spent
  deliveryFee: 0,                // flat delivery fee added to phone/delivery orders
  lateDeductionPerMin: 0,        // salary deduction per late minute
  overtimeMultiplier: 1.5,       // overtime pay = hourlyRate × this
  posFontSize: 14,               // default font size in pixels for POS interface
  posFontFamily: 'inherit',      // default font family (inherit from browser)
  // Loyalty automation triggers
  loyaltyMinOrderValue: 0,       // minimum order total to earn points
  loyaltyVisitThreshold: 5,      // number of visits to trigger bonus reward
  loyaltyBonusPoints: 50,        // points awarded when visit threshold is reached
  loyaltyRandomChance: 0,        // 0-1 probability of random reward on each order
  loyaltyRandomPoints: 25,       // points awarded for random selection
};

/**
 * Settings service that merges user overrides with default values.
 */
export const settingsService = {
  /**
   * Retrieve the merged settings object (defaults + user overrides).
   * @returns {Promise<Object>} The application settings.
   */
  async get() {
    const s = (await repo('settings').getAll())[0] || {};
    return { ...DEFAULTS, ...s };
  },
};

export default settingsService;
