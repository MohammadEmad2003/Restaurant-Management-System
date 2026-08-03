import { config, isSupabaseConfigured } from '../config/index.js';
import { getDb } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { withTimeout } from '../utils/withTimeout.js';
import { noteTrustedRemoteTime } from '../utils/trustedTime.js';

/**
 * Tracks whether we can reach Supabase. Drives the failover between the
 * Supabase repository (online) and the local JSON repository (offline).
 *
 * Reachability is probed with a hard timeout so a dropped connection is
 * detected in seconds instead of hanging. While offline we re-probe on a
 * short interval so the system reconnects automatically when it returns.
 */
class Connectivity {
  constructor() {
    this.online = false;
    this.lastCheck = 0;
    this.listeners = new Set();
    this._retryTimer = null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this.online);
  }

  async check() {
    if (config.persistenceMode === 'local' || !isSupabaseConfigured()) {
      return this._set(false);
    }
    try {
      const db = await getDb();
      if (!db) return this._set(false);
      // Also pulls Postgres's own clock — a timestamp the user does not
      // control, unlike this machine's own OS clock — so a genuinely online
      // moment can authoritatively advance the trusted-time high-water mark
      // (see utils/trustedTime.js) past a clock that was rolled back while
      // offline. Reachability is still bounded so a dropped connection fails
      // fast either way.
      const { rows } = await withTimeout(
        db.query('select extract(epoch from now()) * 1000 as ms'),
        config.sync.probeTimeoutMs,
        'connectivity probe',
      );
      const remoteMs = Number(rows?.[0]?.ms);
      if (Number.isFinite(remoteMs)) noteTrustedRemoteTime(remoteMs);
      return this._set(true);
    } catch {
      return this._set(false);
    }
  }

  /**
   * Force offline immediately (e.g. a live request to Supabase just timed out).
   * Avoids every subsequent request paying the timeout before failing over.
   */
  goOffline(reason) {
    if (this.online && reason) logger.warn(`Connectivity lost (${reason}).`);
    return this._set(false);
  }

  _set(value) {
    const changed = value !== this.online;
    this.online = value;
    this.lastCheck = Date.now();
    if (changed) {
      logger[value ? 'success' : 'warn'](`Connectivity → ${value ? 'ONLINE' : 'OFFLINE'}`);
      this._emit();
    }
    // While offline, keep probing on a short cadence so we reconnect promptly.
    if (!value) this._scheduleRetry();
    else this._clearRetry();
    return value;
  }

  _scheduleRetry() {
    if (this._retryTimer || !config.sync.enabled) return;
    if (config.persistenceMode === 'local' || !isSupabaseConfigured()) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.check();
    }, config.sync.offlineRetryMs);
    if (this._retryTimer.unref) this._retryTimer.unref();
  }

  _clearRetry() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  get isOnline() {
    return this.online;
  }
}

export const connectivity = new Connectivity();
export default connectivity;
