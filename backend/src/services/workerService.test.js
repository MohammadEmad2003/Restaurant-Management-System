import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerService } from './workerService.js';
import { superAdminService } from './superAdminService.js';
import { orderService } from './orderService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { repo } from '../repositories/index.js';
import { secureStore } from '../repositories/secureStore.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

const store = secureStore();

test('an Admin-created Worker gets NO application login account (security architecture regression)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };
  const worker = await workerService.create(
    { name: 'Kitchen Chef', username: 'chef_no_login', password: 'whatever123', role: 'chef', status: 'active' },
    user,
  );
  assert.equal(worker.appUserId, undefined, 'a plain Admin-created worker must not be linked to any login account');

  const mirroredUser = await store.findOne('users', { username: 'chef_no_login', restaurantId: restaurant.id });
  assert.equal(mirroredUser, null, 'creating a Worker must NEVER create a matching row in the users table — they cannot log in');

  const stored = await repo('workers').getById(worker.id);
  assert.equal(stored.passwordHash, undefined, 'a Worker record must never store a password hash at all — it is not a credential');
});

test('a Super-Admin-created Cashier automatically appears in Workers/Employees, correctly linked, with no duplicate record', async () => {
  const { restaurant } = await createTestRestaurant();
  const cashierUser = await createCashier(restaurant.id, { username: 'auto_linked_cashier' });

  const workers = await repo('workers').getAll({ restaurantId: restaurant.id });
  const linked = workers.filter((w) => w.appUserId === cashierUser.id);
  assert.equal(linked.length, 1, 'exactly one Worker record must be auto-created for the Cashier — never zero, never a duplicate');
  assert.equal(linked[0].username, 'auto_linked_cashier');
  assert.equal(linked[0].role, 'cashier');
  assert.equal(linked[0].status, 'active');
});

test('the Admin can edit a linked Cashier\'s employee fields (salary/phone) but CANNOT change username, password, or role', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const adminActor = { sub: admin.id, restaurantId: restaurant.id };
  const cashierUser = await createCashier(restaurant.id, { username: 'edit_guard_cashier' });
  const linkedWorker = (await repo('workers').getAll({ restaurantId: restaurant.id })).find((w) => w.appUserId === cashierUser.id);

  const updated = await workerService.update(linkedWorker.id, { salary: 7500, phone: '01000000000' }, adminActor);
  assert.equal(updated.salary, 7500, 'employee-side fields must be editable by the Admin');
  assert.equal(updated.phone, '01000000000');

  await assert.rejects(
    () => workerService.update(linkedWorker.id, { username: 'stolen_username' }, adminActor),
    /username.*cannot be changed/i,
  );
  await assert.rejects(
    () => workerService.update(linkedWorker.id, { password: 'hijacked123' }, adminActor),
    /password.*cannot be changed/i,
  );
  await assert.rejects(
    () => workerService.update(linkedWorker.id, { role: 'admin' }, adminActor),
    /role.*cannot be changed/i,
  );

  // Re-submitting the SAME unchanged username/role (as the Workers edit form
  // always does, bundled with a real field change) must NOT be rejected.
  const resubmitted = await workerService.update(linkedWorker.id, { username: linkedWorker.username, role: linkedWorker.role, salary: 8000 }, adminActor);
  assert.equal(resubmitted.salary, 8000, 'resubmitting the same unchanged username/role alongside a real field change must succeed');

  const unchangedUser = await store.findOne('users', { id: cashierUser.id });
  assert.equal(unchangedUser.username, 'edit_guard_cashier', 'the real login account must be completely untouched by any of the above');
  assert.equal(unchangedUser.role, 'CASHIER');
});

test('disable()/reactivate() on a linked Cashier only affects the employee record, never the real login account/session', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const adminActor = { sub: admin.id, restaurantId: restaurant.id };
  const cashierUser = await createCashier(restaurant.id, { username: 'disable_guard_cashier' });
  const linkedWorker = (await repo('workers').getAll({ restaurantId: restaurant.id })).find((w) => w.appUserId === cashierUser.id);

  await workerService.disable(linkedWorker.id, adminActor);
  const disabledWorker = await repo('workers').getById(linkedWorker.id);
  assert.equal(disabledWorker.status, 'inactive');

  const untouchedUser = await store.findOne('users', { id: cashierUser.id });
  assert.equal(untouchedUser.status, 'active', 'the Admin disabling the employee record must not suspend the real account — only the Super Admin can do that');

  await workerService.reactivate(linkedWorker.id, adminActor);
  const reactivatedWorker = await repo('workers').getById(linkedWorker.id);
  assert.equal(reactivatedWorker.status, 'active');
});

test('the Admin cannot remove() a linked Cashier\'s Worker record (would sever the account link)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const adminActor = { sub: admin.id, restaurantId: restaurant.id };
  const cashierUser = await createCashier(restaurant.id, { username: 'remove_guard_cashier' });
  const linkedWorker = (await repo('workers').getAll({ restaurantId: restaurant.id })).find((w) => w.appUserId === cashierUser.id);

  await assert.rejects(() => workerService.remove(linkedWorker.id, adminActor), /cannot be removed here/i);

  const stillThere = await repo('workers').getById(linkedWorker.id);
  assert.ok(stillThere, 'the linked worker record must still exist after the rejected removal attempt');
});

test('Super Admin suspending/reactivating/deleting a Cashier account mirrors status onto the linked Worker record (never the reverse)', async () => {
  const { restaurant } = await createTestRestaurant();
  const cashierUser = await createCashier(restaurant.id, { username: 'mirror_status_cashier' });
  const linkedWorkerId = (await repo('workers').getAll({ restaurantId: restaurant.id })).find((w) => w.appUserId === cashierUser.id).id;

  await superAdminService.suspendRestaurantUser(cashierUser.id);
  assert.equal((await repo('workers').getById(linkedWorkerId)).status, 'inactive');

  await superAdminService.activateRestaurantUser(cashierUser.id);
  assert.equal((await repo('workers').getById(linkedWorkerId)).status, 'active');

  await superAdminService.deleteRestaurantUser(cashierUser.id);
  assert.equal((await repo('workers').getById(linkedWorkerId)).status, 'inactive');
});

test('a Super-Admin-created Cashier\'s real name (not their bare username) shows up as cashierName on orders and shifts', async () => {
  const { restaurant } = await createTestRestaurant();
  const cashierUser = await createCashier(restaurant.id, { username: 'name_bug_cash1' });
  const linkedWorker = (await repo('workers').getAll({ restaurantId: restaurant.id })).find((w) => w.appUserId === cashierUser.id);
  await workerService.update(linkedWorker.id, { name: 'Cashier One' }, { sub: cashierUser.id, restaurantId: restaurant.id });
  await store.update('users', cashierUser.id, { name: 'Cashier One' });

  const cashierActor = { sub: cashierUser.id, restaurantId: restaurant.id };
  const order = await orderService.create({ products: [], walkIn: true }, cashierActor);
  assert.equal(order.cashierName, 'Cashier One', 'orders must show the real name, not the username');

  const shift = await cashierShiftService.open(cashierActor, { openingFloat: 1000 });
  assert.equal(shift.cashierName, 'Cashier One', 'shifts must show the real name, not the username');
});
