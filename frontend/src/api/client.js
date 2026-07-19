import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 20000 });

// Attach JWT from storage to every request.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// On 401, clear session and bounce to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.includes('login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.hash.includes('login')) location.hash = '#/login';
    }
    return Promise.reject(err);
  },
);

/** Trigger a browser download/open for a binary endpoint (PDF/Excel). */
export async function openReport(path) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Report failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default api;
