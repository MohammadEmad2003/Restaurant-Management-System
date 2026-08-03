import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * A monotonic, persisted "high-water mark" for the backend's own clock —
 * the server-side equivalent of the same defense already implemented on the
 * frontend (frontend/src/utils/offlineLicense.js's getMonotonicNow()).
 *
 * This backend runs embedded on the SAME machine as the end user (see
 * electron/main.js) — there is no separate, trusted "server" whose clock the
 * user can't touch. Every license-expiration check that compares against
 * `new Date()` is otherwise trivially defeated by opening the OS date/time
 * settings and winding the clock backward, which is explicitly one of the
 * required test scenarios for this audit. Persisting the highest timestamp
 * ever observed — and refusing to ever report an earlier one — means a
 * rolled-back clock can only ever cost the user time, never gain them any.
 *
 * Advanced two ways:
 *  - Passively, on every call, from the process's own Date.now() (so normal
 *    forward-moving time is never held back).
 *  - Authoritatively, via `noteTrustedRemoteTime()`, whenever the backend
 *    genuinely reaches Postgres — an authoritative timestamp the user does
 *    not control, which can jump the high-water mark forward past a clock
 *    that was rolled back before this install was last online.
 */
const HWM_FILE = () => path.join(config.dataDir, '.trusted-time-hwm.json');

let _memoryHwm = 0;
let _loadedFromDisk = false;
let _lastPersisted = 0;
const PERSIST_THROTTLE_MS = 60000; // avoid a disk write on every single call

function loadFromDisk() {
  if (_loadedFromDisk) return;
  _loadedFromDisk = true;
  try {
    const file = HWM_FILE();
    if (fs.existsSync(file)) {
      const { hwm } = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isFinite(hwm)) _memoryHwm = hwm;
    }
  } catch (err) {
    logger.warn(`Trusted-time high-water mark file is unreadable/corrupt (${err.message}) — starting from the current clock instead.`);
  }
}

function persist(hwm) {
  const now = Date.now();
  if (now - _lastPersisted < PERSIST_THROTTLE_MS) return;
  _lastPersisted = now;
  try {
    const file = HWM_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hwm }));
  } catch (err) {
    logger.warn(`Could not persist the trusted-time high-water mark (${err.message}) — clock-rollback protection will not survive a restart until this is writable.`);
  }
}

/** The current time, guaranteed never to be reported earlier than any
 * timestamp this installation has already observed (including across
 * restarts, once persisted). Use this — never plain `Date.now()`/`new
 * Date()` — for every license-expiration comparison. */
export function getTrustedNow() {
  loadFromDisk();
  const now = Date.now();
  _memoryHwm = Math.max(_memoryHwm, now);
  persist(_memoryHwm);
  return _memoryHwm;
}

/** Call whenever a timestamp is obtained from a source the user does not
 * control (e.g. `select extract(epoch from now())` against Postgres while
 * genuinely online) — advances the high-water mark authoritatively, which
 * can jump it past a clock that was already rolled back before this
 * install's last genuine online contact. */
export function noteTrustedRemoteTime(remoteMs) {
  if (!Number.isFinite(remoteMs)) return;
  loadFromDisk();
  if (remoteMs > _memoryHwm) {
    _memoryHwm = remoteMs;
    persist(_memoryHwm);
  }
}

export default { getTrustedNow, noteTrustedRemoteTime };
