import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rentService } from './rentService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

test('paying rent (cash or otherwise) does NOT touch the Cash Drawer/Cash Ledger at all — it is bookkeeping only', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const cashRent = await rentService.create({ locationId: 'LOC-1', amount: 5000, dueDate: '2026-08-01' }, user);
  const paid = await rentService.pay(cashRent.id, { paymentMethod: 'cash' }, user);
  assert.equal(paid.status, 'paid');
  assert.ok(paid.paidDate);
  assert.equal(await cashLedgerService.balance(restaurant.id), 0, 'rent must never affect the Cash Drawer, even when "paid in cash"');
});

test('markUnpaid() reverses pay() — status back to upcoming, paidDate cleared, still no Cash Ledger effect', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const rent = await rentService.create({ locationId: 'LOC-1', amount: 4000, dueDate: '2026-08-01' }, user);
  await rentService.pay(rent.id, { paymentMethod: 'cash' }, user);

  const reverted = await rentService.markUnpaid(rent.id, user);
  assert.equal(reverted.status, 'upcoming');
  assert.equal(reverted.paidDate, null);
  assert.equal(await cashLedgerService.balance(restaurant.id), 0);
});

test('deleting a paid rent has no Cash Ledger effect either', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const rent = await rentService.create({ locationId: 'LOC-1', amount: 4000, dueDate: '2026-08-01' }, user);
  await rentService.pay(rent.id, { paymentMethod: 'cash' }, user);
  await rentService.remove(rent.id, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), 0);
});

test('create() defaults initialDate to today when not given, and preserves it when explicitly set', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  const today = new Date().toISOString().slice(0, 10);

  const withDefault = await rentService.create({ locationId: 'LOC-1', amount: 1000, dueDate: '2026-08-01' }, user);
  assert.equal(withDefault.initialDate, today);

  const withExplicit = await rentService.create({ locationId: 'LOC-1', amount: 1000, dueDate: '2026-08-01', initialDate: '2025-01-01' }, user);
  assert.equal(withExplicit.initialDate, '2025-01-01');
});

test('paymentHistory keeps a full log across pay/unpay/pay again — it is never overwritten, only appended to', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const rent = await rentService.create({ locationId: 'LOC-1', amount: 1500, dueDate: '2026-08-01' }, user);
  const paid1 = await rentService.pay(rent.id, { paymentMethod: 'cash' }, user);
  assert.equal(paid1.paymentHistory.length, 1);
  assert.equal(paid1.paymentHistory[0].amount, 1500);

  await rentService.markUnpaid(rent.id, user);
  const paid2 = await rentService.pay(rent.id, { paymentMethod: 'card' }, user);
  assert.equal(paid2.paymentHistory.length, 2, 'unpaying and paying again must APPEND, not overwrite, the history');
  assert.equal(paid2.paymentHistory[0].paymentMethod, 'cash', 'the first payment is still there');
  assert.equal(paid2.paymentHistory[1].paymentMethod, 'card', 'the second payment is recorded too');
});
