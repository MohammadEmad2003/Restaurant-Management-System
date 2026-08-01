import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashAdvanceService } from './cashAdvanceService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant, createCashier, createWorker } from '../test-helpers/fixtures.js';

test('creating a Cash Advance does NOT touch the Cash Drawer — it is paperwork-only until withdrawn', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  await cashierShiftService.open(user, { openingFloat: 5000 });
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000);

  const worker = await createWorker(restaurant.id, { name: 'Ali' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Ali', amount: 1000, date: '2026-01-01' }, user);

  assert.equal(advance.withdrawn, false);
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000, 'the drawer must be completely unaffected by creating the record');
});

test('withdraw() decreases the Cash Drawer by exactly the advance amount, exactly once', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });

  const worker = await createWorker(restaurant.id, { name: 'Withdraw Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Withdraw Test', amount: 1000, date: '2026-01-01' }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000, 'still untouched before withdrawal');

  const withdrawn = await cashAdvanceService.withdraw(advance.id, user);
  assert.equal(withdrawn.withdrawn, true);
  assert.ok(withdrawn.withdrawnAt);
  assert.equal((await cashierShiftService.currentAll(user)).total, 4000, '5000 - 1000');

  // Calling withdraw again must be a no-op (idempotent) — no second ledger entry.
  await cashAdvanceService.withdraw(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 4000, 'withdrawing twice must not double-deduct');
});

test('withdraw() is rejected when the amount exceeds the current Cash Drawer balance, and the drawer is unchanged', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 500 });

  const worker = await createWorker(restaurant.id, { name: 'Insufficient Drawer Test', salary: 100000 });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Insufficient Drawer Test', amount: 1000, date: '2026-01-01' }, user);

  await assert.rejects(
    () => cashAdvanceService.withdraw(advance.id, user),
    /[Nn]ot enough cash/,
  );
  const stillNotWithdrawn = await repo('cashAdvances').getById(advance.id);
  assert.equal(stillNotWithdrawn.withdrawn, false);
  assert.equal((await cashierShiftService.currentAll(user)).total, 500, 'the drawer must remain exactly 500');
});

test('withdraw() for exactly the drawer balance is allowed (boundary)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 300 });
  const worker = await createWorker(restaurant.id, { name: 'Boundary Test', salary: 100000 });

  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Boundary Test', amount: 300, date: '2026-01-01' }, user);
  await cashAdvanceService.withdraw(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 0);
});

test('full return lifecycle: withdraw decreases the drawer, return increases it back, returning twice does not add the money twice', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });

  const worker = await createWorker(restaurant.id, { name: 'Return Test' });
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Return Test', amount: 1000, date: '2026-01-01', repaymentMethod: 'cash-reimbursement' }, user,
  );
  await cashAdvanceService.withdraw(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 4000, '5000 - 1000');

  const returned = await cashAdvanceService.returnAdvance(advance.id, user);
  assert.equal(returned.returned, true);
  assert.ok(returned.returnedAt);
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000, 'returning must add back exactly 1000');

  // Returning again (repeated click / duplicate request) must be a no-op.
  await cashAdvanceService.returnAdvance(advance.id, user);
  await cashAdvanceService.returnAdvance(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000, 'must never add the money more than once');
});

test('returnAdvance() is rejected before the advance was ever withdrawn', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });
  const worker = await createWorker(restaurant.id, { name: 'Return Before Withdraw Test' });
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Return Before Withdraw Test', amount: 500, date: '2026-01-01', repaymentMethod: 'cash-reimbursement' }, user,
  );

  await assert.rejects(() => cashAdvanceService.returnAdvance(advance.id, user), /never withdrawn/);
  assert.equal((await cashierShiftService.currentAll(user)).total, 5000);
});

test('returnAdvance() is rejected for a salary-deduction advance — that one is settled through payroll, not returned', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });
  const worker = await createWorker(restaurant.id, { name: 'No Return For Salary Test', salary: 100000 });
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'No Return For Salary Test', amount: 500, date: '2026-01-01', repaymentMethod: 'salary-deduction' }, user,
  );
  await cashAdvanceService.withdraw(advance.id, user);

  await assert.rejects(() => cashAdvanceService.returnAdvance(advance.id, user), /settled automatically by payroll/);
});

test('Cash Advance does not require an active Cashier Shift and still affects the Restaurant-wide balance once withdrawn', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashier = await createCashier(restaurant.id, { username: 'advance_no_shift_cashier' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const cashierUser = { sub: cashier.id, restaurantId: restaurant.id };

  await cashLedgerService.record({ restaurantId: restaurant.id, amount: 1000, transactionType: 'CASH_SALE', createdByUserId: adminUser.sub });

  assert.equal(await cashierShiftService.current(cashierUser), null, 'cashier has no open shift');
  const worker = await createWorker(restaurant.id, { name: 'Sara' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Sara', amount: 300, date: '2026-01-01' }, cashierUser);
  await cashAdvanceService.withdraw(advance.id, cashierUser);

  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 700, 'the withdrawal must still be recorded even with no active shift');
});

test('Cash Advance withdrawal persists across a Cashier logout/login (a different Cashier still sees the correct balance)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashierA = await createCashier(restaurant.id, { username: 'advance_cashier_a' });
  const cashierB = await createCashier(restaurant.id, { username: 'advance_cashier_b' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userA = { sub: cashierA.id, restaurantId: restaurant.id };
  const userB = { sub: cashierB.id, restaurantId: restaurant.id };

  await cashierShiftService.open(userA, { openingFloat: 1000 });
  const worker = await createWorker(restaurant.id, { name: 'Omar' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Omar', amount: 400, date: '2026-01-01' }, userA);
  await cashAdvanceService.withdraw(advance.id, userA);
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 600);

  // Cashier A "logs out" (simulated: just a new session for Cashier B, no shift for B).
  assert.equal(await cashierShiftService.current(userB), null);
  assert.equal((await cashierShiftService.currentAll(userB)).total, 600, 'Cashier B must see the same, correct balance');
});

test('A rapid duplicate Cash Advance creation request (double-click) does not create two records', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const worker = await createWorker(restaurant.id, { name: 'Duplicate Test' });
  const payload = { workerId: worker.id, workerName: 'Duplicate Test', amount: 200, date: '2026-01-01' };
  const [first, second] = await Promise.all([
    cashAdvanceService.create(payload, user),
    cashAdvanceService.create(payload, user),
  ]);

  assert.equal(first.id, second.id, 'the second concurrent identical request must return the same advance, not create a new one');
});

test('A genuinely separate Cash Advance for the same worker/amount/date (outside the duplicate window) is NOT blocked', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const worker = await createWorker(restaurant.id, { name: 'Later Test' });
  const advance1 = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Later Test', amount: 100, date: '2026-01-01' }, user);
  await repo('cashAdvances').update(advance1.id, { createdAt: Date.now() - 60_000 });

  const advance2 = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Later Test', amount: 100, date: '2026-01-01' }, user);
  assert.notEqual(advance1.id, advance2.id, 'a later, legitimately separate advance must not be treated as a duplicate');
});

test('Deleting a never-withdrawn Cash Advance has no Cash Ledger effect at all', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const worker = await createWorker(restaurant.id, { name: 'Remove Unwithdrawn Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Remove Unwithdrawn Test', amount: 250, date: '2026-01-01' }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'never withdrawn — drawer untouched');

  await cashAdvanceService.remove(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'deleting an un-withdrawn advance changes nothing');
});

test('Deleting a withdrawn (but not returned) Cash Advance reverses its Cash Ledger contribution back to zero', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const worker = await createWorker(restaurant.id, { name: 'Remove Withdrawn Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Remove Withdrawn Test', amount: 250, date: '2026-01-01' }, user);
  await cashAdvanceService.withdraw(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 750);

  await cashAdvanceService.remove(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'deleting a withdrawn advance must restore the balance exactly');
});

test('Editing a Cash Advance amount BEFORE withdrawal has no Cash Ledger effect (nothing was recorded yet)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const worker = await createWorker(restaurant.id, { name: 'Edit Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Edit Test', amount: 200, date: '2026-01-01' }, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000);

  const updated = await cashAdvanceService.update(advance.id, { amount: 350 }, user);
  assert.equal(updated.amount, 350);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'still untouched — nothing withdrawn yet');

  await cashAdvanceService.withdraw(advance.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 650, '1000 - 350, the edited amount');
});

test('editing the amount is rejected once the advance has been withdrawn (bug regression: the old ledger-delta logic could silently mismatch the actual withdrawn amount)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });
  const worker = await createWorker(restaurant.id, { name: 'Edit After Withdraw Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Edit After Withdraw Test', amount: 200, date: '2026-01-01' }, user);
  await cashAdvanceService.withdraw(advance.id, user);

  await assert.rejects(
    () => cashAdvanceService.update(advance.id, { amount: 500 }, user),
    /already been withdrawn/,
  );
  assert.equal((await cashierShiftService.currentAll(user)).total, 800, '1000 - 200, unchanged by the rejected edit');
});

test('Cash Advance withdrawal is restaurant-scoped — one restaurant\'s advance never affects another restaurant\'s balance', async () => {
  const { restaurant: restaurantA, admin: adminA } = await createTestRestaurant();
  const { restaurant: restaurantB, admin: adminB } = await createTestRestaurant();
  const userA = { sub: adminA.id, restaurantId: restaurantA.id };
  const userB = { sub: adminB.id, restaurantId: restaurantB.id };

  await cashierShiftService.open(userA, { openingFloat: 1000 });
  await cashierShiftService.open(userB, { openingFloat: 1000 });

  const worker = await createWorker(restaurantA.id, { name: 'Isolation Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Isolation Test', amount: 500, date: '2026-01-01' }, userA);
  await cashAdvanceService.withdraw(advance.id, userA);

  assert.equal((await cashierShiftService.currentAll(userA)).total, 500);
  assert.equal((await cashierShiftService.currentAll(userB)).total, 1000, 'restaurant B must be completely unaffected');
});

test('a Cash Advance repaid via salary deduction cannot exceed the worker\'s salary (independent of withdrawal)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });
  const worker = await createWorker(restaurant.id, { name: 'Low Salary Worker', salary: 1000 });

  await assert.rejects(
    () => cashAdvanceService.create({ workerId: worker.id, workerName: 'Low Salary Worker', amount: 1500, date: '2026-01-01', repaymentMethod: 'salary-deduction' }, user),
    /exceed/i,
  );
});

test('cumulative pending salary-deduction advances cannot exceed the worker\'s salary either', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });
  const worker = await createWorker(restaurant.id, { name: 'Cumulative Test', salary: 1000 });

  await cashAdvanceService.create({ workerId: worker.id, workerName: 'Cumulative Test', amount: 700, date: '2026-01-01' }, user);
  await assert.rejects(
    () => cashAdvanceService.create({ workerId: worker.id, workerName: 'Cumulative Test', amount: 400, date: '2026-01-02' }, user),
    /exceed/i,
    '700 already pending + 400 new = 1100 > 1000 salary, must be rejected',
  );
});

test('a cash-reimbursement advance is NOT capped by salary at all', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });
  const worker = await createWorker(restaurant.id, { name: 'Cash Repay Worker', salary: 100 });

  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Cash Repay Worker', amount: 5000, date: '2026-01-01', repaymentMethod: 'cash-reimbursement' },
    user,
  );
  assert.equal(advance.amount, 5000, 'cash-reimbursement advances are repaid outside of payroll, so the salary cap must not apply');
});

test('editing an advance\'s amount upward (before withdrawal) is also capped against the salary', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 5000 });
  const worker = await createWorker(restaurant.id, { name: 'Edit Cap Test', salary: 1000 });

  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Edit Cap Test', amount: 500, date: '2026-01-01' }, user);
  await assert.rejects(
    () => cashAdvanceService.update(advance.id, { amount: 1500 }, user),
    /exceed/i,
  );
});

test('a non-positive amount is rejected on create (bug regression: would otherwise allow a record that later withdraws negative/zero cash)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });
  const worker = await createWorker(restaurant.id, { name: 'Negative Amount Test', salary: 100000 });

  await assert.rejects(
    () => cashAdvanceService.create({ workerId: worker.id, workerName: 'Negative Amount Test', amount: -500, date: '2026-01-01' }, user),
    /positive number/,
  );
  await assert.rejects(
    () => cashAdvanceService.create({ workerId: worker.id, workerName: 'Negative Amount Test', amount: 0, date: '2026-01-01' }, user),
    /positive number/,
  );
});

test('a non-positive amount is rejected on update too (bug regression)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });
  const worker = await createWorker(restaurant.id, { name: 'Negative Update Test', salary: 100000 });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Negative Update Test', amount: 300, date: '2026-01-01' }, user);

  await assert.rejects(
    () => cashAdvanceService.update(advance.id, { amount: -100 }, user),
    /positive number/,
  );
});

test('ROOT CAUSE bug regression: a client can no longer manually flip a pending advance to "deducted", bypassing payroll entirely', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });
  const worker = await createWorker(restaurant.id, { name: 'Bypass Deducted Test', salary: 100000 });
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Bypass Deducted Test', amount: 300, date: '2026-01-01', repaymentMethod: 'salary-deduction' }, user,
  );

  await assert.rejects(
    () => cashAdvanceService.update(advance.id, { status: 'deducted' }, user),
    /cannot be set directly/,
  );
  const stillPending = await repo('cashAdvances').getById(advance.id);
  assert.equal(stillPending.status, 'pending', 'the advance must remain pending, available for payroll to actually deduct');
});

test('a client can no longer directly set withdrawn/returned either — only the dedicated actions may', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });
  const worker = await createWorker(restaurant.id, { name: 'Direct Set Test' });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Direct Set Test', amount: 100, date: '2026-01-01' }, user);

  await assert.rejects(() => cashAdvanceService.update(advance.id, { withdrawn: true }, user), /cannot be set directly/);
  await assert.rejects(() => cashAdvanceService.update(advance.id, { returned: true }, user), /cannot be set directly/);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'no bypass must ever touch the drawer');
});
