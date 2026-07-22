import { api } from '../api/client.js';

let cachedPublicKey = null;

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
 *  - 'expired' — offline grace period itself has ended; hard logout.
 *  - 'blocked' — missing/unsigned/tampered license; treat as no offline access at all.
 */
export async function evaluateOfflineAccess(license) {
  if (!license) return { tier: 'blocked', reason: 'No offline license stored' };

  const validSignature = await verifyOfflineLicenseSignature(license);
  if (!validSignature) return { tier: 'blocked', reason: 'Offline license signature is invalid' };

  const now = Date.now();
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
