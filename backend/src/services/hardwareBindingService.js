import crypto from 'node:crypto';
import { secureStore } from '../repositories/secureStore.js';
import { HttpError } from '../middleware/errorHandler.js';
import { deviceService } from './deviceService.js';
import { logger } from '../utils/logger.js';

const store = secureStore();

/** Labels the client is expected to send — kept as a whitelist so an
 * unexpected/extra key from a future client build can't silently become
 * part of the identity hash in a way older bindings never accounted for. */
const COMPONENT_KEYS = ['board', 'systemUuid', 'disk', 'cpu'];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

/** Per-component hashes — stored (never the raw serials) so a database leak
 * doesn't hand out real hardware identifiers, and so a mismatch can name
 * WHICH component changed (for the Super Admin diagnostic below) without
 * ever needing to store or display the actual serial. */
export function hashComponents(components = {}) {
  const out = {};
  for (const key of COMPONENT_KEYS) out[key] = sha256(components[key]);
  return out;
}

/** Single combined identity — order-independent (sorted keys) so the
 * component object's key order never matters. */
export function computeHardwareId(components = {}) {
  const hashed = hashComponents(components);
  const combined = COMPONENT_KEYS.map((k) => `${k}:${hashed[k]}`).join('|');
  return sha256(combined);
}

/** Component-level labels that differ between two stored hash maps — safe to
 * surface in the Super Admin UI (e.g. ["disk"]) since it never carries the
 * underlying serial, only which category changed. A disk-only diff reads as
 * a routine hardware swap; board+uuid+cpu all differing reads as different
 * hardware entirely. */
function diffLabels(oldHashed, newHashed) {
  return COMPONENT_KEYS.filter((k) => oldHashed[k] !== newHashed[k]);
}

export const hardwareBindingService = {
  /**
   * Called on every activation and every online revalidation. First contact
   * for a device binds it (trust-on-first-use, gated by the fact that
   * reaching this point already required consuming a valid activation
   * token). Every subsequent contact must match EXACTLY — no k-of-n fuzzy
   * matching (product decision: any hardware change requires a Super Admin
   * to approve a reset and issue a fresh activation token, never an
   * automatic re-bind). A mismatch flips the binding to 'pending_reset' and
   * throws, WITHOUT ever silently accepting the new hardware.
   */
  async verifyOrBind({ restaurantId, deviceId, components }) {
    const hardwareId = computeHardwareId(components);
    const hashed = hashComponents(components);
    const existing = await store.findOne('hardware_bindings', { deviceId });

    if (!existing) {
      return store.create('hardware_bindings', {
        restaurantId,
        deviceId,
        hardwareId,
        components: hashed,
        status: 'active',
        boundAt: new Date().toISOString(),
      });
    }

    if (existing.status === 'revoked') {
      throw new HttpError(403, 'This device\'s hardware binding was revoked. Contact your administrator for a new activation token.');
    }
    if (existing.status === 'pending_reset') {
      throw new HttpError(403, 'This device is awaiting Super Admin approval after a detected hardware change. Contact your administrator.');
    }
    if (existing.hardwareId !== hardwareId) {
      const changed = diffLabels(existing.components || {}, hashed);
      await store.update('hardware_bindings', existing.id, { status: 'pending_reset' });
      logger.warn(`Hardware mismatch for device ${deviceId} (restaurant ${restaurantId}) — changed component(s): ${changed.join(', ') || 'unknown'}. Flagged pending_reset; requires Super Admin approval.`);
      const err = new HttpError(409, 'This appears to be different hardware than the one this license was activated on. Contact your administrator to approve a reset.');
      err.hardwareMismatch = { changedComponents: changed };
      throw err;
    }
    return existing;
  },

  async getByDevice(deviceId) {
    return store.findOne('hardware_bindings', { deviceId });
  },

  async listPendingReset(restaurantId) {
    return store.findAll('hardware_bindings', { restaurantId, status: 'pending_reset' });
  },

  /**
   * Super Admin approval flow: revokes the old device (freeing its license
   * slot) and the stale binding. Deliberately does NOT create a new device
   * or re-bind automatically — the customer must re-activate with a freshly
   * issued token (super admin issues one separately), which both confirms a
   * human reviewed the change and reuses the existing, already-audited
   * activation path rather than a second special-cased one.
   */
  async approveReset(restaurantId, deviceId) {
    const binding = await this.getByDevice(deviceId);
    if (!binding || binding.restaurantId !== restaurantId) {
      throw new HttpError(404, 'Hardware binding not found for this device');
    }
    await deviceService.deleteDevice(deviceId, restaurantId);
    await store.update('hardware_bindings', binding.id, { status: 'revoked' });
    return { ok: true };
  },
};

export default hardwareBindingService;
