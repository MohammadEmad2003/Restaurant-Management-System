import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

/**
 * Tiny durable JSON store. One file per collection under backend/src/data/.
 * In-memory cache + write-through to disk. Synchronous fs is fine for the
 * data volumes of a single restaurant and keeps writes atomic & simple.
 */
class LocalStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

  persist(collection) {
    const rows = this.cache.get(collection) || [];
    const tmp = this._file(collection) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, this._file(collection)); // atomic replace
  }

  set(collection, rows) {
    this.cache.set(collection, rows);
    this.persist(collection);
  }

  reset() {
    this.cache.clear();
  }
}

export const localStore = new LocalStore(config.dataDir);
export default localStore;
