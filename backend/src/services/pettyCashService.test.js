import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pettyCashService } from './pettyCashService.js';
import { cashLedgerService } from './cashLedgerService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

test('creating a petty cash expense deducts exactly that amount from the Cash Drawer balance', async () => {
  const { restaurant, admin } = await createTestRestaurant();
  const user = { sub: admin.id, restaurantId: restaurant.id };

  const entry = await pettyCashService.create({ type: 'petty_cash', amount: 150, description: 'Cleaning supplies' }, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), -150);

  // Editing the amount adjusts the ledger by the delta, not the full new amount.
  await pettyCashService.update(entry.id, { amount: 200 }, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), -200);

  // Deleting reverses whatever it had contributed.
  await pettyCashService.remove(entry.id, user);
  assert.equal(await cashLedgerService.balance(restaurant.id), 0);
});
