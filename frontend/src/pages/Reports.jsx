import { useTranslation } from 'react-i18next';
import { FileText, FileSpreadsheet, Clock, DollarSign, Boxes, TrendingUp, Users, UserCog } from 'lucide-react';
import { openReport } from '../api/client.js';
import { PageHeader, Card } from '../components/ui.jsx';
import { useUI } from '../store/ui.js';

const GROUPS = [
  { title: 'Attendance & Workers', icon: Clock, color: '#3b82f6', reports: [
    ['attendance', 'Attendance & Hours'], ['salary', 'Salary Report'], ['worker-performance', 'Worker Performance'],
  ] },
  { title: 'Financial', icon: DollarSign, color: '#10b981', reports: [
    ['income', 'Income'], ['expenses', 'Expenses'], ['pnl', 'Profit & Loss'],
  ] },
  { title: 'Inventory', icon: Boxes, color: '#06b6d4', reports: [
    ['stock', 'Current Stock'], ['low-stock', 'Low Stock'], ['waste', 'Waste / Loss'],
  ] },
  { title: 'Sales & Customers', icon: TrendingUp, color: '#7c3aed', reports: [
    ['product-performance', 'Product Performance'], ['order-history', 'Order History'], ['customer-spending', 'Customer Spending'],
  ] },
];

export default function Reports() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);

  const get = async (type, ext) => {
    try { await openReport(`/reports/${type}.${ext}`); }
    catch { notify('Report failed', 'error'); }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.reports')} subtitle="Generate PDF & Excel reports for every module" />
      <div className="grid grid--2">
        {GROUPS.map((g) => (
          <Card key={g.title} title={<span className="row" style={{ gap: 10 }}><div style={{ width: 30, height: 30, borderRadius: 9, background: g.color, display: 'grid', placeItems: 'center' }}><g.icon size={16} color="#fff" /></div> {g.title}</span>}>
            {g.reports.map(([type, label]) => (
              <div key={type} className="row between" style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn--sm" onClick={() => get(type, 'pdf')}><FileText size={14} color="var(--danger)" /> PDF</button>
                  <button className="btn btn--sm" onClick={() => get(type, 'xlsx')}><FileSpreadsheet size={14} color="var(--success)" /> Excel</button>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
