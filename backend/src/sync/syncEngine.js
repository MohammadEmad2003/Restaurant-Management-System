import { config } from '../config/index.js';
import { getFirestore } from '../config/firebase.js';
import { connectivity } from './connectivity.js';
import { outbox } from './outbox.js';
import { logger } from '../utils/logger.js';

/**
 * Drains the outbox to Firestore when online and resolves conflicts.
 *
 * Conflict resolution:
 *  - last-write-wins: compare _sync.updatedAt; newer wins.
 *  - field-merge: union additive arrays (phoneNumbers, addresses) + max points.
 *  - tombstones: a delete (deleted=true) always wins over an older write.
 */
class SyncEngine {
  constructor() {
    this.running = false;
    this.timer = null;
    this.stats = { lastRun: null, pushed: 0, conflicts: 0, errors: 0 };
  }

  start() {
    if (!config.sync.enabled) {
      logger.info('Sync engine disabled (SYNC_ENABLED=false).');
      return;
    }
    const tick = async () => {
      await connectivity.check();
      if (connectivity.isOnline) await this.flush();
    };
    tick();
    this.timer = setInterval(tick, config.sync.intervalMs);
    connectivity.onChange((online) => { if (online) this.flush(); });
    logger.info(`Sync engine started (every ${config.sync.intervalMs}ms, policy=${config.sync.conflictPolicy}).`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  _resolve(local, remote) {
    if (!remote) return local;
    if (local._sync?.deleted) return local; // delete wins
    if (config.sync.conflictPolicy === 'field-merge') {
      return {
        ...remote,
        ...local,
        phoneNumbers: union(remote.phoneNumbers, local.phoneNumbers),
        addresses: union(remote.addresses, local.addresses),
        loyaltyPoints: Math.max(remote.loyaltyPoints || 0, local.loyaltyPoints || 0),
        _sync: { ...local._sync, status: 'synced' },
      };
    }
    // last-write-wins
    return (local._sync?.updatedAt || 0) >= (remote._sync?.updatedAt || 0) ? local : remote;
  }

  async flush() {
    if (this.running) return this.stats;
    this.running = true;
    const db = await getFirestore();
    if (!db) { this.running = false; return this.stats; }

    const entries = outbox.pending();
    for (const entry of entries) {
      try {
        const ref = db.collection(entry.collection).doc(entry.recordId);
        const snap = await ref.get();
        const remote = snap.exists ? snap.data() : null;

        if (remote && (remote._sync?.version || 0) > (entry.version || 0)) {
          // Remote is newer → resolve.
          const resolved = this._resolve(entry.payload, remote);
          await ref.set(resolved);
          this.stats.conflicts += 1;
        } else {
          await ref.set({ ...entry.payload, _sync: { ...entry.payload._sync, status: 'synced' } });
        }
        outbox.remove(entry.id);
        this.stats.pushed += 1;
      } catch (err) {
        outbox.markAttempt(entry.id, err.message);
        this.stats.errors += 1;
        logger.error(`Sync push failed for ${entry.collection}/${entry.recordId}: ${err.message}`);
      }
    }
    this.stats.lastRun = Date.now();
    this.running = false;
    if (entries.length) logger.success(`Sync flushed ${entries.length} change(s). Pending: ${outbox.size()}.`);
    return this.stats;
  }

  status() {
    return {
      online: connectivity.isOnline,
      pending: outbox.size(),
      policy: config.sync.conflictPolicy,
      ...this.stats,
    };
  }
}

function union(a = [], b = []) {
  const key = (x) => (typeof x === 'object' ? JSON.stringify(x) : x);
  const map = new Map();
  [...a, ...b].forEach((x) => map.set(key(x), x));
  return [...map.values()];
}

export const syncEngine = new SyncEngine();
export default syncEngine;
