import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mirrors backend/src/utils/offlineLicenseCrypto.js exactly: EC P-256,
// IEEE-P1363 (raw r‖s) signature encoding — the format browser Web Crypto's
// ECDSA verify expects, not Node's DER default.
let keys;
function sign(payloadString) {
  return crypto.sign('sha256', Buffer.from(payloadString, 'utf8'), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
}
function publicKeyBase64() {
  return keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

const apiGet = vi.fn();
vi.mock('../api/client.js', () => ({
  api: { get: (...args) => apiGet(...args) },
  default: { get: (...args) => apiGet(...args) },
}));

let evaluateOfflineAccess;
let verifyOfflineLicenseSignature;

beforeAll(async () => {
  keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  apiGet.mockResolvedValue({ data: { publicKey: publicKeyBase64() } });
  ({ evaluateOfflineAccess, verifyOfflineLicenseSignature } = await import('./offlineLicense.js'));
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DEVICE_A = 'fingerprint-device-a';
const DEVICE_B = 'fingerprint-device-b';

// The monotonic clock guard persists its high-water mark in localStorage
// across calls (by design — that's the whole point), so each test needs a
// clean slate or an earlier test's timestamps would leak into later ones.
beforeEach(() => {
  localStorage.clear();
});

function makeLicense({
  fingerprint = DEVICE_A,
  validatedAt = Date.now(),
  offlineExpiration = Date.now() + 30 * 24 * HOUR,
  validationIntervalHours = 24,
  monthlyValidationDeadline,
  tamperSignature = false,
  tamperPayload = false,
} = {}) {
  const payload = {
    restaurantId: 'REST-1',
    licenseId: 'LIC-1',
    deviceId: 'DEV-1',
    fingerprint,
    expirationDate: new Date(Date.now() + 60 * 24 * HOUR).toISOString(),
    validatedAt: new Date(validatedAt).toISOString(),
    validationIntervalHours,
    offlineExpiration: new Date(offlineExpiration).toISOString(),
    ...(monthlyValidationDeadline !== undefined ? { monthlyValidationDeadline: new Date(monthlyValidationDeadline).toISOString() } : {}),
  };
  const payloadString = JSON.stringify(payload);
  let signature = sign(payloadString);
  if (tamperSignature) signature = Buffer.from('not-a-real-signature').toString('base64');
  return {
    ...payload,
    payload: tamperPayload ? payloadString.replace('REST-1', 'REST-EVIL') : payloadString,
    signature,
  };
}

describe('verifyOfflineLicenseSignature', () => {
  it('accepts a genuinely signed payload', async () => {
    expect(await verifyOfflineLicenseSignature(makeLicense())).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    expect(await verifyOfflineLicenseSignature(makeLicense({ tamperSignature: true }))).toBe(false);
  });

  it('rejects a payload edited after signing (signature no longer matches)', async () => {
    expect(await verifyOfflineLicenseSignature(makeLicense({ tamperPayload: true }))).toBe(false);
  });

  it('rejects a missing license', async () => {
    expect(await verifyOfflineLicenseSignature(null)).toBe(false);
  });
});

describe('evaluateOfflineAccess — tiered offline-access policy', () => {
  it('returns "blocked" when there is no stored license at all', async () => {
    expect((await evaluateOfflineAccess(null, DEVICE_A)).tier).toBe('blocked');
  });

  it('returns "blocked" for a tampered/invalid signature, regardless of otherwise-valid dates', async () => {
    const license = makeLicense({ tamperSignature: true });
    expect((await evaluateOfflineAccess(license, DEVICE_A)).tier).toBe('blocked');
  });

  it('returns "ok" within the validation interval on the SAME device', async () => {
    const license = makeLicense({ validatedAt: Date.now() - 1 * HOUR, validationIntervalHours: 24 });
    expect((await evaluateOfflineAccess(license, DEVICE_A)).tier).toBe('ok');
  });

  it('returns "blocked" when the CURRENT device fingerprint does not match the signed license (bug regression — device binding was never checked before)', async () => {
    const license = makeLicense({ fingerprint: DEVICE_A, validatedAt: Date.now() - 1 * HOUR });
    const result = await evaluateOfflineAccess(license, DEVICE_B);
    expect(result.tier).toBe('blocked');
    expect(result.reason).toMatch(/different device/i);
  });

  it('is NOT fooled by editing the OUTER unsigned fingerprint copy to match the current device — only the signed payload string is trusted', async () => {
    const license = makeLicense({ fingerprint: DEVICE_A, validatedAt: Date.now() - 1 * HOUR });
    // Simulate a tampered localStorage blob: outer convenience copy edited,
    // inner signed `payload` string (what the signature actually covers)
    // left untouched — the check must still fail.
    const spoofed = { ...license, fingerprint: DEVICE_B };
    const result = await evaluateOfflineAccess(spoofed, DEVICE_B);
    expect(result.tier).toBe('blocked');
  });

  it('returns "stale" once the validation interval has lapsed but the offline grace period has not', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 30 * HOUR,
      validationIntervalHours: 24,
      offlineExpiration: Date.now() + 30 * 24 * HOUR,
    });
    const result = await evaluateOfflineAccess(license, DEVICE_A);
    expect(result.tier).toBe('stale');
  });

  it('returns "expired" once the offline grace period itself has ended', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 100 * 24 * HOUR,
      offlineExpiration: Date.now() - 1 * HOUR,
    });
    const result = await evaluateOfflineAccess(license, DEVICE_A);
    expect(result.tier).toBe('expired');
  });

  it('"expired" takes priority over "stale" when both conditions are true', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 100 * 24 * HOUR,
      validationIntervalHours: 1,
      offlineExpiration: Date.now() - 1 * HOUR,
    });
    const result = await evaluateOfflineAccess(license, DEVICE_A);
    expect(result.tier).toBe('expired');
  });

  it('returns "expired" with the exact required message once the monthly online-validation deadline has passed', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 1 * HOUR,
      monthlyValidationDeadline: Date.now() - 1 * HOUR, // deadline already in the past
    });
    const result = await evaluateOfflineAccess(license, DEVICE_A);
    expect(result.tier).toBe('expired');
    expect(result.reason).toBe('Your license has expired. Please connect to the internet and activate your license to continue using the application.');
  });

  it('stays "ok" while within the monthly deadline, even close to it', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 1 * HOUR,
      monthlyValidationDeadline: Date.now() + 1 * HOUR,
    });
    expect((await evaluateOfflineAccess(license, DEVICE_A)).tier).toBe('ok');
  });

  it('a cached license with no monthlyValidationDeadline at all (predates this check) is not instantly locked out', async () => {
    const license = makeLicense({ validatedAt: Date.now() - 1 * HOUR }); // no monthlyValidationDeadline key
    expect((await evaluateOfflineAccess(license, DEVICE_A)).tier).toBe('ok');
  });

  it('the monthly deadline enforces even if offlineDays/validationInterval would otherwise still allow "ok"', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 1 * HOUR,
      offlineExpiration: Date.now() + 365 * DAY, // very generous offline grace
      validationIntervalHours: 24 * 365, // very generous rolling interval
      monthlyValidationDeadline: Date.now() - 1 * HOUR, // but the hard monthly cap has passed
    });
    const result = await evaluateOfflineAccess(license, DEVICE_A);
    expect(result.tier).toBe('expired');
    expect(result.reason).toMatch(/license has expired/i);
  });

  it('cannot be bypassed by winding the system clock backward after the monthly deadline has already been observed as passed (anti clock-tamper regression)', async () => {
    const license = makeLicense({
      validatedAt: Date.now() - 40 * DAY,
      monthlyValidationDeadline: Date.now() - 10 * DAY, // already 10 days overdue
    });
    // First check, at the real current time: correctly expired.
    expect((await evaluateOfflineAccess(license, DEVICE_A)).tier).toBe('expired');

    // Attacker rolls the OS clock back 20 days to make the deadline look
    // like it hasn't arrived yet.
    const originalNow = Date.now;
    Date.now = () => originalNow() - 20 * DAY;
    try {
      const result = await evaluateOfflineAccess(license, DEVICE_A);
      expect(result.tier).toBe('expired');
    } finally {
      Date.now = originalNow;
    }
  });

  it('a license genuinely valid for 2026-01-01 → 2026-12-31, activated once, keeps working offline on day 1, day 30, and day 100 (no forced daily re-validation)', async () => {
    const activatedAt = new Date('2026-01-01T00:00:00Z').getTime();
    const license = makeLicense({
      validatedAt: activatedAt,
      validationIntervalHours: 24 * 365, // one validation covers the whole license year, matching "don't force daily online checks"
      offlineExpiration: new Date('2026-12-31T23:59:59Z').getTime(),
    });
    for (const daysLater of [1, 30, 100]) {
      const originalNow = Date.now;
      Date.now = () => activatedAt + daysLater * 24 * HOUR;
      try {
        const result = await evaluateOfflineAccess(license, DEVICE_A);
        expect(result.tier).toBe('ok');
      } finally {
        Date.now = originalNow;
      }
    }
  });
});
