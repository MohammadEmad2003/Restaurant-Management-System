import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceService } from './deviceService.js';
import { licenseService } from './licenseService.js';
import { authService } from './authService.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

test('a revoked device is NOT silently reactivated by the next login (regression)', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const device = await deviceService.registerDevice({
    restaurantId: restaurant.id, userId: admin.id, fingerprint: 'fp-revoke-regress',
  });
  await deviceService.deleteDevice(device.id, restaurant.id);

  const revoked = await deviceService.getDevice(device.id);
  assert.equal(revoked.status, 'revoked');

  await assert.rejects(
    () => deviceService.registerDevice({ restaurantId: restaurant.id, userId: admin.id, fingerprint: 'fp-revoke-regress' }),
    /revoked/,
  );
  const stillRevoked = await deviceService.getDevice(device.id);
  assert.equal(stillRevoked.status, 'revoked', 'device must stay revoked, not silently reactivate');
});

test('registerDevice re-issues a fresh device secret on every full login (regression: a login that succeeds must never be permanently unusable)', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const first = await deviceService.registerDevice({ restaurantId: restaurant.id, userId: admin.id, fingerprint: 'fp-secret-1' });
  assert.ok(first.plainDeviceSecret, 'a fresh device should receive a plaintext secret');
  assert.ok(first.deviceSecretHash);

  // Simulates a second login from a browsing context that lost/never had the
  // first secret (cleared storage, a private window, a different profile) —
  // this must succeed and hand back a NEW secret that actually works,
  // otherwise the login would be silently unusable for every request after.
  const second = await deviceService.registerDevice({ restaurantId: restaurant.id, userId: admin.id, fingerprint: 'fp-secret-1' });
  assert.ok(second.plainDeviceSecret, 'every fresh login must receive a usable secret, not just the very first one');
  assert.notEqual(second.deviceSecretHash, first.deviceSecretHash, 'the secret should rotate on each fresh login');
  assert.equal(deviceService.validateDeviceSecret(second, second.plainDeviceSecret), true);
});

test('validateDeviceSecret tolerates legacy devices with no hash yet, but rejects a wrong secret once one is set', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const device = await deviceService.registerDevice({ restaurantId: restaurant.id, userId: admin.id, fingerprint: 'fp-secret-2' });

  assert.equal(deviceService.validateDeviceSecret({ deviceSecretHash: null }, 'anything'), true);
  assert.equal(deviceService.validateDeviceSecret(device, device.plainDeviceSecret), true);
  assert.equal(deviceService.validateDeviceSecret(device, 'wrong-secret'), false);
});

test('updateValidationTimestamp only advances lastOnlineValidationAt when called with online:true, but always touches lastOnline', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const device = await deviceService.registerDevice({ restaurantId: restaurant.id, userId: admin.id, fingerprint: 'fp-monthly-1' });
  const original = await deviceService.getDevice(device.id);
  await new Promise((r) => setTimeout(r, 5));

  const afterOffline = await deviceService.updateValidationTimestamp(device.id, { online: false });
  assert.equal(afterOffline.lastOnlineValidationAt, original.lastOnlineValidationAt, 'an offline-only contact must not advance the monthly-validation anchor');
  assert.notEqual(afterOffline.lastOnline, original.lastOnline, 'lastOnline is general bookkeeping and should still update regardless');

  await new Promise((r) => setTimeout(r, 5));
  const afterOnline = await deviceService.updateValidationTimestamp(device.id, { online: true });
  assert.notEqual(afterOnline.lastOnlineValidationAt, original.lastOnlineValidationAt, 'a genuinely online contact must advance the monthly-validation anchor');
});

test('computeMonthlyValidationDeadline is derived from the device\'s own lastOnlineValidationAt, not from "now"', async () => {
  const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
  const deadline = authService.computeMonthlyValidationDeadline(past);
  assert.ok(new Date(deadline).getTime() < Date.now(), 'a device last validated 40 days ago must already be past its monthly deadline');
});

test('generateOfflineLicense signs a monthlyValidationDeadline into the payload, ~30 days from the given anchor', async () => {
  const anchor = new Date().toISOString();
  const license = authService.generateOfflineLicense({
    restaurantId: 'r1', licenseId: 'l1', deviceId: 'd1', fingerprint: 'fp1',
    expirationDate: new Date(Date.now() + 86400000 * 365).toISOString(),
    offlineDays: 7, validationIntervalHours: 24,
    monthlyValidationDeadline: authService.computeMonthlyValidationDeadline(anchor),
  });
  const payload = JSON.parse(license.payload);
  const daysUntil = (new Date(payload.monthlyValidationDeadline).getTime() - Date.now()) / 86400000;
  assert.ok(daysUntil > 29.9 && daysUntil < 30.1, 'monthlyValidationDeadline must be ~30 days from the anchor');
});

test('a login while genuinely offline does not extend a device\'s monthly-validation deadline beyond its last real online contact', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await authService.loginRestaurantUser({ username: admin.username, password: 'admin12345', fingerprint: 'fp-monthly-2', userAgent: DESKTOP_UA });
  const onlineDevice = await deviceService.getDevice((await deviceService.findByFingerprint(restaurant.id, 'fp-monthly-2')).id);
  const firstValidatedAt = onlineDevice.lastOnlineValidationAt;

  // Simulate a re-login that only succeeded against local data (device is
  // actually offline) — deviceService itself has no notion of connectivity,
  // that's the caller's job (authService reads connectivity.isOnline), so
  // this test exercises the same primitive authService relies on directly.
  await new Promise((r) => setTimeout(r, 5));
  const afterOfflineRelogin = await deviceService.updateValidationTimestamp(onlineDevice.id, { online: false });
  assert.equal(afterOfflineRelogin.lastOnlineValidationAt, firstValidatedAt, 'repeated offline-only logins must never push the monthly deadline forward');
});

test('device-limit race: N concurrent logins (new fingerprints) against maximumDevices=1 only let one through', async () => {
  // registerDevice() itself is only race-free when called from within
  // authService's per-restaurant lock (see its own comment) — so this
  // regression test exercises the real, lock-protected call path (login),
  // exactly like the manual repro that found the bug, rather than calling
  // registerDevice directly (which would not be race-free by design).
  // maxConcurrentCashierSessions is set high so the DEVICE limit (not the
  // cashier-session limit) is the one being isolated and tested here.
  const { restaurant, activationToken } = await createTestRestaurant({
    licenseOverrides: { maximumDevices: 1, maxConcurrentCashierSessions: 10 },
  });
  await licenseService.activateLicense(restaurant.id, activationToken);
  const cashiers = await Promise.all(Array.from({ length: 5 }, () => createCashier(restaurant.id)));

  const attempts = await Promise.allSettled(
    cashiers.map((c, i) =>
      authService.loginRestaurantUser({ username: c.username, password: 'cashier12345', fingerprint: `fp-race-${i}`, userAgent: DESKTOP_UA })),
  );
  const succeeded = attempts.filter((a) => a.status === 'fulfilled');
  assert.equal(succeeded.length, 1, `expected exactly 1 login (device registration) to succeed, got ${succeeded.length}`);
});
