let CURRENCY = 'EGP';
let LANG = 'en';
export const setCurrency = (c) => { CURRENCY = c || 'EGP'; };
export const setLang = (l) => { LANG = l || 'en'; };

const locale = () => LANG === 'ar' ? 'ar-SA' : 'en-US';

export const money = (v) =>
  `${Number(v || 0).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY}`;

export const num = (v) => Number(v || 0).toLocaleString(locale());

export const date = (ts) => (ts ? new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const datetime = (ts) => (ts ? new Date(ts).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const time = (ts) => (ts ? new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '—');

export const initials = (name = '') =>
  name.replace(/—.*/, '').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

/** Strip the "English — Arabic" combo to one side for compact display. */
export const shortName = (name = '', lang = 'en') => {
  if (!name.includes('—')) return name;
  const [en, ar] = name.split('—').map((s) => s.trim());
  return lang === 'ar' ? ar || en : en;
};

export const mmss = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
