import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

const round2 = (n) => +Number(n || 0).toFixed(2);

/** Sum a cashier's CASH sales within [from, to] (epoch ms), excluding cancelled orders. */
async function computeCashSales(cashierId, from, to, user) {
  const orders = await repo('orders').getAll({ restaurantId: user?.restaurantId });
  return round2(orders
    .filter((o) => o.cashierId === cashierId
      && (o.paymentMethod || 'cash') === 'cash'
      && o.status !== 'cancelled'
      && (o.orderDate || 0) >= from
      && (o.orderDate || 0) <= to)
    .reduce((s, o) => s + (o.totalPrice || 0), 0));
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
    restaurantId: user?.restaurantId,
  });
  await recordAudit(user, 'CASHIER_SHIFT_OPENED', 'cashierShifts', shift.id, { after: shift });
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
  await recordAudit(user, 'CASHIER_SHIFT_CLOSED', 'cashierShifts', id, { after: updated });
  return updated;
}

/** Shift history (admin). Optional cashierId filter; newest first. */
async function list({ cashierId } = {}, user) {
  let items = await repo('cashierShifts').getAll({ restaurantId: user?.restaurantId });
  if (cashierId) items = items.filter((s) => s.cashierId === cashierId);
  return items.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

export const cashierShiftService = { open, current, close, list, computeCashSales };
export default cashierShiftService;
