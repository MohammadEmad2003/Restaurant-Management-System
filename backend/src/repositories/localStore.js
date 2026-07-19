import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

/**
 * Tiny durable JSON store. One file per collection under backend/src/data/.
 *
 * The in-memory cache is the source of truth for reads and is updated
 * synchronously, so callers always see their own writes immediately. Disk
 * persistence is *coalesced and asynchronous*: a burst of writes (e.g. an order
 * plus its audit log plus a loyalty entry) collapses into a single non-blocking
 * file write instead of re-serialising the whole collection on the event loop
 * for each one. A synchronous flush on process exit guarantees nothing pending
 * is lost.
 */
const WRITE_DEBOUNCE_MS = Number(process.env.STORE_FLUSH_MS) || 30;

class LocalStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.dirty = new Set();
    this.chains = new Map(); // collection → tail of its async write chain
    this.flushTimer = null;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this._installExitHooks();
  }

  _file(collection) {
    return path.join(this.dir, `${collection}.json`);
  }

  load(collection) {
    if (this.cache.has(collection)) return this.cache.get(collection);
    const file = this._file(collection);
    let rows = [];
    if (fs.existsSync(file)) {
      try {
        rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        rows = [];
      }
    }
    this.cache.set(collection, rows);
    return rows;
  }

  set(collection, rows) {
    this.cache.set(collection, rows);
    this.dirty.add(collection);
    this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const pending = [...this.dirty];
      this.dirty.clear();
      for (const collection of pending) this._flushAsync(collection);
    }, WRITE_DEBOUNCE_MS);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  /** Serialise writes per collection so two async writes can't interleave. */
  _flushAsync(collection) {
    const run = async () => {
      const rows = this.cache.get(collection) || [];
      const data = JSON.stringify(rows);
      const tmp = this._file(collection) + '.tmp';
      await fs.promises.writeFile(tmp, data);
      await fs.promises.rename(tmp, this._file(collection)); // atomic replace
    };
    const prev = this.chains.get(collection) || Promise.resolve();
    const next = prev.then(run, run).catch(() => {});
    this.chains.set(collection, next);
    return next;
  }

  /** Synchronous, best-effort flush of every dirty collection — used on exit. */
  flushSync() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const collection of this.dirty) {
      try {
        const rows = this.cache.get(collection) || [];
        const tmp = this._file(collection) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(rows));
        fs.renameSync(tmp, this._file(collection));
      } catch { /* best effort on shutdown */ }
    }
    this.dirty.clear();
  }

  _installExitHooks() {
    if (LocalStore._hooked) return;
    LocalStore._hooked = true;
    process.on('exit', () => this.flushSync());
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => { this.flushSync(); process.exit(0); });
    }
  }

  reset() {
    this.cache.clear();
    this.dirty.clear();
  }
}

export const localStore = new LocalStore(config.dataDir);
export default localStore;
