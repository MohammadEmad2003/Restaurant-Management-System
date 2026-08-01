import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { settingsService } from './settingsService.js';
import { cashAdvanceService } from './cashAdvanceService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('salaries', { entityName: 'salary' });
const STANDARD_MONTH_HOURS = 160;

/** Compute one worker's pay breakdown for a month from attendance + settings. */
function computeBreakdown(worker, attendanceRows, settings, overrides = {}) {
  const mine = attendanceRows.filter((a) => a.workerId === worker.id && a.status !== 'absent');
  // Only admin-approved overtime is paid.
  const overtimeHours = +mine.filter((a) => a.overtimeApproved !== false).reduce((s, a) => s + (a.overtimeHours || 0), 0).toFixed(2);
  // Only un-excused lateness is deducted.
  const lateMinutes = mine.filter((a) => !a.excused).reduce((s, a) => s + (a.lateMinutes || 0), 0);

  const baseSalary = worker.salary || 0;
  const hourlyRate = baseSalary / STANDARD_MONTH_HOURS;
  const overtimePay = +(overtimeHours * hourlyRate * (settings.overtimeMultiplier || 1.5)).toFixed(2);
  const lateDeduction = +(lateMinutes * (settings.lateDeductionPerMin || 0)).toFixed(2);

  const bonus = +(overrides.bonus || 0);
  const deductions = +(overrides.deductions || 0);
  const netPay = +(baseSalary + overtimePay + bonus - lateDeduction - deductions).toFixed(2);
  return {
    workerId: worker.id, workerName: worker.name,
    baseSalary, overtimeHours, overtimePay, lateMinutes, lateDeduction,
    bonus, deductions, netPay,
  };
}

export const salaryService = {
  ...base,

  /**
   * Pre-pay analysis: every active worker's salary breakdown for the month,
   * WITHOUT persisting anything. Merges any already-generated salary record so
   * manual bonuses/deductions show up. The admin reviews this before paying.
   */
  async preview({ month } = {}, user) {
    const m = month || new Date().toISOString().slice(0, 7);
    const [workers, attendance, existing, settings, advances] = await Promise.all([
      repo('workers').getAll({ restaurantId: user?.restaurantId }),
      repo('attendance').getAll({ restaurantId: user?.restaurantId }),
      repo('salaries').getAll({ month: m, restaurantId: user?.restaurantId }),
      settingsService.get(user),
      repo('cashAdvances').getAll({ restaurantId: user?.restaurantId }),
    ]);
    const monthAttendance = attendance.filter((a) => (a.date || '').startsWith(m));
    const byWorker = Object.fromEntries(existing.map((s) => [s.workerId, s]));
    // Pending salary-deduction advances per worker — informational only here
    // (the actual deduction happens in markPaid via cashAdvanceService), but
    // surfaced in the review so the admin sees it BEFORE clicking Pay, not
    // only after, when it silently reduces the recorded net pay. Mirrors
    // cashAdvanceService.getPendingByWorker() exactly (same withdrawn/target-
    // month rules), so Net Salary here always matches what payroll will
    // actually deduct — never a preview of a bigger deduction than what happens.
    const pendingAdvanceByWorker = {};
    for (const a of advances) {
      if (a.status !== 'pending' || a.repaymentMethod === 'cash-reimbursement') continue;
      // An advance that hasn't actually been withdrawn yet (the worker never
      // received the cash) must not reduce Net Salary — it isn't deductible
      // until withdraw() confirms the cash actually left the drawer.
      if (!a.withdrawn) continue;
      // An advance rolled forward to a later month (because this worker was
      // already paid when it was taken) isn't due against THIS month's
      // preview yet — only show it once its target month has arrived.
      if (a.targetMonth && a.targetMonth > m) continue;
      pendingAdvanceByWorker[a.workerId] = (pendingAdvanceByWorker[a.workerId] || 0) + (a.amount || 0);
    }
    const rows = workers.filter((w) => w.status === 'active').map((w) => {
      const rec = byWorker[w.id];
      const b = computeBreakdown(w, monthAttendance, settings, rec ? { bonus: rec.bonus, deductions: rec.deductions } : {});
      // Once paid, show what was ACTUALLY deducted for cash advances this
      // month (persisted on the salary record itself), not the live "still
      // pending" total — that one naturally drops to 0 the moment payroll
      // settles it, which would make Net Salary snap back up to the full
      // gross amount right after paying. The admin still needs to see how
      // much was actually deducted for this month, even after paying.
      const pendingAdvance = rec?.paid ? (rec.advanceDeduction || 0) : (pendingAdvanceByWorker[w.id] || 0);
      return { ...b, id: rec?.id || null, paid: rec?.paid || false, pendingAdvance };
    });
    return {
      month: m,
      settings: { lateDeductionPerMin: settings.lateDeductionPerMin || 0, overtimeMultiplier: settings.overtimeMultiplier || 1.5 },
      rows,
      total: +rows.reduce((s, r) => s + r.netPay, 0).toFixed(2),
    };
  },

  /** Generate a month's salary run from base salary + overtime − late deductions. */
  async generate({ month } = {}, user) {
    const m = month || new Date().toISOString().slice(0, 7);
    const [workers, attendance, existing, settings] = await Promise.all([
      repo('workers').getAll({ restaurantId: user?.restaurantId }),
      repo('attendance').getAll({ restaurantId: user?.restaurantId }),
      repo('salaries').getAll({ month: m, restaurantId: user?.restaurantId }),
      settingsService.get(user),
    ]);
    const monthAttendance = attendance.filter((a) => (a.date || '').startsWith(m));
    const created = [];
    for (const w of workers.filter((x) => x.status === 'active')) {
      if (existing.some((s) => s.workerId === w.id)) continue;
      const b = computeBreakdown(w, monthAttendance, settings);
      const rec = await repo('salaries').create({ ...b, month: m, paid: false, restaurantId: user?.restaurantId });
      created.push(rec);
    }
    return created;
  },

  /** Manually adjust a salary line (bonus / extra deduction / note) before paying. */
  async adjust(id, patch, user) {
    const before = await repo('salaries').getById(id);
    if (!before) throw new HttpError(404, 'salary not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'salary not found');
    }
    if (before.paid) throw new HttpError(409, 'Salary already paid');
    const bonus = patch.bonus != null ? +patch.bonus : before.bonus || 0;
    const deductions = patch.deductions != null ? +patch.deductions : before.deductions || 0;
    const netPay = +((before.baseSalary || 0) + (before.overtimePay || 0) + bonus - (before.lateDeduction || 0) - deductions).toFixed(2);
    return repo('salaries').update(id, { bonus, deductions, netPay, notes: patch.notes ?? before.notes });
  },

  /**
   * One-click payroll: generate the month's run (if needed) and pay every unpaid
   * salary, recording each as a 'salary' expense. Deducts each worker's pending
   * salary-deduction cash advances exactly like the per-worker Pay action does
   * — a worker who took an advance this month has it come out of THIS month's
   * salary regardless of whether they're paid individually or as part of a
   * bulk run.
   */
  async runMonthly({ month } = {}, user) {
    const m = month || new Date().toISOString().slice(0, 7);
    await this.generate({ month: m }, user);
    const all = await repo('salaries').getAll({ month: m, restaurantId: user?.restaurantId });
    const paid = [];
    for (const s of all) {
      if (!s.paid) paid.push(await this.markPaid(s.id, user));
    }
    // Re-fetch after paying — markPaid's advance deduction updates netPay, so
    // summing the pre-payment snapshot in `all` would understate the total.
    const final = await repo('salaries').getAll({ month: m, restaurantId: user?.restaurantId });
    const total = +final.reduce((sum, s) => sum + (s.netPay || 0), 0).toFixed(2);
    return { month: m, workers: all.length, paidNow: paid.length, total };
  },

  async markPaid(id, user, { deductAdvances = true } = {}) {
    const salary = await repo('salaries').getById(id);
    if (!salary) throw new HttpError(404, 'salary not found');
    if (user?.restaurantId && salary.restaurantId && salary.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'salary not found');
    }

    // Auto-deduct any pending cash advances before paying — only when asked
    // to (the per-worker Pay action asks; bulk "Run Payroll" deliberately
    // does not, see runMonthly above).
    const { deductedAmount } = deductAdvances
      ? await cashAdvanceService.deductFromSalary(salary.workerId, salary, user)
      : { deductedAmount: 0 };

    // Recalculate netPay after deduction, then mark paid
    const updated = await repo('salaries').update(id, { paid: true, paidAt: Date.now(), restaurantId: salary.restaurantId });
    // salary becomes an expense
    await repo('expenses').create({
      type: 'salary', amount: updated.netPay,
      description: `Salary ${updated.month} — ${updated.workerName}${deductedAmount ? ` (advances deducted: ${deductedAmount})` : ''}`,
      refId: updated.workerId, date: new Date().toISOString().slice(0, 10),
      restaurantId: user?.restaurantId,
    });
    // Salary is recorded as an expense above (P&L), but deliberately does NOT
    // touch the Cash Drawer/Cash Ledger — paying a worker's monthly salary is
    // no longer treated as a drawer cash-out event (unlike petty cash/cash
    // advances, which are real till-cash movements).
    return updated;
  },
};

export default salaryService;
