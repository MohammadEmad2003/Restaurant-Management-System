import { secureStore } from '../repositories/secureStore.js';
import { HttpError } from '../middleware/errorHandler.js';
import { getTrustedNow } from '../utils/trustedTime.js';
import { generateActivationToken as generateToken, hashActivationToken } from '../utils/activationToken.js';

const store = secureStore();

/** Coerces + validates a license numeric setting. A plain `value < min` check
 * silently passes for non-numeric input (`NaN < 1` is `false` in JS), which
 * previously let e.g. `offlineDays: "abc"` be stored — then crashed every
 * login for that restaurant with a RangeError the next time an offline
 * license was generated (`new Date().setDate(x + NaN)` → Invalid Date →
 * `.toISOString()` throws), and silently disabled the max-devices/max-
 * concurrent-cashier-sessions caps (`n >= "abc"` is always false). */
function requireFiniteNumber(value, min, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) {
    throw new HttpError(400, `${label} must be a number ${min > 0 ? `of at least ${min}` : 'that is not negative'}`);
  }
  return n;
}

// Note: JWT lifetime is a global setting (config.jwtExpiresInHours), not
// per-restaurant — it intentionally has no entry here. Session timeout and
// validation interval are no longer independently configurable from the
// Super Admin UI (removed per product decision) — they still exist as
// stored fields (the idle-session sweep and the offline-license rolling-
// validation tier both still read them) but always use these fixed
// defaults now, for every restaurant.
const DEFAULTS = {
  maximumDevices: 2,
  validationIntervalHours: 24,
  licenseDays: 30,
  maxConcurrentCashierSessions: 1,
  sessionTimeoutMinutes: 30,
  // How long a freshly issued activation token remains redeemable before it
  // must be reissued — closes the old design's biggest gap (a token that
  // never expired and could be reused indefinitely, see redeemActivationToken).
  activationTokenTtlHours: 72,
};

export function generateActivationToken() {
  return generateToken();
}

// `from` defaults to getTrustedNow() (not `new Date()`) — this backend runs
// embedded on the same machine as the user, so minting an expiration from an
// unguarded local clock is exactly the exploit this closes: wind the OS
// clock forward, activate (which calls this), wind it back — the stored
// expiration would otherwise silently inherit the lie. Every caller below
// (activateLicense, renewLicense, extendLicense, reduceLicenseDuration) now
// goes through this, and the ONLY code path that can actually flip a license
// to 'active' is activateLicense, itself gated by a freshly redeemed token.
export function licenseExpirationDate(days = DEFAULTS.licenseDays, from = new Date(getTrustedNow())) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Sentinel "never expires" date — functionally forever without needing a
 * separate boolean flag threaded through every expiration check in the app;
 * anything comparing against `new Date()` just never trips. Exported so the
 * frontend can recognise it and show "Never Expires" instead of a raw date. */
export const FOREVER_DATE = '9999-12-31T23:59:59.999Z';

export const licenseService = {
  async createLicense(restaurantId, overrides = {}) {
    const days = overrides.days || DEFAULTS.licenseDays;
    const license = await store.create('licenses', {
      restaurantId,
      expirationDate: overrides.expirationDate || licenseExpirationDate(days),
      // Offline access is merged with the license's own duration — a
      // device may work offline for as long as the license itself is
      // valid for, not a separately-configured shorter/longer window.
      offlineDays: days,
      maximumDevices: overrides.maximumDevices ?? DEFAULTS.maximumDevices,
      activeDevices: 0,
      validationIntervalHours: DEFAULTS.validationIntervalHours,
      maxConcurrentCashierSessions: overrides.maxConcurrentCashierSessions ?? DEFAULTS.maxConcurrentCashierSessions,
      sessionTimeoutMinutes: DEFAULTS.sessionTimeoutMinutes,
      status: 'inactive',
    });
    const { token } = await this.issueActivationToken(restaurantId, { ttlHours: overrides.tokenTtlHours, issuedBy: overrides.issuedBy });
    return { license, token };
  },

  async getLicenseByRestaurant(restaurantId) {
    return store.findOne('licenses', { restaurantId });
  },

  async requireLicense(restaurantId) {
    const license = await this.getLicenseByRestaurant(restaurantId);
    if (!license) throw new HttpError(404, 'License not found');
    return license;
  },

  /**
   * Issues a fresh activation token: hashed at rest (never reversible — the
   * plaintext is returned here ONCE and never again, matching how device
   * secrets already work in this codebase), with an expiry, redeemable only
   * once. Replaces the old encrypt()/decrypt() design, which had neither: a
   * regenerated token could be decrypted back to plaintext by anyone with
   * the encryption key, never expired, and could reactivate the same
   * license an unlimited number of times.
   */
  async issueActivationToken(restaurantId, { ttlHours = DEFAULTS.activationTokenTtlHours, issuedBy } = {}) {
    const n = requireFiniteNumber(ttlHours, 1, 'Token TTL (hours)');
    const token = generateActivationToken();
    const nowMs = getTrustedNow();
    const expiresAt = new Date(nowMs + n * 60 * 60 * 1000).toISOString();
    await store.create('activation_tokens', {
      restaurantId,
      tokenHash: hashActivationToken(token),
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt,
      consumedAt: null,
      issuedBy: issuedBy || null,
    });
    return { token, expiresAt };
  },

  /** Status only — never the plaintext, which (unlike the old design) no
   * longer exists anywhere after issuance. Used by the Super Admin UI to
   * show "issued 2h ago, expires in 70h, unused" instead of a raw token. */
  async getActivationTokenStatus(restaurantId) {
    const tokens = await store.findAll('activation_tokens', { restaurantId });
    if (!tokens.length) return null;
    const latest = tokens.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt))[0];
    return {
      issuedAt: latest.issuedAt,
      expiresAt: latest.expiresAt,
      consumed: Boolean(latest.consumedAt),
      consumedAt: latest.consumedAt,
      expired: new Date(latest.expiresAt).getTime() < getTrustedNow(),
    };
  },

  async regenerateActivationToken(restaurantId, opts = {}) {
    const license = await this.requireLicense(restaurantId);
    const { token, expiresAt } = await this.issueActivationToken(restaurantId, opts);
    await store.update('licenses', license.id, { status: 'inactive' });
    return { token, expiresAt, license };
  },

  /**
   * Atomically redeems a token: the `where consumed_at is null and
   * expires_at > now` guard in the same UPDATE means two concurrent
   * activation attempts with the same token can never both succeed (no
   * separate check-then-consume race window), and a token that's valid but
   * past its TTL is rejected with the exact same generic message as a wrong
   * one — no separate "expired" signal an attacker could use to narrow down
   * otherwise-valid-but-late tokens.
   *
   * This method itself is ONLY ever reached when this process legitimately
   * has direct write access to `licenses`/`activation_tokens` — i.e. the
   * central authority (config.isLicenseAuthority) or a test run against a
   * throwaway local store. A packaged desktop install's activation path
   * never calls this directly (see authService.activateRestaurantLicense) —
   * it proxies to the authority over HTTPS instead, which is what actually
   * makes "activation requires the internet" structural rather than
   * advisory. The local-JSON fallback below exists purely so this stays
   * testable without a real Postgres instance; it is not a second
   * activation path a real desktop install can reach.
   */
  async redeemActivationToken(restaurantId, token, { hardwareId } = {}) {
    const tokenHash = hashActivationToken(token);
    const nowMs = getTrustedNow();
    const nowIso = new Date(nowMs).toISOString();
    let consumed = false;
    try {
      const rows = await store.raw(
        `update activation_tokens
            set consumed_at = $1, consumed_by_hardware_id = $2
          where restaurant_id = $3 and token_hash = $4
            and consumed_at is null and expires_at > $1
          returning id`,
        [nowIso, hardwareId || null, restaurantId, tokenHash],
      );
      consumed = rows.length > 0;
    } catch (err) {
      if (err.message !== 'Raw SQL only available when Postgres is reachable') {
        throw new HttpError(503, 'Activation requires an internet connection right now — please reconnect and try again.');
      }
      // No Postgres configured at all for this process (tests, or a
      // deliberately local-only run) — a single-process, single-threaded
      // find-then-update never yields to another request in between, so
      // this is equivalent to the atomic path for that case.
      const candidates = await store.findAll('activation_tokens', { restaurantId, tokenHash });
      const match = candidates.find((t) => !t.consumedAt && new Date(t.expiresAt).getTime() > nowMs);
      if (match) {
        await store.update('activation_tokens', match.id, { consumedAt: nowIso, consumedByHardwareId: hardwareId || null });
        consumed = true;
      }
    }
    if (!consumed) throw new HttpError(400, 'Invalid or expired activation token');
    return true;
  },

  async activateLicense(restaurantId, token, { hardwareId } = {}) {
    const license = await this.requireLicense(restaurantId);
    if (license.status === 'revoked') throw new HttpError(403, 'License has been revoked');
    if (license.status === 'suspended') throw new HttpError(403, 'License is suspended');

    await this.redeemActivationToken(restaurantId, token, { hardwareId });

    // Activation always grants a fresh expiration window from now — this is
    // what lets a restaurant re-activate after its previous period lapsed
    // (super admin issues a fresh token, admin re-enters it here), so the
    // stale/past expirationDate on an 'expired' license must NOT block this;
    // it's exactly the case this method exists to resolve.
    const updated = await store.update('licenses', license.id, {
      status: 'active',
      expirationDate: licenseExpirationDate(),
      updatedAt: Date.now(),
    });
    return updated;
  },

  async renewLicense(restaurantId, days = DEFAULTS.licenseDays) {
    // Now reachable from a free-text Super Admin input (any number of days
    // they want), not just the fixed 30-day default — must reject non-
    // numeric/non-positive input the same way every other numeric license
    // setter does, or e.g. `days: "abc"` reaches `setDate(getDate() + "abc")`
    // → Invalid Date → an uncaught RangeError the next time this license's
    // expirationDate is read anywhere.
    const n = requireFiniteNumber(days, 1, 'Renewal days');
    const license = await this.requireLicense(restaurantId);
    const expirationDate = licenseExpirationDate(n);
    const updated = await store.update('licenses', license.id, {
      expirationDate,
      offlineDays: n, // kept merged with the license's own duration, same as at creation
      status: 'active',
    });
    return { license: updated, expirationDate };
  },

  /** Sets the license to never expire (see FOREVER_DATE) and makes sure it's
   * active. Still a real, revocable/suspendable license — only the
   * expiration check itself is neutralized. */
  async setLicenseForever(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    const updated = await store.update('licenses', license.id, {
      expirationDate: FOREVER_DATE,
      status: 'active',
    });
    return { license: updated, expirationDate: FOREVER_DATE };
  },

  async extendLicense(restaurantId, days) {
    // `!days || days <= 0` silently passes for a non-numeric string like
    // "abc" (`!"abc"` is false, and `"abc" <= 0` coerces to `NaN <= 0` which
    // is also false) — the same NaN-bypass bug already fixed elsewhere via
    // requireFiniteNumber, closed here too now that this is reachable from a
    // free-text Super Admin input.
    const n = requireFiniteNumber(days, 1, 'Extension days');
    const license = await this.requireLicense(restaurantId);
    const current = new Date(license.expirationDate);
    current.setDate(current.getDate() + n);
    const updated = await store.update('licenses', license.id, { expirationDate: current.toISOString() });
    return { license: updated, expirationDate: current.toISOString() };
  },

  async reduceLicenseDuration(restaurantId, days) {
    const n = requireFiniteNumber(days, 1, 'Reduction days');
    const license = await this.requireLicense(restaurantId);
    const current = new Date(license.expirationDate);
    current.setDate(current.getDate() - n);
    const updated = await store.update('licenses', license.id, { expirationDate: current.toISOString() });
    return { license: updated, expirationDate: current.toISOString() };
  },

  async suspendLicense(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { status: 'suspended' });
  },

  async revokeLicense(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { status: 'revoked' });
  },

  async changeMaximumDevices(restaurantId, count) {
    const n = requireFiniteNumber(count, 1, 'Maximum devices');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { maximumDevices: n });
  },

  async changeMaxConcurrentCashierSessions(restaurantId, count) {
    const n = requireFiniteNumber(count, 1, 'Concurrent cashier sessions');
    const license = await this.requireLicense(restaurantId);
    return store.update('licenses', license.id, { maxConcurrentCashierSessions: n });
  },

  async validateLicense(restaurantId) {
    const license = await this.getLicenseByRestaurant(restaurantId);
    if (!license) throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'revoked') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    if (license.status === 'suspended') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    // getTrustedNow() (not `new Date()`) — this backend runs on the same
    // machine as the user, so a plain clock comparison is trivially defeated
    // by winding the OS date backward. See utils/trustedTime.js.
    if (license.status === 'expired' || new Date(license.expirationDate).getTime() < getTrustedNow()) {
      await store.update('licenses', license.id, { status: 'expired' });
      throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    }
    if (license.status !== 'active') throw new HttpError(403, 'Your restaurant subscription has expired. Please contact your administrator.');
    return license;
  },

  async refreshActiveDevices(restaurantId) {
    const license = await this.requireLicense(restaurantId);
    const activeDevices = await store.findAll('devices', { restaurantId, status: 'active' });
    return store.update('licenses', license.id, { activeDevices: activeDevices.length });
  },
};

export default licenseService;
