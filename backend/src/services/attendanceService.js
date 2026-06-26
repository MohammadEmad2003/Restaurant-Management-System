import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

const STANDARD_DAY_HOURS = 8;
const todayStr = () => new Date().toISOString().slice(0, 10);

export const attendanceService = {
  async clockIn(workerId, user) {
    const open = (await repo('attendance').getAll({ workerId })).find((a) => !a.checkOutTime);
    if (open) throw new HttpError(409, 'Already clocked in');
    const record = await repo('attendance').create({
      workerId,
      checkInTime: Date.now(),
      checkOutTime: null,
      date: todayStr(),
      totalHours: 0,
      overtimeHours: 0,
    });
    await recordAudit(user, 'CLOCK_IN', 'attendance', record.id, { after: record });
    return record;
  },

  async clockOut(workerId, user) {
    const open = (await repo('attendance').getAll({ workerId })).find((a) => !a.checkOutTime);
    if (!open) throw new HttpError(409, 'Not clocked in');
    const checkOutTime = Date.now();
    const totalHours = +(((checkOutTime - open.checkInTime) / 3.6e6)).toFixed(2);
    const overtimeHours = Math.max(0, +(totalHours - STANDARD_DAY_HOURS).toFixed(2));
    const updated = await repo('attendance').update(open.id, { checkOutTime, totalHours, overtimeHours });
    await recordAudit(user, 'CLOCK_OUT', 'attendance', open.id, { after: updated });
    return updated;
  },

  async list({ workerId, from, to } = {}) {
    let rows = await repo('attendance').getAll(workerId ? { workerId } : {});
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    return rows.sort((a, b) => (b.checkInTime || 0) - (a.checkInTime || 0));
  },

  /** Monthly aggregate per worker. */
  async monthlyReport({ month } = {}) {
    const m = month || todayStr().slice(0, 7);
    const rows = (await repo('attendance').getAll()).filter((r) => (r.date || '').startsWith(m));
    const byWorker = {};
    for (const r of rows) {
      const w = (byWorker[r.workerId] ||= { workerId: r.workerId, days: 0, totalHours: 0, overtime: 0 });
      w.days += 1;
      w.totalHours += r.totalHours || 0;
      w.overtime += r.overtimeHours || 0;
    }
    const workers = await repo('workers').getAll();
    return Object.values(byWorker).map((w) => ({
      ...w,
      workerName: workers.find((x) => x.id === w.workerId)?.name || w.workerId,
      totalHours: +w.totalHours.toFixed(2),
      overtime: +w.overtime.toFixed(2),
    }));
  },
};

export default attendanceService;
