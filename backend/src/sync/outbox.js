import { localStore } from '../repositories/localStore.js';
import { newId } from '../utils/ids.js';
import { config, isSupabaseConfigured } from '../config/index.js';

/**
 * Append-only queue of pending changes to push to Supabase when online.
 * Stored as its own "collection" so it survives restarts.
 */
const COLLECTION = '_outbox';

/**
 * Only queue writes when a Supabase target can actually drain them. Without
 * this guard the outbox grows without bound in the default (no-Supabase) setup —
 * nothing ever flushes it, yet every write re-serialises the whole file, which
 * is the dominant source of write latency as the dataset grows.
 */
function syncTargetAvailable() {
  return config.persistenceMode !== 'local' && isSupabaseConfigured();
}

export const outbox = {
  enqueue(op, collection, id, payload, version) {
    if (!syncTargetAvailable()) return;
    const rows = localStore.load(COLLECTION);
    rows.push({
      id: newId('obx'),
      op, // create | update | remove
      collection,
      recordId: id,
      payload,
      version,
      deviceId: 'pos-01',
      enqueuedAt: Date.now(),
      attempts: 0,
    });
    localStore.set(COLLECTION, rows);
  },

  all() {
    return localStore.load(COLLECTION);
  },

  pending() {
    return localStore.load(COLLECTION);
  },

  remove(entryId) {
    const rows = localStore.load(COLLECTION).filter((e) => e.id !== entryId);
    localStore.set(COLLECTION, rows);
  },

  /** Drop any pending entries for a record we just pushed directly (write-through). */
  removeFor(collection, recordId) {
    const rows = localStore.load(COLLECTION).filter(
      (e) => !(e.collection === collection && e.recordId === recordId),
    );
    localStore.set(COLLECTION, rows);
  },

  markAttempt(entryId, error) {
    const rows = localStore.load(COLLECTION);
    const e = rows.find((x) => x.id === entryId);
    if (e) {
      e.attempts += 1;
      e.lastError = error || null;
      localStore.set(COLLECTION, rows);
    }
  },

  size() {
    return localStore.load(COLLECTION).length;
  },
};

export default outbox;
