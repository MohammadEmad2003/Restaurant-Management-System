import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, UserX, Shield, User } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Avatar } from '../components/ui.jsx';
import { money, shortName, date } from '../utils/format.js';

export default function Workers() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/workers', []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'cashier', phone: '', salary: '' });

  const save = async () => {
    try {
      await api.post('/workers', { ...form, salary: Number(form.salary || 0), hireDate: new Date().toISOString().slice(0, 10) });
      notify('Worker created');
      setOpen(false); setForm({ name: '', username: '', password: '', role: 'cashier', phone: '', salary: '' });
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const disable = async (id) => {
    await api.patch(`/workers/${id}/disable`);
    notify('Worker disabled'); refetch();
  };

  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.workers')} subtitle={`${data.length} employees`}>
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>
      <Card>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <div className="row" style={{ gap: 10 }}><Avatar name={v} size={36} /><span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div> },
            { key: 'username', label: 'Username', render: (v) => <span className="muted">@{v}</span> },
            { key: 'role', label: 'Role', render: (v) => <Badge kind={v === 'admin' ? 'brand' : ''}>{v === 'admin' ? <Shield size={12} /> : <User size={12} />} {v}</Badge> },
            { key: 'phone', label: t('common.phone') },
            { key: 'salary', label: 'Salary', align: 'end', render: (v) => money(v) },
            { key: 'hireDate', label: 'Hired', render: (v) => v },
            { key: 'status', label: t('common.status'), render: (v) => <Badge kind={v === 'active' ? 'success' : 'danger'}><span className="dot" />{t(`common.${v}`)}</Badge> },
            { key: '_act', label: t('common.actions'), render: (_, r) => r.status === 'active' && <button className="btn btn--sm btn--danger" onClick={() => disable(r.id)}><UserX size={13} /> Disable</button> },
          ]}
          rows={data}
        />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Worker"
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>Password</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>Role</label><select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="cashier">Cashier</option><option value="admin">Admin</option></select></div>
          <div className="field" style={{ flex: 1 }}><label>Salary</label><input className="input" type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></div>
        </div>
        <div className="field"><label>{t('common.phone')}</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      </Modal>
    </div>
  );
}
