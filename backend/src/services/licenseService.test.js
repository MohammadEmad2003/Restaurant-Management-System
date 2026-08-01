import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseService } from './licenseService.js';
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
// `false` in JS), previously letting e.g. offlineDays:"abc" be stored and
// later crash every login for that restaurant via an uncaught RangeError
// from `new Date().toISOString()` on an Invalid Date. requireFiniteNumber
// must reject non-numeric/too-low input up front, for every numeric setter.
test('changeOfflineDays rejects non-numeric and out-of-range input', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.changeOfflineDays(restaurant.id, 'abc'), /Offline days must be a number/);
  await assert.rejects(() => licenseService.changeOfflineDays(restaurant.id, NaN), /Offline days must be a number/);
  await assert.rejects(() => licenseService.changeOfflineDays(restaurant.id, -1), /Offline days must be a number/);
  const ok = await licenseService.changeOfflineDays(restaurant.id, 5);
  assert.equal(ok.offlineDays, 5);
});

test('changeMaximumDevices rejects non-numeric and below-minimum input', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.changeMaximumDevices(restaurant.id, 'abc'), /Maximum devices must be a number/);
  await assert.rejects(() => licenseService.changeMaximumDevices(restaurant.id, 0), /Maximum devices must be a number/);
  const ok = await licenseService.changeMaximumDevices(restaurant.id, 3);
  assert.equal(ok.maximumDevices, 3);
});

test('changeValidationInterval rejects non-numeric and below-minimum input', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.changeValidationInterval(restaurant.id, 'abc'), /Validation interval must be a number/);
  await assert.rejects(() => licenseService.changeValidationInterval(restaurant.id, 0), /Validation interval must be a number/);
  const ok = await licenseService.changeValidationInterval(restaurant.id, 12);
  assert.equal(ok.validationIntervalHours, 12);
});

test('changeMaxConcurrentCashierSessions and changeSessionTimeoutMinutes reject non-numeric input', async () => {
  const { restaurant } = await createTestRestaurant();
  await assert.rejects(() => licenseService.changeMaxConcurrentCashierSessions(restaurant.id, 'abc'), /Concurrent cashier sessions must be a number/);
  await assert.rejects(() => licenseService.changeSessionTimeoutMinutes(restaurant.id, 'abc'), /Session timeout must be a number/);
});
