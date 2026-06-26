import { config, isFirebaseConfigured } from '../config/index.js';
import { getFirestore } from '../config/firebase.js';
import { logger } from '../utils/logger.js';

/**
 * Tracks whether we can reach Firestore. Drives the failover between the
 * Firestore repository (online) and the local JSON repository (offline).
 */
class Connectivity {
  constructor() {
    this.online = false;
    this.lastCheck = 0;
    this.listeners = new Set();
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
      // Lightweight reachability probe.
      await db.collection('_health').limit(1).get();
      return this._set(true);
    } catch {
      return this._set(false);
    }
  }

  _set(value) {
    const changed = value !== this.online;
    this.online = value;
    this.lastCheck = Date.now();
    if (changed) {
      logger[value ? 'success' : 'warn'](`Connectivity → ${value ? 'ONLINE' : 'OFFLINE'}`);
      this._emit();
    }
    return value;
  }

  get isOnline() {
    return this.online;
  }
}

export const connectivity = new Connectivity();
export default connectivity;
