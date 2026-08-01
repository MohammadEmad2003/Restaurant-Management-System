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
    // Without an explicit timeout, `pg` waits indefinitely for the Postgres
    // handshake to complete — if the host is unreachable/firewalled at the
    // protocol level (TCP can connect while Postgres itself never responds),
    // the server hangs forever with no log output instead of reaching the
    // fallback below. Fail fast so "falls back to local store" is actually true.
    _pool = new pg.Pool({ connectionString: config.supabase.dbUrl, connectionTimeoutMillis: 5000 });
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

      create table if not exists restaurants (
        id uuid primary key default gen_random_uuid(),
        restaurant_name text not null,
        status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      -- Case-insensitive/trimmed uniqueness; partial so a soft-deleted
      -- restaurant's name can be reused by a new one. Wrapped so that an
      -- installation with pre-existing duplicate names (from before this
      -- constraint existed) doesn't fail the whole schema bootstrap and get
      -- silently kicked to the local-JSON fallback — the app-level check in
      -- superAdminService.createRestaurant still guards new creates either
      -- way; this index only closes the race-condition window once any
      -- existing duplicates are cleaned up and the server restarts.
      do $$
      begin
        create unique index if not exists uq_restaurants_name_ci
          on restaurants (lower(trim(restaurant_name)))
          where status <> 'deleted';
      exception when others then
        raise notice 'Skipping uq_restaurants_name_ci (existing duplicate restaurant names?): %', sqlerrm;
      end $$;

      create table if not exists users (
        id uuid primary key default gen_random_uuid(),
        restaurant_id uuid not null references restaurants(id) on delete cascade,
        username text not null,
        password_hash text not null,
        role text not null check (role in ('ADMIN', 'CASHIER')),
        status text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
        legacy_worker_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      -- Historically multiple users could share the same (restaurant_id,
      -- username) pair, disambiguated at login by device binding — that
      -- constraint is dropped for any install created before this. Username
      -- is now required to be unique ACROSS every restaurant (the app-level
      -- check in superAdminService is the real guard; this index only closes
      -- the race-condition window once any existing duplicates are cleaned
      -- up, wrapped so pre-existing duplicates don't fail schema bootstrap).
      alter table users drop constraint if exists users_restaurant_id_username_key;

      do $$
      begin
        create unique index if not exists uq_users_username_ci
          on users (lower(trim(username)));
      exception when others then
        raise notice 'Skipping uq_users_username_ci (existing duplicate usernames?): %', sqlerrm;
      end $$;

      create table if not exists super_admins (
        id uuid primary key default gen_random_uuid(),
        username text not null unique,
        password_hash text not null,
        status text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists licenses (
        id uuid primary key default gen_random_uuid(),
        restaurant_id uuid not null unique references restaurants(id) on delete cascade,
        activation_token_encrypted text not null,
        expiration_date timestamptz not null,
        offline_days integer not null default 7,
        maximum_devices integer not null default 1,
        active_devices integer not null default 0,
        validation_interval_hours integer not null default 24,
        max_concurrent_cashier_sessions integer not null default 1,
        session_timeout_minutes integer not null default 30,
        status text not null default 'inactive' check (status in ('active', 'inactive', 'expired', 'revoked', 'suspended')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists devices (
        id uuid primary key default gen_random_uuid(),
        restaurant_id uuid not null references restaurants(id) on delete cascade,
        user_id uuid references users(id) on delete set null,
        device_id text not null unique,
        fingerprint text not null,
        device_name text,
        operating_system text,
        activation_date timestamptz not null default now(),
        last_online timestamptz not null default now(),
        last_online_validation_at timestamptz not null default now(),
        device_secret_hash text,
        status text not null default 'active' check (status in ('active', 'revoked', 'reset')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists login_sessions (
        id uuid primary key default gen_random_uuid(),
        jwt_id text not null unique,
        user_id uuid not null,
        user_type text not null check (user_type in ('user', 'super_admin')),
        restaurant_id uuid references restaurants(id) on delete set null,
        device_id uuid references devices(id) on delete set null,
        login_time timestamptz not null default now(),
        logout_time timestamptz,
        status text not null default 'active' check (status in ('active', 'expired', 'logged_out', 'revoked')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      -- Denormalized role (cheap concurrency counting) + heartbeat timestamp
      -- (idle-timeout sweep) for the cashier concurrent-session limit.
      alter table login_sessions add column if not exists role text;
      alter table login_sessions add column if not exists last_seen_at timestamptz not null default now();
      create index if not exists idx_login_sessions_restaurant_role_status
        on login_sessions (restaurant_id, role, status);

      -- audit_logs feature removed; drop the table if it exists from a previous boot.
      drop table if exists audit_logs;

      alter table users add column if not exists legacy_worker_id text;
      alter table licenses add column if not exists max_concurrent_cashier_sessions integer not null default 1;
      alter table licenses add column if not exists session_timeout_minutes integer not null default 30;
      alter table login_sessions add column if not exists role text;
      alter table login_sessions add column if not exists last_seen_at timestamptz not null default now();
      alter table devices add column if not exists device_secret_hash text;

      create index if not exists idx_devices_restaurant on devices (restaurant_id);
      create index if not exists idx_users_restaurant on users (restaurant_id);

      do $$
      begin
        if exists (select 1 from pg_roles where rolname = 'service_role') then
          grant select, insert, update, delete on public.records to service_role;
          grant select, insert, update, delete on public.restaurants to service_role;
          grant select, insert, update, delete on public.users to service_role;
          grant select, insert, update, delete on public.super_admins to service_role;
          grant select, insert, update, delete on public.licenses to service_role;
          grant select, insert, update, delete on public.devices to service_role;
          grant select, insert, update, delete on public.login_sessions to service_role;
        end if;
      end $$;
    `);
  }
  return _schemaReady;
}

function redact(url) {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}
