import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireDeviceBound } from './auth.js';
import { deviceService } from '../services/deviceService.js';
import { sessionService } from '../services/sessionService.js';
import { licenseService } from '../services/licenseService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

const FINGERPRINT = 'fp-middleware-test';

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
  const req = {
    user: { sub: admin.id, restaurantId: restaurant.id, role: 'ADMIN', deviceId: device.id, fingerprint: FINGERPRINT, jti: jwtId, type: 'user' },
    headers: { 'user-agent': 'test', 'x-device-fingerprint': FINGERPRINT, 'x-device-secret': device.plainDeviceSecret },
  };
  return { req, device, jwtId, restaurant };
}

test('requireDeviceBound passes through a valid, active session', async () => {
  const { req } = await setup();
  const res = fakeRes();
  let calledNext = false;
  await requireDeviceBound(req, res, () => { calledNext = true; });
  assert.equal(calledNext, true);
  assert.equal(res.statusCode, null);
});

test('requireDeviceBound rejects once the session has been terminated (regression: Force-Logout/Terminate now have teeth)', async () => {
  const { req, jwtId } = await setup();
  await sessionService.terminateSession((await sessionService.getByJwtId(jwtId)).id);
  const res = fakeRes();
  let calledNext = false;
  await requireDeviceBound(req, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
});

test('requireDeviceBound rejects a wrong device secret', async () => {
  const { req } = await setup();
  req.headers['x-device-secret'] = 'not-the-real-secret';
  const res = fakeRes();
  let calledNext = false;
  await requireDeviceBound(req, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /Device secret mismatch/);
});

test('requireDeviceBound rejects once the device has been revoked', async () => {
  const { req, device, restaurant } = await setup();
  await deviceService.deleteDevice(device.id, restaurant.id);
  const res = fakeRes();
  let calledNext = false;
  await requireDeviceBound(req, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
});
