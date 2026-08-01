import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderService } from './orderService.js';
import { cashierShiftService } from './cashierShiftService.js';
import { repo } from '../repositories/index.js';
import { createTestRestaurant, createCashier } from '../test-helpers/fixtures.js';

test('creating an order with another restaurant\'s clientId is rejected (cross-tenant IDOR regression)', async () => {
  const { restaurant: restaurantA, admin: adminA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();

  const clientB = await repo('clients').create({
    name: 'Restaurant B Client', phoneNumbers: ['0100000000'], totalSpent: 0, loyaltyPoints: 0, visitCount: 0,
    restaurantId: restaurantB.id,
  });

  await assert.rejects(
    () => orderService.create({ clientId: clientB.id, products: [], walkIn: true }, { restaurantId: restaurantA.id, sub: adminA.id }),
    /Invalid client/,
  );

  const unchanged = await repo('clients').getById(clientB.id);
  assert.equal(unchanged.totalSpent, 0);
  assert.equal(unchanged.loyaltyPoints, 0);
});

test('creating an order with your own restaurant\'s clientId succeeds', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const client = await repo('clients').create({
    name: 'Own Client', phoneNumbers: ['0111111111'], totalSpent: 0, loyaltyPoints: 0, visitCount: 0,
    restaurantId: restaurant.id,
  });
  const order = await orderService.create({ clientId: client.id, products: [], walkIn: true }, { restaurantId: restaurant.id, sub: admin.id });
  assert.equal(order.clientName, 'Own Client');
});

test('creating an order with another restaurant\'s deliveryAgentId is rejected (cross-tenant IDOR regression)', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();
  const agentB = await repo('deliveryAgents').create({ name: 'Agent B', active: true, restaurantId: restaurantB.id });

  await assert.rejects(
    () => orderService.create({ products: [], walkIn: false, deliveryAgentId: agentB.id }, { restaurantId: restaurantA.id }),
    /Invalid delivery agent/,
  );
});

test('an order assigned to a delivery agent starts payment-PENDING by default (no paymentTiming given); a normal order stays PAID', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });

  const agentOrder = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agent.id }, { restaurantId: restaurant.id });
  assert.equal(agentOrder.paymentStatus, 'pending');
  assert.equal(agentOrder.paymentTiming, 'END_OF_DAY');
  assert.equal(agentOrder.paidAt, null);
  assert.equal(agentOrder.deliveryAgentName, 'Agent A');

  const normalOrder = await orderService.create({ products: [], walkIn: true }, { restaurantId: restaurant.id });
  assert.equal(normalOrder.paymentStatus, 'paid');
  assert.equal(normalOrder.paymentTiming, null);
});

test('Delivery Agent + Paid Now: paymentStatus=PAID, paidAt set, order does not appear in Pending Payments', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const order = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW' },
    { restaurantId: restaurant.id },
  );
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.paymentTiming, 'PAID_NOW');
  assert.ok(order.paidAt);

  const pending = await orderService.listPendingPayments({}, { restaurantId: restaurant.id });
  assert.ok(!pending.some((o) => o.id === order.id));
});

test('Delivery Agent + End of Day: paymentStatus=PENDING, paidAt null, order appears in Pending Payments', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const order = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id },
  );
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.paidAt, null);

  const pending = await orderService.listPendingPayments({}, { restaurantId: restaurant.id });
  assert.ok(pending.some((o) => o.id === order.id));
});

test('pending payments: single mark-paid and bulk settle-by-agent both work, restaurant-scoped', async () => {
  const { restaurant } = await createTestRestaurant();
  const { restaurant: otherRestaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Bulk Agent', active: true, restaurantId: restaurant.id });
  const otherAgent = await repo('deliveryAgents').create({ name: 'Other Agent', active: true, restaurantId: otherRestaurant.id });

  const o1 = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agent.id }, { restaurantId: restaurant.id });
  const o2 = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agent.id }, { restaurantId: restaurant.id });
  await orderService.create({ products: [], walkIn: false, deliveryAgentId: otherAgent.id }, { restaurantId: otherRestaurant.id });

  const pendingForRestaurant = await orderService.listPendingPayments({}, { restaurantId: restaurant.id });
  assert.equal(pendingForRestaurant.length, 2, 'must not see another restaurant\'s pending orders');

  const single = await orderService.markPaid(o1.id, { restaurantId: restaurant.id });
  assert.equal(single.paymentStatus, 'paid');
  assert.ok(single.paidAt);

  const bulk = await orderService.bulkMarkPaid({ agentId: agent.id }, { restaurantId: restaurant.id });
  assert.equal(bulk.settled, 1, 'only the still-pending order (o2) should be settled by the bulk agent sweep');
  const o2After = await orderService.get(o2.id, { restaurantId: restaurant.id });
  assert.equal(o2After.paymentStatus, 'paid');

  const remaining = await orderService.listPendingPayments({}, { restaurantId: restaurant.id });
  assert.equal(remaining.length, 0);
});

test('double settlement: settling the same order twice is rejected, not silently re-counted', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const order = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agent.id }, { restaurantId: restaurant.id });

  const first = await orderService.markPaid(order.id, { restaurantId: restaurant.id });
  assert.equal(first.paymentStatus, 'paid');
  const firstPaidAt = first.paidAt;

  await assert.rejects(
    () => orderService.markPaid(order.id, { restaurantId: restaurant.id }),
    /already been settled/,
  );

  const after = await orderService.get(order.id, { restaurantId: restaurant.id });
  assert.equal(after.paidAt, firstPaidAt, 'paidAt must not be re-stamped by a rejected second settlement');
});

test('bulk settlement is idempotent: an order already paid before the bulk sweep runs is skipped, not double-settled', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const o1 = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agent.id }, { restaurantId: restaurant.id });
  const o2 = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agent.id }, { restaurantId: restaurant.id });

  // Someone else already settled o1 individually before the bulk sweep runs.
  await orderService.markPaid(o1.id, { restaurantId: restaurant.id });

  const result = await orderService.bulkMarkPaid({ orderIds: [o1.id, o2.id] }, { restaurantId: restaurant.id });
  assert.equal(result.settled, 1, 'only o2 should be newly settled');
  assert.equal(result.skipped, 1, 'o1 must be reported as skipped, not an error');

  const o2After = await orderService.get(o2.id, { restaurantId: restaurant.id });
  assert.equal(o2After.paymentStatus, 'paid');
});

test('markPaid and bulkMarkPaid both reject settling another restaurant\'s order (cross-tenant IDOR regression)', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();
  const agentB = await repo('deliveryAgents').create({ name: 'Agent B', active: true, restaurantId: restaurantB.id });
  const orderB = await orderService.create({ products: [], walkIn: false, deliveryAgentId: agentB.id }, { restaurantId: restaurantB.id });

  await assert.rejects(
    () => orderService.markPaid(orderB.id, { restaurantId: restaurantA.id }),
    /order not found/,
  );

  // A cross-tenant id in an explicit orderIds bulk request is a caller bug or
  // an attack attempt — it must fail loudly (404), not be silently skipped
  // like a legitimately-already-settled order would be.
  await assert.rejects(
    () => orderService.bulkMarkPaid({ orderIds: [orderB.id] }, { restaurantId: restaurantA.id }),
    /order not found/,
  );
  const stillPending = await orderService.get(orderB.id, { restaurantId: restaurantB.id });
  assert.equal(stillPending.paymentStatus, 'pending', 'restaurant A must never be able to settle restaurant B\'s order');
});

test('Delivery Agent + "print receipt only, not paid yet": paymentStatus=PENDING, paymentTiming=UNPAID_PRINTED, paidAt null, order appears in Pending Payments, settling it later works exactly like any other pending order', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });

  const order = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'UNPAID_PRINTED' },
    { restaurantId: restaurant.id },
  );
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.paymentTiming, 'UNPAID_PRINTED', 'must be stored as its own distinct value, not collapsed into END_OF_DAY');
  assert.equal(order.paidAt, null);

  const pending = await orderService.listPendingPayments({}, { restaurantId: restaurant.id });
  assert.ok(pending.some((o) => o.id === order.id));

  const settled = await orderService.markPaid(order.id, { restaurantId: restaurant.id });
  assert.equal(settled.paymentStatus, 'paid');
  assert.ok(settled.paidAt);
  const stillTagged = await orderService.get(order.id, { restaurantId: restaurant.id });
  assert.equal(stillTagged.paymentTiming, 'UNPAID_PRINTED', 'settling must not erase which flow originally created it');
});

test('cashierName is resolved from the actual user record (not left null) when the caller does not pass one explicitly — Created By must be populated for real POS-created orders', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const cashier = await createCashier(restaurant.id, { username: 'created_by_cashier' });
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });

  const order = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id, sub: cashier.id },
  );
  assert.equal(order.cashierName, 'created_by_cashier');

  const adminOrder = await orderService.create({ products: [], walkIn: true }, { restaurantId: restaurant.id, sub: admin.id });
  assert.equal(adminOrder.cashierName, admin.username);
});

test('listPendingPayments dateTo is inclusive of the entire end date, not just its midnight instant (bug regression)', async () => {
  const { restaurant } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const order = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id },
  );
  // Backdate the order to a known point well within "today" but not at midnight.
  const today = new Date().toISOString().slice(0, 10);
  const noon = new Date(`${today}T12:00:00.000Z`).getTime();
  await repo('orders').update(order.id, { orderDate: noon });

  const results = await orderService.listPendingPayments({ dateFrom: today, dateTo: today }, { restaurantId: restaurant.id });
  assert.ok(results.some((o) => o.id === order.id), 'an order placed at noon must be included when dateTo is set to that same day');
});

test('cancelling an already-PAID order reverses its Cash Ledger contribution exactly once (bug regression)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await repo('products').create({ name: 'Burger', category: 'Main', price: 500, active: true, restaurantId: restaurant.id });
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };

  await cashierShiftService.open(user, { openingFloat: 1000 });
  const order = await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
    walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'PAID_NOW', paymentMethod: 'cash',
  }, user);
  assert.equal(order.paymentStatus, 'paid');
  assert.equal((await cashierShiftService.currentAll(user)).total, 1500, 'PAID_NOW added 500 to the drawer');

  await orderService.cancel(order.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'cancelling the paid order must reverse the 500 back out');

  // Cancelling again must be a safe no-op, not a second reversal.
  await orderService.cancel(order.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'cancelling an already-cancelled order must not double-reverse');
});

test('cancelling a still-PENDING order does not touch the Cash Ledger (nothing was ever counted)', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const agent = await repo('deliveryAgents').create({ name: 'Agent A', active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };
  await cashierShiftService.open(user, { openingFloat: 1000 });

  const order = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agent.id, paymentTiming: 'END_OF_DAY' },
    user,
  );
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000);
  await orderService.cancel(order.id, user);
  assert.equal((await cashierShiftService.currentAll(user)).total, 1000, 'cancelling a pending order must not change the balance');
});

test('listPendingPayments agentId filter uses the stable deliveryAgentId, not the display name — correctly disambiguates two agents sharing the same name', async () => {
  const { restaurant } = await createTestRestaurant();
  // Two DIFFERENT agent records that happen to share the exact same name.
  const agentX = await repo('deliveryAgents').create({ name: 'Ahmed', active: true, restaurantId: restaurant.id });
  const agentY = await repo('deliveryAgents').create({ name: 'Ahmed', active: true, restaurantId: restaurant.id });

  const orderX = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agentX.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id },
  );
  const orderY = await orderService.create(
    { products: [], walkIn: false, deliveryAgentId: agentY.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id },
  );

  const resultsForX = await orderService.listPendingPayments({ agentId: agentX.id }, { restaurantId: restaurant.id });
  assert.equal(resultsForX.length, 1, 'filtering by agentX.id must return exactly that agent\'s order, not both same-named agents\' orders');
  assert.equal(resultsForX[0].id, orderX.id);

  const resultsForY = await orderService.listPendingPayments({ agentId: agentY.id }, { restaurantId: restaurant.id });
  assert.equal(resultsForY.length, 1);
  assert.equal(resultsForY[0].id, orderY.id);
});

test('listPendingPayments combines agentId + status + date range + search with AND logic, not OR', async () => {
  const { restaurant } = await createTestRestaurant();
  const agentAhmed = await repo('deliveryAgents').create({ name: 'Ahmed', active: true, restaurantId: restaurant.id });
  const agentMostafa = await repo('deliveryAgents').create({ name: 'Mostafa', active: true, restaurantId: restaurant.id });

  const orderAhmed = await orderService.create(
    { products: [], walkIn: false, clientName: 'Sara Ali', deliveryAgentId: agentAhmed.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id },
  );
  await orderService.create(
    { products: [], walkIn: false, clientName: 'Omar Hassan', deliveryAgentId: agentMostafa.id, paymentTiming: 'END_OF_DAY' },
    { restaurantId: restaurant.id },
  );

  // Search matches Mostafa's order, but the agent filter is Ahmed — AND logic
  // means neither alone is enough, so the result must be empty.
  const crossFiltered = await orderService.listPendingPayments(
    { agentId: agentAhmed.id, q: 'Omar' },
    { restaurantId: restaurant.id },
  );
  assert.equal(crossFiltered.length, 0, 'agentId + search must combine with AND logic, not OR');

  // Now search for something that genuinely matches Ahmed's own order.
  const matched = await orderService.listPendingPayments(
    { agentId: agentAhmed.id, q: 'Sara' },
    { restaurantId: restaurant.id },
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, orderAhmed.id);
});

test('orderService.list supports an inclusive dateTo (an order placed later the same day is not excluded) and a search term matching orderNumber/clientName', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const product = await repo('products').create({ name: 'History Item', category: 'Main', price: 40, active: true, restaurantId: restaurant.id });
  const user = { sub: admin.id, restaurantId: restaurant.id };
  const client = await repo('clients').create({ name: 'Searchable Customer', phoneNumbers: [], restaurantId: restaurant.id });

  const order = await orderService.create({
    products: [{ productId: product.id, quantity: 1, unitPrice: 40 }], walkIn: true, clientId: client.id,
  }, user);

  const today = new Date().toISOString().slice(0, 10);
  const rows = await orderService.list({ dateFrom: today, dateTo: today }, user);
  assert.ok(rows.some((o) => o.id === order.id), 'an order placed today must be included when dateFrom=dateTo=today (inclusive end-of-day)');

  const byNumber = await orderService.list({ q: order.orderNumber }, user);
  assert.ok(byNumber.some((o) => o.id === order.id));

  const byName = await orderService.list({ q: 'Searchable Customer' }, user);
  assert.ok(byName.some((o) => o.id === order.id));

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const excluded = await orderService.list({ dateFrom: yesterday, dateTo: yesterday }, user);
  assert.ok(!excluded.some((o) => o.id === order.id), 'an order placed today must be excluded from a yesterday-only range');
});
