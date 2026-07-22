import crypto from 'node:crypto';

/** A high-entropy random value issued once per device registration/re-registration. */
export function generateDeviceSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Fast hash, not bcrypt — this is a 256-bit random value, not a guessable
 * human password, so bcrypt's deliberate slowness would only add cost to a
 * check that now runs on every device-bound request.
 */
export function hashDeviceSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function validateDeviceSecret(device, providedSecret) {
  // No hash stored yet (legacy device, pre-migration) — tolerate until its next login issues one.
  if (!device.deviceSecretHash) return true;
  if (!providedSecret) return false;
  return hashDeviceSecret(providedSecret) === device.deviceSecretHash;
}

export default { generateDeviceSecret, hashDeviceSecret, validateDeviceSecret };
