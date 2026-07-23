import { randomUUID } from 'node:crypto';
import { getDb } from '../config/database.js';
import { localStore } from './localStore.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { HttpError } from '../middleware/errorHandler.js';

const COLLECTIONS = ['restaurants', 'users', 'super_admins', 'licenses', 'devices', 'login_sessions'];

let _db = null;
let _mode = null;

export async function initSecureStore() {
  if (_mode) return _mode;
  const pool = await getDb();
  if (pool) {
    _db = pool;
    _mode = 'postgres';
    logger.success('Secure store: Postgres');
    return _mode;
  }
  _mode = 'local';
  logger.info('Secure store: local JSON');
  return _mode;
}

export function secureStore() {
  return {
    mode: () => _mode,

    async findOne(table, filter) {
      const rows = await this.findAll(table, filter);
      return rows[0] || null;
    },

    async findAll(table, filter = {}) {
      if (_mode === 'postgres') return pgFindAll(table, filter);
      return localFindAll(table, filter);
    },

    async create(table, data) {
      const now = new Date().toISOString();
      const record = { id: data.id || randomUUID(), ...data, createdAt: now, updatedAt: now };
      if (_mode === 'postgres') {
        let row;
        try {
          row = await pgInsert(table, record);
        } catch (err) {
          // 23505 = unique_violation — surface as a clean 409 instead of a raw 500,
          // covering both the pre-existing username-uniqueness constraint and the
          // new case-insensitive restaurant-name index (races the app-level check
          // in superAdminService.createRestaurant can't fully close on its own).
          if (err.code === '23505') throw new HttpError(409, 'A record with this value already exists');
          throw err;
        }
        return rowToObject(row);
      }
      return localCreate(table, record);
    },

    async update(table, id, patch) {
      const record = { ...patch, updatedAt: new Date().toISOString() };
      if (_mode === 'postgres') {
        const row = await pgUpdate(table, id, record);
        return rowToObject(row);
      }
      return localUpdate(table, id, record);
    },

    async remove(table, id) {
      if (_mode === 'postgres') return pgRemove(table, id);
      return localRemove(table, id);
    },

    async query(table, predicate) {
      const rows = await this.findAll(table);
      return rows.filter(predicate);
    },

    async raw(sql, params) {
      if (_mode !== 'postgres') throw new Error('Raw SQL only available in Postgres mode');
      const result = await _db.query(sql, params);
      return result.rows;
    },
  };
}

// ─── Postgres helpers ───────────────────────────────────────────────

async function pgFindAll(table, filter) {
  const keys = Object.keys(filter);
  if (!keys.length) {
    const { rows } = await _db.query(`select * from ${table}`);
    return rows.map(rowToObject);
  }
  const where = keys.map((k, i) => `${snake(k)} = $${i + 1}`).join(' and ');
  const values = keys.map((k) => filter[k]);
  const { rows } = await _db.query(`select * from ${table} where ${where}`, values);
  return rows.map(rowToObject);
}

async function pgInsert(table, record) {
  const row = objectToRow(record);
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `insert into ${table} (${cols.join(', ')}) values (${placeholders}) returning *`;
  const { rows } = await _db.query(sql, cols.map((c) => row[c]));
  return rows[0];
}

async function pgUpdate(table, id, patch) {
  const row = objectToRow(patch);
  const cols = Object.keys(row).filter((k) => row[k] !== undefined && k !== 'id');
  if (!cols.length) return pgFindAll(table, { id }).then((r) => r[0]);
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const sql = `update ${table} set ${set} where id = $1 returning *`;
  const { rows } = await _db.query(sql, [id, ...cols.map((c) => row[c])]);
  return rows[0];
}

async function pgRemove(table, id) {
  await _db.query(`delete from ${table} where id = $1`, [id]);
  return true;
}

// ─── Local JSON helpers ─────────────────────────────────────────────

function localFindAll(table, filter) {
  return localStore.load(table).filter((r) => matches(r, filter));
}

function localCreate(table, record) {
  const rows = localStore.load(table);
  rows.push(record);
  localStore.set(table, rows);
  return record;
}

function localUpdate(table, id, patch) {
  const rows = localStore.load(table);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, id };
  localStore.set(table, rows);
  return rows[idx];
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

function objectToRow(obj) {
  const row = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
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

export default { initSecureStore, secureStore };
