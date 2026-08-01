import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, UserX, Shield, User, ChefHat, Pencil, Wallet, Clock, Trash2 } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Avatar, Phone } from '../components/ui.jsx';
import { money, shortName, datetime } from '../utils/format.js';

const ROLES = ['cashier', 'chef', 'admin'];
const ROLE_ICON = { admin: Shield, chef: ChefHat, cashier: User };
const blank = { name: '', username: '', password: '', role: 'cashier', phone: '', salary: '' };

export default function Workers() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/workers', []);
  const { data: attendance } = useFetch('/attendance', []);
  const { data: advances } = useFetch('/cash-advances', [], []);
  const thisMonth = new Date().toISOString().slice(0, 7);
  // The main table's Cash Advances column clears at the start of every
  // month — it only totals advances DATED this month that have actually been
  // WITHDRAWN (cash physically handed over), excluding anything already
  // returned. A "Not Withdrawn" advance hasn't left the drawer yet — it must
  // not inflate this total, even though it still shows up normally in the
  // full per-worker history in the detail view below.
  const advanceTotalByWorker = (advances || [])
    .filter((a) => a.withdrawn && !a.returned && (a.date || '').startsWith(thisMonth))
    .reduce((acc, a) => {
      acc[a.workerId] = (acc[a.workerId] || 0) + (a.amount || 0);
      return acc;
    }, {});
  const confirm = useUI((s) => s.confirm);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // worker being edited, or null for new
  const [form, setForm] = useState(blank);
  const [payOpen, setPayOpen] = useState(false);
  const [pvRows, setPvRows] = useState(null);
  const [edits, setEdits] = useState({}); // workerId → { bonus, deductions }
  const [paying, setPaying] = useState(false);
  const [payingOne, setPayingOne] = useState(null); // workerId currently being paid individually
  const [detail, setDetail] = useState(null);
  const month = new Date().toISOString().slice(0, 7);
  // This month's paid/unpaid status per worker — fetched once up front so
  // the main table can show it without needing the Payroll modal open.
  const { data: monthPreview, refetch: refetchPreview } = useFetch(`/salaries/preview?month=${month}`, []);
  const paidThisMonth = new Set((monthPreview?.rows || []).filter((r) => r.paid).map((r) => r.workerId));
  const pendingAdvanceByWorker = Object.fromEntries((monthPreview?.rows || []).map((r) => [r.workerId, r.pendingAdvance || 0]));

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

  const reactivate = async (id) => {
    await api.patch(`/workers/${id}/reactivate`);
    notify(t('workers.reactivated', 'Worker reactivated')); refetch();
  };

  const remove = async (w) => {
    const ok = await confirm({
      title: t('workers.deleteTitle', 'Delete worker?'),
      message: t('workers.deleteConfirm', 'Delete {{name}}? Their past attendance/salary/cash-advance history is kept for records, but they will no longer appear anywhere in this restaurant.').replace('{{name}}', shortName(w.name, lang)),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/workers/${w.id}`);
      notify(t('workers.deleted', 'Worker deleted'));
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
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
  // The actual amount that will be paid out — a pending salary-deduction cash
  // advance always comes out of this month's salary, whether paid one at a
  // time or via "Pay All", so both must show and total the same figure.
  const rowFinalNet = (r) => +(rowNet(r) - (r.pendingAdvance || 0)).toFixed(2);
  const payrollTotal = (pvRows || []).reduce((s, r) => s + rowFinalNet(r), 0);

  const payAll = async () => {
    if (!(await confirm({ message: t('workers.payrollConfirm', 'Run payroll for this month? Each active worker’s salary is recorded as an expense.'), confirmLabel: t('workers.runPayroll', 'Run Payroll') }))) return;
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
      setPayOpen(false); refetch(); refetchPreview();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setPaying(false); }
  };

  /** Pay a single worker's salary, independent of the rest — generates the
   * month's record for just that worker if needed, applies any bonus/
   * deduction entered for them, then settles only their salary. */
  const payOne = async (row) => {
    if (!(await confirm({
      message: t('workers.payOneConfirm', 'Pay {{name}}\'s salary for this month?').replace('{{name}}', shortName(row.workerName, lang)),
      confirmLabel: t('workers.pay', 'Pay'),
    }))) return;
    setPayingOne(row.workerId);
    try {
      await api.post('/salaries/generate', { month });
      const { data } = await api.get(`/salaries/preview?month=${month}`);
      const fresh = data.rows.find((r) => r.workerId === row.workerId);
      if (!fresh?.id) throw new Error('Could not find this worker\'s salary record');
      const e = edits[row.workerId];
      if (e?.bonus || e?.deductions) {
        await api.patch(`/salaries/${fresh.id}/adjust`, { bonus: Number(e.bonus) || 0, deductions: Number(e.deductions) || 0 });
      }
      await api.patch(`/salaries/${fresh.id}/pay`);
      notify(t('workers.payOneDone', '{{name}}\'s salary was paid').replace('{{name}}', shortName(row.workerName, lang)));
      if (payOpen) {
        const { data: refreshed } = await api.get(`/salaries/preview?month=${month}`);
        setPvRows(refreshed.rows);
      }
      refetch(); refetchPreview();
    } catch (e) { notify(e.response?.data?.error || e.message || 'Failed', 'error'); }
    finally { setPayingOne(null); }
  };

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData } = usePaginated(data ?? [], 10);

  if (loading || !data) return <Spinner />;
  const monthlyPayroll = data.filter((w) => w.status === 'active').reduce((s, w) => s + (w.salary || 0), 0);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.workers')} subtitle={`${data.length} ${t('workers.employees', 'employees')} · ${t('workers.monthlyPayroll', 'monthly payroll')} ${money(monthlyPayroll)}`}>
        <button className="btn" onClick={openPayroll}><Wallet size={16} /> {t('workers.runPayroll', 'Run Payroll')}</button>
        <button className="btn btn--primary" onClick={openNew}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>
      <Card>
        <DataTable
          onRowClick={(r) => setDetail(r)}
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <div className="row" style={{ gap: 10 }}><Avatar name={v} size={36} /><span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div> },
            { key: 'username', label: t('login.username', 'Username'), render: (v) => <span className="muted ltr">@{v}</span> },
            { key: 'role', label: t('workers.role', 'Role'), render: (v) => { const I = ROLE_ICON[v] || User; return <Badge kind={v === 'admin' ? 'brand' : v === 'chef' ? 'warning' : ''}><I size={12} /> {t(`workers.roles.${v}`, v)}</Badge>; } },
            { key: 'phone', label: t('common.phone'), render: (v) => <Phone>{v}</Phone> },
            { key: 'salary', label: t('workers.salary', 'Salary'), align: 'end', render: (v) => money(v) },
            {
              key: '_advances', label: t('workers.cashAdvancesTotal', 'Cash Advances (this month)'), align: 'end', render: (_, r) => (
                advanceTotalByWorker[r.id] ? money(advanceTotalByWorker[r.id]) : <span className="muted">—</span>
              ),
            },
            {
              key: '_netSalary', label: t('workers.netSalary', 'Net Salary'), align: 'end', render: (_, r) => (
                <span style={{ fontWeight: 700 }}>{money((r.salary || 0) - (pendingAdvanceByWorker[r.id] || 0))}</span>
              ),
            },
            { key: 'hireDate', label: t('workers.hired', 'Hired'), render: (v) => v },
            { key: 'status', label: t('common.status'), render: (v) => <Badge kind={v === 'active' ? 'success' : 'danger'}><span className="dot" />{t(`common.${v}`)}</Badge> },
            {
              key: '_paid', label: t('workers.paidThisMonth', 'This month'), render: (_, r) => (
                paidThisMonth.has(r.id)
                  ? <Badge kind="success">{t('workers.paid', 'Paid')}</Badge>
                  : <Badge kind="warning">{t('workers.unpaid', 'Unpaid')}</Badge>
              ),
            },
            { key: '_act', label: t('common.actions'), render: (_, r) => (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}><Pencil size={13} /> {t('common.edit', 'Edit')}</button>
                {r.status === 'active' && !paidThisMonth.has(r.id) && (
                  <button className="btn btn--sm btn--primary" disabled={payingOne === r.id}
                    title={pendingAdvanceByWorker[r.id] > 0 ? t('workers.payWillDeductAdvance', 'Will also deduct a pending cash advance of {{amount}}').replace('{{amount}}', money(pendingAdvanceByWorker[r.id])) : ''}
                    onClick={(e) => { e.stopPropagation(); payOne({ workerId: r.id, workerName: r.name }); }}>
                    <Wallet size={13} /> {payingOne === r.id ? t('common.loading') : t('workers.pay', 'Pay')}
                  </button>
                )}
                {r.status === 'active' && <button className="btn btn--sm btn--danger" onClick={(e) => { e.stopPropagation(); disable(r.id); }}><UserX size={13} /></button>}
                {r.status === 'inactive' && <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); reactivate(r.id); }}>{t('workers.reactivate', 'Reactivate')}</button>}
                {!r.appUserId && <button className="btn btn--sm btn--danger" title={t('common.delete', 'Delete')} onClick={(e) => { e.stopPropagation(); remove(r); }}><Trash2 size={13} /></button>}
              </div>
            ) },
          ]}
          rows={paginatedData}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
        />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('workers.edit', 'Edit Worker') : t('workers.new', 'New Worker')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        {editing?.appUserId && (
          <div className="badge badge--info" style={{ marginBottom: 12, display: 'block' }}>
            {t('workers.linkedAccountNote', 'This is a Cashier account created by the Super Admin — username, password, and role are managed there. Only employee details below can be edited here.')}
          </div>
        )}
        <div className="field"><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('login.username', 'Username')}</label><input className="input ltr" value={form.username} disabled={!!editing?.appUserId} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('login.password', 'Password')}{editing && <span className="muted"> · {t('workers.keepBlank', 'leave blank to keep')}</span>}</label><input className="input" type="password" value={form.password} disabled={!!editing?.appUserId} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('workers.role', 'Role')}</label>
            <select className="select" value={form.role} disabled={!!editing?.appUserId} onChange={(e) => setForm({ ...form, role: e.target.value })}>
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
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{t('workers.payrollHint', 'Review each salary before paying. Add a bonus or extra deduction as needed; late deductions, overtime, and any pending salary-deduction cash advance are all applied automatically.')}</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>{t('common.name')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.base', 'Base')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.overtime', 'Overtime')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.lateDed', 'Late −')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.bonus', 'Bonus')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.deduction', 'Deduction')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.advance', 'Cash Advance')}</th>
                  <th style={{ textAlign: 'end' }}>{t('workers.net', 'Net Pay')}</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {pvRows.map((r) => (
                    <tr key={r.workerId}>
                      <td>{shortName(r.workerName, lang)}{r.paid && <Badge kind="success" style={{ marginInlineStart: 6 }}>{t('workers.paid', 'paid')}</Badge>}</td>
                      <td className="num">{money(r.baseSalary)}</td>
                      <td className="num">{r.overtimeHours}h · {money(r.overtimePay)}</td>
                      <td className="num" style={{ color: r.lateDeduction ? 'var(--danger)' : 'inherit' }}>{r.lateMinutes}m · {money(r.lateDeduction)}</td>
                      <td className="num"><input className="input ltr" type="number" min="0" placeholder="0" style={{ width: 80, padding: '6px 8px', textAlign: 'end' }} value={edits[r.workerId]?.bonus ?? (r.bonus || '')} onChange={(e) => editRow(r.workerId, { bonus: e.target.value })} disabled={r.paid} title={r.paid ? t('workers.paidLocked', 'Already paid — cannot edit') : ''} /></td>
                      <td className="num"><input className="input ltr" type="number" min="0" placeholder="0" style={{ width: 80, padding: '6px 8px', textAlign: 'end' }} value={edits[r.workerId]?.deductions ?? (r.deductions || '')} onChange={(e) => editRow(r.workerId, { deductions: e.target.value })} disabled={r.paid} title={r.paid ? t('workers.paidLocked', 'Already paid — cannot edit') : ''} /></td>
                      <td className="num" style={{ color: r.pendingAdvance ? 'var(--danger)' : 'inherit' }}>{r.pendingAdvance ? `− ${money(r.pendingAdvance)}` : '—'}</td>
                      <td className="num" style={{ fontWeight: 800 }}>
                        {money(rowFinalNet(r))}
                        {r.pendingAdvance > 0 && !r.paid && (
                          <div className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                            {t('workers.beforeAdvance', 'before advance')}: {money(rowNet(r))}
                          </div>
                        )}
                      </td>
                      <td>
                        {!r.paid && (
                          <button className="btn btn--sm btn--primary" disabled={payingOne === r.workerId} onClick={() => payOne(r)}>
                            <Wallet size={13} /> {payingOne === r.workerId ? t('common.loading') : t('workers.pay', 'Pay')}
                          </button>
                        )}
                      </td>
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

      <Modal open={!!detail} onClose={() => setDetail(null)} wide
        title={<span className="row" style={{ gap: 10 }}><Avatar name={detail?.name} size={34} /> {shortName(detail?.name || '', lang)}</span>}>
        {detail && (<>
          <div className="grid grid--3" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('workers.role')}</div><div style={{ fontWeight: 700 }}>{t(`workers.roles.${detail.role}`, detail.role)}</div></div>
            <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('workers.salary')}</div><div style={{ fontWeight: 700 }}>{money(detail.salary)}</div></div>
            <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('common.phone')}</div><div style={{ fontWeight: 700 }}><Phone>{detail.phone}</Phone></div></div>
            <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('login.username')}</div><div style={{ fontWeight: 700 }} className="ltr">@{detail.username}</div></div>
            <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('workers.hired')}</div><div style={{ fontWeight: 700 }}>{detail.hireDate}</div></div>
            <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('common.status')}</div><div style={{ fontWeight: 700 }}>{t(`common.${detail.status}`)}</div></div>
          </div>
          <div className="card__title row" style={{ gap: 8, marginBottom: 8 }}><Wallet size={16} /> {t('workers.cashAdvanceHistory', 'Cash Advance History')}</div>
          <DataTable
            columns={[
              { key: 'date', label: t('common.date') },
              { key: 'amount', label: t('cashAdvances.amount', 'Amount'), align: 'end', render: (v) => money(v) },
              { key: 'repaymentMethod', label: t('cashAdvances.repayment', 'Repayment'), render: (v) => t(`cashAdvances.repay_${v === 'cash-reimbursement' ? 'cash' : 'salary'}`) },
              {
                key: '_cashStatus', label: t('cashAdvances.cashStatus', 'Cash Status'), render: (_, r) => (
                  r.returned
                    ? <Badge kind="success">{t('cashAdvances.returnedStatus', 'Returned')}</Badge>
                    : r.withdrawn
                      ? <Badge kind="info">{t('cashAdvances.withdrawnStatus', 'Withdrawn')}</Badge>
                      : <Badge kind="warning">{t('cashAdvances.notWithdrawn', 'Not Withdrawn')}</Badge>
                ),
              },
              {
                key: 'status', label: t('cashAdvances.salaryDeduction', 'Salary Deduction'), render: (v, r) => (
                  r.repaymentMethod === 'salary-deduction'
                    ? <Badge kind={v === 'deducted' ? 'success' : 'warning'}>{t(`cashAdvances.status_${v}`, v)}</Badge>
                    : <span className="muted">—</span>
                ),
              },
            ]}
            rows={(advances || []).filter((a) => a.workerId === detail.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''))}
            empty={t('workers.noCashAdvances', 'No cash advances recorded for this worker yet.')}
          />
          <div className="card__title row" style={{ gap: 8, marginBottom: 8, marginTop: 20 }}><Clock size={16} /> {t('attendance.title', 'Attendance')}</div>
          <DataTable
            columns={[
              { key: 'date', label: t('common.date') },
              { key: 'checkInTime', label: t('attendance.checkIn', 'Check In'), render: (v, r) => r.status === 'absent' ? <Badge kind="danger">{t('attendance.absentTag', 'Absent')}</Badge> : datetime(v) },
              { key: 'checkOutTime', label: t('attendance.checkOut', 'Check Out'), render: (v) => v ? datetime(v) : '—' },
              { key: 'totalHours', label: t('attendance.hours', 'Hours'), align: 'end', render: (v) => `${v || 0}h` },
              { key: 'lateMinutes', label: t('attendance.late', 'Late'), align: 'end', render: (v) => v > 0 ? <Badge kind="danger">{v}m</Badge> : '—' },
              { key: 'overtimeHours', label: t('attendance.ot', 'OT'), align: 'end', render: (v) => v > 0 ? `${v}h` : '—' },
            ]}
            rows={(attendance || []).filter((a) => a.workerId === detail.id)
              .sort((a, b) => (b.checkInTime || 0) - (a.checkInTime || 0))}
            empty={t('workers.noAttendance', 'No attendance records yet.')}
          />
        </>)}
      </Modal>
    </div>
  );
}
