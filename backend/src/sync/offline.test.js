import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../utils/withTimeout.js';
import { connectivity } from './connectivity.js';

const hang = () => new Promise(() => {}); // never resolves — simulates dead network
const slow = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

test('withTimeout rejects a hanging call so no-wifi fails over fast (does not wait on gRPC)', async () => {
  const started = Date.now();
  await assert.rejects(() => withTimeout(hang(), 100, 'probe'), /timed out after 100ms/);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `expected fast failover, took ${elapsed}ms`);
});

test('withTimeout resolves normally when the call completes in time', async () => {
  const value = await withTimeout(slow(10, 'ok'), 200, 'probe');
  assert.equal(value, 'ok');
});

test('the offline-read pattern returns local data within the timeout when the remote is dead', async () => {
  const localData = [{ id: 'WRK-1', name: 'Local Worker' }];
  const readTimeoutMs = 150;

  // Mirrors repositories/index.js getAll(): try the (dead) remote, then fall back.
  async function getAllWithFailover() {
    try {
      return await withTimeout(hang(), readTimeoutMs, 'workers.getAll');
    } catch {
      return localData; // local store
    }
  }

  const started = Date.now();
  const rows = await getAllWithFailover();
  const elapsed = Date.now() - started;
  assert.deepEqual(rows, localData);
  assert.ok(elapsed < readTimeoutMs + 100, `failover too slow: ${elapsed}ms`);
});

test('connectivity.goOffline() flips state to offline and notifies listeners', () => {
  connectivity.online = true; // pretend we were online
  let notified = null;
  const off = connectivity.onChange((online) => { notified = online; });

  connectivity.goOffline('test drop');

  assert.equal(connectivity.isOnline, false);
  assert.equal(notified, false);
  off();
  connectivity._clearRetry(); // don't leave a probe timer running in the test
});
