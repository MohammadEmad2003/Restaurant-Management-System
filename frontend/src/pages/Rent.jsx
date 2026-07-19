import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { PageHeader, Card, DataTable, Badge, Button, Modal, Input, Select } from '../components/ui.jsx';
import { money, date } from '../utils/format.js';

const STATUS_KIND = { upcoming: 'warning', paid: 'success', overdue: 'danger' };
const METHOD_LABELS = { cash: 'Cash', card: 'Card', 'bank-transfer': 'Bank Transfer' };

export default function Rent() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const { data: rents, loading, refetch } = useFetch('/rents', [], []);
  const { data: upcoming } = useFetch('/rents/upcoming', [], []);
  const { data: locations } = useFetch('/locations', [], []);
  const confirm = useUI((s) => s.confirm);
  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedRents } = usePaginated(rents, 10);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (showModal) setForm({ locationId: '', landlord: '', amount: '', dueDate: '', period: 'monthly', status: 'upcoming', paymentMethod: 'cash', notes: '' });
  }, [showModal]);

  const create = async () => {
    try {
      await api.post('/rents', { ...form, amount: Number(form.amount) });
      notify(t('rents.created', 'Rent record added'));
      setShowModal(false);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const pay = async (id) => {
    try {
      await api.patch(`/rents/${id}/pay`, { paymentMethod: 'cash' });
      notify(t('rents.paid', 'Rent marked as paid'));
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const del = async (id) => {
    if (!(await confirm({ message: t('rents.confirmDelete', 'Delete this rent record?'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.delete(`/rents/${id}`);
      notify(t('rents.deleted', 'Rent record deleted'));
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const columns = [
    { key: 'locationName', label: t('rents.location'), render: (v, r) => v || r.locationId || '—' },
    { key: 'landlord', label: t('rents.landlord') },
    { key: 'amount', label: t('rents.amount'), align: 'end', render: (v) => money(v) },
    { key: 'dueDate', label: t('rents.dueDate') },
    { key: 'paidDate', label: t('rents.paidDate'), render: (v) => (v ? date(v) : '—') },
    { key: 'paymentMethod', label: t('rents.paymentMethod'), render: (v) => METHOD_LABELS[v] || v || '—' },
    { key: 'period', label: t('rents.period'), render: (v) => t(`rents.period_${v}`, v) },
    { key: 'status', label: t('rents.status'), render: (v) => <Badge kind={STATUS_KIND[v]}>{t(`rents.status_${v}`, v)}</Badge> },
    {
      key: '_act', label: t('common.actions'), render: (_, row) => (
        <div className="row" style={{ gap: 6 }}>
          {(row.status === 'upcoming' || row.status === 'overdue') && (
            <button className="btn btn--sm btn--primary" onClick={() => pay(row.id)}>{t('rents.pay')}</button>
          )}
          <button className="btn btn--sm btn--danger" onClick={() => del(row.id)}>{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  return (
    <div className="fade-in">
      <PageHeader title={t('rents.title')} subtitle={t('rents.subtitle')}>
        <Button onClick={() => setShowModal(true)}>{t('rents.addRecord')}</Button>
      </PageHeader>

      {upcoming && upcoming.length > 0 && (
        <Card title={t('rents.upcomingDues')} className="card--hover" style={{ marginBottom: 18 }}>
          {upcoming.map((r) => (
            <div key={r.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{r.locationName || r.locationId} — {r.landlord}</span>
              <span className={r.status === 'overdue' ? 'text-danger' : 'muted'}>{r.dueDate} · {money(r.amount)}</span>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <DataTable columns={columns} rows={paginatedRents} empty={t('rents.empty')}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('rents.addRecord')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select label={t('rents.location')} options={(locations || []).map((l) => ({ value: l.id, label: l.name }))} value={form.locationId} onChange={(v) => setForm({ ...form, locationId: v })} />
          <Input label={t('rents.landlord')} value={form.landlord || ''} onChange={(v) => setForm({ ...form, landlord: v })} />
          <Input label={t('rents.amount')} type="number" value={form.amount || ''} onChange={(v) => setForm({ ...form, amount: v })} />
          <Input label={t('rents.dueDate')} type="date" value={form.dueDate || ''} onChange={(v) => setForm({ ...form, dueDate: v })} />
          <Select label={t('rents.period')} options={['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'].map((p) => ({ value: p, label: t(`rents.period_${p}`) }))} value={form.period} onChange={(v) => setForm({ ...form, period: v })} />
          <Select label={t('rents.paymentMethod')} options={['cash', 'card', 'bank-transfer'].map((m) => ({ value: m, label: METHOD_LABELS[m] }))} value={form.paymentMethod} onChange={(v) => setForm({ ...form, paymentMethod: v })} />
          <Input label={t('rents.notes')} value={form.notes || ''} onChange={(v) => setForm({ ...form, notes: v })} />
          <Button onClick={create}>{t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}
