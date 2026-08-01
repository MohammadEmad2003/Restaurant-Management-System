import { config } from '../config/index.js';
import { getDb } from '../config/database.js';
import { getRecordRow, upsertRecord } from '../repositories/supabaseRecords.js';
import { SECURE_COLLECTIONS, flushSecureEntry } from '../repositories/secureStore.js';
import { connectivity } from './connectivity.js';
import { outbox } from './outbox.js';
import { logger } from '../utils/logger.js';
import { withTimeout } from '../utils/withTimeout.js';
import { isNetworkError } from '../utils/isNetworkError.js';

/**
 * Drains the outbox to Supabase when online and resolves conflicts.
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
    const db = await getDb();
    if (!db) { this.running = false; return this.stats; }

    const t = config.sync.readTimeoutMs;
    const entries = outbox.pending();
    let pushedNow = 0;
    for (const entry of entries) {
      try {
        // Auth-critical collections (restaurants/users/licenses/devices/
        // sessions) live in real typed Postgres tables, not the generic
        // JSONB `records` table — route them through secureStore's own
        // typed insert/update/delete instead of the JSONB upsert used for
        // everything else. No field-merge/version conflict resolution here:
        // these rows have a single writer per record in practice (the
        // owning restaurant's own backend), so last-write-wins by simply
        // upserting is sufficient.
        if (SECURE_COLLECTIONS.includes(entry.collection)) {
          await withTimeout(flushSecureEntry(db, entry), t, 'sync set (secure)');
          outbox.remove(entry.id);
          this.stats.pushed += 1;
          pushedNow += 1;
          continue;
        }

        const remote = await withTimeout(getRecordRow(db, entry.collection, entry.recordId), t, 'sync get');

        if (remote && (remote._sync?.version || 0) > (entry.version || 0)) {
          // Remote is newer → resolve.
          const resolved = this._resolve(entry.payload, remote);
          await withTimeout(upsertRecord(db, entry.collection, entry.recordId, resolved), t, 'sync set');
          this.stats.conflicts += 1;
        } else {
          const payload = { ...entry.payload, _sync: { ...entry.payload._sync, status: 'synced' } };
          await withTimeout(upsertRecord(db, entry.collection, entry.recordId, payload), t, 'sync set');
        }
        outbox.remove(entry.id);
        this.stats.pushed += 1;
        pushedNow += 1;
      } catch (err) {
        this.stats.errors += 1;
        logger.error(`Sync push failed for ${entry.collection}/${entry.recordId}: ${err.message}`);
        // Connection dropped mid-flush: stop, go offline, retry on reconnect.
        if (isNetworkError(err)) {
          outbox.markAttempt(entry.id, err.message);
          connectivity.goOffline('sync flush');
          break;
        }
        // A genuine data error (e.g. a constraint violation) will never
        // succeed no matter how many times it's retried — secureStore's own
        // direct-write mirror already gives up on these instead of queueing
        // them (see secureStore.js `_mirror`), but an entry that reached the
        // outbox before that write-through path could still spin here
        // forever, identically failing (and re-logging) on every tick since
        // nothing about the payload ever changes. Drop it instead of
        // marking another attempt, so it doesn't wedge the queue permanently.
        logger.error(`Dropping ${entry.collection}/${entry.recordId} from the outbox — not a connectivity error, retrying would never succeed.`);
        outbox.remove(entry.id);
      }
    }
    this.stats.lastRun = Date.now();
    this.running = false;
    if (pushedNow) logger.success(`Sync flushed ${pushedNow} change(s). Pending: ${outbox.size()}.`);
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
