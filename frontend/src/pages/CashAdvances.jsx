import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { usePosStats } from '../store/posStats.js';
import { PageHeader, Card, DataTable, Badge, Button, Modal, Input, Select, Textarea } from '../components/ui.jsx';
import { money } from '../utils/format.js';

const STATUS_KIND = { pending: 'warning', deducted: 'success', reimbursed: 'info' };

export default function CashAdvances() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const { data: advances, loading, refetch } = useFetch('/cash-advances', [], []);
  const { data: workers } = useFetch('/workers', [], []);
  const confirm = useUI((s) => s.confirm);
  const refreshCashDrawer = usePosStats((s) => s.refreshCashDrawer);
  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedAdvances } = usePaginated(advances, 10);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (showModal) setForm({ workerId: '', workerName: '', amount: '', date: new Date().toISOString().slice(0, 10), description: '', notes: '', repaymentMethod: 'salary-deduction' });
  }, [showModal]);

  const create = async () => {
    // Guard against a double-click firing two requests before the modal
    // closes — a real Cash Ledger deduction must never be created twice.
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/cash-advances', { ...form, amount: Number(form.amount) });
      notify(t('cashAdvances.created', 'Cash advance recorded'));
      setShowModal(false);
      refetch();
      // This is real cash leaving the drawer — update the shared Cash Drawer
      // figure immediately so the POS badge reflects it without needing a
      // page navigation/reload.
      refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/cash-advances/${id}`, { status });
      notify(t('cashAdvances.statusUpdated', 'Status updated'));
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const del = async (id) => {
    if (!(await confirm({ message: t('cashAdvances.confirmDelete', 'Delete this advance?'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.delete(`/cash-advances/${id}`);
      notify(t('cashAdvances.deleted', 'Cash advance deleted'));
      refetch();
      // Deleting reverses whatever this advance had deducted from the drawer.
      refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const columns = [
    { key: 'workerName', label: t('cashAdvances.worker') },
    { key: 'amount', label: t('cashAdvances.amount'), align: 'end', render: (v) => money(v) },
    { key: 'date', label: t('cashAdvances.date') },
    { key: 'description', label: t('cashAdvances.description') },
    { key: 'notes', label: t('cashAdvances.notes') },
    { key: 'status', label: t('cashAdvances.status'), render: (v) => <Badge kind={STATUS_KIND[v]}>{t(`cashAdvances.status_${v}`, v)}</Badge> },
    { key: 'repaymentMethod', label: t('cashAdvances.repayment'), render: (v) => t(`cashAdvances.repay_${v === 'cash-reimbursement' ? 'cash' : 'salary'}`) },
    {
      key: '_act', label: t('common.actions'), render: (_, row) => (
        <div className="row" style={{ gap: 6 }}>
          {row.status === 'pending' && (
            <>
              <button className="btn btn--sm btn--primary" onClick={() => setStatus(row.id, 'deducted')}>{t('cashAdvances.mark_deducted')}</button>
              <button className="btn btn--sm" onClick={() => setStatus(row.id, 'reimbursed')}>{t('cashAdvances.mark_reimbursed')}</button>
            </>
          )}
          <button className="btn btn--sm btn--danger" onClick={() => del(row.id)}>{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  return (
    <div className="fade-in">
      <PageHeader title={t('cashAdvances.title')} subtitle={t('cashAdvances.subtitle')}>
        <Button onClick={() => setShowModal(true)}>{t('cashAdvances.createAdvance')}</Button>
      </PageHeader>

      <Card>
        <DataTable columns={columns} rows={paginatedAdvances} empty={t('cashAdvances.empty')}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('cashAdvances.createAdvance')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            label={t('cashAdvances.worker')}
            options={(workers || []).map((w) => ({ value: w.id, label: w.name || w.workerName || w.id }))}
            value={form.workerId}
            onChange={(v) => setForm({ ...form, workerId: v, workerName: (workers || []).find((w) => w.id === v)?.name || '' })}
          />
          <Input label={t('cashAdvances.amount')} type="number" value={form.amount || ''} onChange={(v) => setForm({ ...form, amount: v })} />
          <Input label={t('cashAdvances.date')} type="date" value={form.date || ''} onChange={(v) => setForm({ ...form, date: v })} />
          <Input label={t('cashAdvances.description')} value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} />
          <Select label={t('cashAdvances.repayment')} value={form.repaymentMethod || 'salary-deduction'}
            onChange={(v) => setForm({ ...form, repaymentMethod: v })}
            options={[
              { value: 'salary-deduction', label: t('cashAdvances.repay_salary') },
              { value: 'cash-reimbursement', label: t('cashAdvances.repay_cash') },
            ]} />
          <Textarea label={t('cashAdvances.notes')} value={form.notes || ''} onChange={(v) => setForm({ ...form, notes: v })} />
          <Button onClick={create} disabled={saving}>{t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}
