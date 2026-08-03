import { secureStore, initSecureStore } from '../repositories/secureStore.js';
import { repo } from '../repositories/index.js';
import { hashPassword } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SUPER_ADMIN = { username: 'superadmin', password: 'superadmin123' };
const DEFAULT_RESTAURANT = { name: 'Default Restaurant' };

/**
 * Ensures a restaurant has at least one login-capable account. Previously
 * this migration created the bootstrap restaurant + an (inactive) license
 * but ZERO `users` rows — meaning the demo credentials (admin/admin123,
 * cashier/cashier123) pre-filled and advertised right on the Login screen
 * could never actually log in on a fresh install; the "workers" entries
 * seeded by the separate, opt-in `npm run seed` mock dataset don't count
 * either, since a Worker record is deliberately never login-capable (see
 * the note in runMigrations below) — only a real `users` row is.
 *
 * Exported on its own (rather than inlined in runMigrations) so it can be
 * tested directly against a restaurant built in isolation, without depending
 * on runMigrations' own ambient "whichever restaurant happens to be first"
 * bootstrap-restaurant selection — which, in a shared test datastore where
 * other fixtures may have already created restaurants with their own admins,
 * is not a restaurant this logic would ever touch (it already has users).
 */
export async function ensureDefaultAccounts(restaurantId) {
  const store = secureStore();
  const existingUsers = await store.findAll('users', { restaurantId });
  if (existingUsers.length) return false;
  const { superAdminService } = await import('../services/superAdminService.js');
  // Usernames are globally unique across every restaurant in this app (see
  // superAdminService.assertUsernameAvailable) — on a real, already-used
  // database (not a fresh install), literally 'admin'/'cashier' may already
  // belong to some OTHER restaurant from earlier real-world use. That must
  // never be allowed to crash server boot entirely (this is a convenience
  // bootstrap, not essential functionality) — log and move on instead.
  let createdAny = false;
  for (const account of [
    { username: 'admin', password: 'admin123', role: 'ADMIN' },
    { username: 'cashier', password: 'cashier123', role: 'CASHIER' },
  ]) {
    try {
      await superAdminService.createRestaurantUser(restaurantId, account);
      createdAny = true;
    } catch (err) {
      logger.warn(`Skipped creating default '${account.username}' account for the bootstrap restaurant: ${err.message}`);
    }
  }
  if (createdAny) logger.success('Created default login account(s) for the bootstrap restaurant.');
  return createdAny;
}

export async function runMigrations() {
  await initSecureStore();
  const store = secureStore();

  // Ensure at least one super admin exists.
  const admins = await store.findAll('super_admins');
  if (!admins.length) {
    await store.create('super_admins', {
      username: DEFAULT_SUPER_ADMIN.username,
      passwordHash: await hashPassword(DEFAULT_SUPER_ADMIN.password),
      status: 'active',
    });
    logger.success(`Created default Super Admin: ${DEFAULT_SUPER_ADMIN.username} / ${DEFAULT_SUPER_ADMIN.password}`);
  }

  // Ensure a default restaurant exists for existing data.
  let restaurant = (await store.findAll('restaurants'))[0];
  if (!restaurant) {
    restaurant = await store.create('restaurants', { restaurantName: DEFAULT_RESTAURANT.name, status: 'active' });
    logger.success(`Created default restaurant: ${DEFAULT_RESTAURANT.name}`);
  }

  // NOTE: this used to auto-migrate every existing Worker into a login-
  // capable `users` row on first boot. That directly contradicts the
  // current architecture — a Worker is an employee record only and must
  // never automatically gain application login access; only the Super
  // Admin creates real accounts (see workerService.js/superAdminService.js).
  // Removed deliberately, not an oversight.

  // Ensure default restaurant has a license.
  const license = await store.findOne('licenses', { restaurantId: restaurant.id });
  if (!license) {
    const { licenseService } = await import('../services/licenseService.js');
    await licenseService.createLicense(restaurant.id, { maximumDevices: 10 });
    // A fresh createLicense() starts 'inactive', requiring an activation
    // token before any ADMIN can get a real session — but this restaurant
    // only exists as an out-of-the-box demo/sandbox, with no super-admin-
    // issued token anyone would ever have. Activate it immediately so the
    // demo credentials created below actually work on the very first boot,
    // with no extra manual step.
    await licenseService.setLicenseForever(restaurant.id);
    logger.success('Created default license for default restaurant');
  }

  await ensureDefaultAccounts(restaurant.id);


  // Stamp restaurant_id on all existing business records if missing.
  const collections = [
    'orders', 'products', 'goods', 'clients', 'workers', 'attendance', 'expenses',
    'salaries', 'reservations', 'kdsTickets', 'shifts', 'locations',
    'settings', 'suppliers', 'rents', 'cashAdvances', 'complaints', 'cashierShifts',
    'purchases', 'goodsChecks', 'loyaltyTx', 'deliveryAgents',
  ];
  let stamped = 0;
  for (const collection of collections) {
    try {
      const rows = await repo(collection).getAll();
      for (const row of rows) {
        if (!row.restaurantId) {
          await repo(collection).update(row.id, { restaurantId: restaurant.id });
          stamped += 1;
        }
      }
    } catch (err) {
      logger.warn(`Migration stamp failed for ${collection}: ${err.message}`);
    }
  }
  if (stamped) logger.info(`Stamped restaurant_id on ${stamped} existing records`);

  // Backfill `city` from the old `governorate` field on existing records —
  // additive only, never drops `governorate`, so no historical data is lost.
  let cityBackfilled = 0;
  for (const collection of ['clients', 'orders', 'locations']) {
    try {
      const rows = await repo(collection).getAll();
      for (const row of rows) {
        if (!row.city && row.governorate) {
          await repo(collection).update(row.id, { city: row.governorate });
          cityBackfilled += 1;
        }
      }
    } catch (err) {
      logger.warn(`City backfill failed for ${collection}: ${err.message}`);
    }
  }
  if (cityBackfilled) logger.info(`Backfilled city on ${cityBackfilled} existing records`);

  // Backfill the Restaurant Cash Ledger for installations that had cashier
  // shifts/paid orders before the ledger existed. One-time and safe to re-run:
  // guarded per-restaurant by "does this restaurant already have any ledger
  // entries at all" — once seeded, this never runs again for that restaurant,
  // so it can never double-count. For each currently open shift we seed
  // exactly what the old shift-only calculation used to report (opening float
  // + cash sales so far), so the Restaurant-wide balance is continuous across
  // the upgrade instead of resetting to 0.
  const { cashLedgerService } = await import('../services/cashLedgerService.js');
  const { cashierShiftService } = await import('../services/cashierShiftService.js');
  const restaurants = await store.findAll('restaurants');
  let ledgerSeeded = 0;
  for (const r of restaurants) {
    const existingEntries = await repo('cashLedger').getAll({ restaurantId: r.id });
    if (existingEntries.length) continue; // already seeded (or genuinely has real entries) — never re-touch
    const openShifts = await repo('cashierShifts').getAll({ restaurantId: r.id, status: 'open' });
    for (const shift of openShifts) {
      if (shift.openingFloat) {
        await cashLedgerService.record({
          restaurantId: r.id, amount: shift.openingFloat,
          transactionType: 'SHIFT_OPEN_FLOAT', cashierShiftId: shift.id, createdByUserId: shift.cashierId,
        });
        ledgerSeeded += 1;
      }
      const cashSales = await cashierShiftService.computeCashSales(shift.cashierId, shift.openedAt, Date.now(), { restaurantId: r.id });
      if (cashSales) {
        await cashLedgerService.record({
          restaurantId: r.id, amount: cashSales,
          transactionType: 'CASH_SALE', cashierShiftId: shift.id, createdByUserId: shift.cashierId,
        });
        ledgerSeeded += 1;
      }
    }
  }
  if (ledgerSeeded) logger.info(`Backfilled ${ledgerSeeded} Restaurant Cash Ledger entries from existing open shifts`);
}

export default runMigrations;
