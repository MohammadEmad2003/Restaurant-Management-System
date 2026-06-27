import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';
import { verifyPassword, sanitize } from '../utils/hash.js';
import { shiftService } from './shiftService.js';

const STANDARD_DAY_HOURS = 8;
const GRACE_MINUTES = 5;
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Fallback shift split when a worker has no schedule entry for the day. */
export function shiftLateness(ts) {
  const d = new Date(ts);
  const isDay = d.getHours() >= 12; // 12:00–23:59 → day shift, else night shift
  const start = new Date(d);
  start.setHours(isDay ? 12 : 0, 0, 0, 0);
  const rawLate = Math.round((ts - start.getTime()) / 60000);
  return { shift: isDay ? 'day' : 'night', lateMinutes: Math.max(0, rawLate - GRACE_MINUTES) };
}

/** Parse "HH:MM" → minutes since midnight. */
function hm(s) {
  const [h, m] = String(s || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Length of a scheduled shift in hours, handling wrap past midnight. */
function shiftLengthHours(shift) {
  if (!shift?.start || !shift?.end) return STANDARD_DAY_HOURS;
  let mins = hm(shift.end) - hm(shift.start);
  if (mins <= 0) mins += 24 * 60; // overnight shift
  return mins / 60;
}

/**
 * Resolve shift label, lateness and off-day status for a clock-in, using the
 * worker's weekly schedule. No schedule for that weekday → it's the worker's day
 * off, so the whole shift counts as overtime and there's no lateness.
 */
async function resolveShift(workerId, ts) {
  const d = new Date(ts);
  const schedule = await shiftService.scheduleFor(workerId, d.getDay());
  if (!schedule) {
    return { shift: shiftLateness(ts).shift, lateMinutes: 0, isOffDay: true, schedule: null };
  }
  const start = new Date(d);
  const startMin = hm(schedule.start);
  start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  const rawLate = Math.round((ts - start.getTime()) / 60000);
  const startHour = Math.floor(startMin / 60);
  return {
    shift: startHour >= 12 ? 'day' : 'night',
    lateMinutes: Math.max(0, rawLate - GRACE_MINUTES),
    isOffDay: false,
    schedule,
  };
}

export const attendanceService = {
  async clockIn(workerId, user) {
    const open = (await repo('attendance').getAll({ workerId })).find((a) => !a.checkOutTime && a.status !== 'absent');
    if (open) throw new HttpError(409, 'Already clocked in');
    const checkInTime = Date.now();
    const worker = await repo('workers').getById(workerId);
    const { shift, lateMinutes, isOffDay } = await resolveShift(workerId, checkInTime);
    const record = await repo('attendance').create({
      workerId,
      workerName: worker?.name || null,
      checkInTime,
      checkOutTime: null,
      date: todayStr(),
      totalHours: 0,
      overtimeHours: 0,
      shift,
      lateMinutes,
      isOffDay,
      overtimeApproved: true,
      status: 'present',
    });
    await recordAudit(user, 'CLOCK_IN', 'attendance', record.id, { after: record });
    return record;
  },

  /**
   * Kiosk-style attendance: a worker enters their own username + password on a
   * shared device and is toggled between clocked-in and clocked-out.
   */
  async markByCredentials(username, password) {
    if (!username || !password) throw new HttpError(400, 'Username and password are required');
    const worker = (await repo('workers').getAll()).find((w) => w.username === username);
    if (!worker) throw new HttpError(401, 'Invalid credentials');
    if (worker.status === 'inactive') throw new HttpError(403, 'Account disabled');
    const ok = await verifyPassword(password, worker.passwordHash || '');
    if (!ok) throw new HttpError(401, 'Invalid credentials');

    const actor = { sub: worker.id, role: worker.role, name: worker.name };
    const open = (await repo('attendance').getAll({ workerId: worker.id })).find((a) => !a.checkOutTime && a.status !== 'absent');
    if (open) {
      const record = await this.clockOut(worker.id, actor);
      return { action: 'clock-out', worker: sanitize(worker), record };
    }
    const record = await this.clockIn(worker.id, actor);
    return { action: 'clock-in', worker: sanitize(worker), record };
  },

  async clockOut(workerId, user) {
    const open = (await repo('attendance').getAll({ workerId })).find((a) => !a.checkOutTime && a.status !== 'absent');
    if (!open) throw new HttpError(409, 'Not clocked in');
    const checkOutTime = Date.now();
    const totalHours = +(((checkOutTime - open.checkInTime) / 3.6e6)).toFixed(2);
    // Off-day work is entirely overtime; otherwise overtime is hours beyond the
    // scheduled shift length.
    let overtimeHours;
    if (open.isOffDay) {
      overtimeHours = totalHours;
    } else {
      const schedule = await shiftService.scheduleFor(workerId, new Date(open.checkInTime).getDay());
      overtimeHours = Math.max(0, +(totalHours - shiftLengthHours(schedule)).toFixed(2));
    }
    const updated = await repo('attendance').update(open.id, { checkOutTime, totalHours, overtimeHours });
    await recordAudit(user, 'CLOCK_OUT', 'attendance', open.id, { after: updated });
    return updated;
  },

  /** Admin: excuse (or un-excuse) a late clock-in, optionally tweak the minutes. */
  async setExcuse(id, { excused, lateMinutes }, user) {
    const rec = await repo('attendance').getById(id);
    if (!rec) throw new HttpError(404, 'attendance record not found');
    const patch = {};
    if (excused !== undefined) patch.excused = !!excused;
    if (lateMinutes !== undefined) patch.lateMinutes = Math.max(0, Number(lateMinutes) || 0);
    const updated = await repo('attendance').update(id, patch);
    await recordAudit(user, 'ATTENDANCE_EXCUSED', 'attendance', id, { before: rec, after: updated });
    return updated;
  },

  /** Admin: apply/remove overtime on one record, or override its hours. */
  async setOvertime(id, { approved, overtimeHours }, user) {
    const rec = await repo('attendance').getById(id);
    if (!rec) throw new HttpError(404, 'attendance record not found');
    const patch = {};
    if (approved !== undefined) patch.overtimeApproved = !!approved;
    if (overtimeHours !== undefined) patch.overtimeHours = Math.max(0, Number(overtimeHours) || 0);
    const updated = await repo('attendance').update(id, patch);
    await recordAudit(user, 'ATTENDANCE_OVERTIME', 'attendance', id, { before: rec, after: updated });
    return updated;
  },

  /** Admin: apply/remove overtime for every record in a month (or a single day). */
  async bulkOvertime({ approved = true, month, date } = {}, user) {
    let rows = await repo('attendance').getAll();
    if (date) rows = rows.filter((r) => r.date === date);
    else if (month) rows = rows.filter((r) => (r.date || '').startsWith(month));
    let count = 0;
    for (const r of rows) {
      if ((r.overtimeHours || 0) <= 0) continue;
      if (!!r.overtimeApproved === !!approved) continue;
      await repo('attendance').update(r.id, { overtimeApproved: !!approved });
      count += 1;
    }
    await recordAudit(user, 'ATTENDANCE_OVERTIME_BULK', 'attendance', null, { after: { approved, count, month, date } });
    return { updated: count, approved: !!approved };
  },

  /**
   * Admin: mark absentees for a finished day. Every active worker scheduled on
   * that weekday with no attendance record gets one absent row (idempotent).
   */
  async markAbsences({ date } = {}, user) {
    const day = date || todayStr();
    const dow = new Date(day).getDay();
    const [workers, dayRows, shifts] = await Promise.all([
      repo('workers').getAll(),
      repo('attendance').getAll(),
      repo('shifts').getAll(),
    ]);
    const present = new Set(dayRows.filter((r) => r.date === day).map((r) => r.workerId));
    const scheduled = new Set(shifts.filter((s) => Number(s.dayOfWeek) === dow).map((s) => s.workerId));
    const created = [];
    for (const w of workers.filter((x) => x.status === 'active')) {
      if (!scheduled.has(w.id) || present.has(w.id)) continue;
      const rec = await repo('attendance').create({
        workerId: w.id, workerName: w.name, date: day,
        totalHours: 0, overtimeHours: 0, lateMinutes: 0,
        status: 'absent', overtimeApproved: false,
      });
      created.push(rec);
    }
    await recordAudit(user, 'ATTENDANCE_ABSENCES', 'attendance', null, { after: { date: day, count: created.length } });
    return { date: day, marked: created.length };
  },

  async list({ workerId, from, to } = {}) {
    let rows = await repo('attendance').getAll(workerId ? { workerId } : {});
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    // Backfill worker names for older records that didn't snapshot them.
    if (rows.some((r) => !r.workerName)) {
      const workers = await repo('workers').getAll();
      const nameById = Object.fromEntries(workers.map((w) => [w.id, w.name]));
      rows = rows.map((r) => ({ ...r, workerName: r.workerName || nameById[r.workerId] || r.workerId }));
    }
    return rows.sort((a, b) => (b.checkInTime || 0) - (a.checkInTime || 0) || (b.date || '').localeCompare(a.date || ''));
  },

  /** Monthly aggregate per worker (approved overtime + absence count). */
  async monthlyReport({ month, from, to } = {}) {
    let rows = await repo('attendance').getAll();
    if (from || to) {
      if (from) rows = rows.filter((r) => (r.date || '') >= from);
      if (to) rows = rows.filter((r) => (r.date || '') <= to);
    } else {
      const m = month || todayStr().slice(0, 7);
      rows = rows.filter((r) => (r.date || '').startsWith(m));
    }
    const byWorker = {};
    for (const r of rows) {
      const w = (byWorker[r.workerId] ||= { workerId: r.workerId, days: 0, totalHours: 0, overtime: 0, absences: 0, lateMinutes: 0 });
      if (r.status === 'absent') { w.absences += 1; continue; }
      w.days += 1;
      w.totalHours += r.totalHours || 0;
      if (r.overtimeApproved !== false) w.overtime += r.overtimeHours || 0;
      if (!r.excused) w.lateMinutes += r.lateMinutes || 0;
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
