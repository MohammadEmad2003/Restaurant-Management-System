import { secureStore, initSecureStore } from '../repositories/secureStore.js';
import { repo } from '../repositories/index.js';
import { hashPassword } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SUPER_ADMIN = { username: 'superadmin', password: 'superadmin123' };
const DEFAULT_RESTAURANT = { name: 'Default Restaurant' };

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
    logger.success('Created default license for default restaurant');
  }

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
