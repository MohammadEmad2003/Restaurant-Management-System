/**
 * Build a simple device fingerprint from request headers and connection info.
 */
export function buildFingerprint(req) {
  const header = req.headers['x-device-fingerprint'];
  if (header) return header;
  const parts = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.ip || req.socket?.remoteAddress || '',
    req.headers['x-forwarded-for'] || '',
  ];
  return parts.join('|');
}

export function normalizeDeviceInfo(req, { deviceName, operatingSystem } = {}) {
  const ua = req.headers['user-agent'] || 'Unknown';
  return {
    deviceName: deviceName || req.headers['x-device-name'] || 'Unknown Device',
    operatingSystem: operatingSystem || req.headers['x-os'] || parseOS(ua),
  };
}

function parseOS(ua) {
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS';
  return 'Unknown';
}

export default { buildFingerprint, normalizeDeviceInfo };
