import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goodsService } from './goodsService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

async function makeGood(restaurantId, overrides = {}) {
  return repo('goods').create({
    name: 'Flour', unit: 'kg', quantityAvailable: 10, minimumStockLevel: 2, purchasePrice: 5,
    restaurantId, ...overrides,
  });
}

// Regression: quantity/unitPrice previously reached `repo.update` unvalidated,
// so a bad request left quantityAvailable as NaN — permanently breaking the
// low-stock check (`NaN <= x` is always false) for that item.
test('purchase rejects a non-numeric or non-positive quantity', async () => {
  const { restaurant } = await createTestRestaurant();
  const good = await makeGood(restaurant.id);
  await assert.rejects(() => goodsService.purchase(good.id, { quantity: 'abc', unitPrice: 5 }, { restaurantId: restaurant.id }), /quantity must be a positive number/);
  await assert.rejects(() => goodsService.purchase(good.id, { quantity: 0, unitPrice: 5 }, { restaurantId: restaurant.id }), /quantity must be a positive number/);
  await assert.rejects(() => goodsService.purchase(good.id, { quantity: -3, unitPrice: 5 }, { restaurantId: restaurant.id }), /quantity must be a positive number/);
  const unchanged = await repo('goods').getById(good.id);
  assert.equal(unchanged.quantityAvailable, 10, 'a rejected purchase must not mutate stock at all');
});

test('purchase rejects a negative unitPrice', async () => {
  const { restaurant } = await createTestRestaurant();
  const good = await makeGood(restaurant.id);
  await assert.rejects(() => goodsService.purchase(good.id, { quantity: 5, unitPrice: -1 }, { restaurantId: restaurant.id }), /unitPrice must be a non-negative number/);
});

test('a valid purchase increases quantityAvailable and updates purchasePrice', async () => {
  const { restaurant } = await createTestRestaurant();
  const good = await makeGood(restaurant.id);
  const updated = await goodsService.purchase(good.id, { quantity: 5, unitPrice: 6 }, { restaurantId: restaurant.id });
  assert.equal(updated.quantityAvailable, 15);
  assert.equal(updated.purchasePrice, 6);
});

test('purchase is rejected for another restaurant\'s good (cross-tenant IDOR regression)', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();
  const goodB = await makeGood(restaurantB.id);
  await assert.rejects(() => goodsService.purchase(goodB.id, { quantity: 5, unitPrice: 5 }, { restaurantId: restaurantA.id }), /good not found/);
});
