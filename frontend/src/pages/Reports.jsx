import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FileSpreadsheet, Clock, DollarSign, Boxes, TrendingUp, Layers, CalendarRange } from 'lucide-react';
import { openReport } from '../api/client.js';
import { PageHeader, Card, DateField } from '../components/ui.jsx';
import { useUI } from '../store/ui.js';

// Every report is delivered as one combined file per category (no scattered per-report downloads).
const BUNDLES = [
  { name: 'workers', label: 'All Workers Reports', icon: Clock, color: '#3b82f6' },
  { name: 'inventory', label: 'All Inventory Reports', icon: Boxes, color: '#06b6d4' },
  { name: 'financial', label: 'All Financial Reports', icon: DollarSign, color: '#10b981' },
  { name: 'sales', label: 'All Sales & Customers Reports', icon: TrendingUp, color: '#7c3aed' },
];

export default function Reports() {
  const { t, i18n } = useTranslation();
  const notify = useUI((s) => s.notify);
  const [period, setPeriod] = useState('monthly');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lang, setLang] = useState(i18n.language === 'ar' ? 'ar' : 'en');
  const [filename, setFilename] = useState('');

  // Append the current period + date range + lang + filename to every report request.
  const qs = () => {
    const p = new URLSearchParams({ period, lang });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (filename.trim()) p.set('filename', filename.trim());
    return p.toString();
  };
  const get = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    try { await openReport(`${path}${sep}${qs()}`); }
    catch { notify(t('reports.failed', 'Report failed'), 'error'); }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.reports')} subtitle={t('reports.subtitle', 'Generate combined PDF & Excel reports for every module')}>
        <div className="chip-row">
          {['daily', 'weekly', 'monthly', 'annual'].map((p) => (
            <button key={p} className={`btn btn--sm ${period === p ? 'btn--primary' : ''}`} onClick={() => setPeriod(p)}>{t(`finance.${p}`, p)}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <CalendarRange size={15} color="var(--muted)" />
          <DateField value={from} onChange={setFrom} placeholder={t('reports.from', 'From')} />
          <span className="muted">→</span>
          <DateField value={to} onChange={setTo} placeholder={t('reports.to', 'To')} />
          {(from || to) && <button className="btn btn--sm" onClick={() => { setFrom(''); setTo(''); }}>{t('reports.clear', 'Clear')}</button>}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>{t('reports.langLabel', 'Report Language')}:</label>
          <select className="input" value={lang} onChange={(e) => setLang(e.target.value)} style={{ padding: '6px 8px', width: 140 }}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <input className="input" type="text" value={filename} onChange={(e) => setFilename(e.target.value)} placeholder={t('reports.filenamePlaceholder', 'Custom filename (optional)')} style={{ padding: '6px 8px', width: 240 }} />
        </div>
      </PageHeader>

      <Card title={<span className="row" style={{ gap: 10 }}><div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--brand-grad)', display: 'grid', placeItems: 'center' }}><Layers size={16} color="#fff" /></div> {t('reports.combined', 'Combined Reports')}</span>}
        sub={t('reports.combinedSub', 'Every report in one file per category, with charts')}>
        {BUNDLES.map(({ name, label, icon: Icon, color }) => (
          <div key={name} className="row between" style={{ padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="row" style={{ gap: 10, fontWeight: 600, fontSize: 13.5 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: color, display: 'grid', placeItems: 'center' }}><Icon size={15} color="#fff" /></div>
              {t(`reports.bundle.${name}`, label)}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--sm" onClick={() => get(`/reports/bundle/${name}.pdf`)}><FileText size={14} color="var(--danger)" /> {t('reports.pdf')}</button>
              <button className="btn btn--sm" onClick={() => get(`/reports/bundle/${name}.xlsx`)}><FileSpreadsheet size={14} color="var(--success)" /> {t('reports.excel')}</button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
