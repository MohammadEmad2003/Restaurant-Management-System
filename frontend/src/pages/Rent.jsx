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
// Sentinel Select value for "type a location that isn't in the managed list
// yet" — rents don't actually enforce a foreign key to the Locations
// collection, so a typed name is used directly as both id and display name.
const OTHER_LOCATION = '__custom__';

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
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (showModal) {
      setForm({
        locationId: '', customLocation: '', landlord: '', amount: '',
        initialDate: new Date().toISOString().slice(0, 10), dueDate: '',
        period: 'monthly', status: 'upcoming', paymentMethod: 'cash', notes: '',
      });
    }
  }, [showModal]);

  const create = async () => {
    const usingCustomLocation = form.locationId === OTHER_LOCATION;
    if (usingCustomLocation && !form.customLocation.trim()) {
      return notify(t('rents.customLocationRequired', 'Type the location name'), 'error');
    }
    // Guards against a double-click firing two requests before the modal
    // closes, same as every other create form in the app.
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        ...(usingCustomLocation ? { locationId: form.customLocation.trim(), locationName: form.customLocation.trim() } : {}),
      };
      delete payload.customLocation;
      await api.post('/rents', payload);
      notify(t('rents.created', 'Rent record added'));
      setShowModal(false);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  // Periodic payments are bookkeeping only — paying/unpaying one never
  // touches the Cash Drawer (that's a separate financial concept now).
  const pay = async (row) => {
    try {
      await api.patch(`/rents/${row.id}/pay`, { paymentMethod: row.paymentMethod || 'cash' });
      notify(t('rents.paid', 'Rent marked as paid'));
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const unpay = async (row) => {
    try {
      await api.patch(`/rents/${row.id}/unpay`);
      notify(t('rents.unpaid', 'Rent marked as unpaid'));
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
    { key: 'initialDate', label: t('rents.initialDate', 'Initial Date'), render: (v) => v || '—' },
    { key: 'dueDate', label: t('rents.dueDate') },
    { key: 'paidDate', label: t('rents.paidDate'), render: (v) => (v ? date(v) : '—') },
    { key: 'paymentMethod', label: t('rents.paymentMethod'), render: (v) => METHOD_LABELS[v] || v || '—' },
    { key: 'period', label: t('rents.period'), render: (v) => t(`rents.period_${v}`, v) },
    { key: 'status', label: t('rents.status'), render: (v) => <Badge kind={STATUS_KIND[v]}>{t(`rents.status_${v}`, v)}</Badge> },
    {
      key: '_act', label: t('common.actions'), render: (_, row) => (
        <div className="row" style={{ gap: 6 }}>
          {(row.status === 'upcoming' || row.status === 'overdue') && (
            <button className="btn btn--sm btn--primary" onClick={(e) => { e.stopPropagation(); pay(row); }}>{t('rents.pay')}</button>
          )}
          {row.status === 'paid' && (
            <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); unpay(row); }}>{t('rents.unpay', 'Mark as Unpaid')}</button>
          )}
          <button className="btn btn--sm btn--danger" onClick={(e) => { e.stopPropagation(); del(row.id); }}>{t('common.delete')}</button>
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
        <DataTable columns={columns} rows={paginatedRents} empty={t('rents.empty')} onRowClick={(row) => setDetail(row)}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('rents.addRecord')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            label={t('rents.location')}
            options={[
              ...(locations || []).map((l) => ({ value: l.id, label: l.name })),
              { value: OTHER_LOCATION, label: t('rents.otherLocation', 'Other (type manually)') },
            ]}
            value={form.locationId} onChange={(v) => setForm({ ...form, locationId: v })}
          />
          {form.locationId === OTHER_LOCATION && (
            <Input label={t('rents.customLocationLabel', 'Location name')} value={form.customLocation}
              onChange={(v) => setForm({ ...form, customLocation: v })}
              placeholder={t('rents.customLocationPlaceholder', 'Type the location name…')} />
          )}
          <Input label={t('rents.landlord')} value={form.landlord || ''} onChange={(v) => setForm({ ...form, landlord: v })} />
          <Input label={t('rents.amount')} type="number" value={form.amount || ''} onChange={(v) => setForm({ ...form, amount: v })} />
          <Input label={t('rents.initialDate', 'Initial Date')} type="date" value={form.initialDate || ''} onChange={(v) => setForm({ ...form, initialDate: v })} />
          <Input label={t('rents.dueDate')} type="date" value={form.dueDate || ''} onChange={(v) => setForm({ ...form, dueDate: v })} />
          <Select label={t('rents.period')} options={['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'].map((p) => ({ value: p, label: t(`rents.period_${p}`) }))} value={form.period} onChange={(v) => setForm({ ...form, period: v })} />
          <Select label={t('rents.paymentMethod')} options={['cash', 'card', 'bank-transfer'].map((m) => ({ value: m, label: METHOD_LABELS[m] }))} value={form.paymentMethod} onChange={(v) => setForm({ ...form, paymentMethod: v })} />
          <Input label={t('rents.notes')} value={form.notes || ''} onChange={(v) => setForm({ ...form, notes: v })} />
          <Button onClick={create} disabled={saving}>{t('common.save')}</Button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? (detail.locationName || detail.locationId) : ''}>
        {detail && (
          <>
            <div className="grid grid--3" style={{ marginBottom: 16 }}>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('rents.landlord')}</div><div style={{ fontWeight: 700 }}>{detail.landlord || '—'}</div></div>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('rents.initialDate', 'Initial Date')}</div><div style={{ fontWeight: 700 }}>{detail.initialDate || '—'}</div></div>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('rents.status')}</div><div style={{ fontWeight: 700 }}><Badge kind={STATUS_KIND[detail.status]}>{t(`rents.status_${detail.status}`, detail.status)}</Badge></div></div>
            </div>
            <div className="card__title" style={{ marginBottom: 8 }}>{t('rents.paymentHistory', 'Payment History')}</div>
            <DataTable
              columns={[
                { key: 'date', label: t('common.date'), render: (v) => date(v) },
                { key: 'amount', label: t('rents.amount'), align: 'end', render: (v) => money(v) },
                { key: 'paymentMethod', label: t('rents.paymentMethod'), render: (v) => METHOD_LABELS[v] || v || '—' },
              ]}
              rows={(detail.paymentHistory || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))}
              empty={t('rents.noPaymentHistory', 'No payments recorded for this periodic payment yet.')}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
