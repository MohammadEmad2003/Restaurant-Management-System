import { BaseRepository } from './BaseRepository.js';
import { newId } from '../utils/ids.js';
import { getRecordRow, getAllRecordRows, upsertRecord } from './supabaseRecords.js';

/**
 * Online repository backed by self-hosted Supabase Postgres. Used when
 * Supabase is configured and reachable. Mirrors LocalJsonRepository's
 * contract exactly so services are agnostic to which one is active.
 */
export class SupabaseRepository extends BaseRepository {
  constructor(collection, pool, { idPrefix } = {}) {
    super(collection);
    this.pool = pool;
    this.idPrefix = idPrefix || collection.slice(0, 3);
  }

  async getAll(filter = {}) {
    const rows = await getAllRecordRows(this.pool, this.collection);
    const live = rows.filter((r) => !(r._sync && r._sync.deleted));
    if (!filter || !Object.keys(filter).length) return live;
    return live.filter((r) => Object.entries(filter).every(
      ([k, v]) => v === undefined || v === null || v === '' || r[k] === v,
    ));
  }

  async getById(id) {
    const r = await getRecordRow(this.pool, this.collection, id);
    if (!r) return null;
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
    await upsertRecord(this.pool, this.collection, id, record);
    return record;
  }

  async update(id, patch) {
    const prev = await getRecordRow(this.pool, this.collection, id);
    if (!prev) return null;
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
    await upsertRecord(this.pool, this.collection, id, merged);
    return merged;
  }

  async remove(id) {
    const prev = await getRecordRow(this.pool, this.collection, id);
    if (!prev) return false;
    const tomb = {
      ...prev,
      _sync: { ...(prev._sync || {}), deleted: true, status: 'synced', updatedAt: Date.now() },
    };
    await upsertRecord(this.pool, this.collection, id, tomb);
    return true;
  }

  async query(predicate) {
    const all = await this.getAll();
    return all.filter(predicate);
  }
}

export default SupabaseRepository;
