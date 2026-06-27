import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';

const base = createCrudService('shifts', { entityName: 'shift' });

export const shiftService = {
  ...base,

  /** The shift a worker is scheduled for on a given day of week (0=Sun…6=Sat), if any. */
  async scheduleFor(workerId, dayOfWeek) {
    const shifts = await repo('shifts').getAll({ workerId });
    return shifts.find((s) => Number(s.dayOfWeek) === Number(dayOfWeek)) || null;
  },

  /** Whole weekly plan grouped by day, for the schedule grid. */
  async weekly() {
    const shifts = await repo('shifts').getAll();
    const byDay = {};
    for (let d = 0; d < 7; d++) byDay[d] = [];
    for (const s of shifts) (byDay[Number(s.dayOfWeek)] ||= []).push(s);
    return byDay;
  },

  /** Simple forecast-based staffing suggestion from recent order volume. */
  async forecast() {
    const orders = (await repo('orders').getAll()).filter((o) => o.status === 'completed');
    const byHour = Array(24).fill(0);
    for (const o of orders) byHour[new Date(o.orderDate).getHours()] += 1;
    const peak = byHour.map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count).slice(0, 4);
    return {
      peakHours: peak,
      recommendation: peak.map((p) => ({
        hour: `${String(p.hour).padStart(2, '0')}:00`,
        suggestedStaff: Math.max(2, Math.ceil(p.count / 10)),
      })),
    };
  },
};

export default shiftService;
