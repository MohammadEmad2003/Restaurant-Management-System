import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';

const base = createCrudService('reservations', { entityName: 'reservation' });

export const reservationService = {
  ...base,

  async markNoShow(id, user) {
    return base.update(id, { status: 'no_show' }, user);
  },

  /** Reservations grouped by day for the calendar view. */
  async calendar({ from, to } = {}) {
    let rows = await repo('reservations').getAll();
    if (from) rows = rows.filter((r) => r.dateTime >= new Date(from).getTime());
    if (to) rows = rows.filter((r) => r.dateTime <= new Date(to).getTime());
    const byDay = {};
    for (const r of rows) {
      const day = new Date(r.dateTime).toISOString().slice(0, 10);
      (byDay[day] ||= []).push(r);
    }
    return byDay;
  },

  waitlist: () => repo('reservations').getAll({ status: 'waitlist' }),
};

export default reservationService;
