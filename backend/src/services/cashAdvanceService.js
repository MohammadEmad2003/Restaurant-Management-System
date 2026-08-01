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

/** The YYYY-MM immediately after `monthStr` (YYYY-MM), rolling over the year. */
function nextMonthOf(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); // `m` (1-12) as a 0-based month index is next month
}

/**
 * Which salary month a NEW salary-deduction advance should be deducted from:
 * the advance's own month (its `date` field — "today" unless backdated),
 * unless that worker has already been paid for it — in which case it
 * automatically rolls to the following month instead, since that month's
 * salary is already finalized and can't be re-opened.
 */
async function resolveTargetMonth(workerId, restaurantId, date) {
  const month = date.slice(0, 7);
  const existing = (await repo('salaries').getAll({ month, restaurantId, workerId }))[0];
  return existing?.paid ? nextMonthOf(month) : month;
}

/** List cash advances with optional status/date filters. */
async function list({ status, workerId, date } = {}, user) {
  let items = await repo('cashAdvances').getAll({ restaurantId: user?.restaurantId });
  if (status) items = items.filter((a) => a.status === status);
  if (workerId) items = items.filter((a) => a.workerId === workerId);
  if (date) items = items.filter((a) => (a.date || '').startsWith(date));
  return items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * Create a new cash advance record for a worker. This is deliberately
 * paperwork-only — it does NOT touch the Cash Drawer at all. The drawer only
 * decreases once the cash is actually confirmed handed over, via withdraw()
 * below; a record that's created but never withdrawn must have zero effect
 * on the drawer.
 *
 * Idempotency: serialized per worker+amount+date so two near-simultaneous
 * identical requests (e.g. a double-clicked Save button) can't race past the
 * duplicate check below; the second one within DUPLICATE_WINDOW_MS returns
 * the already-created advance instead of creating a second one.
 */
async function create(data, user) {
  const amount = +data.amount;
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'amount must be a positive number');
  const date = data.date || new Date().toISOString().slice(0, 10);
  const restaurantId = user?.restaurantId;
  const repaymentMethod = data.repaymentMethod || 'salary-deduction';
  const lockKey = `cash-advance-${restaurantId}-${data.workerId}-${amount}-${date}`;

  return withLock(lockKey, async () => {
    const recent = await repo('cashAdvances').getAll({ restaurantId, workerId: data.workerId });
    const duplicate = recent.find((a) =>
      a.amount === amount && a.date === date &&
      Date.now() - (a.createdAt || 0) < DUPLICATE_WINDOW_MS);
    if (duplicate) return duplicate;

    // An advance repaid via salary deduction can never exceed what the
    // worker's salary can actually cover — otherwise payroll would have to
    // deduct more than the salary is worth. Cash-reimbursement advances are
    // repaid some other way entirely, so this cap doesn't apply to them.
    // (This is a pre-emptive business rule independent of the drawer — it
    // applies whether or not the cash has been withdrawn yet.)
    if (repaymentMethod === 'salary-deduction') {
      const worker = await repo('workers').getById(data.workerId);
      const salary = worker?.salary || 0;
      const alreadyPending = recent
        .filter((a) => a.status === 'pending' && a.repaymentMethod !== 'cash-reimbursement')
        .reduce((s, a) => s + (a.amount || 0), 0);
      if (alreadyPending + amount > salary) {
        throw new HttpError(400, `This advance (${amount}) plus any already pending (${alreadyPending}) would exceed ${worker?.name || 'the worker'}'s salary (${salary}).`);
      }
    }

    // Salary-deduction advances are pinned to a specific salary month right
    // away: this month if it's not paid yet, otherwise automatically the
    // following month — not just "whichever salary happens to be paid next".
    const targetMonth = repaymentMethod === 'salary-deduction'
      ? await resolveTargetMonth(data.workerId, restaurantId, date)
      : null;

    return repo('cashAdvances').create({
      workerId: data.workerId,
      workerName: data.workerName,
      amount,
      date,
      description: data.description || '',
      status: 'pending',
      repaymentMethod,
      targetMonth,
      withdrawn: false,
      withdrawnAt: null,
      returned: false,
      returnedAt: null,
      notes: data.notes || '',
      restaurantId,
    });
  });
}

/**
 * Confirm the advance's cash has actually been handed to the worker — the
 * ONE moment the Cash Drawer really decreases for this advance. Checked
 * against the drawer balance right here (not at create() time), since the
 * drawer may have changed in the meantime and a record sitting un-withdrawn
 * must never have reserved/reduced it.
 *
 * Idempotent: calling this again on an already-withdrawn advance is a no-op
 * — never a second Cash Ledger entry, never a second deduction.
 */
async function withdraw(id, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }
  if (before.withdrawn) return before;

  return withLock(`cash-advance-withdraw-${id}`, async () => {
    // Re-read inside the lock — a concurrent request may have just withdrawn it.
    const fresh = await repo('cashAdvances').getById(id);
    if (fresh.withdrawn) return fresh;

    const drawerBalance = await cashLedgerService.balance(fresh.restaurantId);
    if (fresh.amount > drawerBalance) {
      throw new HttpError(400, `Not enough cash in the drawer (${drawerBalance}) to withdraw ${fresh.amount}.`);
    }

    const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
    await cashLedgerService.record({
      restaurantId: fresh.restaurantId,
      amount: -fresh.amount,
      transactionType: 'CASH_ADVANCE_WITHDRAWAL',
      orderId: id,
      cashierShiftId: openShift?.id || null,
      createdByUserId: user?.sub,
    });

    return repo('cashAdvances').update(id, { withdrawn: true, withdrawnAt: Date.now() });
  });
}

/**
 * Confirm the worker physically returned a cash-reimbursement advance — the
 * Cash Drawer increases exactly once, ever, for this advance. Only valid for
 * a cash-reimbursement advance that was actually withdrawn (returning money
 * that was never handed out, or that's meant to be settled through payroll
 * instead, makes no sense).
 *
 * Idempotent: calling this again after it's already returned is a no-op.
 */
async function returnAdvance(id, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }
  if (before.repaymentMethod !== 'cash-reimbursement') {
    throw new HttpError(400, 'Only a cash-reimbursement advance can be returned — a salary-deduction advance is settled automatically by payroll.');
  }
  if (!before.withdrawn) {
    throw new HttpError(400, 'This advance was never withdrawn, so there is nothing to return.');
  }
  if (before.returned) return before;

  return withLock(`cash-advance-return-${id}`, async () => {
    const fresh = await repo('cashAdvances').getById(id);
    if (fresh.returned) return fresh;

    const openShift = await cashierShiftService.openShiftFor(user?.sub, user);
    await cashLedgerService.record({
      restaurantId: fresh.restaurantId,
      amount: fresh.amount,
      transactionType: 'CASH_ADVANCE_RETURN',
      orderId: id,
      cashierShiftId: openShift?.id || null,
      createdByUserId: user?.sub,
    });

    return repo('cashAdvances').update(id, { returned: true, returnedAt: Date.now() });
  });
}

/** Update a cash advance's editable paperwork fields (amount, repayment
 * method, description/notes). Withdrawal, return, and salary-deduction state
 * are NOT editable here — see withdraw()/returnAdvance()/deductFromSalary(),
 * the only places those may ever change. */
async function update(id, patch, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }

  // Withdrawal/return/deduction state can ONLY change via their own dedicated
  // actions — never through a direct field edit here. Allowing that would let
  // someone fake any of these transitions without the matching real Cash
  // Ledger entry (or salary deduction) ever actually happening.
  for (const field of ['withdrawn', 'withdrawnAt', 'returned', 'returnedAt', 'status']) {
    if (patch[field] !== undefined) {
      throw new HttpError(400, `"${field}" cannot be set directly — it only changes via the dedicated withdraw/return/payroll actions.`);
    }
  }

  const newAmount = patch.amount != null ? +patch.amount : before.amount;
  const newRepaymentMethod = patch.repaymentMethod || before.repaymentMethod || 'salary-deduction';

  if (patch.amount != null && (!Number.isFinite(newAmount) || newAmount <= 0)) {
    throw new HttpError(400, 'amount must be a positive number');
  }

  // Once the cash has actually been withdrawn, its amount is a fixed,
  // already-recorded fact in the Cash Ledger — changing it here would leave
  // that entry silently wrong with no automatic correction.
  if (patch.amount != null && before.withdrawn) {
    throw new HttpError(400, 'This advance has already been withdrawn — its amount can no longer be edited.');
  }

  // Same salary cap as create() — an edit that raises the amount (or
  // switches an advance onto salary-deduction) must not push this worker's
  // total pending salary-deduction advances past their salary either.
  if (newRepaymentMethod === 'salary-deduction' && newAmount > before.amount) {
    const worker = await repo('workers').getById(before.workerId);
    const salary = worker?.salary || 0;
    const others = (await repo('cashAdvances').getAll({ restaurantId: before.restaurantId, workerId: before.workerId }))
      .filter((a) => a.id !== id && a.status === 'pending' && a.repaymentMethod !== 'cash-reimbursement')
      .reduce((s, a) => s + (a.amount || 0), 0);
    if (others + newAmount > salary) {
      throw new HttpError(400, `This advance (${newAmount}) plus any already pending (${others}) would exceed ${worker?.name || 'the worker'}'s salary (${salary}).`);
    }
  }

  // Switching an advance onto salary-deduction (it had none before, e.g. it
  // started as cash-reimbursement) needs a target month pinned now, exactly
  // like a brand-new one gets at create() time.
  const targetMonth = (newRepaymentMethod === 'salary-deduction' && !before.targetMonth)
    ? await resolveTargetMonth(before.workerId, before.restaurantId, before.date)
    : undefined;

  return repo('cashAdvances').update(id, {
    ...patch,
    amount: newAmount,
    ...(targetMonth ? { targetMonth } : {}),
  });
}

/** Delete a cash advance record. Reverses whatever it net contributed to the
 * Cash Ledger — zero if it was never withdrawn, -amount if withdrawn but not
 * returned, or already-zero if withdrawn AND returned (the two entries
 * already cancel out) — so deleting never leaves a phantom permanent
 * deduction or double-corrects an already-settled advance. */
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

/**
 * Get all pending advances for a specific worker (used by payroll integration
 * and the general pending-advances lookup).
 *
 * `forMonth` (a YYYY-MM salary month) scopes this to advances that are
 * actually due by that month: an advance targeted at a later month must NOT
 * be pulled forward into an earlier one (e.g. an advance rolled to next month
 * because this month was already paid must not also hit this month). An
 * advance targeted at an earlier or the same month still matches — this lets
 * an advance "catch up" if a month was skipped over entirely rather than
 * being silently stuck forever. Advances predating this field (no
 * `targetMonth` at all) always match, preserving old behavior. Omit
 * `forMonth` entirely to get every pending advance regardless of month (used
 * by the general worker lookup, not by payroll).
 *
 * Only WITHDRAWN advances are ever deductible: an advance the worker hasn't
 * actually been handed the cash for yet must never reduce their salary —
 * that would deduct money they never received. It stays "pending" and
 * invisible to payroll until withdraw() confirms the cash actually left the
 * drawer.
 */
async function getPendingByWorker(workerId, user, forMonth) {
  const all = await repo('cashAdvances').getAll({ restaurantId: user?.restaurantId });
  return all.filter((a) =>
    a.workerId === workerId &&
    a.status === 'pending' &&
    a.withdrawn &&
    a.repaymentMethod !== 'cash-reimbursement' &&
    (forMonth == null || !a.targetMonth || a.targetMonth <= forMonth));
}

/**
 * Deduct pending cash advances from a salary record's netPay.
 * Called during salary generation/payment to auto-deduct outstanding advances.
 * Returns { deductedAmount, advancesMarkedDeducted }.
 */
async function deductFromSalary(workerId, salaryRecord, user) {
  const pending = await getPendingByWorker(workerId, user, salaryRecord.month);
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
  // Tracked separately from `deductions` (which may also include a manual
  // admin adjustment) so the Workers page can keep showing exactly how much
  // was deducted for cash advances specifically, even after this salary is
  // paid and the advance itself drops out of the "pending" total.
  const newAdvanceDeduction = +((salaryRecord.advanceDeduction || 0) + deductedAmount).toFixed(2);

  await repo('salaries').update(salaryRecord.id, {
    deductions: newDeductions,
    advanceDeduction: newAdvanceDeduction,
    netPay: newNetPay,
    notes: `${salaryRecord.notes || ''}\nCash advance deduction: ${deductedAmount} (${pending.length} advance(s))`.trim(),
  });

  return { deductedAmount, advancesMarkedDeducted: marked };
}

export const cashAdvanceService = { list, create, update, remove, withdraw, returnAdvance, getPendingByWorker, deductFromSalary };
