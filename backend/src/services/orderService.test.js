import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderService } from './orderService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

test('creating an order with another restaurant\'s clientId is rejected (cross-tenant IDOR regression)', async () => {
  const { restaurant: restaurantA, admin: adminA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();

  const clientB = await repo('clients').create({
    name: 'Restaurant B Client', phoneNumbers: ['0100000000'], totalSpent: 0, loyaltyPoints: 0, visitCount: 0,
    restaurantId: restaurantB.id,
  });

  await assert.rejects(
    () => orderService.create({ clientId: clientB.id, products: [], walkIn: true }, { restaurantId: restaurantA.id, sub: adminA.id }),
    /Invalid client/,
  );

  const unchanged = await repo('clients').getById(clientB.id);
  assert.equal(unchanged.totalSpent, 0);
  assert.equal(unchanged.loyaltyPoints, 0);
});

test('creating an order with your own restaurant\'s clientId succeeds', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const client = await repo('clients').create({
    name: 'Own Client', phoneNumbers: ['0111111111'], totalSpent: 0, loyaltyPoints: 0, visitCount: 0,
    restaurantId: restaurant.id,
  });
  const order = await orderService.create({ clientId: client.id, products: [], walkIn: true }, { restaurantId: restaurant.id, sub: admin.id });
  assert.equal(order.clientName, 'Own Client');
});
