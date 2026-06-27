import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FileSpreadsheet, Clock, DollarSign, Boxes, TrendingUp, Layers, CalendarRange } from 'lucide-react';
import { openReport } from '../api/client.js';
import { PageHeader, Card } from '../components/ui.jsx';
import { useUI } from '../store/ui.js';

const GROUPS = [
  { title: 'Attendance & Workers', icon: Clock, color: '#3b82f6', reports: [
    ['attendance', 'Attendance & Hours'], ['salary', 'Salary Report'], ['worker-performance', 'Worker Performance'],
  ] },
  { title: 'Financial', icon: DollarSign, color: '#10b981', reports: [
    ['income', 'Income'], ['expenses', 'Expenses'], ['pnl', 'Profit & Loss'], ['sales-by-location', 'Sales by Location'],
  ] },
  { title: 'Inventory', icon: Boxes, color: '#06b6d4', reports: [
    ['stock', 'Current Stock'], ['low-stock', 'Low Stock'], ['waste', 'Waste / Loss'], ['purchases', 'Purchase History'],
  ] },
  { title: 'Sales & Customers', icon: TrendingUp, color: '#7c3aed', reports: [
    ['product-performance', 'Product Performance'], ['order-history', 'Order History'],
    ['customer-spending', 'Customer Spending'], ['loyalty', 'Loyalty Points'], ['reservations', 'Reservations'],
  ] },
];

// Combined multi-section files.
const BUNDLES = [
  ['workers', 'All Workers Reports'],
  ['inventory', 'All Inventory Reports'],
];

export default function Reports() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const [period, setPeriod] = useState('monthly');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Append the current period + date range to every report request.
  const qs = () => {
    const p = new URLSearchParams({ period });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  };
  const get = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    try { await openReport(`${path}${sep}${qs()}`); }
    catch { notify(t('reports.failed', 'Report failed'), 'error'); }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.reports')} subtitle={t('reports.subtitle', 'Generate PDF & Excel reports for every module')}>
        <div className="chip-row">
          {['daily', 'weekly', 'monthly', 'annual'].map((p) => (
            <button key={p} className={`btn btn--sm ${period === p ? 'btn--primary' : ''}`} onClick={() => setPeriod(p)}>{t(`finance.${p}`, p)}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <CalendarRange size={15} color="var(--muted)" />
          <input className="input ltr" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t('reports.from', 'From')} style={{ padding: '6px 8px' }} />
          <span className="muted">→</span>
          <input className="input ltr" type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t('reports.to', 'To')} style={{ padding: '6px 8px' }} />
          {(from || to) && <button className="btn btn--sm" onClick={() => { setFrom(''); setTo(''); }}>{t('reports.clear', 'Clear')}</button>}
        </div>
      </PageHeader>

      <Card title={<span className="row" style={{ gap: 10 }}><div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--brand-grad)', display: 'grid', placeItems: 'center' }}><Layers size={16} color="#fff" /></div> {t('reports.combined', 'Combined Reports')}</span>}
        sub={t('reports.combinedSub', 'Every report in one file, with charts')} style={{ marginBottom: 18 }}>
        {BUNDLES.map(([name, label]) => (
          <div key={name} className="row between" style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t(`reports.bundle.${name}`, label)}</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--sm" onClick={() => get(`/reports/bundle/${name}.pdf`)}><FileText size={14} color="var(--danger)" /> PDF</button>
              <button className="btn btn--sm" onClick={() => get(`/reports/bundle/${name}.xlsx`)}><FileSpreadsheet size={14} color="var(--success)" /> Excel</button>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid grid--2">
        {GROUPS.map((g) => (
          <Card key={g.title} title={<span className="row" style={{ gap: 10 }}><div style={{ width: 30, height: 30, borderRadius: 9, background: g.color, display: 'grid', placeItems: 'center' }}><g.icon size={16} color="#fff" /></div> {t(`reports.group.${g.title}`, g.title)}</span>}>
            {g.reports.map(([type, label]) => (
              <div key={type} className="row between" style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t(`reports.type.${type}`, label)}</span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn--sm" onClick={() => get(`/reports/${type}.pdf`)}><FileText size={14} color="var(--danger)" /> PDF</button>
                  <button className="btn btn--sm" onClick={() => get(`/reports/${type}.xlsx`)}><FileSpreadsheet size={14} color="var(--success)" /> Excel</button>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
