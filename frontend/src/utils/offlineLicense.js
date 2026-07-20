/**
 * Lightweight offline license expiration check. This is client-side UX only;
 * the backend is the authority and re-validates on every online request.
 */
export function validateOfflineLicense(license) {
  if (!license) return { valid: false, reason: 'No offline license stored' };
  if (!license.offlineExpiration || !license.expirationDate) {
    return { valid: false, reason: 'Invalid offline license format' };
  }
  const now = new Date();
  if (new Date(license.offlineExpiration) < now) {
    return { valid: false, reason: 'Offline license has expired' };
  }
  if (new Date(license.expirationDate) < now) {
    return { valid: false, reason: 'Restaurant license has expired' };
  }
  return { valid: true };
}

export default { validateOfflineLicense };
