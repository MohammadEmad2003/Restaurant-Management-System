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

/** True only when enough Firebase Admin credentials are present to connect. */
export function isFirebaseConfigured() {
  const f = config.firebase;
  return Boolean(f.projectId && f.clientEmail && f.privateKey);
}

export default config;
