import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { useAuth } from '../store/auth.js';
import { PageHeader, Card, DataTable, Modal, Badge, Input, Select, Textarea, Button } from '../components/ui.jsx';

const STATUS_OPTIONS = ['open', 'in-progress', 'resolved', 'closed'];
const CATEGORY_OPTIONS = ['food', 'service', 'cleanliness', 'other'];
const PRIORITY_OPTIONS = ['low', 'normal', 'high'];

const STATUS_KIND = { open: 'danger', 'in-progress': 'warning', resolved: 'success', closed: '' };
const PRIORITY_KIND = { high: 'danger', normal: '', low: 'success' };
// i18n key segments can't contain a hyphen — map the status value to its key suffix.
const stKey = (v) => `complaints.st_${String(v).replace('-', '_')}`;

export default function Complaints() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const confirm = useUI((s) => s.confirm);
  const can = useAuth((s) => s.can);
  const isAdmin = can('admin');
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const { data: complaints, loading, refetch } = useFetch('/complaints', [], []);

  const blank = () => ({
    clientId: null, orderId: null, orderNumber: '',
    clientName: '', phone: '', description: '', category: 'other',
    status: 'open', priority: 'normal', date: new Date().toISOString().split('T')[0],
  });
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  // Arriving from an order (e.g. the "File Complaint" action on an order row)
  // pre-fills and opens the create form with that order already linked —
  // cleared from history immediately so a page refresh doesn't reopen it.
  useEffect(() => {
    const prefill = location.state?.prefillComplaint;
    if (!prefill) return;
    setEditItem(null);
    setForm({ ...blank(), ...prefill });
    setShowModal(true);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const filtered = useMemo(() => (complaints || []).filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (categoryFilter && c.category !== categoryFilter) return false;
    if (priorityFilter && c.priority !== priorityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.clientName || '').toLowerCase().includes(q)
        || (c.description || '').toLowerCase().includes(q)
        || (c.phone || '').includes(q);
    }
    return true;
  }), [complaints, search, statusFilter, categoryFilter, priorityFilter]);

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedComplaints } = usePaginated(filtered, 10);

  const openCreate = () => { setEditItem(null); setForm(blank()); setShowModal(true); };
  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      clientId: item.clientId || null, orderId: item.orderId || null, orderNumber: item.orderNumber || '',
      clientName: item.clientName || '', phone: item.phone || '', description: item.description || '',
      category: item.category || 'other', status: item.status || 'open', priority: item.priority || 'normal',
      date: item.date || new Date().toISOString().split('T')[0],
    });
    setShowModal(true);
  };

  const submit = async () => {
    // Guards against a double-click creating two identical complaint
    // records for the same order/customer before the modal closes.
    if (saving) return;
    setSaving(true);
    try {
      if (editItem) await api.put(`/complaints/${editItem.id}`, form);
      else await api.post('/complaints', form);
      notify(t('complaints.saved', 'Complaint saved'));
      setShowModal(false);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!(await confirm({ message: t('complaints.confirmDelete', 'Delete this complaint?'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.delete(`/complaints/${id}`);
      notify(t('complaints.deleted', 'Complaint deleted'));
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const columns = [
    { key: 'clientName', label: t('complaints.clientName') },
    { key: 'orderNumber', label: t('complaints.order', 'Order'), render: (v) => v ? <span className="ltr">{v}</span> : <span className="muted">—</span> },
    { key: 'phone', label: t('complaints.phone') },
    { key: 'category', label: t('complaints.category'), render: (v) => <Badge kind="info">{t(`complaints.cat_${v}`, v)}</Badge> },
    { key: 'status', label: t('complaints.status'), render: (v) => <Badge kind={STATUS_KIND[v]}>{t(stKey(v), v)}</Badge> },
    { key: 'priority', label: t('complaints.priority'), render: (v) => <Badge kind={PRIORITY_KIND[v]}>{t(`complaints.pri_${v}`, v)}</Badge> },
    { key: 'date', label: t('complaints.date') },
    // Editing/resolving/deleting a complaint stays an Admin-only action — a
    // Cashier can view every complaint and file new ones, but never these.
    ...(isAdmin ? [{
      key: '_act', label: t('common.actions'), render: (_, row) => (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn--sm" onClick={() => openEdit(row)}>{t('common.edit')}</button>
          <button className="btn btn--sm btn--danger" onClick={() => del(row.id)}>{t('common.delete')}</button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="fade-in">
      <PageHeader title={t('complaints.title')} subtitle={t('complaints.subtitle')}>
        <Button onClick={openCreate}>{t('complaints.addNew')}</Button>
      </PageHeader>

      <div className="row wrap" style={{ gap: 12, marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder={t('complaints.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" style={{ maxWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t('complaints.allStatuses')}</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(stKey(s))}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 200 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">{t('complaints.allCategories')}</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{t(`complaints.cat_${c}`)}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 200 }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">{t('complaints.allPriorities', 'All priorities')}</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{t(`complaints.pri_${p}`)}</option>)}
        </select>
      </div>

      <Card>
        <DataTable columns={columns} rows={paginatedComplaints} empty={t('complaints.empty')}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? t('complaints.editTitle') : t('complaints.createTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label={t('complaints.clientName')} value={form.clientName} onChange={(v) => setField('clientName', v)} />
          <Input label={t('complaints.phone')} type="tel" value={form.phone} onChange={(v) => setField('phone', v)} />
          <Select label={t('complaints.category')} value={form.category} onChange={(v) => setField('category', v)} options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: t(`complaints.cat_${c}`) }))} />
          <Select label={t('complaints.status')} value={form.status} onChange={(v) => setField('status', v)} options={STATUS_OPTIONS.map((s) => ({ value: s, label: t(stKey(s)) }))} />
          <Select label={t('complaints.priority')} value={form.priority} onChange={(v) => setField('priority', v)} options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: t(`complaints.pri_${p}`) }))} />
          <Input label={t('complaints.date')} type="date" value={form.date} onChange={(v) => setField('date', v)} />
          <Textarea label={t('complaints.description')} value={form.description} onChange={(v) => setField('description', v)} rows={4} />
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <Button color="ghost" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={saving}>{editItem ? t('common.save') : t('complaints.create')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
