import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rentService } from './rentService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

test('paying rent in cash deducts it from the Cash Drawer balance; card/bank-transfer never touch it', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const cashRent = await rentService.create({ locationId: 'LOC-1', amount: 5000, dueDate: '2026-08-01' }, user);
  await rentService.pay(cashRent.id, { paymentMethod: 'cash' }, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), -5000);

  const cardRent = await rentService.create({ locationId: 'LOC-1', amount: 3000, dueDate: '2026-08-01' }, user);
  await rentService.pay(cardRent.id, { paymentMethod: 'card' }, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), -5000, 'a card payment must never touch the physical Cash Drawer');
});

test('deleting an already cash-paid rent reverses its Cash Drawer contribution', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const rent = await rentService.create({ locationId: 'LOC-1', amount: 4000, dueDate: '2026-08-01' }, user);
  await rentService.pay(rent.id, { paymentMethod: 'cash' }, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), -4000);

  await rentService.remove(rent.id, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), 0);
});
