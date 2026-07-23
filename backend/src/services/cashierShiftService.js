import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { cashLedgerService } from './cashLedgerService.js';

const round2 = (n) => +Number(n || 0).toFixed(2);

/**
 * Sum a cashier's CASH sales within [from, to] (epoch ms), excluding cancelled
 * orders. Only ACTUAL received cash counts: a delivery-agent order sitting at
 * `paymentStatus: 'pending'` (end-of-day timing, money not collected yet)
 * must never inflate the drawer — it's excluded here regardless of how old
 * the order is. Orders are windowed by `paidAt` (when the cash was actually
 * received) rather than `orderDate` (when the order was placed), so an
 * end-of-day order placed yesterday but settled just now correctly lands in
 * THIS shift's cash, exactly once, at the moment it's actually collected.
 * Legacy orders predating this field have neither `paymentStatus` nor a
 * missing `paidAt` — both default to "paid, dated at order time" so old data
 * keeps behaving exactly as before.
 */
async function computeCashSales(cashierId, from, to, user) {
  const orders = await repo('orders').getAll({ restaurantId: user?.restaurantId });
  return round2(orders
    .filter((o) => o.cashierId === cashierId
      && (o.paymentMethod || 'cash') === 'cash'
      && o.status !== 'cancelled'
      && (o.paymentStatus || 'paid') === 'paid'
      && receivedAt(o) >= from
      && receivedAt(o) <= to)
    .reduce((s, o) => s + (o.totalPrice || 0), 0));
}

/** The instant an order's cash actually became available — `paidAt` when set, else `orderDate` for legacy rows. */
function receivedAt(order) {
  return order.paidAt ? new Date(order.paidAt).getTime() : (order.orderDate || 0);
}

/** The cashier's currently open shift, or null. */
async function openShiftFor(cashierId, user) {
  const rows = await repo('cashierShifts').getAll({ cashierId, status: 'open', restaurantId: user?.restaurantId });
  return rows[0] || null;
}

/** Resolve a worker's display name from their id. */
async function resolveName(cashierId, fallback) {
  const w = await repo('workers').getById(cashierId);
  return (w && w.name) || fallback || cashierId;
}

/**
 * Open a cash-drawer shift for the signed-in cashier. `openingFloat` is the starting
 * cash in the box (0 when the previous cash was deposited to the owner).
 */
async function open(user, { openingFloat } = {}) {
  const cashierId = user.sub;
  if (await openShiftFor(cashierId, user)) throw new HttpError(409, 'You already have an open shift');
  const float = round2(openingFloat);
  const shift = await repo('cashierShifts').create({
    cashierId,
    cashierName: await resolveName(cashierId, user.name),
    status: 'open',
    openedAt: Date.now(),
    closedAt: null,
    openingFloat: float,
    cashSales: 0,
    expectedCash: float,
    countedCash: 0,
    difference: 0,
    confirmed: false,
    depositedToOwner: false,
    nextCashierId: '',
    nextCashierName: '',
    notes: '',
    handoverConsumed: false,
    restaurantId: user?.restaurantId,
  });

  // Is this open fulfilling a handover from a shift that was closed WITHOUT
  // depositing to the owner? If so, that physical cash never left the
  // Restaurant's drawer and is still sitting in the ledger from the previous
  // shift's untouched contribution (see close() below) — adding a fresh
  // SHIFT_OPEN_FLOAT entry here would count the exact same cash twice.
  const priorShifts = await repo('cashierShifts').getAll({ restaurantId: user?.restaurantId, status: 'closed', nextCashierId: cashierId });
  const handoverSource = priorShifts.find((s) => !s.depositedToOwner && !s.handoverConsumed);

  if (handoverSource) {
    // Mark it consumed so a second, unrelated shift open can't match it again.
    await repo('cashierShifts').update(handoverSource.id, { handoverConsumed: true });
  } else if (float) {
    // Genuinely new cash entering the drawer (a fresh float, not a handover
    // continuation) — record it in the ledger so the Restaurant-wide balance
    // reflects it immediately, independent of any other shift's state.
    await cashLedgerService.record({
      restaurantId: user?.restaurantId,
      amount: float,
      transactionType: 'SHIFT_OPEN_FLOAT',
      cashierShiftId: shift.id,
      createdByUserId: cashierId,
    });
  }
  return shift;
}

/**
 * The cashier's open shift plus a LIVE expected-cash preview
 * (opening float + cash sales so far) so the UI can tell them what should be in the box.
 */
async function current(user) {
  const shift = await openShiftFor(user.sub, user);
  if (!shift) return null;
  const cashSales = await computeCashSales(user.sub, shift.openedAt, Date.now(), user);
  return { ...shift, cashSales, expectedCash: round2((shift.openingFloat || 0) + cashSales) };
}

/**
 * Close a shift: reconcile the counted cash against the expected amount, record the signed
 * difference (positive = over, negative = short), the next cashier taking over (cashiers
 * only), and whether the cash was deposited to the owner (next float resets to 0).
 */
async function close(id, user, { countedCash, nextCashierId, depositedToOwner, notes } = {}) {
  const shift = await repo('cashierShifts').getById(id);
  if (!shift) throw new HttpError(404, 'Shift not found');
  if (user?.restaurantId && shift.restaurantId && shift.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Shift not found');
  }
  if (shift.status !== 'open') throw new HttpError(409, 'Shift is already closed');
  if (shift.cashierId !== user.sub && user.role !== 'admin') throw new HttpError(403, 'Not your shift');
  if (countedCash == null || countedCash === '') throw new HttpError(400, 'countedCash is required');

  const closedAt = Date.now();
  const cashSales = await computeCashSales(shift.cashierId, shift.openedAt, closedAt, user);
  const expectedCash = round2((shift.openingFloat || 0) + cashSales);
  const counted = round2(countedCash);
  const difference = round2(counted - expectedCash);

  let nextCashierName = '';
  if (nextCashierId) {
    const next = await repo('workers').getById(nextCashierId);
    if (!next || next.role !== 'cashier') throw new HttpError(400, 'The next cashier must be a cashier');
    nextCashierName = next.name;
  }

  // Closing a shift is a LOGICAL logout/handover — it does not, by itself,
  // move any physical cash. The Restaurant Cash Ledger represents actual cash
  // physically held by the restaurant, so it must only change here if that
  // cash is actually leaving the drawer (depositedToOwner: true, e.g. handed
  // to the owner/banked). If the cash simply stays in the till for the next
  // cashier (depositedToOwner: false), the ledger must NOT be touched — the
  // balance stays exactly as it is; the closed shift's contribution remains
  // attributed to it until (optionally) marked handed-over when the next
  // cashier opens (see open()), which never re-adds or removes cash either.
  if (depositedToOwner) {
    const contribution = await cashLedgerService.shiftContribution(user?.restaurantId, id);
    if (contribution) {
      await cashLedgerService.record({
        restaurantId: user?.restaurantId,
        amount: -contribution,
        transactionType: 'SHIFT_CLOSE_ADJUSTMENT',
        cashierShiftId: id,
        createdByUserId: user.sub,
      });
    }
  }

  const updated = await repo('cashierShifts').update(id, {
    status: 'closed',
    closedAt,
    cashSales,
    expectedCash,
    countedCash: counted,
    difference,
    confirmed: true,
    depositedToOwner: !!depositedToOwner,
    nextCashierId: nextCashierId || '',
    nextCashierName,
    notes: notes || '',
  });
  return updated;
}

/** Shift history (admin). Optional cashierId filter; newest first. */
async function list({ cashierId } = {}, user) {
  let items = await repo('cashierShifts').getAll({ restaurantId: user?.restaurantId });
  if (cashierId) items = items.filter((s) => s.cashierId === cashierId);
  return items.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

/** Admin/Cashier view: every currently-open shift with a live expected-cash
 * preview (for shift-reconciliation display), plus `total` — the
 * Restaurant-wide authoritative Cash Drawer balance. `total` comes from the
 * Restaurant Cash Ledger (cashLedgerService.balance), NOT from summing open
 * shifts: a cash transaction that happened while its cashier had no open
 * shift still counts toward the restaurant's real cash, and must never
 * silently vanish from this figure. POS and Dashboard, for both ADMIN and
 * CASHIER, must read this same `total`. */
async function currentAll(user) {
  const shifts = await repo('cashierShifts').getAll({ restaurantId: user?.restaurantId, status: 'open' });
  const withCash = await Promise.all(shifts.map(async (shift) => {
    const cashSales = await computeCashSales(shift.cashierId, shift.openedAt, Date.now(), user);
    return { ...shift, cashSales, expectedCash: round2((shift.openingFloat || 0) + cashSales) };
  }));
  const total = await cashLedgerService.balance(user?.restaurantId);
  return { shifts: withCash, total };
}

export const cashierShiftService = { open, current, close, list, currentAll, computeCashSales, openShiftFor };
export default cashierShiftService;
