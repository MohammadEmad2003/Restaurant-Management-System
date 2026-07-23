import { repo } from '../repositories/index.js';

const round2 = (n) => +Number(n || 0).toFixed(2);

/**
 * Restaurant Cash Ledger — the sole authoritative source for the
 * Restaurant-wide Cash Drawer balance. Every event that puts real cash into
 * (or takes it out of) the restaurant's drawer writes exactly one signed
 * entry here, the instant it happens. A Cashier Shift is a separate concept
 * (who was working, till reconciliation, accountability) — `cashierShiftId`
 * is an optional attribution on an entry, never a precondition for the
 * entry existing. A cashier with no active shift can still receive real
 * cash, and it must still count.
 */
async function record({ restaurantId, amount, transactionType, orderId = null, cashierShiftId = null, createdByUserId = null }) {
  return repo('cashLedger').create({
    restaurantId,
    amount: round2(amount),
    transactionType,
    orderId,
    cashierShiftId,
    createdByUserId,
  });
}

/** The restaurant's current authoritative cash balance — sum of every ledger entry. */
async function balance(restaurantId) {
  const entries = await repo('cashLedger').getAll({ restaurantId });
  return round2(entries.reduce((s, e) => s + (e.amount || 0), 0));
}

/** Net contribution a single cashier shift has made to the ledger so far
 * (its opening float plus whatever cash sales/settlements were attributed to
 * it) — used to zero a shift's contribution out cleanly when it closes. */
async function shiftContribution(restaurantId, cashierShiftId) {
  if (!cashierShiftId) return 0;
  const entries = await repo('cashLedger').getAll({ restaurantId, cashierShiftId });
  return round2(entries.reduce((s, e) => s + (e.amount || 0), 0));
}

/** Net ledger contribution already recorded against a given source record
 * (order, cash advance, etc. — `orderId` doubles as a generic reference id).
 * Used to reverse or adjust an entry cleanly when that source record is
 * edited or deleted, without needing to know how many entries exist for it. */
async function contributionFor(restaurantId, orderId) {
  if (!orderId) return 0;
  const entries = await repo('cashLedger').getAll({ restaurantId, orderId });
  return round2(entries.reduce((s, e) => s + (e.amount || 0), 0));
}

export const cashLedgerService = { record, balance, shiftContribution, contributionFor };
export default cashLedgerService;
