import { BaseRepository } from './BaseRepository.js';
import { localStore } from './localStore.js';
import { outbox } from '../sync/outbox.js';
import { newId } from '../utils/ids.js';

/** Build/refresh the _sync envelope on a record. */
function withSync(record, { create = false } = {}) {
  const prev = record._sync || {};
  return {
    ...record,
    _sync: {
      status: 'pending',
      version: (prev.version || 0) + 1,
      updatedAt: Date.now(),
      deviceId: 'pos-01',
      deleted: prev.deleted || false,
    },
    createdAt: create ? Date.now() : record.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function matches(row, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v === undefined || v === null || v === '') return true;
    return row[k] === v;
  });
}

/**
 * Offline-first repository. Writes go to the local JSON store immediately and
 * are queued in the outbox for later push to Firestore. Soft-deletes use
 * tombstones so a delete is never lost or resurrected during sync.
 */
export class LocalJsonRepository extends BaseRepository {
  constructor(collection, { idPrefix } = {}) {
    super(collection);
    this.idPrefix = idPrefix || collection.slice(0, 3);
  }

  _rows() {
    return localStore.load(this.collection);
  }

  async getAll(filter = {}) {
    return this._rows().filter(
      (r) => !(r._sync && r._sync.deleted) && matches(r, filter),
    );
  }

  async getById(id) {
    const r = this._rows().find((x) => x.id === id);
    return r && !(r._sync && r._sync.deleted) ? r : null;
  }

  async create(data) {
    const rows = this._rows();
    const record = withSync({ id: data.id || newId(this.idPrefix), ...data }, { create: true });
    rows.push(record);
    localStore.set(this.collection, rows);
    outbox.enqueue('create', this.collection, record.id, record, record._sync.version);
    return record;
  }

  async update(id, patch) {
    const rows = this._rows();
    const idx = rows.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const merged = withSync({ ...rows[idx], ...patch, id });
    rows[idx] = merged;
    localStore.set(this.collection, rows);
    outbox.enqueue('update', this.collection, id, merged, merged._sync.version);
    return merged;
  }

  async remove(id) {
    const rows = this._rows();
    const idx = rows.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    // Soft delete (tombstone) so sync can propagate the removal safely.
    const tomb = withSync({ ...rows[idx], id });
    tomb._sync.deleted = true;
    rows[idx] = tomb;
    localStore.set(this.collection, rows);
    outbox.enqueue('remove', this.collection, id, tomb, tomb._sync.version);
    return true;
  }

  async query(predicate) {
    return this._rows().filter((r) => !(r._sync && r._sync.deleted) && predicate(r));
  }
}

export default LocalJsonRepository;
