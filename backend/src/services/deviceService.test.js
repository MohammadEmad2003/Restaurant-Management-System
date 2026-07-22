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
