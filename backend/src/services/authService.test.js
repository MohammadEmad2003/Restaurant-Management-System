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
