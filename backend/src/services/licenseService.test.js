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
