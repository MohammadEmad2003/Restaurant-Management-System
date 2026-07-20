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

  // Migrate existing workers to users if users table is empty.
  const users = await store.findAll('users');
  if (!users.length) {
    const workers = await repo('workers').getAll();
    for (const worker of workers) {
      await store.create('users', {
        restaurantId: restaurant.id,
        username: worker.username || worker.name,
        passwordHash: worker.passwordHash || await hashPassword('password123'),
        role: worker.role === 'admin' ? 'ADMIN' : 'CASHIER',
        status: worker.status === 'inactive' ? 'inactive' : 'active',
        legacyWorkerId: worker.id,
      });
    }
    logger.success(`Migrated ${workers.length} workers to users`);
  }

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
    'salaries', 'reservations', 'kdsTickets', 'shifts', 'locations', 'auditLogs',
    'settings', 'suppliers', 'rents', 'cashAdvances', 'complaints', 'cashierShifts',
    'purchases', 'goodsChecks', 'loyaltyTx',
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
}

export default runMigrations;
