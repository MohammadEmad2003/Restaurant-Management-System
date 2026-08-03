import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goodsCheckService } from './goodsCheckService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

async function makeGood(restaurantId, overrides = {}) {
  return repo('goods').create({
    name: 'Flour', unit: 'kg', quantityAvailable: 10, minimumStockLevel: 2, purchasePrice: 5,
    restaurantId, ...overrides,
  });
}

// Regression: a blank/non-numeric actualQuantity used to silently set
// quantityAvailable to NaN, permanently breaking that item's low-stock alert
// (`NaN <= x` is always false) — the same class of bug already fixed for
// goodsService.purchase() but left unfixed here.
test('goodsCheckService.create rejects a non-numeric actualQuantity', async () => {
  const { restaurant } = await createTestRestaurant();
  const good = await makeGood(restaurant.id);
  await assert.rejects(
    () => goodsCheckService.create({ goodId: good.id, actualQuantity: 'a lot' }, { restaurantId: restaurant.id }),
    /actualQuantity must be a non-negative number/,
  );
  const unchanged = await repo('goods').getById(good.id);
  assert.equal(unchanged.quantityAvailable, 10, 'a rejected count must not mutate stock at all');
});

test('goodsCheckService.create rejects a negative actualQuantity', async () => {
  const { restaurant } = await createTestRestaurant();
  const good = await makeGood(restaurant.id);
  await assert.rejects(
    () => goodsCheckService.create({ goodId: good.id, actualQuantity: -1 }, { restaurantId: restaurant.id }),
    /actualQuantity must be a non-negative number/,
  );
});

test('goodsCheckService.create computes difference/loss and adjusts stock to the counted value', async () => {
  const { restaurant } = await createTestRestaurant();
  const good = await makeGood(restaurant.id);
  const check = await goodsCheckService.create({ goodId: good.id, actualQuantity: 7, reason: 'Spillage' }, { restaurantId: restaurant.id });
  assert.equal(check.expectedQuantity, 10);
  assert.equal(check.actualQuantity, 7);
  assert.equal(check.difference, 3);
  assert.equal(check.lossValue, 15); // 3 * purchasePrice(5)
  const updated = await repo('goods').getById(good.id);
  assert.equal(updated.quantityAvailable, 7);
});

test('goodsCheckService.create is rejected for another restaurant\'s good (cross-tenant IDOR regression)', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();
  const goodB = await makeGood(restaurantB.id);
  await assert.rejects(
    () => goodsCheckService.create({ goodId: goodB.id, actualQuantity: 5 }, { restaurantId: restaurantA.id }),
    /good not found/,
  );
});
