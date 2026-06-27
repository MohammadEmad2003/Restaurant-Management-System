import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,

  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  persistenceMode: process.env.PERSISTENCE_MODE || 'auto', // auto | local | firebase
  sync: {
    enabled: process.env.SYNC_ENABLED !== 'false',
    intervalMs: Number(process.env.SYNC_INTERVAL_MS) || 15000,
    conflictPolicy: process.env.CONFLICT_POLICY || 'last-write-wins',
    // Network calls to Firestore are bounded by these so a lost wifi connection
    // fails over to the local store quickly instead of hanging on gRPC.
    probeTimeoutMs: Number(process.env.SYNC_PROBE_TIMEOUT_MS) || 3000,
    readTimeoutMs: Number(process.env.SYNC_READ_TIMEOUT_MS) || 4000,
    // After dropping offline, re-probe this often until back online.
    offlineRetryMs: Number(process.env.SYNC_OFFLINE_RETRY_MS) || 5000,
  },

  // Absolute path to the local JSON store directory.
  dataDir: path.resolve(__dirname, '..', 'data'),

  firebase: {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    // Support both escaped (\n) and real newlines from .env
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
};

/**
 * Per-feature flags so the same build can be sold in tiers. Each nav page can be
 * switched off from backend/.env with FEATURE_<PAGE>=false (default: on).
 */
const FEATURE_KEYS = [
  'dashboard', 'orders', 'kitchen', 'products', 'inventory', 'goodsCheck', 'clients',
  'loyalty', 'reservations', 'clock', 'workers', 'attendance', 'scheduling',
  'finance', 'reports', 'audit', 'settings', 'sync',
];
const featureOn = (key) => {
  const v = process.env[`FEATURE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`];
  if (v === undefined) return true; // default enabled
  return !['false', '0', 'no', 'off'].includes(String(v).toLowerCase());
};
config.features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, featureOn(k)]));

/** True only when enough Firebase Admin credentials are present to connect. */
export function isFirebaseConfigured() {
  const f = config.firebase;
  return Boolean(f.projectId && f.clientEmail && f.privateKey);
}

export default config;
