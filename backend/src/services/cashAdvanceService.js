import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

/** List cash advances with optional status/date filters. */
async function list({ status, workerId, date } = {}, user) {
  let items = await repo('cashAdvances').getAll({ restaurantId: user?.restaurantId });
  if (status) items = items.filter((a) => a.status === status);
  if (workerId) items = items.filter((a) => a.workerId === workerId);
  if (date) items = items.filter((a) => (a.date || '').startsWith(date));
  return items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/** Create a new cash advance for a worker. */
async function create(data, user) {
  const existing = await repo('cashAdvances').getAll({ workerId: data.workerId, status: 'pending', restaurantId: user?.restaurantId });
  const totalPending = existing.reduce((s, a) => s + (a.amount || 0), 0);

  const advance = await repo('cashAdvances').create({
    workerId: data.workerId,
    workerName: data.workerName,
    amount: +data.amount,
    date: data.date || new Date().toISOString().slice(0, 10),
    description: data.description || '',
    status: 'pending',
    repaymentMethod: data.repaymentMethod || 'salary-deduction',
    notes: data.notes || '',
    restaurantId: user?.restaurantId,
  });

  await recordAudit(user, 'CASH_ADVANCE_CREATED', 'cashAdvances', advance.id, { after: advance, totalPending });
  return advance;
}

/** Update a cash advance (e.g., mark as reimbursed manually). */
async function update(id, patch, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }

  const updated = await repo('cashAdvances').update(id, {
    ...patch,
    amount: patch.amount != null ? +patch.amount : before.amount,
  });

  await recordAudit(user, 'CASH_ADVANCE_UPDATED', 'cashAdvances', id, { before, after: updated });
  return updated;
}

/** Delete a cash advance record. */
async function remove(id, user) {
  const before = await repo('cashAdvances').getById(id);
  if (!before) throw new HttpError(404, 'Cash advance not found');
  if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
    throw new HttpError(404, 'Cash advance not found');
  }
  const ok = await repo('cashAdvances').remove(id);
  await recordAudit(user, 'CASH_ADVANCE_DELETED', 'cashAdvances', id, { before });
  return ok;
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
