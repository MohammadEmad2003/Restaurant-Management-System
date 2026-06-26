let CURRENCY = 'EGP';
export const setCurrency = (c) => { CURRENCY = c || 'EGP'; };

export const money = (v) =>
  `${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY}`;

export const num = (v) => Number(v || 0).toLocaleString();

export const date = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const datetime = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const time = (ts) => (ts ? new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');

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
