import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authService } from './authService.js';
import { superAdminService } from './superAdminService.js';
import { deviceService } from './deviceService.js';
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

// Regression: loginRestaurantUser used to re-assemble the returned `device`
// object from a plain deviceService.updateValidationTimestamp() read (added
// for the monthly-online-validation feature), which never carries
// `plainDeviceSecret` — an in-memory-only field that _issueSecret() attaches,
// never persisted. That silently returned deviceSecret: null on every login,
// including a genuinely brand-new device that should receive one — leaving
// the client with no secret to send on every subsequent request, which
// requireDeviceBound then rejects outright. Login itself "succeeded" (a
// token came back), but the app was completely unusable immediately after.
test('login returns a usable deviceSecret for a brand-new device, and that exact secret validates against the stored device', async () => {
  const { admin, activationToken } = await createTestRestaurant();
  await authService.activateRestaurantLicense({
    username: admin.username,
    password: 'admin12345',
    token: activationToken,
    fingerprint: 'fp-device-secret-regress',
    userAgent: DESKTOP_UA,
  });
  const result = await authService.loginRestaurantUser({
    username: admin.username,
    password: 'admin12345',
    fingerprint: 'fp-device-secret-regress',
    userAgent: DESKTOP_UA,
  });
  assert.ok(result.deviceSecret, 'a brand-new device must receive a usable plaintext secret on login, not null');
  const storedDevice = await deviceService.getDevice(result.device.id);
  assert.equal(deviceService.validateDeviceSecret(storedDevice, result.deviceSecret), true, 'the returned secret must actually validate against what was persisted');
});

// Regression: authService used to mutate the object returned from
// deviceService.updateValidationTimestamp() directly
// (`validatedDevice.plainDeviceSecret = ...`) to attach the plaintext
// secret for the response — but that return value is a live reference into
// secureStore's own cached row (see secureStore.test.js's "no live-
// reference leak" test), so the mutation permanently polluted the stored
// device row with a `plainDeviceSecret` field. A SECOND login for the same
// device (re-registering the same fingerprint) then carried that stray
// field into the next write, which — against a real Postgres-backed
// installation — fails outright (no such column) and silently never
// persists the fresh secret rotation, even though the client believes
// it received a working one. Verifies both that a second login keeps
// working AND that no such field ever leaks into the stored row.
test('logging in twice from the same device never leaves a stray plainDeviceSecret field on the stored device row, and both logins remain fully usable', async () => {
  const { admin, activationToken } = await createTestRestaurant();
  await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken,
    fingerprint: 'fp-repeat-login', userAgent: DESKTOP_UA,
  });

  const first = await authService.loginRestaurantUser({
    username: admin.username, password: 'admin12345', fingerprint: 'fp-repeat-login', userAgent: DESKTOP_UA,
  });
  const afterFirst = await deviceService.getDevice(first.device.id);
  assert.equal(afterFirst.plainDeviceSecret, undefined, 'the stored device row must never carry the transient plaintext-secret field');

  const second = await authService.loginRestaurantUser({
    username: admin.username, password: 'admin12345', fingerprint: 'fp-repeat-login', userAgent: DESKTOP_UA,
  });
  assert.ok(second.deviceSecret, 'the second login must also receive a usable secret');
  const afterSecond = await deviceService.getDevice(second.device.id);
  assert.equal(afterSecond.plainDeviceSecret, undefined, 'still no stray field after a second login/secret rotation');
  assert.equal(deviceService.validateDeviceSecret(afterSecond, second.deviceSecret), true, 'the second login\'s secret must validate against what was actually persisted');
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

test('a username must now be globally unique — two users can no longer share one, even within the same restaurant (supersedes the old Part 9 device-disambiguation design)', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant({ licenseOverrides: { maximumDevices: 10 } });
  await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-admin-shared-setup', userAgent: DESKTOP_UA,
  });

  await superAdminService.createRestaurantUser(restaurant.id, { username: 'shared', password: 'shared12345', role: 'CASHIER' });
  await assert.rejects(
    () => superAdminService.createRestaurantUser(restaurant.id, { username: 'shared', password: 'shared12345', role: 'CASHIER' }),
    /already taken/,
  );
});

test('a username must be globally unique across restaurants too — the same username can no longer be reused when creating a second restaurant', async () => {
  const { activationToken: tokenA } = await createTestRestaurant({ adminUsername: 'dup_user', adminPassword: 'passwordA123' });
  await authService.activateRestaurantLicense({ username: 'dup_user', password: 'passwordA123', token: tokenA, fingerprint: 'fp-cross-a', userAgent: DESKTOP_UA });
  await assert.rejects(
    () => createTestRestaurant({ adminUsername: 'dup_user', adminPassword: 'passwordB123' }),
    /already taken/,
  );
});

// Regression: deleteRestaurant only ever flipped status to 'deleted', which
// merely hid it from listRestaurants() — login never checked for 'deleted'
// (only 'suspended'), so every user of a "deleted" restaurant could keep
// logging in and working indefinitely.
test('login is blocked once the restaurant has been deleted', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-del-1', userAgent: DESKTOP_UA,
  });
  await superAdminService.deleteRestaurant(restaurant.id);
  await assert.rejects(
    () => authService.loginRestaurantUser({ username: admin.username, password: 'admin12345', fingerprint: 'fp-del-2', userAgent: DESKTOP_UA }),
    /subscription has expired/,
  );
});

test('generateOfflineLicense computes offlineExpiration from offlineDays', async () => {
  const withDays = authService.generateOfflineLicense({
    restaurantId: 'r1', licenseId: 'l1', deviceId: 'd1', fingerprint: 'fp1',
    expirationDate: new Date(Date.now() + 86400000 * 30).toISOString(),
    offlineDays: 7, validationIntervalHours: 24,
  });
  const daysUntil = (new Date(withDays.offlineExpiration).getTime() - Date.now()) / 86400000;
  assert.ok(daysUntil > 6.9 && daysUntil < 7.1, 'offlineExpiration must be ~7 days from now');
});
