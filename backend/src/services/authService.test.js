import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authService } from './authService.js';
import { superAdminService } from './superAdminService.js';
import { createTestRestaurant, createCashier, store } from '../test-helpers/fixtures.js';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

test('login succeeds with correct credentials on an activated license', async () => {
  const { admin, activationToken } = await createTestRestaurant();
  await authService.activateRestaurantLicense({
    username: admin.username,
    password: 'admin12345',
    token: activationToken,
    fingerprint: 'fp-1',
    userAgent: DESKTOP_UA,
  });
  const result = await authService.loginRestaurantUser({
    username: admin.username,
    password: 'admin12345',
    fingerprint: 'fp-1',
    userAgent: DESKTOP_UA,
  });
  assert.ok(result.token);
  assert.equal(result.user.username, admin.username);
});

test('login rejects invalid password', async () => {
  const { admin } = await createTestRestaurant();
  await assert.rejects(
    () => authService.loginRestaurantUser({ username: admin.username, password: 'wrong', fingerprint: 'fp-2', userAgent: DESKTOP_UA }),
    /Invalid credentials/,
  );
});

test('login rejects a suspended user', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  const cashier = await createCashier(restaurant.id);
  await authService.activateRestaurantLicense({
    username: (await store().findOne('users', { restaurantId: restaurant.id, role: 'ADMIN' })).username,
    password: 'admin12345',
    token: activationToken,
    fingerprint: 'fp-admin-3',
    userAgent: DESKTOP_UA,
  });
  await superAdminService.suspendRestaurantUser(cashier.id);
  await assert.rejects(
    () => authService.loginRestaurantUser({ username: cashier.username, password: 'cashier12345', fingerprint: 'fp-3', userAgent: DESKTOP_UA }),
    /Account disabled/,
  );
});

test('ADMIN login with a never-activated license returns requiresActivation, no token', async () => {
  const { admin } = await createTestRestaurant();
  const result = await authService.loginRestaurantUser({
    username: admin.username,
    password: 'admin12345',
    fingerprint: 'fp-4',
    userAgent: DESKTOP_UA,
  });
  assert.equal(result.requiresActivation, true);
  assert.equal(result.token, null);
});

test('CASHIER is rejected from a non-desktop user agent', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  const admin = await store().findOne('users', { restaurantId: restaurant.id, role: 'ADMIN' });
  await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-admin-5', userAgent: DESKTOP_UA,
  });
  const cashier = await createCashier(restaurant.id);
  await assert.rejects(
    () => authService.loginRestaurantUser({ username: cashier.username, password: 'cashier12345', fingerprint: 'fp-5', userAgent: MOBILE_UA }),
    /desktop or laptop/,
  );
  // Same cashier, desktop UA, succeeds.
  const ok = await authService.loginRestaurantUser({ username: cashier.username, password: 'cashier12345', fingerprint: 'fp-5b', userAgent: DESKTOP_UA });
  assert.ok(ok.token);
});

test('ADMIN is never blocked by device type', async () => {
  const { admin, activationToken } = await createTestRestaurant();
  const result = await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-6', userAgent: MOBILE_UA,
  });
  assert.ok(result.token);
});

test('two users sharing the same username (and password) in the same restaurant can both be created, and once a device has logged in as one of them it keeps resolving back to that SAME user on every re-login (Part 9 regression)', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant({ licenseOverrides: { maximumDevices: 10 } });
  // CASHIER logins require an active license — activate it via the admin first.
  await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-admin-shared-setup', userAgent: DESKTOP_UA,
  });

  // Two intentionally identical usernames (and even identical passwords) in
  // one restaurant — this used to be rejected with a 409 (users.restaurantId+
  // username uniqueness); it must now be allowed.
  const userA = await superAdminService.createRestaurantUser(restaurant.id, { username: 'shared', password: 'shared12345', role: 'CASHIER' });
  const userB = await superAdminService.createRestaurantUser(restaurant.id, { username: 'shared', password: 'shared12345', role: 'CASHIER' });
  assert.notEqual(userA.id, userB.id);

  // A brand-new device with two identical-credential candidates has no signal
  // to prefer one over the other — it deterministically gets the first match
  // (documented, accepted ambiguity: see Part 9 plan). What matters is that
  // this same device, once bound, always resolves back to the SAME user
  // afterwards instead of randomly drifting to the other identical account.
  const firstLogin = await authService.loginRestaurantUser({ username: 'shared', password: 'shared12345', fingerprint: 'fp-device-a', userAgent: DESKTOP_UA });
  assert.ok(firstLogin.token);
  assert.ok([userA.id, userB.id].includes(firstLogin.user.id));

  const relogin = await authService.loginRestaurantUser({ username: 'shared', password: 'shared12345', fingerprint: 'fp-device-a', userAgent: DESKTOP_UA });
  assert.equal(relogin.user.id, firstLogin.user.id, 'the same device must keep resolving to the same one of the two identical-username accounts');

  // A genuinely different device (e.g. the other physical cashier terminal)
  // logging in fresh is also unambiguous only once it, too, has been bound —
  // exercised here to confirm the second account remains independently usable.
  const secondDeviceLogin = await authService.loginRestaurantUser({ username: 'shared', password: 'shared12345', fingerprint: 'fp-device-b', userAgent: DESKTOP_UA });
  assert.ok(secondDeviceLogin.token);
  const secondDeviceRelogin = await authService.loginRestaurantUser({ username: 'shared', password: 'shared12345', fingerprint: 'fp-device-b', userAgent: DESKTOP_UA });
  assert.equal(secondDeviceRelogin.user.id, secondDeviceLogin.user.id);
});

test('same username across two different restaurants (with distinct passwords) still resolves correctly after Part 9\'s device-userId hint (no regression)', async () => {
  const { restaurant: restaurantA, activationToken: tokenA } = await createTestRestaurant({ adminUsername: 'dup_user', adminPassword: 'passwordA123' });
  const { restaurant: restaurantB, activationToken: tokenB } = await createTestRestaurant({ adminUsername: 'dup_user', adminPassword: 'passwordB123' });
  await authService.activateRestaurantLicense({ username: 'dup_user', password: 'passwordA123', token: tokenA, fingerprint: 'fp-cross-a', userAgent: DESKTOP_UA });
  const loginB = await authService.activateRestaurantLicense({ username: 'dup_user', password: 'passwordB123', token: tokenB, fingerprint: 'fp-cross-b', userAgent: DESKTOP_UA });
  assert.equal(loginB.user.restaurantId, restaurantB.id);
});
