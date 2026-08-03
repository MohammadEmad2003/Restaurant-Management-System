import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrustedNow, noteTrustedRemoteTime } from './trustedTime.js';

// This backend runs embedded on the SAME machine as the end user (see
// electron/main.js) — there is no separate, trusted server whose clock the
// user can't touch. Every license-expiration check compares against "now",
// so if that "now" is just `Date.now()`, winding the OS clock backward
// (Settings → Date & Time) trivially defeats it. getTrustedNow() must never
// report a time earlier than one it has already observed.
test('getTrustedNow never reports a time earlier than one already observed (clock-rollback regression)', () => {
  const forward = getTrustedNow();
  assert.ok(forward > 0);

  const originalNow = Date.now;
  try {
    // Simulate winding the system clock back a year.
    Date.now = () => forward - 365 * 24 * 60 * 60 * 1000;
    const afterRollback = getTrustedNow();
    assert.ok(afterRollback >= forward, 'must not report a time earlier than the already-observed high-water mark');
  } finally {
    Date.now = originalNow;
  }
});

test('noteTrustedRemoteTime advances the high-water mark past a rolled-back local clock', () => {
  const originalNow = Date.now;
  try {
    const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000; // 10 years from now
    noteTrustedRemoteTime(farFuture);
    // Even if the local clock now claims to be "before" that remote
    // timestamp, getTrustedNow() must not fall back below it.
    Date.now = () => farFuture - 24 * 60 * 60 * 1000; // one day "before" the remote time
    assert.ok(getTrustedNow() >= farFuture, 'an authoritative remote timestamp must not be undone by a lower local clock reading');
  } finally {
    Date.now = originalNow;
  }
});

test('noteTrustedRemoteTime ignores a non-finite/garbage value', () => {
  const before = getTrustedNow();
  noteTrustedRemoteTime(NaN);
  noteTrustedRemoteTime(undefined);
  noteTrustedRemoteTime('not-a-number');
  assert.ok(getTrustedNow() >= before, 'garbage input must not corrupt the high-water mark');
});
