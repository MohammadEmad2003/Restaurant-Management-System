import { config, isFirebaseConfigured } from '../config/index.js';
import { getFirestore } from '../config/firebase.js';
import { logger } from '../utils/logger.js';
import { withTimeout } from '../utils/withTimeout.js';

/**
 * Tracks whether we can reach Firestore. Drives the failover between the
 * Firestore repository (online) and the local JSON repository (offline).
 *
 * Reachability is probed with a hard timeout so a dropped wifi connection is
 * detected in seconds (not on the ~60s gRPC deadline). While offline we re-probe
 * on a short interval so the system reconnects automatically when wifi returns.
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
    if (config.persistenceMode === 'local' || !isFirebaseConfigured()) {
      return this._set(false);
    }
    try {
      const db = await getFirestore();
      if (!db) return this._set(false);
      // Lightweight reachability probe, bounded so no-wifi fails fast.
      await withTimeout(
        db.collection('_health').limit(1).get(),
        config.sync.probeTimeoutMs,
        'connectivity probe',
      );
      return this._set(true);
    } catch {
      return this._set(false);
    }
  }

  /**
   * Force offline immediately (e.g. a live request to Firestore just timed out).
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
    if (config.persistenceMode === 'local' || !isFirebaseConfigured()) return;
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
