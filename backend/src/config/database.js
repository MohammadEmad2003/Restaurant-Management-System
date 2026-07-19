import { config, isSupabaseConfigured } from './index.js';
import { logger } from '../utils/logger.js';

let _pool = null;
let _initialized = false;
let _schemaReady = null;

/**
 * Lazily initialise the Postgres pool. Returns null if not configured so the
 * rest of the system transparently falls back to the local JSON store.
 */
export async function getDb() {
  if (_initialized) return _pool;
  _initialized = true;

  if (!isSupabaseConfigured()) {
    logger.warn('Supabase not configured — running on local JSON store (offline mode).');
    return null;
  }

  try {
    // Imported lazily so the app boots even without the dependency installed.
    const { default: pg } = await import('pg');
    _pool = new pg.Pool({ connectionString: config.supabase.dbUrl });
    await ensureSchema(_pool);
    logger.success(`Supabase connected → ${redact(config.supabase.dbUrl)}`);
    return _pool;
  } catch (err) {
    logger.error(`Supabase init failed (${err.message}). Falling back to local store.`);
    _pool = null;
    return null;
  }
}

/**
 * Creates the single JSONB document table on first connect, if missing, and
 * (on a Supabase project) grants it to `service_role` so the secret/service
 * key can read it via PostgREST too — a table created through a raw
 * superuser connection doesn't inherit the grants Studio/migrations would
 * normally set up. `anon`/`authenticated` are deliberately left ungranted:
 * every collection's records — including `workers`, which carries bcrypt
 * `passwordHash` values — live in this one table, so exposing it to
 * unauthenticated/public API roles would leak password hashes and all
 * business data. The backend itself never goes through PostgREST — it talks
 * to Postgres directly with full privileges — so this grant is purely for
 * optional external tooling using the service key.
 */
function ensureSchema(pool) {
  if (!_schemaReady) {
    _schemaReady = pool.query(`
      create table if not exists records (
        collection text not null,
        id text not null,
        data jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (collection, id)
      );
      create index if not exists idx_records_collection on records (collection);

      do $$
      begin
        if exists (select 1 from pg_roles where rolname = 'service_role') then
          grant select, insert, update, delete on public.records to service_role;
        end if;
      end $$;
    `);
  }
  return _schemaReady;
}

function redact(url) {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}
