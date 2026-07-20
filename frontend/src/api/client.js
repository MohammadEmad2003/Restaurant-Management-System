import axios from 'axios';
import { getFingerprint } from '../utils/fingerprint.js';

export const api = axios.create({ baseURL: '/api', timeout: 20000 });

function getDeviceFingerprint() {
  let fp = localStorage.getItem('deviceFingerprint');
  if (!fp) {
    fp = getFingerprint();
    localStorage.setItem('deviceFingerprint', fp);
  }
  return fp;
}

// Attach JWT and device fingerprint to every request.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  cfg.headers['X-Device-Fingerprint'] = getDeviceFingerprint();
  return cfg;
});

// On 401, clear session and bounce to the appropriate login page.
api.interceptors.response.use(
  (res) => res,
  (err) => {
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
  const res = await fetch(`/api${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Device-Fingerprint': getDeviceFingerprint(),
    },
  });
  if (!res.ok) throw new Error('Report failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default api;
