import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Building2 } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { Card, PageHeader, Spinner, DataTable, Badge } from '../components/ui.jsx';
import { money, shortName } from '../utils/format.js';
import { useUI } from '../store/ui.js';

export default function Branches() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { data: branches, loading } = useFetch('/branches', []);
  const { data: compare } = useFetch('/branches/compare', []);

  if (loading) return <Spinner />;
  const chart = (compare || []).map((b) => ({ ...b, label: shortName(b.name, lang) }));

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.branches')} subtitle={`${branches.length} branches · centralized reporting`}>
        <Badge kind="info">Multi-branch ready</Badge>
      </PageHeader>
      <Card title="Branch Comparison" className="card--hover" >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chart} margin={{ left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }} />
            <Legend />
            <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[6, 6, 0, 0]} />
            <Bar dataKey="profit" name="Profit" fill="#7c3aed" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Branches" style={{ marginTop: 18 }}>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <div className="row" style={{ gap: 10 }}><div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--brand-100)', display: 'grid', placeItems: 'center' }}><Building2 size={16} color="var(--brand-700)" /></div><span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div> },
            { key: 'orders', label: 'Orders', align: 'end', render: (_, r) => (compare?.find((c) => c.branchId === r.id)?.orders) ?? 0 },
            { key: 'revenue', label: 'Revenue', align: 'end', render: (_, r) => money(compare?.find((c) => c.branchId === r.id)?.revenue || 0) },
            { key: 'profit', label: 'Profit', align: 'end', render: (_, r) => <span style={{ color: 'var(--success)', fontWeight: 700 }}>{money(compare?.find((c) => c.branchId === r.id)?.profit || 0)}</span> },
            { key: 'active', label: t('common.status'), render: (v) => <Badge kind={v ? 'success' : 'danger'}><span className="dot" />{v ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          rows={branches}
        />
      </Card>
    </div>
  );
}
