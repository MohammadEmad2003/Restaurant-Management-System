/**
 * Generate a stable device fingerprint from browser characteristics.
 * This is not meant to be unique per hardware, but stable enough per browser
 * profile to detect token reuse on another device.
 */
export function getFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    navigator.hardwareConcurrency || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  return btoa(parts.join('|'));
}

export function getDeviceName() {
  const ua = navigator.userAgent;
  if (/Electron/i.test(ua)) return 'Electron POS';
  if (/Windows/i.test(ua)) return 'Windows Browser';
  if (/Macintosh/i.test(ua)) return 'Mac Browser';
  if (/Linux/i.test(ua)) return 'Linux Browser';
  if (/Android/i.test(ua)) return 'Android Browser';
  if (/iPhone|iPad/i.test(ua)) return 'iOS Browser';
  return 'Browser';
}

export function getOperatingSystem() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS';
  return 'Unknown';
}

export default { getFingerprint, getDeviceName, getOperatingSystem };
