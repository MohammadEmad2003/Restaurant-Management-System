import { test } from 'node:test';
import assert from 'node:assert/strict';
import { superAdminService } from './superAdminService.js';
import { initSecureStore } from '../repositories/secureStore.js';

test('restaurant names are unique, case-insensitively and trimmed', async () => {
  await initSecureStore();
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Pizza House ${suffix}`;
  await superAdminService.createRestaurant({ restaurantName: name, adminUsername: `admin_${suffix}`, adminPassword: 'admin12345' });

  await assert.rejects(
    () => superAdminService.createRestaurant({
      restaurantName: `  ${name.toUpperCase()}  `,
      adminUsername: `admin2_${suffix}`,
      adminPassword: 'admin12345',
    }),
    /already exists/,
  );
});

test('a different restaurant name is allowed', async () => {
  await initSecureStore();
  const suffix = Math.random().toString(36).slice(2, 8);
  const a = await superAdminService.createRestaurant({ restaurantName: `Cafe A ${suffix}`, adminUsername: `a_${suffix}`, adminPassword: 'admin12345' });
  const b = await superAdminService.createRestaurant({ restaurantName: `Cafe B ${suffix}`, adminUsername: `b_${suffix}`, adminPassword: 'admin12345' });
  assert.notEqual(a.restaurant.id, b.restaurant.id);
});
