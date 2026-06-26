import { create } from 'zustand';
import { api } from '../api/client.js';

const stored = (() => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
})();

export const useAuth = create((set, get) => ({
  user: stored,
  token: localStorage.getItem('token'),
  loading: false,
  error: null,

  async login(username, password) {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, token: data.token, loading: false });
      return true;
    } catch (e) {
      set({ loading: false, error: e.response?.data?.error || 'Login failed' });
      return false;
    }
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, token: null });
  },

  isAdmin: () => get().user?.role === 'admin',
  can: (action) => {
    const perms = get().user?.permissions || [];
    return perms.includes('*') || perms.includes(action);
  },
}));

export default useAuth;
