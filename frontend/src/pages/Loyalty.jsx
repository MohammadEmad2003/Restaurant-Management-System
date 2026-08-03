import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift, Star, Award, History } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Avatar, Modal } from '../components/ui.jsx';
import { shortName, money, date } from '../utils/format.js';

export default function Loyalty() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/clients', []);
  const [history, setHistory] = useState(null); // { name, entries } | null
  const [redeeming, setRedeeming] = useState(() => new Set());

  const ranked = [...(data ?? [])].sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0));
  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedRanked } = usePaginated(ranked, 10);

  const openHistory = async (c) => {
    try {
      const res = await api.get(`/loyalty/${c.id}`);
      setHistory({ name: res.data.name, entries: res.data.history || [] });
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading || !data) return <Spinner />;
  const totalPoints = data.reduce((s, c) => s + (c.loyaltyPoints || 0), 0);

  const redeem = async (c) => {
    // Guards against a double-click firing this twice before the table
    // refetches — both clicks would otherwise read the same stale
    // `c.loyaltyPoints` and redeem it twice (e.g. 100 of 150 points redeemed
    // twice = 200 total, a real overspend of loyalty currency).
    if (redeeming.has(c.id)) return;
    const pts = Math.min(100, c.loyaltyPoints);
    if (!pts) return notify('No points to redeem', 'error');
    setRedeeming((prev) => new Set(prev).add(c.id));
    try {
      await api.post(`/loyalty/${c.id}/redeem`, { points: pts });
      notify(`Redeemed ${pts} points for ${shortName(c.name, lang)}`);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally {
      setRedeeming((prev) => { const next = new Set(prev); next.delete(c.id); return next; });
    }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.loyalty')} subtitle={`${totalPoints.toLocaleString()} ${t('loyalty.points')} across ${data.length} ${t('loyalty.members')}`} />
      <div className="grid grid--3" style={{ marginBottom: 18 }}>
        {ranked.slice(0, 3).map((c, i) => (
          <div key={c.id} className="card" style={{ padding: 20, background: i === 0 ? 'var(--brand-grad)' : undefined, color: i === 0 ? '#fff' : undefined }}>
            <div className="row between">
              <Avatar name={c.name} size={46} />
              <Award size={26} color={i === 0 ? '#fff' : ['#f59e0b', '#9ca3af', '#cd7f32'][i]} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, marginTop: 12 }}>{shortName(c.name, lang)}</div>
            <div className="row" style={{ gap: 6, marginTop: 4, opacity: 0.9 }}><Star size={14} /> {c.loyaltyPoints} {t('loyalty.points')} · {c.visitCount} {t('loyalty.visits')}</div>
          </div>
        ))}
      </div>
      <Card title={t('loyalty.membersTitle')}>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <div className="row" style={{ gap: 10 }}><Avatar name={v} size={34} /><span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div> },
            { key: 'loyaltyPoints', label: t('loyalty.points'), align: 'end', render: (v) => <Badge kind="brand"><Star size={12} /> {v}</Badge> },
            { key: 'visitCount', label: t('loyalty.visits'), align: 'end' },
            { key: 'totalSpent', label: t('loyalty.spent'), align: 'end', render: (v) => money(v) },
            { key: '_act', label: t('common.actions'), render: (_, r) => (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn--sm" onClick={() => openHistory(r)}><History size={13} /> {t('loyalty.history')}</button>
                <button className="btn btn--sm btn--primary" onClick={() => redeem(r)} disabled={!r.loyaltyPoints || redeeming.has(r.id)}><Gift size={13} /> {t('loyalty.redeem')}</button>
              </div>
            ) },
          ]}
          rows={paginatedRanked}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
        />
      </Card>

      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `${t('loyalty.pointsActivity')} — ${shortName(history.name, lang)}` : ''}>
        {history && (history.entries.length ? (
          <DataTable
            columns={[
              { key: 'date', label: t('common.date'), render: (v, r) => v || date(r.createdAt) },
              { key: 'type', label: t('common.status'), render: (v) => <Badge kind={v === 'redeem' ? 'warning' : 'success'}>{v === 'redeem' ? t('loyalty.redeemed') : t('loyalty.earned')}</Badge> },
              { key: 'points', label: t('loyalty.points'), align: 'end', render: (v) => <span style={{ fontWeight: 700, color: v < 0 ? 'var(--danger)' : 'var(--success)' }}>{v > 0 ? `+${v}` : v}</span> },
            ]}
            rows={history.entries}
          />
        ) : <div className="empty">{t('loyalty.noHistory')}</div>)}
      </Modal>
    </div>
  );
}
