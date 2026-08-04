import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseService } from './licenseService.js';
import { getTrustedNow } from '../utils/trustedTime.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

test('validateLicense rejects an inactive (never-activated) license', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.validateLicense(restaurant.id), /subscription has expired/);
});

test('validateLicense passes for an active, non-expired license', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const license = await licenseService.validateLicense(restaurant.id);
  assert.equal(license.status, 'active');
});

test('validateLicense rejects and flips status when expirationDate has passed', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await licenseService.reduceLicenseDuration(restaurant.id, 365);
  await assert.rejects(() => licenseService.validateLicense(restaurant.id), /subscription has expired/);
  const license = await licenseService.getLicenseByRestaurant(restaurant.id);
  assert.equal(license.status, 'expired');
});

// This backend runs on the SAME machine as the user (embedded in Electron) —
// rolling the OS system clock backward would otherwise fool a plain
// `new Date() < expirationDate` comparison exactly as it would on the
// frontend (which already has its own monotonic-clock defense). Once
// getTrustedNow() has observed the real current time, an already-expired
// license must stay rejected even if Date.now() is later made to lie.
test('validateLicense cannot be bypassed by winding the system clock backward after the real expiration was already observed (clock-rollback regression)', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await licenseService.reduceLicenseDuration(restaurant.id, 365); // force expiry in real time
  await assert.rejects(() => licenseService.validateLicense(restaurant.id), /subscription has expired/);
  // Confirm the real current time has been observed/persisted by now.
  const observedNow = getTrustedNow();

  const originalNow = Date.now;
  try {
    // Attacker rolls the OS clock back a year to make the license look
    // like it hasn't expired yet.
    Date.now = () => observedNow - 365 * 24 * 60 * 60 * 1000;
    await assert.rejects(() => licenseService.validateLicense(restaurant.id), /subscription has expired/);
  } finally {
    Date.now = originalNow;
  }
});

test('validateLicense rejects a revoked license', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await licenseService.revokeLicense(restaurant.id);
  await assert.rejects(() => licenseService.validateLicense(restaurant.id), /subscription has expired/);
});

test('validateLicense rejects a suspended license', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await licenseService.suspendLicense(restaurant.id);
  await assert.rejects(() => licenseService.validateLicense(restaurant.id), /subscription has expired/);
});

test('activateLicense rejects an invalid token', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.activateLicense(restaurant.id, 'WRONG-TOKEN'), /Invalid activation token/);
});

test('activateLicense re-activates an EXPIRED license once a fresh token is regenerated', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await licenseService.reduceLicenseDuration(restaurant.id, 365); // force expiry
  const { token: newToken } = await licenseService.regenerateActivationToken(restaurant.id);
  const reactivated = await licenseService.activateLicense(restaurant.id, newToken);
  assert.equal(reactivated.status, 'active');
  assert.ok(new Date(reactivated.expirationDate) > new Date());
});

test('setLicenseForever sets the sentinel far-future expiration and activates the license', async () => {
  const { restaurant } = await createTestRestaurant();
  const { license, expirationDate } = await licenseService.setLicenseForever(restaurant.id);
  assert.equal(expirationDate, '9999-12-31T23:59:59.999Z');
  assert.equal(license.status, 'active');
  assert.ok(new Date(license.expirationDate).getFullYear() >= 9999);
});

// Regression: `if (value < min)` silently passes for NaN (`NaN < 1` is
// `false` in JS), previously letting e.g. maximumDevices:"abc" be stored and
// later crash every login for that restaurant via an uncaught RangeError.
// requireFiniteNumber must reject non-numeric/too-low input up front, for
// every remaining numeric setter (offlineDays/validationIntervalHours/
// sessionTimeoutMinutes are no longer independently settable — see below).
test('changeMaximumDevices rejects non-numeric and below-minimum input', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.changeMaximumDevices(restaurant.id, 'abc'), /Maximum devices must be a number/);
  await assert.rejects(() => licenseService.changeMaximumDevices(restaurant.id, 0), /Maximum devices must be a number/);
  const ok = await licenseService.changeMaximumDevices(restaurant.id, 3);
  assert.equal(ok.maximumDevices, 3);
});

test('changeMaxConcurrentCashierSessions rejects non-numeric input', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.changeMaxConcurrentCashierSessions(restaurant.id, 'abc'), /Concurrent cashier sessions must be a number/);
});

// Offline access is merged with the license's own duration — no longer a
// separately-configurable setting (product decision: Session Timeout and
// Validation Interval were removed from the Super Admin UI entirely, and
// Offline Days was merged into License Days rather than kept independent).
test('createLicense merges offlineDays with the license\'s own day count', async () => {
  const { restaurant } = await createTestRestaurant({ licenseOverrides: { days: 45 } });
  const license = await licenseService.getLicenseByRestaurant(restaurant.id);
  assert.equal(license.offlineDays, 45, 'offlineDays must equal whatever "days" the license was created with, not a separate value');
});

test('renewLicense keeps offlineDays merged with the new day count', async () => {
  const { restaurant, activationToken } = await createTestRestaurant({ licenseOverrides: { days: 30 } });
  await licenseService.activateLicense(restaurant.id, activationToken);
  const { license } = await licenseService.renewLicense(restaurant.id, 90);
  assert.equal(license.offlineDays, 90, 'renewing must keep offlineDays merged with the license\'s new day count');
});

// Regression: the Super Admin UI now lets an admin type an arbitrary number
// of days for Renew/Extend/Reduce (not just a fixed 30-day default) — these
// three must reject non-numeric/non-positive input the same way every other
// numeric license setter already does (requireFiniteNumber), or a bad value
// reaches `setDate(getDate() + "abc")` → Invalid Date → an uncaught
// RangeError the next time this license's expirationDate is read anywhere.
test('renewLicense rejects non-numeric and non-positive day counts', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.renewLicense(restaurant.id, 'abc'), /Renewal days must be a number/);
  await assert.rejects(() => licenseService.renewLicense(restaurant.id, 0), /Renewal days must be a number/);
  await assert.rejects(() => licenseService.renewLicense(restaurant.id, -5), /Renewal days must be a number/);
});

test('extendLicense rejects non-numeric and non-positive day counts, and correctly extends the current expiration by an arbitrary custom amount', async () => {
  const { restaurant, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  await assert.rejects(() => licenseService.extendLicense(restaurant.id, 'abc'), /Extension days must be a number/);
  await assert.rejects(() => licenseService.extendLicense(restaurant.id, 0), /Extension days must be a number/);

  const before = await licenseService.getLicenseByRestaurant(restaurant.id);
  const { expirationDate } = await licenseService.extendLicense(restaurant.id, 200);
  const daysDiff = (new Date(expirationDate).getTime() - new Date(before.expirationDate).getTime()) / 86400000;
  assert.ok(daysDiff > 199.9 && daysDiff < 200.1, 'must extend by exactly the custom day count requested, not a fixed default');
});

test('reduceLicenseDuration rejects non-numeric and non-positive day counts', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.reduceLicenseDuration(restaurant.id, 'abc'), /Reduction days must be a number/);
  await assert.rejects(() => licenseService.reduceLicenseDuration(restaurant.id, -1), /Reduction days must be a number/);
});
