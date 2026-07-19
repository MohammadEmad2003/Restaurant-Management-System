/**
 * Shared SQL helpers for the "records" table — one JSONB blob per document,
 * keyed by (collection, id), mirroring the schemaless document-store shape
 * services already depend on via BaseRepository. Used by SupabaseRepository,
 * the sync engine, and the backfill script so the upsert semantics stay in
 * exactly one place.
 */

export async function getRecordRow(pool, collection, id) {
  const { rows } = await pool.query(
    'select data from records where collection = $1 and id = $2',
    [collection, id],
  );
  return rows[0]?.data || null;
}

export async function getAllRecordRows(pool, collection) {
  const { rows } = await pool.query('select data from records where collection = $1', [collection]);
  return rows.map((r) => r.data);
}

export async function upsertRecord(pool, collection, id, record) {
  await pool.query(
    `insert into records (collection, id, data, updated_at)
     values ($1, $2, $3, now())
     on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
    [collection, id, record],
  );
}

/** Batched upsert for the one-off backfill script — avoids one round trip per row. */
export async function upsertManyRecords(pool, collection, records) {
  if (!records.length) return;
  // A single INSERT can't touch the same conflict target twice, so de-dupe by
  // id first (keep the last occurrence — same "last write wins" rule used
  // elsewhere) in case the source data has duplicate ids.
  const byId = new Map(records.map((r) => [String(r.id), r]));
  const deduped = [...byId.values()];
  const ids = deduped.map((r) => String(r.id));
  const datas = deduped.map((r) => JSON.stringify(r));
  await pool.query(
    `insert into records (collection, id, data, updated_at)
     select $1, unnest($2::text[]), unnest($3::jsonb[]), now()
     on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
    [collection, ids, datas],
  );
}
