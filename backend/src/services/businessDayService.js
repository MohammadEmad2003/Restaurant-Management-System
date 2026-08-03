import { repo } from '../repositories/index.js';
import { withLock } from '../utils/lock.js';

/**
 * Tracks each restaurant's current "business day" and the two independent
 * order-numbering sequences (Takeaway "T-" / Delivery-Agent "D-") that reset
 * with it. One row per restaurant (id === restaurantId), stored via the same
 * repo() abstraction as everything else, so it is offline-safe, persists
 * across app restarts, and survives sync exactly like any other record.
 *
 * Business-day boundary: per product requirement, the day does NOT reset at
 * calendar midnight. It resets only when a cashier shift opens and, at that
 * moment, NO cashier shift is currently open anywhere in the restaurant —
 * i.e. this is the first shift after every previous shift had been closed.
 * An overnight shift (8pm→3am) keeps the same business day the whole time it
 * (or any other shift) stays open; the NEXT shift to open after the last one
 * closes is what starts the new business day. Multiple shifts opening while
 * one is already open never resets numbering, and reopening a closed shift
 * (a distinct action from opening a new one) never resets it either.
 */
async function getOrInit(restaurantId) {
  const existing = await repo('businessDays').getById(restaurantId);
  if (existing) return existing;
  return repo('businessDays').create({
    id: restaurantId,
    restaurantId,
    dayIndex: 1,
    startedAt: Date.now(),
    takeawaySeq: 0,
    deliverySeq: 0,
  });
}

/**
 * Call BEFORE a new cashier shift is created. If no shift is currently open
 * for this restaurant, this new shift is the first of a new business day —
 * advance the day index and reset both numbering sequences to zero.
 * Lock-guarded so two shifts opening at the same instant (two devices/two
 * cashiers) can't both win the "first of the day" race and reset twice.
 */
async function maybeStartNewDay(restaurantId) {
  if (!restaurantId) return;
  return withLock(`business-day-${restaurantId}`, async () => {
    const anyOpen = (await repo('cashierShifts').getAll({ restaurantId, status: 'open' })).length > 0;
    if (anyOpen) return; // same business day continues
    const day = await getOrInit(restaurantId);
    await repo('businessDays').update(day.id, {
      dayIndex: (day.dayIndex || 0) + 1,
      startedAt: Date.now(),
      takeawaySeq: 0,
      deliverySeq: 0,
    });
  });
}

/**
 * Mint the next human-readable order number for this restaurant's current
 * business day — "T-001", "T-002", … for takeaway/walk-in orders, "D-001",
 * "D-002", … for any delivery-collection order (registered agent or
 * manual/free-text courier), completely independent sequences. Lock-guarded
 * per restaurant so concurrent order creation can never hand out the same
 * number twice.
 */
async function nextOrderNumber(restaurantId, isDeliveryCollection) {
  // Must use the SAME lock key as maybeStartNewDay — both read-modify-write
  // the same businessDays row, and orders can be created with no open shift
  // at all (by design), so a day-rollover and an order-number mint can
  // otherwise interleave: nextOrderNumber reads takeawaySeq under its own
  // lock, maybeStartNewDay (under a DIFFERENT lock) resets it to 0, then
  // nextOrderNumber writes back its stale incremented value — reviving the
  // pre-reset sequence and producing an inflated order number right after
  // what should have been a fresh day starting at 001.
  return withLock(`business-day-${restaurantId}`, async () => {
    const day = await getOrInit(restaurantId);
    const field = isDeliveryCollection ? 'deliverySeq' : 'takeawaySeq';
    const next = (day[field] || 0) + 1;
    await repo('businessDays').update(day.id, { [field]: next });
    const prefix = isDeliveryCollection ? 'D' : 'T';
    return `${prefix}-${String(next).padStart(3, '0')}`;
  });
}

export const businessDayService = { getOrInit, maybeStartNewDay, nextOrderNumber };
export default businessDayService;
