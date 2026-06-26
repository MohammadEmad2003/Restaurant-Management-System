import { LocalJsonRepository } from './LocalJsonRepository.js';
import { FirestoreRepository } from './FirestoreRepository.js';
import { getFirestore } from '../config/firebase.js';
import { connectivity } from '../sync/connectivity.js';
import { config } from '../config/index.js';

/**
 * Repository factory. Returns a thin proxy that delegates to the Firestore
 * repository when online, and to the local JSON repository when offline.
 * Services call repo(...) once and never worry about connectivity again.
 *
 * id-prefixes keep generated ids readable across collections.
 */
const PREFIX = {
  workers: 'WRK', attendance: 'ATT', clients: 'CLI', goods: 'GD',
  products: 'PRD', orders: 'ORD', goodsChecks: 'CHK', purchases: 'PUR',
  expenses: 'EXP', salaries: 'SAL', reservations: 'RSV', kdsTickets: 'KDS',
  shifts: 'SHF', branches: 'BR', auditLogs: 'LOG', settings: 'SET',
  loyaltyTx: 'LOY',
};

const localCache = new Map();
const remoteCache = new Map();

function local(collection) {
  if (!localCache.has(collection)) {
    localCache.set(collection, new LocalJsonRepository(collection, { idPrefix: PREFIX[collection] }));
  }
  return localCache.get(collection);
}

async function remote(collection) {
  const db = await getFirestore();
  if (!db) return null;
  if (!remoteCache.has(collection)) {
    remoteCache.set(collection, new FirestoreRepository(collection, db, { idPrefix: PREFIX[collection] }));
  }
  return remoteCache.get(collection);
}

/**
 * Returns a repository for a collection. When PERSISTENCE_MODE is "local" (or
 * Firebase is unreachable) every call uses the local store. Otherwise reads
 * prefer Firestore but always have the local store as a safety net.
 */
export function repo(collection) {
  const localRepo = local(collection);

  // Force-local mode → just the local repo (fully offline, mock-data ready).
  if (config.persistenceMode === 'local') return localRepo;

  // Auto/firebase mode → proxy that chooses per-call based on connectivity,
  // and writes always go through local (offline-first + outbox) so the sync
  // engine is the single path that reaches Firestore.
  return {
    collection,
    async getAll(filter) {
      if (connectivity.isOnline) {
        const r = await remote(collection);
        if (r) { try { return await r.getAll(filter); } catch { /* fall back */ } }
      }
      return localRepo.getAll(filter);
    },
    async getById(id) {
      if (connectivity.isOnline) {
        const r = await remote(collection);
        if (r) { try { return await r.getById(id); } catch { /* fall back */ } }
      }
      return localRepo.getById(id);
    },
    // Writes are always local-first; syncEngine pushes the outbox to Firestore.
    create: (data) => localRepo.create(data),
    update: (id, patch) => localRepo.update(id, patch),
    remove: (id) => localRepo.remove(id),
    query: (predicate) => localRepo.query(predicate),
  };
}

export default repo;
