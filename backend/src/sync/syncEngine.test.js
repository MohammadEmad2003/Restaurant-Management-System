import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncEngine } from './syncEngine.js';
import { config } from '../config/index.js';

// Regression: _resolve() only special-cased a LOCAL delete winning; a
// REMOTE tombstone was never checked, so under field-merge policy
// `{...remote, ...local}` overwrote remote's `deleted:true` with local's
// (false/undefined) — silently resurrecting a hard-deleted record whenever
// a device with an older, unsynced edit came back online after someone else
// had deleted that same record.
test('_resolve: a remote tombstone wins over a local (non-delete) edit under field-merge policy', () => {
  const originalPolicy = config.sync.conflictPolicy;
  config.sync.conflictPolicy = 'field-merge';
  try {
    const remote = { id: 'c1', name: 'Old Name', phoneNumbers: ['0100'], _sync: { deleted: true, updatedAt: 2000, version: 2 } };
    const local = { id: 'c1', name: 'Edited Name', phoneNumbers: ['0100', '0200'], _sync: { deleted: false, updatedAt: 1000, version: 1 } };
    const resolved = syncEngine._resolve(local, remote);
    assert.equal(resolved, remote, 'the remote tombstone must win outright, not be merged with the local edit');
    assert.equal(resolved._sync.deleted, true);
  } finally {
    config.sync.conflictPolicy = originalPolicy;
  }
});

test('_resolve: a remote tombstone wins over a local (non-delete) edit under last-write-wins policy too', () => {
  const originalPolicy = config.sync.conflictPolicy;
  config.sync.conflictPolicy = 'last-write-wins';
  try {
    // Even when local is "newer" by timestamp, a delete must not be resurrected.
    const remote = { id: 'c1', _sync: { deleted: true, updatedAt: 1000 } };
    const local = { id: 'c1', _sync: { deleted: false, updatedAt: 2000 } };
    const resolved = syncEngine._resolve(local, remote);
    assert.equal(resolved, remote);
  } finally {
    config.sync.conflictPolicy = originalPolicy;
  }
});

test('_resolve: a local delete still wins over a remote edit (existing behavior, unchanged)', () => {
  const remote = { id: 'c1', name: 'Remote Edit', _sync: { deleted: false, updatedAt: 2000 } };
  const local = { id: 'c1', _sync: { deleted: true, updatedAt: 1000 } };
  const resolved = syncEngine._resolve(local, remote);
  assert.equal(resolved, local);
});

test('_resolve: field-merge still unions arrays and maxes loyaltyPoints for two genuinely live (non-deleted) records', () => {
  const originalPolicy = config.sync.conflictPolicy;
  config.sync.conflictPolicy = 'field-merge';
  try {
    const remote = { id: 'c1', phoneNumbers: ['0100'], addresses: ['Addr A'], loyaltyPoints: 50, _sync: { deleted: false, updatedAt: 1000 } };
    const local = { id: 'c1', phoneNumbers: ['0200'], addresses: ['Addr B'], loyaltyPoints: 30, _sync: { deleted: false, updatedAt: 2000 } };
    const resolved = syncEngine._resolve(local, remote);
    assert.deepEqual(resolved.phoneNumbers.sort(), ['0100', '0200']);
    assert.deepEqual(resolved.addresses.sort(), ['Addr A', 'Addr B']);
    assert.equal(resolved.loyaltyPoints, 50);
  } finally {
    config.sync.conflictPolicy = originalPolicy;
  }
});
