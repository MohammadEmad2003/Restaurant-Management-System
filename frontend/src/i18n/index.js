import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.js';
import ar from './ar.js';

const saved = localStorage.getItem('lang') || 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: saved,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

/** Apply language + direction to <html> (RTL for Arabic). */
export function applyLanguage(lang) {
  i18n.changeLanguage(lang);
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

applyLanguage(saved);

export default i18n;
