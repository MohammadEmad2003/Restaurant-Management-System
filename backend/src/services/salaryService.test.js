import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salaryService } from './salaryService.js';
import { cashAdvanceService } from './cashAdvanceService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant, createWorker } from '../test-helpers/fixtures.js';

test('adjust() rejects cross-tenant access (regression for the missing ownership check)', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB, admin: adminB } = await createTestRestaurant();

  const salary = await repo('salaries').create({
    workerId: 'WRK-1', workerName: 'Test Worker', month: '2026-01',
    baseSalary: 1000, overtimePay: 0, lateDeduction: 0, bonus: 0, deductions: 0, netPay: 1000,
    paid: false, restaurantId: restaurantA.id,
  });

  await assert.rejects(
    () => salaryService.adjust(salary.id, { bonus: 999999 }, { restaurantId: restaurantB.id, sub: adminB.id }),
    /salary not found/,
  );

  const unchanged = await repo('salaries').getById(salary.id);
  assert.equal(unchanged.bonus, 0, "restaurant B's admin must not be able to modify restaurant A's salary row");
});

test('adjust() succeeds for the owning restaurant', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const salary = await repo('salaries').create({
    workerId: 'WRK-2', workerName: 'Test Worker 2', month: '2026-01',
    baseSalary: 1000, overtimePay: 0, lateDeduction: 0, bonus: 0, deductions: 0, netPay: 1000,
    paid: false, restaurantId: restaurant.id,
  });
  const updated = await salaryService.adjust(salary.id, { bonus: 100 }, { restaurantId: restaurant.id, sub: admin.id });
  assert.equal(updated.bonus, 100);
});

test('markPaid() does NOT touch the Cash Drawer/Cash Ledger — paying salary is a payroll/expense event, not a drawer event', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  const salary = await repo('salaries').create({
    workerId: 'WRK-3', workerName: 'Test Worker 3', month: '2026-02',
    baseSalary: 2000, overtimePay: 0, lateDeduction: 0, bonus: 0, deductions: 0, netPay: 2000,
    paid: false, restaurantId: restaurant.id,
  });

  await salaryService.markPaid(salary.id, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), 0, 'the Cash Ledger must be completely unaffected by paying a salary');
});

test('runMonthly() (bulk "Run Payroll") DOES deduct pending salary-deduction cash advances — the advance comes out of the same month\'s salary regardless of bulk vs. individual pay', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });

  const worker = await createWorker(restaurant.id, { name: 'Bulk Pay Worker', salary: 3000 });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Bulk Pay Worker', amount: 500, date: '2026-03-01' }, user);
  assert.equal(advance.status, 'pending');
  await cashAdvanceService.withdraw(advance.id, user);

  const before = await cashierShiftService.currentAll(user);
  const result = await salaryService.runMonthly({ month: '2026-03' }, user);
  assert.equal(result.paidNow, 1);
  assert.equal(result.total, 2500, 'the run\'s reported total must reflect the deducted net pay, not the pre-deduction snapshot');

  const after = await cashierShiftService.currentAll(user);
  assert.equal(before.total, after.total, 'paying salary must not touch the Cash Drawer at all, regardless of any advance deduction');

  const deductedAdvance = await repo('cashAdvances').getById(advance.id);
  assert.equal(deductedAdvance.status, 'deducted', 'bulk payroll must deduct the advance exactly like the per-worker Pay action');

  const salaryRow = (await repo('salaries').getAll({ month: '2026-03', restaurantId: restaurant.id }))[0];
  assert.equal(salaryRow.netPay, 2500, 'net pay must have the 500 advance deducted');
});

test('runMonthly() does NOT deduct a cash-reimbursement advance — only salary-deduction ones', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });

  const worker = await createWorker(restaurant.id, { name: 'Cash Reimburse Worker', salary: 3000 });
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Cash Reimburse Worker', amount: 500, date: '2026-03-01', repaymentMethod: 'cash-reimbursement' },
    user,
  );

  const result = await salaryService.runMonthly({ month: '2026-03' }, user);
  assert.equal(result.total, 3000, 'a cash-reimbursement advance must not reduce net pay');

  const unchangedAdvance = await repo('cashAdvances').getById(advance.id);
  assert.equal(unchangedAdvance.status, 'pending', 'a cash-reimbursement advance is repaid some other way, not through payroll');
});

test('markPaid() for a single worker (the per-worker Pay action) DOES deduct their pending cash advance', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });

  const worker = await createWorker(restaurant.id, { name: 'Individual Pay Worker', salary: 3000 });
  const advance = await cashAdvanceService.create({ workerId: worker.id, workerName: 'Individual Pay Worker', amount: 500, date: '2026-04-01' }, user);
  await cashAdvanceService.withdraw(advance.id, user);

  await salaryService.generate({ month: '2026-04' }, user);
  const salaryRow = (await repo('salaries').getAll({ month: '2026-04', restaurantId: restaurant.id })).find((s) => s.workerId === worker.id);

  const before = await cashierShiftService.currentAll(user);
  const paid = await salaryService.markPaid(salaryRow.id, user);
  const after = await cashierShiftService.currentAll(user);

  assert.equal(paid.netPay, 2500, 'net pay must have the 500 advance deducted');
  assert.equal(before.total, after.total, 'paying salary must not touch the Cash Drawer at all');
});

test('a salary-deduction advance taken BEFORE this month\'s salary is paid is deducted from THIS month', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });
  const worker = await createWorker(restaurant.id, { name: 'Not Yet Paid Worker', salary: 3000 });

  // This month's salary hasn't been generated/paid yet when the advance is taken.
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Not Yet Paid Worker', amount: 500, date: '2026-05-10' }, user,
  );
  assert.equal(advance.targetMonth, '2026-05', 'not yet paid this month → targets this same month');
  await cashAdvanceService.withdraw(advance.id, user);

  const result = await salaryService.runMonthly({ month: '2026-05' }, user);
  assert.equal(result.total, 2500, 'this month\'s salary run must already reflect the deduction');

  const deducted = await repo('cashAdvances').getById(advance.id);
  assert.equal(deducted.status, 'deducted');
});

test('a salary-deduction advance taken AFTER this month\'s salary was already paid automatically rolls to NEXT month, and is deducted exactly once', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });
  const worker = await createWorker(restaurant.id, { name: 'Already Paid Worker', salary: 3000 });

  // June's salary is paid FIRST, before any advance exists.
  await salaryService.runMonthly({ month: '2026-06' }, user);
  const juneRow = (await repo('salaries').getAll({ month: '2026-06', restaurantId: restaurant.id })).find((s) => s.workerId === worker.id);
  assert.equal(juneRow.paid, true);
  assert.equal(juneRow.netPay, 3000, 'June was already fully paid before the advance existed — must be untouched');

  // The advance is taken afterward, still dated in June.
  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Already Paid Worker', amount: 500, date: '2026-06-20' }, user,
  );
  assert.equal(advance.targetMonth, '2026-07', 'June is already paid → automatically rolls to July');
  await cashAdvanceService.withdraw(advance.id, user);

  // Re-running June must not retroactively touch it (already paid, and not
  // its target month anyway) — the advance must stay pending, not deducted twice.
  const juneRerun = await salaryService.runMonthly({ month: '2026-06' }, user);
  assert.equal(juneRerun.paidNow, 0, 'June is fully paid already, nothing left to pay');
  const stillPending = await repo('cashAdvances').getById(advance.id);
  assert.equal(stillPending.status, 'pending', 'must not have been deducted from June — June was not its target month');

  // July's run picks it up correctly.
  const julyResult = await salaryService.runMonthly({ month: '2026-07' }, user);
  assert.equal(julyResult.total, 2500, 'July must carry the deduction that rolled over from June');
  const julyRow = (await repo('salaries').getAll({ month: '2026-07', restaurantId: restaurant.id })).find((s) => s.workerId === worker.id);
  assert.equal(julyRow.netPay, 2500);

  const nowDeducted = await repo('cashAdvances').getById(advance.id);
  assert.equal(nowDeducted.status, 'deducted');

  // A further, later month must NOT deduct it again (it's already 'deducted', not 'pending').
  await salaryService.runMonthly({ month: '2026-08' }, user);
  const augustRow = (await repo('salaries').getAll({ month: '2026-08', restaurantId: restaurant.id })).find((s) => s.workerId === worker.id);
  assert.equal(augustRow.netPay, 3000, 'the advance must not be deducted a second time in a later month');
});

test('preview()\'s pendingAdvance keeps showing the actual deducted amount AFTER paying (bug regression) — it must not snap back to 0 the moment the salary is marked paid', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });
  const worker = await createWorker(restaurant.id, { name: 'Post Pay Visibility Worker', salary: 10000 });

  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Post Pay Visibility Worker', amount: 2000, date: '2026-09-01', repaymentMethod: 'salary-deduction' }, user,
  );
  await cashAdvanceService.withdraw(advance.id, user);

  const month = '2026-09';
  const before = (await salaryService.preview({ month }, user)).rows.find((r) => r.workerId === worker.id);
  assert.equal(before.pendingAdvance, 2000, 'before paying: shows the amount that WILL be deducted');

  await salaryService.generate({ month }, user);
  const salaryRow = (await repo('salaries').getAll({ month, restaurantId: restaurant.id })).find((s) => s.workerId === worker.id);
  await salaryService.markPaid(salaryRow.id, user);

  const after = (await salaryService.preview({ month }, user)).rows.find((r) => r.workerId === worker.id);
  assert.equal(after.paid, true);
  assert.equal(after.pendingAdvance, 2000, 'after paying: must keep showing 2000 (what WAS deducted), not snap back to 0');
  assert.equal(after.netPay, 8000, 'net pay must still reflect the deduction (10000 - 2000)');

  const stored = await repo('salaries').getById(salaryRow.id);
  assert.equal(stored.advanceDeduction, 2000, 'the deducted amount must be persisted on the salary record itself');
});

test('a NOT-WITHDRAWN salary-deduction advance neither reduces Net Salary in preview() nor gets deducted by payroll (bug regression)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  await cashierShiftService.open(user, { openingFloat: 10000 });
  const worker = await createWorker(restaurant.id, { name: 'Not Withdrawn Worker', salary: 5000 });

  const advance = await cashAdvanceService.create(
    { workerId: worker.id, workerName: 'Not Withdrawn Worker', amount: 1000, date: '2026-10-01', repaymentMethod: 'salary-deduction' }, user,
  );
  assert.equal(advance.withdrawn, false, 'sanity check: never withdrawn');

  const month = '2026-10';
  const preview = (await salaryService.preview({ month }, user)).rows.find((r) => r.workerId === worker.id);
  assert.equal(preview.pendingAdvance, 0, 'an un-withdrawn advance must not show up as a pending deduction — the worker never received that cash');
  assert.equal(preview.netPay, 5000, 'Net Salary must stay at the full base salary until the advance is actually withdrawn');

  const result = await salaryService.runMonthly({ month }, user);
  assert.equal(result.total, 5000, 'payroll must not deduct an advance the worker never actually received');

  const stillPending = await repo('cashAdvances').getById(advance.id);
  assert.equal(stillPending.status, 'pending', 'the advance must remain pending — untouched by payroll until withdrawn');

  // Withdraw it NOW (after October's salary already ran and paid in full).
  // Its targetMonth stays '2026-10' (withdraw() never recomputes it) — but
  // since October is already paid, the "catch up" rule in
  // getPendingByWorker() picks it up on the NEXT month's run instead of
  // leaving it stuck forever.
  await cashAdvanceService.withdraw(advance.id, user);
  const afterWithdraw = await repo('cashAdvances').getById(advance.id);
  assert.equal(afterWithdraw.targetMonth, '2026-10', 'targetMonth is fixed at creation time, not recomputed by withdraw()');

  const novResult = await salaryService.runMonthly({ month: '2026-11' }, user);
  assert.equal(novResult.total, 4000, 'once withdrawn, the advance is caught up and deducted on the next payroll run');
  const nowDeducted = await repo('cashAdvances').getById(advance.id);
  assert.equal(nowDeducted.status, 'deducted');
});
