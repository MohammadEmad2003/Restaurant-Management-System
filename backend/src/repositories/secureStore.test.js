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

// Regression: create()/update() used to return a LIVE reference into the
// store's own in-memory cached row (local-JSON layer's `rows[idx]`), not a
// copy. A caller that mutated what it got back — as authService.js once did
// (`device.plainDeviceSecret = ...`, to hand a plaintext secret to the
// client exactly once) — silently corrupted the actual cached/persisted
// row forever. The very next update to that same row would then carry the
// stray field into a Postgres write, which fails outright (unknown column)
// and is treated as a non-retryable data error — so the real update
// silently never reached Postgres, while local state and the client both
// believed it had. This permanently desynced that row from Postgres,
// 401ing every request the very next time it was checked online.
test('mutating the object returned by create()/update() must never affect what a later read sees (no live-reference leak)', async () => {
  await initSecureStore();
  const store = secureStore();

  const created = await store.create('restaurants', { restaurantName: `Mutation Test ${Math.random()}`, status: 'active' });
  created.injectedField = 'should never persist';
  const rereadAfterCreate = await store.findOne('restaurants', { id: created.id });
  assert.equal(rereadAfterCreate.injectedField, undefined, 'mutating the create() return value must not pollute the stored row');

  const updated = await store.update('restaurants', created.id, { status: 'suspended' });
  updated.injectedField = 'should also never persist';
  const rereadAfterUpdate = await store.findOne('restaurants', { id: created.id });
  assert.equal(rereadAfterUpdate.injectedField, undefined, 'mutating the update() return value must not pollute the stored row');
  assert.equal(rereadAfterUpdate.status, 'suspended', 'the legitimate update itself must still have applied');
});

test('SECURE_COLLECTIONS lists every auth-critical table in dependency-safe order (restaurants before users/licenses/devices, users before devices, devices before hardware_bindings)', () => {
  assert.deepEqual(SECURE_COLLECTIONS, ['restaurants', 'users', 'super_admins', 'licenses', 'devices', 'login_sessions', 'activation_tokens', 'hardware_bindings']);
  const idx = (name) => SECURE_COLLECTIONS.indexOf(name);
  assert.ok(idx('restaurants') < idx('users'));
  assert.ok(idx('restaurants') < idx('licenses'));
  assert.ok(idx('restaurants') < idx('devices'));
  assert.ok(idx('users') < idx('devices'));
  assert.ok(idx('restaurants') < idx('activation_tokens'));
  assert.ok(idx('devices') < idx('hardware_bindings'));
});
