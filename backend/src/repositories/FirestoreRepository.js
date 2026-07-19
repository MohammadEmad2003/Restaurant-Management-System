import { BaseRepository } from './BaseRepository.js';
import { newId } from '../utils/ids.js';

/**
 * Online repository backed by Firestore. Used when Firebase is configured and
 * reachable. Mirrors LocalJsonRepository's contract exactly so services are
 * agnostic to which one is active.
 */
export class FirestoreRepository extends BaseRepository {
  constructor(collection, db, { idPrefix } = {}) {
    super(collection);
    this.db = db;
    this.idPrefix = idPrefix || collection.slice(0, 3);
  }

  _col() {
    return this.db.collection(this.collection);
  }

  async getAll(filter = {}) {
    let ref = this._col();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') ref = ref.where(k, '==', v);
    }
    const snap = await ref.get();
    return snap.docs.map((d) => d.data()).filter((r) => !(r._sync && r._sync.deleted));
  }

  async getById(id) {
    const doc = await this._col().doc(id).get();
    if (!doc.exists) return null;
    const r = doc.data();
    return r._sync && r._sync.deleted ? null : r;
  }

  async create(data) {
    const id = data.id || newId(this.idPrefix);
    const record = {
      ...data,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      _sync: { status: 'synced', version: 1, updatedAt: Date.now(), deviceId: 'server', deleted: false },
    };
    await this._col().doc(id).set(record);
    return record;
  }

  async update(id, patch) {
    const ref = this._col().doc(id);
    const cur = await ref.get();
    if (!cur.exists) return null;
    const prev = cur.data();
    const merged = {
      ...prev,
      ...patch,
      id,
      updatedAt: Date.now(),
      _sync: {
        status: 'synced',
        version: (prev._sync?.version || 0) + 1,
        updatedAt: Date.now(),
        deviceId: 'server',
        deleted: prev._sync?.deleted || false,
      },
    };
    await ref.set(merged);
    return merged;
  }

  async remove(id) {
    const ref = this._col().doc(id);
    const cur = await ref.get();
    if (!cur.exists) return false;
    const prev = cur.data();
    await ref.set({
      ...prev,
      _sync: { ...(prev._sync || {}), deleted: true, status: 'synced', updatedAt: Date.now() },
    });
    return true;
  }

  async query(predicate) {
    const all = await this.getAll();
    return all.filter(predicate);
  }
}

export default FirestoreRepository;
