import { create } from 'zustand';
import { api } from '../api/client.js';
import { getFingerprint, getDeviceName, getOperatingSystem } from '../utils/fingerprint.js';

const stored = (() => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
})();

export const useAuth = create((set, get) => ({
  user: stored,
  token: localStorage.getItem('token'),
  loading: false,
  error: null,
  requiresActivation: false,
  pendingCredentials: null,
  offlineLicense: null,

  async login(username, password) {
    set({ loading: true, error: null, requiresActivation: false });
    try {
      const fingerprint = getFingerprint();
      const { data } = await api.post('/auth/login', {
        username,
        password,
        fingerprint,
        deviceName: getDeviceName(),
        operatingSystem: getOperatingSystem(),
      });

      if (data.requiresActivation) {
        set({
          loading: false,
          requiresActivation: true,
          pendingCredentials: { username, password },
          user: data.user,
        });
        return { requiresActivation: true };
      }

      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (data.offlineLicense) {
          localStorage.setItem('offlineLicense', JSON.stringify(data.offlineLicense));
        }
        set({
          user: data.user,
          token: data.token,
          loading: false,
          offlineLicense: data.offlineLicense,
        });
      }
      return { success: true };
    } catch (e) {
      set({ loading: false, error: e.response?.data?.error || 'Login failed' });
      return { success: false };
    }
  },

  async activateLicense(token) {
    set({ loading: true, error: null });
    const creds = get().pendingCredentials;
    if (!creds) {
      set({ loading: false, error: 'No pending credentials' });
      return false;
    }
    try {
      const fingerprint = getFingerprint();
      const { data } = await api.post('/license/activate', {
        username: creds.username,
        password: creds.password,
        token,
        fingerprint,
        deviceName: getDeviceName(),
        operatingSystem: getOperatingSystem(),
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.offlineLicense) {
        localStorage.setItem('offlineLicense', JSON.stringify(data.offlineLicense));
      }
      set({
        user: data.user,
        token: data.token,
        loading: false,
        requiresActivation: false,
        pendingCredentials: null,
        offlineLicense: data.offlineLicense,
      });
      return true;
    } catch (e) {
      set({ loading: false, error: e.response?.data?.error || 'Activation failed' });
      return false;
    }
  },

  async loginSuperAdmin(username, password) {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post('/auth/login/superadmin', { username, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, token: data.token, loading: false });
      return true;
    } catch (e) {
      set({ loading: false, error: e.response?.data?.error || 'Super admin login failed' });
      return false;
    }
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('offlineLicense');
    set({ user: null, token: null, requiresActivation: false, pendingCredentials: null, offlineLicense: null });
  },

  can: (action) => {
    const perms = get().user?.permissions || [];
    return perms.includes('*') || perms.includes(action);
  },
}));

export default useAuth;
