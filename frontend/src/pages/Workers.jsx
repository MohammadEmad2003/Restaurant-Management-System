import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, UserX, Shield, User, ChefHat, Pencil, Wallet } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Avatar, Phone } from '../components/ui.jsx';
import { money, shortName } from '../utils/format.js';

const ROLES = ['cashier', 'chef', 'admin'];
const ROLE_ICON = { admin: Shield, chef: ChefHat, cashier: User };
const blank = { name: '', username: '', password: '', role: 'cashier', phone: '', salary: '' };

export default function Workers() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/workers', []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // worker being edited, or null for new
  const [form, setForm] = useState(blank);
  const [payOpen, setPayOpen] = useState(false);
  const [pvRows, setPvRows] = useState(null);
  const [edits, setEdits] = useState({}); // workerId → { bonus, deductions }
  const [paying, setPaying] = useState(false);
  const month = new Date().toISOString().slice(0, 7);

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (w) => {
    setEditing(w);
    setForm({ name: w.name, username: w.username, password: '', role: w.role, phone: w.phone || '', salary: w.salary ?? '' });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = { ...form, salary: Number(form.salary || 0) };
      if (editing) {
        if (!payload.password) delete payload.password; // keep existing password
        await api.put(`/workers/${editing.id}`, payload);
        notify(t('workers.updated', 'Worker updated'));
      } else {
        await api.post('/workers', { ...payload, hireDate: new Date().toISOString().slice(0, 10) });
        notify(t('workers.created', 'Worker created'));
      }
      setOpen(false); setForm(blank); setEditing(null);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const disable = async (id) => {
    await api.patch(`/workers/${id}/disable`);
    notify(t('workers.disabled', 'Worker disabled')); refetch();
  };

  const openPayroll = async () => {
    setPayOpen(true); setPvRows(null); setEdits({});
    try {
      const { data } = await api.get(`/salaries/preview?month=${month}`);
      setPvRows(data.rows);
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const editRow = (wid, patch) => setEdits((e) => ({ ...e, [wid]: { ...e[wid], ...patch } }));
  const rowNet = (r) => {
    const e = edits[r.workerId] || {};
    const bonus = e.bonus != null ? Number(e.bonus) || 0 : r.bonus || 0;
    const deductions = e.deductions != null ? Number(e.deductions) || 0 : r.deductions || 0;
    return +(r.baseSalary + r.overtimePay + bonus - r.lateDeduction - deductions).toFixed(2);
  };
  const payrollTotal = (pvRows || []).reduce((s, r) => s + rowNet(r), 0);

  const payAll = async () => {
    if (!window.confirm(t('workers.payrollConfirm', 'Run payroll for this month? Each active worker’s salary is recorded as an expense.'))) return;
    setPaying(true);
    try {
      await api.post('/salaries/generate', { month });
      const { data } = await api.get(`/salaries/preview?month=${month}`);
      for (const [wid, e] of Object.entries(edits)) {
        const row = data.rows.find((r) => r.workerId === wid);
        if (row?.id && (e.bonus || e.deductions)) {
          await api.patch(`/salaries/${row.id}/adjust`, { bonus: Number(e.bonus) || 0, deductions: Number(e.deductions) || 0 });
        }
      }
      const { data: res } = await api.post('/salaries/run', { month });
      notify(`${t('workers.payrollDone', 'Payroll done')} · ${res.paidNow}/${res.workers} · ${money(res.total)}`);
      setPayOpen(false); refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setPaying(false); }
  };

  if (loading) return <Spinner />;
  const monthlyPayroll = data.filter((w) => w.status === 'active').reduce((s, w) => s + (w.salary || 0), 0);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.workers')} subtitle={`${data.length} ${t('workers.employees', 'employees')} · ${t('workers.monthlyPayroll', 'monthly payroll')} ${money(monthlyPayroll)}`}>
        <button className="btn" onClick={openPayroll}><Wallet size={16} /> {t('workers.runPayroll', 'Run Payroll')}</button>
        <button className="btn btn--primary" onClick={openNew}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>
      <Card>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <div className="row" style={{ gap: 10 }}><Avatar name={v} size={36} /><span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div> },
            { key: 'username', label: t('login.username', 'Username'), render: (v) => <span className="muted ltr">@{v}</span> },
            { key: 'role', label: t('workers.role', 'Role'), render: (v) => { const I = ROLE_ICON[v] || User; return <Badge kind={v === 'admin' ? 'brand' : v === 'chef' ? 'warning' : ''}><I size={12} /> {t(`workers.roles.${v}`, v)}</Badge>; } },
            { key: 'phone', label: t('common.phone'), render: (v) => <Phone>{v}</Phone> },
            { key: 'salary', label: t('workers.salary', 'Salary'), align: 'end', render: (v) => money(v) },
            { key: 'hireDate', label: t('workers.hired', 'Hired'), render: (v) => v },
            { key: 'status', label: t('common.status'), render: (v) => <Badge kind={v === 'active' ? 'success' : 'danger'}><span className="dot" />{t(`common.${v}`)}</Badge> },
            { key: '_act', label: t('common.actions'), render: (_, r) => (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn--sm" onClick={() => openEdit(r)}><Pencil size={13} /> {t('common.edit', 'Edit')}</button>
                {r.status === 'active' && <button className="btn btn--sm btn--danger" onClick={() => disable(r.id)}><UserX size={13} /></button>}
              </div>
            ) },
          ]}
          rows={data}
        />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('workers.edit', 'Edit Worker') : t('workers.new', 'New Worker')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('login.username', 'Username')}</label><input className="input ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('login.password', 'Password')}{editing && <span className="muted"> · {t('workers.keepBlank', 'leave blank to keep')}</span>}</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('workers.role', 'Role')}</label>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`workers.roles.${r}`, r)}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>{t('workers.salary', 'Monthly Salary')}</label><input className="input" type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></div>
        </div>
        <div className="field"><label>{t('common.phone')}</label><input className="input ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} xl title={`${t('workers.payroll', 'Payroll')} · ${month}`}
        footer={<><button className="btn" onClick={() => setPayOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={payAll} disabled={paying || !pvRows}><Wallet size={15} /> {paying ? t('common.loading') : `${t('workers.payAll', 'Pay All')} · ${money(payrollTotal)}`}</button></>}>
        {!pvRows ? <Spinner /> : (
          <>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{t('workers.payrollHint', 'Review each salary before paying. Add a bonus or extra deduction as needed; late deductions and overtime are applied automatically.')}</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>{t('common.name')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.base', 'Base')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.overtime', 'Overtime')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.lateDed', 'Late −')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.bonus', 'Bonus')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.deduction', 'Deduction')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.net', 'Net Pay')}</th>
                </tr></thead>
                <tbody>
                  {pvRows.map((r) => (
                    <tr key={r.workerId}>
                      <td>{shortName(r.workerName, lang)}{r.paid && <Badge kind="success" style={{ marginInlineStart: 6 }}>{t('workers.paid', 'paid')}</Badge>}</td>
                      <td className="num">{money(r.baseSalary)}</td>
                      <td className="num">{r.overtimeHours}h · {money(r.overtimePay)}</td>
                      <td className="num" style={{ color: r.lateDeduction ? 'var(--danger)' : 'inherit' }}>{r.lateMinutes}m · {money(r.lateDeduction)}</td>
                      <td className="num"><input className="input ltr" type="number" style={{ width: 80, padding: '6px 8px', textAlign: 'end' }} value={edits[r.workerId]?.bonus ?? r.bonus ?? ''} onChange={(e) => editRow(r.workerId, { bonus: e.target.value })} disabled={r.paid} /></td>
                      <td className="num"><input className="input ltr" type="number" style={{ width: 80, padding: '6px 8px', textAlign: 'end' }} value={edits[r.workerId]?.deductions ?? r.deductions ?? ''} onChange={(e) => editRow(r.workerId, { deductions: e.target.value })} disabled={r.paid} /></td>
                      <td className="num" style={{ fontWeight: 800 }}>{money(rowNet(r))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row between" style={{ marginTop: 14, fontSize: 18, fontWeight: 800 }}>
              <span>{t('common.total')}</span><span style={{ color: 'var(--brand-ink)' }}>{money(payrollTotal)}</span>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
