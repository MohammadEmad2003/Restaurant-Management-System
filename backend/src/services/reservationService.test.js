import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservationService } from './reservationService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

// Regression: calendar()'s `to` filter compared against that date's UTC
// midnight instant, unlike every other date-range filter in this codebase
// (orderService, cashierShiftService, financeService, ...), which excluded
// every reservation on the end date scheduled any time after 00:00.
test('calendar()\'s dateTo is inclusive of the entire end date, not just its midnight instant (bug regression)', async () => {
  const { restaurant } = await createTestRestaurant();
  const tomorrow = new Date(Date.now() + 86400000);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const afternoon = new Date(`${dateStr}T15:00:00.000Z`).getTime();

  await repo('reservations').create({
    dateTime: afternoon, partySize: 2, status: 'booked', restaurantId: restaurant.id,
  });

  const result = await reservationService.calendar({ from: dateStr, to: dateStr }, { restaurantId: restaurant.id });
  const allReservations = Object.values(result).flat();
  assert.ok(
    allReservations.some((r) => r.dateTime === afternoon),
    'a reservation placed at 15:00 must be included when dateTo is set to that same day',
  );
});
