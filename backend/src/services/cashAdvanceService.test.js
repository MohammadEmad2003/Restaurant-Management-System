import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashAdvanceService } from './cashAdvanceService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

test('Cash Advance decreases the Restaurant-wide Cash Drawer exactly once', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  await cashierShiftService.open(user, { openingFloat: 5000 });
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000);

  await cashAdvanceService.create({ workerId: 'WRK-1', workerName: 'Ali', amount: 500, date: '2026-01-01' }, user);

  assert.equal((await cashierShiftService.currentAll(user)).total, 4500, 'Cash Advance must subtract exactly 500');
});

test('Cash Advance does not require an active Cashier Shift and still affects the Restaurant-wide balance', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashier = await createCashier(restaurant.id, { username: 'advance_no_shift_cashier' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const cashierUser = { sub: cashier.id, restaurantId: restaurant.id };

  assert.equal(await cashierShiftService.current(cashierUser), null, 'cashier has no open shift');
  await cashAdvanceService.create({ workerId: 'WRK-2', workerName: 'Sara', amount: 300, date: '2026-01-01' }, cashierUser);

  assert.equal((await cashierShiftService.currentAll(adminUser)).total, -300, 'the advance must still be recorded even with no active shift');
});

test('Cash Advance persists across a Cashier logout/login (a different Cashier still sees the correct balance)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashierA = await createCashier(restaurant.id, { username: 'advance_cashier_a' });
  const cashierB = await createCashier(restaurant.id, { username: 'advance_cashier_b' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userA = { sub: cashierA.id, restaurantId: restaurant.id };
  const userB = { sub: cashierB.id, restaurantId: restaurant.id };

  await cashierShiftService.open(userA, { openingFloat: 1000 });
  await cashAdvanceService.create({ workerId: 'WRK-3', workerName: 'Omar', amount: 400, date: '2026-01-01' }, userA);
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 600);

  // Cashier A "logs out" (simulated: just a new session for Cashier B, no shift for B).
  assert.equal(await cashierShiftService.current(userB), null);
  assert.equal((await cashierShiftService.currentAll(userB)).total, 600, 'Cashier B must see the same, correct balance');
});

test('A rapid duplicate Cash Advance request (double-click) does not double-subtract', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const payload = { workerId: 'WRK-4', workerName: 'Duplicate Test', amount: 200, date: '2026-01-01' };
  const [first, second] = await Promise.all([
    cashAdvanceService.create(payload, user),
    cashAdvanceService.create(payload, user),
  ]);

  assert.equal(first.id, second.id, 'the second concurrent identical request must return the same advance, not create a new one');
  assert.equal((await cashierShiftService.currentAll(user)).total, 800, 'balance must only decrease by 200 once, not 400');
});

test('A genuinely separate Cash Advance for the same worker/amount/date (outside the duplicate window) is NOT blocked', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const advance1 = await cashAdvanceService.create({ workerId: 'WRK-5', workerName: 'Later Test', amount: 100, date: '2026-01-01' }, user);
  // Directly backdate the first advance's createdAt so it falls outside the
  // dedupe window, simulating enough real time having passed.
  const { repo } = await import('../repositories/index.js');
  await repo('cashAdvances').update(advance1.id, { createdAt: Date.now() - 60_000 });

  const advance2 = await cashAdvanceService.create({ workerId: 'WRK-5', workerName: 'Later Test', amount: 100, date: '2026-01-01' }, user);
  assert.notEqual(advance1.id, advance2.id, 'a later, legitimately separate advance must not be treated as a duplicate');
  assert.equal((await cashierShiftService.currentAll(user)).total, 800, '1000 - 100 - 100');
});

test('Deleting a Cash Advance reverses its Cash Ledger contribution back to zero', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const advance = await cashAdvanceService.create({ workerId: 'WRK-6', workerName: 'Remove Test', amount: 250, date: '2026-01-01' }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 750);

  await cashAdvanceService.remove(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'deleting the advance must restore the balance exactly');
});

test('Editing a Cash Advance amount adjusts the Cash Ledger by exactly the delta', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const advance = await cashAdvanceService.create({ workerId: 'WRK-7', workerName: 'Edit Test', amount: 200, date: '2026-01-01' }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 800);

  await cashAdvanceService.update(advance.id, { amount: 350 }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 650, '1000 - 350');

  await cashAdvanceService.update(advance.id, { amount: 100 }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 900, '1000 - 100');
});

test('Cash Advance is restaurant-scoped — one restaurant\'s advance never affects another restaurant\'s balance', async () => {
  const { restaurant: restaurantA, admin: adminA } = await createTestRestaurant();
  const { restaurant: restaurantB, admin: adminB } = await createTestRestaurant();
  const userA = { sub: adminA.id, restaurantId: restaurantA.id };
  const userB = { sub: adminB.id, restaurantId: restaurantB.id };

  await cashierShiftService.open(userA, { openingFloat: 1000 });
  await cashierShiftService.open(userB, { openingFloat: 1000 });

  await cashAdvanceService.create({ workerId: 'WRK-8', workerName: 'Isolation Test', amount: 500, date: '2026-01-01' }, userA);

  assert.equal((await cashierShiftService.currentAll(userA)).total, 500);
  assert.equal((await cashierShiftService.currentAll(userB)).total, 1000, 'restaurant B must be completely unaffected');
});
