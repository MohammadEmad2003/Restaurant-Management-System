import fs from 'fs';
import { config, isSupabaseConfigured } from '../config/index.js';
import { getDb } from '../config/database.js';
import { localStore } from '../repositories/localStore.js';
import { outbox } from '../sync/outbox.js';
import { logger } from '../utils/logger.js';
import { upsertManyRecords } from '../repositories/supabaseRecords.js';

/**
 * One-time backfill: push every record in the local JSON store up to Supabase.
 *
 * Why this exists: in `auto` mode reads come from Supabase, but the seeded /
 * offline-created data was written straight to the local store and only a subset
 * ever entered the sync outbox. Without this, a freshly-connected Supabase is
 * empty and the app appears to "lose" its data. Run once after first connecting:
 *
 *     npm run backfill
 *
 * Idempotent — records are written by id, so re-running just overwrites.
 */

const BATCH_SIZE = 450; // Keeps each multi-row insert payload a sane size.

function collections() {
  return fs
    .readdirSync(config.dataDir)
    .filter((f) => f.endsWith('.json') && f !== '_outbox.json')
    .map((f) => f.replace(/\.json$/, ''));
}

async function run() {
  if (!isSupabaseConfigured()) {
    logger.error('Supabase is not configured. Set DATABASE_URL in backend/.env first.');
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    logger.error('Could not connect to Supabase. Check DATABASE_URL.');
    process.exit(1);
  }

  let grandTotal = 0;
  for (const col of collections()) {
    const rows = localStore.load(col).filter((r) => r && r.id);
    if (!rows.length) continue;

    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        ...r,
        _sync: { ...(r._sync || {}), status: 'synced' },
      }));
      await upsertManyRecords(db, col, slice);
      written += slice.length;
    }
    grandTotal += written;
    logger.success(`Backfilled ${written} → ${col}`);
  }

  // The local data is now mirrored in Supabase, so the pending outbox entries
  // are redundant — clear them to avoid a duplicate push on the next sync tick.
  const cleared = outbox.size();
  if (cleared) {
    localStore.set('_outbox', []);
    logger.info(`Cleared ${cleared} redundant outbox entry(ies).`);
  }

  logger.success(`Backfill complete — ${grandTotal} record(s) uploaded to Supabase.`);
  process.exit(0);
}

run().catch((err) => {
  logger.error(`Backfill failed: ${err.message}`);
  process.exit(1);
});
