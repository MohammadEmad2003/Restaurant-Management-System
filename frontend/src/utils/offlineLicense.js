import { api } from '../api/client.js';

let cachedPublicKey = null;

const CLOCK_HIGH_WATER_MARK_KEY = 'lastKnownGoodTime';

/**
 * The signed offline license's `validatedAt`/deadlines are trustworthy (the
 * backend authored them), but comparing them against the device's own
 * `Date.now()` is not: winding the system clock backward would make any
 * elapsed-time check appear smaller than it really is, indefinitely
 * extending offline access without ever reconnecting. A monotonic
 * high-water mark defeats this — once a timestamp has been observed, "now"
 * can never be reported as earlier than that, even if the OS clock is
 * wound back, so a rolled-back clock only ever loses time, never gains it.
 */
function getMonotonicNow() {
  const now = Date.now();
  let last = 0;
  try { last = Number(localStorage.getItem(CLOCK_HIGH_WATER_MARK_KEY)) || 0; } catch { /* localStorage unavailable */ }
  const effective = Math.max(now, last);
  try { localStorage.setItem(CLOCK_HIGH_WATER_MARK_KEY, String(effective)); } catch { /* localStorage unavailable */ }
  return effective;
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const { data } = await api.get('/license/public-key');
  const der = base64ToBytes(data.publicKey);
  cachedPublicKey = await crypto.subtle.importKey(
    'spki',
    der.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return cachedPublicKey;
}

/**
 * Verifies the offline license was actually signed by the backend's private
 * key — not just that its dates look plausible. Verifies against the exact
 * `payload` string the backend signed, never a re-serialized JS object.
 */
export async function verifyOfflineLicenseSignature(license) {
  if (!license?.payload || !license?.signature) return false;
  try {
    const key = await importPublicKey();
    const signatureBytes = base64ToBytes(license.signature);
    const payloadBytes = new TextEncoder().encode(license.payload);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, payloadBytes);
  } catch {
    return false;
  }
}

/**
 * Tiered offline-access decision, matching the rolling-validation spec:
 *  - 'ok'      — within the validation interval, keep the session fully usable.
 *  - 'stale'   — interval lapsed but still within the offline grace period;
 *                the next ONLINE login must re-validate, so block until reconnected.
 *  - 'expired' — the restaurant license's own expiration has passed, OR (if
 *                somehow still before that) the offline grace period itself
 *                has ended; hard logout either way.
 *  - 'blocked' — missing/unsigned/tampered license, or bound to a different
 *                device (e.g. this browser's storage was cloned onto other
 *                hardware) — treat as no offline access at all.
 *
 * `currentFingerprint` is compared against the fingerprint INSIDE the signed
 * `payload` string (never the plain, unsigned copy of the same field that's
 * also spread onto the outer object for convenience) — comparing against the
 * outer copy would be trivially bypassable, since nothing stops a tampered
 * localStorage blob from editing that copy alone while leaving the real
 * signed payload string untouched. The same applies to `expirationDate`
 * below — read from the parsed, signature-verified `payload`, never the
 * unsigned outer copy of the same field.
 */
export async function evaluateOfflineAccess(license, currentFingerprint) {
  if (!license) return { tier: 'blocked', reason: 'No offline license stored' };

  const validSignature = await verifyOfflineLicenseSignature(license);
  if (!validSignature) return { tier: 'blocked', reason: 'Offline license signature is invalid' };

  let payload;
  try {
    payload = JSON.parse(license.payload);
  } catch {
    return { tier: 'blocked', reason: 'Offline license payload is malformed' };
  }

  if (currentFingerprint && payload.fingerprint && payload.fingerprint !== currentFingerprint) {
    return { tier: 'blocked', reason: 'This offline license is bound to a different device' };
  }

  const now = getMonotonicNow();

  // The restaurant license's ACTUAL expiration always wins, independent of
  // the separate offline-grace/validation-interval bookkeeping below (bug
  // regression: this check was missing entirely — a license already past its
  // real expirationDate still reported 'ok' offline as long as the unrelated
  // 7-day offline-grace window and 24h validation interval hadn't lapsed,
  // for BOTH Admin and Cashier, since they share the same restaurant license).
  const licenseExpiration = new Date(payload.expirationDate).getTime();
  if (Number.isNaN(licenseExpiration) || now >= licenseExpiration) {
    return { tier: 'expired', reason: 'The restaurant license has expired' };
  }

  // Hard monthly-online-validation requirement: both Admin and Cashier must
  // complete a successful online login (or any heartbeat while genuinely
  // online — both mint a fresh `monthlyValidationDeadline`) at least once
  // every calendar month, regardless of the restaurant's configured offline
  // grace period. Read from the signed, verified `payload` only — never an
  // unsigned outer copy of the same field, for the same reason as every
  // other field read here (see file-level comment above).
  // Absent entirely only means this cached license predates this check (an
  // app update rolled out while a device was already offline) — treat that
  // as not-yet-applicable rather than an instant lockout; the very next
  // successful login or online heartbeat mints one, same as any other
  // device from then on.
  const monthlyDeadline = payload.monthlyValidationDeadline ? new Date(payload.monthlyValidationDeadline).getTime() : null;
  if (monthlyDeadline !== null && (Number.isNaN(monthlyDeadline) || now >= monthlyDeadline)) {
    return {
      tier: 'expired',
      reason: 'Your license has expired. Please connect to the internet and activate your license to continue using the application.',
    };
  }

  const validatedAt = new Date(license.validatedAt).getTime();
  const offlineExpiration = new Date(license.offlineExpiration).getTime();
  const intervalMs = (license.validationIntervalHours ?? 24) * 60 * 60 * 1000;

  if (Number.isNaN(offlineExpiration) || now >= offlineExpiration) {
    return { tier: 'expired', reason: 'Offline grace period has ended' };
  }
  if (Number.isNaN(validatedAt) || now - validatedAt > intervalMs) {
    return { tier: 'stale', reason: 'Rolling validation window has lapsed — reconnect to continue' };
  }
  return { tier: 'ok' };
}

export default { verifyOfflineLicenseSignature, evaluateOfflineAccess };
