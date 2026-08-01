import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { cashLedgerService } from './cashLedgerService.js';
import { secureStore } from '../repositories/secureStore.js';
import { businessDayService } from './businessDayService.js';

const store = secureStore();

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

/** Resolve a cashier's display name from their id. `cashierId` here is always
 * a `users` id (it comes from the JWT's `sub`, e.g. shift-open/order-create) —
 * looking it up against `workers` (a different collection with its own ids,
 * only linked via `legacyWorkerId`) would never match and silently fall
 * through to the raw id string as the "name". */
async function resolveName(cashierId, fallback) {
  // `users` is an identity/auth table, held in secureStore — NEVER the
  // generic tenant-data repo() (which, in Supabase mode, points at the
  // unrelated `records` JSONB table and would never resolve anything here;
  // it only ever appeared to work in local-JSON mode where both happened to
  // share the same underlying file).
  const u = await store.findOne('users', { id: cashierId });
  return (u && (u.name || u.username)) || fallback || cashierId;
}

/**
 * Open a cash-drawer shift for the signed-in cashier. `openingFloat` is the cash
 * the cashier physically counted in the box just now — it is compared against
 * (never added to) the Restaurant Cash Drawer balance, exactly like the count
 * at close time: only the signed DIFFERENCE between what's physically there
 * and what the ledger already expects is recorded, as an over/short
 * adjustment. Blindly adding the counted amount would double-count cash the
 * ledger already knows about (e.g. from the previous shift's sales).
 */
async function open(user, { openingFloat } = {}) {
  const cashierId = user.sub;
  if (await openShiftFor(cashierId, user)) throw new HttpError(409, 'You already have an open shift');

  // If no shift is currently open anywhere in the restaurant, this shift is
  // the first of a new business day — this must run BEFORE the shift below is
  // created, since "any open shift" is exactly what decides the boundary.
  await businessDayService.maybeStartNewDay(user?.restaurantId);

  const float = round2(openingFloat);
  const shift = await repo('cashierShifts').create({
    cashierId,
    cashierName: await resolveName(cashierId, user.name),
    status: 'open',
    openedAt: Date.now(),
    closedAt: null,
    openingFloat: float,
    openingDifference: 0,
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
  // shift's untouched contribution (see close() below) — comparing/adjusting
  // here would double-count or misreconcile the exact same cash.
  const priorShifts = await repo('cashierShifts').getAll({ restaurantId: user?.restaurantId, status: 'closed', nextCashierId: cashierId });
  const handoverSource = priorShifts.find((s) => !s.depositedToOwner && !s.handoverConsumed);

  let openingDifference = 0;
  if (handoverSource) {
    // Mark it consumed so a second, unrelated shift open can't match it again.
    await repo('cashierShifts').update(handoverSource.id, { handoverConsumed: true });
  } else {
    // Not a handover — the cashier is counting whatever is physically in the
    // drawer right now. Compare that count against the Restaurant Cash
    // Ledger's current balance and record only the difference (positive =
    // more cash physically present than expected, negative = short), so the
    // ledger ends up matching exactly what was counted, without ever
    // re-adding cash the ledger already accounts for.
    const currentBalance = await cashLedgerService.balance(user?.restaurantId);
    openingDifference = round2(float - currentBalance);
    if (openingDifference) {
      await cashLedgerService.record({
        restaurantId: user?.restaurantId,
        amount: openingDifference,
        transactionType: 'SHIFT_OPEN_ADJUSTMENT',
        cashierShiftId: shift.id,
        createdByUserId: cashierId,
      });
    }
  }
  if (openingDifference) await repo('cashierShifts').update(shift.id, { openingDifference });
  return { ...shift, openingDifference };
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
 * difference (positive = over, negative = short), the next cashier taking over (a cashier
 * or an admin), and whether the cash was deposited to the owner (next float resets to 0).
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

  let nextCashierName = '';
  if (nextCashierId) {
    const next = await repo('workers').getById(nextCashierId);
    if (!next || (next.role !== 'cashier' && next.role !== 'admin')) {
      throw new HttpError(400, 'The next cashier must be a cashier or admin');
    }
    nextCashierName = next.name;
  }

  const closedAt = Date.now();
  const cashSales = await computeCashSales(shift.cashierId, shift.openedAt, closedAt, user);
  const expectedCash = round2((shift.openingFloat || 0) + cashSales);
  const counted = round2(countedCash);
  const difference = round2(counted - expectedCash);

  // Closing a shift is a LOGICAL logout/handover — it does not, by itself,
  // move any physical cash. The Restaurant Cash Ledger represents actual cash
  // physically held by the restaurant, so it must only change here if that
  // cash is actually leaving the drawer (depositedToOwner: true, e.g. handed
  // to the owner/banked). Depositing to the owner means the OWNER TAKES THE
  // ENTIRE DRAWER, not just this shift's slice of it — so the ledger balance
  // is driven to exactly zero here, not merely reduced by this shift's own
  // contribution. If the cash simply stays in the till for the next cashier
  // (depositedToOwner: false), the ledger must NOT be touched at all.
  if (depositedToOwner) {
    const currentBalance = await cashLedgerService.balance(user?.restaurantId);
    if (currentBalance) {
      await cashLedgerService.record({
        restaurantId: user?.restaurantId,
        amount: -currentBalance,
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

/**
 * Undo a mistaken close, putting the shift back to `open`. This must leave
 * the Restaurant Cash Ledger exactly where it was BEFORE the close — never
 * higher than that — so if the close had deposited the shift's contribution
 * to the owner (a real ledger-decreasing entry), reopening reverses exactly
 * that entry back in, restoring the pre-close balance rather than adding
 * fresh cash on top of it.
 */
async function reopen(id, user) {
  const shift = await repo('cashierShifts').getById(id);
  if (!shift) throw new HttpError(404, 'Shift not found');
  if (user?.restaurantId && shift.restaurantId && shift.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Shift not found');
  }
  if (shift.status !== 'closed') throw new HttpError(409, 'Shift is not closed');
  if (shift.cashierId !== user.sub && user.role !== 'admin') throw new HttpError(403, 'Not your shift');
  if (await openShiftFor(shift.cashierId, user)) {
    throw new HttpError(409, 'Cannot undo: a newer shift is already open for this cashier');
  }
  if (shift.nextCashierId && await openShiftFor(shift.nextCashierId, user)) {
    throw new HttpError(409, 'Cannot undo: the next cashier already opened their shift using this handover');
  }

  // Reverse the exact SHIFT_CLOSE_ADJUSTMENT entries this close created (if
  // any) — summed, then negated, rather than re-deriving from current state,
  // so the reversal is exact even if other ledger activity happened since.
  const closeEntries = (await repo('cashLedger').getAll({ restaurantId: user?.restaurantId, cashierShiftId: id }))
    .filter((e) => e.transactionType === 'SHIFT_CLOSE_ADJUSTMENT');
  const closeAmount = round2(closeEntries.reduce((s, e) => s + (e.amount || 0), 0));
  if (closeAmount) {
    await cashLedgerService.record({
      restaurantId: user?.restaurantId,
      amount: -closeAmount,
      transactionType: 'SHIFT_REOPEN_ADJUSTMENT',
      cashierShiftId: id,
      createdByUserId: user.sub,
    });
  }

  return repo('cashierShifts').update(id, {
    status: 'open',
    closedAt: null,
    cashSales: 0,
    expectedCash: shift.openingFloat,
    countedCash: 0,
    difference: 0,
    confirmed: false,
    depositedToOwner: false,
    nextCashierId: '',
    nextCashierName: '',
    notes: '',
  });
}

/** Shift history (admin). Optional cashierId + inclusive from/to date-range
 * filter (matched against `openedAt`, so an overnight shift is found by the
 * day it started on); newest first. `to` is a date-only "YYYY-MM-DD" string —
 * without the +86399999ms end-of-day offset a shift opened later that same
 * day would be wrongly excluded, the classic UTC-midnight range bug. */
async function list({ cashierId, from, to } = {}, user) {
  let items = await repo('cashierShifts').getAll({ restaurantId: user?.restaurantId });
  if (cashierId) items = items.filter((s) => s.cashierId === cashierId);
  if (from) items = items.filter((s) => (s.openedAt || 0) >= new Date(from).getTime());
  if (to) items = items.filter((s) => (s.openedAt || 0) <= new Date(to).getTime() + 86399999);
  return items.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

/** Full analytics + invoice detail for everything a cashier rang up during
 * one shift (from `openedAt` to `closedAt`, or now if still open) — backs
 * the cashier-facing "Shift Analytics" report. Every order in the window is
 * included regardless of status; cancelled orders are excluded from the
 * revenue/count/timing metrics (they were never real sales) but still
 * counted separately (`cancelledCount`) and still listed in `invoices` so
 * nothing silently disappears from the record.
 *
 * `discount`/`tax` are summed from whatever the order rows actually carry —
 * neither field is currently written anywhere in the order-creation flow
 * (no discount/tax UI exists in the POS yet), so these will legitimately be
 * 0 today; the calculation itself is correct and ready for whenever that
 * data starts being populated. */
async function shiftAnalytics(id, user) {
  const shift = await repo('cashierShifts').getById(id);
  if (!shift) throw new HttpError(404, 'Shift not found');
  if (user?.restaurantId && shift.restaurantId && shift.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Shift not found');
  }
  const windowEnd = shift.closedAt || Date.now();
  const allOrders = (await repo('orders').getAll({ restaurantId: user?.restaurantId, cashierId: shift.cashierId }))
    .filter((o) => (o.orderDate || 0) >= shift.openedAt && (o.orderDate || 0) <= windowEnd)
    .sort((a, b) => (a.orderDate || 0) - (b.orderDate || 0));

  const cancelledOrders = allOrders.filter((o) => o.status === 'cancelled');
  const activeOrders = allOrders.filter((o) => o.status !== 'cancelled');

  const totalOrders = activeOrders.length;
  const totalRevenue = round2(activeOrders.reduce((s, o) => s + (o.totalPrice || 0), 0));
  const totalDiscounts = round2(activeOrders.reduce((s, o) => s + (o.discount || 0), 0));
  const totalTaxes = round2(activeOrders.reduce((s, o) => s + (o.tax || 0), 0));
  const averageOrderValue = totalOrders ? round2(totalRevenue / totalOrders) : 0;

  const paymentBreakdown = {};
  for (const o of activeOrders) {
    const method = o.paymentMethod || 'cash';
    if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
    paymentBreakdown[method].count += 1;
    paymentBreakdown[method].total = round2(paymentBreakdown[method].total + (o.totalPrice || 0));
  }

  // Hour-of-day buckets (local time), for peak/lowest/busiest-hour metrics.
  const hourly = {};
  for (const o of activeOrders) {
    const h = new Date(o.orderDate).getHours();
    if (!hourly[h]) hourly[h] = { hour: h, count: 0, revenue: 0 };
    hourly[h].count += 1;
    hourly[h].revenue = round2(hourly[h].revenue + (o.totalPrice || 0));
  }
  const hourlyRows = Object.values(hourly);
  const peakHour = hourlyRows.length ? hourlyRows.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null;
  const lowestHour = hourlyRows.length ? hourlyRows.reduce((a, b) => (b.revenue < a.revenue ? b : a)) : null;
  const busiestHour = hourlyRows.length ? hourlyRows.reduce((a, b) => (b.count > a.count ? b : a)) : null;

  const timestamps = activeOrders.map((o) => o.orderDate).filter(Boolean);
  let averageTimeBetweenOrdersMs = null;
  if (timestamps.length > 1) {
    let gapSum = 0;
    for (let i = 1; i < timestamps.length; i += 1) gapSum += timestamps[i] - timestamps[i - 1];
    averageTimeBetweenOrdersMs = Math.round(gapSum / (timestamps.length - 1));
  }

  const qtyByProduct = {};
  for (const o of activeOrders) {
    for (const line of o.products || []) {
      const key = line.productId || line.name;
      if (!key) continue;
      if (!qtyByProduct[key]) qtyByProduct[key] = { productId: line.productId, name: line.name, quantity: 0 };
      qtyByProduct[key].quantity += line.quantity || 0;
    }
  }
  const topProduct = Object.values(qtyByProduct).sort((a, b) => b.quantity - a.quantity)[0] || null;

  const invoices = [...allOrders].sort((a, b) => (b.orderDate || 0) - (a.orderDate || 0)).map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber || o.invoiceNo || o.id,
    orderDate: o.orderDate,
    clientName: o.clientName || null,
    cashierName: o.cashierName || null,
    paymentMethod: o.paymentMethod || 'cash',
    status: o.status,
    discount: o.discount || 0,
    tax: o.tax || 0,
    deliveryFee: o.deliveryFee || 0,
    totalPrice: o.totalPrice || 0,
    notes: o.notes || '',
    products: (o.products || []).map((p) => ({
      productId: p.productId,
      name: p.name,
      quantity: p.quantity || 0,
      unitPrice: p.unitPrice || 0,
      lineTotal: round2((p.unitPrice || 0) * (p.quantity || 0)),
    })),
  }));

  return {
    shift,
    summary: {
      totalOrders,
      totalRevenue,
      averageOrderValue,
      totalDiscounts,
      totalTaxes,
      cancelledCount: cancelledOrders.length,
      paymentBreakdown,
      peakHour,
      lowestHour,
      busiestHour,
      averageTimeBetweenOrdersMs,
      firstOrderTime: timestamps[0] || null,
      lastOrderTime: timestamps[timestamps.length - 1] || null,
      shiftDurationMs: windowEnd - shift.openedAt,
      topProduct,
    },
    invoices,
  };
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

export const cashierShiftService = { open, current, close, reopen, list, currentAll, computeCashSales, openShiftFor, shiftAnalytics };
export default cashierShiftService;
