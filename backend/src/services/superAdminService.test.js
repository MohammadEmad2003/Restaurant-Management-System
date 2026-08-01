import { test } from 'node:test';
import assert from 'node:assert/strict';
import { superAdminService } from './superAdminService.js';
import { authService } from './authService.js';
import { sessionService } from './sessionService.js';
import { initSecureStore } from '../repositories/secureStore.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

// Regression: suspending/deleting a restaurant previously left every
// already-issued JWT valid until it naturally expired, since auth() never
// re-checks restaurant status per-request — only session status.
test('suspendRestaurant immediately revokes every active session for that restaurant', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  const { token } = await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-susp-1', userAgent: DESKTOP_UA,
  });
  const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  assert.equal((await sessionService.getByJwtId(decoded.jti)).status, 'active');

  await superAdminService.suspendRestaurant(restaurant.id);
  assert.equal((await sessionService.getByJwtId(decoded.jti)).status, 'revoked');
});

test('deleteRestaurant immediately revokes every active session for that restaurant', async () => {
  const { restaurant, admin, activationToken } = await createTestRestaurant();
  const { token } = await authService.activateRestaurantLicense({
    username: admin.username, password: 'admin12345', token: activationToken, fingerprint: 'fp-del-1', userAgent: DESKTOP_UA,
  });
  const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

  await superAdminService.deleteRestaurant(restaurant.id);
  assert.equal((await sessionService.getByJwtId(decoded.jti)).status, 'revoked');
});

test('restaurant names are unique, case-insensitively and trimmed', async () => {
  await initSecureStore();
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Pizza House ${suffix}`;
  await superAdminService.createRestaurant({ restaurantName: name, adminUsername: `admin_${suffix}`, adminPassword: 'admin12345' });

  await assert.rejects(
    () => superAdminService.createRestaurant({
      restaurantName: `  ${name.toUpperCase()}  `,
      adminUsername: `admin2_${suffix}`,
      adminPassword: 'admin12345',
    }),
    /already exists/,
  );
});

test('a different restaurant name is allowed', async () => {
  await initSecureStore();
  const suffix = Math.random().toString(36).slice(2, 8);
  const a = await superAdminService.createRestaurant({ restaurantName: `Cafe A ${suffix}`, adminUsername: `a_${suffix}`, adminPassword: 'admin12345' });
  const b = await superAdminService.createRestaurant({ restaurantName: `Cafe B ${suffix}`, adminUsername: `b_${suffix}`, adminPassword: 'admin12345' });
  assert.notEqual(a.restaurant.id, b.restaurant.id);
});

test('a username must be unique across every restaurant, not just within one', async () => {
  await initSecureStore();
  const suffix = Math.random().toString(36).slice(2, 8);
  const sameUsername = `shared_${suffix}`;
  const a = await superAdminService.createRestaurant({ restaurantName: `Uniq A ${suffix}`, adminUsername: sameUsername, adminPassword: 'admin12345' });

  // A second restaurant's admin cannot reuse that same username...
  await assert.rejects(
    () => superAdminService.createRestaurant({ restaurantName: `Uniq B ${suffix}`, adminUsername: sameUsername, adminPassword: 'admin12345' }),
    /already taken/,
  );
  // ...nor can it be reused for a Cashier added to a THIRD restaurant.
  const c = await superAdminService.createRestaurant({ restaurantName: `Uniq C ${suffix}`, adminUsername: `c_${suffix}`, adminPassword: 'admin12345' });
  await assert.rejects(
    () => superAdminService.createRestaurantUser(c.restaurant.id, { username: sameUsername, password: 'cashier12345', role: 'CASHIER' }),
    /already taken/,
  );

  // Case/whitespace variations of the same username are rejected too.
  await assert.rejects(
    () => superAdminService.createRestaurantUser(c.restaurant.id, { username: `  ${sameUsername.toUpperCase()}  `, password: 'cashier12345', role: 'CASHIER' }),
    /already taken/,
  );

  // A genuinely different username for that same restaurant still works.
  const cashier = await superAdminService.createRestaurantUser(c.restaurant.id, { username: `unique_${suffix}`, password: 'cashier12345', role: 'CASHIER' });
  assert.ok(cashier.id);

  // Editing an existing user's username to collide with another restaurant's is rejected...
  await assert.rejects(
    () => superAdminService.updateRestaurantUser(cashier.id, { username: sameUsername }),
    /already taken/,
  );
  // ...but re-submitting its own unchanged username is fine (not a "collision" with itself).
  const unchanged = await superAdminService.updateRestaurantUser(cashier.id, { username: `unique_${suffix}`, name: 'Renamed' });
  assert.equal(unchanged.username, `unique_${suffix}`);

  assert.ok(a.admin.id);
});
