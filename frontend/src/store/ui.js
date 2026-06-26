import { create } from 'zustand';
import { applyLanguage } from '../i18n/index.js';

const initTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', initTheme);

export const useUI = create((set, get) => ({
  lang: localStorage.getItem('lang') || 'en',
  theme: initTheme,
  sidebarOpen: true,
  toast: null,

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
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen });
  },
  notify(message, kind = 'success') {
    set({ toast: { message, kind, id: Date.now() } });
    setTimeout(() => set({ toast: null }), 3000);
  },
}));

export default useUI;
