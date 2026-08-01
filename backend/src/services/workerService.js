import { repo } from '../repositories/index.js';
import { createCrudService } from './baseService.js';
import { sanitize } from '../utils/hash.js';
import { HttpError } from '../middleware/errorHandler.js';

const base = createCrudService('workers', { entityName: 'worker' });

export const workerService = {
  async list(filter, user) {
    const rows = await base.list(filter, user);
    return rows.map(sanitize);
  },

  async get(id, user) {
    return sanitize(await base.get(id, user));
  },

  /** Minimal {id, name} list of active cashiers AND admins — safe for
   * non-admins (e.g. the shift handover picker, which can hand a till to
   * either another cashier or an admin covering it). */
  async cashiers(user) {
    const rows = await repo('workers').getAll({ restaurantId: user?.restaurantId });
    return rows
      .filter((w) => w.status !== 'inactive' && (w.role === 'cashier' || w.role === 'admin'))
      .map((w) => ({ id: w.id, name: w.name }));
  },

  /** Minimal {id, name} list of ALL active workers regardless of role — safe
   * for non-admins (e.g. the Cash Advance form's worker picker), since it
   * deliberately omits salary and every other field a Cashier shouldn't see. */
  async roster(user) {
    const rows = await repo('workers').getAll({ restaurantId: user?.restaurantId });
    return rows.filter((w) => w.status !== 'inactive').map((w) => ({ id: w.id, name: w.name }));
  },

  /**
   * Create an employee record. This is deliberately NOT a login account: an
   * Admin-created Worker (chef, general staff, an ordinary "cashier"-role
   * employee with no app access, etc.) gets no `users` row at all, so it is
   * structurally impossible for them to log into the POS/Dashboard/Admin
   * screens — they exist purely for attendance/salary/cash-advance/payroll
   * management. Real, login-capable Cashier accounts are only ever created by
   * the Super Admin (see superAdminService.createRestaurantUser), which links
   * back here via `appUserId` instead of this function creating one.
   */
  async create(data, user) {
    const workers = await repo('workers').getAll({ restaurantId: user?.restaurantId });
    const username = (data.username || '').trim().toLowerCase();
    if (workers.some((w) => (w.username || '').trim().toLowerCase() === username)) {
      throw new HttpError(409, 'Username already exists');
    }
    // `password`/`role` are accepted for backward-compatible form shape (the
    // Workers UI still has a username/role field) but no credential is ever
    // stored or usable for login — only `username`/`role` are kept, as plain
    // organizational/identifying fields on the employee record.
    const { password, ...rest } = data;
    const created = await repo('workers').create({ ...rest, restaurantId: user?.restaurantId });
    return sanitize(created);
  },

  /** True if this worker record is the employee-side counterpart of a real,
   * Super-Admin-managed login account — its authentication fields (username/
   * password/role/login status) are exclusively Super Admin's to change. */
  isLinkedAccount(worker) {
    return !!worker?.appUserId;
  },

  async update(id, patch, user) {
    const before = await repo('workers').getById(id);
    if (!before) throw new HttpError(404, 'worker not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'worker not found');
    }

    if (workerService.isLinkedAccount(before)) {
      // This Worker record represents a real Cashier account created by the
      // Super Admin — the Admin can manage employee fields (salary, phone,
      // hireDate, status) but must never be able to change username,
      // password, or role here: those control real application login and
      // are exclusively the Super Admin's to change (via the Super Admin
      // dashboard), preventing an Admin from silently escalating/hijacking
      // a Cashier's authentication. Only an actual attempted CHANGE is
      // blocked (not merely re-submitting the same unchanged value, since the
      // Workers edit form always round-trips username/role as part of the
      // same payload used to update salary/phone/etc.).
      if (patch.password) {
        throw new HttpError(400, '"password" cannot be changed here — this worker is a linked Cashier account managed by the Super Admin.');
      }
      if (patch.username !== undefined && patch.username !== before.username) {
        throw new HttpError(400, '"username" cannot be changed here — this worker is a linked Cashier account managed by the Super Admin.');
      }
      if (patch.role !== undefined && patch.role !== before.role) {
        throw new HttpError(400, '"role" cannot be changed here — this worker is a linked Cashier account managed by the Super Admin.');
      }
      const { password, ...safePatch } = patch;
      const updated = await base.update(id, safePatch, user);
      return sanitize(updated);
    }

    if (patch.username !== undefined) {
      const username = (patch.username || '').trim().toLowerCase();
      if (username !== (before.username || '').trim().toLowerCase()) {
        const workers = await repo('workers').getAll({ restaurantId: user?.restaurantId });
        if (workers.some((w) => w.id !== id && (w.username || '').trim().toLowerCase() === username)) {
          throw new HttpError(409, 'Username already exists');
        }
      }
    }

    // The raw plaintext password must never be persisted or echoed back —
    // only its hash. `password` is intentionally excluded (and, per create()
    // above, never actually grants login — kept only for backward-compatible
    // form shape / historical records that may still carry a passwordHash).
    const { password, ...next } = patch;
    const updated = await base.update(id, next, user);
    return sanitize(updated);
  },

  async disable(id, user) {
    const before = await repo('workers').getById(id);
    if (!before) throw new HttpError(404, 'worker not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'worker not found');
    }
    const updated = await repo('workers').update(id, { status: 'inactive' });
    // Deliberately does NOT touch a linked Cashier's login account/session —
    // suspending/reactivating the real account is exclusively the Super
    // Admin's action (via suspendRestaurantUser/activateRestaurantUser).
    // Marking the Worker record inactive here only affects employee-side
    // views (payroll/attendance), never login ability.
    return sanitize(updated);
  },

  /** Reactivate a previously disabled Worker — the counterpart to disable(). */
  async reactivate(id, user) {
    const before = await repo('workers').getById(id);
    if (!before) throw new HttpError(404, 'worker not found');
    if (user?.restaurantId && before.restaurantId && before.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'worker not found');
    }
    const updated = await repo('workers').update(id, { status: 'active' });
    return sanitize(updated);
  },

  async remove(id, user) {
    const before = await repo('workers').getById(id);
    if (!before) throw new HttpError(404, 'worker not found');
    if (workerService.isLinkedAccount(before)) {
      // Deleting the Worker record for a linked Cashier would sever the
      // Super-Admin-managed account from its employee/payroll history —
      // that link is not the Admin's to break. The Admin can still disable()
      // it (employee-side only); removing the actual account is done from
      // the Super Admin dashboard (deleteRestaurantUser), which never
      // deletes this linked Worker record either, for the same reason.
      throw new HttpError(400, 'This worker is a linked Cashier account — it cannot be removed here. Ask a Super Admin to deactivate the account instead.');
    }
    return base.remove(id, user);
  },

  /** Activity summary for a single worker (orders created + revenue generated). */
  async activity(id, user) {
    const orders = await repo('orders').getAll({ cashierId: id, restaurantId: user?.restaurantId });
    return {
      ordersCreated: orders.length,
      revenueGenerated: orders.reduce((s, o) => s + (o.totalPrice || 0), 0),
    };
  },
};

export default workerService;
