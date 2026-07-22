import axios from 'axios';
import { getFingerprint } from '../utils/fingerprint.js';
import { markOnline, markOffline } from '../store/connectivity.js';

export const api = axios.create({ baseURL: '/api', timeout: 20000 });

function getDeviceFingerprint() {
  let fp = localStorage.getItem('deviceFingerprint');
  if (!fp) {
    fp = getFingerprint();
    localStorage.setItem('deviceFingerprint', fp);
  }
  return fp;
}

// Attach JWT, device fingerprint, and (once issued) the server-signed device
// secret to every request — the secret is what actually binds a session to
// this device; the fingerprint alone is client-computed and replayable.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  cfg.headers['X-Device-Fingerprint'] = getDeviceFingerprint();
  const deviceSecret = localStorage.getItem('deviceSecret');
  if (deviceSecret) cfg.headers['X-Device-Secret'] = deviceSecret;
  return cfg;
});

// On 401, clear session and bounce to the appropriate login page. Also
// corroborates navigator.onLine (unreliable alone) with real request
// outcomes — a machine can report "online" while the local backend is
// unreachable, which is exactly the case offline-license access exists for.
api.interceptors.response.use(
  (res) => {
    markOnline();
    return res;
  },
  (err) => {
    // No response at all (timeout/connection-refused/DNS failure) means the
    // backend itself is unreachable — a real 4xx/5xx means it IS reachable.
    if (!err.response) markOffline();
    else markOnline();

    if (err.response?.status === 401 && !location.pathname.includes('login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const isSuperAdminRoute = location.hash.includes('superadmin');
      if (!location.hash.includes('login')) {
        location.hash = isSuperAdminRoute ? '#/superadmin/login' : '#/login';
      }
    }
    return Promise.reject(err);
  },
);

/** Trigger a browser download/open for a binary endpoint (PDF/Excel). */
export async function openReport(path) {
  const token = localStorage.getItem('token');
  const deviceSecret = localStorage.getItem('deviceSecret');
  const res = await fetch(`/api${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Device-Fingerprint': getDeviceFingerprint(),
      ...(deviceSecret ? { 'X-Device-Secret': deviceSecret } : {}),
    },
  });
  if (!res.ok) throw new Error('Report failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default api;
