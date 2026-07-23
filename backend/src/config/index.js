import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,

  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  jwtExpiresInHours: Number(process.env.JWT_EXPIRES_IN_HOURS) || 24,

  persistenceMode: process.env.PERSISTENCE_MODE || 'auto', // auto | local | supabase

  // How often the idle-session sweep runs (releases abandoned cashier slots).
  sessionSweepIntervalMs: Number(process.env.SESSION_SWEEP_INTERVAL_MS) || 60000,

  sync: {
    enabled: process.env.SYNC_ENABLED !== 'false',
    intervalMs: Number(process.env.SYNC_INTERVAL_MS) || 15000,
    conflictPolicy: process.env.CONFLICT_POLICY || 'last-write-wins',
    // Network calls to Supabase are bounded by these so a dropped connection
    // fails over to the local store quickly instead of hanging.
    probeTimeoutMs: Number(process.env.SYNC_PROBE_TIMEOUT_MS) || 3000,
    readTimeoutMs: Number(process.env.SYNC_READ_TIMEOUT_MS) || 4000,
    // After dropping offline, re-probe this often until back online.
    offlineRetryMs: Number(process.env.SYNC_OFFLINE_RETRY_MS) || 5000,
  },

  // Absolute path to the local JSON store directory. Overridable (e.g. by
  // tests, to avoid ever reading/writing the real dev data on disk).
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),

  supabase: {
    // Direct Postgres connection string, e.g.
    // postgresql://postgres:postgres@127.0.0.1:54322/postgres (self-hosted `supabase start`).
    dbUrl: process.env.DATABASE_URL || '',
    // Kept for future use (Storage/Edge Functions/Auth) — not required for the
    // direct-Postgres repository path.
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },

  // Asymmetric keypair for signing offline licenses (the client verifies with
  // the public key only — a shared/symmetric secret can never be exposed to
  // the frontend without letting anyone forge their own offline license).
  offlineLicense: {
    privateKeyPem: process.env.OFFLINE_LICENSE_PRIVATE_KEY || '',
    publicKeyPem: process.env.OFFLINE_LICENSE_PUBLIC_KEY || '',
  },
};

/**
 * Per-feature flags so the same build can be sold in tiers. Each nav page can be
 * switched off from backend/.env with FEATURE_<PAGE>=false (default: on).
 */
const FEATURE_KEYS = [
  'dashboard', 'orders', 'kitchen', 'products', 'inventory', 'goodsCheck', 'clients',
  'loyalty', 'reservations', 'clock', 'workers', 'attendance', 'scheduling',
  'finance', 'reports', 'settings', 'sync', 'complaints', 'pettyCash', 'rents', 'cashAdvances', 'pendingPayments',
];
const featureOn = (key) => {
  const v = process.env[`FEATURE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`];
  if (v === undefined) return true; // default enabled
  return !['false', '0', 'no', 'off'].includes(String(v).toLowerCase());
};
config.features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, featureOn(k)]));

/** True only when a Postgres connection string is present. */
export function isSupabaseConfigured() {
  return Boolean(config.supabase.dbUrl);
}

export default config;
