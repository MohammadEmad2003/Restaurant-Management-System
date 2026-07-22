import { initSecureStore, secureStore } from '../repositories/secureStore.js';
import { superAdminService } from '../services/superAdminService.js';

/** Creates a fresh restaurant + admin + license for a test, returning the
 * activation token so the caller can activate it if needed. */
export async function createTestRestaurant(overrides = {}) {
  await initSecureStore();
  const suffix = Math.random().toString(36).slice(2, 8);
  const result = await superAdminService.createRestaurant({
    restaurantName: overrides.restaurantName || `Test Restaurant ${suffix}`,
    adminUsername: overrides.adminUsername || `admin_${suffix}`,
    adminPassword: overrides.adminPassword || 'admin12345',
    licenseOverrides: overrides.licenseOverrides || {},
  });
  return result;
}

export async function createCashier(restaurantId, overrides = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return superAdminService.createRestaurantUser(restaurantId, {
    username: overrides.username || `cashier_${suffix}`,
    password: overrides.password || 'cashier12345',
    role: 'CASHIER',
  });
}

export function store() {
  return secureStore();
}

export default { createTestRestaurant, createCashier, store };
