import { create } from 'zustand';
import { applyLanguage } from '../i18n/index.js';

// localStorage can throw on access (Safari "Block all cookies", some
// kiosk/embedded WebViews, a full storage quota) — this runs at module load,
// before React ever renders, so an uncaught throw here would crash the whole
// app with a white screen and nothing to catch it.
function safeGet(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable — theme/lang just won't persist */ }
}

const initTheme = safeGet('theme', 'light');
document.documentElement.setAttribute('data-theme', initTheme);

export const useUI = create((set, get) => ({
  lang: safeGet('lang', 'en'),
  theme: initTheme,
  sidebarOpen: true,
  toast: null,
  confirmReq: null, // { title, message, confirmLabel, cancelLabel, danger, resolve }

  confirm(opts = {}) {
    return new Promise((resolve) => {
      set({ confirmReq: { title: '', message: '', danger: false, ...opts, resolve } });
    });
  },
  _resolveConfirm(result) {
    const req = get().confirmReq;
    if (req) req.resolve(result);
    set({ confirmReq: null });
  },

  setLang(lang) {
    applyLanguage(lang);
    set({ lang });
  },
  toggleLang() {
    get().setLang(get().lang === 'en' ? 'ar' : 'en');
  },
  toggleTheme() {
    const theme = get().theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    safeSet('theme', theme);
    set({ theme });
  },
  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen });
  },
  notify(message, kind = 'success') {
    const id = Date.now();
    set({ toast: { message, kind, id } });
    // Only clear the toast if it's still THIS call's toast — otherwise a
    // second notify() within 3s of the first gets its own toast blanked out
    // early by the first call's un-scoped timer (every previous call to
    // notify scheduled an unconditional `set({toast:null})` with no
    // reference to which toast it belonged to).
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3000);
  },
}));

export default useUI;
