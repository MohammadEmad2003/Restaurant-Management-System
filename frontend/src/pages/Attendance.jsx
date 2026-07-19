import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Clock, Timer, ShieldCheck, Undo2, Zap, ZapOff, UserX } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Dropdown } from '../components/ui.jsx';
import { shortName, datetime } from '../utils/format.js';
import { useUI } from '../store/ui.js';

export default function Attendance() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const month = new Date().toISOString().slice(0, 7);
  const { data: monthly, loading, refetch: refetchMonthly } = useFetch('/attendance/reports/monthly', []);
  const { data: records, refetch } = useFetch('/attendance', []);
  const { data: workers } = useFetch('/workers', []);
  const [emp, setEmp] = useState('');

  const reload = () => { refetch(); refetchMonthly(); };

  const excuse = async (id, excused) => {
    try { await api.patch(`/attendance/${id}/excuse`, { excused }); notify(excused ? t('attendance.excused', 'Lateness excused') : t('attendance.applied', 'Deduction applied')); reload(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const overtime = async (id, approved) => {
    try { await api.patch(`/attendance/${id}/overtime`, { approved }); notify(approved ? t('attendance.otApplied', 'Overtime applied') : t('attendance.otRemoved', 'Overtime removed')); reload(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const bulkOvertime = async (approved) => {
    try { const { data } = await api.post('/attendance/overtime/bulk', { approved, month }); notify(`${data.updated} ${t('attendance.recordsUpdated', 'records updated')}`); reload(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const markAbsences = async () => {
    try { const { data } = await api.post('/attendance/absences', {}); notify(`${data.marked} ${t('attendance.markedAbsent', 'marked absent')}`); reload(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  // Optional filter: narrow both tables + chart to a single employee.
  const selName = (workers || []).find((w) => w.id === emp)?.name || '';
  const fMonthly = emp ? (monthly ?? []).filter((m) => m.workerName === selName) : (monthly ?? []);
  const fRecords = emp ? (records ?? []).filter((r) => r.workerName === selName) : (records ?? []);
  const empOptions = [
    { value: '', label: t('attendance.allEmployees', 'All employees') },
    ...(workers || []).filter((w) => w.status === 'active').map((w) => ({ value: w.id, label: shortName(w.name, lang) })),
  ];

  const monthlyPg = usePaginated(fMonthly, 10);
  const clockInsPg = usePaginated(fRecords, 10);

  if (loading || !monthly) return <Spinner />;
  const totalHours = fMonthly.reduce((s, m) => s + m.totalHours, 0).toFixed(0);
  const totalOt = fMonthly.reduce((s, m) => s + m.overtime, 0).toFixed(1);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.attendance')} subtitle={`${t('attendance.thisMonth', 'This month')} · ${totalHours}${t('attendance.hShort', 'h')} · ${totalOt}${t('attendance.hShort', 'h')} ${t('attendance.overtimeWord', 'overtime')}`}>
        <div style={{ minWidth: 190 }}>
          <Dropdown value={emp} onChange={setEmp} options={empOptions} placeholder={t('attendance.filterEmployee', 'Filter by employee')} />
        </div>
        <button className="btn btn--sm" onClick={() => bulkOvertime(true)}><Zap size={14} /> {t('attendance.approveAllOt', 'Approve all OT')}</button>
        <button className="btn btn--sm" onClick={() => bulkOvertime(false)}><ZapOff size={14} /> {t('attendance.removeAllOt', 'Remove all OT')}</button>
        <button className="btn btn--sm btn--danger" onClick={markAbsences}><UserX size={14} /> {t('attendance.markAbsences', 'Mark absences (today)')}</button>
      </PageHeader>
      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title={t('attendance.hoursByEmployee', 'Hours by Employee (this month)')}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={fMonthly.map((m) => ({ ...m, label: shortName(m.workerName, lang) }))} margin={{ left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }} />
              <Legend />
              <Bar dataKey="totalHours" name={t('attendance.hours', 'Hours')} fill="#7c3aed" radius={[6, 6, 0, 0]} />
              <Bar dataKey="overtime" name={t('attendance.overtimeWord', 'Overtime')} fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title={t('attendance.monthlySummary', 'Monthly Summary')}>
          <DataTable
            columns={[
              { key: 'workerName', label: t('attendance.employee', 'Employee'), render: (v) => shortName(v, lang) },
              { key: 'days', label: t('attendance.days', 'Days'), align: 'end' },
              { key: 'absences', label: t('attendance.absences', 'Absent'), align: 'end', render: (v) => v > 0 ? <Badge kind="danger">{v}</Badge> : '0' },
              { key: 'totalHours', label: t('attendance.hours', 'Hours'), align: 'end', render: (v) => `${v}${t('attendance.hShort', 'h')}` },
              { key: 'overtime', label: t('attendance.overtimeWord', 'Overtime'), align: 'end', render: (v) => <Badge kind={v > 0 ? 'warning' : ''}>{v}{t('attendance.hShort', 'h')}</Badge> },
            ]}
            rows={monthlyPg.paginatedData}
            pagination={{ currentPage: monthlyPg.page, totalPages: monthlyPg.totalPages, onPageChange: monthlyPg.setPage, pageSize: monthlyPg.pageSize, totalItems: monthlyPg.totalItems, onPageSizeChange: monthlyPg.setPageSize }}
          />
        </Card>
      </div>

      <Card title={<span className="row" style={{ gap: 8 }}><Clock size={16} /> {t('attendance.recentClockIns', 'Recent Clock-ins')}</span>}>
        <DataTable
          columns={[
            { key: 'workerName', label: t('attendance.employee', 'Employee'), render: (v) => <span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span> },
            { key: 'date', label: t('common.date') },
            { key: 'checkInTime', label: t('attendance.checkIn', 'Check In'), render: (v, r) => r.status === 'absent' ? <Badge kind="danger">{t('attendance.absentTag', 'Absent')}</Badge> : datetime(v) },
            { key: 'shift', label: t('attendance.shift', 'Shift'), render: (v, r) => r.isOffDay ? <Badge kind="brand">{t('attendance.offDay', 'Off-day')}</Badge> : v ? <Badge kind={v === 'day' ? 'info' : 'brand'}>{t(`attendance.${v}`, v)}</Badge> : '—' },
            { key: 'lateMinutes', label: t('attendance.late', 'Late'), render: (v, r) => r.status === 'absent' ? '—' : r.excused ? <Badge kind="info">{t('attendance.excusedTag', 'Excused')}</Badge> : v > 0 ? <Badge kind="danger">{v} {t('attendance.min', 'min')}</Badge> : <Badge kind="success">{t('attendance.onTime', 'On time')}</Badge> },
            { key: 'checkOutTime', label: t('attendance.checkOut', 'Check Out'), render: (v, r) => r.status === 'absent' ? '—' : v ? datetime(v) : <Badge kind="success"><span className="dot" />{t('attendance.onShift', 'On shift')}</Badge> },
            { key: 'overtimeHours', label: t('attendance.ot', 'OT'), align: 'end', render: (v, r) => v > 0 ? <Badge kind={r.overtimeApproved === false ? '' : 'warning'}>{v}{t('attendance.hShort', 'h')}{r.overtimeApproved === false ? ' ✕' : ''}</Badge> : '—' },
            { key: '_act', label: t('common.actions'), render: (_, r) => (
              <div className="row" style={{ gap: 6 }}>
                {r.lateMinutes > 0 && r.status !== 'absent' && (r.excused
                  ? <button className="btn btn--sm" onClick={() => excuse(r.id, false)}><Undo2 size={13} /> {t('attendance.apply', 'Apply')}</button>
                  : <button className="btn btn--sm" onClick={() => excuse(r.id, true)}><ShieldCheck size={13} /> {t('attendance.excuse', 'Excuse')}</button>)}
                {r.overtimeHours > 0 && (r.overtimeApproved === false
                  ? <button className="btn btn--sm" onClick={() => overtime(r.id, true)}><Zap size={13} /> {t('attendance.addOt', 'Add OT')}</button>
                  : <button className="btn btn--sm" onClick={() => overtime(r.id, false)}><ZapOff size={13} /> {t('attendance.removeOt', 'Remove OT')}</button>)}
              </div>
            ) },
          ]}
          rows={clockInsPg.paginatedData}
          pagination={{ currentPage: clockInsPg.page, totalPages: clockInsPg.totalPages, onPageChange: clockInsPg.setPage, pageSize: clockInsPg.pageSize, totalItems: clockInsPg.totalItems, onPageSizeChange: clockInsPg.setPageSize }}
        />
      </Card>
    </div>
  );
}
