import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardwareBindingService, computeHardwareId } from './hardwareBindingService.js';
import { deviceService } from './deviceService.js';
import { licenseService } from './licenseService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

const HW_A = { board: 'BOARD-1', systemUuid: 'UUID-1', disk: 'DISK-1', cpu: 'CPU-1' };
const HW_B = { board: 'BOARD-2', systemUuid: 'UUID-2', disk: 'DISK-2', cpu: 'CPU-2' };

async function makeActivatedDevice() {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  await licenseService.activateLicense(restaurant.id, activationToken);
  const device = await deviceService.registerDevice({
    restaurantId: restaurant.id, userId: admin.id, fingerprint: `fp-${Math.random()}`,
  });
  return { restaurant, device };
}

test('first contact binds the device to its hardware identity', async () => {
  const { restaurant, device } = await makeActivatedDevice();
  const binding = await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });
  assert.equal(binding.status, 'active');
  assert.equal(binding.deviceId, device.id);
});

test('repeat contact with the SAME hardware succeeds silently', async () => {
  const { restaurant, device } = await makeActivatedDevice();
  await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });
  const second = await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });
  assert.equal(second.status, 'active');
});

// Per product decision, matching is EXACT — no k-of-n fuzzy tolerance. A
// mismatch must be reported, never silently re-bound to the new hardware.
test('a mismatch is rejected (never silently re-bound) and flags the binding pending_reset', async () => {
  const { restaurant, device } = await makeActivatedDevice();
  await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });

  await assert.rejects(
    () => hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_B }),
    /different hardware/,
  );

  const binding = await hardwareBindingService.getByDevice(device.id);
  assert.equal(binding.status, 'pending_reset');
  // The stored hardware identity must NOT have changed to the new one.
  const stillOriginal = await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A }).catch((e) => e);
  assert.ok(stillOriginal instanceof Error, 'even the ORIGINAL hardware must now be rejected — pending_reset blocks all contact until a Super Admin approves');
});

test('a mismatch reports WHICH components changed, without ever exposing the raw serials', async () => {
  const { restaurant, device } = await makeActivatedDevice();
  await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });

  const onlyDiskChanged = { ...HW_A, disk: 'DISK-REPLACED' };
  try {
    await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: onlyDiskChanged });
    assert.fail('expected a mismatch to be rejected');
  } catch (err) {
    assert.deepEqual(err.hardwareMismatch.changedComponents, ['disk']);
    assert.equal(err.message.includes('DISK'), false, 'must never leak the raw serial in the error message');
  }
});

test('approveReset revokes the device and its binding, letting a fresh activation bind clean hardware', async () => {
  const { restaurant, device } = await makeActivatedDevice();
  await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });
  await assert.rejects(() => hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_B }));

  await hardwareBindingService.approveReset(restaurant.id, device.id);

  const revokedDevice = await deviceService.getDevice(device.id);
  assert.equal(revokedDevice.status, 'revoked');
  const revokedBinding = await hardwareBindingService.getByDevice(device.id);
  assert.equal(revokedBinding.status, 'revoked');

  // A brand-new device (fresh activation, as a real re-activation would
  // produce) can bind cleanly afterward — the old revoked binding must not
  // block it.
  const newDevice = await deviceService.registerDevice({
    restaurantId: restaurant.id, userId: (await deviceService.getDevice(device.id)).userId, fingerprint: `fp-${Math.random()}`,
  });
  const freshBinding = await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: newDevice.id, components: HW_B });
  assert.equal(freshBinding.status, 'active');
});

test('listPendingReset surfaces exactly the bindings awaiting Super Admin approval', async () => {
  const { restaurant, device } = await makeActivatedDevice();
  await hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_A });
  assert.equal((await hardwareBindingService.listPendingReset(restaurant.id)).length, 0);

  await assert.rejects(() => hardwareBindingService.verifyOrBind({ restaurantId: restaurant.id, deviceId: device.id, components: HW_B }));
  const pending = await hardwareBindingService.listPendingReset(restaurant.id);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].deviceId, device.id);
});

test('computeHardwareId is order-independent and changes when any single component changes', () => {
  const a = computeHardwareId({ board: '1', systemUuid: '2', disk: '3', cpu: '4' });
  const shuffled = computeHardwareId({ cpu: '4', board: '1', disk: '3', systemUuid: '2' });
  assert.equal(a, shuffled);
  const changed = computeHardwareId({ board: '1', systemUuid: '2', disk: 'DIFFERENT', cpu: '4' });
  assert.notEqual(a, changed);
});
