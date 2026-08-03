import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireActiveLicense } from './auth.js';
import { deviceService } from '../services/deviceService.js';
import { sessionService } from '../services/sessionService.js';
import { licenseService } from '../services/licenseService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

const FINGERPRINT = 'fp-license-middleware-test';

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function setup() {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const device = await deviceService.registerDevice({ restaurantId: restaurant.id, userId: admin.id, fingerprint: FINGERPRINT });
  const jwtId = `jti-${Math.random().toString(36).slice(2)}`;
  await sessionService.createSession({ jwtId, userId: admin.id, userType: 'user', role: 'ADMIN', restaurantId: restaurant.id, deviceId: device.id });
  const req = { user: { sub: admin.id, restaurantId: restaurant.id, role: 'ADMIN', deviceId: device.id, fingerprint: FINGERPRINT, jti: jwtId, type: 'user' } };
  return { req, restaurant };
}

// This is THE core regression this middleware exists to close: previously,
// license validity was only ever checked at LOGIN (authService.
// loginRestaurantUser) — never on any request afterward. A JWT/session/
// device issued while the license was still valid kept working on every
// subsequent request indefinitely (up to the JWT's own natural expiry),
// with zero server-side re-check, even after the restaurant's license
// expired. Simulates exactly that: log in successfully first (license
// valid), THEN let the license expire, THEN prove the very next request
// with that SAME already-issued session is rejected.
test('requireActiveLicense rejects an already-logged-in session the moment the license expires (core regression)', async () => {
  const { req, restaurant } = await setup();
  const res1 = fakeRes();
  let calledNext = false;
  await requireActiveLicense(req, res1, () => { calledNext = true; });
  assert.equal(calledNext, true, 'must pass through while the license is still valid');

  // The license expires (super-admin action, or natural date passing) —
  // the SAME already-issued session/JWT is reused for the next request.
  await licenseService.reduceLicenseDuration(restaurant.id, 365);

  calledNext = false;
  const res2 = fakeRes();
  await requireActiveLicense(req, res2, () => { calledNext = true; });
  assert.equal(calledNext, false, 'an already-logged-in session must be rejected on its very next request once the license has expired');
  assert.equal(res2.statusCode, 403);
  assert.match(res2.body.error, /subscription has expired/);
});

test('requireActiveLicense rejects once the license has been revoked, even mid-session', async () => {
  const { req, restaurant } = await setup();
  await licenseService.revokeLicense(restaurant.id);
  const res = fakeRes();
  let calledNext = false;
  await requireActiveLicense(req, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
});

test('requireActiveLicense rejects once the license has been suspended, even mid-session', async () => {
  const { req, restaurant } = await setup();
  await licenseService.suspendLicense(restaurant.id);
  const res = fakeRes();
  let calledNext = false;
  await requireActiveLicense(req, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
});

test('requireActiveLicense passes through super_admin tokens unconditionally (no restaurant/license context)', async () => {
  const req = { user: { sub: 'sa-1', type: 'super_admin' } };
  const res = fakeRes();
  let calledNext = false;
  await requireActiveLicense(req, res, () => { calledNext = true; });
  assert.equal(calledNext, true);
});
