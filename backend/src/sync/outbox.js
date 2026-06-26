import { localStore } from '../repositories/localStore.js';
import { newId } from '../utils/ids.js';

/**
 * Append-only queue of pending changes to push to Firestore when online.
 * Stored as its own "collection" so it survives restarts.
 */
const COLLECTION = '_outbox';

export const outbox = {
  enqueue(op, collection, id, payload, version) {
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
