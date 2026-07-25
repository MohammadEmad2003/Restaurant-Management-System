import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashierShiftService } from './cashierShiftService.js';
import { orderService } from './orderService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

async function makeProduct(restaurantId, price) {
  return repo('products').create({ name: 'Test Item', category: 'Main', price, active: true, restaurantId });
}

test('Pending Amount: an END_OF_DAY delivery-agent order does not increase the cash drawer; settling it increases the drawer by exactly that amount', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 500);
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const shift = await cashierShiftService.open(user, { openingFloat: 1000 });
  const before = await cashierShiftService.current(user);
  assert.equal(before.expectedCash, 1000);

  const order = await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY',
    cashierId: admin.id, paymentMethod: 'cash',
  }, user);
  assert.equal(order.paymentStatus, 'pending');

  const stillPending = await cashierShiftService.current(user);
  assert.equal(stillPending.expectedCash, 1000, 'a PENDING delivery-agent order must NOT be counted as received cash');

  await orderService.markPaid(order.id, user);
  const afterSettlement = await cashierShiftService.current(user);
  assert.equal(afterSettlement.expectedCash, 1500, 'once settled, the drawer increases by exactly the order total');

  // Refreshing again must not double-count — the drawer is recomputed live
  // from order state each time, so it must stay stable.
  const refreshed = await cashierShiftService.current(user);
  assert.equal(refreshed.expectedCash, 1500);
});

test('opening a shift COMPARES the counted float against the Cash Drawer balance instead of adding it — matching count leaves the balance untouched, a mismatch records only the difference', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  // Simulate cash already sitting in the drawer from something unrelated to
  // any shift (e.g. a prior sale) — the ledger balance is 300 before anyone
  // opens a shift at all.
  await cashLedgerService.record({ restaurantId: restaurant.id, amount: 300, transactionType: 'CASH_SALE', createdByUserId: admin.id });
  assert.equal(await cashLedgerService.balance(restaurant.id), 300);

  // Cashier counts exactly what the ledger already expects — opening must
  // NOT add another 300 on top of it.
  const shift1 = await cashierShiftService.open(user, { openingFloat: 300 });
  assert.equal(shift1.openingDifference, 0);
  assert.equal(await cashLedgerService.balance(restaurant.id), 300, 'a matching count must leave the Cash Drawer balance unchanged, not double it');
  // Keep the cash in the till (not deposited to the owner) so the balance
  // carries forward, the same as a real cashier reopening later.
  await cashierShiftService.close(shift1.id, user, { countedCash: 300, depositedToOwner: false });

  // Cashier counts MORE than the ledger expects (a real overage) — only the
  // +50 difference should be recorded, not the full 350.
  const shift2 = await cashierShiftService.open(user, { openingFloat: 350 });
  assert.equal(shift2.openingDifference, 50);
  assert.equal(await cashLedgerService.balance(restaurant.id), 350);
  await cashierShiftService.close(shift2.id, user, { countedCash: 350, depositedToOwner: false });

  // Cashier counts LESS than the ledger expects (a real shortage) — the
  // balance should drop by exactly that shortfall, recorded as a negative
  // adjustment, not silently ignored or added as if it were a positive float.
  const shift3 = await cashierShiftService.open(user, { openingFloat: 100 });
  assert.equal(shift3.openingDifference, -250);
  assert.equal(await cashLedgerService.balance(restaurant.id), 100);
});

test('Delivery Agent + Paid Now increases the cash drawer immediately (money already received at order creation)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 250);
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };

  await cashierShiftService.open(user, { openingFloat: 0 });
  await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 250 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW',
    cashierId: admin.id, paymentMethod: 'cash',
  }, user);

  const shift = await cashierShiftService.current(user);
  assert.equal(shift.expectedCash, 250);
});

test('attempting to settle an already-settled order does not inflate the cash drawer a second time', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 300);
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };

  await cashierShiftService.open(user, { openingFloat: 0 });
  const order = await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 300 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY',
    cashierId: admin.id, paymentMethod: 'cash',
  }, user);

  await orderService.markPaid(order.id, user);
  assert.equal((await cashierShiftService.current(user)).expectedCash, 300);

  await assert.rejects(() => orderService.markPaid(order.id, user));
  assert.equal((await cashierShiftService.current(user)).expectedCash, 300, 'must remain 300, never 600');
});

test('Cash Drawer Multi-Restaurant Isolation: currentAll never mixes another restaurant\'s cash', async () => {
  const { restaurant: restaurantA, admin: adminA } = await createTestRestaurant();
  const { restaurant: restaurantB, admin: adminB } = await createTestRestaurant();
  const userA = { sub: adminA.id, restaurantId: restaurantA.id };
  const userB = { sub: adminB.id, restaurantId: restaurantB.id };

  await cashierShiftService.open(userA, { openingFloat: 1000 });
  await cashierShiftService.open(userB, { openingFloat: 9000 });

  const allA = await cashierShiftService.currentAll(userA);
  const allB = await cashierShiftService.currentAll(userB);
  assert.equal(allA.total, 1000);
  assert.equal(allB.total, 9000);
});

test('Restaurant Cash Ledger: settling a pending payment counts toward the Restaurant-wide balance even when the settling cashier has NO active shift of their own', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 500);
  const agent = await repo('deliveryAgents').create({ name: 'Ahmed', active: true, restaurantId: restaurant.id });
  const cashierA = await createCashier(restaurant.id, { username: 'cashier_a_ledger' });
  const cashierB = await createCashier(restaurant.id, { username: 'cashier_b_ledger' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userA = { sub: cashierA.id, restaurantId: restaurant.id };
  const userB = { sub: cashierB.id, restaurantId: restaurant.id };

  // Initial balance: Cashier A has an active shift with a 1000 float.
  await cashierShiftService.open(userA, { openingFloat: 1000 });
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1000);

  // Cashier A: PAID_NOW order = 500 EGP.
  await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW',
    cashierId: cashierA.id, paymentMethod: 'cash',
  }, userA);
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1500, 'PAID_NOW must land in the ledger immediately');

  // Cashier A: END_OF_DAY order = 500 EGP — pending, must not move the balance.
  const pendingOrder = await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY',
    cashierId: cashierA.id, paymentMethod: 'cash',
  }, userA);
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1500, 'a PENDING order must not touch the ledger');
  const pending = await orderService.listPendingPayments({}, adminUser);
  assert.equal(pending.reduce((s, o) => s + o.totalPrice, 0), 500);

  // Cashier A logs out (conceptually — nothing to assert server-side, no session state here).
  // Cashier B logs in with NO active shift of their own and settles the pending payment.
  assert.equal(await cashierShiftService.current(userB), null, 'Cashier B must have no active shift');
  await orderService.markPaid(pendingOrder.id, userB);

  const finalTotal = (await cashierShiftService.currentAll(adminUser)).total;
  assert.equal(finalTotal, 2000, 'the settlement must be recorded in the Restaurant Cash Ledger and reflected immediately, even though the settling cashier has no open shift');
  const remainingPending = await orderService.listPendingPayments({}, adminUser);
  assert.equal(remainingPending.length, 0);
});

test('Restaurant Cash Ledger: a normal cash order with no cashier shift open at all still increases the Restaurant-wide balance', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 200);
  const cashier = await createCashier(restaurant.id, { username: 'shiftless_cashier' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userC = { sub: cashier.id, restaurantId: restaurant.id };

  assert.equal(await cashierShiftService.current(userC), null);
  await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 200 }],
    walkIn: true, cashierId: cashier.id, paymentMethod: 'cash',
  }, userC);

  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 200, 'a valid cash sale must count even with no active shift');
});

test('Closing a shift WITHOUT depositing to the owner must NOT remove real cash from the Restaurant Cash Ledger (it is a logical logout, not a cash movement)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await makeProduct(restaurant.id, 500);
  const agent = await repo('deliveryAgents').create({ name: 'Ahmed', active: true, restaurantId: restaurant.id });
  const cashierA = await createCashier(restaurant.id, { username: 'close_no_deposit_a' });
  const cashierB = await createCashier(restaurant.id, { username: 'close_no_deposit_b' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userA = { sub: cashierA.id, restaurantId: restaurant.id };
  const userB = { sub: cashierB.id, restaurantId: restaurant.id };

  // 1. Cashier A opens shift with 1000.
  const shiftA = await cashierShiftService.open(userA, { openingFloat: 1000 });
  // 2. Cashier A receives 500 PAID_NOW.
  await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW',
    cashierId: cashierA.id, paymentMethod: 'cash',
  }, userA);
  // 3. Restaurant Cash Drawer = 1500.
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1500);

  // 4. Cashier A closes/logs out WITHOUT depositing to the owner — the 1500
  // physically stays in the till.
  await cashierShiftService.close(shiftA.id, userA, { countedCash: 1500, depositedToOwner: false });
  // 7. Restaurant Cash Drawer should still be 1500 — closing must not zero it out.
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1500, 'a mere logout/handover must not remove cash that never left the drawer');

  // 5/6. Cashier B logs in with NO shift of her own.
  assert.equal(await cashierShiftService.current(userB), null);

  // 8. Cashier B receives another 500 (no shift required for it to count).
  await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW',
    cashierId: cashierB.id, paymentMethod: 'cash',
  }, userB);

  // 9. Restaurant Cash Drawer = 2000.
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 2000);
});

test('Closing a shift WITH depositedToOwner=true DOES remove that cash from the Restaurant Cash Ledger, since it physically leaves the drawer', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashier = await createCashier(restaurant.id, { username: 'deposit_to_owner_cashier' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const user = { sub: cashier.id, restaurantId: restaurant.id };

  const shift = await cashierShiftService.open(user, { openingFloat: 1000 });
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1000);

  await cashierShiftService.close(shift.id, user, { countedCash: 1000, depositedToOwner: true });
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 0, 'cash actually handed to the owner must leave the Restaurant balance');
});

test('A handover reopen (next cashier opening with the handed-over float) does not double-count the same physical cash', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashierA = await createCashier(restaurant.id, { username: 'handover_a' });
  const cashierB = await createCashier(restaurant.id, { username: 'handover_b' });
  const adminUser = { sub: admin.id, restaurantId: restaurant.id };
  const userA = { sub: cashierA.id, restaurantId: restaurant.id };
  const userB = { sub: cashierB.id, restaurantId: restaurant.id };

  // close()'s nextCashierId handover validates against the legacy `workers`
  // collection (a separate, pre-existing tracking table from `users`) — seed
  // a matching worker record so the handover validation resolves.
  await repo('workers').create({ id: cashierB.id, name: 'Handover B', username: cashierB.username, role: 'cashier' });

  const shiftA = await cashierShiftService.open(userA, { openingFloat: 1000 });
  await cashierShiftService.close(shiftA.id, userA, { countedCash: 1000, depositedToOwner: false, nextCashierId: cashierB.id });
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1000, 'still 1000 right after the handover close');

  // Cashier B opens with the SAME 1000 that was just handed over — must not become 2000.
  await cashierShiftService.open(userB, { openingFloat: 1000 });
  assert.equal((await cashierShiftService.currentAll(adminUser)).total, 1000, 'the handed-over float must not be re-added on top of the already-counted cash');
});
