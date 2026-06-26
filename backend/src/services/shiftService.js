import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';

const base = createCrudService('shifts', { entityName: 'shift' });

export const shiftService = {
  ...base,

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
