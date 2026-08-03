import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('reservations', { entityName: 'reservation' });

export const reservationService = {
  ...base,

  async create(data, user) {
    if (data.dateTime && data.dateTime < Date.now()) {
      throw new HttpError(400, 'Reservation date cannot be in the past.');
    }
    return base.create(data, user);
  },

  async update(id, patch, user) {
    if (patch.dateTime && patch.dateTime < Date.now()) {
      throw new HttpError(400, 'Reservation date cannot be in the past.');
    }
    return base.update(id, patch, user);
  },

  async markNoShow(id, user) {
    return base.update(id, { status: 'no_show' }, user);
  },

  /** Reservations grouped by day for the calendar view. */
  async calendar({ from, to } = {}, user) {
    let rows = await repo('reservations').getAll({ restaurantId: user?.restaurantId });
    if (from) rows = rows.filter((r) => r.dateTime >= new Date(from).getTime());
    // `to` is a date-only "YYYY-MM-DD" string — without the +86399999ms
    // offset this cuts off at that day's UTC midnight, excluding every
    // reservation on the end date scheduled any time after 00:00 (the same
    // bug already fixed everywhere else date ranges are filtered in this
    // codebase — orderService, cashierShiftService, financeService, etc.).
    if (to) rows = rows.filter((r) => r.dateTime <= new Date(to).getTime() + 86399999);
    const byDay = {};
    for (const r of rows) {
      const day = new Date(r.dateTime).toISOString().slice(0, 10);
      (byDay[day] ||= []).push(r);
    }
    return byDay;
  },

  waitlist: (user) => repo('reservations').getAll({ status: 'waitlist', restaurantId: user?.restaurantId }),
};

export default reservationService;
