import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsService } from './settingsService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

// Regression: PUT /settings previously wrote whatever the client sent
// straight through — a negative deliveryFee silently discounted every
// delivery order, and a loyaltyRandomChance outside 0-1 broke the random
// reward probability check at order time.
test('update rejects a negative deliveryFee', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => settingsService.update({ deliveryFee: -5 }, { restaurantId: restaurant.id }), /deliveryFee must be a number/);
});

test('update rejects a non-numeric taxRate', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => settingsService.update({ taxRate: 'abc' }, { restaurantId: restaurant.id }), /taxRate must be a number/);
});

test('update rejects a loyaltyRandomChance outside the 0-1 probability range', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => settingsService.update({ loyaltyRandomChance: 1.5 }, { restaurantId: restaurant.id }), /loyaltyRandomChance must be a number between 0 and 1/);
  await assert.rejects(() => settingsService.update({ loyaltyRandomChance: -0.1 }, { restaurantId: restaurant.id }), /loyaltyRandomChance must be a number between 0 and 1/);
});

test('update accepts and persists valid numeric settings, leaving non-numeric fields untouched', async () => {
  const { restaurant } = await createTestRestaurant();
  const updated = await settingsService.update({ taxRate: 0.14, currency: 'USD' }, { restaurantId: restaurant.id });
  assert.equal(updated.taxRate, 0.14);
  assert.equal(updated.currency, 'USD');
  const fetched = await settingsService.get({ restaurantId: restaurant.id });
  assert.equal(fetched.taxRate, 0.14);
});
