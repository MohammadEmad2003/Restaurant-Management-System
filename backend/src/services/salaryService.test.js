import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salaryService } from './salaryService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

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
