import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, ensureDefaultAccounts } from './runMigrations.js';
import { authService } from '../services/authService.js';
import { licenseService } from '../services/licenseService.js';
import { secureStore } from '../repositories/secureStore.js';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const store = secureStore();

/** Builds a restaurant + active license exactly the way runMigrations does
 * for a truly fresh install — bypassing superAdminService.createRestaurant
 * (which would auto-create its own admin), so ensureDefaultAccounts can be
 * tested against a genuinely empty restaurant, isolated from whatever else
 * this suite's shared test datastore already contains. */
async function makeBootstrapRestaurant() {
  const restaurant = await store.create('restaurants', { restaurantName: `Bootstrap Test ${Math.random().toString(36).slice(2, 8)}`, status: 'active' });
  await licenseService.createLicense(restaurant.id, { maximumDevices: 10 });
  await licenseService.setLicenseForever(restaurant.id);
  return restaurant;
}

// Regression: a fresh install used to create the bootstrap restaurant + an
// (inactive) license but ZERO `users` rows — meaning the demo credentials
// (admin/admin123, cashier/cashier123) pre-filled and advertised right on
// the Login screen could never actually log in out of the box.
//
// Both assertions share ONE restaurant (rather than each making their own)
// because usernames are globally unique across every restaurant in this
// app — a second bootstrap restaurant calling ensureDefaultAccounts would
// collide on the literal 'admin'/'cashier' usernames the first one already
// claimed, which is a test-setup artifact, not a real scenario (production
// only ever runs this once, against one true bootstrap restaurant).
test('ensureDefaultAccounts creates working admin/admin123 and cashier/cashier123 accounts, and is idempotent on a second call', async () => {
  const restaurant = await makeBootstrapRestaurant();
  const created = await ensureDefaultAccounts(restaurant.id);
  assert.equal(created, true);

  const adminLogin = await authService.loginRestaurantUser({
    username: 'admin', password: 'admin123', fingerprint: `fp-${restaurant.id}-admin`, userAgent: DESKTOP_UA,
  });
  assert.ok(adminLogin.token, 'the seeded default admin must be able to log in immediately, with no manual activation step');
  assert.equal(adminLogin.requiresActivation, false);
  assert.equal(adminLogin.user.restaurantId, restaurant.id);

  const cashierLogin = await authService.loginRestaurantUser({
    username: 'cashier', password: 'cashier123', fingerprint: `fp-${restaurant.id}-cashier`, userAgent: DESKTOP_UA,
  });
  assert.ok(cashierLogin.token, 'the seeded default cashier must be able to log in immediately');

  const before = await store.findAll('users', { restaurantId: restaurant.id });
  const createdAgain = await ensureDefaultAccounts(restaurant.id);
  assert.equal(createdAgain, false, 'must report it did nothing on a second call — this restaurant already has users');
  const after = await store.findAll('users', { restaurantId: restaurant.id });
  assert.equal(after.length, before.length, 're-running must be idempotent, not create duplicate accounts');
});

// Regression: on a real, already-used database (not a fresh install),
// usernames are globally unique across every restaurant (see
// superAdminService.assertUsernameAvailable) — so literally 'admin' may
// already belong to some OTHER restaurant from earlier real-world use. This
// crashed the ENTIRE server on every boot (an uncaught rejection out of
// runMigrations → start()), not just skipping the bootstrap convenience.
// Relies on running after the test above, which has already claimed the
// literal 'admin'/'cashier' usernames globally — exactly the real-world
// condition being reproduced, with no extra setup needed here.
test('ensureDefaultAccounts never throws when its default usernames are already taken by another restaurant', async () => {
  const fresh = await makeBootstrapRestaurant();
  let created;
  await assert.doesNotReject(async () => { created = await ensureDefaultAccounts(fresh.id); });
  assert.equal(created, false, 'both defaults were already taken by the earlier test\'s restaurant, so nothing could be created here — but it must not have thrown');

  const freshUsers = await store.findAll('users', { restaurantId: fresh.id });
  assert.equal(freshUsers.length, 0, 'neither colliding default account may be created for (or stolen from) another restaurant');
});

test('runMigrations runs end-to-end without throwing and leaves a real super admin in place', async () => {
  await runMigrations();
  const admins = await store.findAll('super_admins');
  assert.ok(admins.length >= 1, 'at least one super admin must exist after migrations run');
});
