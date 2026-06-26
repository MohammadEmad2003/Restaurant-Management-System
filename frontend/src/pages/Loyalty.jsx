import { useTranslation } from 'react-i18next';
import { Gift, Star, Award } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Avatar } from '../components/ui.jsx';
import { shortName, money } from '../utils/format.js';

export default function Loyalty() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/clients', []);

  if (loading) return <Spinner />;
  const ranked = [...data].sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0));
  const totalPoints = data.reduce((s, c) => s + (c.loyaltyPoints || 0), 0);

  const redeem = async (c) => {
    const pts = Math.min(100, c.loyaltyPoints);
    if (!pts) return notify('No points to redeem', 'error');
    try {
      await api.post(`/loyalty/${c.id}/redeem`, { points: pts });
      notify(`Redeemed ${pts} points for ${shortName(c.name, lang)}`);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.loyalty')} subtitle={`${totalPoints.toLocaleString()} points across ${data.length} members`} />
      <div className="grid grid--3" style={{ marginBottom: 18 }}>
        {ranked.slice(0, 3).map((c, i) => (
          <div key={c.id} className="card" style={{ padding: 20, background: i === 0 ? 'var(--brand-grad)' : undefined, color: i === 0 ? '#fff' : undefined }}>
            <div className="row between">
              <Avatar name={c.name} size={46} />
              <Award size={26} color={i === 0 ? '#fff' : ['#f59e0b', '#9ca3af', '#cd7f32'][i]} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, marginTop: 12 }}>{shortName(c.name, lang)}</div>
            <div className="row" style={{ gap: 6, marginTop: 4, opacity: 0.9 }}><Star size={14} /> {c.loyaltyPoints} points · {c.visitCount} visits</div>
          </div>
        ))}
      </div>
      <Card title="Loyalty Members">
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <div className="row" style={{ gap: 10 }}><Avatar name={v} size={34} /><span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div> },
            { key: 'loyaltyPoints', label: 'Points', align: 'end', render: (v) => <Badge kind="brand"><Star size={12} /> {v}</Badge> },
            { key: 'visitCount', label: 'Visits', align: 'end' },
            { key: 'totalSpent', label: 'Spent', align: 'end', render: (v) => money(v) },
            { key: '_act', label: t('common.actions'), render: (_, r) => <button className="btn btn--sm btn--primary" onClick={() => redeem(r)} disabled={!r.loyaltyPoints}><Gift size={13} /> Redeem</button> },
          ]}
          rows={ranked}
        />
      </Card>
    </div>
  );
}
