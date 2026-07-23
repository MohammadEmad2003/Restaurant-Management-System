import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';
import { withLock } from '../utils/lock.js';
import { cashLedgerService } from './cashLedgerService.js';
import { cashierShiftService } from './cashierShiftService.js';

// How long a duplicate-looking advance (same worker/amount/date/restaurant)
// is treated as an accidental double-submit (e.g. a double-click on Save, or
// a retried request after a slow/ambiguous response) rather than a
// legitimately separate advance. Real advances for the same worker/amount on
// the same day are rare but possible — this window is short enough to only
// catch genuine accidental resubmits, not block real ones made later.
const DUPLICATE_WINDOW_MS = 10_000;

/** List cash advances with optional status/date filters. */
async function list({ status, workerId, date } = {}, user) {
  let items = await repo('cashAdvances').getAll({ restaurantId: user?.restaurantId });
  if (status) items = items.filter((a) => a.status === status);
  if (workerId) items = items.filter((a) => a.workerId === workerId);
  if (date) items = items.filter((a) => (a.date || '').startsWith(date));
  return items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * Create a new cash advance for a worker. This is real cash physically
 * leaving the Restaurant's drawer — not a sale — so it must record exactly
 * one negative CASH_ADVANCE entry in the Restaurant Cash Ledger, regardless
 * of whether the creating cashier has an active shift (cashierShiftId is an
 * optional attribution only, same as every other ledger entry).
 *
 * Idempotency: serialized per worker+amount+date so two near-simultaneous
 * identical requests (e.g. a double-clicked Save button) can't race past the
 * duplicate check below; the second one within DUPLICATE_WINDOW_MS returns
 * the already-created advance instead of creating a second one and a second
 * ledger entry.
 */
async function create(data, user) {
  const amount = +data.amount;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const restaurantId = user?.restaurantId;
  const lockKey = `cash-advance-${restaurantId}-${data.workerId}-${amount}-${date}`;

  return withLock(lockKey, async () => {
    const recent = await repo('cashAdvances').getAll({ restaurantId, workerId: data.workerId });
    const duplicate = recent.find((a) =>
      a.amount === amount && a.date === date &&
      Date.now() - (a.createdAt || 0) < DUPLICATE_WINDOW_MS);
    if (duplicate) return duplicate;

    const advance = await repo('cashAdvances').create({
      workerId: data.workerId,
      workerName: data.workerName,
      amount,
      date,
      description: data.description || '',
      status: 'pending',
      repaymentMethod: data.repaymentMethod || 'salary-deduction',
      notes: data.notes || '',
      restaurantId,
    });

    const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
    await cashLedgerService.record({
      restaurantId,
      amount: -amount,
      transactionType: 'CASH_ADVANCE',
      orderId: advance.id,
      cashierShiftId: openShift?.id || null,
      createdByUserId: user?.sub,
    });

    return advance;
  });
}

/** Update a cash advance (e.g., mark as reimbursed manually). If the amount
 * itself changes, adjust the Cash Ledger by exactly the delta so the
 * restaurant-wide balance always reflects the current amount, never double
 * counting the original. */
async function update(id, patch, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }

  const newAmount = patch.amount != null ? +patch.amount : before.amount;
  const updated = await repo('cashAdvances').update(id, {
    ...patch,
    amount: newAmount,
  });

  if (newAmount !== before.amount) {
    const currentContribution = await cashLedgerService.contributionFor(before.restaurantId, id);
    const delta = -newAmount - currentContribution;
    if (delta) {
      const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
      await cashLedgerService.record({
        restaurantId: before.restaurantId,
        amount: delta,
        transactionType: 'CASH_ADVANCE',
        orderId: id,
        cashierShiftId: openShift?.id || null,
        createdByUserId: user?.sub,
      });
    }
  }

  return updated;
}

/** Delete a cash advance record. Reverses whatever it contributed to the
 * Cash Ledger (the physical cash was already given out; deleting the record
 * is a correction, so the ledger must be corrected back to zero for it, not
 * left with a permanent phantom deduction). */
async function remove(id, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }

  const contribution = await cashLedgerService.contributionFor(before.restaurantId, id);
  if (contribution) {
    await cashLedgerService.record({
      restaurantId: before.restaurantId,
      amount: -contribution,
      transactionType: 'CASH_ADVANCE',
      orderId: id,
      createdByUserId: user?.sub,
    });
  }

  return repo('cashAdvances').remove(id);
}

/** Get all pending advances for a specific worker (used by payroll integration). */
async function getPendingByWorker(workerId, user) {
  const all = await repo('cashAdvances').getAll({ restaurantId: user?.restaurantId });
  return all.filter((a) => a.workerId === workerId && a.status === 'pending' && a.repaymentMethod !== 'cash-reimbursement');
}

/**
 * Deduct pending cash advances from a salary record's netPay.
 * Called during salary generation/payment to auto-deduct outstanding advances.
 * Returns { deductedAmount, advancesMarkedDeducted }.
 */
async function deductFromSalary(workerId, salaryRecord, user) {
  const pending = await getPendingByWorker(workerId, user);
  if (!pending.length) return { deductedAmount: 0, advancesMarkedDeducted: [] };

  const deductedAmount = pending.reduce((s, a) => s + (a.amount || 0), 0);
  const marked = [];

  for (const advance of pending) {
    await repo('cashAdvances').update(advance.id, {
      status: 'deducted',
      notes: `${advance.notes || ''} [Deducted from ${salaryRecord.month} salary]`.trim(),
    });
    marked.push(advance.id);
  }

  // Add deduction to salary record
  const currentDeductions = salaryRecord.deductions || 0;
  const newDeductions = +(currentDeductions + deductedAmount).toFixed(2);
  const currentNetPay = salaryRecord.netPay || 0;
  const newNetPay = +(currentNetPay - deductedAmount).toFixed(2);

  await repo('salaries').update(salaryRecord.id, {
    deductions: newDeductions,
    netPay: newNetPay,
    notes: `${salaryRecord.notes || ''}\nCash advance deduction: ${deductedAmount} (${pending.length} advance(s))`.trim(),
  });

  return { deductedAmount, advancesMarkedDeducted: marked };
}

export const cashAdvanceService = { list, create, update, remove, getPendingByWorker, deductFromSalary };
