import { localStore } from '../repositories/localStore.js';
import { buildMockData } from './mockData.js';
import { logger } from '../utils/logger.js';

/** Wrap a plain record with a synced _sync envelope + timestamps. */
function envelope(record) {
  const ts = record.createdAt || Date.now();
  return {
    ...record,
    createdAt: ts,
    updatedAt: ts,
    _sync: { status: 'synced', version: 1, updatedAt: ts, deviceId: 'seed', deleted: false },
  };
}

const COLLECTION_MAP = {
  locations: 'locations', workers: 'workers', goods: 'goods', products: 'products',
  clients: 'clients', orders: 'orders', loyaltyTx: 'loyaltyTx', kdsTickets: 'kdsTickets',
  attendance: 'attendance', purchases: 'purchases', expenses: 'expenses', salaries: 'salaries',
  goodsChecks: 'goodsChecks', reservations: 'reservations', shifts: 'shifts',
  auditLogs: 'auditLogs', settings: 'settings',
};

export async function seed({ force = false } = {}) {
  const existing = localStore.load('workers');
  if (existing.length && !force) {
    logger.info(`Data already present (${existing.length} workers). Skipping seed. Use "npm run seed" to reseed.`);
    return false;
  }

  const data = await buildMockData();
  let total = 0;
  for (const [key, collection] of Object.entries(COLLECTION_MAP)) {
    const rows = (data[key] || []).map(envelope);
    localStore.set(collection, rows);
    total += rows.length;
  }
  // start with an empty outbox
  localStore.set('_outbox', []);

  logger.success(`Seeded ${total} mock records across ${Object.keys(COLLECTION_MAP).length} collections.`);
  logger.info(`  • ${data.orders.length} orders · ${data.clients.length} clients · ${data.products.length} products · ${data.goods.length} goods`);
  return true;
}

/** Called on server start — seeds only if empty. */
export async function ensureSeeded() {
  return seed({ force: false });
}

// Allow `npm run seed` (force reseed).
if (import.meta.url === `file://${process.argv[1]}`) {
  localStore.reset();
  seed({ force: true }).then(() => {
    logger.success('Reseed complete.');
    process.exit(0);
  });
}

export default seed;
