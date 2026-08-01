import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secureStore, initSecureStore, SECURE_COLLECTIONS } from './secureStore.js';

// These run under the local-only test environment (DATABASE_URL='' — see
// backend/package.json's "test" script), so they exercise exactly the path
// every real local-only/no-Supabase deployment uses. The Postgres mirror/
// reconcile paths were verified manually against a real ephemeral Postgres
// instance (not practical to spin up here) — this suite guards the local
// fallback behavior those paths depend on never regressing silently.

test('secureStore falls back to local JSON when Supabase is not configured, and CRUD round-trips correctly', async () => {
  await initSecureStore();
  const store = secureStore();

  const restaurant = await store.create('restaurants', { restaurantName: `Test ${Math.random()}`, status: 'active' });
  assert.ok(restaurant.id);

  const found = await store.findOne('restaurants', { id: restaurant.id });
  assert.equal(found.restaurantName, restaurant.restaurantName);

  const updated = await store.update('restaurants', restaurant.id, { status: 'suspended' });
  assert.equal(updated.status, 'suspended');

  const refetched = await store.findOne('restaurants', { id: restaurant.id });
  assert.equal(refetched.status, 'suspended');

  await store.remove('restaurants', restaurant.id);
  const gone = await store.findOne('restaurants', { id: restaurant.id });
  assert.equal(gone, null);
});

test('SECURE_COLLECTIONS lists every auth-critical table in dependency-safe order (restaurants before users/licenses/devices, users before devices)', () => {
  assert.deepEqual(SECURE_COLLECTIONS, ['restaurants', 'users', 'super_admins', 'licenses', 'devices', 'login_sessions']);
  const idx = (name) => SECURE_COLLECTIONS.indexOf(name);
  assert.ok(idx('restaurants') < idx('users'));
  assert.ok(idx('restaurants') < idx('licenses'));
  assert.ok(idx('restaurants') < idx('devices'));
  assert.ok(idx('users') < idx('devices'));
});
