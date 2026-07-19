import fs from 'fs';
import { config, isFirebaseConfigured } from '../config/index.js';
import { getFirestore } from '../config/firebase.js';
import { localStore } from '../repositories/localStore.js';
import { outbox } from '../sync/outbox.js';
import { logger } from '../utils/logger.js';

/**
 * One-time backfill: push every record in the local JSON store up to Firestore.
 *
 * Why this exists: in `auto` mode reads come from Firestore, but the seeded /
 * offline-created data was written straight to the local store and only a subset
 * ever entered the sync outbox. Without this, a freshly-connected Firestore is
 * empty and the app appears to "lose" its data. Run once after first connecting:
 *
 *     npm run backfill
 *
 * Idempotent — documents are written by id, so re-running just overwrites.
 */

const BATCH_LIMIT = 450; // Firestore hard limit is 500 ops per batch.

function collections() {
  return fs
    .readdirSync(config.dataDir)
    .filter((f) => f.endsWith('.json') && f !== '_outbox.json')
    .map((f) => f.replace(/\.json$/, ''));
}

async function run() {
  if (!isFirebaseConfigured()) {
    logger.error('Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in backend/.env first.');
    process.exit(1);
  }

  const db = await getFirestore();
  if (!db) {
    logger.error('Could not connect to Firestore. Check your service-account credentials.');
    process.exit(1);
  }

  let grandTotal = 0;
  for (const col of collections()) {
    const rows = localStore.load(col);
    if (!rows.length) continue;

    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
      const slice = rows.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const r of slice) {
        if (!r || !r.id) continue; // every record carries its own id
        const doc = {
          ...r,
          _sync: { ...(r._sync || {}), status: 'synced' },
        };
        batch.set(db.collection(col).doc(String(r.id)), doc);
        written += 1;
      }
      await batch.commit();
    }
    grandTotal += written;
    logger.success(`Backfilled ${written} → ${col}`);
  }

  // The local data is now mirrored in Firestore, so the pending outbox entries
  // are redundant — clear them to avoid a duplicate push on the next sync tick.
  const cleared = outbox.size();
  if (cleared) {
    localStore.set('_outbox', []);
    logger.info(`Cleared ${cleared} redundant outbox entry(ies).`);
  }

  logger.success(`Backfill complete — ${grandTotal} record(s) uploaded to project "${config.firebase.projectId}".`);
  process.exit(0);
}

run().catch((err) => {
  logger.error(`Backfill failed: ${err.message}`);
  process.exit(1);
});
