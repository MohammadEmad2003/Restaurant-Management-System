/**
 * Repository interface. Every persistence backend (local JSON, Firestore,
 * a future SQL store) implements these methods, so services never depend on
 * a concrete database.
 */
export class BaseRepository {
  constructor(collection) {
    this.collection = collection;
  }
  /* eslint-disable no-unused-vars */
  async getAll(filter = {}) { throw new Error('not implemented'); }
  async getById(id) { throw new Error('not implemented'); }
  async create(data) { throw new Error('not implemented'); }
  async update(id, patch) { throw new Error('not implemented'); }
  async remove(id) { throw new Error('not implemented'); }
  async query(predicate) { throw new Error('not implemented'); }
}

export default BaseRepository;
