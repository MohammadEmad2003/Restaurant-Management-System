import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { settingsService } from './settingsService.js';
import { recordAudit } from '../middleware/audit.js';
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
  async preview({ month } = {}) {
    const m = month || new Date().toISOString().slice(0, 7);
    const [workers, attendance, existing, settings] = await Promise.all([
      repo('workers').getAll(),
      repo('attendance').getAll(),
      repo('salaries').getAll({ month: m }),
      settingsService.get(),
    ]);
    const monthAttendance = attendance.filter((a) => (a.date || '').startsWith(m));
    const byWorker = Object.fromEntries(existing.map((s) => [s.workerId, s]));
    const rows = workers.filter((w) => w.status === 'active').map((w) => {
      const rec = byWorker[w.id];
      const b = computeBreakdown(w, monthAttendance, settings, rec ? { bonus: rec.bonus, deductions: rec.deductions } : {});
      return { ...b, id: rec?.id || null, paid: rec?.paid || false };
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
      repo('workers').getAll(),
      repo('attendance').getAll(),
      repo('salaries').getAll({ month: m }),
      settingsService.get(),
    ]);
    const monthAttendance = attendance.filter((a) => (a.date || '').startsWith(m));
    const created = [];
    for (const w of workers.filter((x) => x.status === 'active')) {
      if (existing.some((s) => s.workerId === w.id)) continue;
      const b = computeBreakdown(w, monthAttendance, settings);
      const rec = await repo('salaries').create({ ...b, month: m, paid: false });
      created.push(rec);
    }
    await recordAudit(user, 'SALARY_GENERATED', 'salaries', null, { after: { month: m, count: created.length } });
    return created;
  },

  /** Manually adjust a salary line (bonus / extra deduction / note) before paying. */
  async adjust(id, patch, user) {
    const before = await repo('salaries').getById(id);
    if (!before) throw new HttpError(404, 'salary not found');
    if (before.paid) throw new HttpError(409, 'Salary already paid');
    const bonus = patch.bonus != null ? +patch.bonus : before.bonus || 0;
    const deductions = patch.deductions != null ? +patch.deductions : before.deductions || 0;
    const netPay = +((before.baseSalary || 0) + (before.overtimePay || 0) + bonus - (before.lateDeduction || 0) - deductions).toFixed(2);
    const updated = await repo('salaries').update(id, { bonus, deductions, netPay, notes: patch.notes ?? before.notes });
    await recordAudit(user, 'SALARY_ADJUSTED', 'salaries', id, { before, after: updated });
    return updated;
  },

  /**
   * One-click payroll: generate the month's run (if needed) and pay every unpaid
   * salary, recording each as a 'salary' expense.
   */
  async runMonthly({ month } = {}, user) {
    const m = month || new Date().toISOString().slice(0, 7);
    await this.generate({ month: m }, user);
    const all = await repo('salaries').getAll({ month: m });
    const paid = [];
    for (const s of all) {
      if (!s.paid) paid.push(await this.markPaid(s.id, user));
    }
    const total = +all.reduce((sum, s) => sum + (s.netPay || 0), 0).toFixed(2);
    return { month: m, workers: all.length, paidNow: paid.length, total };
  },

  async markPaid(id, user) {
    const updated = await repo('salaries').update(id, { paid: true, paidAt: Date.now() });
    if (!updated) throw new HttpError(404, 'salary not found');
    // salary becomes an expense
    await repo('expenses').create({
      type: 'salary', amount: updated.netPay,
      description: `Salary ${updated.month} — ${updated.workerName}`,
      refId: updated.workerId, date: new Date().toISOString().slice(0, 10),
    });
    await recordAudit(user, 'SALARY_PAID', 'salaries', id, { after: updated });
    return updated;
  },
};

export default salaryService;
