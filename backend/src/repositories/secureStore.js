import { randomUUID } from 'node:crypto';
import { getDb } from '../config/database.js';
import { localStore } from './localStore.js';
import { config, isSupabaseConfigured } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { HttpError } from '../middleware/errorHandler.js';
import { connectivity } from '../sync/connectivity.js';
import { outbox } from '../sync/outbox.js';
import { isNetworkError } from '../utils/isNetworkError.js';

/**
 * Auth-critical collections — real typed Postgres tables (not the generic
 * JSONB `records` table `repo()` uses for business data). Exported so the
 * sync engine can recognise which outbox entries belong here and route them
 * through the typed pgInsert/pgUpdate/pgRemove helpers below instead of the
 * generic JSONB upsert.
 */
export const SECURE_COLLECTIONS = ['restaurants', 'users', 'super_admins', 'licenses', 'devices', 'login_sessions', 'activation_tokens', 'hardware_bindings'];

let _mode = null; // only ever used for the startup log line now — no longer freezes routing

/**
 * Historically this store picked local-vs-Postgres ONCE at boot and never
 * revisited it — a restaurant registered/activated while Postgres happened
 * to be unreachable at that exact instant would live in local JSON forever,
 * with no path to Supabase, even though every other collection in this app
 * is properly offline-first. That meant a genuinely-registered user could
 * pass "connected to the internet" and still get "Invalid username or
 * password", because the login backing this specific run never had any way
 * to learn that user existed.
 *
 * Now: reads dynamically prefer Postgres when reachable (falling back to
 * local on any failure, exactly like `repo()`), writes are local-first
 * (never lost) with an immediate best-effort Postgres mirror, and anything
 * that couldn't be mirrored right away is queued in the same outbox the rest
 * of the app already uses, so the sync engine picks it up the moment
 * connectivity returns. `reconcileToLocal()`/`reconcileToPostgres()` below
 * additionally backfill in both directions once at startup, so data created
 * under the old frozen-mode behavior (or purely offline) still ends up
 * wherever it's missing the next time Postgres is reachable.
 */
export async function initSecureStore() {
  if (_mode) return _mode;
  const pool = await getDb();
  if (pool) {
    _mode = 'postgres';
    logger.success('Secure store: Postgres');
  } else {
    _mode = 'local';
    logger.info('Secure store: local JSON');
  }
  // Get an accurate connectivity reading immediately, rather than defaulting
  // to "offline" until the sync engine's first tick happens to fire.
  await connectivity.check();
  if (connectivity.isOnline) await reconcileToPostgres();
  return _mode;
}

/** Push up any local-only row (in any secure collection) that Postgres
 * doesn't have yet — a one-time backfill so restaurants/users/licenses/
 * devices/sessions created while offline (or under the old frozen-mode
 * behavior) reach Supabase the moment it's actually reachable. Safe to
 * re-run: only ever inserts rows that don't already exist remotely. */
async function reconcileToPostgres() {
  const db = await getDb();
  if (!db) return;
  for (const table of SECURE_COLLECTIONS) {
    try {
      const localRows = localStore.load(table);
      if (!localRows.length) continue;
      const { rows: remoteRows } = await db.query(`select id from ${table}`);
      const remoteIds = new Set(remoteRows.map((r) => r.id));
      const missing = localRows.filter((r) => !remoteIds.has(r.id));
      for (const row of missing) {
        try {
          await pgInsert(db, table, row);
        } catch (err) {
          // A unique-constraint clash means a differently-idd row already
          // represents this same real-world record (e.g. a username that
          // exists in both) — nothing safe to auto-resolve, so it's left for
          // manual reconciliation rather than silently dropping either side.
          if (err.code !== '23505') logger.error(`Secure store reconcile failed for ${table}/${row.id}: ${err.message}`);
        }
      }
      if (missing.length) logger.success(`Secure store: pushed ${missing.length} local-only ${table} row(s) to Postgres`);
    } catch (err) {
      logger.error(`Secure store reconcile failed for ${table}: ${err.message}`);
    }
  }
}

function syncTargetAvailable() {
  return config.persistenceMode !== 'local' && isSupabaseConfigured();
}

export function secureStore() {
  return {
    mode: () => _mode,

    async findOne(table, filter) {
      const rows = await this.findAll(table, filter);
      return rows[0] || null;
    },

    async findAll(table, filter = {}) {
      if (connectivity.isOnline) {
        const db = await getDb();
        if (db) {
          try {
            return await pgFindAll(db, table, filter);
          } catch (err) {
            connectivity.goOffline(`secureStore.${table}.findAll: ${err.message}`);
          }
        }
      }
      return localFindAll(table, filter);
    },

    /** Writes are always local-first (never lost, even fully offline), then
     * mirrored to Postgres immediately when reachable. If that mirror fails
     * (or we're offline), the write is queued in the outbox so the sync
     * engine flushes it the moment connectivity returns — the same
     * offline-first guarantee every other collection in this app already has. */
    async create(table, data) {
      const now = new Date().toISOString();
      const record = { id: data.id || randomUUID(), ...data, createdAt: now, updatedAt: now };
      // `localCreate` pushes `record` itself into its own cached rows array
      // (by reference) — returning that same `record` variable here (the
      // previous behavior) handed the caller a live handle into this
      // store's internal state, so mutating it after the fact silently
      // corrupted what's cached/persisted. Return the defensive copy
      // localCreate hands back instead — see its own comment.
      const stored = localCreate(table, record);
      await this._mirror(table, 'create', record.id, record);
      return stored;
    },

    async update(table, id, patch) {
      const record = { ...patch, updatedAt: new Date().toISOString() };
      let updated = localUpdate(table, id, record);
      if (!updated && connectivity.isOnline) {
        // This row exists remotely but was never mirrored into THIS
        // process's local cache (e.g. a background sweep touching a row
        // another device/process created) — reads already prefer Postgres
        // when online, so `findAll` would have found it; the LOCAL update
        // just has nothing to merge against. Pull the current remote row
        // down, merge the patch on top, and adopt it locally so the mirror
        // below writes a complete row instead of a bare `{id, ...patch}`
        // that's missing every required column the remote table has.
        const db = await getDb();
        if (db) {
          try {
            const [remote] = await pgFindAll(db, table, { id });
            if (remote) {
              updated = localCreate(table, { ...remote, ...record, id });
            }
          } catch (err) {
            connectivity.goOffline(`secureStore.${table}.update-fetch-remote: ${err.message}`);
          }
        }
      }
      await this._mirror(table, 'update', id, updated || { id, ...record });
      return updated;
    },

    async remove(table, id) {
      localRemove(table, id);
      await this._mirror(table, 'remove', id, null);
      return true;
    },

    async _mirror(table, op, id, payload) {
      if (!syncTargetAvailable()) return;
      if (connectivity.isOnline) {
        const db = await getDb();
        if (db) {
          try {
            if (op === 'remove') await pgRemove(db, table, id);
            else if (op === 'create') await pgUpsert(db, table, payload);
            else await pgUpsert(db, table, { id, ...payload });
            outbox.removeFor(table, id);
            return;
          } catch (err) {
            if (isNetworkError(err)) {
              connectivity.goOffline(`secureStore.${table}.mirror: ${err.message}`);
            } else {
              // A genuine data error (e.g. a constraint violation) is not a
              // connectivity problem — going offline and/or queueing this
              // exact payload for endless retry would just spin forever on
              // something that will never succeed. The local write already
              // succeeded (writes are always local-first), so surface this
              // loudly and stop, rather than silently losing it OR retrying
              // it forever in the outbox.
              logger.error(`Secure store mirror failed for ${table}/${id} (not retried — not a connectivity error): ${err.message}`);
              return;
            }
          }
        }
      }
      outbox.enqueue(op === 'remove' ? 'remove' : 'set', table, id, payload, 0);
    },

    async raw(sql, params) {
      const db = await getDb();
      if (!db) throw new Error('Raw SQL only available when Postgres is reachable');
      const result = await db.query(sql, params);
      return result.rows;
    },
  };
}

/** Flush one outbox entry belonging to a secure (typed-table) collection —
 * called by the sync engine, which routes entries here by collection name
 * instead of the generic JSONB upsert used for `repo()`-managed data. */
export async function flushSecureEntry(db, entry) {
  if (entry.op === 'remove') {
    await pgRemove(db, entry.collection, entry.recordId);
  } else {
    await pgUpsert(db, entry.collection, { id: entry.recordId, ...entry.payload });
  }
}

// ─── Postgres helpers ───────────────────────────────────────────────

async function pgFindAll(db, table, filter) {
  const keys = Object.keys(filter);
  if (!keys.length) {
    const { rows } = await db.query(`select * from ${table}`);
    return rows.map(rowToObject);
  }
  const where = keys.map((k, i) => `${snake(k)} = $${i + 1}`).join(' and ');
  const values = keys.map((k) => filter[k]);
  const { rows } = await db.query(`select * from ${table} where ${where}`, values);
  return rows.map(rowToObject);
}

async function pgInsert(db, table, record) {
  const row = objectToRow(record);
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `insert into ${table} (${cols.join(', ')}) values (${placeholders}) returning *`;
  const { rows } = await db.query(sql, cols.map((c) => row[c]));
  return rows[0];
}

/** Insert-or-update by id — used for the write-through mirror/outbox-flush
 * path, since either a create or an update may be the first thing Postgres
 * ever sees for this row (e.g. reconciling after being offline for a while).
 *
 * A record queued while only a *partial* patch was known locally (e.g. just
 * `{status, logoutTime}` from a session-status change) must never be sent
 * through `insert ... on conflict do update`: Postgres builds the full
 * candidate row for the insert attempt before it even checks for a
 * conflict, so any NOT NULL column missing from that partial payload (e.g.
 * login_sessions.jwt_id) fails the insert outright — even though the
 * existing row already satisfies that constraint and only an UPDATE was
 * ever going to run. Try a plain UPDATE first (which only ever touches the
 * columns provided, so it can't trip a NOT NULL check on omitted ones);
 * only fall back to a full INSERT if no row existed yet to update. */
async function pgUpsert(db, table, record) {
  const row = objectToRow(record);
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  if (!cols.includes('id')) throw new Error(`pgUpsert requires an id (${table})`);
  const nonIdCols = cols.filter((c) => c !== 'id');
  if (nonIdCols.length) {
    const setClause = nonIdCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const updateSql = `update ${table} set ${setClause} where id = $1 returning *`;
    const { rows } = await db.query(updateSql, [row.id, ...nonIdCols.map((c) => row[c])]);
    if (rows[0]) return rows[0];
  }
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `insert into ${table} (${cols.join(', ')}) values (${placeholders}) on conflict (id) do nothing returning *`;
  const { rows } = await db.query(insertSql, cols.map((c) => row[c]));
  return rows[0];
}

async function pgRemove(db, table, id) {
  await db.query(`delete from ${table} where id = $1`, [id]);
  return true;
}

// ─── Local JSON helpers ─────────────────────────────────────────────

// `.filter()` alone copies the ARRAY but not its elements — the returned
// rows would still be the exact same object references cached internally.
// Mapped through a shallow copy for the same reason localCreate/localUpdate
// return copies below: nothing a caller does to a row it read should be
// able to reach back into this store's actual state.
function localFindAll(table, filter) {
  return localStore.load(table).filter((r) => matches(r, filter)).map((r) => ({ ...r }));
}

// Both return a defensive COPY, never the live object stored in `rows` —
// returning the live reference (the previous behavior) let a caller's
// in-place mutation of the "returned device"/"returned record" silently
// corrupt this store's actual cached (and about-to-be-persisted/mirrored)
// state, which is exactly how a stray `device.plainDeviceSecret = ...`
// assignment in authService.js once permanently broke every future
// Postgres write for that device row (see the TRANSIENT_FIELDS comment
// below for the full story). A copy makes that entire class of bug
// impossible: nothing the caller does to what it gets back can ever
// reach back into this store.
function localCreate(table, record) {
  const rows = localStore.load(table);
  rows.push(record);
  localStore.set(table, rows);
  return { ...record };
}

function localUpdate(table, id, patch) {
  const rows = localStore.load(table);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, id };
  localStore.set(table, rows);
  return { ...rows[idx] };
}

function localRemove(table, id) {
  const rows = localStore.load(table).filter((r) => r.id !== id);
  localStore.set(table, rows);
  return true;
}

function matches(row, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v === undefined || v === null) return true;
    return row[k] === v;
  });
}

// ─── Row mapping ────────────────────────────────────────────────────

const FIELD_MAP = {
  restaurantId: 'restaurant_id',
  userId: 'user_id',
  passwordHash: 'password_hash',
  activationTokenEncrypted: 'activation_token_encrypted',
  expirationDate: 'expiration_date',
  offlineDays: 'offline_days',
  maximumDevices: 'maximum_devices',
  activeDevices: 'active_devices',
  validationIntervalHours: 'validation_interval_hours',
  deviceId: 'device_id',
  deviceName: 'device_name',
  operatingSystem: 'operating_system',
  activationDate: 'activation_date',
  lastOnline: 'last_online',
  lastOnlineValidationAt: 'last_online_validation_at',
  jwtId: 'jwt_id',
  userType: 'user_type',
  loginTime: 'login_time',
  logoutTime: 'logout_time',
  ipAddress: 'ip_address',
  restaurantName: 'restaurant_name',
  legacyWorkerId: 'legacy_worker_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const REVERSE_MAP = Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]));

function snake(camel) {
  return FIELD_MAP[camel] || camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// Fields that are only ever meant to exist transiently on an in-memory
// object (e.g. authService returns `device.plainDeviceSecret` to hand the
// plaintext secret to the client exactly once — it is never itself a
// column) — must never reach a Postgres write. Regression: this was
// previously enforced only by callers being careful never to mutate a
// row object returned from this store, which failed once (a direct
// `device.plainDeviceSecret = ...` assignment permanently polluted that
// row's in-memory cache), silently breaking every subsequent Postgres
// write for that row (an unknown column error, swallowed as a
// non-retryable "data error") while local state and the client both
// believed the write had succeeded — this single choke point (every
// Postgres write for every secure collection passes through
// objectToRow) is what actually guarantees it can't happen again,
// regardless of how a transient field ends up on the object.
const TRANSIENT_FIELDS = new Set(['plainDeviceSecret']);

function objectToRow(obj) {
  const row = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || TRANSIENT_FIELDS.has(key)) continue;
    const col = FIELD_MAP[key] || key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    row[col] = value === null ? null : value;
  }
  return row;
}

function rowToObject(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, value] of Object.entries(row)) {
    const prop = REVERSE_MAP[key] || key.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    obj[prop] = value === null ? null : value;
  }
  return obj;
}

export default { initSecureStore, secureStore, SECURE_COLLECTIONS, flushSecureEntry };
