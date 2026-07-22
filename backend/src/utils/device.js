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

/**
 * Coarse device-category classification for the CASHIER desktop/laptop-only
 * restriction. Tablet check must come before the generic mobile check since
 * Android tablets also match /Android/ but (unlike Android phones) omit the
 * "Mobile" token from their User-Agent.
 */
export function classifyDeviceType(ua = '') {
  const s = ua || '';
  if (/iPad/i.test(s) || /Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(s)) return 'mobile';
  return 'desktop';
}

export default { buildFingerprint, normalizeDeviceInfo, classifyDeviceType };
