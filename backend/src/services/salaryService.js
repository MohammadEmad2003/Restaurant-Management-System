import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('salaries', { entityName: 'salary' });

export const salaryService = {
  ...base,

  /** Generate a month's salary run from base salary + overtime. */
  async generate({ month }, user) {
    const m = month || new Date().toISOString().slice(0, 7);
    const workers = (await repo('workers').getAll()).filter((w) => w.status === 'active');
    const attendance = (await repo('attendance').getAll()).filter((a) => (a.date || '').startsWith(m));
    const existing = await repo('salaries').getAll({ month: m });

    const created = [];
    for (const w of workers) {
      if (existing.some((s) => s.workerId === w.id)) continue;
      const overtime = attendance.filter((a) => a.workerId === w.id).reduce((s, a) => s + (a.overtimeHours || 0), 0);
      const hourlyRate = (w.salary || 0) / 160; // ~160 working hours/month
      const overtimePay = +(overtime * hourlyRate * 1.5).toFixed(2);
      const netPay = +((w.salary || 0) + overtimePay).toFixed(2);
      const rec = await repo('salaries').create({
        workerId: w.id, workerName: w.name, month: m,
        baseSalary: w.salary || 0, overtimePay, deductions: 0, netPay, paid: false,
      });
      created.push(rec);
    }
    await recordAudit(user, 'SALARY_GENERATED', 'salaries', null, { after: { month: m, count: created.length } });
    return created;
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
