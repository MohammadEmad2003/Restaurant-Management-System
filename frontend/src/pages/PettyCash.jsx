import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { usePosStats } from '../store/posStats.js';
import { PageHeader, Card, DataTable, Modal, Input, Select, Button } from '../components/ui.jsx';
import { money } from '../utils/format.js';

const CATEGORY_OPTIONS = ['utilities', 'maintenance', 'supplies', 'transport', 'other'];

export default function PettyCash() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const { data: entries, loading, refetch } = useFetch('/petty-cash', [], []);

  const blank = () => ({ amount: '', category: 'other', description: '', date: new Date().toISOString().split('T')[0] });
  const [form, setForm] = useState(blank());

  const filtered = useMemo(() => (entries || []).filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.description || '').toLowerCase().includes(q)
      || (e.category || '').toLowerCase().includes(q)
      || (e.paidBy || '').toLowerCase().includes(q);
  }), [entries, search]);

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedEntries } = usePaginated(filtered, 10);

  const total = useMemo(() => (entries || []).reduce((s, e) => s + Number(e.amount || 0), 0), [entries]);

  const submit = async () => {
    if (!form.amount || Number(form.amount) <= 0) return notify(t('pettyCash.fillRequired', 'Amount and description are required'), 'error');
    try {
      await api.post('/petty-cash', { ...form, amount: Number(form.amount) });
      notify(t('pettyCash.created', 'Expense recorded'));
      setShowModal(false);
      setForm(blank());
      refetch();
      // Petty cash is real cash leaving the drawer — reflect it immediately.
      usePosStats.getState().refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const columns = [
    { key: 'date', label: t('pettyCash.date') },
    { key: 'amount', label: t('pettyCash.amount'), align: 'end', render: (v) => money(v) },
    { key: 'category', label: t('pettyCash.category'), render: (v) => t(`pettyCash.cat_${v}`, v) },
    { key: 'description', label: t('pettyCash.description') },
    { key: 'paidBy', label: t('pettyCash.paidBy') },
  ];

  return (
    <div className="fade-in">
      <PageHeader title={t('pettyCash.title')} subtitle={t('pettyCash.subtitle')}>
        <div className="row" style={{ gap: 14, alignItems: 'center' }}>
          <div style={{ textAlign: 'end' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pettyCash.totalSpent')}</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{money(total)}</div>
          </div>
          <Button onClick={() => setShowModal(true)}>{t('pettyCash.newEntry')}</Button>
        </div>
      </PageHeader>

      <div style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder={t('pettyCash.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <DataTable columns={columns} rows={paginatedEntries} empty={t('pettyCash.empty')}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('pettyCash.newEntry')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label={t('pettyCash.amount')} type="number" value={form.amount} onChange={(v) => setField('amount', v)} />
          <Select label={t('pettyCash.category')} options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: t(`pettyCash.cat_${c}`) }))} value={form.category} onChange={(v) => setField('category', v)} />
          <Input label={t('pettyCash.description')} value={form.description} onChange={(v) => setField('description', v)} />
          <Input label={t('pettyCash.date')} type="date" value={form.date} onChange={(v) => setField('date', v)} />
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <Button color="ghost" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
