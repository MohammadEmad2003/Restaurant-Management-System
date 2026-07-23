import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientService } from './clientService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

test('creating a client with a phone that already exists in the same restaurant returns the existing record instead of a duplicate', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id, sub: admin.id };
  const first = await clientService.create({ name: 'Ahmed', phoneNumbers: ['010 1234 5678'] }, user);
  const second = await clientService.create({ name: 'Ahmed Again', phoneNumbers: ['01012345678'] }, user);
  assert.equal(second.id, first.id, 'digits-equivalent phone must resolve to the same existing customer');
  assert.equal(second.name, 'Ahmed', 'the existing record is returned unchanged, not overwritten');
});

test('the same phone number is allowed to exist in two different restaurants', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();
  const a = await clientService.create({ name: 'Client A', phoneNumbers: ['0100000001'] }, { restaurantId: restaurantA.id });
  const b = await clientService.create({ name: 'Client B', phoneNumbers: ['0100000001'] }, { restaurantId: restaurantB.id });
  assert.notEqual(a.id, b.id);
});

test('lookupByPhone finds a client by phone within the caller\'s restaurant, restaurant-scoped', async () => {
  const { restaurant: restaurantA } = await createTestRestaurant();
  const { restaurant: restaurantB } = await createTestRestaurant();
  await clientService.create({ name: 'Findable', phoneNumbers: ['0122223333'] }, { restaurantId: restaurantA.id });
  const foundInA = await clientService.lookupByPhone('0122223333', { restaurantId: restaurantA.id });
  assert.ok(foundInA);
  assert.equal(foundInA.name, 'Findable');
  const foundInB = await clientService.lookupByPhone('0122223333', { restaurantId: restaurantB.id });
  assert.equal(foundInB, null, 'must never leak another restaurant\'s customer');
});

test('a soft-deleted client no longer appears in list/search/lookup, but its id remains valid for order history', async () => {
  const { restaurant } = await createTestRestaurant();
  const user = { restaurantId: restaurant.id };
  const client = await clientService.create({ name: 'Deleted Guy', phoneNumbers: ['0133334444'] }, user);
  await clientService.remove(client.id, user);

  const list = await clientService.list({}, user);
  assert.ok(!list.some((c) => c.id === client.id));

  const found = await clientService.lookupByPhone('0133334444', user);
  assert.equal(found, null);

  // A brand-new customer may now reuse that same phone number.
  const replacement = await clientService.create({ name: 'New Guy', phoneNumbers: ['0133334444'] }, user);
  assert.notEqual(replacement.id, client.id);
});
