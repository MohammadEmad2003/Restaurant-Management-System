import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceService } from './attendanceService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant, createWorker } from '../test-helpers/fixtures.js';

// Regression: clockIn's "find no open record, then create one" was a
// check-then-act sequence with no lock — a double-tap on a shared kiosk (or
// two near-simultaneous devices) could both pass the check and both create
// an open attendance record, leaving the worker with two concurrently open
// clock-ins (clockOut only ever closes the first match it finds).
test('concurrent clockIn attempts for the SAME worker only let one succeed', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const worker = await createWorker(restaurant.id);
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, () => attendanceService.clockIn(worker.id, user)),
  );
  const succeeded = attempts.filter((a) => a.status === 'fulfilled');
  assert.equal(succeeded.length, 1, `expected exactly 1 clock-in to succeed, got ${succeeded.length}`);

  const openRecords = (await repo('attendance').getAll({ workerId: worker.id, restaurantId: restaurant.id }))
    .filter((a) => !a.checkOutTime && a.status !== 'absent');
  assert.equal(openRecords.length, 1, 'the worker must end up with exactly one open attendance record, not several');
});

test('clockIn succeeds normally and clockOut closes it', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const worker = await createWorker(restaurant.id);
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const record = await attendanceService.clockIn(worker.id, user);
  assert.ok(record.checkInTime);
  assert.equal(record.checkOutTime, null);

  const closed = await attendanceService.clockOut(worker.id, user);
  assert.ok(closed.checkOutTime);
});
