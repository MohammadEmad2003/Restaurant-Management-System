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
  // False until the very first checkOfflineAccess() call resolves after
  // mount. AppShell must not render any protected content while this is
  // false — offlineStatus starts `null`, which is not itself a blocking
  // tier, so without this flag the dashboard (and its own data-fetching
  // child page) would render for at least one frame — and fire real API
  // calls — before the async signature/expiration check ever completes.
  offlineStatusChecked: false,

  /** Re-evaluates the rolling-validation window against the signed offline
   * license — called when connectivity drops, once per app session on
   * mount, once a day thereafter regardless of connectivity state, and
   * right after heartbeat() refreshes the cached offline license (see
   * AppShell), so a device that simply stays offline for a long stretch
   * without ever toggling still gets checked, and a background license
   * refresh is reflected immediately rather than up to a day later. Does
   * NOT log out on 'expired' — AppShell blocks the whole app for
   * 'stale'/'blocked'/'expired' via OfflineBlock instead, and only actually
   * logs out once the device is genuinely back online, forcing a real
   * reactivation (a fresh login while connected) rather than a silent
   * local-only re-login that never actually required reconnecting. */
  async checkOfflineAccess() {
    if (!get().token) return;
    const status = await evaluateOfflineAccess(get().offlineLicense, getFingerprint());
    set({ offlineStatus: status, offlineStatusChecked: true });
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
        // A fresh login just had its license validated server-side (and, on
        // an expired/inactive one, would have returned requiresActivation
        // above instead of a token at all) — safe to mark it as already
        // checked so AppShell doesn't show a redundant loading state right
        // after a successful login.
        set({
          user: data.user,
          token: data.token,
          loading: false,
          offlineLicense: data.offlineLicense,
          offlineStatus: null,
          offlineStatusChecked: true,
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
        offlineStatusChecked: true,
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
        // Without this, a background heartbeat refresh silently updates
        // offlineLicense but nothing re-evaluates offlineStatus against it
        // until the next daily check or connectivity transition — up to a
        // full day where a license that just became expired (or whose
        // signature only became valid again after a restart) wouldn't be
        // reflected in the UI.
        await get().checkOfflineAccess();
      }
    } catch { /* next heartbeat retries; logout is handled by the 401 interceptor */ }
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('deviceSecret');
    localStorage.removeItem('offlineLicense');
    set({ user: null, token: null, requiresActivation: false, pendingCredentials: null, offlineLicense: null, offlineStatus: null, offlineStatusChecked: false });
  },

  can: (action) => {
    const perms = get().user?.permissions || [];
    return perms.includes('*') || perms.includes(action);
  },
}));

export default useAuth;
