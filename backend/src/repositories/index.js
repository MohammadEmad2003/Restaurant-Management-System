import { LocalJsonRepository } from './LocalJsonRepository.js';
import { FirestoreRepository } from './FirestoreRepository.js';
import { getFirestore } from '../config/firebase.js';
import { connectivity } from '../sync/connectivity.js';
import { config } from '../config/index.js';
import { withTimeout } from '../utils/withTimeout.js';
import { outbox } from '../sync/outbox.js';

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
  shifts: 'SHF', locations: 'LOC', auditLogs: 'LOG', settings: 'SET',
  loyaltyTx: 'LOY',
};

/**
 * Short-lived in-memory cache for getAll() results. Analytics, reports and the
 * dashboard fan out into many getAll() calls per request; caching the unfiltered
 * collection for a couple of seconds collapses dozens of Firestore reads into
 * one. Any write to a collection clears its cache so reads stay correct.
 */
const READ_TTL_MS = Number(process.env.READ_CACHE_TTL_MS) || 2500;
const readCache = new Map(); // collection → { at, rows }

function cacheGet(collection) {
  const hit = readCache.get(collection);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.rows;
  return null;
}
function cacheSet(collection, rows) {
  readCache.set(collection, { at: Date.now(), rows });
}
export function invalidate(collection) {
  if (collection) readCache.delete(collection);
  else readCache.clear();
}
/** Apply a simple equality filter the same way the underlying repos do. */
function applyFilter(rows, filter) {
  if (!filter || !Object.keys(filter).length) return rows;
  return rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
}

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

  // Force-local mode → local repo wrapped with the read cache + invalidation.
  if (config.persistenceMode === 'local') {
    return {
      collection,
      async getAll(filter) {
        const cached = cacheGet(collection);
        if (cached) return applyFilter(cached, filter);
        const rows = await localRepo.getAll();
        cacheSet(collection, rows);
        return applyFilter(rows, filter);
      },
      getById: (id) => localRepo.getById(id),
      async create(data) { invalidate(collection); return localRepo.create(data); },
      async update(id, patch) { invalidate(collection); return localRepo.update(id, patch); },
      async remove(id) { invalidate(collection); return localRepo.remove(id); },
      query: (predicate) => localRepo.query(predicate),
    };
  }

  // Auto/firebase mode → proxy that chooses per-call based on connectivity,
  // and writes always go through local (offline-first + outbox) so the sync
  // engine is the single path that reaches Firestore.
  return {
    collection,
    async getAll(filter) {
      const cached = cacheGet(collection);
      if (cached) return applyFilter(cached, filter);
      if (connectivity.isOnline) {
        const r = await remote(collection);
        if (r) {
          try {
            const rows = await withTimeout(r.getAll(), config.sync.readTimeoutMs, `${collection}.getAll`);
            cacheSet(collection, rows);
            return applyFilter(rows, filter);
          } catch (err) {
            // Lost connectivity mid-request → flip offline so the next calls skip
            // the remote and serve from local immediately.
            connectivity.goOffline(`${collection}.getAll: ${err.message}`);
          }
        }
      }
      const rows = await localRepo.getAll();
      cacheSet(collection, rows);
      return applyFilter(rows, filter);
    },
    async getById(id) {
      if (connectivity.isOnline) {
        const r = await remote(collection);
        if (r) {
          try {
            return await withTimeout(r.getById(id), config.sync.readTimeoutMs, `${collection}.getById`);
          } catch (err) {
            connectivity.goOffline(`${collection}.getById: ${err.message}`);
          }
        }
      }
      return localRepo.getById(id);
    },
    // Writes are local-first (offline-safe, outbox-queued). When online we also
    // mirror the write straight to Firestore so a subsequent read — which prefers
    // Firestore — sees it immediately instead of waiting for the next sync tick.
    async create(data) {
      invalidate(collection);
      const rec = await localRepo.create(data);
      await mirror(collection, 'set', rec.id, rec);
      return rec;
    },
    async update(id, patch) {
      invalidate(collection);
      const rec = await localRepo.update(id, patch);
      if (rec) await mirror(collection, 'set', id, rec);
      return rec;
    },
    async remove(id) {
      invalidate(collection);
      const ok = await localRepo.remove(id);
      if (ok) await mirror(collection, 'delete', id);
      return ok;
    },
    query: (predicate) => localRepo.query(predicate),
  };
}

/**
 * Push a single just-written record straight to Firestore when online so reads
 * are immediately consistent. On any failure we drop offline and leave the
 * outbox entry for the sync engine to retry later.
 */
async function mirror(collection, op, id, rec) {
  if (config.persistenceMode === 'local' || !connectivity.isOnline) return;
  try {
    const db = await getFirestore();
    if (!db) return;
    const ref = db.collection(collection).doc(id);
    if (op === 'delete') {
      await withTimeout(
        ref.set({ _sync: { deleted: true, status: 'synced', updatedAt: Date.now() } }, { merge: true }),
        config.sync.readTimeoutMs, `${collection}.mirror-delete`,
      );
    } else {
      await withTimeout(
        ref.set({ ...rec, _sync: { ...rec._sync, status: 'synced' } }),
        config.sync.readTimeoutMs, `${collection}.mirror-set`,
      );
    }
    outbox.removeFor(collection, id); // already in Firestore — no need to re-push
  } catch (err) {
    connectivity.goOffline(`${collection}.mirror: ${err.message}`);
  }
}

export default repo;
