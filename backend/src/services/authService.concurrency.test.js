import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authService } from './authService.js';
import { licenseService } from './licenseService.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

test('cashier concurrent-session race regression: 6 simultaneous logins, limit=1, exactly 1 succeeds', async () => {
  // This is a direct-function-call repro of the manual curl test that found
  // the original bug (all 6 succeeded before the withLock fix).
  const { restaurant, activationToken } = await createTestRestaurant({
    licenseOverrides: { maxConcurrentCashierSessions: 1, maximumDevices: 20 },
  });
  await licenseService.activateLicense(restaurant.id, activationToken);
  const cashiers = await Promise.all(Array.from({ length: 6 }, () => createCashier(restaurant.id)));

  const attempts = await Promise.allSettled(
    cashiers.map((c, i) =>
      authService.loginRestaurantUser({ username: c.username, password: 'cashier12345', fingerprint: `fp-burst-${i}`, userAgent: DESKTOP_UA })),
  );
  const succeeded = attempts.filter((a) => a.status === 'fulfilled');
  const rejectedMessages = attempts.filter((a) => a.status === 'rejected').map((a) => a.reason.message);
  assert.equal(succeeded.length, 1, `expected exactly 1 success, got ${succeeded.length}`);
  assert.ok(rejectedMessages.every((m) => /maximum number of active cashier sessions/i.test(m)));
});

test('a cashier re-logging in on their own device is never blocked by their own prior session', async () => {
  const { restaurant, activationToken } = await createTestRestaurant({ licenseOverrides: { maxConcurrentCashierSessions: 1 } });
  await licenseService.activateLicense(restaurant.id, activationToken);
  const cashier = await createCashier(restaurant.id);

  const first = await authService.loginRestaurantUser({ username: cashier.username, password: 'cashier12345', fingerprint: 'fp-same-device', userAgent: DESKTOP_UA });
  assert.ok(first.token);
  const second = await authService.loginRestaurantUser({ username: cashier.username, password: 'cashier12345', fingerprint: 'fp-same-device', userAgent: DESKTOP_UA });
  assert.ok(second.token, 'same cashier re-authenticating on the same device must succeed, not be blocked by their own session');
});
