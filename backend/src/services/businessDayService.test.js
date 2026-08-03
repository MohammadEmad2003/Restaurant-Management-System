import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderService } from './orderService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { businessDayService } from './businessDayService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

async function makeProduct(restaurantId, price) {
  return repo('products').create({ name: 'Numbering Item', category: 'Main', price, active: true, restaurantId });
}

test('takeaway and delivery orders get independent sequential numbers (T-001, T-002… / D-001, D-002…)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 50);
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const t1 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 50 }], walkIn: true }, user);
  const d1 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 50 }], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW' }, user);
  const t2 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 50 }], walkIn: true }, user);
  const d2 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 50 }], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW' }, user);

  assert.equal(t1.orderNumber, 'T-001');
  assert.equal(t2.orderNumber, 'T-002');
  assert.equal(d1.orderNumber, 'D-001');
  assert.equal(d2.orderNumber, 'D-002');
  // invoiceNo is the same value everywhere else in the app already reads.
  assert.equal(t1.invoiceNo, t1.orderNumber);
  assert.equal(d1.invoiceNo, d1.orderNumber);
  // The database primary key remains its own stable, non-sequential id.
  assert.notEqual(t1.id, t1.orderNumber);
  assert.match(t1.id, /^ORD-/);
});

test('order numbers stay unique and sequential under concurrent creation (no duplicates, no gaps)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 20);
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const orders = await Promise.all(
    Array.from({ length: 10 }, () => orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 20 }], walkIn: true }, user)),
  );
  const numbers = orders.map((o) => o.orderNumber).sort();
  const expected = Array.from({ length: 10 }, (_, i) => `T-${String(i + 1).padStart(3, '0')}`);
  assert.deepEqual(numbers, expected, 'ten concurrent creates must yield exactly T-001..T-010 with no duplicates or gaps');
});

test('business day resets numbering only when a shift opens with NO other shift currently open — not at calendar midnight, and not merely because a second shift opens concurrently', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashierA = await createCashier(restaurant.id, { username: `bda_${Math.random().toString(36).slice(2, 8)}` });
  const cashierB = await createCashier(restaurant.id, { username: `bdb_${Math.random().toString(36).slice(2, 8)}` });
  const product = await makeProduct(restaurant.id, 30);
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userA = { sub: cashierA.id, restaurantId: restaurant.id };
  const userB = { sub: cashierB.id, restaurantId: restaurant.id };

  // First shift of the (implicit) first business day.
  const shiftA = await cashierShiftService.open(userA, { openingFloat: 0 });
  const day1 = await businessDayService.getOrInit(restaurant.id);

  const o1 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 30 }], walkIn: true }, adminUser);
  assert.equal(o1.orderNumber, 'T-001');

  // A second shift opening WHILE the first is still open must NOT reset the day.
  const shiftB = await cashierShiftService.open(userB, { openingFloat: 0 });
  const dayAfterSecondOpen = await businessDayService.getOrInit(restaurant.id);
  assert.equal(dayAfterSecondOpen.dayIndex, day1.dayIndex, 'a second shift opening while one is already open must not start a new business day');

  const o2 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 30 }], walkIn: true }, adminUser);
  assert.equal(o2.orderNumber, 'T-002', 'numbering continues within the same business day');

  // Close both shifts — the business day is "over" but numbering must not
  // reset just from closing (only the NEXT shift open decides that).
  await cashierShiftService.close(shiftA.id, userA, { countedCash: 0, depositedToOwner: false });
  await cashierShiftService.close(shiftB.id, userB, { countedCash: 0, depositedToOwner: false });
  const dayAfterAllClosed = await businessDayService.getOrInit(restaurant.id);
  assert.equal(dayAfterAllClosed.dayIndex, day1.dayIndex, 'closing every shift must not, by itself, reset the business day');

  // The next shift to open — with nothing else open — starts a NEW business day.
  await cashierShiftService.open(userA, { openingFloat: 0 });
  const day2 = await businessDayService.getOrInit(restaurant.id);
  assert.equal(day2.dayIndex, day1.dayIndex + 1, 'the first shift opened after every prior shift closed starts a new business day');

  const o3 = await orderService.create({ products: [{ productId: product.id, quantity: 1, unitPrice: 30 }], walkIn: true }, adminUser);
  assert.equal(o3.orderNumber, 'T-001', 'takeaway numbering resets to 1 for the new business day');
});

// Regression: maybeStartNewDay and nextOrderNumber used to lock on different
// keys (`business-day-${id}` vs `order-number-${id}`) despite both
// read-modify-writing the same businessDays row — since orders can be
// created with no shift open at all (by design), a day-rollover and an
// order-number mint could interleave and revive a stale pre-reset counter.
// They now share one lock key; this proves no duplicate/corrupted number
// can result even when a rollover races a burst of concurrent mints.
test('nextOrderNumber stays unique even when racing a concurrent maybeStartNewDay rollover', async () => {
  const { restaurant } = await createTestRestaurant();
  await businessDayService.nextOrderNumber(restaurant.id, false);
  await businessDayService.nextOrderNumber(restaurant.id, false);

  const [numbers] = await Promise.all([
    Promise.all(Array.from({ length: 5 }, () => businessDayService.nextOrderNumber(restaurant.id, false))),
    businessDayService.maybeStartNewDay(restaurant.id), // no open shifts → this actually resets
  ]);
  assert.equal(new Set(numbers).size, numbers.length, 'no two concurrent order numbers may collide, even when a day-rollover races them');
});

test('reopening a closed shift does not itself start a new business day', async () => {
  const { restaurant } = await createTestRestaurant();
  const cashier = await createCashier(restaurant.id, { username: `bdc_${Math.random().toString(36).slice(2, 8)}` });
  const user = { sub: cashier.id, restaurantId: restaurant.id };

  const shift = await cashierShiftService.open(user, { openingFloat: 0 });
  const day1 = await businessDayService.getOrInit(restaurant.id);
  await cashierShiftService.close(shift.id, user, { countedCash: 0, depositedToOwner: false });
  await cashierShiftService.reopen(shift.id, user);
  const dayAfterReopen = await businessDayService.getOrInit(restaurant.id);
  assert.equal(dayAfterReopen.dayIndex, day1.dayIndex, 'reopen() is a distinct action from open() and must not advance the business day');
});
