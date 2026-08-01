import { create } from 'zustand';
import { api } from '../api/client.js';
import { getFingerprint, getDeviceName, getOperatingSystem } from '../utils/fingerprint.js';
import { evaluateOfflineAccess } from '../utils/offlineLicense.js';

const stored = (() => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
})();
const storedOfflineLicense = (() => {
  try { return JSON.parse(localStorage.getItem('offlineLicense')); } catch { return null; }
})();

export const useAuth = create((set, get) => ({
  user: stored,
  token: localStorage.getItem('token'),
  loading: false,
  error: null,
  requiresActivation: false,
  pendingCredentials: null,
  offlineLicense: storedOfflineLicense,
  offlineStatus: null, // { tier: 'ok'|'stale'|'expired'|'blocked', reason }

  /** Re-evaluates the rolling-validation window against the signed offline
   * license — called when connectivity drops, once per app session on
   * mount, and once a day thereafter regardless of connectivity state (see
   * AppShell), so a device that simply stays offline for a long stretch
   * without ever toggling still gets checked. Does NOT log out on 'expired'
   * — AppShell blocks the whole app for 'stale'/'blocked'/'expired' via
   * OfflineBlock instead, and only actually logs out once the device is
   * genuinely back online, forcing a real reactivation (a fresh login while
   * connected) rather than a silent local-only re-login that never actually
   * required reconnecting. */
  async checkOfflineAccess() {
    if (!get().token) return;
    const status = await evaluateOfflineAccess(get().offlineLicense, getFingerprint());
    set({ offlineStatus: status });
  },

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
        if (data.deviceSecret) localStorage.setItem('deviceSecret', data.deviceSecret);
        if (data.offlineLicense) {
          localStorage.setItem('offlineLicense', JSON.stringify(data.offlineLicense));
        }
        set({
          user: data.user,
          token: data.token,
          loading: false,
          offlineLicense: data.offlineLicense,
          offlineStatus: null,
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
      if (data.deviceSecret) localStorage.setItem('deviceSecret', data.deviceSecret);
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
        offlineStatus: null,
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

  async heartbeat() {
    if (!get().token) return;
    try {
      const { data } = await api.post('/auth/heartbeat');
      if (data?.offlineLicense) {
        localStorage.setItem('offlineLicense', JSON.stringify(data.offlineLicense));
        set({ offlineLicense: data.offlineLicense });
      }
    } catch { /* next heartbeat retries; logout is handled by the 401 interceptor */ }
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('deviceSecret');
    localStorage.removeItem('offlineLicense');
    set({ user: null, token: null, requiresActivation: false, pendingCredentials: null, offlineLicense: null, offlineStatus: null });
  },

  can: (action) => {
    const perms = get().user?.permissions || [];
    return perms.includes('*') || perms.includes(action);
  },
}));

export default useAuth;
