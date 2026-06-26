import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Phone, MapPin, Star, History } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, Badge, Modal, Avatar, DataTable } from '../components/ui.jsx';
import { money, shortName, date } from '../utils/format.js';

export default function Clients() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/clients', []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });

  const filtered = (data || []).filter((c) =>
    shortName(c.name, lang).toLowerCase().includes(q.toLowerCase()) ||
    (c.phoneNumbers || []).some((p) => p.includes(q)));

  const save = async () => {
    try {
      await api.post('/clients', {
        name: form.name,
        phoneNumbers: form.phone ? [form.phone] : [],
        addresses: form.address ? [form.address] : [],
        notes: form.notes,
      });
      notify('Customer added');
      setOpen(false); setForm({ name: '', phone: '', address: '', notes: '' });
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const viewHistory = async (c) => {
    setDetail(c); setHistory(null);
    const { data } = await api.get(`/clients/${c.id}/history`);
    setHistory(data);
  };

  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.clients')} subtitle={`${data.length} customers`}>
        <div className="search"><Search size={15} color="var(--muted)" /><input placeholder={`${t('common.search')} ${t('common.name')}/${t('common.phone')}`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>

      <div className="grid grid--3">
        {filtered.map((c) => (
          <div key={c.id} className="card card--hover" style={{ padding: 18, cursor: 'pointer' }} onClick={() => viewHistory(c)}>
            <div className="row between">
              <div className="row" style={{ gap: 12 }}>
                <Avatar name={c.name} size={44} />
                <div>
                  <div style={{ fontWeight: 700 }}>{shortName(c.name, lang)}</div>
                  <div className="muted row" style={{ fontSize: 12.5, gap: 4 }}><Phone size={12} /> {c.phoneNumbers?.[0] || '—'}</div>
                </div>
              </div>
              <Badge kind="brand"><Star size={12} /> {c.loyaltyPoints}</Badge>
            </div>
            <div className="row between" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{c.visitCount} visits</span>
              <span style={{ fontWeight: 700 }}>{money(c.totalSpent)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Add modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="New Customer"
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>{t('common.phone')}</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+20 100 000 0000" /></div>
        <div className="field"><label>Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="field"><label>Notes</label><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </Modal>

      {/* Detail + history */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={<span className="row" style={{ gap: 10 }}><Avatar name={detail?.name} size={34} /> {shortName(detail?.name || '', lang)}</span>}>
        {detail && (
          <>
            <div className="grid grid--3" style={{ marginBottom: 16 }}>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Total Spent</div><div style={{ fontWeight: 800, fontSize: 18 }}>{money(detail.totalSpent)}</div></div>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Visits</div><div style={{ fontWeight: 800, fontSize: 18 }}>{detail.visitCount}</div></div>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Loyalty Points</div><div style={{ fontWeight: 800, fontSize: 18, color: 'var(--brand-700)' }}>{detail.loyaltyPoints}</div></div>
            </div>
            <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
              {(detail.phoneNumbers || []).map((p) => <Badge key={p}><Phone size={12} /> {p}</Badge>)}
            </div>
            <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
              {(detail.addresses || []).map((a, i) => <Badge key={i}><MapPin size={12} /> {a}</Badge>)}
            </div>
            <div className="card__title row" style={{ gap: 8, marginBottom: 8 }}><History size={16} /> Order History</div>
            {!history ? <Spinner /> : (
              <DataTable
                columns={[
                  { key: 'invoiceNo', label: t('orders.invoice') },
                  { key: 'orderDate', label: t('common.date'), render: (v) => date(v) },
                  { key: 'products', label: 'Items', render: (v) => `${v.length}` },
                  { key: 'totalPrice', label: t('common.total'), align: 'end', render: (v) => money(v) },
                ]}
                rows={history.orders}
                empty="No orders yet"
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
