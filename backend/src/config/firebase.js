import { config, isFirebaseConfigured } from './index.js';
import { logger } from '../utils/logger.js';

let _app = null;
let _db = null;
let _initialized = false;

/**
 * Lazily initialise Firebase Admin. Returns null if not configured so the
 * rest of the system transparently falls back to the local JSON store.
 */
export async function getFirestore() {
  if (_initialized) return _db;
  _initialized = true;

  if (!isFirebaseConfigured()) {
    logger.warn('Firebase not configured — running on local JSON store (offline mode).');
    return null;
  }

  try {
    // Imported lazily so the app boots even without the dependency installed.
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) {
      _app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.firebase.projectId,
          clientEmail: config.firebase.clientEmail,
          privateKey: config.firebase.privateKey,
        }),
        storageBucket: config.firebase.storageBucket || undefined,
      });
    } else {
      _app = admin.apps[0];
    }
    _db = admin.firestore();
    logger.success(`Firebase connected → project "${config.firebase.projectId}".`);
    return _db;
  } catch (err) {
    logger.error(`Firebase init failed (${err.message}). Falling back to local store.`);
    _db = null;
    return null;
  }
}

export function getFirebaseApp() {
  return _app;
}
