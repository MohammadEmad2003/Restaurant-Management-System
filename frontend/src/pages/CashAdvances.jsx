import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { useAuth } from '../store/auth.js';
import { usePosStats } from '../store/posStats.js';
import { PageHeader, Card, DataTable, Badge, Button, Modal, Input, Select, Textarea } from '../components/ui.jsx';
import { money } from '../utils/format.js';

const STATUS_KIND = { pending: 'warning', deducted: 'success' };

/** The Cash Drawer side of an advance's lifecycle is independent of the
 * salary-deduction side: Not Withdrawn → Withdrawn → (Returned, cash-
 * reimbursement only). Computed here rather than stored as a single flat
 * status, since withdrawn/returned are tracked as their own fields. */
function cashStatusOf(row) {
  if (row.returned) return { key: 'returned', kind: 'success', label: 'returnedStatus' };
  if (row.withdrawn) return { key: 'withdrawn', kind: 'info', label: 'withdrawnStatus' };
  return { key: 'not_withdrawn', kind: 'warning', label: 'notWithdrawn' };
}

export default function CashAdvances() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const can = useAuth((s) => s.can);
  const isAdmin = can('admin');
  const { data: advances, loading, refetch } = useFetch('/cash-advances', [], []);
  // Minimal roster (id + name only) — deliberately not the full /workers
  // list, so a Cashier creating an advance never receives salary data over
  // the wire, even though they need to pick which worker it's for.
  const { data: workers } = useFetch('/workers/roster', [], []);
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
    // closes — creating a duplicate paperwork record is still wrong even
    // though the drawer isn't touched until it's withdrawn.
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/cash-advances', { ...form, amount: Number(form.amount) });
      notify(t('cashAdvances.created', 'Cash advance recorded'));
      setShowModal(false);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const withdraw = async (row) => {
    if (!(await confirm({
      message: t('cashAdvances.confirmWithdraw', 'Confirm that {{amount}} was actually handed to {{name}}? This will decrease the Cash Drawer by that amount.')
        .replace('{{amount}}', money(row.amount)).replace('{{name}}', row.workerName),
      confirmLabel: t('cashAdvances.markWithdrawn', 'Cash Withdrawn'),
    }))) return;
    try {
      await api.patch(`/cash-advances/${row.id}/withdraw`);
      notify(t('cashAdvances.withdrawn', 'Cash advance marked as withdrawn'));
      refetch();
      // Real cash just left the drawer — reflect it immediately in the POS badge.
      refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const returnAdvance = async (row) => {
    if (!(await confirm({
      message: t('cashAdvances.confirmReturn', 'Confirm that {{name}} returned {{amount}} in cash? This will increase the Cash Drawer by that amount.')
        .replace('{{amount}}', money(row.amount)).replace('{{name}}', row.workerName),
      confirmLabel: t('cashAdvances.returnAdvance', 'Return Cash Advance'),
    }))) return;
    try {
      await api.patch(`/cash-advances/${row.id}/return`);
      notify(t('cashAdvances.returned', 'Cash advance marked as returned'));
      refetch();
      refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const del = async (id) => {
    if (!(await confirm({ message: t('cashAdvances.confirmDelete', 'Delete this advance?'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.delete(`/cash-advances/${id}`);
      notify(t('cashAdvances.deleted', 'Cash advance deleted'));
      refetch();
      // Deleting reverses whatever this advance had contributed to the drawer.
      refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const columns = [
    { key: 'workerName', label: t('cashAdvances.worker') },
    { key: 'amount', label: t('cashAdvances.amount'), align: 'end', render: (v) => money(v) },
    { key: 'date', label: t('cashAdvances.date') },
    { key: 'repaymentMethod', label: t('cashAdvances.repayment'), render: (v) => t(`cashAdvances.repay_${v === 'cash-reimbursement' ? 'cash' : 'salary'}`) },
    {
      key: '_cashStatus', label: t('cashAdvances.cashStatus', 'Cash Status'), render: (_, row) => {
        const s = cashStatusOf(row);
        return <Badge kind={s.kind}>{t(`cashAdvances.${s.label}`)}</Badge>;
      },
    },
    {
      key: 'status', label: t('cashAdvances.salaryDeduction', 'Salary Deduction'), render: (v, row) => (
        row.repaymentMethod === 'salary-deduction'
          ? <Badge kind={STATUS_KIND[v]}>{t(`cashAdvances.status_${v}`, v)}</Badge>
          : <span className="muted">—</span>
      ),
    },
    { key: 'notes', label: t('cashAdvances.notes') },
    {
      key: '_act', label: t('common.actions'), render: (_, row) => (
        <div className="row" style={{ gap: 6 }}>
          {!row.withdrawn && (
            <button className="btn btn--sm btn--primary" onClick={() => withdraw(row)}>{t('cashAdvances.markWithdrawn', 'Cash Withdrawn')}</button>
          )}
          {row.withdrawn && row.repaymentMethod === 'cash-reimbursement' && !row.returned && (
            <button className="btn btn--sm" onClick={() => returnAdvance(row)}>{t('cashAdvances.returnAdvance', 'Return Cash Advance')}</button>
          )}
          {isAdmin && <button className="btn btn--sm btn--danger" onClick={() => del(row.id)}>{t('common.delete')}</button>}
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
          <Input label={t('cashAdvances.description')} value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} />
          <Textarea label={t('cashAdvances.notes')} value={form.notes || ''} onChange={(v) => setForm({ ...form, notes: v })} />
          <Button onClick={create} disabled={saving}>{t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}
